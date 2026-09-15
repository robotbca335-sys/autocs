# AUDIT_MASTER_UI.md — Audit Lengkap Master Dashboard

**Tanggal audit:** 2026-09-16  
**File yang diudit:** `master/index.html`, `js/master.js`, `css/shared.css`, `js/shared.js`  
**Status node --check:** A14 node --check: 0 (berhasil, tanpa error)

---

## 1. Pemetaan Fungsi → URL yang Dipanggil

| Fungsi JS | Aksi | Endpoint | Method |
|---|---|---|---|
| `loadDashboard()` | Load stats | `/api/admin/stats` | GET |
| `loadRecentClaims()` | Load recent claims | `/api/admin/claims?limit=10` | GET |
| `loadClaims()` | Load claims (paginated) | `/api/admin/claims?page=&limit=&search=&status=&site=` | GET |
| `viewClaim(id)` | View single claim | `/api/admin/claims?id=` | GET |
| `updateClaimStatus(id, status)` | Approve/reject | `/api/manage` | POST `{id, status}` |
| `bulkAction(status)` | Bulk approve/reject | `/api/manage` | POST `{id, status}` |
| `processNext()` | Process next claim | `/api/process` | POST `{action:'next'}` |
| `processAll()` | Process all pending | `/api/process` | POST `{action:'all'}` |
| `verifyBet()` | Verify ticket | `/api/process` | POST `{action:'verify', kode_tiket}` |
| `loadSitesForFilter()` | Load site list | `/api/sitelist` | GET |
| `loadPipelineStatus()` | Load settings + stats | `/api/settings` + `/api/auto` | GET + POST `{action:'status'}` |
| `setAutoMode(enabled)` | Toggle auto-mode | `/api/settings` | POST `{key:'auto', value:{enabled, interval}}` |
| `saveHistoryConfig()` | Save history API config | `/api/settings` | POST `{key:'history', value:{...}}` |
| `clearHistoryToken()` | Clear saved token | `/api/settings` | POST `{key:'history', value:{token:'CLEAR'}}` |
| `saveAdminConfig()` | Save admin panel config | `/api/settings` | POST `{key:'admin', value:{...}}` |
| `loadAdminConfig()` | Load admin config | `/api/settings` | GET |
| `manualCheck()` | Manual ticket check | `/api/process` | POST `{action:'check', kode_tiket, bet_actual, ...}` |
| `bonusSubmit()` | Submit bonus via Puppeteer | `/api/process` | POST `{action:'bonus_submit', ...}` |
| `bonusStatus()` | Check bonus status | `/api/process` | POST `{action:'bonus_status', ...}` |
| `testPuppeteer()` | Test browser | `/api/process` | POST `{action:'test_puppeteer', chromePath}` |
| `tickPipeline()` | Manual tick | `/api/auto` | POST `{action:'tick'}` |
| `runPipelineAll()` | Run all pipeline | `/api/process` | POST `{action:'all'}` |
| `pollMonitor()` | Monitor pending claims | `/api/admin/claims?status=PENDING&limit=5` | GET |
| `loadLogs()` | Load activity logs | `/api/admin/logs` | GET |
| Clear Logs btn | Clear all logs | `/api/admin/logs` | DELETE |
| `loadSettings()` | Load settings | `/api/settings` | GET |
| `saveSettings()` | Save limits | `/api/settings` | POST `{key:'limits', value:{...}}` |
| **`loadAccountInfo()`** | **Check login** | **`/api/auth?action=me`** | **GET** |
| **`googleLogin()`** | **Initiate Google login** | **`/api/auth?action=login`** | **GET → redirect `data.url`** |
| **`googleLogout()`** | **Logout** | **`/api/auth?action=logout`** | **GET** |

---

## 2. Login Admin — Bagaimana Direncanakan Sekarang

### Flow Google OAuth

1. **Tombol "Login dengan Google"** (`btnGoogleLogin`) di tab Settings (`master/index.html:1310`)
2. Klik → memanggil **`googleLogin()`** (`master.js:704-710`)
3. Fetch: `GET /api/auth?action=login`
4. Server mengembalikan `data.url` → browser redirect ke URL tersebut (Google OAuth consent screen)
5. Setelah callback, **`loadAccountInfo()`** dipanggil saat init (`master.js:482`)
6. Fetch: `GET /api/auth?action=me` → cek `data.email`
7. Jika login: badge berubah jadi `"Login: {email}"`, tombol Logout muncul
8. Jika tidak: badge `"Belum login"`, tombol Logout tersembunyi

