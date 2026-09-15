const { getSetting, setSetting, addLog } = require('../../lib/supabase');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function maskToken(token) {
  if (!token) return '';
  if (token.length <= 8) return '***';
  return token.slice(0, 4) + '…' + token.slice(-4);
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const [history, auto, limits, admin] = await Promise.all([
        getSetting('history'),
        getSetting('auto'),
        getSetting('limits'),
        getSetting('admin')
      ]);
      return res.status(200).json({
        ok: true,
        settings: {
          history: history ? { host: history.host || '', gameId: history.gameId || '', executor: history.executor || '', token_masked: maskToken(history.token) } : null,
          auto: auto || { enabled: false, interval: 60 },
          limits: limits || { dailyLimit: 2, betMin: 1600, betMax: 10000000 },
          admin: admin ? {
            adminUrl: admin.adminUrl || '',
            pkid: admin.pkid || '', role: admin.role || '', suid: admin.suid || '',
            userAgent: admin.userAgent || '', userid: admin.userid || '',
            token_masked: maskToken(admin.token), historyToken_masked: maskToken(admin.historyToken)
          } : null
        }
      });
    }

    if (req.method === 'POST') {
      const { key, value } = req.body || {};
      if (!key || value === undefined) {
        return res.status(400).json({ ok: false, message: 'key and value required' });
      }

      if (key === 'history') {
        const prev = await getSetting('history') || {};
        const next = {
          host: value.host || prev.host || '',
          gameId: value.gameId || prev.gameId || '',
          executor: value.executor || prev.executor || '',
          // 'CLEAR' hapus token; string kosong = pertahankan token lama
          token: value.token === 'CLEAR' ? '' : (value.token ? value.token : (prev.token || ''))
        };
        await setSetting('history', next);
        await addLog('SETTINGS_HISTORY', 'Konfigurasi history API diperbarui');
        return res.status(200).json({ ok: true, settings: { history: { host: next.host, gameId: next.gameId, executor: next.executor, token_masked: maskToken(next.token) } } });
      }

      if (key === 'admin') {
        const prev = await getSetting('admin') || {};
        const next = {
          adminUrl: value.adminUrl || prev.adminUrl || '',
          pkid: value.pkid || prev.pkid || '',
          role: value.role || prev.role || '',
          suid: value.suid || prev.suid || '',
          userAgent: value.userAgent || prev.userAgent || '',
          userid: value.userid || prev.userid || '',
          historyToken: value.historyToken === 'CLEAR' ? '' : (value.historyToken ? value.historyToken : (prev.historyToken || '')),
          token: value.token === 'CLEAR' ? '' : (value.token ? value.token : (prev.token || ''))
        };
        await setSetting('admin', next);
        await addLog('SETTINGS_ADMIN', 'Header admin panel diperbarui');
        return res.status(200).json({ ok: true, settings: { admin: { adminUrl: next.adminUrl, pkid: next.pkid, role: next.role, suid: next.suid, userAgent: next.userAgent, userid: next.userid, token_masked: maskToken(next.token), historyToken_masked: maskToken(next.historyToken) } } });
      }

      if (key === 'auto') {
        const next = { enabled: !!value.enabled, interval: parseInt(value.interval || '60', 10) };
        await setSetting('auto', next);
        await addLog('SETTINGS_AUTO', `Auto-mode: ${next.enabled ? 'ON' : 'OFF'} (interval ${next.interval}s)`);
        return res.status(200).json({ ok: true, settings: { auto: next } });
      }

      if (key === 'limits') {
        const next = { dailyLimit: parseInt(value.dailyLimit || '2', 10), betMin: parseInt(value.betMin || '1600', 10), betMax: parseInt(value.betMax || '10000000', 10) };
        await setSetting('limits', next);
        await addLog('SETTINGS_LIMITS', 'Batas klaim diperbarui');
        return res.status(200).json({ ok: true, settings: { limits: next } });
      }

      return res.status(400).json({ ok: false, message: 'Unsupported key' });
    }

    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  } catch (e) {
    console.error('Settings error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
};