// ============================================================
// KLAIM ANALYZER - decision engine AUTO SCATER FULL HD
// Membandingkan expected (bet, scatter, hadiah) vs actual
// dari data history. Guard utama: scatter harus 3-5.
// ============================================================

const { expectedHadiah, calcHadiahAUTO_RELAX, getScatterPrizes } = require('./scatter-rules');

const REJECT_REASONS = {
  NOT_FOUND:        'Ticket tidak ditemukan di history',
  NO_TOKEN:         'Token API history belum diset',
  FETCH_FAIL:       'Gagal mengambil data history',
  BET_MISMATCH:     'Bet tidak sesuai',
  SCATTER_MISMATCH: 'Scatter tidak sesuai',
  SCATTER_INVALID:  'Scatter tidak valid (harus 3-5)',
  PRIZE_MISMATCH:   'Hadiah tidak sesuai',
  INVALID_OPERATOR_SESSION: 'Sesi operator tidak valid',
  TIMEOUT:          'Timeout verifikasi',
  MANUAL_CONFIRM:   'Menunggu konfirmasi manual'
};

// Normalisasi extract data history -> { bet, scatter, hadiah, raw }
function extractActual(record, opts = {}) {
  const scrub = (v) => {
    if (v === undefined || v === null) return null;
    const n = Number(String(v).replace(/[^\d.-]/g, ''));
    return isNaN(n) ? null : n;
  };

  const betKeys = ['betting', 'bet', 'debet', 'betAmount', 'bet_money', 'betMoney', 'amount', 'hbet'];
  const payoutKeys = ['payout', 'hadiah', 'win', 'prize', 'winAmount', 'hasil', 'menang'];
  const scatterKeys = ['scatter', 'nScatter', 'scatterCount', 'cntScatter', 'jmlScatter'];

  let bet = null;
  for (const k of betKeys) {
    const v = scrub(record[k]);
    if (v !== null) { bet = v; break; }
  }

  let hadiah = null;
  for (const k of payoutKeys) {
    const v = scrub(record[k]);
    if (v !== null) { hadiah = v; break; }
  }

  let scatter = null;
  for (const k of scatterKeys) {
    const v = scrub(record[k]);
    if (v !== null && v > 0) { scatter = v; break; }
  }

  // Penalaran dari gd array (pola extension): st===4 && nst===21 = pemicu scatter
  if (scatter === null && Array.isArray(record.gd)) {
    const gds = record.gd.filter(g => g && (g.st === 4 || g.st === '4'));
    if (gds.length) {
      const withNs = gds.filter(g => (g.nst === 21 || g.nst === '21'));
      scatter = (withNs.length || gds.length);
    }
  }

  // Bet tidak diketahui tapi ada gd scatter & payout -> coba infer dari label/nominal gd
  if (bet === null && Array.isArray(record.gd)) {
    for (const g of record.gd) {
      if (g && g.bet !== undefined && g.bet !== null) { bet = scrub(g.bet); break; }
    }
  }

  return { bet, scatter, hadiah, raw: record };
}

// Ekspektasi hadiah (pakai FULL HD rules, dengan throwback AUTO RELAX untuk bet di celah)
function buildExpected(claim) {
  const prizes = getScatterPrizes(claim.betting);
  return {
    bet: claim.betting || 0,
    scatter: claim.scatter || 0,
    hadiah: prizes ? prizes[claim.scatter] : 0
  };
}

function buildRejectReason(mismatches) {
  if (mismatches.bet) return REJECT_REASONS.BET_MISMATCH;
  if (mismatches.scatterInvalid) return REJECT_REASONS.SCATTER_INVALID;
  if (mismatches.scatter) return REJECT_REASONS.SCATTER_MISMATCH;
  if (mismatches.hadiah) return REJECT_REASONS.PRIZE_MISMATCH;
  return 'Tidak sesuai';
}

// Analisis utama. Return { ok, status, reason, expected, actual, mismatches, checks }
function analyzeClaim(claim, actual) {
  const expected = buildExpected(claim);

  const mismatches = { bet: false, scatter: false, scatterInvalid: false, hadiah: false };
  const checks = {};

  checks.actualBet = actual.bet;
  checks.expectedBet = expected.bet;
  checks.matchBet = actual.bet !== null && actual.bet === expected.bet;
  if (actual.bet !== null && !checks.matchBet) mismatches.bet = true;

  checks.actualScatter = actual.scatter;
  checks.expectedScatter = expected.scatter;
  checks.validScatter = [3, 4, 5].includes(actual.scatter);
  if (!checks.validScatter) mismatches.scatterInvalid = true;
  else {
    checks.matchScatter = actual.scatter === expected.scatter;
    if (!checks.matchScatter) mismatches.scatter = true;
  }

  checks.expectedHadiah = expected.hadiah;
  checks.actualHadiah = actual.hadiah;
  checks.matchHadiah = actual.hadiah !== null && actual.hadiah === expected.hadiah;
  if (actual.hadiah !== null && !checks.matchHadiah) mismatches.hadiah = true;

  const matched = !mismatches.bet && !mismatches.scatterInvalid && !mismatches.scatter && !mismatches.hadiah;

  return {
    ok: matched,
    status: matched ? 'SESUAI' : 'TIDAK_SESUAI',
    reason: matched ? null : buildRejectReason(mismatches),
    expected,
    actual: { ...actual },
    mismatches,
    checks,
    autoRelaxHadiah: calcHadiahAUTO_RELAX(actual.bet || claim.betting || 0, actual.scatter || claim.scatter || 0)
  };
}

module.exports = {
  REJECT_REASONS,
  extractActual,
  buildExpected,
  analyzeClaim
};