### Tombol Logout
- **`btnGoogleLogout`** → memanggil `googleLogout()` (`master.js:713-718`)
- Fetch: `GET /api/auth?action=logout`
- Setelah itu `loadAccountInfo()` dipanggil ulang

### Catatan Penting
- **`loadAccountInfo()` dipanggil otomatis saat halaman load** (via `initPipelineTab` → `loadAccountInfo()`)
- UI menggunakan **query parameter style** `/api/auth?action=login|me|logout` — BUKAN path-style `/api/auth/login`
- `js/shared.js` **tidak ditemukan di disk** (file referenced di HTML tapi missing) — akan menghasilkan 404 di browser console

---

## 3. Temuan Keamanan

### KRITIS

#### 3.1 XSS via `onclick` Inline di Template Literals
**Lokasi:** `master.js:205-207` (renderClaimsTable), `master.js:257-258` (viewClaim)

```js
// renderClaimsTable — line 205-207:
onclick="viewClaim('${r.id}')"
onclick="updateClaimStatus('${r.id}','SESUAI')"
onclick="updateClaimStatus('${r.id}','TIDAK_SESUAI')"

// viewClaim modal footer — line 257-258:
onclick="updateClaimStatus('${r.id}','SESUAI');closeModal()"
onclick="updateClaimStatus('${r.id}','TIDAK_SESUAI');closeModal()"
```

**Masalah:** Nilai `r.id` dimasukkan **tanpa escape** ke dalam string onclick. Jika `r.id` mengandung `'` (single quote), attacker bisa membobol string dan menjalankan arbitrary JS:
```
r.id = "'; alert('XSS'); //"
→ onclick="viewClaim(''); alert('XSS'); //')"
```
**Severity:** KRITIS — full XSS, bisa curi session/cookie admin.

**Rekomendasi:** Gunakan event delegation atau escape value:
```js
function escAttr(s) { return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
// Lalu: onclick="viewClaim('${escAttr(r.id)}')"
```
ATAU lebih baik, hapus `onclick` dari HTML template, gunakan `data-id` + event delegation.

#### 3.2 `shared.js` Missing → 404 Error
**Lokasi:** `master/index.html:1357` → `<script src="/js/shared.js">`

File `js/shared.js` **tidak ditemukan di disk**. Ini menyebabkan:
- Browser console error
- Fungsi yang diharapkan dari shared.js (jika ada) tidak akan tersedia
- Kemungkinan runtime error jika ada dependensi

### MODERATE

#### 3.3 Tidak Ada Autentikasi yang Konsisten
Semua endpoint `/api/admin/*`, `/api/manage`, `/api/process`, `/api/settings`, `/api/auto` dipanggil **tanpa token/header autentikasi** di request fetch. Mekanisme autentikasi sepenuhnya bergantung pada cookie (jika ada). Jika `/api/auth` belum implementasi session cookie yang benar, semua endpoint ini **terbuka**.

#### 3.4 Admin Credentials Disimpan via POST Tanpa Enkripsi di Sisi Klien
Input berikut dikirim sebagai JSON polos ke `/api/settings`:
- `plAccessToken` (X-Access-Token) — `master.js:602`
- `plHistoryToken` — `master.js:608`
- `plAdminPass` (Admin Password di Settings) — `master.js:901-913`

Server-side encryption disebutkan di placeholder (`"tersimpan terenkripsi di DB"`), tapi **sisi klien mengirim plaintext**. Jika transport tidak HTTPS atau server tidak encrypt, ini berisiko.

#### 3.5 No Content Security Policy (CSP)
Tidak ada header CSP di HTML maupun meta tag. Memungkinkan inline script execution dan eksternal script injection.

#### 3.6 Inline `style` dengan Path Lokal
**Lokasi:** `master/index.html:1102`
```html
value="C:\Program Files\Google\Chrome\Application\chrome.exe"
```
Hardcoded local file path di HTML — minor info leak (menunjukkan OS structure).

### RENDAH

