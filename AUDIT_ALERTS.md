# AUDIT — services/ (non-pipeline, non-puppeteer-scrape)

> Tanggal: 2026-09-16
> Scope: `services/alert.js`, `bet-verify.js`, `klaim-analyzer.js`, `ocr-processor.js`, `scatter-rules.js`

---

## A15 node --check: SEMUA PASS (exit 0)

| File | Exit Code |
|---|---|
| `services/alert.js` | 0 |
| `services/bet-verify.js` | 0 |
| `services/klaim-analyzer.js` | 0 |
| `services/ocr-processor.js` | 0 |
| `services/scatter-rules.js` | 0 |

---

## Per-File Audit

### `services/alert.js` (60 baris)

| Aspek | Detail |
|---|---|
| **Fungsi utama** | `sendAlert()` — format + `console.log`; `sendDiscordWebhook(webhookUrl, embed)` — POST embed ke Discord webhook via global `fetch`; `createDiscordEmbed()` — bangun embed object; `formatAlertMessage()` — switch-case text. |
| **Fetch ke URL eksternal?** | Ya — `fetch(webhookUrl, …)` di baris 31. **Parameter `webhookUrl` di-pass dari caller; tidak ada URL hardcode di file ini.** |
| **Token hardcode?** | **Tidak ditemukan.** |
| **WebSocket / polling?** | Tidak ada. |
| **Catatan** | Global `fetch` tersedia di Node 18+ (runtime Vercel). Tidak ada try/catch untuk status code; hanya catch error network. |

---

### `services/bet-verify.js` (51 baris)

| Aspek | Detail |
|---|---|
| **Fungsi utama** | Validasi input claim (`validateClaimInput`), deteksi kode duplikat/repetisi (`isDuplicateCode`, `hasExcessiveRepeat`), kalkulasi bonus, formatting. |
| **Fetch ke URL eksternal?** | **Tidak ada.** |
| **Token hardcode?** | **Tidak ada.** |
| **WebSocket / polling?** | Tidak ada. |
| **Catatan** | Pure logic. Config `BET_MIN`/`BET_MAX` dari `process.env`. |

---

### `services/klaim-analyzer.js` (134 baris)

| Aspek | Detail |
|---|---|
| **Fungsi utama** | Decision engine: `analyzeClaim(claim, actual)` membandingkan expected (dari scatter-rules) vs actual (dari history). `extractActual()` normalisasi berbagai key-field dari record history. |
| **Fetch ke URL eksternal?** | **Tidak ada sendiri** — data `actual` di-pass dari caller (pipeline). |
| **Token hardcode?** | **Tidak ada.** (String `NO_TOKEN` di `REJECT_REASONS` hanya label.) |
| **WebSocket / polling?** | Tidak ada. |
| **Catatan** | Depends on `./scatter-rules`. Relies on pipeline untuk fetch data history; file ini sendiri murni perbandingan data. |

---

### `services/ocr-processor.js` (37 baris)

| Aspek | Detail |
|---|---|
| **Fungsi utama** | Ekstraksi kode tiket dari teks OCR: `extractTicketCode()`, `extractAllCodes()`, validasi kode (`validateCode`), bersihkan non-digit (`cleanKode`). |
| **Fetch ke URL eksternal?** | **Tidak ada.** |
| **Token hardcode?** | **Tidak ada.** |
| **WebSocket / polling?** | Tidak ada. |
| **Catatan** | Pure regex/string logic. Pola: kode dimulai `2`, length 15-25, minimum 17 untuk valid. |

---

### `services/scatter-rules.js` (50 baris)

| Aspek | Detail |
|---|---|
| **Fungsi utama** | Tabel hadiah scatter: `DEFAULT_SCATTER_RULES` (tier bet → prizes 3/4/5 scatter), `calcHadiahAUTO_RELAX()` (continuous threshold), `getScatterPrizes()`, `expectedHadiah()`. |
| **Fetch ke URL eksternal?** | **Tidak ada.** |
| **Token hardcode?** | **Tidak ada.** |
| **WebSocket / polling?** | Tidak ada. |
| **Catatan** | Pure lookup/math. Minimum bet Rp 1.600, maximum Rp 10.000.000. |

---

## Ringkasan Temuan

| Temuan | Kategori | Status |
|---|---|---|
| Hardcoded token/API key | Secrets | **TIDAK ADA** di kelima file |
| Fetch ke URL obrolan/Telegram | External comms | **TIDAK ADA** |
| Discord webhook | External comms | Ada di `alert.js` — URL di-pass sebagai parameter, **tidak hardcode** |
| WebSocket | Real-time | **TIDAK ADA** |
| Polling (setInterval/request loop) | Real-time | **TIDAK ADA** |
| External URL hardcode | SSRF surface | **TIDAK ADA** di 5 file ini |

### Catatan lintas-file

- `alert.js:31` — `fetch(webhookUrl)` menerima URL dari caller. Panggilan `sendDiscordWebhook` harus dicek di caller (kemungkinan `pipeline.js` atau `lib/admin-api.js`) untuk memastikan `webhookUrl` tidak bisa dimanipulasi attacker (potensi SSRF via webhook).
- `klaim-analyzer.js` mengandalkan pipeline untuk data `actual` — tidak ada fetch sendiri.
- `ocr-processor.js` dan `scatter-rules.js` murni komputasi lokal tanpa side-effect apapun.
