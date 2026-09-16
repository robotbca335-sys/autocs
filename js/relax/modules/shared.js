export const $ = s => document.querySelector(s);
export const $$ = s => document.querySelectorAll(s);

const LOCAL_KEYS = ['userEmail','loginSession','lastReadMemoId','deviceId','quickNote','formState','liteMode','liveChatOcr','autoPasteDashboard','postedUpdateVersions','livechatBgImage','scanUrlPersist','scanUrl2Persist','typingRankings','decoLeftArr','decoRightArr','bgImage'];

function localGet(k) {
  try { const v = localStorage.getItem('rx_' + k); return v !== null ? JSON.parse(v) : undefined; } catch(_) { return localStorage.getItem('rx_' + k); }
}
function localSet(k, v) {
  try { localStorage.setItem('rx_' + k, JSON.stringify(v)); } catch(_) {}
}

let _rowsCache = null, _rowsAt = 0;
let _logsCache = null, _logsAt = 0;
const ROWS_TTL = 12000, LOGS_TTL = 10000;

export async function apiPost(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({ ok: false, message: 'response invalid' }));
  if (data.ok === undefined) data.ok = res.ok;
  return data;
}
export async function apiGet(path) {
  const res = await fetch(path);
  return res.json().catch(() => ({ ok: false }));
}
export const apiManage = (action, body) => apiPost('/api/manage', Object.assign({ action }, body || {}));
export const apiProcess = (action, body) => apiPost('/api/process', Object.assign({ action }, body || {}));

export async function runtimeSend(msg) {
  if (!msg || !msg.type) return { rows: [] };
  const ids = msg.priorityIds || (msg.rowId ? [msg.rowId] : []);
  if (msg.type === 'TRIGGER_MANUAL' || msg.type === 'FORCE_RECHECK') {
    for (const id of ids) { try { await apiProcess('relax_check', { rowId: id }); } catch(_) {} }
    invalidate();
  } else if (msg.type === 'TRIGGER_SECURE_ROW') {
    if (msg.rowId) { try { await apiProcess('relax_check', { rowId: msg.rowId }); } catch(_) {} invalidate(); }
  } else if (msg.type === 'TRIGGER_SECURE') {
    try { const r = await getRows(); for (const row of r) { if (row.autoStatus === 'APPROVED') try { await apiProcess('relax_check', { rowId: row.id }); } catch(_) {} } } catch(_) {}
    invalidate();
  }
  return { rows: await getRows() };
}

async function fetchRows() { try { const r = await apiManage('relax_rows_all'); return r.rows || []; } catch(_) { return _rowsCache || []; } }
async function fetchLogs() { try { const r = await apiManage('relax_logs', { limit: 500 }); return r.logs || []; } catch(_) { return _logsCache || []; } }
export async function getRows() { if (!_rowsCache || Date.now() - _rowsAt > ROWS_TTL) { _rowsCache = await fetchRows(); _rowsAt = Date.now(); } return _rowsCache; }
async function getLogs() { if (!_logsCache || Date.now() - _logsAt > LOGS_TTL) { _logsCache = await fetchLogs(); _logsAt = Date.now(); } return _logsCache; }
export function invalidate() { _rowsAt = 0; _logsAt = 0; }
export async function refreshRowsCache() { _rowsCache = await fetchRows(); _rowsAt = Date.now(); return _rowsCache; }

