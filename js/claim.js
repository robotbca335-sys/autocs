// API Base URL - auto-detect
const API_BASE = window.location.origin;

// State
let selectedScatter = 3;
let isSubmitting = false;
let lastSubmitTime = 0;
const BET_MIN = 1600;
const BET_MAX = 10000000;

// DOM refs
const $ = id => document.getElementById(id);

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSites();
  initScatterButtons();
  initBetFormatter();
  initFormNavigation();
  initHoneypots();
});

// Load sites from API
async function loadSites() {
  const sel = $('f_site');
  try {
    const res = await fetch(`${API_BASE}/api/sitelist`);
    const json = await res.json();
    if (json.ok && json.sites && json.sites.length) {
      sel.innerHTML = json.sites.map(s => `<option value="${s.site_id}">${s.label}</option>`).join('');
    } else {
      sel.innerHTML = '<option value="">Belum ada situs</option>';
      sel.disabled = true;
    }
  } catch (e) {
    sel.innerHTML = '<option value="">Gagal memuat situs</option>';
    sel.disabled = true;
  }
}

// Scatter button selection
function initScatterButtons() {
  document.querySelectorAll('#scSel button').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedScatter = parseInt(btn.dataset.v);
      document.querySelectorAll('#scSel button').forEach(b => b.classList.remove('sel'));
      btn.classList.add('sel');
    });
  });
  document.querySelector('#scSel button[data-v="3"]').classList.add('sel');
}

// Format bet input as currency
function initBetFormatter() {
  const betInput = $('f_bet');
  betInput.addEventListener('input', function () {
    const raw = this.value.replace(/\D/g, '');
    if (raw) {
      this.value = Number(raw).toLocaleString('id-ID');
      const num = parseInt(raw, 10);
      if (num > 0 && num < BET_MIN) {
        showToast(`Nominal bet minimal Rp ${BET_MIN.toLocaleString('id-ID')}.`, 'bad');
      } else if (num > BET_MAX) {
        showToast(`Nominal bet antara Rp ${BET_MIN.toLocaleString('id-ID')} dan Rp ${BET_MAX.toLocaleString('id-ID')}.`, 'bad');
      }
    }
  });
}

// Stage navigation
function initFormNavigation() {
  $('goTrack').addEventListener('click', () => showStage('track'));
  $('goForm').addEventListener('click', () => showStage('form'));
}

function showStage(name) {
  document.querySelectorAll('.stage').forEach(s => s.classList.remove('active'));
  $(`stage-${name}`).classList.add('active');
}

// Honeypot fields
function initHoneypots() { }

// Get bet amount as number
function getBetNumber() {
  return parseInt($('f_bet').value.replace(/\D/g, ''), 10) || 0;
}

