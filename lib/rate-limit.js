'use strict';

/**
 * Rate limiting in-memory (token bucket + global limiter).
 *
 * CATATAN PENTING:
 * Di Vercel serverless, setiap instance memiliki memori sendiri.
 * Limitasi ini hanya berlaku per-instance — jika 10 instance aktif,
 * maka limit sebenarnya bisa ~10x lebih tinggi. Ini tetap berguna
 * sebagai proteksi DDoS/abuse lapisan pertama (per-instance guard).
 */

function createTokenBucket({ windowMs = 60000, max = 100, getIp } = {}) {
  const buckets = new Map();

  function defaultGetIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return fwd.split(',')[0].trim();
    if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
    return 'unknown';
  }

  const resolveIp = typeof getIp === 'function' ? getIp : defaultGetIp;

  function prune(now) {
    for (const [ip, entry] of buckets) {
      if (now - entry.last > windowMs) {
        buckets.delete(ip);
      }
    }
  }

  function hit(req) {
    const now = Date.now();
    const ip = resolveIp(req);

    let entry = buckets.get(ip);

    if (!entry) {
      entry = { tokens: max, last: now };
      buckets.set(ip, entry);
    }

    const elapsed = now - entry.last;
    entry.last = now;

    // refill proportional to elapsed time
    if (elapsed > 0) {
      const refill = (elapsed / windowMs) * max;
      entry.tokens = Math.min(max, entry.tokens + refill);
    }

    if (entry.tokens >= 1) {
      entry.tokens -= 1;
      prune(now);
      return { allowed: true, remaining: Math.floor(entry.tokens), retryAfter: 0 };
    }

    // calculate retryAfter: time until 1 token is refilled
    const msPerToken = windowMs / max;
    const neededTokens = 1 - entry.tokens;
    const retryAfter = Math.ceil(neededTokens * msPerToken);

    prune(now);
    return { allowed: false, remaining: 0, retryAfter };
  }

  function reset() {
    buckets.clear();
  }

  return { hit, reset };
}

function createGlobalLimiter({ windowMs = 1000, max = 50 } = {}) {
  let tokens = max;
  let last = Date.now();

  function hit() {
    const now = Date.now();
    const elapsed = now - last;
    last = now;

    if (elapsed > 0) {
      const refill = (elapsed / windowMs) * max;
      tokens = Math.min(max, tokens + refill);
    }

    if (tokens >= 1) {
      tokens -= 1;
      return { allowed: true, remaining: Math.floor(tokens), retryAfter: 0 };
    }

    const msPerToken = windowMs / max;
    const neededTokens = 1 - tokens;
    const retryAfter = Math.ceil(neededTokens * msPerToken);

    return { allowed: false, remaining: 0, retryAfter };
  }

  return { hit };
}

function wrapWithRateLimit(fn, bucket, send429) {
  const defaultSend = (res, result) => {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: 'Terlalu banyak permintaan — coba lagi nanti', retryAfter: result.retryAfter }));
  };

  const sender = typeof send429 === 'function' ? send429 : defaultSend;

  return async function rateLimitedHandler(req, res) {
    const result = bucket.hit(req);
    if (!result.allowed) {
      return sender(res, result);
    }
    return fn(req, res);
  };
}

const defaultAuthBucket = createTokenBucket({ windowMs: 60000, max: 30 });
const defaultApiBucket = createTokenBucket({ windowMs: 60000, max: 120 });
const globalRps = createGlobalLimiter({ windowMs: 1000, max: 50 });

module.exports = {
  createTokenBucket,
  createGlobalLimiter,
  wrapWithRateLimit,
  defaultAuthBucket,
  defaultApiBucket,
  globalRps,
};
