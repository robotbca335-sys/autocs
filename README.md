# SCATTER CLAIM SYSTEM 🌟

Sistem web lengkap pengganti 2 extension Chrome, bekerja **tanpa extension**.

## 🎯 Dua App dalam Satu Project

| App | URL | Fungsi |
|-----|-----|--------|
| **Web Claim User** | `/` | Form klaim bonus scatter (seperti autoscater1.vercel.app): pilih situs, user ID, kode tiket, nominal bet, jumlah scatter (x3/x4/x5), lacak status klaim |
| **Web Master (Admin)** | `/master` | Dashboard manajemen semua logika: kelola claims, auto-processing, verifikasi bet, monitor live, log aktivitas, settings |

## 🧠 Logika Sistem

### Status Alur Klaim
```
PENDING → VERIFYING → SESUAI (masuk)
  ↓            ↓
  ERROR    TIDAK_SESUAI (ditolak)
```

### Validasi
- Bet minimal **Rp 1.600**, maksimal **Rp 10.000.000**
- Limit klaim **2× per hari per user ID** — sesi claim per ID otomatis reset setiap ganti hari (00.00 WIB)
- **Kode tiket UNIQUE** — kode tiket yang sudah pernah diklaim (oleh siapa pun) tidak bisa diinput lagi
- Kode tiket valid: dimulai digit `2`, >= 15 digit, bukan semua digit sama
- Honeypot anti-bot (`website` + `company`)
- Rate limit submit 1,2 detik

> ⚠️ **Penting:** jalankan `database.sql` dengan statement `create unique index idx_claims_tiket_unique` agar pembatasan kode tiket ganda juga dijaga di level database (anti race condition / submit dobel bersamaan).

### Anti-Tabrakan
Web Claim = **input saja**. Web Master = **proses saja**. Satu database (Supabase) = satu source of truth → tidak saling tabrak antar context (mirip `writeRowsMerged` di extension).

## 📁 Struktur

```
web-scatter/
├── index.html              # Web Claim User (root)
├── js/claim.js             # Logika claim user
├── css/shared.css          # Tema bersama (dark gold)
├── master/index.html       # Web Master Admin (/master)
├── js/master.js            # Logika dashboard admin
├── api/                    # Vercel serverless functions
│   ├── sitelist/           # GET  /api/sitelist
│   ├── submit/             # POST /api/submit
│   ├── track/              # GET  /api/track?user_id=...
│   ├── manage/             # POST /api/manage (ubah status)
│   ├── process/            # POST /api/process (auto/verify)
│   └── admin/
│       ├── stats/          # GET  /api/admin/stats
│       ├── claims/         # GET  /api/admin/claims
│       └── logs/           # GET|DELETE /api/admin/logs
├── lib/supabase.js         # Client Supabase
├── services/               # bet-verify, ocr-processor, alert
└── database.sql            # Schema Supabase (run dulu!)
```

## 🚀 Cara Deploy

### 1. Setup Database (Supabase)
1. Buat project di https://supabase.com
2. Buka **SQL Editor** → paste isi `database.sql` → Run
3. Salin `Project URL` + `anon key`

### 2. Env Vars
Buat `.env.local` (atau set di Vercel dashboard):
```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
CLAIM_DAILY_LIMIT=2
BET_MIN=1600
BET_MAX=10000000
```

### 3. Deploy
```bash
npm install -g vercel
vercel                    # preview
vercel --prod             # production
```

## 🔌 API Reference

- `GET /api/sitelist` → `{ ok, sites: [{site_id, label}] }`
- `POST /api/submit` → body `{ site, user_id, kode_tiket, betting, scatter, website, company }`
- `GET /api/track?user_id=X` → `{ ok, rows, used, max }`
- `POST /api/manage` → body `{ id, status }`
- `POST /api/process` → body `{ action: 'next' | 'all' | 'verify' }`
- `GET /api/admin/stats` → `{ ok, stats: { total, pending, approved, rejected, today } }`
- `GET /api/admin/claims?status=&search=&page=&limit=` → `{ ok, rows, total }`
- `GET /api/admin/logs` → `{ ok, logs }`

## ✨ Fitur Web Claim User
- Desain luxury dark+gold responsif (mirip reference site)
- Pilih situs dari database
- Formatter Rupiah otomatis di input bet
- Pilih scatter x3/x4/x5
- Limit harian 2× otomatis
- Lacak status klaim per user ID (ANTRI / MEMERIKSA / SESUAI / MASUK / GAGAL / ERROR)

## 🛠 Fitur Web Master
- **Dashboard**: 5 statistik dengan animasi counter + recent claims
- **Claims**: tabel lengkap, search, filter status/site, bulk approve/reject, pagination, view detail, export CSV
- **Process**: toggle auto processing, proses berikutnya / semua
- **Verify**: verifikasi manual kode tiket
- **Monitor**: feed live polling claims pending
- **Logs**: lihat + hapus log aktivitas
- **Settings**: limit harian, min/max bet, interval proses, admin password (localStorage)