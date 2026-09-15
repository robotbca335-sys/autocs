# SECURITY — web-scatter

> Ringkasan arsitektur keamanan aplikasi Vercel serverless Node.js.
> Domain produksi: `https://scatter-claim.vercel.app`
> Terakhir diperbarui: 2026-09-16

---

## 1. Ringkasan Arsitektur Keamanan

Aplikasi ini adalah web statis + serverless function (Vercel). Semua logika server ada di folder `api/`. Data tersimpan di Supabase. Berikut komponen keamanan utamanya:

### 1.1 Login Admin — Google OAuth 2.0 + PKCE

- **Alur:** `GET /api/auth?action=login` membangun URL OAuth Google dengan parameter `response_type=code`, `state` acak (16 byte hex), dan `code_challenge` = SHA-256 base64url dari `code_verifier` (32 byte) dengan `code_challenge_method=S256`.
- **State & verifier** disimpan di cookie terpisah: `oa_state` dan `oa_verifier` (TTL 600 detik, `HttpOnly; SameSite=Lax`).
- **Callback:** `GET /api/auth/callback` memverifikasi `state` cocok dengan cookie `oa_state` (jika tidak cocok → **403 State mismatch**), menukar `code` + `code_verifier` di `https://oauth2.googleapis.com/token`, lalu men-decode `id_token` Google.
- **Whitelist email:** email dari Google divalidasi terhadap `MASTER_EMAIL` (env) DAN/ATAU daftar `settings.admin.allowed_emails[]` di Supabase. Email tidak ada di whitelist → **403 "Email tidak di-whitelist master"**.
- **Sumber implementasi:** `api/auth/index.js`, `api/auth/callback/index.js`, `lib/auth-handler.js`.

### 1.2 Session — JWT HS256 di Cookie

- Setelah whitelist lolos, server menerbitkan **JWT HS256** (payload `{sub, email, name, iat, exp}`) yang ditandatangani dengan env `SESSION_SECRET`.
- Cookie: **`adm_session`** dengan atribut `Path=/; HttpOnly; SameSite=Lax; Max-Age=43200` → **12 jam**.
- Verifikasi di `me` / `logout` membaca `adm_session`, memverifikasi HMAC-SHA256 dan `exp`. Signature tidak valid atau expired → `authenticated: false`.

### 1.3 Rate Limit — Token Bucket In-Memory Per-IP

- `lib/rate-limit.js` menyediakan `createTokenBucket()` (token bucket per-IP, refill proporsional terhadap waktu) dan `createGlobalLimiter()`.
- Default: `defaultAuthBucket` 60 detik / 30 token, `defaultApiBucket` 60 detik / 120 token, `globalRps` 1 detik / 50 token global.
- IP diambil dari `X-Forwarded-For` (nilai pertama) → fallback `remoteAddress`. Token yang melewati batas → **HTTP 429** dengan `retryAfter`.
- Sumber implementasi: `lib/rate-limit.js`. Hampir semua endpoint dibungkus `wrapWithRateLimit`; `api/settings` dan `api/process` juga memanggil `globalRpsLimiter.hit()`.

### 1.4 Security Headers (vercel.json)

Header diterapkan lewat `vercel.json` (tidak dimodifikasi):

| Header | Nilai | Source di vercel.json |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | `/(.*)` |
| `X-Frame-Options` | `DENY` | `/(.*)` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `/(.*)` |
| `Cache-Control` | `public, max-age=31536000, immutable` | `/css/(.*)` dan `/js/(.*)` |

Catatan lintas-endpoint: `api/auth/callback` memakai `Access-Control-Allow-Origin: <SITE_URL>` (ketat), sedangkan endpoint publik seperti `track`, `submit`, `manage`, `process`, `settings`, `auto`, `admin/*` memakai `*` (longgar, perlu di-restrict untuk kategori CORS di daftar pentest).

### 1.5 Data — Supabase + RLS

