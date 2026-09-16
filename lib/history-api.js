// ============================================================
// HISTORY API CLIENT - POST GetBetHistory dengan sid+gid
// Dipetakan dari AUTO SCATER klaimFetchScatterPg
// Pola: POST form-urlencoded ke public-api.zmcyu9ypy.com
// ============================================================

const { DEFAULT_HOST } = require('./admin-api');
const { extractScatterFromPgData } = require('./admin-api');

// Ambil settings dari Supabase (dipanggil dari pipeline)
async function loadStoredHeaders() {
  const [stored, idrbo, sensor] = await Promise.all([getSetting('admin'), getSetting('idrbo'), getSetting('sensor')]);
  let s = stored || {};
  // Prioritas 1: sensor (token otomatis terbaru dari extension sensor, fresh)
  if (sensor && sensor.token) {
    s = {
      token: sensor.token, adminUrl: sensor.adminUrl || '', pkid: sensor.pkid || '',
      role: sensor.role || '', suid: sensor.suid || '', userAgent: sensor.userAgent || '',
      userid: sensor.userid || '', historyToken: sensor.historyToken || ''
    };
  }
  // Prioritas 2: jika admin kosong, pakai akun IDRBO pertama sebagai header
  else if (!s.token && idrbo && Array.isArray(idrbo.accounts) && idrbo.accounts.length) {
    const a = idrbo.accounts[0] || {};
    s = {
      token: a.token || '', adminUrl: a.adminUrl || '', pkid: a.pkid || '',
      role: a.role || '', suid: a.suid || '', userAgent: a.userAgent || '',
      userid: a.userid || '', historyToken: a.historyToken || ''
    };
  }
  return {
    token: s.token || '',
    adminUrl: s.adminUrl || '',
    pkid: s.pkid || '',
    role: s.role || '',
    suid: s.suid || '',
    userAgent: s.userAgent || '',
    userid: s.userid || '',
    historyToken: s.historyToken || ''
  };
}

async function saveStoredHeaders(data) {
  const { setSetting } = require('./supabase');
  await setSetting('admin', data);
}

// POST GetBetHistory (pola extension: sid=...&gid=... form-urlencoded)
async function fetchBetHistory({ token, host = DEFAULT_HOST, sid, gid }) {
  if (!token) {
    const err = new Error('NO_TOKEN');
    err.code = 'NO_TOKEN';
    throw err;
  }
  const base = host.startsWith('http') ? host : `https://${host}`;
  const url = `${base}/web-api/operator-proxy/v1/History/GetBetHistory?t=${encodeURIComponent(token)}`;

  const body = new URLSearchParams();
  if (sid) body.set('sid', sid);
  if (gid) body.set('gid', gid);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    const err = new Error('FETCH_FAIL');
    err.code = 'FETCH_FAIL';
    throw err;
  }

  if (res.status === 401 || res.status === 403 || res.status === 400) {
    const err = new Error('INVALID_OPERATOR_SESSION');
    err.code = 'INVALID_OPERATOR_SESSION';
    throw err;
  }

  let json;
  try { json = await res.json(); }
  catch (e) {
    const err = new Error('FETCH_FAIL');
    err.code = 'FETCH_FAIL';
    throw err;
  }

  // Check invalid session
  if (json && typeof json === 'object') {
    const msg = String(json.message || json.msg || json.detail || '').toLowerCase();
    if (msg.includes('invalid') && (msg.includes('session') || msg.includes('token'))) {
      const err = new Error('INVALID_OPERATOR_SESSION');
      err.code = 'INVALID_OPERATOR_SESSION';
      throw err;
    }
  }

  return json;
}

// Extract scatter dari response GetBetHistory (pola extension)
function extractScatter(pgData) {
  return extractScatterFromPgData(pgData);
}

module.exports = { fetchBetHistory, extractScatter, loadStoredHeaders, saveStoredHeaders };