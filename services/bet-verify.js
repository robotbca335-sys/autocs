const BET_MIN = parseInt(process.env.BET_MIN || '1600');
const BET_MAX = parseInt(process.env.BET_MAX || '10000000');

const SCATTER_MULTIPLIERS = { 3: 2, 4: 5, 5: 20 };

function validateClaimInput(site, userId, kodeTiket, bet, scatter) {
  const errors = [];
  if (!site || typeof site !== 'string' || site.length > 64) errors.push('Situs wajib dipilih');
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) errors.push('User ID wajib diisi');
  if (userId && userId.length > 64) errors.push('User ID terlalu panjang');
  if (!kodeTiket || typeof kodeTiket !== 'string' || kodeTiket.trim().length === 0) errors.push('Kode tiket wajib diisi');
  if (kodeTiket && kodeTiket.length > 40) errors.push('Kode tiket terlalu panjang');
  const betNum = parseInt(String(bet).replace(/\D/g, ''), 10);
  if (isNaN(betNum) || betNum <= 0) errors.push('Nominal bet wajib diisi');
  if (betNum > 0 && betNum < BET_MIN) errors.push(`Nominal bet minimal Rp ${BET_MIN.toLocaleString('id-ID')}`);
  if (betNum > BET_MAX) errors.push(`Nominal bet maksimal Rp ${BET_MAX.toLocaleString('id-ID')}`);
  const sc = parseInt(scatter, 10);
  if (![3, 4, 5].includes(sc)) errors.push('Jumlah scatter harus 3, 4, atau 5');
  return errors;
}

function isDuplicateCode(code) {
  if (!code) return false;
  return /^(\d)\1{18}$/.test(code);
}

function hasExcessiveRepeat(code) {
  if (!code) return false;
  return /(\d)\1{10,}/.test(code);
}

function calculateBonus(betAmount, scatter) {
  const multiplier = SCATTER_MULTIPLIERS[scatter] || 1;
  return betAmount * multiplier;
}

function formatCurrency(amount) {
  return `Rp ${Number(amount).toLocaleString('id-ID')}`;
}

function formatTimestamp(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

module.exports = {
  BET_MIN, BET_MAX, SCATTER_MULTIPLIERS,
  validateClaimInput, isDuplicateCode, hasExcessiveRepeat,
  calculateBonus, formatCurrency, formatTimestamp
};
