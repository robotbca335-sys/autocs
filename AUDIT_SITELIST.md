# AUDIT SITELIST

Tanggal: 2026-09-16
Cakupan: `api/sitelist/index.js`, `lib/supabase.js`, validasi scatter & prize, flow verifikasi.
Catatan: hanya audit/baca. Tidak ada perubahan code.

## 1. Sumber situs list (`api/sitelist/index.js`)

- Sumber utama: **Supabase** — tabel `sites`, via `fetchSites()` di `lib/supabase.js:20-28`.
  - Query: `.select('*').eq('active', true).order('label')`.
  - Mapping response: `site_id: s.site_id || s.id`, `label: s.label || s.name` (`api/sitelist/index.js:14`).
- **TIDAK hardcoded array** dalam kondisi normal. Satu-satunya array hardcoded adalah fallback error (lihat poin 4).
- Tidak ada `api/sites/` (tidak ada direktori tsb di repo; hanya `api/sitelist/`).

## 2. Sumber angka scatter 3/4/5 & pembeda 4 vs 5

Scatter 3/4/5 **bukan dari sitelist/Supabase `sites`**. Sumbernya tersebar:

- **Input klaim (frontend)**: `index.html:67-70` — tombol `#scSel` data-v="3|4|5"; default `selectedScatter = 3` di `js/claim.js:5`.
- **Validasi server**: `services/bet-verify.js:18` — `if (![3,4,5].includes(sc))` → hanya 3/4/5 yang diterima.
- **Tabel hadiah (hardcoded)**: `services/scatter-rules.js` — `DEFAULT_SCATTER_RULES` tier by bet, prizes `{3,4,5}`. 4 dan 5 dibedakan (`4: 200000`, `5: 400000` dst). `calcHadiahAUTO_RELAX` untuk mode AUTO RELAX (threshold kontinu).
- **Pembeda 4 vs 5 pada verifikasi**: `services/klaim-analyzer.js:103-108` (`analyzeClaim`) membandingkan **ekstrak aktual vs klaim secara eksak**: `checks.validScatter = [3,4,5].includes(actual.scatter)`; jika valid, `matchScatter = actual.scatter === expected.scatter`. Jadi 4 vs 5 **dibedakan** — mismatch jika tidak sama persis.
- **Ekstraksi scatter dari data sekunder**:
  - `services/klaim-analyzer.js:46-59` (`extractActual`): dari field `scatter/nScatter/scatterCount/cntScatter/jmlScatter`, atau pola `gd` (`st === 4` && `nst === 21` = pemicu scatter), mengambil jumlah elemen gd sbg jumlah scatter.
  - `lib/admin-api.js:65-124` (`extractScatterFromPgData`): consensus 3 sumber — FreeSpin (`st===4,nst===21,sc>0`), max scatter di `bd` (`st<21`), trigger spin (`st<4,nst>=4,sc>=3`); hasil dipaksa `valid(v): 3..5` (`:111`).
- **Tampilan jumlah scatter di klaim** (`js/master.js`): tabel `x${r.scatter}` (`:201`), detail "Scatter (klaim)" vs "Scatter (aktual)" (`:245-246`) → 4 dan 5 tampil apa adanya.

## 3. Logika free-spin — ADA

- `lib/admin-api.js:69-88`: **FreeSpin** dideteksi dari `gd.st === 4 && gd.nst === 21 && gd.sc > 0`.
  - Jika `sc >= 5`: cari max `sc` pada spin lanjutan (st antara 4..21) → `freeSpinSc` dijadikan max.
  - Jika `sc < 5`: pakai `Number(gd.sc)`.
- Hasil free-spin dipadukan via consensus dgn max-scatter & trigger-spin (`:110-124`) → nilai akhir scatter 3..5 untuk verifikasi.
- Verifikasi free-spin → status `SESUAI` bila semua field cocok (`services/klaim-analyzer.js:115-120`); pipeline `services/pipeline.js` AUTO memakai `extractScatterFromPgData`/`extractActual`, MANUAL memakai input admin.

## 4. Behavior bila Supabase kosong / gagal + secret

- `lib/supabase.js:10-12`: client dibuat sekali (singleton); **melempar error** jika `SUPABASE_URL` dan `SUPABASE_KEY` (SERVICE **atau** ANON) tak diset.
- `api/sitelist/index.js:16-21`: **fallback error** → `res.status(200).json({ ok:true, sites:[{ site_id:'bandar80', label:'BANDAR80' }] })`. Tepat satu situs hardcoded.
- Data `sites` kosong (query sukses tapi `data=[]`): `fetchSites` mengembalikan `[]` → sitelist akan return `sites: []`; frontend (`js/claim.js:31-33`) menampilkan "Belum ada situs" & mematikan dropdown.
- **Secret**: hanya via env Vercel — `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (prioritas), `SUPABASE_ANON_KEY`. Tidak ada key hardcoded. Secret juga dipakai titik lain: `SITE_URL`, `BET_MIN/BET_MAX`, token admin/history di `settings` table (`history.token`, `loadStoredHeaders`).

## 5. node --check

`node --check api/sitelist/index.js` → **exit 0** (valid syntax).

## Temuan & Rekomendasi

1. **`site_id` vs `id` di sitelist**: mapping `site_id || id` bisa menghasilkan key berbeda antar-row bila tabel `sites` tidak konsisten (sebagian pakai `site_id`, sebagian `id`). → Sarankan normalisasi kolom (pakai satu kolom `site_id`) di tabel `sites`; dokumentasikan migrasi di Supabase.
2. **Fallback diam-diam sukses**: saat error Supabase, endpoint tetap `200 + ok:true` dengan situs BANDAR80 — klien tak tahu list "palsu". Data clutchers bisa terkirim dengan situs yang tak aktif. → Opsi: tambah flag `fallback:true` di response, atau `503` saja.
3. **Scatter 4 vs 5 sudah dibedakan** di validasi & prize; pastikan ekstraktor `extractScatterFromPgData` konsisten dengan pola `extractActual` (dua implementasi parsing `gd` terpisah — rawan drift). → Sarankan satukan ekstraksi `gd` jadi satu helper di `services/`.
4. **Free-spin sudah ada** (st===4, nst===21, sc>0). Tidak ada flag jenis trigger (free-spin vs trigger biasa) yang disimpan di `claims` — hanya hasil angka scatter. → Opsi: simpan kolom `scatter_source`/`trigger_type` utk audit & anti-fraud.
5. **Prize hardcoded** di `scatter-rules.js` (bukan dari `settings`). Bila promosi berubah tanpa deploy, hadiah ikut berubah. → Opsi: pindahkan `DEFAULT_SCATTER_RULES` ke tabel `settings` (sudah ada helper `getSetting`).
6. **Secret**: aman via env; pastikan `SUPABASE_SERVICE_KEY` akses didikontrol di Supabase (service key RBAC terbatas), karena dipakai server-side hanya.