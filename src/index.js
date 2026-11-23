require('dotenv').config();
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const {
  default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, proto, getAggregateVotesInPollMessage,
} = require('@whiskeysockets/baileys');

const { openDb } = require('./db');
const { loadConfig } = require('./config');
const { handle, handleBalasan } = require('./commands');
const { kirimPush, dariPesanWa } = require('./push');
const { dueReminders } = require('./reminders');
const { createWeb } = require('./web');
const { startAutoBackup } = require('./backup');
const { getSettings } = require('./settings');
const { isLoginRequest, senderNumbers, createLoginToken, loginReply } = require('./walogin');
const { ymd } = require('./jadwal');
const { buatLaporan } = require('./laporan');
const { parseLocal } = require('./time');

// Catatan peringatan/error terakhir, ditampilkan di menu Status Bot (supaya tidak perlu SSH untuk cek masalah).
const catatanBot = [];
const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  hooks: {
    logMethod(args, method, level) {
      if (level >= 40) {
        const a = args.find((x) => typeof x === 'string') || '';
        const o = args.find((x) => x && typeof x === 'object');
        const err = o?.err?.message || o?.message || '';
        catatanBot.unshift({ at: Date.now(), level: level >= 50 ? 'error' : 'warn', pesan: `${a}${err ? `: ${err}` : ''}`.slice(0, 300) || 'peringatan' });
        catatanBot.length = Math.min(catatanBot.length, 30);
      }
      return method.apply(this, args);
    },
  },
});
const cfg = loadConfig();

// Pemulihan backup dari web: file disiapkan sebelum restart, ditukar di sini sebelum database dibuka.
const DB_FILE = path.join(__dirname, '..', 'data', 'kuliah.db');
const RESTORE_FILE = `${DB_FILE}.restore`;
if (fs.existsSync(RESTORE_FILE)) {
  for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(DB_FILE + ext)) fs.renameSync(DB_FILE + ext, `${DB_FILE}.sebelum-restore${ext}`);
  fs.renameSync(RESTORE_FILE, DB_FILE);
  log.warn('Database dipulihkan dari backup');
}
const db = openDb(DB_FILE);
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

const jeda = (ms) => new Promise((r) => setTimeout(r, ms));
let ticking = false;
let gagalBeruntun = 0;
let pesanTerakhir = null;
// Grup tujuan: bisa diganti dari WA (/pakaigrup) atau web, tanpa edit .env. GROUP_JID jadi cadangan.
const grupJid = () => db.getSetting('grupJid') || cfg.groupJid;
// Tujuan pesan bot: 'grup' (normal) atau 'pribadi' (semua pesan otomatis dialihkan ke satu nomor).
const tujuanSetel = () => db.getSetting('tujuan') || { mode: 'grup', nomor: null };
const nomorPribadi = () => { const t = tujuanSetel(); return t.mode === 'pribadi' && t.nomor ? t.nomor : null; };
/** JID tujuan untuk pesan yang seharusnya ke grup. */
function jidGrupAtauPribadi() {
  const n = nomorPribadi(); if (n) return jidDari(n);
  if (!grupJid()) throw new Error('grup tujuan belum diatur');
  return grupJid();
}
function perbaruiNamaGrup() {
  grupNama = null;
  if (sock && grupJid()) sock.groupMetadata(grupJid()).then((m) => { grupNama = m.subject; }).catch(() => {});
}
let putusSejak = null;
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
const terakhirKabar = {};
const jidDari = (nomor) => (String(nomor).includes('@') ? String(nomor) : `${String(nomor).replace(/\D/g, '')}@s.whatsapp.net`);

/** Kirim peringatan ke admin (akun admin yang punya nomor WA + ADMIN_NUMBERS), maks. sekali per jam per jenis. */
async function kabariAdmin(text, jenis) {
  if (!sock || !waConnected) return;
  if (terakhirKabar[jenis] && Date.now() - terakhirKabar[jenis] < 3600000) return;
  terakhirKabar[jenis] = Date.now();
  const nomor = new Set([...cfg.admins, ...db.adminWa().map((a) => a.wa)].filter(Boolean));
  for (const n of nomor) { try { await sock.sendMessage(jidDari(n), { text }); await jeda(1000); } catch { /* abaikan */ } }
}

// Simpan pesan polling yang dikirim, supaya suara yang masuk bisa dibaca (dienkripsi WhatsApp).
function pesanPolling(key) {
  const p = key?.id && db.pollingByMsgId(key.id);
  return p?.msg ? proto.Message.decode(Buffer.from(p.msg, 'base64')) : undefined;
}