- Koneksi via `lib/supabase.js` menggunakan env Vercel: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`.
- Skema dan aturan (policy) ada di `database.sql`. Akses data bergantung pada **Row Level Security (RLS)** yang diaktifkan di tabel terkait (`sites`, `claims`, `logs`, `settings`, dll.).
- Token admin panel & history (setting `admin.*`) disimpan di tabel `settings`; endpoint `GET /api/settings` me-mask token pada respons (`token_masked`).

### 1.6 Batasan Rate-Limit GLOBAL

- **PENTING:** Vercel serverless menjalankan setiap function pada **instance terpisah yang bisa di-cold-start kembali**; Map bucket `lib/rate-limit.js` hidup **per-instance / per-container**, bukan global.
- Akibatnya: bila N instance aktif, limit efektif bisa ~N× lipat dari angka di atas, dan bucket hilang saat instance di-recycle. Rate limiter ini adalah **guard lapisan pertama anti-abuse**, bukan pengaman mutlak.
- **Untuk rate-limit global lintas instance**, gunakan penyimpanan terpusat: **Supabase** (tabel counter per-IP dengan `updated_at` + window query) atau **Vercel Edge / Upstash Redis**. Offload yang cocok lebih pro (bukan tekanan cold-start) juga disarankan.

---

## 2. DAFTAR PENGETESAN (Pen-Test Checklist)

Format setiap item: **Langkah uji** (cara mengeksekusi) → **Hasil diharapkan** (kriteria aman).

### Kategori 1 — Brute Force Login / Rate-Limit Auth

- **Item 1.1 — Brute force endpoint login**
  - Langkah: loop 40× `GET /api/auth?action=login` dari IP sama dalam 1 menit (mis. `1..45 | % { Invoke-WebRequest ... }`).
  - Hasil diharapkan: request melebihi token bucket (default `defaultAuthBucket` 30/60 dtk) → **HTTP 429** `Terlalu banyak permintaan`.
- **Item 1.2 — Rate-limit callback OAuth**
  - Langkah: kirim 40× `GET /api/auth/callback` dengan `code/state` dummy + cookie `oa_state`/`oa_verifier` sesuai.
  - Hasil diharapkan: request ke-31+ → **429**; sebelum itu tetap **403** (state/code dummy), bukan 200.

### Kategori 2 — Whitelist Bypass

- **Item 2.1 — Email acak luar whitelist**
  - Langkah: mulai OAuth dari akun Google dengan email acak (mis. `hacker+999@gmail.com`), selesaikan alur sampai callback.
  - Hasil diharapkan: **403** `Email tidak di-whitelist master`; tidak ada `adm_session` diterbitkan.
- **Item 2.2 — Bypass lewat manipulasi id_token**
  - Langkah: kirim callback dengan `code` valid untuk email whitelist tetapi `id_token` payload email diubah manual (tanpa tanda tangan Google).
  - Hasil diharapkan: dekode id_token tanpa verifikasi signature menghasilkan kesalahan / email tak dikenal → tetap **403** atau **502**, tidak login.

### Kategori 3 — PKCE / State Mismatch

- **Item 3.1 — State mismatch**
  - Langkah: `GET /api/auth/callback?code=dummy&state=ATTACKER_STATE` dengan cookie `oa_state=REAL_STATE`.
  - Hasil diharapkan: **403** `State mismatch - ulangi login`.
- **Item 3.2 — PKCE tanpa code_verifier**
  - Langkah: hapus cookie `oa_verifier`, kirim callback dengan `state` benar dan `code` valid.
  - Hasil diharapkan: pertukaran token gagal di Google (verifier kosong) → **502** `Gagal tukar code`; tidak ada session.

### Kategori 4 — Session Hijack

- **Item 4.1 — Cookie tanpa sekret / JWT tamper**
  - Langkah: decode `adm_session` asli, ubah payload `email`, encode ulang tanpa re-sign, kirim sebagai cookie.
  - Hasil diharapkan: `GET /api/auth?action=me` → `authenticated: false` (signature gagal).
- **Item 4.2 — Sifat cookie**
  - Langkah: inspeksi header `Set-Cookie` respons login & coba baca `document.cookie` via console browser.
  - Hasil diharapkan: cookie punya `HttpOnly` (tak terbaca JS), `SameSite=Lax`, `Max-Age=43200`; cookie kosong setalah logout.

### Kategori 5 — CORS / SSRF (Endpoint Scrape/Process, Host Custom)

- **Item 5.1 — CORS wildcard**
  - Langkah: `Invoke-WebRequest -Uri ".../api/process" -Headers @{Origin="https://evil.example"}` lalu baca header respons.
  - Hasil diharapkan: `Access-Control-Allow-Origin: *` pada `api/process` (TINDAK LANJUT: harus di-restrict ke `SITE_URL`). Untuk `api/auth/callback` harus persis `SITE_URL`.
- **Item 5.2 — SSRF via host custom `adminUrl`**
  - Langkah: `POST /api/settings` → `{"key":"admin","value":{"adminUrl":"http://169.254.169.254/latest/meta-data/"}}` lalu trigger `POST /api/process` pipeline `verifyClaim`/auto.
  - Hasil diharapkan: **tidak boleh** ada data metadata cloud bocor ke respons; failure/timeout diam-diam. (Saat ini belum ada validasi whitelist domain — risiko SSRF, lihat catatan.)

### Kategori 6 — Path Traversal (vercel.json Rewrite)

- **Item 6.1 — Traversal via rewrite /master**
  - Langkah: `GET https://scatter-claim.vercel.app/master/..%2F..%2Fapi%2Fadmin` dan `/master/../../etc/passwd`.
  - Hasil diharapkan: tidak membocorkan file di luar; Vercel menormalkan path — 404/redirect, bukan raw file server.