export async function getData(keys) {
  var out = {};
  var ks = !keys ? null : (Array.isArray(keys) ? keys : [keys]);
  if (ks === null || ks.includes('rows')) out.rows = await getRows();
  if (ks === null || ks.includes('logs')) out.logs = await getLogs();
  if (ks === null || ks.includes('nextRowId')) out.nextRowId = 1;
  (ks || []).forEach(k => { if (LOCAL_KEYS.includes(k)) out[k] = localGet(k); });
  return out;
}
export async function setData(obj) {
  for (const k in obj) {
    const v = obj[k];
    if (k === 'rows') {
      if (v) { try { await apiManage('relax_replace', { rows: v }); } catch(_) {} _rowsCache = v; _rowsAt = Date.now(); }
    } else if (k === 'logs') {
      if (!v || !v.length) { try { await apiManage('relax_clear_logs'); } catch(_) {} _logsCache = []; _logsAt = Date.now(); }
    } else if (k === 'nextRowId') {}
    else if (LOCAL_KEYS.includes(k)) { if (v === undefined || v === null) localStorage.removeItem('rx_' + k); else localSet(k, v); }
  }
}

var _idb;
function idbOpen() {
  if (_idb) return _idb;
  _idb = new Promise(function(resolve, reject) {
    var req = indexedDB.open('AUTO_RELAX_WEB', 1);
    req.onerror = function() { reject(req.error); };
    req.onsuccess = function() { resolve(req.result); };
    req.onupgradeneeded = function() { req.result.createObjectStore('images'); };
  });
  return _idb;
}
export function idbGet(key) {
  return idbOpen().then(db => new Promise((resolve, reject) => { var tx = db.transaction('images', 'readonly'); var r = tx.objectStore('images').get(key); r.onerror = () => reject(r.error); r.onsuccess = () => resolve(r.result); }));
}
export function idbSet(key, value) {
  return idbOpen().then(db => new Promise((resolve, reject) => { var tx = db.transaction('images', 'readwrite'); var r = tx.objectStore('images').put(value, key); r.onerror = () => reject(r.error); r.onsuccess = () => resolve(); }));
}
export function idbDelete(key) {
  return idbOpen().then(db => new Promise((resolve, reject) => { var tx = db.transaction('images', 'readwrite'); var r = tx.objectStore('images').delete(key); r.onerror = () => reject(r.error); r.onsuccess = () => resolve(); }));
}
export function idbClear() {
  return idbOpen().then(db => new Promise((resolve, reject) => { var tx = db.transaction('images', 'readwrite'); var r = tx.objectStore('images').clear(); r.onerror = () => reject(r.error); r.onsuccess = () => resolve(); }));
}

export function showToast(msg, isError) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.classList.add('show');
  clearTimeout(t._hide);
  t._hide = setTimeout(() => t.classList.remove('show'), 3000);
}

export function v(val) {
  if (val && val !== '' && val !== null && val !== undefined) return String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '-';
}

export const state = {
  perPage: 10,
  currentPage: 1,
  searchText: '',
  statusFilter: '',
  bonusProcessing: false,
  cekbetProcessing: false,
  processingRows: {},
  isDualMode: false
};

export function parseUser(raw) {
  let s = (raw || '').trim();
  let tsMatch = s.match(/\s+(ts\s*.*)$/i);
  let tsPart = tsMatch ? tsMatch[1] : '';
  s = s.replace(/\s+ts\s*.*/i, '').replace(/\s+/g, '').trim();
  return { user: s, hasTS: !!tsMatch };
}

export function cleanKode(raw) { return (raw || '').replace(/[^a-zA-Z0-9]/g, '').trim(); }
export function validPanjangKode(kode) { return kode.length >= 19; }

