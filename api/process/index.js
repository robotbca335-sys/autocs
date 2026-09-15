const { fetchAllClaims, updateClaim, addLog } = require('../../lib/supabase');
const { sendAlert } = require('../../services/alert');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed' });

  try {
    const { action, kode_tiket } = req.body || {};

    if (action === 'verify') {
      if (!kode_tiket) return res.status(400).json({ ok: false, message: 'kode_tiket required' });

      const result = await fetchAllClaims({ search: kode_tiket, limit: 5 });
      const claim = result.data.find(c => c.kode_tiket === kode_tiket);

      if (!claim) {
        return res.status(200).json({ ok: true, verified: false, message: 'Ticket not found in claims' });
      }

      return res.status(200).json({
        ok: true,
        verified: claim.status === 'SESUAI' || claim.status === 'INPUT_OK',
        status: claim.status,
        detail: claim.detail,
        claim
      });
    }

    if (action === 'next') {
      const pending = await fetchAllClaims({ status: 'PENDING', limit: 1 });
      if (!pending.data.length) {
        return res.status(200).json({ ok: false, message: 'No pending claims' });
      }

      const claim = pending.data[0];
      await updateClaim(claim.id, { status: 'VERIFYING' });
      await sendAlert('BET_VERIFIED', { kode_tiket: claim.kode_tiket, user_id: claim.user_id });

      return res.status(200).json({
        ok: true,
        claim: { ...claim, status: 'VERIFYING' }
      });
    }

    if (action === 'all') {
      const pending = await fetchAllClaims({ status: 'PENDING', limit: 50 });
      let processed = 0;

      for (const claim of pending.data) {
        try {
          await updateClaim(claim.id, { status: 'VERIFYING' });
          processed++;
        } catch (e) {
          console.error('Process error for', claim.id, e);
        }
      }

      await addLog('BATCH_PROCESS', `Batch processed ${processed} claims`);

      return res.status(200).json({ ok: true, processed });
    }

    return res.status(400).json({ ok: false, message: 'Invalid action' });
  } catch (e) {
    console.error('Process error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
};
