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
const { getSettings } = require('./settings');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });
const cfg = loadConfig();
const db = openDb();
let sock = null;
let ticker = null;
let waConnected = false;
let waSejak = null;
let grupNama = null;

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
  if (!waConnected) return;
  for (const r of dueReminders(db, getSettings(db, cfg))) {
    try {
      await sock.sendMessage(cfg.groupJid, { text: r.text });
      db.tandaiTerkirim(r.key);
      db.addLog(r.mode, 'terkirim', r.text.split('\n')[0].replace(/[*_]/g, '').slice(0, 120));
      log.info({ key: r.key }, 'pengingat terkirim');
    } catch (err) {
      db.addLog(r.mode, 'gagal', `${r.key}: ${err.message}`);
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

  // Alternatif QR: kalau PAIRING_NUMBER diisi, bot minta kode tautan 8 huruf
  // yang dimasukkan di HP bot (WhatsApp > Perangkat tertaut > Tautkan dengan nomor telepon).
  const pairNum = (process.env.PAIRING_NUMBER || '').replace(/\D/g, '');
  if (pairNum && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(pairNum);
        log.info(`KODE TAUTAN WHATSAPP: ${code}`);
        console.log(`\n=== KODE TAUTAN WHATSAPP: ${code} ===\n`);
      } catch (err) { log.error({ err }, 'gagal minta kode tautan'); }
    }, 3000);
  }
  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr && !pairNum) {
      console.log('Scan QR ini dari WhatsApp > Perangkat tertaut:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      waConnected = true;
      waSejak = Date.now();
      if (cfg.groupJid) sock.groupMetadata(cfg.groupJid).then((m) => { grupNama = m.subject; }).catch(() => {});
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
      if (!/^[/!.]\w/.test(text)) continue;
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

const bot = {
  status: () => ({
    wa: waConnected,
    nomor: sock?.user?.id ? digits(sock.user.id) : null,
    grupJid: cfg.groupJid || null,
    grupNama,
    sejak: waSejak,
  }),
  send: async (text) => {
    if (!sock || !waConnected) throw new Error('bot belum terhubung ke WhatsApp');
    if (!cfg.groupJid) throw new Error('GROUP_JID belum diisi');
    await sock.sendMessage(cfg.groupJid, { text });
  },
};

if (process.env.ADMIN_PASSWORD) {
  const port = Number(process.env.WEB_PORT || 3000);
  createWeb(db, { password: process.env.ADMIN_PASSWORD, secret: process.env.SESSION_SECRET, cfg, bot })
    .listen(port, '127.0.0.1', () => log.info(`Web jalan di http://127.0.0.1:${port}`));
} else {
  log.warn('ADMIN_PASSWORD kosong, web tidak dijalankan.');
}
