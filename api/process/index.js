const { fetchNextPipelineClaim, updateClaim, addLog, fetchAllClaims, fetchClaimByCode, fetchClaimById } = require('../../lib/supabase');
const { sendAlert } = require('../../services/alert');
const { verifyClaimAuto, verifyClaimManual, submitBonusTicket, checkBonusStatus, buildVerifyFields, sleep } = require('../../services/pipeline');

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
    return { ok: true, claim: updated, result };
  }

  if (result.status === 'TIDAK_SESUAI') {
    const updated = await updateClaim(claim.id, {
      status: 'TIDAK_SESUAI', detail: result.reason || 'Tidak sesuai', ...fields
    });
    await sendAlert('CLAIM_REJECTED', { kode_tiket: claim.kode_tiket, user_id: claim.user_id, reason: result.reason });
    await addLog('PIPELINE_GAGAL', `Claim ${claim.kode_tiket} TIDAK SESUAI: ${result.reason} (${result.mode})`, fields);
    return { ok: true, claim: updated, result };
  }

  // ERROR (NO_TOKEN / NOT_FOUND / FETCH_FAIL / INVALID_OPERATOR_SESSION)
  const updated = await updateClaim(claim.id, {
    status: 'ERROR', detail: result.reason || result.error || 'Error verifikasi', ...fields
  });
  await addLog('PIPELINE_ERROR', `Claim ${claim.kode_tiket} ERROR: ${result.reason || result.error} (${result.mode})`, fields);
  return { ok: true, claim: updated, result };
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed' });

  try {
    const { action, kode_tiket } = req.body || {};

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
};