// Batas waktu kirim: pengiriman yang menggantung tidak boleh mengunci penjadwal.
const denganBatas = (p, ms = 45000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`tidak ada respons WhatsApp dalam ${ms / 1000} detik`)), ms))]);
let tickTerakhir = null; let tickInfo = 'belum berjalan';

async function tick() {
  if (!sock) { tickInfo = 'bot belum siap'; return; }
  if (!waConnected) { tickInfo = 'menunggu WhatsApp tersambung'; tickTerakhir = Date.now(); return; }
  if (ticking) return;
  ticking = true; tickTerakhir = Date.now(); tickInfo = 'berjalan normal';
  try {
    for (const r of dueReminders(db, getSettings(db, cfg))) {
      // r.to = chat pribadi anggota. Mode pribadi: semuanya dialihkan ke nomor pribadi admin.
      const alih = nomorPribadi();
      const tujuan = alih ? jidDari(alih) : r.to || grupJid();
      if (!tujuan) continue;
      if (alih && r.to) r.text = `_(salinan pengingat untuk ${db.akunById(r.akunId)?.nama || 'anggota'})_\n${r.text}`;
      try {
        const gambar = r.gambar && path.join(UPLOAD_DIR, path.basename(r.gambar));
        await denganBatas(sock.sendMessage(tujuan, gambar && fs.existsSync(gambar) ? { image: fs.readFileSync(gambar), caption: r.text } : { text: r.text }));
        db.tandaiTerkirim(r.key);
        if (r.pengumumanId) db.setPengumumanStatus(r.pengumumanId, 'terkirim');
        // Notifikasi push: pesan grup ke semua perangkat, pesan pribadi hanya ke pemiliknya.
        const n = dariPesanWa(r.text);
        kirimPush(db, { ...n, akunIds: r.akunId ? [r.akunId] : null, url: r.mode === 'tugas' || r.mode === 'pribadi' ? '/#tugas' : '/#dashboard', tag: r.key }).catch(() => {});
        gagalBeruntun = 0;
        db.addLog(r.mode, 'terkirim', (r.to ? `ke +${digits(r.to)}: ` : '') + r.text.split('\n')[0].replace(/[*_]/g, '').slice(0, 120));
        log.info({ key: r.key }, 'pengingat terkirim');
      } catch (err) {
        db.addLog(r.mode, 'gagal', `${r.key}: ${err.message}`);
        log.error({ err, key: r.key }, 'gagal kirim pengingat');
        if (++gagalBeruntun >= 3) kabariAdmin(`⚠️ *Bot gagal mengirim ${gagalBeruntun} pesan berturut-turut.*\nError terakhir: ${err.message}\nCek menu Status Bot di web.`, 'gagal');
      }
      // Jeda antar chat pribadi supaya nomor bot tidak dianggap spam oleh WhatsApp.
      if (r.to) await jeda(1500 + Math.random() * 1500);
    }
    await laporanTerjadwal();
    const now = Date.now();
    db.bersihkanTerkirim(now - 30 * 86400000);
    for (const p of db.pengumumanJatuhTempo(now - 6 * 3600000)) db.setPengumumanStatus(p.id, 'kedaluwarsa', 'Bot tidak terhubung saat jadwal kirim');
    db.bersihkanKelasUbah(ymd(now - 200 * 86400000));
    db.bersihkanSampah(now - 30 * 86400000);
  } finally { ticking = false; }
}

