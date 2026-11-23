process.env.TZ_OFFSET = '7';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { openDb } = require('../src/db');
const { buatLaporan, cekSitus } = require('../src/laporan');
const { loadConfig } = require('../src/config');
const { getSettings, validate } = require('../src/settings');
const { handleBalasan } = require('../src/commands');
const { pesanTugas } = require('../src/messages');
const { hashPassword } = require('../src/auth');

const GB = 1024 ** 3;
const dasar = { load: [0.2, 0.3, 0.25], cpu: 2, memTotal: 4 * GB, memBebas: 2 * GB, uptime: 3 * 86400, disk: { total: 40 * GB, bebas: 30 * GB }, host: 'vps', situs: [] };

test('laporan server: semua normal', async () => {
  const db = openDb(':memory:');
  const bot = { status: () => ({ wa: true, grupJid: 'g', grupNama: 'Kelas 67' }) };
  const pm2 = [{ nama: 'wa-pengingat-kuliah', status: 'online', restart: 0, sejak: Date.now() - 7200000, mem: 120 * 1024 * 1024, cpu: 1 },
    { nama: 'porto-next', status: 'online', restart: 2, sejak: Date.now() - 86400000 * 5, mem: 200 * 1024 * 1024, cpu: 0 }];
  const situs = [{ url: 'https://iwak67gacor.web.id', host: 'iwak67gacor.web.id', ok: true, status: 200, ms: 120, ssl: 60 }];
  const { text, masalah } = await buatLaporan({ db, bot, sumber: { ...dasar, pm2, situs } });
  assert.match(text, /Laporan server harian/);
  assert.match(text, /RAM 2\.0 GB \/ 4\.0 GB \(50%\)/);
  assert.match(text, /Disk 10\.0 GB \/ 40\.0 GB \(25%\)/);
  assert.match(text, /✅ \*porto-next\* · jalan 5 hari\n {4}RAM 200 MB · CPU 0% · restart 2×/);
  assert.match(text, /✅ \*iwak67gacor\.web\.id\*\n {4}HTTP 200 · 120 ms · 🔒 SSL 60 hari lagi/);
  assert.match(text, /WhatsApp terhubung · grup Kelas 67/);
  // satu-satunya masalah: belum ada backup (di tes tidak ada folder backup)
  assert.ok(masalah <= 1);
});

test('laporan server: masalah ditandai di ringkasan', async () => {
  const db = openDb(':memory:');
  db.addLog('tugas', 'gagal', 'x');
  const bot = { status: () => ({ wa: false }) };
  const pm2 = [{ nama: 'porto-next', status: 'errored', restart: 15, mem: 0, cpu: 0 }];
  const situs = [{ url: 'https://porto.id', host: 'porto.id', ok: false, error: 'tidak merespons (timeout)', ssl: 5 }];
  const { text, masalah } = await buatLaporan({ db, bot, sumber: { ...dasar, memBebas: 0.2 * GB, disk: { total: 40 * GB, bebas: 2 * GB }, pm2, situs } });
  assert.ok(masalah >= 6);
  assert.match(text, /⚠️ \*\d+ hal perlu dicek:\* .*RAM hampir penuh.*disk hampir penuh.*porto-next errored.*porto\.id tidak bisa dibuka.*SSL porto\.id berakhir 5 hari lagi.*WhatsApp bot terputus.*1 pesan gagal/);
  assert.match(text, /❌ \*porto-next\* · errored/);
  assert.match(text, /❌ \*porto\.id\*\n {4}tidak merespons \(timeout\) · ⚠️ SSL 5 hari lagi/);
  // pm2 tidak tersedia
  assert.match((await buatLaporan({ db, bot, sumber: { ...dasar, pm2: null } })).text, /Daftar pm2 tidak bisa dibaca/);
});

test('cekSitus membaca status HTTP dan waktu respons', async () => {
  const srv = http.createServer((req, res) => { res.statusCode = req.url === '/rusak' ? 503 : 200; res.end('ok'); }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const a = await cekSitus(base + '/'); assert.deepEqual([a.ok, a.status], [true, 200]); assert.ok(a.ms >= 0);
    const b = await cekSitus(base + '/rusak'); assert.deepEqual([b.ok, b.status], [false, 503]);
    assert.equal((await cekSitus('bukan url')).ok, false);
  } finally { srv.close(); }
});

test('pengaturan laporan: default jam 00:00, validasi nomor & situs', () => {
  const cfg = loadConfig({}); const db = openDb(':memory:');
  assert.deepEqual(getSettings(db, cfg).laporan, { on: true, jam: '00:00', nomor: null, situs: [] });
  const dasarS = getSettings(db, cfg);
  const ok = validate({ ...dasarS, laporan: { on: true, jam: '00:00', nomor: '0812-3456-7890', situs: ['iwak67gacor.web.id', '', 'https://porto.my.id'] } }, cfg);
  assert.deepEqual(ok.value.laporan, { on: true, jam: '00:00', nomor: '6281234567890', situs: ['https://iwak67gacor.web.id', 'https://porto.my.id'] });
  assert.match(validate({ ...dasarS, laporan: { nomor: '12' } }, cfg).error, /Nomor WA/);
  assert.match(validate({ ...dasarS, laporan: { situs: ['http://exa mple'] } }, cfg).error, /situs/);
});

test('nomor tugas ditulis "no. 5" dan balasan "udah" tetap dikenali (format lama juga)', () => {
  const db = openDb(':memory:');
  const t = db.addTugas({ matkul: 'Biologi', judul: 'Laprak', deadline: Date.now() + 86400000 * 2 });
  const a = Number(db.addAkun({ username: 'b', nama: 'B', role: 'viewer', hash: hashPassword('x12345678') }));
  const teks = pesanTugas(db).text;
  assert.match(teks, new RegExp(`Laprak _\\(no\\. ${t}\\)_`));
  assert.match(handleBalasan(db, 'udah', teks, db.akunById(a)), /sudah kamu kumpulkan/);
  db.addTugas({ matkul: 'Fisika', judul: 'PR', deadline: Date.now() + 86400000 * 3 });
  assert.match(handleBalasan(db, 'udah', pesanTugas(db).text, db.akunById(a)), /beberapa tugas/); // 2 tugas → tidak menebak
  db.setKumpul(t, a, false);
  assert.match(handleBalasan(db, 'sudah', `▸ *Biologi* — Laprak _(#${t})_`, db.akunById(a)), /sudah kamu kumpulkan/);
});

test('salinan pesan keluar disimpan untuk kirim ulang dan dibersihkan setelah 7 hari', () => {
  const { proto } = require('@whiskeysockets/baileys');
  const db = openDb(':memory:');
  const enc = (m) => Buffer.from(proto.Message.encode(m).finish()).toString('base64');
  db.simpanPesanKeluar('MSG1', enc({ extendedTextMessage: { text: '⏰ *Pengingat tugas*' } }));
  assert.equal(proto.Message.decode(Buffer.from(db.pesanKeluar('MSG1'), 'base64')).extendedTextMessage.text, '⏰ *Pengingat tugas*');
  assert.equal(db.pesanKeluar('TIDAKADA'), null);
  assert.equal(db.bersihkanPesanKeluar(Date.now() - 7 * 86400000), 0);
  assert.equal(db.bersihkanPesanKeluar(Date.now() + 1000), 1);
});
