const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

let _client = null;

function getClient() {
  if (!_client) {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
    }
    _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false }
    });
  }
  return _client;
}

async function fetchSites() {
  const sb = getClient();
  const { data, error } = await sb.from('sites')
    .select('*')
    .eq('active', true)
    .order('label');
  if (error) throw error;
  return data || [];
}

async function insertClaim(row) {
  const sb = getClient();
  const { data, error } = await sb.from('claims').insert(row).select().single();
  if (error) throw error;
  return data;
}

async function fetchClaimsByUser(userId) {
  const sb = getClient();
  const { data, error } = await sb.from('claims')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data || [];
}

async function countTodayClaims(userId) {
  const sb = getClient();
  const nowWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const startOfDayWIB = new Date(nowWIB);
  startOfDayWIB.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(startOfDayWIB.getTime() - 7 * 60 * 60 * 1000);
  const { count, error } = await sb.from('claims')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', todayStart.toISOString());
  if (error) throw error;
  return count || 0;
}

async function fetchClaimByCode(kodeTiket) {
  const sb = getClient();
  const { data, error } = await sb.from('claims')
    .select('*')
    .eq('kode_tiket', kodeTiket)
    .limit(1);
  if (error) throw error;
  return data && data.length ? data[0] : null;
}

async function fetchAllClaims(opts = {}) {
  const sb = getClient();
  let q = sb.from('claims').select('*');
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.site) q = q.eq('site', opts.site);
  if (opts.search) {
    q = q.or(`user_id.ilike.%${opts.search}%,kode_tiket.ilike.%${opts.search}%`);
  }
  const page = opts.page || 1;
  const limit = opts.limit || 50;
  const from = (page - 1) * limit;
  q = q.order('created_at', { ascending: false }).range(from, from + limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { data: data || [], total: count };
}

