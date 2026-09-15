const { fetchAllClaims, updateClaim, addLog } = require('../../lib/supabase');
const { sendAlert } = require('../../services/alert');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { status, site, search, page, limit, id } = req.query;
      if (id) {
        const { fetchClaimById } = require('../../lib/supabase');
        const claim = await fetchClaimById(id);
        return res.status(200).json({ ok: true, rows: [claim] });
      }
      const result = await fetchAllClaims({ status, site, search, page: parseInt(page || '1'), limit: parseInt(limit || '50') });
      return res.status(200).json({ ok: true, rows: result.data, total: result.total });
    }

    if (req.method === 'POST') {
      const { id, status, detail } = req.body || {};
      if (!id || !status) {
        return res.status(400).json({ ok: false, message: 'id and status required' });
      }

      const updates = { status };
      if (detail) updates.detail = detail;

      const updated = await updateClaim(id, updates);

      const alertType = status === 'SESUAI' ? 'CLAIM_APPROVED' : status === 'TIDAK_SESUAI' ? 'CLAIM_REJECTED' : 'CLAIM_RECEIVED';
      await sendAlert(alertType, {
        user_id: updated.user_id,
        kode_tiket: updated.kode_tiket,
        status
      });

      await addLog('CLAIM_UPDATED', `Claim ${updated.kode_tiket} -> ${status}`, { id, user_id: updated.user_id });

      return res.status(200).json({ ok: true, claim: updated });
    }

    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  } catch (e) {
    console.error('Manage error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
};
