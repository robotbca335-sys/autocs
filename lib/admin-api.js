// ============================================================
// ADMIN API CLIENT - REST API idrbo admin panel
// Dipetakan dari AUTO SCATER background.js klaimMainProcessor
// Headers: X-Access-Token, X-Agent-Pkid, X-Agent-Role, dll
// ============================================================

const DEFAULT_DOMAIN = 'ag-bandar80.idrbo2.com';

const IDRBO_HEADERS = [
  'x-access-token', 'x-agent-pkid', 'x-agent-role',
  'x-agent-suid', 'x-agent-user', 'x-agent-userid'
];

function buildHeaders(stored) {
  return {
    'X-Access-Token': stored.token || '',
    'X-Agent-Pkid': stored.pkid || '',
    'X-Agent-Role': stored.role || '',
    'X-Agent-Suid': stored.suid || '',
    'X-Agent-User': stored.userAgent || '',
    'X-Agent-UserId': stored.userid || ''
  };
}

function buildDates(targetDate) {
  const dates = [targetDate];
  if (!targetDate) return [new Date().toISOString().slice(0, 10)];
  const td = new Date(targetDate);
  for (let i = 1; i <= 3; i++) {
    const prev = new Date(td);
    prev.setDate(prev.getDate() - i);
    dates.push(prev.toISOString().slice(0, 10));
  }
  return dates;
}

function extractRecords(json) {
  if (!json || typeof json !== 'object') return [];
  const deep = (node, depth = 0) => {
    if (depth > 6 || !node) return null;
    if (Array.isArray(node) && node.length && typeof node[0] === 'object') {
      const first = node[0];
      if (first.gd !== undefined || first.sid !== undefined || first.debet !== undefined || first.bet !== undefined) return node;
    }
    if (typeof node === 'object') {
      for (const k of Object.keys(node)) {
        const r = deep(node[k], depth + 1);
        if (r) return r;
      }
    }
    return null;
  };
  return deep(json) || [];
}

function recordSid(r) { return String(r.sid || r.transactionId || r.tid || '').trim(); }
function recordDebet(r) {
  const v = r.debet || r.bet || r.betting || r.amount || r.hbet || 0;
  return Number(String(v).replace(/[^\d.-]/g, '')) || 0;
}
function recordGameId(r) { return String(r.gid || r.gameId || r.game_id || '').trim(); }

// Extract scatter dari pgData (API response detail)
// Pola dari AUTO SCATER: consensus antara FreeSpin, MaxScatterInBd, TriggerSpin
function extractScatterFromPgData(pgData) {
  const bd = pgData?.dt?.bh?.bd;
  if (!Array.isArray(bd)) return null;

  // 1. FreeSpin scatter: st===4, nst===21, sc>0
  let freeSpinSc = null;
  for (let i = 0; i < bd.length; i++) {
    const gd = bd[i]?.gd || {};
    if (Number(gd.st) === 4 && Number(gd.nst) === 21 && Number(gd.sc) > 0) {
      if (Number(gd.sc) >= 5) {
        let maxSc = Number(gd.sc);
        for (let j = i + 1; j < bd.length; j++) {
          const g2 = bd[j]?.gd || {};
          const s2 = Number(g2.st);
          const c2 = Number(g2.sc);
          if (isFinite(c2) && s2 >= 4 && s2 < 21 && c2 > maxSc) maxSc = c2;
        }
        freeSpinSc = maxSc;
      } else {
        freeSpinSc = Number(gd.sc);
      }
      break;
    }
  }

  // 2. Max scatter in bd (st < 21)
  let maxSc = 0;
  for (const item of bd) {
    const gd = item?.gd || {};
    const st = Number(gd.st);
    const sc = Number(gd.sc);
    if (st >= 21 || !isFinite(sc)) continue;
    if (sc > maxSc) maxSc = sc;
  }

  // 3. Trigger spin: st < 4, nst >= 4, sc >= 3
  let triggerSc = null;
  for (const item of bd) {
    const gd = item?.gd || {};
    if (Number(gd.st) < 4 && Number(gd.nst) >= 4 && Number(gd.sc) >= 3) {
      triggerSc = Number(gd.sc);
      break;
    }
  }

  // Consensus
  const valid = v => v !== null && v >= 3 && v <= 5;
  const r1 = valid(freeSpinSc) ? freeSpinSc : null;
  const r2 = maxSc >= 3 && maxSc <= 5 ? maxSc : null;
  const r3 = valid(triggerSc) ? triggerSc : null;

  if (r1 && r2 && r3) {
    if (r1 === r2 || r1 === r3) return r1;
    if (r2 === r3) return r2;
    return r1;
  }
  if (r1) return r1;
  if (r2) return r2;
  if (r3) return r3;
  return null;
}

function isInvalidSession(json) {
  if (!json || typeof json !== 'object') return false;
  const msg = String(json.message || json.msg || json.Msg || json.detail || json.error || '').toLowerCase();
  const cd = String(json.cd || json.code || json.status || '').trim();
  return msg.includes('invalid') && (msg.includes('session') || msg.includes('token'))
    || msg.includes('session expired') || cd === '2001';
}

async function queryTransactionHistory({ domain, userId, transactionId, startDate, endDate, pageNo = 1, pageSize = 300 }) {
  const hdrs = buildHeaders(arguments[0].stored || {});
  const base = domain.startsWith('http') ? domain : `https://${domain}`;
  const url = `${base}/game-oc/ida/transaction/history/queryTransactionHistoryListForUser?userId=${encodeURIComponent(userId)}&pageNo=${pageNo}&pageSize=${pageSize}&startDate=${startDate}&endDate=${endDate}&transactionId=${encodeURIComponent(transactionId || '')}`;
  const res = await fetch(url, { method: 'GET', headers: hdrs, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Admin API error: ${res.status}`);
  const json = await res.json();
  if (isInvalidSession(json)) throw new Error('INVALID_OPERATOR_SESSION');
  return extractRecords(json);
}

// Main processor: cari record transaksi + extract bet + scatter
async function fetchBetData({ stored, userId, transactionId, targetDate }) {
  if (!stored || !stored.token || stored.token.length < 10) {
    throw new Error('Token admin belum ada');
  }
  const domain = stored.adminUrl
    ? new URL(stored.adminUrl.startsWith('http') ? stored.adminUrl : `https://${stored.adminUrl}`).hostname
    : DEFAULT_DOMAIN;

  const dates = buildDates(targetDate || new Date().toISOString().slice(0, 10));
  let matched = null, usedDomain = domain;

  for (const d of dates) {
    try {
      const recs = await queryTransactionHistory({ domain, userId, transactionId, startDate: d, endDate: d, stored });
      const hit = recs.find(r => {
        const sid = recordSid(r);
        return (sid === transactionId || sid.includes(transactionId)) && recordDebet(r) > 0;
      });
      if (hit) { matched = hit; break; }
    } catch (e) {
      if (String(e.message).startsWith('INVALID_OPERATOR_SESSION')) throw e;
      continue;
    }
  }

  if (!matched) throw new Error('Transaksi tidak ditemukan di admin panel');

  const bet = recordDebet(matched);
  const gameId = recordGameId(matched);
  if (gameId !== '65' && gameId !== '74') throw new Error(`Bukan Mahjong (game: ${gameId})`);

  return { userId, transactionId, bet, gameId, matched };
}

module.exports = {
  IDRBO_HEADERS, DEFAULT_DOMAIN,
  buildHeaders, extractRecords, extractScatterFromPgData,
  queryTransactionHistory, fetchBetData, recordSid, recordDebet, recordGameId,
  isInvalidSession
};