import { $, showToast, getData, setData, apiManage } from './shared.js';

var THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
var ADMIN_EMAILS = ['fibiogenio121@gmail.com'];

export function initMemo() {
  loadMemos();
  updateBadge();
  var tabBtn = document.querySelector('.tab-btn[data-tab="memo"]');
  if (tabBtn) {
    tabBtn.addEventListener('click', function () {
      updateBadge();
      setTimeout(function () { markAsRead(); loadMemos(); }, 300);
    });
  }
  var sendBtn = $('#memo-send-btn');
  var input = $('#memo-input');
  if (sendBtn) sendBtn.addEventListener('click', sendMemo);
  if (input) {
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMemo(); } });
  }
}

async function currentEmail() {
  const r = await getData('userEmail');
  return r.userEmail || window.AUTH_EMAIL || '';
}

async function sendMemo() {
  const input = $('#memo-input');
  if (!input) return;
  const message = input.value.trim();
  if (!message) { showToast('Pesan kosong', true); return; }
  const btn = $('#memo-send-btn');
  if (btn) btn.disabled = true;
  try {
    const email = await currentEmail();
    if (!email) { showToast('Login dulu', true); return; }
    await apiManage('memo_add', { authorEmail: email, authorName: '', message });
    input.value = '';
    showToast('Memo terkirim');
    loadMemos();
    updateBadge();
  } catch (err) {
    showToast('Gagal kirim memo', true);
    console.error('Memo send error:', err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadMemos() {
  const list = $('#memo-list');
  if (!list) return;
  try {
    const res = await apiManage('memo_list', { limit: 100 });
    const memos = res.memos || [];
    if (!memos.length) { list.innerHTML = '<div class="empty"><p>Belum ada memo</p></div>'; return; }
    const userEmail = await currentEmail();
    const readResult = await getData('lastReadMemoId');
    const lastReadId = readResult.lastReadMemoId || 0;
    list.innerHTML = memos.map(function (m) {
      var isUnread = m.id > lastReadId && m.author_email !== userEmail;
      var isMe = m.author_email === userEmail;
      var isAdmin = ADMIN_EMAILS.includes(userEmail);
      var time = new Date(m.created_at).toLocaleString('id-ID');
      var shortEmail = (m.author_email || '').split('@')[0] || '?';
      var initial = shortEmail.charAt(0).toUpperCase();
      return '<div class="memo-item' + (isUnread ? ' unread' : '') + '">' +
        '<div class="memo-header">' +
        '<div class="memo-avatar ' + (isMe ? 'self' : 'other') + '">' + esc(initial) + '</div>' +
        '<span class="memo-author ' + (isMe ? 'self' : 'other') + '">' + esc(m.author_email) + '</span>' +
        '<span class="memo-time">' + time + '</span>' +
        (isUnread ? '<span class="memo-badge-new">Baru</span>' : '') +
        '</div>' +
        '<div class="memo-body">' + esc(m.message) + '</div>' +
        (isMe || isAdmin ? '<button class="memo-del-btn" data-id="' + m.id + '" title="Hapus memo">&times;</button>' : '') +
        '</div>';
    }).join('');
    list.querySelectorAll('.memo-del-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); deleteMemo(parseInt(this.dataset.id)); });
    });
  } catch (err) {
    console.error('Memo load error:', err);
    list.innerHTML = '<div class="empty"><p>Error load memo</p></div>';
  }
}

async function updateBadge() {
  var badge = $('#memo-badge');
  if (!badge) return;
  try {
    const email = await currentEmail();
    if (!email) { badge.style.display = 'none'; return; }
    const readResult = await getData('lastReadMemoId');
    const lastReadId = readResult.lastReadMemoId || 0;
    const res = await apiManage('memo_list', { limit: 100 });
    const memos = res.memos || [];
    const count = memos.filter(m => m.id > lastReadId && m.author_email !== email).length;
    if (count > 0) { badge.textContent = count; badge.style.display = 'inline'; }
    else badge.style.display = 'none';
  } catch (err) { badge.style.display = 'none'; }
}

async function markAsRead() {
  try {
    const res = await apiManage('memo_list', { limit: 1 });
    const rows = res.memos || [];
    if (rows.length && rows[0].id) {
      await setData({ lastReadMemoId: rows[0].id });
      updateBadge();
    }
  } catch (err) { console.error('Memo markAsRead error:', err); }
}

async function deleteMemo(id) {
  if (!confirm('Hapus memo ini?')) return;
  try {
    await apiManage('memo_delete', { id });
    showToast('Memo dihapus');
    loadMemos();
    updateBadge();
  } catch (err) {
    showToast('Gagal hapus memo', true);
    console.error('Memo delete error:', err);
  }
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}