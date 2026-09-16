const { queryTransactionHistory, extractScatterFromPgData, recordSid, recordDebet, recordGameId } = require('./admin-api');
const { fetchBetHistory } = require('./history-api');
const { getSetting } = require('./supabase');

const DEFAULT_ADMIN_DOMAIN = 'ag-bandar80.idrbo2.com';
const DEFAULT_HISTORY_HOST = 'public-api.zmcyu9ypy.com';
const AUTH_CHECK_FAIL = 'INVALID_OPERATOR_SESSION';

const IDRBO_DOMAIN_DEFAULTS = ['idrbo.com', 'idrbo1.com', 'idrbo2.com', 'idrbo3.com', 'idrbo4.com'];

function buildAccountHeaders(acc) {
  return {
    token: acc.token || '',
    adminUrl: acc.adminUrl || '',
    pkid: acc.pkid || '',
    role: acc.role || '',
    suid: acc.suid || '',
    userAgent: acc.userAgent || '',
    userid: acc.userid || ''
  };
}

function pastDates(targetDate, n) {
  const list = [];
  const base = new Date(targetDate);
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    list.push(d.toISOString().slice(0, 10));
  }
  return list;
}

// Daftar domain kandidat: adminUrl akun + daftar global idrbo (auto-try semua)
async function candidateDomains(acc) {
  const list = [];
  const push = (s) => { const v = String(s || '').trim(); if (v && list.indexOf(v) === -1) list.push(v); };
  if (acc && acc.adminUrl && acc.adminUrl.trim()) push(acc.adminUrl.replace(/^https?:\/\//, '').split('/')[0]);
  try {
    const dom = await getSetting('idrboDomains');
    if (dom && Array.isArray(dom.domains)) dom.domains.forEach(push);
  } catch (_) {}
  IDRBO_DOMAIN_DEFAULTS.forEach(push);
  if (!list.length) push(DEFAULT_ADMIN_DOMAIN);
  return list;
}

async function grabAccount(acc, histSetting, days = 3) {
  const out = { name: String(acc.name || 'akun').slice(0, 60), ok: false, admin: { ok: false, count: 0, totalBet: 0, games: {}, error: '', domain: '' }, history: { ok: false, scatterCount: 0, scatters: [], error: '' } };

  // 1) Admin REST: daftar transaksi — auto-try semua domain idrbo
  if (acc.userid) {
    const stored = buildAccountHeaders(acc);
    const domains = await candidateDomains(acc);
    const dates = pastDates(new Date().toISOString().slice(0, 10), days);
    let seen = 0;
    let sessionInvalid = false;
    for (const domain of domains) {
      let dateOk = false;
      for (const d of dates) {
        if (seen >= 20) break;
        try {
          const recs = await queryTransactionHistory({ domain, userId: acc.userid, transactionId: '', startDate: d, endDate: d, pageNo: 1, pageSize: 100, stored });
          for (const r of (recs || [])) {
            if (seen >= 20) break;
            const sid = recordSid(r);
            const bet = recordDebet(r);
            if (!sid) continue;
            const gid = recordGameId(r);
            out.admin.count++;
            out.admin.totalBet += bet;
            if (gid) out.admin.games[gid] = (out.admin.games[gid] || 0) + 1;
            seen++;
          }
          if (recs && recs.length > 0) { dateOk = true; out.admin.ok = true; out.admin.domain = domain; break; }
        } catch (e) {
          const m = String(e.message || e.code || '');
          if (m.indexOf(AUTH_CHECK_FAIL) !== -1) { sessionInvalid = true; break; }
          out.admin.error = 'Admin API: ' + m;
          break;
        }
      }
      if (out.admin.ok) break;
    }
    if (sessionInvalid && !out.admin.ok && !out.admin.error) out.admin.error = 'Sesi admin invalid/kedaluwarsa di semua domain';
    if (!out.admin.ok && !out.admin.error) out.admin.error = 'Tidak ada transaksi';
  } else {
    out.admin.error = 'User ID kosong';
  }

  // 2) History API: GetBetHistory untuk scatter
  const hToken = (acc.historyToken || histSetting.token || '').trim();
  if (hToken && acc.userid) {
    try {
      const histRes = await fetchBetHistory({
        token: hToken,
        host: (histSetting.host || DEFAULT_HISTORY_HOST),
        sid: acc.userid,
        gid: String(histSetting.gameId || '65')
      });
      const recs = Array.isArray(histRes && histRes.records) ? histRes.records : [];
      for (const rec of recs.slice(0, 60)) {
        const sc = extractScatterFromPgData((rec && rec.pgData) || rec);
        if (sc && sc >= 3 && sc <= 5) { out.history.scatterCount++; out.history.scatters.push(sc); }
      }
      out.history.ok = true;
    } catch (e) {
      const m = String(e.message || e.code || '');
      out.history.error = (m.indexOf(AUTH_CHECK_FAIL) !== -1 || m === 'INVALID_OPERATOR_SESSION') ? 'Sesi history invalid/kedaluwarsa' : 'History API: ' + m;
    }
  } else if (!hToken) {
    out.history.error = 'History token belum ada';
  } else {
    out.history.error = 'User ID kosong';
  }

  out.ok = out.admin.ok || out.history.ok;
  return out;
}

async function grabAllAccounts() {
  const [idrbo, histSetting] = await Promise.all([getSetting('idrbo'), getSetting('history')]);
  const accounts = (idrbo && Array.isArray(idrbo.accounts)) ? idrbo.accounts : [];
  const results = [];
  for (const acc of accounts) results.push(await grabAccount(acc || {}, histSetting || {}));
  return { count: accounts.length, results };
}

// Cek Rek (getInfoPage) — dipetakan persis dari background.js cekRekFetchViaApi
async function cekRekAccount(acc, userId) {
  const uid = String(userId || acc.userid || '').trim();
  if (!uid) return { ok: false, error: 'User ID kosong' };
  const headers = buildAccountHeaders(acc);
  const params = new URLSearchParams({
    accountId: uid, accountIdDim: '1', playerId: '', bankCode: '', bankName: '',
    lastName: '', mobile: '', pageNo: '1', pageSize: '50', realName: '',
    referralId: '', registerTimeFinally: '', registerTimeStart: '',
    registerTimeStartDim: '0', remark: '', remarkDim: '0', state: '', status: '',
    auditStatus: '', orderColumn: 'recordDate', orderType: 'desc'
  });
  const domains = await candidateDomains(acc);
  let lastErr = '';
  for (const domain of domains) {
    const url = `https://${domain}/game-oc/ida/playerInfo/getInfoPage?${params.toString()}`;
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json', ...headers }, signal: AbortSignal.timeout(20000) });
    } catch (e) {
      lastErr = 'Cek Rek gagal terhubung: ' + e.message;
      continue;
    }
    if (!res.ok) { lastErr = 'HTTP ' + res.status; continue; }
    let json = {};
    try { json = await res.json(); } catch (_) { lastErr = 'Response bukan JSON'; continue; }
    if (json && json.code && String(json.code).toUpperCase().indexOf(AUTH_CHECK_FAIL) !== -1) { lastErr = 'Sesi admin invalid'; continue; }
    const records = json && json.result && json.result.pages && json.result.pages.records;
    if (!records || !records.length) { lastErr = 'User tidak ditemukan / records kosong'; continue; }
    const p = records[0] || {};
    return {
      ok: true,
      noRek: p.bankCode || p.accountNo || p.bankNo || '-',
      nama: p.realName || p.lastName || p.fullName || p.name || '-',
      bank: p.bankName || p.bankNameStr || p.bank || '-',
      domain: domain
    };
  }
  return { ok: false, error: lastErr || 'Semua domain gagal cek rek' };
}

function getDomain(raw) {
  const s = String(raw || '').trim();
  if (!s) return DEFAULT_ADMIN_DOMAIN;
  try { return s.startsWith('http') ? new URL(s).hostname : s; } catch (_) { return s; }
}

module.exports = { grabAllAccounts, grabAccount, cekRekAccount };