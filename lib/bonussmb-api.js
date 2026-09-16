// ============================================================
// BONUSSMB REST CLIENT - Laravel Sanctum (api.bonussmb.com/api)
// Replaceasi klik-DOM ekstensi dengan REST murni:
//   GET  /sanctum/csrf-cookie  (inisialisasi sesi + XSRF)
//   POST /login                 (email + password)
//   GET  /tiket-claim           (list antrian, filter status)
//   PUT  /tiket-claim/:id       (approve = proccessing / reject + alasan)
// Sesi cookie disimpan di Supabase (key 'bonus') agar tetap login.
// ============================================================

const { getSetting, setSetting, addLog } = require('./supabase');

const API = 'https://api.bonussmb.com/api';
const COOKIE_URL = 'https://api.bonussmb.com/sanctum/csrf-cookie';
const SETTING_KEY = 'bonus';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function parseCookies(setCookieHeaders) {
  const out = [];
  for (const raw of (setCookieHeaders || [])) {
    const parts = String(raw).split(';');
    const first = parts[0];
    if (!first || first.indexOf('=') === -1) continue;
    const eq = first.indexOf('=');
    const name = first.slice(0, eq).trim();
    const val = first.slice(eq + 1).trim();
    if (!name) continue;
    out.push({ name, value: val });
  }
  return out;
}

function cookieHeader(session) {
  if (!session || !Array.isArray(session.cookies) || !session.cookies.length) return '';
  return session.cookies.map(c => c.name + '=' + c.value).join('; ');
}

function mergeSession(session, newCookies, keepXsrf = true) {
  const map = {};
  for (const c of (session && Array.isArray(session.cookies) ? session.cookies : [])) map[c.name] = c.value;
  for (const c of newCookies) map[c.name] = c.value;
  const cookies = Object.keys(map).map(name => ({ name, value: map[name] }));
  const XSRF = map['XSRF-TOKEN'] || map['xsrf-token'] || '';
  const out = { cookies, xsrf: XSRF, login: session && session.login ? session.login : null, updated_at: new Date().toISOString() };
  if (!keepXsrf && !out.xsrf && session && session.xsrf) out.xsrf = session.xsrf;
  return out;
}

async function loadSession() {
  const s = await getSetting(SETTING_KEY);
  return (s && typeof s === 'object' && Array.isArray(s.cookies)) ? s : null;
}

async function saveSession(session) {
  await setSetting(SETTING_KEY, session);
}

async function clearSession() {
  await setSetting(SETTING_KEY, null);
}

// Inisialisasi sesi: GET /sanctum/csrf-cookie (denganCredentials)
async function initCsrf() {
  const res = await fetch(COOKIE_URL, {
    method: 'GET',
    headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': 'id,en;q=0.9' },
    signal: AbortSignal.timeout(20000)
  });
  const setC = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (res.headers.getAll ? res.headers.getAll('set-cookie') : []);
  return parseCookies(setC);
}

// Login dengan email + password
async function bonusLogin(email, password) {
  const csrfCookies = await initCsrf();
  let session = mergeSession(null, csrfCookies);
  const res = await fetch(API + '/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Language': 'id,en;q=0.9',
      'User-Agent': UA,
      'Cookie': cookieHeader(session),
      'X-XSRF-TOKEN': decodeURIComponent(session.xsrf || ''),
      'Referer': 'https://bonussmb.com/'
    },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(25000)
  });
  const setC = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  session = mergeSession(session, parseCookies(setC));
  let json = {};
  try { json = await res.json(); } catch (_) {}
  const ok = res.status === 200 || (json && json.success !== false && !json.message);
  if (ok || (json && json.success === true)) {
    session.login = { email, at: new Date().toISOString() };
    await saveSession(session);
    await addLog('BONUS_LOGIN', 'Login bonussmb sukses (' + email + ')');
    return { ok: true, twoFactor: !!(json && json.two_factor), message: (json && json.message) || (json && json.detail) || 'Login sukses' };
  }
  const msg = (json && json.message) || (json && json.errors && Object.keys(json.errors).map(k => json.errors[k]).join(' · ')) || ('HTTP ' + res.status);
  return { ok: false, message: msg, details: json };
}

