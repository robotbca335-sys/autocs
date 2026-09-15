async function sendAlert(type, data) {
  const msg = formatAlertMessage(type, data);
  console.log(`[ALERT:${type}]`, msg);
  return { type, message: msg, timestamp: new Date().toISOString() };
}

function formatAlertMessage(type, data) {
  switch (type) {
    case 'CLAIM_RECEIVED':
      return `Claim baru dari ${data.user_id} - ${data.kode_tiket} (${data.site})`;
    case 'CLAIM_APPROVED':
      return `Claim ${data.kode_tiket} DISETUJUI - ${data.user_id}`;
    case 'CLAIM_REJECTED':
      return `Claim ${data.kode_tiket} DITOLAK - ${data.user_id}`;
    case 'BET_VERIFIED':
      return `Bet terverifikasi: ${data.kode_tiket} - ${data.user_id}`;
    case 'BET_NOT_FOUND':
      return `Bet tidak ditemukan: ${data.kode_tiket} - ${data.user_id}`;
    case 'PROCESSING_ERROR':
      return `Error processing: ${data.kode_tiket} - ${data.error || 'Unknown'}`;
    case 'DAILY_LIMIT':
      return `Daily limit reached untuk ${data.user_id}`;
    default:
      return JSON.stringify(data);
  }
}

async function sendDiscordWebhook(webhookUrl, embed) {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });
  } catch (e) {
    console.error('Discord webhook failed:', e.message);
  }
}

function createDiscordEmbed(type, data) {
  const colors = {
    CLAIM_RECEIVED: 0x5865F2,
    CLAIM_APPROVED: 0x57C98D,
    CLAIM_REJECTED: 0xEF6A6A,
    BET_VERIFIED: 0xD8B45A,
    ERROR: 0xFF0000
  };
  return {
    title: `Scatter Claim - ${type}`,
    description: formatAlertMessage(type, data),
    color: colors[type] || 0x808080,
    timestamp: new Date().toISOString(),
    fields: data ? Object.entries(data).slice(0, 5).map(([k, v]) => ({
      name: k, value: String(v).substring(0, 100), inline: true
    })) : []
  };
}

module.exports = { sendAlert, sendDiscordWebhook, createDiscordEmbed, formatAlertMessage };
