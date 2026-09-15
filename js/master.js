// ============================================================
// MASTER DASHBOARD - Scatter Claim Admin
// ============================================================
const API_BASE = window.location.origin;
const $ = id => document.getElementById(id);

// State
let currentTab = 'dashboard';
let claimsPage = 1;
let selectedClaims = new Set();
let autoProcess = false;
let autoInterval = null;
let monitorPollInterval = null;
let settings = {
  dailyLimit: 2,
  betMin: 1600,
  betMax: 10000000,
  processingInterval: 60
};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
  initDashboard();
  initNavigation();
  initClaimsTab();
  initProcessTab();
  initVerifyTab();
  initMonitorTab();
  initLogsTab();
  initSettingsTab();
  loadDashboard();
  startAutoRefresh();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      $('sidebar').classList.remove('open');
      $('sidebarScrim').classList.remove('show');
    }
  });
});

// ===== NAVIGATION =====
function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      switchTab(tab);
      $('sidebar').classList.remove('open');
      $('sidebarScrim').classList.remove('show');
    });
  });
  $('menuToggle').addEventListener('click', () => {
    $('sidebar').classList.add('open');
    $('sidebarScrim').classList.add('show');
  });
  $('sidebarScrim').addEventListener('click', () => {
    $('sidebar').classList.remove('open');
    $('sidebarScrim').classList.remove('show');
  });
  $('btnRefresh').addEventListener('click', () => loadTabData(currentTab));
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-tab="${tab}"]`).classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  $(`tab-${tab}`).classList.add('active');
  $('pageTitle').textContent = getTabTitle(tab);
  loadTabData(tab);
}

function getTabTitle(tab) {
  const titles = { dashboard:'Dashboard', claims:'Claims Management', process:'Auto Processing', verify:'Bet Verification', monitor:'Live Monitor', logs:'Activity Logs', settings:'Settings' };
  return titles[tab] || tab;
}

// ===== DASHBOARD =====
function initDashboard() {
  $('btnProcessAll').addEventListener('click', processAll);
  $('btnExportCsv').addEventListener('click', exportCsv);
}

async function loadDashboard() {
  try {
    const res = await fetch(`${API_BASE}/api/admin/stats`);
    const data = await res.json();
    if (data.ok) {
      animateCounter('statTotal', data.stats.total);
      animateCounter('statPending', data.stats.pending);
      animateCounter('statApproved', data.stats.approved);
      animateCounter('statRejected', data.stats.rejected);
      animateCounter('statToday', data.stats.today);
    }
  } catch(e) { console.error('Dashboard load error:', e); }

  loadRecentClaims();
}

async function loadRecentClaims() {
  try {
    const res = await fetch(`${API_BASE}/api/admin/claims?limit=10`);
    const data = await res.json();
    if (data.ok && data.rows) {
      renderRecentClaims(data.rows);
    }
  } catch(e) { console.error(e); }
}

function renderRecentClaims(rows) {
  const el = $('recentClaims');
  if (!rows.length) { el.innerHTML = '<p class="empty-text">No claims yet</p>'; return; }
  el.innerHTML = rows.map(r => `
    <div class="claim-row">
      <span class="tag ${getStatusClass(r.status)}">${esc(r.status)}</span>
      <span class="claim-user">${esc(r.user_id)}</span>
      <span class="claim-code">${esc(r.kode_tiket)}</span>
      <span class="claim-time">${fmtTime(r.created_at)}</span>
    </div>
  `).join('');
}

function animateCounter(id, target) {
  const el = $(id);
  const start = parseInt(el.textContent) || 0;
  const diff = target - start;
  const duration = 600;
  const startTime = performance.now();
  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + diff * ease);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ===== CLAIMS TAB =====
function initClaimsTab() {
  $('claimSearch').addEventListener('input', debounce(() => { claimsPage = 1; loadClaims(); }, 300));
  $('filterStatus').addEventListener('change', () => { claimsPage = 1; loadClaims(); });
  $('filterSite').addEventListener('change', () => { claimsPage = 1; loadClaims(); });
  $('selectAll').addEventListener('change', (e) => {
    document.querySelectorAll('.claim-checkbox').forEach(cb => {
      cb.checked = e.target.checked;
      const id = cb.dataset.id;
      if (e.target.checked) selectedClaims.add(id); else selectedClaims.delete(id);
    });
  });
  $('btnBulkApprove').addEventListener('click', () => bulkAction('SESUAI'));
  $('btnBulkReject').addEventListener('click', () => bulkAction('TIDAK_SESUAI'));
  loadSitesForFilter();
}

async function loadSitesForFilter() {
  try {
    const res = await fetch(`${API_BASE}/api/sitelist`);
    const data = await res.json();
    if (data.ok && data.sites) {
      const sel = $('filterSite');
      data.sites.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.site_id; opt.textContent = s.label;
        sel.appendChild(opt);
      });
    }
  } catch(e) {}
}

async function loadClaims() {
  const params = new URLSearchParams({
    page: claimsPage,
    limit: 50,
    search: $('claimSearch').value,
    status: $('filterStatus').value,
    site: $('filterSite').value
  });
  try {
    const res = await fetch(`${API_BASE}/api/admin/claims?${params}`);
    const data = await res.json();
    if (data.ok) {
      renderClaimsTable(data.rows);
      renderPagination(data.total, 50);
    }
  } catch(e) { console.error(e); }
}

function renderClaimsTable(rows) {
  const tbody = $('claimsTableBody');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="9" class="empty-text">No claims found</td></tr>'; return; }
  tbody.innerHTML = rows.map(r => `
    <tr class="${selectedClaims.has(r.id) ? 'selected' : ''}">
      <td><input type="checkbox" class="claim-checkbox" data-id="${r.id}" ${selectedClaims.has(r.id)?'checked':''}></td>
      <td><span class="tag ${getStatusClass(r.status)}">${esc(r.status)}</span></td>
      <td>${esc(r.user_id)}</td>
      <td class="code-cell">${esc(r.kode_tiket)}</td>
      <td>${Number(r.betting).toLocaleString('id-ID')}</td>
      <td>x${r.scatter}</td>
      <td>${esc(r.site)}</td>
      <td>${fmtTime(r.created_at)}</td>
      <td class="actions-cell">
        <button class="btn-xs" onclick="viewClaim('${r.id}')">View</button>
        <button class="btn-xs success" onclick="updateClaimStatus('${r.id}','SESUAI')">Approve</button>
        <button class="btn-xs danger" onclick="updateClaimStatus('${r.id}','TIDAK_SESUAI')">Reject</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.claim-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedClaims.add(cb.dataset.id); else selectedClaims.delete(cb.dataset.id);
    });
  });
}

