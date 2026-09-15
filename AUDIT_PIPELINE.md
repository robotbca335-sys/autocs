# AUDIT: services/pipeline.js & services/puppeteer-scrape.js

**Tanggal:** 2026-09-16
**node --check:** pipeline 0, puppeteer-scrape 0

---

## 1. Perilaku extractScatter (extractScatterFromPgData)

Fungsi inti ada di `lib/admin-api.js:65-125`. `history-api.js:87` hanya wrapper.

### Input
Menerima satu objek `pgData` — response API game provider. Struktur yang dibaca:

```
pgData.dt.bd[]  → array of spins
  Each item: .gd.st  (spin type)
             .gd.nst (next spin type)
             .gd.sc  (scatter count)
```

### 3 strategi ekstraksi

| # | Nama | Deteksi | Field dibaca |
|---|------|---------|-------------|
| 1 | FreeSpin scatter | `st===4 && nst===21 && sc>0` | `gd.st`, `gd.nst`, `gd.sc` |
| 2 | Max scatter in bd | Semua item, ambil max(sc) | `gd.st < 21`, `gd.sc` |
| 3 | Trigger spin | `st<4 && nst>=4 && sc>=3` | `gd.st`, `gd.nst`, `gd.sc` |

**FreeSpin mode ditangani** — strategi 1 khusus free spin (st=4=free, nst=21=masuk free mode). Jika sc>=5, ia scan spin berikutnya untuk cari max sc di free spin sequence.

### Prioritas (konsensus, baris 116-124)
Urutan: **r1 (freeSpinSc) > r2 (maxSc) > r3 (triggerSc)**

Jika ketiganya valid (3-5):
- Jika r1==r2 atau r1==r3 → return r1
- Jika r2==r3 → return r2
- Else → return r1 (freeSpinSc jadi tiebreaker)

Jika scatter==4 DAN scatter==5 muncul di strategi berbeda, **freeSpinSc menang** kecuali maxSc dan triggerSc sama (→ maxSc menang).

### Contoh input/output
```js
// Input: 3 spin dalam free spin mode
pgData = { dt: { bh: { bd: [
  { gd: { st: 4, nst: 21, sc: 4 } },  // free spin trigger, 4 scatter
  { gd: { st: 4, nst: 21, sc: 5 } },  // free spin lanjut, 5 scatter
  { gd: { st: 21, nst: 1, sc: 0 } }   // selesai
]}}};
// Output: 4
// Karena freeSpinSc=4 (break di iterasi pertama), maxSc loop mencari sc terbesar
// di spin berikutnya yang st>=4 && st<21 → sc=5. maxSc=5.
// r1=4, r2=5, r3=null. r1 valid → return 4.
```

### Null-safety
- `pgData?.dt?.bh?.bd` — optional chaining
- `Array.isArray(bd)` guard — return null jika bukan array
- `item?.gd || {}` — fallback object kosong
- Semua `Number()` dibungkus `isFinite()` check
- Return `null` jika tidak ada data valid

---

## 2. Celah Keamanan & Logika

### PRIORITAS TINGGI

| # | Celah | Lokasi | Detail |
|---|-------|--------|--------|
| H1 | **Race condition: fetch → DB write tanpa locking** | pipeline.js:31-99 | `verifyClaimAuto` fetch data lalu return fields via `buildVerifyFields`. Tidak ada `SELECT ... FOR UPDATE`, optimistic lock, atau idempotency key. Dua worker bisa fetch claim yang sama secara bersamaan, menghasilkan write terakhir menang (lost update). |
| H2 | **Puppeteer singleton tidak cocok untuk serverless** | puppeteer-scrape.js:16-17 | `_browser` di-global module scope. Di Vercel serverless, setiap cold start = isolated module. Browser tidak pernah `close()`, memory leak atau timeout. Warm instance juga tidak guaranteed re-use karena fungsi tidak bilang browser tutup setelah pakai. |
| H3 | **XPath selectors hardcode ke DOM bonussmb.com** | puppeteer-scrape.js:63,68,73,94,130,146-147 | XPath `//*[@id="radix-…"]` langsung ke DOM spesifik. Jika bonussmb.com update UI → submit/status gagal total tanpa error yang jelas. |
| H4 | **Token admin & history tersimpan di Supabase `settings` tanpa enkripsi** | supabase.js:145-164 | `getSetting('admin')` return objek berisi `token`, `historyToken` dalam plaintext. Jika Supabase anon key bocor → semua token admin terexpos. |
| H5 | **`selectDropdown` fallback klik option pertama tanpa match** | puppeteer-scrape.js:201-204 | Jika value tidak ditemukan di dropdown, ia klik opsi pertama yang visible. Ini silent data corruption — tiket bisa ter-submit dengan scatter/situs/tipe yang salah. |

### PRIORITAS SEDANG