// Submit kode 2FA bila diminta
async function bonusTwoFactor(code) {
  let session = await loadSession();
  if (!session) return { ok: false, message: 'Belum ada sesi. Login dulu.' };
  const res = await fetch(API + '/2fa', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': UA,
      'Cookie': cookieHeader(session), 'X-XSRF-TOKEN': decodeURIComponent(session.xsrf || ''),
      'Referer': 'https://bonussmb.com/'
    },
    body: JSON.stringify({ token: String(code || '').trim() }),
    signal: AbortSignal.timeout(25000)
  });
  const setC = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  session = mergeSession(session, parseCookies(setC));
  let json = {};
  try { json = await res.json(); } catch (_) {}
  if (res.status === 200 || json.success === true) {
    session.login = session.login || {};
    session.updated_at = new Date().toISOString();
    await saveSession(session);
    await addLog('BONUS_2FA', '2FA bonussmb valid');
    return { ok: true, message: '2FA sukses' };
  }
  return { ok: false, message: (json && json.message) || ('HTTP ' + res.status), details: json };
}

// Ambil daftar tiket-claim (dharmawan status: pending, waiting, proccessing, manual, approved, rejected, failed)
async function fetchTickets({ status, page = 1, limit = 100, search } = {}) {
  let session = await loadSession();
  if (!session) return { ok: false, message: 'Belum login bonussmb' };
  const q = new URLSearchParams();
  q.set('page', String(page));
  q.set('limit', String(limit));
  if (status) q.set('status', String(status));
  if (search) q.set('search', String(search));
  const res = await fetch(API + '/tiket-claim?' + q.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'application/json', 'Accept-Language': 'id,en;q=0.9', 'User-Agent': UA,
      'Cookie': cookieHeader(session), 'X-XSRF-TOKEN': decodeURIComponent(session.xsrf || ''),
      'Referer': 'https://bonussmb.com/'
    },
    signal: AbortSignal.timeout(30000)
  });
  const setC = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  session = mergeSession(session, parseCookies(setC));
  await saveSession(session);
  let json = {};
  try { json = await res.json(); } catch (_) {}
  if (res.status === 401) return { ok: false, unauth: true, message: 'Sesi kedaluwarsa, login ulang' };
  if (!res.ok) return { ok: false, message: (json && json.message) || ('HTTP ' + res.status) };
  const rows = (json && json.success ? json.data : json) || json;
  const list = Array.isArray(rows) ? rows : (Array.isArray(rows && rows.data) ? rows.data : (rows && rows.rows) || []);
  return { ok: true, rows: list, total: Array.isArray(rows) ? list.length : (rows && rows.total) || list.length, json };
}

// Update status tiket-claim: approve => status 'proccessing', reject => 'rejected' + reason
async function updateTicketStatus(id, { status, reason } = {}) {
  let session = await loadSession();
  if (!session) return { ok: false, message: 'Belum login bonussmb' };
  const payload = { status: String(status || '') };
  if (reason) payload.reason = String(reason);
  const res = await fetch(API + '/tiket-claim/' + String(id), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json', 'Accept': 'application/json', 'Accept-Language': 'id,en;q=0.9', 'User-Agent': UA,
      'Cookie': cookieHeader(session), 'X-XSRF-TOKEN': decodeURIComponent(session.xsrf || ''),
      'Referer': 'https://bonussmb.com/'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000)
  });
  const setC = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  session = mergeSession(session, parseCookies(setC));
  await saveSession(session);
  let json = {};
  try { json = await res.json(); } catch (_) {}
  if (res.status === 401) return { ok: false, unauth: true, message: 'Sesi kedaluwarsa, login ulang' };
  if (!res.ok) return { ok: false, message: (json && json.message) || ('HTTP ' + res.status), details: json };
  return { ok: true, message: (json && json.message) || 'OK', json };
}