#### 3.7 `showModal()` Menggunakan `innerHTML` dengan Data dari Server
**Lokasi:** `master.js:939-943`
```js
$('modalBody').innerHTML = body;
$('modalFooter').innerHTML = footer || ...;
```
Di `viewClaim()` (`master.js:238-259`), body mengandung data dari server yang **sebagian tidak di-escape**:
```js
${r.betting_actual != null ? 'Rp ' + Number(r.betting_actual).toLocaleString('id-ID') : '-'}
```
Karena `Number()` dan `toLocaleString()` hanya menerima angka, ini aman secara praktis, tapi pattern-nya berisiko.

#### 3.8 No `eval()` atau `innerHTML` dari Input User Langsung
**Tidak ditemukan.** Semua input user hanya dikirim via `fetch()` ke server. Fungsi `esc()` (`master.js:962`) digunakan secara konsisten untuk rendering data dari server ke HTML.

---

## 4. Fungsi Pendukung

| Fungsi | Lokasi | Deskripsi |
|---|---|---|
| `esc(s)` | `master.js:962` | HTML entity escape (`& < > " '`) |
| `fmtTime(ts)` | `master.js:963` | Format timestamp ke locale |
| `getStatusClass(s)` | `master.js:964` | Map status → CSS class |
| `debounce(fn, ms)` | `master.js:965` | Debounce utility |
| `showModal(title, body, footer)` | `master.js:939` | Tampilkan modal |
| `closeModal()` | `master.js:946` | Tutup modal |
| `showToast(msg, type)` | `master.js:952` | Tampilkan toast notification |
| `addProcessLog(msg, type)` | `master.js:413` | Tambah log ke process tab |
| `addPipelineLog(msg, type)` | `master.js:785` | Tambah log ke pipeline tab |

---

## 5. Rekomendasi Langkah Wiring ke Endpoint Auth Baru

### Langkah 1: Buat `js/shared.js`
File ini direferensikan di HTML tapi tidak ada. Buat file ini berisi fungsi-fungsi yang mungkin diperlukan bersama (atau kosongkan dulu agar tidak 404).

### Langkah 2: Implementasi Session Auth di Server
Pastikan `/api/auth?action=login` mengembalikan URL OAuth yang benar, dan setelah callback:
- Set HTTP cookie (HttpOnly, Secure, SameSite=Lax/Strict) untuk session
- `/api/auth?action=me` harus cek cookie tersebut
- Semua endpoint `/api/admin/*`, `/api/manage`, `/api/process`, `/api/settings`, `/api/auto` harus **reject jika tidak ada session valid**

### Langkah 3: Fix XSS — Hapus Inline `onclick`
Ganti seluruh `onclick` di template dengan event delegation:
```js
// Di initClaimsTab():
$('claimsTableBody').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if (action === 'view') viewClaim(id);
  else if (action === 'approve') updateClaimStatus(id, 'SESUAI');
  else if (action === 'reject') updateClaimStatus(id, 'TIDAK_SESUAI');
});
```
Template render:
```js
<button class="btn-xs" data-action="view" data-id="${esc(r.id)}">View</button>
```

### Langkah 4: Tambah CSP Meta Tag
Di `<head>` `master/index.html`:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self';">
```
Catatan: `'unsafe-inline'` untuk style karena master/index.html menggunakan inline `<style>`.

### Langkah 5: Amankan Settings Storage
- Jangan simpan token di `localStorage` di sisi klien
- Endpoint `/api/settings` POST harus **hanya menerima dari user yang terautentikasi**
- Pertimbangkan validasi role admin sebelum accept config change

---

## 6. Ringkasan Risiko

| # | Temuan | Severity | Status |
|---|---|---|---|
| 1 | XSS via inline `onclick` dengan unescaped ID | KRITIS | Perlu fix |
| 2 | `js/shared.js` missing → 404 | MODERATE | Perlu buat |
| 3 | Tidak ada konsisten auth di semua admin endpoint | MODERATE | Perlu implementasi |
| 4 | Credentials dikirim plaintext ke server | MODERATE | Pastikan HTTPS |
| 5 | Tidak ada CSP header | MODERATE | Perlu tambah |
| 6 | Hardcoded local path di HTML | RENDAH | Minor |
| 7 | `showModal` innerHTML pattern | RENDAH | Perhatikan |
