require('dotenv').config();
const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const {
  default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const { openDb } = require('./db');
const { loadConfig } = require('./config');
const { handle } = require('./commands');
const { dueReminders } = require('./reminders');
const { createWeb } = require('./web');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });
const cfg = loadConfig();
const db = openDb();
let sock = null;
let ticker = null;
let waConnected = false;

const textOf = (m) => m.message?.conversation
  || m.message?.extendedTextMessage?.text
  || m.message?.imageMessage?.caption
  || '';

const digits = (jid = '') => jid.split('@')[0].split(':')[0];

async function isAdmin(m) {
  const chat = m.key.remoteJid;
  const sender = m.key.participant || chat;
  const candidates = [sender, m.key.participantPn, m.key.participantAlt, m.key.senderPn].filter(Boolean);
  if (candidates.some((j) => cfg.admins.includes(digits(j)))) return true;
  if (chat.endsWith('@g.us')) {
    try {
      const meta = await sock.groupMetadata(chat);
      return meta.participants.some((p) => candidates.includes(p.id) && p.admin);
    } catch { /* abaikan */ }
  }
  return false;
}

async function tick() {
  if (!sock || !cfg.groupJid) return;
  for (const r of dueReminders(db, cfg)) {
    try {
      await sock.sendMessage(cfg.groupJid, { text: r.text });
      db.tandaiTerkirim(r.key);
      log.info({ key: r.key }, 'pengingat terkirim');
    } catch (err) {
      log.error({ err, key: r.key }, 'gagal kirim pengingat');
    }
  }
  db.bersihkanTerkirim(Date.now() - 30 * 86400000);
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, '..', 'auth'));
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, auth: state, logger: log.child({ module: 'baileys' }, { level: 'warn' }) });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('Scan QR ini dari WhatsApp > Perangkat tertaut:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      waConnected = true;
      log.info('Terhubung ke WhatsApp');
      if (!cfg.groupJid) log.warn('GROUP_JID belum diisi. Ketik /groupid di grup kelas, lalu isi di .env dan restart.');
    }
    if (connection === 'close') {
      waConnected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log.error('Logout dari WhatsApp. Hapus folder auth/ lalu jalankan ulang untuk scan QR.');
        process.exit(1);
      }
      log.warn({ code }, 'Koneksi putus, menyambung ulang...');
      setTimeout(start, 3000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      if (!m.message || m.key.fromMe) continue;
      const text = textOf(m);
      if (!text.startsWith('/')) continue;
      try {
        const reply = handle(db, text, { isAdmin: await isAdmin(m), chatJid: m.key.remoteJid });
        if (reply) await sock.sendMessage(m.key.remoteJid, { text: reply }, { quoted: m });
      } catch (err) {
        log.error({ err }, 'gagal memproses perintah');
      }
    }
  });

  if (!ticker) ticker = setInterval(() => tick().catch((err) => log.error({ err })), 60 * 1000);
}

start();

if (process.env.ADMIN_PASSWORD) {
  const port = Number(process.env.WEB_PORT || 3000);
  createWeb(db, {
    password: process.env.ADMIN_PASSWORD,
    publicView: process.env.PUBLIC_VIEW === 'true',
    getStatus: () => ({ wa: waConnected, grup: !!cfg.groupJid }),
  }).listen(port, '127.0.0.1', () => log.info(`Web UI jalan di http://127.0.0.1:${port}`));
} else {
  log.warn('ADMIN_PASSWORD kosong, web UI tidak dijalankan.');
}