- **Item 6.2 — Akses file sensitif langsung**
  - Langkah: `GET /.env`, `/.env.local`, `/package.json`, `/database.sql`, `/vercel.json`.
  - Hasil diharapkan: seluruhnya **404/redirect** (file statis tidak di-publish, hanya `index.html`/`master/` di path whitelist).

### Kategori 7 — DDoS / Slowloris

- **Item 7.1 — Lonjakan RPS**
  - Langkah: 200 request paralel ke `/api/track` dari IP sama dalam <5 detik.
  - Hasil diharapkan: sebagian besar kena **429** oleh token bucket / global limiter; function tidak crash.
- **Item 7.2 — Slowloris / koneksi menggantung**
  - Langkah: buka koneksi TCP ke domain:443 lalu kirim header sebagian dan tunda lama (mis. pakai script slow POST).
  - Hasil diharapkan: Vercel edge/POSIX menutup koneksi idle (Vercel Protection + platform rate limiting memblokir); serverless tidak hang.

### Kategori 8 — Secret Leak di Git

- **Item 8.1 — Riwayat git**
  - Langkah: `git log --all --oneline` lalu `git grep` untuk pattern secret (`SESSION_SECRET=`, `SUPABASE_SERVICE_KEY=`, `MASTER_EMAIL=`, token 20+ char) di semua commit.
  - Hasil diharapkan: tidak ada secret terdorong ke history; `.env.local` tidak pernah ter-commit.
- **Item 8.2 — File contoh sekret**
  - Langkah: baca `.gitignore` dan `.env.example`.
  - Hasil diharapkan: `.env` / `.env.local` / `node_modules` ter-ignore; `.env.example` hanya berisi placeholder (bukan nilai aktual).

---

## 3. Catatan Pengujian

- Pengujian di atas **belum dijalankan terhadap endpoint live**; seluruh checklist harus dieksekusi setelah deploy dan di-log di `PENTEST-LOG.md`.
- Semua permintaan pengujian sebaiknya dari IP/dev test terpisah agar tidak mengganggu data produksi (gunakan kode_tiket dummy / dataset staging).
- Daftar endpoint yang diuji: `api/auth`, `api/auth/callback`, `api/track`, `api/submit`, `api/sitelist`, `api/manage`, `api/settings`, `api/process`, `api/auto`, `api/admin`, `api/admin/stats`, `api/admin/claims`, `api/admin/logs`, dan statis `/`, `/master`, `/css/*`, `/js/*`.