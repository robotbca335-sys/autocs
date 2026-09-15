# AUDIT_BACKEND — lib/admin-api.js & lib/history-api.js

Tanggal: 2026-09-16
Repo: Vercel Serverless Node.js (CommonJS)

---

## 1. Ringkasan API yang diexpose

### lib/admin-api.js — Admin API idrbo (REST)
Export: `IDRBO_HEADERS, DEFAULT_DOMAIN, buildHeaders, extractRecords, extractScatterFromPgData, queryTransactionHistory, fetchBetData, recordSid, recordDebet, recordGameId, isInvalidSession`

| Fungsi | Endpoint idrbo | Metode | Auth/Header |
|---|---|---|---|
| `queryTransactionHistory` | `/game-oc/ida/transaction/history/queryTransactionHistoryListForUser?...` | **GET** (query string di URL) | Headers `X-Access-Token`, `X-Agent-Pkid`, `X-Agent-Role`, `X-Agent-Suid`, `X-Agent-User`, `X-Agent-UserId` |
| `fetchBetData` | memakai `queryTransactionHistory` (loop max 4 tanggal mundur) | GET | sama (header), token wajib min 10 karakter |
| `extractScatterFromPgData` | parsing lokal (bukan panggilan HTTP) | — | — |

### lib/history-api.js — History API (GetBetHistory)
Export: `fetchBetHistory, extractScatter, loadStoredHeaders, saveStoredHeaders`

| Fungsi | Endpoint | Metode | Auth |
|---|---|---|---|
| `fetchBetHistory` | `${host}/web-api/operator-proxy/v1/History/GetBetHistory?t=<token>` | **POST** body `application/x-www-form-urlencoded` (`sid`, `gid`) | token dikirim sebagai **query param `?t=`** |
| `loadStoredHeaders` / `saveStoredHeaders` | baca/tulis tabel `settings` Supabase (key `admin`) | — | pakai Supabase client |

### Sumber credential / header
- **Bukan hardcode.** Semua header/token admin idrbo diambil dari Supabase tabel `settings` (key=`admin`) via `loadStoredHeaders()` → fields: `token, adminUrl, pkid, role, suid, userAgent, userid, historyToken`.
- Supabase credentials dari env: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (fallback `SUPABASE_ANON_KEY`) — lihat `lib/supabase.js:3-4`.
- Domain default idrbo `DEFAULT_DOMAIN = 'ag-bandar80.idrbo2.com'` **hardcode** di `lib/admin-api.js:7`, tapi itu bukan secret (hanya hostname).

---

## 2. Audit keamanan

**Temuan: TIDAK ada secret literal (token idrbo, password) di kedua file.**

- Token admin idrbo & `historyToken` diambil dari Supabase `settings` (env-driven), tidak ada nilai literal di source. ✅
- Supabase `SUPABASE_SERVICE_KEY` dipakai dari env `process.env` (`lib/supabase.js:4`), tidak ada hardcode. ✅

**Risiko / rekomendasi keamanan:**

| # | Severity | Temuan | Lokasi | Rekomendasi |
|---|---|---|---|---|
| S1 | **Tinggi** | Token history (`historyToken`) dikirim sebagai query string `?t=...` di URL | `lib/history-api.js:39` | Pindah ke header `X-Access-Token` / body form. Query string kebocoran ke log proxy/CDN/access log Vercel. |
| S2 | Sedang | `saveStoredHeaders` menyimpan token admin idrbo ke tabel `settings` | `lib/history-api.js:26-29` | Pastikan RLS Supabase menutup baca `settings` publik; jangan expose via API client/edge yang bisa diakses publik. |
| S3 | Rendah | `DEFAULT_DOMAIN` hardcode di source | `lib/admin-api.js:7` | Pindah ke env `IDRBO_DOMAIN` agar bisa ganti domain tanpa redeploy. |
| S4 | Informasional | Header auth hanya di-send saat `stored.token.length >= 10`; token pendek dianggap "belum ada" | `lib/admin-api.js:148-150` | Validasi baku (mis. non-empty) saja; panjang token bisa berubah dari sisi operator. |

