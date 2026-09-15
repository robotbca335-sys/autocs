function extractTicketCode(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.replace(/\s+/g, '');
  const matches = cleaned.match(/\d{15,25}/g);
  if (!matches) return null;
  for (const m of matches) {
    if (m.startsWith('2') && m.length === 19) return m;
  }
  for (const m of matches) {
    if (m.length >= 17) return m;
  }
  return matches[0] || null;
}

function extractAllCodes(text) {
  if (!text || typeof text !== 'string') return [];
  const cleaned = text.replace(/\s+/g, '');
  const matches = cleaned.match(/\d{15,25}/g);
  if (!matches) return [];
  return matches.filter(m => m.startsWith('2') && m.length >= 17);
}

function validateCode(code) {
  if (!code || typeof code !== 'string') return false;
  const clean = code.replace(/\D/g, '');
  if (clean.length < 15 || clean.length > 25) return false;
  if (!clean.startsWith('2')) return false;
  if (/^(\d)\1+$/.test(clean)) return false;
  return true;
}

function cleanKode(raw) {
  if (!raw) return '';
  return raw.replace(/[^0-9]/g, '');
}

module.exports = { extractTicketCode, extractAllCodes, validateCode, cleanKode };
