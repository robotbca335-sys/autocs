import { apiGet, apiManage, setData, getData } from './shared.js';

function generateDeviceId() {
  const arr = new Uint8Array(16); crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

export default async function initAuth() {
  const overlay = document.getElementById('loginOverlay');
  if (!overlay) return;
  const btn = document.getElementById('loginBtn');
  const error = document.getElementById('loginError');
  const loginDesc = document.getElementById('loginDesc');

  try {
    const me = await apiGet('/api/auth?action=me');
    if (me && me.ok && me.authenticated) {
      overlay.classList.add('hidden');
      window.AUTH_EMAIL = me.email || '';
      setData({ userEmail: me.email, loginSession: Date.now() });
      const el = document.getElementById('sessionEmail'); if (el) el.textContent = '\uD83D\uDCE7 ' + me.email;
      try { let { deviceId } = await getData('deviceId'); if (!deviceId) { deviceId = generateDeviceId(); setData({ deviceId }); } await apiManage('device_ping', { deviceId, email: me.email }); } catch(_) {}
      return;
    }
  } catch(_) {}

  overlay.classList.remove('hidden');
  if (error) error.classList.remove('show');
  if (loginDesc) loginDesc.textContent = 'Login dengan akun Google yang terdaftar untuk mengakses dashboard';

  if (btn) {
    btn.addEventListener('click', function() {
      window.location.href = '/api/auth?action=login&redirect=/';
    });
  }
}
