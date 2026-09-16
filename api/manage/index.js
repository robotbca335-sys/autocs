const {
  fetchAllClaims, updateClaim, addLog,
  fetchRelaxRows, fetchAllRelaxRows, insertRelaxRow, insertRelaxRows, updateRelaxRow,
  deleteRelaxRows, clearRelaxRows, fetchRelaxLogs, addRelaxLog, clearRelaxLogs,
  fetchMemos, addMemo, deleteMemo, fetchTypingTop, submitTypingScore,
  pingDevice, fetchOnlineEmails
} = require('../../lib/supabase');
const { sendAlert } = require('../../services/alert');
const { createTokenBucket, wrapWithRateLimit } = require('../../lib/rate-limit');

const bucket = createTokenBucket({ windowMs: 60000, max: 120 });

module.exports = wrapWithRateLimit(async (req, res) => {
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
      const body = req.body || {};
      const { action } = body;

      // ===== AKSI BONUSSMB REST (approve/reject server-side, tanpa klik DOM) =====
      if (action && action.indexOf('bonus_') === 0) {
        const api = require('../../lib/bonussmb-api');
        if (action === 'bonus_login') {
          const r = await api.bonusLogin(String(body.email || '').trim(), String(body.password || ''));
          if (!r.ok) await addLog('BONUS_LOGIN_ERR', 'Login bonussmb gagal: ' + r.message);
          return res.status(r.ok ? 200 : 401).json({ ok: r.ok, ...r, message: r.message });
        }
        if (action === 'bonus_2fa') {
          const r = await api.bonusTwoFactor(String(body.code || '').trim());
          return res.status(r.ok ? 200 : 400).json({ ok: r.ok, message: r.message, details: r.details });
        }
        if (action === 'bonus_logout') {
          await api.clearSession();
          await addLog('BONUS_LOGOUT', 'Sesi bonussmb dibersihkan');
          return res.status(200).json({ ok: true });
        }
        if (action === 'bonus_session') {
          const info = await api.sessionInfo();
          return res.status(200).json({ ok: true, session: info });
        }
        if (action === 'bonus_list') {
          const r = await api.fetchTickets({ status: body.status, page: body.page, limit: body.limit || 100, search: body.search });
          return res.status(r.ok ? 200 : (r.unauth ? 401 : 400)).json(r);
        }
        if (action === 'bonus_submit') {
          const r = await api.createTicket({
            userId: body.userId || body.user_id,
            ticketCode: body.ticketCode || body.kode_tiket || body.code,
            link: body.link || body.screenshots
          });
          if (!r.ok) await addLog('BONUS_SUBMIT_ERR', 'Create tiket bonussmb gagal: ' + (r.message || ''));
          else await addLog('BONUS_SUBMIT', 'Create tiket bonussmb OK: ' + (body.ticketCode || ''));
          return res.status(r.ok ? 200 : (r.unauth ? 401 : 400)).json({ ok: r.ok, message: r.message, details: r.details, ticket: r.ticket });
        }
        if (action === 'bonus_form_data') {
          const r = await api.fetchTicketFormData();
          return res.status(r.ok ? 200 : (r.unauth ? 401 : 400)).json(r);
        }
        if (action === 'bonus_approve' || action === 'bonus_reject') {
          const id = body.id || (body.ticket && body.ticket.id);
          const reason = body.reason || '';
          if (!id) return res.status(400).json({ ok: false, message: 'id tiket wajib' });
          const status = action === 'bonus_approve' ? 'proccessing' : 'rejected';
          const r = await api.updateTicketStatus(id, { status, reason });
          await addLog('BONUS_' + (action === 'bonus_approve' ? 'APPROVE' : 'REJECT'), (r.ok ? 'OK ' : 'GAGAL ') + id + (reason ? ' · ' + reason.slice(0,120) : '') + (r.message ? ' · ' + r.message : ''));
          return res.status(r.ok ? 200 : (r.unauth ? 401 : 400)).json({ ok: r.ok, message: r.message, details: r.details });
        }
        return res.status(400).json({ ok: false, message: 'action bonus tidak dikenal: ' + action });
      }

      // ===== AUTO RELAX WEB: rows & logs (numpang route /api/manage) =====
      if (action && action.indexOf('relax_') === 0) {
        if (action === 'relax_rows') {
          const result = await fetchRelaxRows({
            search: body.search,
            status: body.status,
            page: parseInt(body.page || '1'),
            limit: parseInt(body.limit || '50')
          });
          return res.status(200).json({ ok: true, rows: result.data, total: result.total });
        }
        if (action === 'relax_rows_all') {
          const rows = await fetchAllRelaxRows();
          return res.status(200).json({ ok: true, rows });
        }
        if (action === 'relax_add') {
          const payload = Array.isArray(body.rows) ? body.rows : [body.row || body];
          const rows = await insertRelaxRows(payload.map(x => ({
            ...x,
            kodeTiket: x.kodeTiket || x.kode_tiket || x.kode || ''
          })));
          await addRelaxLog(rows.length + ' baris ditambahkan');
          await addLog('RELAX_ADD', rows.length + ' baris relax ditambahkan');
          return res.status(200).json({ ok: true, rows });
        }
        if (action === 'relax_update') {
          const row = await updateRelaxRow(body.id, body.row || body);
          return res.status(200).json({ ok: true, row });
        }
        if (action === 'relax_delete') {
          const n = await deleteRelaxRows(body.ids);
          await addRelaxLog(n + ' baris dihapus');
          return res.status(200).json({ ok: true, deleted: n });
        }
        if (action === 'relax_clear_rows') {
          await clearRelaxRows();
          await addRelaxLog('Semua baris dihapus');
          return res.status(200).json({ ok: true });
        }
        if (action === 'relax_replace') {
          const payload = Array.isArray(body.rows) ? body.rows : [];
          await clearRelaxRows();
          if (payload.length) {
            await insertRelaxRows(payload.map(x => ({ ...x, kodeTiket: x.kodeTiket || x.kode_tiket || x.kode || '' })));
          }
          return res.status(200).json({ ok: true, count: payload.length });
        }
        if (action === 'relax_logs') {
          const logs = await fetchRelaxLogs(parseInt(body.limit || '200'));
          return res.status(200).json({ ok: true, logs });
        }
        if (action === 'relax_add_log') {
          await addRelaxLog(body.message || '', body.level || 'info');
          return res.status(200).json({ ok: true });
        }
        if (action === 'relax_clear_logs') {
          await clearRelaxLogs();
          return res.status(200).json({ ok: true });
        }
        return res.status(400).json({ ok: false, message: 'action relax tidak dikenal: ' + action });
      }

      // ===== AUTO RELAX WEB: memo & typing (fitur tambahan) =====
      if (action === 'memo_add') {
        const memo = await addMemo({
          authorEmail: body.authorEmail || '',
          authorName: body.authorName || '',
          content: String(body.content || '').substring(0, 500)
        });
        return res.status(200).json({ ok: true, memo });
      }
      if (action === 'memo_list') {
        const memos = await fetchMemos({ since: body.since, limit: parseInt(body.limit || '100') });
        return res.status(200).json({ ok: true, memos });
      }
      if (action === 'memo_delete') {
        await deleteMemo(body.id);
        return res.status(200).json({ ok: true });
      }
      if (action === 'typing_top') {
        const rows = await fetchTypingTop(parseInt(body.limit || '200'));
        return res.status(200).json({ ok: true, rows });
      }
      if (action === 'typing_submit') {
        await submitTypingScore({
          email: body.email || '',
          name: body.name || '',
          wpm: body.wpm,
          accuracy: body.accuracy,
          correct: body.correct,
          wrong: body.wrong
        });
        return res.status(200).json({ ok: true });
      }
      if (action === 'device_ping') {
        await pingDevice({ deviceId: body.deviceId, email: body.email });
        return res.status(200).json({ ok: true });
      }
      if (action === 'online_devices') {
        const emails = await fetchOnlineEmails(body.since);
        return res.status(200).json({ ok: true, emails });
      }

      const { id, status, detail } = body;
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
}, bucket);
