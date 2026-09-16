const { fetchNextPipelineClaim, updateClaim, addLog, fetchAllClaims, fetchClaimByCode, fetchClaimById } = require('../../lib/supabase');
const { sendAlert } = require('../../services/alert');
const { verifyClaimAuto, verifyClaimManual, submitBonusTicket, checkBonusStatus, buildVerifyFields, pushDecisionToBonus, sleep } = require('../../services/pipeline');
const { createTokenBucket, wrapWithRateLimit } = require('../../lib/rate-limit');
const { parseCookies, verifySession } = require('../../lib/auth-handler');
const bucket = createTokenBucket({ windowMs: 60000, max: 150 });

const AI_ENDPOINTS = {
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

async function proxyAi(req, res) {
  const cookies = parseCookies(req);
  if (!verifySession(cookies.adm_session || '')) {
    return res.status(401).json({ ok: false, message: 'Belum login' });
  }
  const provider = String(req.body.provider || '').toLowerCase();
  const payload = req.body.payload || {};
  let url, headers;

  if (provider === 'gemini') {
    const key = process.env.GEMINI_API_KEY || '';
    if (!key) return res.status(503).json({ ok: false, message: 'GEMINI_API_KEY belum di-set' });
    url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + key;
    headers = { 'Content-Type': 'application/json' };
  } else {
    const ep = AI_ENDPOINTS[provider];
    if (!ep) return res.status(400).json({ ok: false, message: 'provider tidak dikenal' });
    if (!process.env[provider === 'groq' ? 'GROQ_API_KEY' : 'OPENROUTER_API_KEY']) {
      return res.status(503).json({ ok: false, message: ep.missing });
    }
    url = ep.url;
    headers = ep.headers();
  }

  let upstream;
  try {
    upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  } catch (_) {
    return res.status(502).json({ ok: false, message: 'Gagal menghubungi provider' });
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    return res.status(upstream.status).json({ ok: false, message: 'HTTP ' + upstream.status + ': ' + text.slice(0, 500) });
  }
  let data;
  try { data = JSON.parse(text); } catch (_) { return res.status(502).json({ ok: false, message: 'Respons provider invalid' }); }
  return res.status(200).json({ ok: true, data });
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function runOneTick(manual = null) {
  const pending = await fetchNextPipelineClaim(1);
  if (!pending.length) return { ok: false, message: 'No pending claims' };

  const claim = pending[0];
  await updateClaim(claim.id, { status: 'VERIFYING' });

  let result;
  if (manual) {
    result = verifyClaimManual(claim, manual);
    result.mode = 'manual';
  } else {
    result = await verifyClaimAuto(claim);
    result.mode = 'auto';
  }

  const fields = buildVerifyFields(claim, result, (claim.check_attempts || 0) + 1);

  if (result.status === 'SESUAI') {
    const updated = await updateClaim(claim.id, {
      status: 'SESUAI', detail: 'Bet & scatter terverifikasi: SESUAI', ...fields
    });
    await sendAlert('BET_VERIFIED', { kode_tiket: claim.kode_tiket, user_id: claim.user_id });
    await addLog('PIPELINE_OK', `Claim ${claim.kode_tiket} SESUAI (${result.mode})`, fields);
    const push = await pushDecisionToBonus(claim, 'SESUAI');
    if (push.ok) await addLog('BONUS_PUSH', `Approve bonussmb → ${claim.kode_tiket}`);
    else if (push.code && push.code !== 'DISABLED') await addLog('BONUS_PUSH', `Approve ${claim.kode_tiket} GAGAL: ${push.code} ${push.message || ''}`);
    return { ok: true, claim: updated, result, bonusPush: push };
  }

  if (result.status === 'TIDAK_SESUAI') {
    const updated = await updateClaim(claim.id, {
      status: 'TIDAK_SESUAI', detail: result.reason || 'Tidak sesuai', ...fields
    });
    await sendAlert('CLAIM_REJECTED', { kode_tiket: claim.kode_tiket, user_id: claim.user_id, reason: result.reason });
    await addLog('PIPELINE_GAGAL', `Claim ${claim.kode_tiket} TIDAK SESUAI: ${result.reason} (${result.mode})`, fields);
    const push = await pushDecisionToBonus(claim, 'TIDAK_SESUAI', result.reason);
    if (push.ok) await addLog('BONUS_PUSH', `Reject bonussmb → ${claim.kode_tiket}`);
    else if (push.code && push.code !== 'DISABLED') await addLog('BONUS_PUSH', `Reject ${claim.kode_tiket} GAGAL: ${push.code} ${push.message || ''}`);
    return { ok: true, claim: updated, result, bonusPush: push };
  }

  // ERROR (NO_TOKEN / NOT_FOUND / FETCH_FAIL / INVALID_OPERATOR_SESSION)
  const updated = await updateClaim(claim.id, {
    status: 'ERROR', detail: result.reason || result.error || 'Error verifikasi', ...fields
  });
  await addLog('PIPELINE_ERROR', `Claim ${claim.kode_tiket} ERROR: ${result.reason || result.error} (${result.mode})`, fields);
  return { ok: true, claim: updated, result };
}

module.exports = wrapWithRateLimit(async (req, res) => {
  cors(res);
  const rl = require('../../lib/rate-limit');
  const guard = rl.globalRpsLimiter.hit(req, res);
  if (guard.limited) return;
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed' });

  try {
    const { action, kode_tiket } = req.body || {};

    if (action === 'ai') {
      return proxyAi(req, res);
    }

    if (action === 'verify') {
      if (!kode_tiket) return res.status(400).json({ ok: false, message: 'kode_tiket required' });
      const claim = await fetchClaimByCode(kode_tiket);
      if (!claim) return res.status(200).json({ ok: true, verified: false, message: 'Ticket not found in claims' });
      return res.status(200).json({
        ok: true,
        verified: claim.status === 'SESUAI' || claim.status === 'INPUT_OK',
        status: claim.status,
        detail: claim.detail,
        reject_reason: claim.reject_reason,
        claim
      });
    }

    if (action === 'check') {
      const { bet_actual, scatter_actual, hadiah_actual } = req.body || {};
      if (!kode_tiket) return res.status(400).json({ ok: false, message: 'kode_tiket required' });
      if (bet_actual == null && scatter_actual == null) {
        return res.status(400).json({ ok: false, message: 'bet_actual/scatter_actual required' });
      }
      const result = await runOneTick({ bet_actual, scatter_actual, hadiah_actual });
      if (!result.ok && result.message) return res.status(200).json(result);
      // poles kode_tiket agar jawaban konsisten
      const claim = { ...result.claim };
      return res.status(200).json({ ok: true, claim, result: result.result });
    }

    if (action === 'relax_check') {
      const { fetchRelaxLogs, fetchRelaxRows, updateRelaxRow, addRelaxLog } = require('../../lib/supabase');
      const id = req.body.id;
      const rowId = req.body.rowId || id;
      if (!rowId) return res.status(400).json({ ok: false, message: 'id row wajib' });
      const list = await fetchRelaxRows({ search: '', status: '', page: 1, limit: 1000 });
      const row = (list.data || []).find(r => String(r.id) === String(rowId));
      if (!row) return res.status(200).json({ ok: false, message: 'Row tidak ditemukan: ' + rowId });

      const claim = {
        id: row.id,
        user_id: row.user || '',
        kode_tiket: row.kodeTiket || '',
        betting: parseFloat(String(row.betting || '').replace(/[^0-9.]/g, '')) || null,
        scatter: row.payout ? parseInt(String(row.payout).replace(/[^0-9]/g, '')) || null : null,
        created_at: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString()
      };

      if (!claim.kode_tiket) return res.status(200).json({ ok: false, message: 'Kode tiket kosong' });

      // 2x-check: retry sekali bila error/fetch gagal
      let result = await verifyClaimAuto(claim);
      if ((result.status === 'ERROR' || result.code === 'DATA_NOT_FOUND' || result.code === 'NO_TOKEN') && (row.autoRetryCheck || 0) < 1) {
        await sleep(1200);
        result = await verifyClaimAuto(claim);
        await updateRelaxRow(rowId, { autoRetryCheck: 1 });
      }

      let patch = {
        autoStatus: result.status === 'SESUAI' ? 'APPROVED' : result.status === 'TIDAK_SESUAI' ? 'REJECTED' : '',
        manualStatus: '',
        autoCol9: String(result.autoCol9 || result.detail || result.reason || ''),
        autoCol10: String(result.autoCol10 || result.reason || result.detail || result.error || result.status || ''),
        betting: result.actual && result.actual.bet != null ? String(result.actual.bet) : (row.betting || ''),
        payout: result.actual && result.actual.scatter != null ? String(result.actual.scatter) : (row.payout || ''),
        totalFreeSpin: result.actual && result.actual.freeSpin != null ? String(result.actual.freeSpin) : (row.totalFreeSpin || '')
      };

      const updated = await updateRelaxRow(rowId, patch);
      await addRelaxLog('CHECK #' + rowId + ' ' + (updated.kodeTiket || '') + ' -> ' + result.status + (result.reason ? ' · ' + result.reason : ''), result.status === 'ERROR' ? 'error' : result.status === 'TIDAK_SESUAI' ? 'warn' : 'ok');

      // Auto push keputusan ke bonussmb bila aktif (SESUAI -> approve, TIDAK_SESUAI -> reject)
      if (result.status === 'SESUAI' || result.status === 'TIDAK_SESUAI') {
        const push = await pushDecisionToBonus(claim, result.status, result.reason);
        if (push.ok) await addRelaxLog('BONUS_PUSH #' + rowId + ' ' + result.status, 'ok');
        else if (push.code && push.code !== 'DISABLED') await addRelaxLog('BONUS_PUSH #' + rowId + ' GAGAL: ' + push.code + ' ' + (push.message || ''), 'warn');
        return res.status(200).json({ ok: true, row: updated, result, mode: 'auto', bonusPush: push });
      }
      return res.status(200).json({ ok: true, row: updated, result, mode: 'auto' });
    }

    if (action === 'bonus_submit') {
      const id = req.body.id;
      const code = req.body.kode_tiket;
      if (!id && !code) return res.status(400).json({ ok: false, message: 'id or kode_tiket required' });
      const claim = id ? await fetchClaimById(id) : await fetchClaimByCode(code);
      if (!claim) return res.status(200).json({ ok: false, message: 'Claim not found' });
      const betting = req.body.betting != null ? req.body.betting : claim.betting;
      const scatter = req.body.scatter != null ? req.body.scatter : claim.scatter;
      const result = await submitBonusTicket({ ...claim, betting, scatter }, { executablePath: req.body.chromePath, headless: req.body.headless !== false });
      if (result.success) {
        await updateClaim(claim.id, { status: 'INPUT_OK', detail: result.message || 'Bonus submitted via Puppeteer' });
        await addLog('PIPELINE_BONUS', `Bonus ${claim.kode_tiket} submitted: ${result.message || ''}`);
      } else {
        await updateClaim(claim.id, { status: 'INPUT_FAIL', detail: result.message || 'Bonus submit gagal' });
        await addLog('PIPELINE_BONUS', `Bonus ${claim.kode_tiket} GAGAL: ${result.message || ''}`);
      }
      return res.status(200).json({ ok: true, claim: await fetchClaimById(claim.id), result });
    }

    if (action === 'bonus_status') {
      const id = req.body.id;
      const kode_tiket = req.body.kode_tiket;
      if (!id && !kode_tiket) return res.status(400).json({ ok: false, message: 'id or kode_tiket required' });
      let code = kode_tiket;
      if (!code && id) {
        const claim = await fetchClaimById(id);
        if (claim) code = claim.kode_tiket;
      }
      if (!code) return res.status(400).json({ ok: false, message: 'kode_tiket required' });
      const status = await checkBonusStatus(code, { executablePath: req.body.chromePath, headless: req.body.headless !== false });
      return res.status(200).json({ ok: true, status });
    }

    if (action === 'test_puppeteer') {
      try {
        const { ensureBrowser, getState } = require('../../services/puppeteer-scrape');
        const browser = await ensureBrowser(req.body.chromePath, false);
        const st = getState();
        const version = browser ? (await browser.version().catch(() => 'unknown')) : 'unknown';
        return res.status(200).json({ ok: st.connected, message: st.connected ? `Puppeteer OK (${version})` : 'Puppeteer tidak terhubung' });
      } catch (e) {
        return res.status(200).json({ ok: false, message: 'Puppeteer tidak bisa memulai browser di server (butuh VPS): ' + e.message });
      }
    }

    if (action === 'tick' || action === 'next') {
      const result = await runOneTick();
      return res.status(200).json(result);
    }

    if (action === 'all') {
      let processed = 0;
      for (let i = 0; i < 20; i++) {
        const before = await fetchNextPipelineClaim(1);
        if (!before.length) break;
        const result = await runOneTick();
        if (result.ok) processed++;
        await sleep(300);
      }
      await addLog('PIPELINE_BATCH', `Batch processed ${processed} claims`);
      return res.status(200).json({ ok: true, processed });
    }

    return res.status(400).json({ ok: false, message: 'Invalid action' });
  } catch (e) {
    console.error('Process error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}, bucket);