const { insertClaim, countTodayClaims, fetchClaimByCode } = require('../../lib/supabase');
const { validateClaimInput, isDuplicateCode, hasExcessiveRepeat } = require('../../services/bet-verify');
const { sendAlert } = require('../../services/alert');

const DAILY_LIMIT = parseInt(process.env.CLAIM_DAILY_LIMIT || '2');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed' });

  try {
    const { site, user_id, kode_tiket, betting, scatter, website, company } = req.body || {};

    if (website || company) {
      return res.status(200).json({ ok: true, message: 'Tiket diterima.' });
    }

    const errors = validateClaimInput(site, user_id, kode_tiket, betting, scatter);
    if (errors.length) {
      return res.status(400).json({ ok: false, message: errors[0], code: 'VALIDATION' });
    }

    if (isDuplicateCode(kode_tiket) || hasExcessiveRepeat(kode_tiket)) {
      return res.status(400).json({ ok: false, message: 'Kode tiket tidak valid.', code: 'BAD_CODE' });
    }

    const cleanCode = String(kode_tiket).trim();
    const existing = await fetchClaimByCode(cleanCode);
    if (existing) {
      return res.status(400).json({
        ok: false,
        message: 'Kode tiket ini sudah pernah diklaim. Setiap kode tiket hanya bisa dipakai 1 kali.',
        code: 'DUPLICATE_CODE'
      });
    }

    const cleanUser = String(user_id).trim();
    const todayCount = await countTodayClaims(cleanUser);
    if (todayCount >= DAILY_LIMIT) {
      return res.status(400).json({
        ok: false,
        message: `Anda sudah ${DAILY_LIMIT} kali claim hari ini. Coba kembali setelah ganti hari.`,
        code: 'LIMIT_DAILY'
      });
    }

    const betNum = parseInt(String(betting).replace(/\D/g, ''), 10);
    const claim = await insertClaim({
      site: String(site).trim(),
      user_id: cleanUser,
      kode_tiket: String(kode_tiket).trim(),
      betting: betNum,
      scatter: parseInt(scatter, 10),
      status: 'PENDING',
      detail: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    await sendAlert('CLAIM_RECEIVED', { user_id: cleanUser, kode_tiket: String(kode_tiket).trim(), site });

    return res.status(200).json({
      ok: true,
      message: 'Tiket scatter diterima — sedang diverifikasi.',
      id: claim.id
    });
  } catch (e) {
    console.error('Submit error:', e);
    if (e && (e.code === '23505' || (e.message && e.message.indexOf('duplicate key') !== -1))) {
      return res.status(400).json({
        ok: false,
        message: 'Kode tiket ini sudah pernah diklaim. Setiap kode tiket hanya bisa dipakai 1 kali.',
        code: 'DUPLICATE_CODE'
      });
    }
    return res.status(500).json({ ok: false, message: 'Gagal mengirim klaim. Coba lagi.', code: 'SERVER_ERROR' });
  }
};
