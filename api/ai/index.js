'use strict';

const { verifySession, parseCookies, sendJson } = require('../../lib/auth-handler');

const ENDPOINTS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    headers: () => ({
      'Authorization': 'Bearer ' + (process.env.GROQ_API_KEY || ''),
      'Content-Type': 'application/json'
    }),
    missing: 'GROQ_API_KEY belum di-set'
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: () => ({
      'Authorization': 'Bearer ' + (process.env.OPENROUTER_API_KEY || ''),
      'HTTP-Referer': process.env.SITE_URL || 'https://auto-relax-aa.app',
      'X-Title': 'AUTO RELAX by AA',
      'Content-Type': 'application/json'
    }),
    missing: 'OPENROUTER_API_KEY belum di-set'
  }
};

async function readBody(req) {
  return new Promise(function (resolve) {
    var chunks = [];
    req.on('data', function (c) { chunks.push(Buffer.from(c)); });
    req.on('end', function () {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (_) { resolve({}); }
    });
    req.on('error', function () { resolve({}); });
  });
}

function authed(req) {
  const cookies = parseCookies(req);
  return !!verifySession(cookies.adm_session || '');
}

async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      return res.end();
    }
    if (req.method !== 'POST') {
      return sendJson(res, 400, { ok: false, message: 'Method tidak didukung' });
    }
    if (!authed(req)) {
      return sendJson(res, 401, { ok: false, message: 'Belum login' });
    }

    const body = await readBody(req);
    const provider = String(body.provider || '').toLowerCase();
    const payload = body.payload || {};
    let url, headers;

    if (provider === 'gemini') {
      const key = process.env.GEMINI_API_KEY || '';
      if (!key) return sendJson(res, 503, { ok: false, message: 'GEMINI_API_KEY belum di-set' });
      url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + key;
      headers = { 'Content-Type': 'application/json' };
    } else {
      const ep = ENDPOINTS[provider];
      if (!ep) return sendJson(res, 400, { ok: false, message: 'provider tidak dikenal' });
      if (!process.env[provider === 'groq' ? 'GROQ_API_KEY' : 'OPENROUTER_API_KEY']) {
        return sendJson(res, 503, { ok: false, message: ep.missing });
      }
      url = ep.url;
      headers = ep.headers();
    }

    let upstream;
    try {
      upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    } catch (_) {
      return sendJson(res, 502, { ok: false, message: 'Gagal menghubungi provider' });
    }

    const text = await upstream.text();
    if (!upstream.ok) {
      return sendJson(res, upstream.status, { ok: false, message: 'HTTP ' + upstream.status + ': ' + text.slice(0, 500) });
    }

    let data;
    try { data = JSON.parse(text); } catch (_) { return sendJson(res, 502, { ok: false, message: 'Respons provider invalid' }); }
    return sendJson(res, 200, { ok: true, data: data });
  } catch (err) {
    console.error('AI proxy error:', err);
    return sendJson(res, 500, { ok: false, message: 'Internal error' });
  }
}

module.exports = handler;