// ---- Laporan server harian: hanya ke nomor admin, tidak ikut jam tenang / mode libur ----
function nomorLaporan() {
  const L = getSettings(db, cfg).laporan;
  return L.nomor || tujuanSetel().nomor || db.adminWa()[0]?.wa || cfg.admins[0] || null;
}
function situsLaporan() {
  const L = getSettings(db, cfg).laporan;
  return L.situs?.length ? L.situs : [process.env.WEB_URL].filter(Boolean);
}
const teksLaporan = () => buatLaporan({ db, bot, situs: situsLaporan(), dbFile: DB_FILE });
async function kirimLaporan() {
  const nomor = nomorLaporan();
  if (!nomor) throw new Error('nomor admin belum diatur (isi di Pengingat → Laporan server)');
  const { text } = await teksLaporan();
  await denganBatas(sock.sendMessage(jidDari(nomor), { text }));
  db.addLog('laporan', 'terkirim', `ke +${nomor}: laporan server harian`);
}
async function laporanTerjadwal() {
  const L = getSettings(db, cfg).laporan; if (!L?.on) return;
  const now = Date.now(); const hari = ymd(now); const at = parseLocal(`${hari} ${L.jam}`);
  const key = `laporan:${hari}`;
  if (now < at || now - at > 6 * 3600000 || db.sudahTerkirim(key)) return;
  db.tandaiTerkirim(key); // tandai dulu supaya tidak dobel walau pengiriman lambat
  try { await kirimLaporan(); log.info('laporan server harian terkirim'); }
  catch (err) { db.addLog('laporan', 'gagal', err.message); log.error({ err }, 'gagal kirim laporan server'); }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, '..', 'auth'));
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, auth: state, logger: log.child({ module: 'baileys' }, { level: 'warn' }), getMessage: async (key) => pesanPolling(key) });

  // Hasil polling: setiap ada suara masuk, hitung ulang dan simpan.
  sock.ev.on('messages.update', (updates) => {
    for (const { key, update } of updates) {
      if (!update.pollUpdates) continue;
      const p = db.pollingByMsgId(key.id); const msg = pesanPolling(key);
      if (!p || !msg) continue;
      try {
        const agg = getAggregateVotesInPollMessage({ message: msg, pollUpdates: update.pollUpdates });
        const lama = p.hasil ? JSON.parse(p.hasil) : {};
        const hasil = { ...lama, opsi: agg.map((o) => ({ nama: o.name, suara: o.voters.length })), pemilih: [...new Set(agg.flatMap((o) => o.voters))].length, at: Date.now() };
        db.setPollingHasil(p.id, hasil);
      } catch (err) { log.warn({ err }, 'gagal membaca suara polling'); }
    }
  });

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
      setTimeout(() => tick().catch((err) => log.error({ err }, 'penjadwal gagal')), 5000); // langsung kejar pengingat yang tertunda
      if (putusSejak && Date.now() - putusSejak > 5 * 60000) {
        const menit = Math.round((Date.now() - putusSejak) / 60000);
        setTimeout(() => kabariAdmin(`⚠️ *Bot sempat terputus dari WhatsApp selama ${menit} menit.*\nSekarang sudah tersambung lagi. Pengingat yang jatuh tempo saat terputus lebih dari 10 menit tidak dikirim ulang.`, 'putus'), 5000);
      }
      putusSejak = null;
      perbaruiNamaGrup();
      log.info('Terhubung ke WhatsApp');
      if (!grupJid()) log.warn('Grup tujuan belum diatur. Admin ketik /pakaigrup di grup kelas, atau pilih di menu Status Bot.');
    }
    if (connection === 'close') {
      waConnected = false;
      if (!putusSejak) putusSejak = Date.now();
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log.error('Logout dari WhatsApp. Hapus folder auth/ lalu jalankan ulang untuk scan QR.');
        process.exit(1);
      }
      log.warn({ code }, 'Koneksi putus, menyambung ulang...');
      setTimeout(startSafe, 3000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      pesanTerakhir = Date.now();
      if (!m.message || m.key.fromMe) continue;
      const text = textOf(m);
      const chat = m.key.remoteJid || '';
      const diGrup = chat.endsWith('@g.us');
      // Di grup hanya /login (kata "masuk" biasa tidak dibalas); di chat pribadi "login" atau "masuk" cukup.
      const pribadi = /@(s\.whatsapp\.net|lid)$/.test(chat);
      if (isLoginRequest(text) && (pribadi || (diGrup && /^\s*[/!.]/.test(text)))) {
        try {
          const reply = diGrup
            ? 'Untuk keamanan, minta link masuk lewat chat pribadi ke nomor bot ini: kirim *login*.'
            : loginReply(createLoginToken(db, senderNumbers(m.key)), process.env.WEB_URL);
          await sock.sendMessage(chat, { text: reply }, { quoted: m });
        } catch (err) { log.error({ err }, 'gagal memproses permintaan login'); }
        continue;
      }
      // Balas pesan pengingat tugas dengan "udah" → tandai kumpul.
      const ctx = m.message?.extendedTextMessage?.contextInfo;
      const quoted = ctx?.quotedMessage?.conversation || ctx?.quotedMessage?.extendedTextMessage?.text || ctx?.quotedMessage?.imageMessage?.caption;
      if (quoted && !/^[/!.]/.test(text)) {
        try {
          const akun = senderNumbers(m.key).map((n) => db.akunByWa(n)).find(Boolean) || null;
          const reply = handleBalasan(db, text, quoted, akun);
          if (reply) await sock.sendMessage(chat, { text: reply }, { quoted: m });
        } catch (err) { log.error({ err }, 'gagal memproses balasan'); }
        continue;
      }
      if (!/^[/!.]\w/.test(text)) continue;
      try {
        const akun = senderNumbers(m.key).map((n) => db.akunByWa(n)).find(Boolean) || null;
        const reply = handle(db, text, { isAdmin: await isAdmin(m), chatJid: m.key.remoteJid, akun, oleh: akun?.nama || m.pushName || 'Anggota' });
        if (reply) await sock.sendMessage(m.key.remoteJid, { text: reply }, { quoted: m });
      } catch (err) {
        log.error({ err }, 'gagal memproses perintah');
      }
    }
  });

  if (!ticker) ticker = setInterval(() => tick().catch((err) => { tickInfo = `error: ${err.message}`; log.error({ err }, 'penjadwal gagal'); }), 60 * 1000);
}

