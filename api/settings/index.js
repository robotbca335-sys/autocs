const { getSetting, setSetting, addLog } = require('../../lib/supabase');
const { createTokenBucket, wrapWithRateLimit } = require('../../lib/rate-limit');
const { grabAllAccounts, cekRekAccount } = require('../../lib/idrbo-grab');

const bucket = createTokenBucket({ windowMs: 60000, max: 90 });

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

const IDRBO_DOMAIN_DEFAULTS = ['idrbo.com', 'idrbo1.com', 'idrbo2.com', 'idrbo3.com', 'idrbo4.com'];;

module.exports = wrapWithRateLimit(async (req, res) => {
  cors(res);
  const rl = require('../../lib/rate-limit');
  const guard = rl.globalRpsLimiter.hit(req, res);
  if (guard.limited) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const [history, auto, limits, admin, idrbo, idrboDomains, sensor, bonus] = await Promise.all([
        getSetting('history'),
        getSetting('auto'),
        getSetting('limits'),
        getSetting('admin'),
        getSetting('idrbo'),
        getSetting('idrboDomains'),
        getSetting('sensor'),
        getSetting('bonus')
      ]);
      const domList = Array.isArray(idrboDomains && idrboDomains.domains) ? idrboDomains.domains : [];
      return res.status(200).json({
        ok: true,
        settings: {
          bonus: {
            autoDecision: !!(bonus && bonus.autoDecision),
            loggedIn: !!(bonus && bonus.login && bonus.login.email),
            loginEmail: (bonus && bonus.login && bonus.login.email) || '',
            loginAt: (bonus && bonus.login && bonus.login.at) || '',
            updated_at: (bonus && bonus.updated_at) || '',
            cookies: (bonus && Array.isArray(bonus.cookies)) ? bonus.cookies.length : 0
          },
          history: history ? { host: history.host || '', gameId: history.gameId || '', executor: history.executor || '', token_masked: maskToken(history.token) } : null,
          auto: auto || { enabled: false, interval: 60 },
          limits: limits || { dailyLimit: 2, betMin: 1600, betMax: 10000000 },
          idrboDomains: domList.length ? domList : IDRBO_DOMAIN_DEFAULTS,
          sensor: sensor ? {
            adminUrl: sensor.adminUrl || '',
            userid: sensor.userid || '',
            pkid: sensor.pkid || '', role: sensor.role || '', suid: sensor.suid || '',
            updated_at: sensor.updated_at || '',
            token_masked: maskToken(sensor.token), historyToken_masked: maskToken(sensor.historyToken)
          } : null,
          admin: admin ? {
            adminUrl: admin.adminUrl || '',
            pkid: admin.pkid || '', role: admin.role || '', suid: admin.suid || '',
            userAgent: admin.userAgent || '', userid: admin.userid || '',
            allowed_emails: Array.isArray(admin.allowed_emails) ? admin.allowed_emails : [],
            token_masked: maskToken(admin.token), historyToken_masked: maskToken(admin.historyToken)
          } : null,
          idrbo: idrbo ? { accounts: (Array.isArray(idrbo.accounts) ? idrbo.accounts : []).map(function (a) {
            return {
              name: a.name || '', adminUrl: a.adminUrl || '', userid: a.userid || '',
              suid: a.suid || '', role: a.role || '', pkid: a.pkid || '', userAgent: a.userAgent || '',
              token_masked: maskToken(a.token), historyToken_masked: maskToken(a.historyToken)
            };
          }) } : { accounts: [] }
        }
      });
    }

    if (req.method === 'POST') {
      const { key, value } = req.body || {};
      if (!key || (value === undefined && key !== 'idrboGrab')) {
        return res.status(400).json({ ok: false, message: 'key and value required' });
      }

      if (key === 'idrbo') {
        const prev = await getSetting('idrbo') || { accounts: [] };
        const prevAccounts = Array.isArray(prev.accounts) ? prev.accounts : [];
        const nextArr = Array.isArray(value.accounts) ? value.accounts : [];
        const next = { accounts: nextArr.map(function (a, idx) {
          const oldA = prevAccounts[idx] || {};
          return {
            name: String(a.name || oldA.name || ('Akun ' + (idx + 1))).slice(0, 60),
            adminUrl: String(a.adminUrl || oldA.adminUrl || '').slice(0, 300),
            // 'CLEAR' hapus token; kosong = pertahankan yang lama
            token: a.token === 'CLEAR' ? '' : (a.token ? String(a.token) : (oldA.token || '')),
            historyToken: a.historyToken === 'CLEAR' ? '' : (a.historyToken ? String(a.historyToken) : (oldA.historyToken || '')),
            userid: String(a.userid || oldA.userid || '').slice(0, 100),
            pkid: String(a.pkid || oldA.pkid || '').slice(0, 100),
            suid: String(a.suid || oldA.suid || '').slice(0, 100),
            role: String(a.role || oldA.role || '').slice(0, 50),
            userAgent: String(a.userAgent || oldA.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36').slice(0, 500)
          };
        }) };
        await setSetting('idrbo', next);
        await addLog('SETTINGS_IDRBO', 'Konfigurasi idrbo diperbarui (' + next.accounts.length + ' akun)');
        return res.status(200).json({ ok: true, settings: { idrbo: { accounts: next.accounts.map(function (a) {
          return { id: a.name, name: a.name, adminUrl: a.adminUrl || '', userid: a.userid || '', suid: a.suid || '', pkid: a.pkid || '', role: a.role || '', userAgent: a.userAgent || '', token_masked: maskToken(a.token), historyToken_masked: maskToken(a.historyToken) };
        }) } } });
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
          token: value.token === 'CLEAR' ? '' : (value.token ? value.token : (prev.token || '')),
          allowed_emails: Array.isArray(value.allowed_emails) && value.allowed_emails.length
            ? value.allowed_emails.map(String).filter(Boolean)
            : (Array.isArray(prev.allowed_emails) ? prev.allowed_emails : [])
        };
        await setSetting('admin', next);
        await addLog('SETTINGS_ADMIN', 'Header admin panel diperbarui');
        return res.status(200).json({ ok: true, settings: { admin: { adminUrl: next.adminUrl, pkid: next.pkid, role: next.role, suid: next.suid, userAgent: next.userAgent, userid: next.userid, allowed_emails: next.allowed_emails || [], token_masked: maskToken(next.token), historyToken_masked: maskToken(next.historyToken) } } });
      }

      if (key === 'sensor') {
        const prev = await getSetting('sensor') || {};
        const next = {
          adminUrl: value.cleared ? '' : (value.adminUrl || prev.adminUrl || ''),
          userid: value.cleared ? '' : (value.userid ? String(value.userid).slice(0, 60) : (prev.userid || '')),
          pkid: value.cleared ? '' : (value.pkid ? String(value.pkid).slice(0, 60) : (prev.pkid || '')),
          suid: value.cleared ? '' : (value.suid ? String(value.suid).slice(0, 60) : (prev.suid || '')),
          role: value.cleared ? '' : (value.role ? String(value.role).slice(0, 60) : (prev.role || '')),
          userAgent: value.cleared ? '' : (value.userAgent || prev.userAgent || ''),
          token: value.cleared || value.token === 'CLEAR' ? '' : (value.token ? String(value.token) : (prev.token || '')),
          historyToken: value.cleared || value.historyToken === 'CLEAR' ? '' : (value.historyToken ? String(value.historyToken) : (prev.historyToken || '')),
          updated_at: new Date().toISOString()
        };
        await setSetting('sensor', next);
        return res.status(200).json({ ok: true, settings: { sensor: { updated_at: next.updated_at, token_masked: maskToken(next.token), historyToken_masked: maskToken(next.historyToken) } } });
      }

      if (key === 'staff') {
        const prev = await getSetting('admin') || {};
        const nt = new Date().toISOString();
        if (Array.isArray(value)) {
          const next = Object.assign({}, prev, { allowed_emails: value.map(String).filter(Boolean) });
          next.updated_at = nt;
          await setSetting('admin', next);
          return res.status(200).json({ ok: true, settings: { admin: { allowed_emails: next.allowed_emails || [] } } });
        }
        const email = String(value.email || '').trim().toLowerCase();
        const add = value.add === true || value.add === 'true';
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          return res.status(400).json({ ok: false, message: 'Email tidak valid' });
        }
        const list = Array.isArray(prev.allowed_emails) ? prev.allowed_emails : [];
        const next = Object.assign({}, prev, {
          allowed_emails: add ? (list.indexOf(email) === -1 ? list.concat([email]) : list) : list.filter(function (x) { return x !== email; }),
          updated_at: nt
        });
        await setSetting('admin', next);
        await addLog('SETTINGS_STAFF', (add ? 'Tambah' : 'Hapus') + ' staf: ' + email);
        return res.status(200).json({ ok: true, settings: { admin: { allowed_emails: next.allowed_emails || [] } } });
      }

      if (key === 'idrboDomains') {
        const raw = Array.isArray(value && value.domains) ? value.domains : (typeof value === 'string' ? value.split(',') : []);
        const domains = (Array.isArray(value && value.domains)
          ? (value.domains || [])
          : (Array.isArray(value) ? value : String(value || '').split(',') || [])
        ).map(String).map(function (s) { return s.trim(); }).filter(Boolean);
        await setSetting('idrboDomains', { domains: domains.length ? domains : IDRBO_DOMAIN_DEFAULTS });
        await addLog('SETTINGS_DOMAINS', 'Daftar domain idrbo: ' + domains.join(', '));
        return res.status(200).json({ ok: true, settings: { idrboDomains: domains.length ? domains : IDRBO_DOMAIN_DEFAULTS } });
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

      if (key === 'bonus') {
        const prev = await getSetting('bonus') || {};
        const next = Object.assign({}, prev, { autoDecision: value.autoDecision === true || value.autoDecision === 'true' });
        await setSetting('bonus', next);
        await addLog('SETTINGS_BONUS', 'Auto keputusan bonussmb: ' + (next.autoDecision ? 'ON' : 'OFF'));
        return res.status(200).json({ ok: true, settings: { bonus: { autoDecision: !!next.autoDecision, loggedIn: !!(next.login && next.login.email), loginEmail: (next.login && next.login.email) || '' } } });
      }

      if (key === 'idrboGrab') {
        try {
          const grabResult = await grabAllAccounts();
          await addLog('IDRBO_GRAB', 'Grab dikerjakan: ' + grabResult.count + ' akun');
          return res.status(200).json({ ok: true, grab: grabResult });
        } catch (e) {
          return res.status(500).json({ ok: false, message: 'Grab gagal: ' + (e.message || e) });
        }
      }

      if (key === 'idrboCekRek') {
        const idrbo = await getSetting('idrbo') || { accounts: [] };
        const accounts = Array.isArray(idrbo.accounts) ? idrbo.accounts : [];
        const pickIdx = parseInt((value.accountIdx || '0'), 10);
        const acc = accounts[pickIdx] || accounts[0] || {};
        const userId = String(value.userId || acc.userid || '').trim();
        if (!userId) return res.status(400).json({ ok: false, message: 'userId kosong' });
        try {
          const rek = await cekRekAccount(acc, userId);
          await addLog('IDRBO_CEK_REK', 'Cek Rek: ' + userId + ' → ' + (rek.ok ? rek.noRek + ' ' + rek.nama : rek.error));
          return res.status(200).json({ ok: true, cekRek: rek });
        } catch (e) {
          return res.status(500).json({ ok: false, message: 'Cek Rek gagal: ' + (e.message || e) });
        }
      }

      return res.status(400).json({ ok: false, message: 'Unsupported key' });
    }

    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  } catch (e) {
    console.error('Settings error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}, bucket);