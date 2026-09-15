// ============================================================
// AUTH - Google OAuth langsung (menggantikan chrome.identity)
// Replika alur AUTO RELAX modules/auth.js untuk web:
//   login → redirect Google → callback (tukar code) → session
// PKCE + state, session JWT HMAC (HttpOnly cookie)
// ============================================================
// Menghindari committal secrets: GOOGLE_CLIENT_ID / SECRET /
// SESSION_SECRET dibaca dari environment (Vercel env / .env)

const crypto = require('crypto');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const SESSION_SECRET = process.env.SESSION_SECRET || CLIENT_SECRET || 'dev-secret';
const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';
const MASTER_EMAIL = process.env.MASTER_EMAIL || '';
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 jam

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// --- helpers base64url ---
function b64u(str) {
  return Buffer.from(String(str)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function sha256B64url(input) {
  return crypto.createHash('sha256').update(input).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signSession(payload) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(`${header}.${body}`).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${header}.${body}.${sig}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(`${header}.${body}`).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (sig !== expect) return null;
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (!payload.exp || Date.now() / 1000 >= payload.exp) return null;
    return payload;
  } catch (_) { return null; }
}

function decodeIdToken(idToken) {
  const parts = String(idToken).split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  } catch (_) { return null; }
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, maxAge) {
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${maxAge ? '; Max-Age=' + maxAge : ''}`);
}

function redirectUri(req) {
  const origin = (req.headers.origin || (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + (req.headers.host || ''));
  return `${origin.replace(/\/$/, '')}/api/auth/callback`;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const full = new URL(req.url, SITE_URL);
  const action = full.pathname.split('/').filter(Boolean).pop();

  try {
    // --- login: buat URL Google OAuth (PKCE + state) ---
    if (action === 'login') {
      if (!CLIENT_ID || !CLIENT_SECRET) {
        return res.status(500).json({ ok: false, message: 'GOOGLE_CLIENT_ID/SECRET belum di-set di environment' });
      }
      const state = crypto.randomBytes(16).toString('hex');
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = sha256B64url(verifier);

      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: redirectUri(req),
        response_type: 'code',
        scope: 'openid email profile',
        prompt: 'select_account',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline'
      });

      setCookie(res, 'oa_state', state, 600);
      setCookie(res, 'oa_verifier', verifier, 600);

      return res.status(200).json({ ok: true, url: `${GOOGLE_AUTH_URL}?${params.toString()}` });
    }

    // --- callback: tukar code → token → decode id_token → session ---
    if (action === 'callback') {
      const cookies = parseCookies(req);
      const code = full.searchParams.get('code');
      const state = full.searchParams.get('state');
      if (!code) return res.status(400).send('Missing code');
      if (!state || state !== cookies.oa_state) return res.status(403).send('State mismatch');

      const body = new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code'
      });
      if (cookies.oa_verifier) body.set('code_verifier', cookies.oa_verifier);

      const tok = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      });
      const tokJson = await tok.json();
      if (!tok.ok || !tokJson.id_token) {
        return res.status(400).send('Gagal tukar code: ' + (tokJson.error_description || tokJson.error || tok.status));
      }

      const idp = decodeIdToken(tokJson.id_token);
      if (!idp || !idp.email) return res.status(400).send('id_token invalid');

      const payload = {
        sub: idp.sub,
        email: idp.email,
        name: idp.name || '',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
      };
      const sessionToken = signSession(payload);

      setCookie(res, 'oa_state', '', 0);
      setCookie(res, 'oa_verifier', '', 0);
      setCookie(res, 'adm_session', sessionToken, SESSION_TTL_SECONDS);
      res.statusCode = 302;
      res.setHeader('Location', '/master');
      res.setHeader('Cache-Control', 'no-store');
      return res.end();
    }

    // --- me: validasi session cookie => email ---
    if (action === 'me') {
      const cookies = parseCookies(req);
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : cookies.adm_session;
      const payload = verifySession(token);
      if (!payload) return res.status(200).json({ ok: true, authenticated: false });
      return res.status(200).json({
        ok: true, authenticated: true,
        email: payload.email, id: payload.sub, name: payload.name || '',
        is_admin: !MASTER_EMAIL || payload.email === MASTER_EMAIL
      });
    }

    // --- logout ---
    if (action === 'logout') {
      setCookie(res, 'adm_session', '', 0);
      return res.status(200).json({ ok: true });
    }

    return res.status(404).json({ ok: false, message: 'Not found' });
  } catch (e) {
    console.error('Auth error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
};