| # | Celah | Lokasi | Detail |
|---|-------|--------|--------|
| M1 | **No idempotency check sebelum write** | pipeline.js:152-163 | `buildVerifyFields` tidak cek apakah claim sudah di-verify. Jika worker dipanggil ulang untuk claim yang sama, overwrite hasil sebelumnya. |
| M2 | **`page.waitForTimeout` deprecated** | puppeteer-scrape.js:60,65,70,76,79,83,91,95,143,175,182,187,197,203,221,228 | Deprecated di Puppeteer v22+. Akan throw warning atau error di versi baru. Harusnya `new Promise(r => setTimeout(r, ms))` atau `page.waitForSelector` dengan timeout. |
| M3 | **Hardcoded Chrome path Windows-only** | puppeteer-scrape.js:13 | `C:\Program Files\Google\Chrome\Application\chrome.exe` — tidak jalan di Vercel (Linux). `process.env.CHROME_PATH` jadi satu-satunya jalan keluar, tapi tidak ada validasi apakah file exists. |
| M4 | **`--no-sandbox` Chrome flag** | puppeteer-scrape.js:27 | Security risk jika digunakan di environment shared. Di serverless container biasanya aman, tapi tetap best practice untuk dihindari jika memungkinkan. |
| M5 | **Tidak ada timeout/error handling di puppeteer operations** | puppeteer-scrape.js:59,126 | `page.goto` pakai `networkidle2` + 30s timeout, tapi operasi dropdown/typing tidak punya retry. Jika bonussmb.com lambat → partial submit tanpa feedback jelas. |
| M6 | **`findRecordForClaim` pakai JSON.stringify untuk cari kode tiket** | pipeline.js:21-23 | `JSON.stringify(r).replace(/\D/g, '').includes(sig)` — pencarian substring pada seluruh JSON serialized record. Bisa false positive jika kode tiket muncul di field lain (misalnya timestamp atau ID lain). |

### PRIORITAS RENDAH

| # | Celah | Lokasi | Detail |
|---|-------|--------|--------|
| L1 | **Silent catch blocks** | puppeteer-scrape.js:42,114,163,206,226 | Banyak `catch (_) {}` menelan error tanpa logging. Sulit debug di production. |
| L2 | **Tidak pakai `require('node-fetch')` — global fetch** | history-api.js:47, admin-api.js:139 | Pakai global `fetch` (Node 18+). Aman untuk Node 18+, tapi tidak ada polyfill fallback untuk environment lebih lama. |
| L3 | **`AbortSignal.timeout`** | history-api.js:51, admin-api.js:139 | Fitur Node 18+. Tersedia di Node 18+, tapi tidak ada fallback. |
| L4 | **Supabase client singleton** | supabase.js:6-18 | `_client` di-global scope. Di serverless, semua fungsi yang import supabase.js berbagi 1 client. Biasanya aman karena `createClient` lightweight, tapi worth noting. |
| L5 | **`claim.betting` vs `claim.bet`** | pipeline.js:128 | `submitBonusTicket` kirim `betting: claim.betting`, tapi `verifyClaimAuto` pakai `betData.bet`. Tidak konsistensi nama field antara input claim dan output extraction. |

---

## 3. Rekomendasi Fix (tanpa menulis ke kode)

### Urgent (H1-H5)
1. **H1**: Tambahkan status transition lock — set claim ke `VERIFYING` dengan kondisi `status = 'PENDING'` (atomic update di Supabase), baru fetch data. Jika update gagal → skip.
2. **H2**: Ubah arsitektur Puppeteer: tutup browser di akhir setiap operasi (`finally { await page.close(); await browser.close(); }`), atau gunakan pool terpisah untuk serverless.
3. **H3**: Ganti XPath selectors dengan `data-testid` attributes atau selectors berbasis CSS class yang lebih stabil. Pertahankan XPath sebagai fallback.
4. **H4**: Enkripsi token di Supabase menggunakan app-level key, atau gunakan Supabase Vault / edge function sebagai proxy.
5. **H5**: Hapus fallback `return true` di `selectDropdown` — return `false` jika match tidak ditemukan, biarkan caller tahu.

### Medium (M1-M6)
6. **M1**: Cek `checked_at` atau `status` sebelum proses ulang.
7. **M2**: Ganti `page.waitForTimeout` dengan `new Promise(r => setTimeout(r, ms))` atau helper sendiri.
8. **M3**: Validasi Chrome path exists sebelum `puppeteer.launch`. Tambah fallback ke `chromium` atau `playwright`.
9. **M5**: Tambah retry logic atau `page.waitForSelector` untuk operasi kritis.
10. **M6**: Ganti pencarian dengan field-specific match (cari di `r.transactionId` atau `r.tid` langsung, bukan entire JSON).

### Low (L1-L5)
11. **L1**: Ganti `catch (_) {}` dengan `catch (e) { console.error('puppeteer:', e.message); }` atau structured logging.
12. **L5**: Standarisasi nama field: gunakan `betting` secara konsisten di claim object atau remap di satu tempat.

---

## 4. Ringkasan Teknis

| Item | Status |
|------|--------|
| `node --check pipeline.js` | **EXIT 0** |
| `node --check puppeteer-scrape.js` | **EXIT 0** |
| Fetch mechanism | Global `fetch` (Node 18+), tidak ada `require('node-fetch')` |
| Token storage | Supabase `settings` table, key `admin` dan `history`, plaintext JSON |
| DB operations | `updateClaim(id, updates)` via Supabase client (update, bukan insert) |
| ExtractScatter field | `pgData.dt.bd[].gd.{st, nst, sc}` |
| Free-spin handling | Ya (st===4, nst===21), dengan scan sequence untuk max sc |
| Null-safe | Ya — optional chaining + type coercion + null returns |
