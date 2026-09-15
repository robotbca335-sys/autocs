const { fetchAllClaims, fetchClaimById } = require('../../../lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { status, site, search, page, limit, id } = req.query;

    if (id) {
      const claim = await fetchClaimById(id);
      return res.status(200).json({ ok: true, rows: claim ? [claim] : [] });
    }

    const result = await fetchAllClaims({
      status,
      site,
      search,
      page: parseInt(page || '1'),
      limit: parseInt(limit || '50')
    });

    return res.status(200).json({ ok: true, rows: result.data, total: result.total });
  } catch (e) {
    console.error('Admin claims error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
};