// ============================================================
// HISTORY API CLIENT - POST GetBetHistory dengan sid+gid
// Dipetakan dari AUTO SCATER klaimFetchScatterPg
// Pola: POST form-urlencoded ke public-api.zmcyu9ypy.com
// ============================================================

const { DEFAULT_HOST } = require('./admin-api');
const { extractScatterFromPgData } = require('./admin-api');

// Ambil settings dari Supabase (dipanggil dari pipeline)
async function loadStoredHeaders() {
  const { getSetting } = require('./supabase');
  const stored = await getSetting('admin') || {};
  return {
    token: stored.token || '',
    adminUrl: stored.adminUrl || '',
    pkid: stored.pkid || '',
    role: stored.role || '',
    suid: stored.suid || '',
    userAgent: stored.userAgent || '',
    userid: stored.userid || '',
    historyToken: stored.historyToken || ''
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