function renderPagination(total, limit) {
  const pages = Math.ceil(total / limit);
  const el = $('claimsPagination');
  if (pages <= 1) { el.innerHTML = ''; return; }
  let html = '';
  for (let i = 1; i <= pages; i++) {
    html += `<button class="page-btn ${i===claimsPage?'active':''}" onclick="goToPage(${i})">${i}</button>`;
  }
  el.innerHTML = html;
}

function goToPage(p) { claimsPage = p; loadClaims(); }

async function viewClaim(id) {
  try {
    const res = await fetch(`${API_BASE}/api/admin/claims?id=${id}`);
    const data = await res.json();
    if (data.ok && data.rows && data.rows[0]) {
      const r = data.rows[0];
      showModal('Claim Details', `
        <div class="detail-grid">
          <div class="detail-item"><label>Status</label><span class="tag ${getStatusClass(r.status)}">${esc(r.status)}</span></div>
          <div class="detail-item"><label>User ID</label><span>${esc(r.user_id)}</span></div>
          <div class="detail-item"><label>Kode Tiket</label><span class="code-cell">${esc(r.kode_tiket)}</span></div>
          <div class="detail-item"><label>Bet</label><span>Rp ${Number(r.betting).toLocaleString('id-ID')}</span></div>
          <div class="detail-item"><label>Scatter</label><span>x${r.scatter}</span></div>
          <div class="detail-item"><label>Site</label><span>${esc(r.site)}</span></div>
          <div class="detail-item"><label>Detail</label><span>${esc(r.detail || '-')}</span></div>
          <div class="detail-item"><label>Created</label><span>${fmtTime(r.created_at)}</span></div>
          <div class="detail-item"><label>Updated</label><span>${fmtTime(r.updated_at)}</span></div>
        </div>
      `, `
        <button class="btn-gold" onclick="updateClaimStatus('${r.id}','SESUAI');closeModal()">Approve</button>
        <button class="btn-outline danger" onclick="updateClaimStatus('${r.id}','TIDAK_SESUAI');closeModal()">Reject</button>
      `);
    }
  } catch(e) { showToast('Failed to load claim', 'bad'); }
}

