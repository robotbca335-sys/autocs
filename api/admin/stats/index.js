const { getStats } = require('../../../lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const stats = await getStats();
    return res.status(200).json({ ok: true, stats });
  } catch (e) {
    console.error('Stats error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
};