const { fetchSites } = require('../../lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sites = await fetchSites();
    const mapped = sites.map(s => ({ site_id: s.site_id || s.id, label: s.label || s.name }));
    return res.status(200).json({ ok: true, sites: mapped });
  } catch (e) {
    return res.status(200).json({
      ok: true,
      sites: [{ site_id: 'bandar80', label: 'BANDAR80' }]
    });
  }
};
