'use strict';

const { login, callback, me, logout, pinLogin, sendJson } = require('../../lib/auth-handler');
const { wrapWithRateLimit, defaultAuthBucket } = require('../../lib/rate-limit');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const isCallbackPath = (url) => /^\/api\/auth\/callback(\?|\/|$)/.test(String(url).split('?')[0]);

function send429(res, result) {
  res.writeHead(429, {
    'Content-Type': 'application/json',
    'Retry-After': String(result.retryAfter || 0),
  });
  res.end(JSON.stringify({
    ok: false,
    message: 'Terlalu banyak permintaan, coba lagi nanti',
    retryAfter: result.retryAfter || 0,
  }));
}

async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      return sendJson(res, 400, { ok: false, message: 'Method tidak didukung' });
    }

    if (isCallbackPath(req.url)) {
      return await callback(req, res);
    }

    const url = new URL(req.url, 'http://x');
    const action = url.searchParams.get('action');

    switch (action) {
      case 'callback':
        return await callback(req, res);
      case 'pin_login':
        return await pinLogin(req, res);
      case 'login':
        return await login(req, res);
      case 'me':
        return await me(req, res);
      case 'logout':
        return logout(req, res);
      default:
        return sendJson(res, 400, { ok: false, message: 'action wajib: login|callback|me|logout' });
    }
  } catch (err) {
    console.error('Auth handler error:', err);
    return sendJson(res, 500, { ok: false, message: 'Internal error' });
  }
}

// Prevent an auth function from hanging forever: if a handler hasn't replied
// within 6s, force a 503 so the browser never waits indefinitely.
function withAuthTimeout(fn) {
  return function (req, res) {
    const timer = setTimeout(function () {
      if (!res.writableEnded) {
        try {
          sendJson(res, 503, { ok: false, message: 'Auth handler timeout' });
        } catch (_) {}
      }
    }, 6000);
    Promise.resolve(fn(req, res)).then(
      function () { clearTimeout(timer); },
      function () {
        try {
          if (!res.writableEnded) sendJson(res, 503, { ok: false });
        } catch (_) {}
        clearTimeout(timer);
      }
    );
  };
}

module.exports = wrapWithRateLimit(withAuthTimeout(handler), defaultAuthBucket, send429);

module.exports = wrapWithRateLimit(handler, defaultAuthBucket, send429);
