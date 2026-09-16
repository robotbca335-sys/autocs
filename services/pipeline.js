// ============================================================
// PIPELINE - orkestrasi verifikasi claim (FULL VERSION)
// mode AUTO    : admin-api (bet) + history-api (scatter) → analyzer
// mode MANUAL  : data actual (bet/scatter/hadiah) diinput admin
// mode BONUS   : submit ke bonussmb.com via Puppeteer + cek status
// Terapkan 2x-check: gagal pertama -> cek ulang sekali
// ============================================================

const { fetchBetData, extractScatterFromPgData } = require('../lib/admin-api');
const { fetchBetHistory, extractScatter, loadStoredHeaders } = require('../lib/history-api');
const { getSetting } = require('../lib/supabase');
const { extractActual, analyzeClaim, REJECT_REASONS } = require('./klaim-analyzer');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Cari record yang cocok dengan kode tiket; fallback ke record terbaru
function findRecordForClaim(records, claim) {
  const code = String(claim.kode_tiket || '');
  const sig = code.replace(/\D/g, '');
  if (sig) {
    const hit = records.find(r => {
      const hay = JSON.stringify(r).replace(/\D/g, '');
      return hay.includes(sig);
    });
    if (hit) return hit;
  }
  return records[0] || null;
}

// --- MODE AUTO: admin-api (bet) + history-api (scatter) ---
async function verifyClaimAuto(claim) {
  const stored = await loadStoredHeaders();
  const histSettings = await getSetting('history') || {};
  const apiToken = histSettings.token || stored.historyToken;

  if (!stored.token && !apiToken) {
    return { ok: false, status: 'ERROR', code: 'NO_TOKEN', reason: 'Token admin/history belum ada', error: 'NO_TOKEN' };
  }

  let bet = null;
  let scatter = null;
  let usedSource = '';

  // Step 1: ambil bet dari admin-api
  if (stored.token && claim.user_id && claim.kode_tiket) {
    try {
      const betData = await fetchBetData({
        stored,
        userId: claim.user_id,
        transactionId: claim.kode_tiket,
        targetDate: claim.created_at ? claim.created_at.slice(0, 10) : undefined
      });
      bet = betData.bet;
      usedSource = 'admin-api';
    } catch (e) {
      if (String(e.message).includes('INVALID_OPERATOR_SESSION')) {
        return { ok: false, status: 'ERROR', code: 'INVALID_OPERATOR_SESSION', reason: 'Session admin expired', error: e.message };
      }
      // lanjut ke history-api
    }
  }

  // Step 2: ambil scatter dari history-api
  if (apiToken && claim.user_id && claim.kode_tiket) {
    try {
      const histRes = await fetchBetHistory({
        token: apiToken,
        host: histSettings.host || 'public-api.zmcyu9ypy.com',
        sid: claim.user_id,
        gid: histSettings.gameId || '65'
      });
      const recs = Array.isArray(histRes?.records) ? histRes.records : [];
      const matched = findRecordForClaim(recs, claim);
      if (matched) {
        scatter = extractScatter(matched);
        if (!bet) bet = Number(String(matched?.bet || matched?.betAmount || '').replace(/[^\d.-]/g, '')) || null;
        usedSource = usedSource ? `${usedSource}+history-api` : 'history-api';
      }
    } catch (e) {
      if (e.code === 'INVALID_OPERATOR_SESSION') {
        return { ok: false, status: 'ERROR', code: 'INVALID_OPERATOR_SESSION', reason: 'Session history expired', error: e.message };
      }
    }
  }

  if (!bet && !scatter) {
    return { ok: false, status: 'ERROR', code: 'DATA_NOT_FOUND', reason: 'Data bet/scatter tidak ditemukan', error: 'DATA_NOT_FOUND' };
  }

  // Build actual dari data yang berhasil diambil
  const actual = {
    bet: bet || null,
    scatter: scatter || null,
    hadiah: null,
    raw: { source: usedSource },
    manual: false
  };

  return { ...analyzeClaim(claim, actual), source: usedSource };
}

