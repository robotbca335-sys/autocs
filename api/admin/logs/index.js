const { fetchLogs } = require('../../../lib/supabase');
const { getClient } = require('../../../lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'DELETE') {
      const sb = getClient();
      const { error } = await sb.from('logs').delete().neq('id', 0);
      if (error) throw error;
      return res.status(200).json({ ok: true, message: 'Logs cleared' });
    }

    const limit = parseInt(req.query.limit || '100');
    const logs = await fetchLogs(limit);
    return res.status(200).json({ ok: true, logs });
  } catch (e) {
    console.error('Admin logs error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
};