Tidak ada password/idrbo token literal yang ditemukan di `admin-api.js` maupun `history-api.js`.

---

## 3. Audit logika history (query param & rewrite)

**Bug utama (runtime, akan gagal):**

| # | Severity | Temuan | Lokasi |
|---|---|---|---|
| H1 | **Kritis** | `lib/history-api.js:7` mengimpor `DEFAULT_HOST` dari `./admin-api`, **padahal admin-api mengekspor `DEFAULT_DOMAIN`, bukan `DEFAULT_HOST`**. Akibatnya `host = DEFAULT_HOST` bernilai `undefined`. Jika `fetchBetHistory` dipanggil tanpa arg `host`, `host.startsWith('http')` di baris 38 akan **throw TypeError**. | `history-api.js:7,32,38` |

**Koreksi:** `const { DEFAULT_DOMAIN: DEFAULT_HOST } = require('./admin-api');` atau gunakan `DEFAULT_DOMAIN` sebagai default host.

**Temuan lain terkait query param:**

| # | Severity | Temuan | Lokasi |
|---|---|---|---|
| H2 | Sedang | `queryTransactionHistory` membangun URL `startDate`/`endDate` **tanpa `encodeURIComponent`** (hanya `userId` & `transactionId` yang di-encode). Karena nilai `startDate`/`endDate` datang dari `buildDates()` (ISO `YYYY-MM-DD`) aman secara struktur, tapi sebaiknya di-encode konsisten. | `admin-api.js:138` |
| H3 | Sedang | Untuk admin-api, `queryTransactionHistory` memeriksa error `INVALID_OPERATOR_SESSION` hanya dari body JSON. Jika idrbo mereturn 401/403 pada HTTP level (tidak sampai body), session yang invalid tidak terdeteksi dan di-`continue` (hanya menimbulkan `Admin API error: 401`). | `admin-api.js:140-142,166-169` |
| H4 | Rendah | History API: `sid` dan `gid` dipakai langsung membangun body form tanpa sanitasi selain `URLSearchParams` (sudah otomatis encoded) — aman. ✅ | `history-api.js:41-43` |
| H5 | Rendah | Tidak ada truncation/rewrite — POST body `sid`/`gid` tidak di-rewrite. Nilai `sid` jika kosong tetap dikirim sebagai string kosong (`body.set('sid','')` hanya jika truthy, jadi tidak dikirim). ✅ | `history-api.js:42-43` |

---

## 4. node --check

```
C:\Program Files\nodejs\node --check lib\admin-api.js   → exit 0
C:\Program Files\nodejs\node --check lib\history-api.js → exit 0
```

Kedua file lolos syntax check (exit code 0). **Catatan:** kelebihan `DEFAULT_HOST` (H1) tidak tertangkap `node --check` karena `undefined` baru terjadi saat runtime (destructuring import yang tidak ada — bukan syntax error). Bukan ESM, jadi import yang buntu tidak di-throw saat load tahap awal.

---

## 5. Rekomendasi prioritas

1. **Fix H1 (kritis, blokir runtime):** ganti import `DEFAULT_HOST` di `history-api.js:7` menjadi `{ DEFAULT_DOMAIN: DEFAULT_HOST }` atau `{ DEFAULT_DOMAIN }`.
2. **Fix S1 (token di query string):** kirim `historyToken` lewat header `X-Access-Token` pada `fetchBetHistory`, bukan `?t=`.
3. Encode `startDate`/`endDate` di `queryTransactionHistory` (`admin-api.js:138`) untuk konsistensi.
4. Tangani 401/403 HTTP-level sebagai `INVALID_OPERATOR_SESSION` di `admin-api.js`.
5. Pindahkan `DEFAULT_DOMAIN` ke env variable.