// --- MODE MANUAL: input actual dari admin ---
function verifyClaimManual(claim, actualInput) {
  const actual = {
    bet: actualInput.bet_actual != null ? Number(actualInput.bet_actual) : null,
    scatter: actualInput.scatter_actual != null ? Number(actualInput.scatter_actual) : null,
    hadiah: actualInput.hadiah_actual != null ? Number(actualInput.hadiah_actual) : null,
    raw: null,
    manual: true
  };
  return analyzeClaim(claim, actual);
}

// --- MODE BONUS: submit ke bonussmb.com via Puppeteer ---
async function submitBonusTicket(claim, opts = {}) {
  let puppeteer;
  try { puppeteer = require('./puppeteer-scrape'); } catch (_) { return { ok: false, message: 'Puppeteer tidak tersedia' }; }

  const settings = await getSetting('settings') || {};
  const executor = settings.executor || 'AUTO CS';

  const data = {
    situs: 'BANDAR80',
    tipe: 'SCATTER',
    userId: claim.user_id,
    kodeTiket: claim.kode_tiket,
    betting: claim.betting,
    scatter: claim.scatter,
    executor
  };

  const result = await puppeteer.submitBonus(data, {
    executablePath: opts.chromePath,
    headless: opts.headless !== false
  });

  return result;
}

// --- Cek status bonus di bonussmb.com/history via Puppeteer ---
async function checkBonusStatus(kodeTiket, opts = {}) {
  let puppeteer;
  try { puppeteer = require('./puppeteer-scrape'); } catch (_) { return { col9: '', col10: '', status: 'ERROR' }; }

  return puppeteer.checkBonusStatus(kodeTiket, {
    executablePath: opts.chromePath,
    headless: opts.headless !== false
  });
}

// --- Build fields update ke Supabase ---
function buildVerifyFields(claim, result, attempt = 1) {
  return {
    betting_actual: result.actual && result.actual.bet != null ? result.actual.bet : null,
    scatter_actual: result.actual && result.actual.scatter != null ? result.actual.scatter : null,
    hadiah_expected: result.expected ? result.expected.hadiah : null,
    hadiah_actual: result.actual && result.actual.hadiah != null ? result.actual.hadiah : null,
    payout: result.actual && result.actual.raw ? JSON.stringify(result.actual.raw).substring(0, 500) : '',
    reject_reason: result.reason || '',
    check_attempts: attempt,
    checked_at: new Date().toISOString()
  };
}

// --- PUSH keputusan ke bonussmb (REST, bukan klik DOM) ---
// SESUAI -> PUT /tiket-claim/:id status 'proccessing' (approve)
// TIDAK_SESUAI -> PUT /tiket-claim/:id status 'rejected' + alasan
// Non-blocking: hasil tidak menggagalkan alur utama bila fetch gagal.
async function pushDecisionToBonus(claim, status, reason) {
  try {
    const bonus = await getSetting('bonus');
    if (!bonus || bonus.autoDecision !== true) return { ok: false, code: 'DISABLED' };
    const api = require('../lib/bonussmb-api');
    const list = await api.fetchTickets({ limit: 300 });
    if (!list.ok) return list;
    const code = String(claim.kode_tiket || '').trim();
    const userId = String(claim.user_id || '').trim();
    const rows = list.rows || [];
    const hit = rows.find(r =>
      String(r.ticketCode || r.code || r.kode_tiket || r.ticket_code || '').trim() === code
    ) || rows.find(r =>
      String(r.historyCode || r.invoice || r.no || '').replace(/\D/g, '').includes(code.replace(/\D/g, ''))
    );
    if (!hit) return { ok: false, code: 'NOT_FOUND', message: 'Tiket tidak ketemu di bonussmb list' };
    const id = hit.id || hit._id;
    if (!id) return { ok: false, code: 'NO_ID', message: 'Tiket tanpa id' };
    const target = status === 'SESUAI' ? 'proccessing' : 'rejected';
    const r = await api.updateTicketStatus(id, { status: target, reason: status === 'SESUAI' ? '' : (reason || 'Data bet/scatter tidak sesuai') });
    return r;
  } catch (e) {
    return { ok: false, code: 'EXC', message: String(e.message || e) };
  }
}

module.exports = {
  verifyClaimAuto,
  verifyClaimManual,
  submitBonusTicket,
  checkBonusStatus,
  buildVerifyFields,
  findRecordForClaim,
  pushDecisionToBonus,
  sleep
};