const crypto = require('crypto');

const SITE_URL = process.env.SITE_URL || 'https://scatter-claim.vercel.app';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function b64u(str) {
  return Buffer.from(String(str))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function s256b64url(input) {
  return crypto
    .createHash('sha256')
    .update(input)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signSession(payloadObj) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payloadObj));
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET || '')
    .update(header + '.' + body)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return header + '.' + body + '.' + sig;
}

function verifySession(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto
    .createHmac('sha256', process.env.SESSION_SECRET || '')
    .update(header + '.' + body)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    );
    if (!payload.exp || Date.now() / 1000 >= payload.exp) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return out;
}

function setCookie(res, name, value, maxAgeSeconds) {
  const parts = [
    name + '=' + encodeURIComponent(value),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (maxAgeSeconds) parts.push('Max-Age=' + maxAgeSeconds);
  res.setHeader('Set-Cookie', parts.join('; '));
}

function decodeIdToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    );
  } catch (_) {
    return null;
  }
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(obj));
}

async function login(req, res) {
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return sendJson(res, 500, { ok: false, message: 'GOOGLE_CLIENT_ID/SECRET belum di-set' });
  }

  const redirectUri = SITE_URL.replace(/\/+$/, '') + '/api/auth/callback';
  const state = crypto.randomBytes(16).toString('hex');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = s256b64url(verifier);

  setCookie(res, 'oa_state', state, 600);
  setCookie(res, 'oa_verifier', verifier, 600);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state: state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    include_granted_scopes: 'true'
  });

  const url = GOOGLE_AUTH_URL + '?' + params.toString();
  return sendJson(res, 200, { ok: true, url: url });
}

async function callback(req, res) {
  const full = new URL(req.url, SITE_URL);
  const code = full.searchParams.get('code');
  const state = full.searchParams.get('state');
  const cookies = parseCookies(req);

  if (!state || state !== cookies.oa_state) {
    return sendJson(res, 403, { ok: false, message: 'State mismatch' });
  }

  if (!code) {
    return sendJson(res, 403, { ok: false, message: 'Missing code' });
  }

  const redirectUri = SITE_URL.replace(/\/+$/, '') + '/api/auth/callback';
  const codeVerifier = cookies.oa_verifier || '';

  const body = new URLSearchParams({
    code: code,
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier
  });

  let tokRes;
  try {
    tokRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
  } catch (_) {
    return sendJson(res, 502, { ok: false, message: 'Gagal menghubungi Google token endpoint' });
  }

  const tokJson = await tokRes.json().catch(function () { return {}; });
  if (!tokRes.ok || !tokJson.id_token) {
    return sendJson(res, 502, { ok: false, message: 'Gagal tukar code' });
  }

  const idp = decodeIdToken(tokJson.id_token);
  if (!idp || !idp.email) {
    return sendJson(res, 502, { ok: false, message: 'id_token invalid' });
  }

  if (!(await isEmailAllowed(idp.email))) {
    return sendJson(res, 403, { ok: false, message: 'Email tidak di-whitelist master' });
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionToken = signSession({
    sub: idp.sub,
    email: idp.email,
    name: idp.name || '',
    iat: now,
    exp: now + 43200
  });

  setCookie(res, 'adm_session', sessionToken, 43200);
  setCookie(res, 'oa_state', '', 0);
  setCookie(res, 'oa_verifier', '', 0);

  return sendJson(res, 200, { ok: true, authenticated: true, email: idp.email });
}

async function me(req, res) {
  const cookies = parseCookies(req);
  const token = cookies.adm_session || '';
  const payload = verifySession(token);
  if (!payload) {
    return sendJson(res, 200, { ok: true, authenticated: false });
  }
  var MASTER_EMAIL = (process.env.MASTER_EMAIL || '').trim().toLowerCase();
  return sendJson(res, 200, {
    ok: true,
    authenticated: true,
    email: payload.email,
    name: payload.name || '',
    is_admin: payload.email === MASTER_EMAIL
  });
}

function logout(res) {
  setCookie(res, 'adm_session', '', 0);
  return sendJson(res, 200, { ok: true });
}

async function isEmailAllowed(email) {
  var MASTER_EMAIL = (process.env.MASTER_EMAIL || '').trim().toLowerCase();
  var e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  if (MASTER_EMAIL && e === MASTER_EMAIL) return true;
  try {
    var supabase = require('./supabase');
    if (typeof supabase.getSetting === 'function') {
      var setting = await supabase.getSetting('admin');
      var list = (setting && Array.isArray(setting.allowed_emails)) ? setting.allowed_emails : [];
      return list.map(function (x) { return String(x).trim().toLowerCase(); }).indexOf(e) !== -1;
    }
  } catch (_) {}
  return false;
}

module.exports = { sendJson, login, callback, me, logout, isEmailAllowed };
