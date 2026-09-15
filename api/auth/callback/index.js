const { callback, sendJson } = require('../../../lib/auth-handler');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.SITE_URL || 'https://scatter-claim.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  try {
    return await callback(req, res);
  } catch (e) {
    return sendJson(res, 500, { ok: false, message: 'Internal error' });
  }
};