// Ambil form-data untuk create tiket: roles & situs (GET /tiket-claim/form-data)
// Reverse-engineer: response {roles:[...], situs:[...]}
async function fetchTicketFormData() {
  let session = await loadSession();
  if (!session) return { ok: false, message: 'Belum login bonussmb' };
  const res = await fetch(API + '/tiket-claim/form-data', {
    method: 'GET',
    headers: {
      'Accept': 'application/json', 'Accept-Language': 'id,en;q=0.9', 'User-Agent': UA,
      'Cookie': cookieHeader(session), 'X-XSRF-TOKEN': decodeURIComponent(session.xsrf || ''),
      'Referer': 'https://bonussmb.com/'
    },
    signal: AbortSignal.timeout(30000)
  });
  const setC = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  session = mergeSession(session, parseCookies(setC));
  await saveSession(session);
  let json = {};
  try { json = await res.json(); } catch (_) {}
  if (res.status === 401) return { ok: false, unauth: true, message: 'Sesi kedaluwarsa, login ulang' };
  if (!res.ok) return { ok: false, message: (json && json.message) || ('HTTP ' + res.status), details: json };
  return {
    ok: true,
    roles: Array.isArray(json.roles) ? json.roles : (Array.isArray(json.data && json.data.roles) ? json.data.roles : []),
    situs: Array.isArray(json.situs) ? json.situs : (Array.isArray(json.data && json.data.situs) ? json.data.situs : []),
    json
  };
}

// Input/Buat tiket-claim baru (POST /tiket-claim)
// Payload hasil reverse-engineer bundle bonussmb:
//   userId, ticketCode, link bukti screenshot (textarea, banyak link dipisah koma),
//   plus role/situs dari form-data bila tersedia.
async function createTicket(input = {}) {
  let session = await loadSession();
  if (!session) return { ok: false, message: 'Belum login bonussmb' };
  const payload = {
    userId: String(input.userId || input.user_id || '').trim(),
    ticketCode: String(input.ticketCode || input.kode_tiket || input.code || '').trim(),
    link: String(input.link || input.screenshots || '').trim()
  };
  if (!payload.userId || !payload.ticketCode) {
    return { ok: false, message: 'userId & ticketCode wajib diisi' };
  }
  const res = await fetch(API + '/tiket-claim', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'Accept': 'application/json', 'Accept-Language': 'id,en;q=0.9', 'User-Agent': UA,
      'Cookie': cookieHeader(session), 'X-XSRF-TOKEN': decodeURIComponent(session.xsrf || ''),
      'Referer': 'https://bonussmb.com/'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000)
  });
  const setC = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  session = mergeSession(session, parseCookies(setC));
  await saveSession(session);
  let json = {};
  try { json = await res.json(); } catch (_) {}
  if (res.status === 401) return { ok: false, unauth: true, message: 'Sesi kedaluwarsa, login ulang' };
  if (!res.ok) return { ok: false, message: (json && json.message) || ('HTTP ' + res.status), details: json };
  return { ok: true, message: (json && json.message) || 'Tiket dibuat', ticket: json.data || json, json };
}

function sessionInfo() {
  return getSetting(SETTING_KEY).then(s => ({
    login: s && s.login ? s.login : null,
    updated_at: s && s.updated_at ? s.updated_at : null,
    cookies: (s && Array.isArray(s.cookies)) ? s.cookies.length : 0
  }));
}

module.exports = {
  bonusLogin, bonusTwoFactor, fetchTickets, updateTicketStatus, clearSession, sessionInfo, loadSession,
  fetchTicketFormData, createTicket
};