const { login, me, logout, sendJson } = require('../../lib/auth-handler');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

module.exports = async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      return sendJson(res, 400, { ok: false, message: 'action wajib: login|me|logout' });
    }

    const url = new URL(req.url, 'http://x');
    const action = url.searchParams.get('action');

    switch (action) {
      case 'login':
        return await login(req, res);
      case 'me':
        return await me(req, res);
      case 'logout':
        return await logout(req, res);
      default:
        return sendJson(res, 400, { ok: false, message: 'action wajib: login|me|logout' });
    }
  } catch (err) {
    return sendJson(res, 500, { ok: false, message: 'Internal error' });
  }
};