// Kalau start() gagal (misal internet VPS putus saat mengambil versi WA), coba lagi, jangan crash.
function startSafe() {
  start().catch((err) => {
    log.error({ err }, 'gagal menyambung ke WhatsApp, coba lagi 10 detik');
    setTimeout(startSafe, 10000);
  });
}

startSafe();
startAutoBackup(db, { at: cfg.backupAt, keep: cfg.backupKeep, log });

const bot = {
  status: () => ({
    wa: waConnected,
    nomor: sock?.user?.id ? digits(sock.user.id) : null,
    grupJid: grupJid() || null,
    tujuan: tujuanSetel(),
    pesanTerakhir,
    penjadwal: { terakhir: tickTerakhir, info: tickInfo },
    catatan: catatanBot.slice(0, 15),
    grupNama,
    sejak: waSejak,
  }),
  send: async (text, { gambar } = {}) => {
    if (!sock || !waConnected) throw new Error('bot belum terhubung ke WhatsApp');
    await sock.sendMessage(jidGrupAtauPribadi(), gambar && fs.existsSync(gambar) ? { image: fs.readFileSync(gambar), caption: text } : { text });
  },
  laporan: async ({ kirim } = {}) => {
    if (!kirim) return { ...(await teksLaporan()), nomor: nomorLaporan(), situs: situsLaporan() };
    if (!sock || !waConnected) throw new Error('bot belum terhubung ke WhatsApp');
    await kirimLaporan(); return { ok: true, nomor: nomorLaporan() };
  },
  sendTo: async (nomor, text) => {
    if (!sock || !waConnected) throw new Error('bot belum terhubung ke WhatsApp');
    await sock.sendMessage(jidDari(nomor), { text });
  },
  daftarGrup: async () => {
    if (!sock || !waConnected) throw new Error('bot belum terhubung ke WhatsApp');
    const g = await sock.groupFetchAllParticipating();
    return Object.values(g).map((x) => ({ jid: x.id, nama: x.subject, anggota: x.participants?.length || 0 })).sort((a, b) => a.nama.localeCompare(b.nama));
  },
  pakaiGrup: async (jid) => {
    db.setSetting('grupJid', jid); perbaruiNamaGrup();
    log.info({ jid }, 'grup tujuan diganti');
  },
  sendPoll: async (name, values, ganda) => {
    if (!sock || !waConnected) throw new Error('bot belum terhubung ke WhatsApp');
    const sent = await sock.sendMessage(jidGrupAtauPribadi(), { poll: { name, values, selectableCount: ganda ? 0 : 1 } });
    return { id: sent.key.id, msg: Buffer.from(proto.Message.encode(sent.message).finish()).toString('base64') };
  },
};

if (process.env.ADMIN_PASSWORD) {
  const port = Number(process.env.WEB_PORT || 3000);
  // Pulihkan backup: salin ke file .restore lalu keluar; pm2 menyalakan ulang dan file ditukar saat start.
  const onRestore = (file) => { fs.copyFileSync(file, RESTORE_FILE); log.warn({ file }, 'restart untuk memulihkan backup'); process.exit(0); };
  createWeb(db, { password: process.env.ADMIN_PASSWORD, secret: process.env.SESSION_SECRET, cfg, bot, uploadDir: UPLOAD_DIR, onRestore })
    .listen(port, '127.0.0.1', () => log.info(`Web jalan di http://127.0.0.1:${port}`));
} else {
  log.warn('ADMIN_PASSWORD kosong, web tidak dijalankan.');
}