async function updateClaim(id, updates) {
  const sb = getClient();
  const { data, error } = await sb.from('claims')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function fetchClaimById(id) {
  const sb = getClient();
  const { data, error } = await sb.from('claims')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

async function getStats() {
  const sb = getClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString();

  const counts = async (status) => sb.from('claims').select('*', { count: 'exact', head: true }).eq('status', status);

  const [total, pending, approved, rejected, todayCount, queue, verifying, done, failed, error] = await Promise.all([
    sb.from('claims').select('*', { count: 'exact', head: true }),
    counts('PENDING'),
    counts('SESUAI'),
    counts('TIDAK_SESUAI'),
    sb.from('claims').select('*', { count: 'exact', head: true }).gte('created_at', todayStr),
    counts('PENDING'),
    counts('VERIFYING'),
    counts('INPUT_OK'),
    counts('INPUT_FAIL'),
    counts('ERROR')
  ]);

  return {
    total: total.count || 0,
    pending: pending.count || 0,
    approved: approved.count || 0,
    rejected: rejected.count || 0,
    today: todayCount.count || 0,
    queue: queue.count || 0,
    active: verifying.count || 0,
    done: done.count || 0,
    failed: failed.count || 0,
    error: error.count || 0
  };
}

async function getSetting(key) {
  const sb = getClient();
  const { data, error } = await sb.from('settings')
    .select('value')
    .eq('key', key)
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') return null;
  return data && data.value ? data.value : null;
}

async function setSetting(key, value) {
  const sb = getClient();
  const { data, error } = await sb.from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select()
    .single();
  if (error) throw error;
  return data && data.value;
}

// Ambil claim PENDING tertua untuk diproses pipeline (FIFO)
async function fetchNextPipelineClaim(limit = 1) {
  const sb = getClient();
  const { data, error } = await sb.from('claims')
    .select('*')
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function fetchLogs(limit = 100) {
  const sb = getClient();
  const { data, error } = await sb.from('logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function addLog(action, detail, meta = {}) {
  const sb = getClient();
  await sb.from('logs').insert({ action, detail, meta, created_at: new Date().toISOString() });
}

// ============ AUTO RELAX WEB (mirip chrome.storage ekstensi) ============

async function fetchRelaxRows(opts = {}) {
  const sb = getClient();
  let q = sb.from('relax_rows').select('*');
  if (opts.search) {
    const s = String(opts.search).trim();
    if (s) q = q.or(`"user".ilike.%${s}%,kode_tiket.ilike.%${s}%,kode2.ilike.%${s}%,transaction_id.ilike.%${s}%`);
  }
  if (opts.status) {
    const st = String(opts.status);
    if (st === 'APPROVED') q = q.eq('auto_status', 'APPROVED');
    else if (st === 'REJECTED') q = q.eq('auto_status', 'REJECTED');
    else if (st === 'PENDING') q = q.or('auto_status.eq.,auto_status.eq.ANTRI');
    else if (st === 'NOTFOUND') q = q.or('manual_status.eq."Ticket Not Found",manual_status.eq."Session Timeout",auto_col10.eq."Tidak Ditemukan Scatter",auto_col10.eq."Scatter Not Found"');
  }
  const page = opts.page || 1;
  const limit = opts.limit || 50;
  const from = (page - 1) * limit;
  q = q.order('id', { ascending: false }).range(from, from + limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { data: data || [], total: count };
}

async function fetchAllRelaxRows() {
  const sb = getClient();
  const { data, error } = await sb.from('relax_rows').select('*').order('id', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowify);
}

async function insertRelaxRow(row) {
  const sb = getClient();
  const { data, error } = await sb.from('relax_rows').insert(rowifyIn(row)).select().single();
  if (error) throw error;
  return rowify(data);
}

async function insertRelaxRows(rows) {
  const sb = getClient();
  const { data, error } = await sb.from('relax_rows').insert(rows.map(rowifyIn)).select();
  if (error) throw error;
  return (data || []).map(rowify);
}

async function updateRelaxRow(id, patch) {
  const sb = getClient();
  const { data, error } = await sb.from('relax_rows')
    .update({ ...rowifyIn(patch), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return rowify(data);
}

async function deleteRelaxRows(ids) {
  const sb = getClient();
  const idList = (Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean);
  if (!idList.length) return 0;
  const { data, error } = await sb.from('relax_rows').delete().in('id', idList).select('id');
  if (error) throw error;
  return (data || []).length;
}

async function clearRelaxRows() {
  const sb = getClient();
  const { error } = await sb.from('relax_rows').delete().neq('id', 0);
  if (error) throw error;
}

async function fetchRelaxLogs(limit = 200) {
  const sb = getClient();
  const { data, error } = await sb.from('relax_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function addRelaxLog(message, level = 'info') {
  try {
    const sb = getClient();
    await sb.from('relax_logs').insert({ message: String(message).substring(0, 2000), level, created_at: new Date().toISOString() });
  } catch (_) {}
}

async function clearRelaxLogs() {
  const sb = getClient();
  const { error } = await sb.from('relax_logs').delete().neq('id', 0);
  if (error) throw error;
}

// --- MEMO (fitur memo bersama) ---
async function fetchMemos(opts = {}) {
  const sb = getClient();
  let q = sb.from('memos').select('id, author_email, author_name, message, created_at');
  if (opts.since) q = q.gt('created_at', opts.since);
  q = q.order('created_at', { ascending: false }).limit(opts.limit || 100);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(m => ({
    id: m.id,
    author_email: m.author_email || '',
    author_name: m.author_name || '',
    message: m.message || '',
    created_at: m.created_at
  }));
}

async function addMemo(input) {
  const sb = getClient();
  const { data, error } = await sb.from('memos').insert({
    author_email: input.authorEmail || '',
    author_name: input.authorName || '',
    message: input.content || input.message || ''
  }).select().single();
  if (error) throw error;
  return {
    id: data.id,
    author_email: data.author_email || '',
    author_name: data.author_name || '',
    message: data.message || '',
    created_at: data.created_at
  };
}

async function deleteMemo(id) {
  const sb = getClient();
  const { error } = await sb.from('memos').delete().eq('id', id);
  if (error) throw error;
}

// --- TYPING RANKINGS (dedupe best-per-email) ---
async function fetchTypingTop(limit = 200) {
  const sb = getClient();
  const { data, error } = await sb.from('typing_rankings').select('*').order('wpm', { ascending: false }).limit(Math.max(limit, 200) * 2);
  if (error) throw error;
  const best = new Map();
  (data || []).forEach(r => {
    const key = String(r.email || '').toLowerCase();
    const prev = best.get(key);
    const score = Number(r.wpm) || 0;
    const acc = Number(r.accuracy) || 0;
    if (!prev || score > prev.wpm || (score === prev.wpm && acc > prev.accuracy)) {
      best.set(key, {
        email: r.email || '',
        name: r.name || '',
        wpm: score,
        accuracy: acc,
        correct: Number(r.correct) || 0,
        wrong: Number(r.wrong) || 0,
        createdAt: r.created_at
      });
    }
  });
  return Array.from(best.values()).sort((a, b) => b.wpm - a.wpm || b.accuracy - a.accuracy).slice(0, limit || 200);
}

async function submitTypingScore(input) {
  const sb = getClient();
  const { error } = await sb.from('typing_rankings').insert({
    email: input.email || '',
    name: input.name || '',
    wpm: Number(input.wpm) || 0,
    accuracy: Number(input.accuracy) || 0,
    correct: Number(input.correct) || 0,
    wrong: Number(input.wrong) || 0
  });
  if (error) throw error;
}

// --- DEVICES (online stats) ---
async function pingDevice(input) {
  const sb = getClient();
  const { error } = await sb.from('devices').upsert({
    device_id: String(input.deviceId || 'web-' + Number(Date.now())),
    email: input.email || '',
    last_ping: new Date().toISOString()
  }, { onConflict: 'device_id' });
  if (error) throw error;
}

async function fetchOnlineEmails(sinceIso) {
  const sb = getClient();
  const { data, error } = await sb.from('devices')
    .select('email, last_ping')
    .gt('last_ping', sinceIso || new Date(Date.now() - 4200000).toISOString());
  if (error) throw error;
  return Array.from(new Set((data || []).map(r => r.email).filter(Boolean)));
}

function rowify(row) {
  if (!row) return row;
  return {
    id: row.id,
    user: row.user || '',
    hasTS: !!row.has_ts,
    kodeTiket: row.kode_tiket || '',
    kode2: row.kode2 || '',
    autoStatus: row.auto_status || '',
    autoCol9: row.auto_col9 || '',
    autoCol10: row.auto_col10 || '',
    autoRetryCheck: row.auto_retry_check || 0,
    manualStatus: row.manual_status || '',
    betting: row.betting || '',
    payout: row.payout || '',
    totalFreeSpin: row.total_free_spin || '',
    transactionId: row.transaction_id || '',
    profit: row.profit || '',
    balance: row.balance || '',
    spinType: row.spin_type || '',
    symbols: row.symbols || [],
    payoutDetail: row.payout_detail || [],
    freeSpinDetail: row.free_spin_detail || [],
    secureStatus: row.secure_status || '',
    keterangan: row.keterangan || '',
    source: row.source || 'web',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
  };
}

function rowifyIn(row) {
  if (!row) return {};
  return {
    user: row.user != null ? row.user : '',
    has_ts: !!row.hasTS,
    kode_tiket: row.kodeTiket != null ? String(row.kodeTiket).replace(/[^a-zA-Z0-9]/g, '') : (row.kode || ''),
    kode2: row.kode2 != null ? String(row.kode2).replace(/[^a-zA-Z0-9]/g, '') : '',
    auto_status: row.autoStatus || '',
    auto_col9: row.autoCol9 || '',
    auto_col10: row.autoCol10 || '',
    manual_status: row.manualStatus || '',
    betting: row.betting != null ? String(row.betting) : '',
    payout: row.payout != null ? String(row.payout) : '',
    total_free_spin: row.totalFreeSpin != null ? String(row.totalFreeSpin) : '',
    transaction_id: row.transactionId || '',
    profit: row.profit != null ? String(row.profit) : '',
    balance: row.balance != null ? String(row.balance) : '',
    spin_type: row.spinType || '',
    symbols: row.symbols || [],
    payout_detail: row.payoutDetail || [],
    free_spin_detail: row.freeSpinDetail || [],
    secure_status: row.secureStatus || '',
    keterangan: row.keterangan || '',
    auto_retry_check: row.autoRetryCheck || 0,
    source: row.source || 'web'
  };
}

module.exports = {
  getClient, fetchSites, insertClaim, fetchClaimsByUser,
  countTodayClaims, fetchClaimByCode, fetchAllClaims, updateClaim, fetchClaimById,
  getStats, fetchLogs, addLog, getSetting, setSetting, fetchNextPipelineClaim,
  fetchRelaxRows, fetchAllRelaxRows, insertRelaxRow, insertRelaxRows, updateRelaxRow,
  deleteRelaxRows, clearRelaxRows, fetchRelaxLogs, addRelaxLog, clearRelaxLogs,
  rowify, rowifyIn,
  fetchMemos, addMemo, deleteMemo,
  fetchTypingTop, submitTypingScore,
  pingDevice, fetchOnlineEmails
};
