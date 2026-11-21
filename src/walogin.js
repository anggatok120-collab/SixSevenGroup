// Masuk lewat WhatsApp: anggota kirim "login" ke bot dari nomor yang terdaftar di akunnya,
// bot membalas link masuk sekali pakai yang berlaku 10 menit.
const crypto = require('crypto');

const LINK_MINUTES = 10;
const MAX_PER_WINDOW = 3; // link per nomor per 10 menit

/** Normalisasi nomor ke format internasional Indonesia: 0812… / +62 812… → 62812… */
function normalWa(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = `62${d.slice(1)}`;
  else if (d.startsWith('8')) d = `62${d}`;
  return /^\d{9,15}$/.test(d) ? d : null;
}

/** Ambil semua nomor telepon pengirim dari pesan Baileys (chat pribadi, termasuk akun LID). */
function senderNumbers(key = {}) {
  return [key.remoteJid, key.senderPn, key.participant, key.participantPn, key.remoteJidAlt]
    .filter((j) => typeof j === 'string' && j.endsWith('@s.whatsapp.net'))
    .map((j) => j.split('@')[0].split(':')[0]);
}

const isLoginRequest = (text) => /^\s*[/!.]?\s*(login|masuk)\s*$/i.test(String(text || ''));
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

/**
 * Buat link masuk untuk nomor pengirim. Hasil: { akun, token } | { error }.
 */
function createLoginToken(db, numbers, now = Date.now()) {
  const akun = numbers.map((n) => db.akunByWa(n)).find(Boolean);
  if (!akun) return { error: 'unknown' };
  db.bersihkanLoginLink(now);
  if (db.loginLinkCount(akun.id, now - LINK_MINUTES * 60000) >= MAX_PER_WINDOW) return { error: 'limit', akun };
  const token = crypto.randomBytes(24).toString('base64url');
  db.addLoginLink({ hash: sha(token), akun_id: akun.id, dibuat: now, exp: now + LINK_MINUTES * 60000 });
  return { akun, token };
}

/** Tukar token jadi akun. Token hanya bisa dipakai sekali dan sebelum kedaluwarsa. */
function redeemLoginToken(db, token, now = Date.now()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const row = db.pakaiLoginLink(sha(token), now);
  return row ? db.akunById(row.akun_id) : null;
}

function loginReply(res, webUrl) {
  if (res.error === 'unknown') {
    return 'Nomor WhatsApp ini belum terhubung ke akun mana pun.\nMinta admin kelas menambahkan nomormu di menu *Management Akun* pada web, lalu kirim *login* lagi.';
  }
  if (res.error === 'limit') return 'Kamu sudah minta link masuk 3 kali dalam 10 menit terakhir. Pakai link yang sudah dikirim, atau coba lagi nanti.';
  const base = (webUrl || '').replace(/\/+$/, '');
  if (!base) return 'Alamat web belum diatur (WEB_URL). Hubungi admin kelas.';
  return `🔐 *Link masuk Six Seven 67*\nHalo ${res.akun.nama}, ketuk link ini untuk masuk sebagai *${res.akun.username}*:\n${base}/login?wa=${res.token}\n\nBerlaku ${LINK_MINUTES} menit dan hanya bisa dipakai sekali. Jangan bagikan link ini ke siapa pun.`;
}

module.exports = { LINK_MINUTES, normalWa, senderNumbers, isLoginRequest, createLoginToken, redeemLoginToken, loginReply };
