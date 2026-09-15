const { fetchClaimsByUser, countTodayClaims } = require('../../lib/supabase');

const DAILY_LIMIT = parseInt(process.env.CLAIM_DAILY_LIMIT || '2');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ ok: false, message: 'user_id wajib', code: 'BAD_USER' });
    }

    const [rows, used] = await Promise.all([
      fetchClaimsByUser(String(user_id).trim()),
      countTodayClaims(String(user_id).trim())
    ]);

    return res.status(200).json({
      ok: true,
      rows,
      used,
      max: DAILY_LIMIT,
      table: rows
    });
  } catch (e) {
    console.error('Track error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
};
