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

module.exports = {
  getClient, fetchSites, insertClaim, fetchClaimsByUser,
  countTodayClaims, fetchClaimByCode, fetchAllClaims, updateClaim, fetchClaimById,
  getStats, fetchLogs, addLog, getSetting, setSetting, fetchNextPipelineClaim
};
