// Notifikasi push di HP/laptop (aplikasi yang di-install / browser), pelengkap pesan WhatsApp.
const webpush = require('web-push');

function vapid(db) {
  let k = db.getSetting('vapid');
  if (!k) { k = webpush.generateVAPIDKeys(); db.setSetting('vapid', k); }
  return k;
}

/**
 * Kirim notifikasi ke semua langganan (akunIds = null) atau ke akun tertentu.
 * Langganan yang sudah tidak berlaku (404/410) dihapus otomatis.
 */
async function kirimPush(db, { akunIds = null, title, body, url = '/', tag } = {}) {
  const subs = db.pushSubs(akunIds);
  if (!subs.length) return 0;
  const k = vapid(db);
  webpush.setVapidDetails(process.env.WEB_URL || 'https://example.com', k.publicKey, k.privateKey);
  const payload = JSON.stringify({ title, body, url, tag });
  let n = 0;
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification(JSON.parse(s.data), payload, { TTL: 6 * 3600 }); n++; }
    catch (err) { if (err.statusCode === 404 || err.statusCode === 410) db.delPushSub(s.endpoint); }
  }));
  return n;
}

// Ringkas pesan WA jadi judul + isi notifikasi.
function dariPesanWa(text) {
  const baris = String(text).replace(/[*_~]/g, '').split('\n').map((x) => x.trim()).filter(Boolean);
  return { title: baris[0]?.slice(0, 80) || 'Six Seven 67', body: baris.slice(1).join(' · ').slice(0, 220) };
}

module.exports = { vapid, kirimPush, dariPesanWa };
