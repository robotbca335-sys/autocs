# AUDIT_ADMIN

Audit keamanan endpoint `/api/admin/*` (Vercel Serverless, Node.js CommonJS).
Tanggal audit: 2026-09-16.

Ringkasan:
- `node --check`: semua 4 file `index.js` lolos (exit 0).
- KRITIS: 3 dari 4 endpoint (`claims`, `logs`, `stats`) menjalankan operasi data **tanpa autentikasi** (tidak ada cek cookie `adm_session` / `verifySession` / `parseCookies` dari `lib/auth-handler.js`).
- `logs` mendukung `DELETE` penghapus semua log — dapat dipanggil siapa saja.
- Tidak ada secret literal pada file admin (dukungan Supabase via `lib/supabase`; kredensial di env).
- Semua set `Access-Control-Allow-Origin: *` (CORS terbuka global).

Mekanisme proteksi yang sudah ada di repo tapi tidak dipakai:
`lib/auth-handler.js` menyediakan `parseCookies(req)`, `verifySession(token)`
(cookie `adm_session`, JWT HS256 `SESSION_SECRET`), dan `isEmailAllowed`.

---

## api/admin/index.js
- node --check: **exit 0**
- Proteksi: **TIDAK** (bukan endpoint data; hanya index/info endpoint).
- Temuan: CORS `*` dan info daftar endpoint publik. Tidak menyentuh data.
- Secret literal: tidak ada.
- Rekomendasi: rate-limit ringan dan hapus/lockdown CORS `*` (boleh tiru pola proteksi master pada endpoint data).

## api/admin/claims/index.js
- node --check: **exit 0**
- Proteksi: **TIDAK** → **KRITIS**
- Temuan: `?id=` dan query `status/site/search/page/limit` dieksekusi langsung tanpa verifikasi cookie; seluruh data klaim (database Supabase) bocor ke publik. CORS `*`.
- Secret literal: tidak ada.
- Rekomendasi: verifikasi cookie `adm_session` (verifySession + isEmailAllowed master) sebelum eksekusi query, lalu bungkus rate-limit.

## api/admin/logs/index.js
- node --check: **exit 0**
- Proteksi: **TIDAK** → **KRITIS**
- Temuan: GET bocorkan log; `DELETE` (`sb.from('logs').delete().neq('id',0)`) memusnahkan SEMUA log secara publik tanpa otentikasi. CORS `*`.
- Secret literal: tidak ada.
- Rekomendasi: verifikasi cookie `adm_session` + isEmailAllowed master untuk GET dan DELETE, bungkus rate-limit ketat pada DELETE.

## api/admin/stats/index.js
- node --check: **exit 0**
- Proteksi: **TIDAK** → **KRITIS**
- Temuan: `getStats()` dieksekusi tanpa verifikasi; statistik internal (Supabase) bocor ke publik. CORS `*`.
- Secret literal: tidak ada.
- Rekomendasi: verifikasi cookie `adm_session` + isEmailAllowed master sebelum menjalankan getStats, lalu bungkus rate-limit.

---

## Prioritasi perbaikan
1. `api/admin/logs/index.js` — paling kritis (jalan `DELETE` publik).
2. `api/admin/claims/index.js` — eksposur data klaim.
3. `api/admin/stats/index.js` — eksposur statistik.
4. `api/admin/index.js` — rendah (kosmetik CORS `*`).

Contoh pola proteksi (dari `lib/auth-handler.js`):
```js
const { parseCookies, verifySession, isEmailAllowed } = require('../../../lib/auth-handler');
const cookies = parseCookies(req);
const payload = verifySession(cookies.adm_session);
if (!payload || !(await isEmailAllowed(payload.email))) {
  return res.status(401).json({ ok: false, message: 'Unauthorized' });
}
```