export function renderPagination(total) {
  var totalPages = Math.max(1, Math.ceil(total / state.perPage));
  if (state.currentPage > totalPages) state.currentPage = totalPages;
  var start = (state.currentPage - 1) * state.perPage + 1;
  var end = Math.min(state.currentPage * state.perPage, total);
  var info = $('#page-info'); if (info) info.textContent = total > 0 ? start + '-' + end + ' dari ' + total : '';
  var nav = $('#page-nav'); if (!nav) return;
  var html = '<button class="page-btn" data-page="' + (state.currentPage - 1) + '"' + (state.currentPage <= 1 ? ' disabled' : '') + '>&laquo;</button>';
  var maxShow = 5, from = Math.max(1, state.currentPage - Math.floor(maxShow / 2)), to = Math.min(totalPages, from + maxShow - 1);
  if (to - from < maxShow - 1) from = Math.max(1, to - maxShow + 1);
  for (var p = from; p <= to; p++) html += '<button class="page-btn' + (p === state.currentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
  html += '<button class="page-btn" data-page="' + (state.currentPage + 1) + '"' + (state.currentPage >= totalPages ? ' disabled' : '') + '>&raquo;</button>';
  nav.innerHTML = html;
}

export function calcHadiah(bettingRaw, payoutRaw) {
  var bet = parseFloat(String(bettingRaw).replace(/[^0-9]/g, '')) || 0;
  var scat = parseInt(String(payoutRaw).replace(/[^0-9]/g, '')) || 0;
  if (scat === 3) { if (bet >= 20000) return 100000; if (bet >= 10000) return 50000; if (bet >= 4000) return 35000; if (bet >= 1600) return 15000; return 0; }
  if (scat === 4) { if (bet >= 20000) return 200000; if (bet >= 10000) return 100000; if (bet >= 4000) return 70000; if (bet >= 1600) return 30000; return 0; }
  if (scat === 5) { if (bet >= 20000) return 400000; if (bet >= 10000) return 200000; if (bet >= 4000) return 140000; if (bet >= 1600) return 75000; return 0; }
  return 0;
}
export function fmtHadiah(n) { return n ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '-'; }
export function escapeHtml(str) { if (!str) return '-'; return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export function resetCekBet(row) {
  var wasPreserved = row.manualStatus === 'Ticket Not Found' || row.manualStatus === 'Session Timeout';
  row.autoStatus = ''; row.autoCol9 = '';
  if (!wasPreserved) { row.autoCol10 = ''; row.manualStatus = ''; }
  row.betting = ''; row.payout = ''; row.totalFreeSpin = ''; row.transactionId = '';
  row.profit = ''; row.balance = ''; row.spinType = ''; row.symbols = [];
  row.payoutDetail = []; row.freeSpinDetail = []; row.updatedAt = Date.now();
}
export function resetBonus(row) { row.secureStatus = ''; row.updatedAt = Date.now(); }

export function uncheckAll() {
  var sel = $('#select-all'); if (sel) sel.checked = false;
  document.querySelectorAll('.bulk-cb').forEach(cb => { cb.checked = false; });
  updateBulkInfo();
}
export function getSelectedIds() { return Array.from(document.querySelectorAll('.bulk-cb:checked')).map(cb => parseInt(cb.value)); }
export function updateBulkInfo() { var el = $('#bulk-info'); var n = getSelectedIds().length; if (el) el.textContent = n ? n + ' terpilih' : ''; }

export function generatePassword() {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lower = 'abcdefghijklmnopqrstuvwxyz', digits = '0123456789', all = upper + lower + digits;
  let pw = upper[Math.floor(Math.random() * upper.length)] + lower[Math.floor(Math.random() * lower.length)] + digits[Math.floor(Math.random() * digits.length)];
  for (let i = 3; i < 8; i++) pw += all[Math.floor(Math.random() * all.length)];
  return pw.split('').sort(() => Math.random() - 0.5).join('');
}
export function csvEscape(val) { var s = String(val || ''); if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'; return s; }
export function readImageFile(file, callback, maxWidth, quality) {
  var reader = new FileReader();
  reader.onload = function(e) {
    if (/\.gif$/i.test(file.name) || file.type === 'image/gif') { callback(e.target.result); return; }
    var img = new Image();
    img.onload = function() { var w = img.width, h = img.height; if (maxWidth && w > maxWidth) { h = h * maxWidth / w; w = maxWidth; } var c = document.createElement('canvas'); c.width = w; c.height = h; var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h); callback(c.toDataURL('image/jpeg', quality || 0.7)); };
    img.onerror = function() { callback(e.target.result); };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