// Submit claim
$('btnSubmit').addEventListener('click', async () => {
  if (isSubmitting) return;

  // Honeypot check
  if ($('f_bot').value || $('f_company').value) return;

  // Rate limit
  if (Date.now() - lastSubmitTime < 1200) return;

  const site = $('f_site').value;
  const userId = $('f_user').value.trim();
  const kodeTiket = $('f_tx').value.trim();
  const bet = getBetNumber();

  // Validate
  if (!site) return showToast('Pilih situs tujuan dulu.', 'bad');
  if (!userId || !kodeTiket) return showToast('Lengkapi User ID dan Kode Tiket.', 'bad');
  if (!bet) return showToast('Nominal bet wajib diisi.', 'bad');
  if (bet < BET_MIN) return showToast(`Nominal bet minimal Rp ${BET_MIN.toLocaleString('id-ID')}.`, 'bad');
  if (bet > BET_MAX) return showToast(`Nominal bet antara Rp ${BET_MIN.toLocaleString('id-ID')} dan Rp ${BET_MAX.toLocaleString('id-ID')}.`, 'bad');

  isSubmitting = true;
  $('btnSubmit').disabled = true;

  try {
    const todayRes = await fetch(`${API_BASE}/api/track?user_id=${encodeURIComponent(userId)}`);
    const todayData = await todayRes.json();
    if (todayData.used >= todayData.max) {
      showToast('Anda sudah 2 kali claim hari ini. Coba kembali setelah ganti hari.', 'bad');
      return;
    }
  } catch (e) { /* continue anyway */ }

  try {
    const res = await fetch(`${API_BASE}/api/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site, user_id: userId, kode_tiket: kodeTiket,
        betting: bet, scatter: selectedScatter,
        website: $('f_bot').value, company: $('f_company').value
      })
    });
    const json = await res.json();

    if (json.ok) {
      showToast('Tiket scatter diterima - sedang diverifikasi.', 'ok');
      $('f_user').value = '';
      $('f_tx').value = '';
      $('f_bet').value = '';
      lastSubmitTime = Date.now();
    } else {
      showToast(json.message || 'Gagal mengirim klaim. Coba lagi.', 'bad');
    }
  } catch (e) {
    showToast('Gagal mengirim klaim. Coba lagi.', 'bad');
  } finally {
    isSubmitting = false;
    $('btnSubmit').disabled = false;
  }
});

// Track claim
$('btnTrack').addEventListener('click', async () => {
  const userId = $('t_user').value.trim();
  if (!userId) return showToast('Isi User ID dulu.', 'bad');

  const btn = $('btnTrack');
  btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/track?user_id=${encodeURIComponent(userId)}`);
    const json = await res.json();
    renderTrackResults(json.rows || json);
  } catch (e) {
    showToast('Gagal menghubungi server.', 'bad');
  } finally {
    btn.disabled = false;
  }
});

function renderTrackResults(rows) {
  const container = $('trackRows');
  container.innerHTML = '';

  if (!rows || !rows.length) {
    container.innerHTML = '<div class="sub">Tidak ada klaim ditemukan untuk user id ini.</div>';
    return;
  }

  const statusMap = {
    PENDING: { cls: 'pul', txt: 'ANTRI' },
    VERIFYING: { cls: 'act vrf', txt: 'MEMERIKSA' },
    SESUAI: { cls: 'vrf', txt: 'SESUAI' },
    TIDAK_SESUAI: { cls: 'gagal', txt: 'TIDAK SESUAI' },
    INPUTTING: { cls: 'act vrf', txt: 'INPUT' },
    INPUT_OK: { cls: 'ok', txt: 'MASUK' },
    INPUT_FAIL: { cls: 'gagal', txt: 'INPUT GAGAL' },
    ERROR: { cls: 'err', txt: 'ERROR' },
    NO_TOKEN: { cls: 'gagal', txt: 'TOKEN KOSONG' }
  };

  const frag = document.createDocumentFragment();
  rows.forEach(row => {
    const st = statusMap[row.status] || { cls: 'vrf', txt: row.status || '?' };
    const div = document.createElement('div');
    div.className = 'row';
    div.innerHTML = `
      <div class="rt">
        <span class="tag ${st.cls}"><i></i>${esc(st.txt)}</span>
        <span class="time">${fmtTime(row.updated_at || row.created_at)}</span>
      </div>
      <div class="rm">${esc(row.kode_tiket)}</div>
      <div class="rg">
        <span class="kv">Bet <b>${Number(row.betting).toLocaleString('id-ID')}</b></span>
        <span class="kv">Sc <b>x${esc(String(row.scatter))}</b></span>
      </div>
      <div class="rd">${esc(row.detail || '')}</div>
    `;
    frag.appendChild(div);
  });
  container.appendChild(frag);
}

// Utilities
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Toast
let toastTimer = null;
function showToast(msg, type = 'info') {
  const t = $('toast');
  t.className = 'toast ' + type;
  t.textContent = msg;
  clearTimeout(toastTimer);
  requestAnimationFrame(() => {
    t.classList.add('show');
    toastTimer = setTimeout(() => t.classList.remove('show'), 5000);
  });
}
