const { getSetting, getStats, fetchNextPipelineClaim } = require('../../lib/supabase');
const { verifyClaimAuto, buildVerifyFields } = require('../../services/pipeline');
const { updateClaim, addLog } = require('../../lib/supabase');
const { sendAlert } = require('../../services/alert');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Tick pipeline: selalu catat last_run, jalankan hanya jika auto enabled
async function tick() {
  const auto = await getSetting('auto') || {};
  const run = { enabled: !!auto.enabled, interval: auto.interval || 60, last_run: new Date().toISOString() };
  if (!run.enabled) return { ok: true, skipped: true, auto: run };

  const pending = await fetchNextPipelineClaim(1);
  if (!pending.length) return { ok: true, skipped: true, auto: run, message: 'Queue kosong' };

  const claim = pending[0];
  await updateClaim(claim.id, { status: 'VERIFYING' });

  const result = await verifyClaimAuto(claim);
  result.mode = 'auto';
  const fields = buildVerifyFields(claim, result, (claim.check_attempts || 0) + 1);

  if (result.status === 'SESUAI') {
    const updated = await updateClaim(claim.id, { status: 'SESUAI', detail: 'Bet & scatter terverifikasi: SESUAI', ...fields });
    await sendAlert('BET_VERIFIED', { kode_tiket: claim.kode_tiket, user_id: claim.user_id });
    await addLog('AUTO_OK', `Auto: ${claim.kode_tiket} SESUAI`, fields);
    return { ok: true, auto: run, claim: updated, result };
  }

  if (result.status === 'TIDAK_SESUAI') {
    const updated = await updateClaim(claim.id, { status: 'TIDAK_SESUAI', detail: result.reason || 'Tidak sesuai', ...fields });
    await sendAlert('CLAIM_REJECTED', { kode_tiket: claim.kode_tiket, user_id: claim.user_id, reason: result.reason });
    await addLog('AUTO_GAGAL', `Auto: ${claim.kode_tiket} TIDAK SESUAI: ${result.reason}`, fields);
    return { ok: true, auto: run, claim: updated, result };
  }

  const updated = await updateClaim(claim.id, { status: 'ERROR', detail: result.reason || result.error || 'Error', ...fields });
  await addLog('AUTO_ERROR', `Auto: ${claim.kode_tiket} ERROR: ${result.reason || result.error}`, fields);
  return { ok: true, auto: run, claim: updated, result };
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed' });

  try {
    const { action } = req.body || {};

    if (action === 'status') {
      const [auto, stats] = await Promise.all([getSetting('auto'), getStats()]);
      return res.status(200).json({ ok: true, auto: auto || { enabled: false, interval: 60 }, stats });
    }

    if (action === 'tick') {
      const result = await tick();
      return res.status(200).json(result);
    }

    return res.status(400).json({ ok: false, message: 'Invalid action' });
  } catch (e) {
    console.error('Auto error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
};