async function updateClaimStatus(id, status) {
  try {
    const res = await fetch(`${API_BASE}/api/manage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`Claim updated to ${status}`, 'ok');
      loadClaims();
      loadDashboard();
    } else {
      showToast(data.message || 'Failed to update', 'bad');
    }
  } catch(e) { showToast('Network error', 'bad'); }
}

async function bulkAction(status) {
  if (!selectedClaims.size) return showToast('No claims selected', 'bad');
  const ids = [...selectedClaims];
  try {
    for (const id of ids) {
      await fetch(`${API_BASE}/api/manage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status })
      });
    }
    showToast(`${ids.length} claims updated`, 'ok');
    selectedClaims.clear();
    loadClaims();
    loadDashboard();
  } catch(e) { showToast('Bulk action failed', 'bad'); }
}

// ===== EXPORT CSV =====
async function exportCsv() {
  try {
    const params = new URLSearchParams({
      limit: 5000,
      search: $('claimSearch').value,
      status: $('filterStatus').value,
      site: $('filterSite').value
    });
    const res = await fetch(`${API_BASE}/api/admin/claims?${params}`);
    const data = await res.json();
    if (!data.ok || !data.rows) return showToast('No data to export', 'bad');
    if (!data.rows.length) return showToast('No claims match the filter', 'bad');

    const headers = ['user_id', 'kode_tiket', 'betting', 'scatter', 'site', 'status', 'detail', 'created_at'];
    const lines = [headers.join(',')];
    data.rows.forEach(r => {
      lines.push([
        csv(r.user_id), csv(r.kode_tiket), r.betting, r.scatter,
        csv(r.site), r.status, csv(r.detail), r.created_at
      ].join(','));
    });

    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `claims-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    showToast('CSV exported', 'ok');
  } catch(e) { showToast('Export failed', 'bad'); }
}

function csv(v) {
  const s = String(v || '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ===== PROCESS TAB =====
function initProcessTab() {
  $('autoProcessToggle').addEventListener('change', (e) => {
    autoProcess = e.target.checked;
    $('autoStatus').textContent = autoProcess ? 'Auto: ON' : 'Auto: OFF';
    $('autoStatus').className = 'status-badge ' + (autoProcess ? 'active' : '');
    if (autoProcess) startAutoProcess(); else stopAutoProcess();
  });
  $('btnProcessNext').addEventListener('click', processNext);
  $('btnProcessAll2').addEventListener('click', processAll);
}

async function loadProcessStats() {
  try {
    const res = await fetch(`${API_BASE}/api/admin/stats`);
    const data = await res.json();
    if (data.ok && data.stats) {
      $('procQueue').textContent = data.stats.queue ?? data.stats.pending ?? 0;
      $('procActive').textContent = data.stats.active ?? data.stats.verifying ?? 0;
      $('procDone').textContent = data.stats.done ?? data.stats.approved ?? 0;
      $('procFail').textContent = data.stats.failed ?? data.stats.rejected ?? 0;
    }
  } catch(e) {}
}

async function processNext() {
  addProcessLog('Processing next claim...');
  try {
    const res = await fetch(`${API_BASE}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'next' })
    });
    const data = await res.json();
    if (data.ok) {
      addProcessLog(`Processed: ${data.claim?.kode_tiket} -> ${data.claim?.status}`, 'ok');
      loadDashboard();
      loadProcessStats();
    } else {
      addProcessLog(data.message || 'Nothing to process', 'warn');
    }
  } catch(e) { addProcessLog('Process error: ' + e.message, 'error'); }
}

async function processAll() {
  addProcessLog('Processing all pending claims...');
  try {
    const res = await fetch(`${API_BASE}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'all' })
    });
    const data = await res.json();
    if (data.ok) {
      addProcessLog(`Batch processed: ${data.processed || 0} claims`, 'ok');
      loadDashboard();
      loadProcessStats();
    }
  } catch(e) { addProcessLog('Batch error: ' + e.message, 'error'); }
}

function startAutoProcess() {
  stopAutoProcess();
  processNext();
  autoInterval = setInterval(processNext, settings.processingInterval * 1000);
  addProcessLog('Auto processing started', 'ok');
}

function stopAutoProcess() {
  if (autoInterval) { clearInterval(autoInterval); autoInterval = null; }
  addProcessLog('Auto processing stopped');
}

function addProcessLog(msg, type='') {
  const log = $('processLog');
  const line = document.createElement('div');
  line.className = 'log-line ' + type;
  line.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString('id-ID')}</span> ${esc(msg)}`;
  log.prepend(line);
  if (log.children.length > 100) log.lastChild.remove();
}

// ===== VERIFY TAB =====
function initVerifyTab() {
  $('btnVerify').addEventListener('click', verifyBet);
  $('verifyCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyBet(); });
}

async function verifyBet() {
  const code = $('verifyCode').value.trim();
  if (!code) return showToast('Enter a ticket code', 'bad');

  $('btnVerify').disabled = true;
  $('verifyResult').innerHTML = '<div class="loading">Verifying...</div>';

  try {
    const res = await fetch(`${API_BASE}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', kode_tiket: code })
    });
    const data = await res.json();
    if (data.ok) {
      $('verifyResult').innerHTML = `
        <div class="verify-result ${data.verified ? 'success' : 'fail'}">
          <h3>${data.verified ? 'Bet Verified' : 'Bet Not Found'}</h3>
          <pre>${esc(JSON.stringify(data, null, 2))}</pre>
        </div>
      `;
    } else {
      $('verifyResult').innerHTML = `<div class="verify-result fail"><h3>Error</h3><p>${esc(data.message)}</p></div>`;
    }
  } catch(e) {
    $('verifyResult').innerHTML = `<div class="verify-result fail"><h3>Error</h3><p>${esc(e.message)}</p></div>`;
  } finally {
    $('btnVerify').disabled = false;
  }
}

// ===== MONITOR TAB =====
function initMonitorTab() {
  $('btnStartMonitor').addEventListener('click', toggleMonitor);
}

function toggleMonitor() {
  if (monitorPollInterval) {
    stopMonitor();
  } else {
    $('btnStartMonitor').textContent = 'Stop';
    $('monitorFeed').innerHTML = '<p class="empty-text">Monitoring...</p>';
    monitorPollInterval = setInterval(pollMonitor, 5000);
    pollMonitor();
  }
}

function stopMonitor() {
  if (monitorPollInterval) { clearInterval(monitorPollInterval); monitorPollInterval = null; }
  $('btnStartMonitor').textContent = 'Start';
  $('monitorFeed').innerHTML = '<p class="empty-text">Monitor is stopped</p>';
}

async function pollMonitor() {
  try {
    const res = await fetch(`${API_BASE}/api/admin/claims?status=PENDING&limit=5`);
    const data = await res.json();
    if (data.ok && data.rows) {
      const feed = $('monitorFeed');
      data.rows.forEach(r => {
        const entry = document.createElement('div');
        entry.className = 'monitor-entry';
        entry.innerHTML = `<span class="monitor-time">${fmtTime(r.created_at)}</span> <span class="tag ${getStatusClass(r.status)}">${r.status}</span> ${esc(r.user_id)} - ${esc(r.kode_tiket)}`;
        feed.prepend(entry);
      });
      if (feed.children.length > 50) {
        while (feed.children.length > 50) feed.lastChild.remove();
      }
    }
  } catch(e) {}
}

// ===== LOGS TAB =====
function initLogsTab() {
  $('btnRefreshLogs').addEventListener('click', loadLogs);
  $('btnClearLogs').addEventListener('click', async () => {
    if (!confirm('Clear all logs?')) return;
    const res = await fetch(`${API_BASE}/api/admin/logs`, { method: 'DELETE' }).catch(() => null);
    if (res && res.ok) showToast('Logs cleared', 'ok');
    else { $('logContainer').innerHTML = '<p class="empty-text">No logs</p>'; showToast('Logs cleared', 'ok'); }
  });
}

async function loadLogs() {
  try {
    const res = await fetch(`${API_BASE}/api/admin/logs`);
    const data = await res.json();
    if (data.ok && data.logs) {
      renderLogs(data.logs);
    } else {
      $('logContainer').innerHTML = '<p class="empty-text">No logs</p>';
    }
  } catch(e) { console.error(e); }
}

function renderLogs(logs) {
  const el = $('logContainer');
  if (!logs.length) { el.innerHTML = '<p class="empty-text">No logs</p>'; return; }
  el.innerHTML = logs.map(l => `
    <div class="log-entry">
      <span class="log-time">${fmtTime(l.created_at)}</span>
      <span class="log-action">${esc(l.action)}</span>
      <span class="log-detail">${esc(l.detail)}</span>
    </div>
  `).join('');
}

// ===== SETTINGS TAB =====
function initSettingsTab() {
  $('btnSaveSettings').addEventListener('click', saveSettings);
  loadSettings();
}

function loadSettings() {
  const saved = localStorage.getItem('scatter_settings');
  if (saved) {
    try {
      settings = { ...settings, ...JSON.parse(saved) };
    } catch(e) {}
    $('settDailyLimit').value = settings.dailyLimit;
    $('settBetMin').value = settings.betMin;
    $('settBetMax').value = settings.betMax;
    $('settInterval').value = settings.processingInterval;
  }
}

function saveSettings() {
  settings.dailyLimit = parseInt($('settDailyLimit').value) || 2;
  settings.betMin = parseInt($('settBetMin').value) || 1600;
  settings.betMax = parseInt($('settBetMax').value) || 10000000;
  settings.processingInterval = parseInt($('settInterval').value) || 60;
  localStorage.setItem('scatter_settings', JSON.stringify(settings));
  showToast('Settings saved', 'ok');
}

// ===== SHARED =====
function loadTabData(tab) {
  switch(tab) {
    case 'dashboard': loadDashboard(); break;
    case 'claims': loadClaims(); break;
    case 'logs': loadLogs(); break;
    case 'process': loadProcessStats(); break;
    case 'monitor': break;
    case 'verify': break;
    case 'settings': loadSettings(); break;
  }
}

function startAutoRefresh() {
  setInterval(() => {
    if (currentTab === 'dashboard') loadDashboard();
    if (currentTab === 'claims') loadClaims();
    if (currentTab === 'logs') loadLogs();
    if (currentTab === 'process') loadProcessStats();
  }, 30000);
}

// Modal
function showModal(title, body, footer='') {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = body;
  $('modalFooter').innerHTML = footer || `<button class="btn-outline" onclick="closeModal()">Close</button>`;
  $('modalOverlay').classList.add('show');
}

function closeModal() { $('modalOverlay').classList.remove('show'); }
$('modalClose').addEventListener('click', closeModal);
$('modalOverlay').addEventListener('click', (e) => { if (e.target === $('modalOverlay')) closeModal(); });

// Toast
let toastTimer = null;
function showToast(msg, type='info') {
  const t = $('toast');
  t.className = 'toast ' + type;
  t.textContent = msg;
  clearTimeout(toastTimer);
  t.classList.add('show');
  toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

// Utilities
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function fmtTime(ts) { if (!ts) return '-'; return new Date(ts).toLocaleDateString('id-ID',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}); }
function getStatusClass(s) { return {PENDING:'pul',VERIFYING:'act vrf',INPUTTING:'act vrf',SESUAI:'vrf',TIDAK_SESUAI:'gagal',INPUT_OK:'ok',INPUT_FAIL:'gagal',NO_TOKEN:'gagal',ERROR:'err'}[s]||'vrf'; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }