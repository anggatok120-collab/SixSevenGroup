process.env.TZ_OFFSET = '7';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../src/db');
const { createWeb } = require('../src/web');
const { loadConfig } = require('../src/config');
const { handle, handleBalasan } = require('../src/commands');
const { dueReminders } = require('../src/reminders');
const { getSettings } = require('../src/settings');
const { pesanHariIni, pesanBesok, pesanPraktikum, pesanMingguan } = require('../src/messages');
const { buildIcs } = require('../src/ics');
const { parseLocal } = require('../src/time');
const { hashPassword } = require('../src/auth');

const cfg = loadConfig({});
const at = (s) => parseLocal(s);
const semua = (db, ubah) => { const s = getSettings(db, cfg); for (const k of Object.keys(s)) if ('on' in s[k]) s[k] = { ...s[k], on: false }; return { ...s, ...ubah }; };

function isi(db) {
  const p = Number(db.addPraktikum({ nama: 'Praktikum Kimia', lab: 'Lab Kimia 2', asisten: 'Kak Rina' }));
  const s = Number(db.addPrakSesi({ praktikum_id: p, judul: 'Modul 1: Titrasi', tanggal: '2026-11-24', mulai: '13:00', selesai: '15:00' }));
  const t = Number(db.addPrakTugas({ praktikum_id: p, jenis: 'Laporan', judul: 'Laporan Modul 1', deadline: at('2026-11-25 23:59') }));
  return { p, s, t };
}

test('pesan WA: praktikum masuk ringkasan pagi, besok, mingguan, dan /praktikum', () => {
  const db = openDb(':memory:'); const { t } = isi(db);
  const pagi = pesanHariIni(db, at('2026-11-24 06:00')).text;
  assert.match(pagi, /🧪 \*Praktikum hari ini\* · 1\n▸ \*Praktikum Kimia\* — Modul 1: Titrasi\n {4}🕗 13\.00–15\.00 · 🧪 Lab Kimia 2\n {4}👤 Asisten: Kak Rina/);
  assert.match(pagi, new RegExp(`Laporan: Laporan Modul 1 _\\(#P${t}\\)_`));
  assert.match(pagi, /Balas \*\/kumpul P nomor\*/);
  assert.match(pesanBesok(db, at('2026-11-23 20:00')).text, /Praktikum besok[\s\S]*jas lab/);
  assert.equal(pesanHariIni(db, at('2026-11-21 06:00')).kosong, true); // tugas belum ≤3 hari, sesi bukan hari ini
  assert.match(pesanMingguan(db, at('2026-11-22 19:00')).text, /🧪 Praktikum \*Praktikum Kimia\* — Modul 1: Titrasi · 13\.00/);
  const pr = pesanPraktikum(db, at('2026-11-24 10:00')).text;
  assert.match(pr, /\*Hari ini, 24 Nov\*/);
  assert.match(pr, /Tugas praktikum aktif/);
  assert.doesNotMatch(pesanPraktikum(db, at('2026-11-24 16:00')).text, /Titrasi/); // sesi yang sudah selesai disembunyikan
  assert.match(handle(db, '/prak', { now: at('2026-11-24 10:00') }), /Agenda praktikum/);
});

test('pengingat otomatis: sebelum sesi dan menjelang tenggat tugas praktikum', () => {
  const db = openDb(':memory:'); const { t } = isi(db);
  const s = semua(db, { praktikum: { on: true, menit: 60, tugas: [1440] } });
  const sesi = dueReminders(db, s, at('2026-11-24 12:00'));
  assert.equal(sesi.length, 1); assert.equal(sesi[0].mode, 'praktikum');
  assert.match(sesi[0].text, /Praktikum dimulai 1 jam lagi/);
  for (const r of sesi) db.tandaiTerkirim(r.key);
  assert.equal(dueReminders(db, s, at('2026-11-24 12:05')).length, 0); // tidak dobel
  const tg = dueReminders(db, s, at('2026-11-24 23:59'));
  assert.equal(tg.length, 1); assert.match(tg[0].text, new RegExp(`Pengingat tugas praktikum · H-1[\\s\\S]*/kumpul P${t}`));
  // nonaktif → tidak ada pengingat praktikum
  assert.equal(dueReminders(db, semua(db, {}), at('2026-11-24 12:00')).length, 0);
});

test('/kumpul P3 dan balasan "udah" ke pengingat tugas praktikum', () => {
  const db = openDb(':memory:'); const { t } = isi(db);
  const a = Number(db.addAkun({ username: 'budi', nama: 'Budi', role: 'viewer', hash: hashPassword('x12345678') }));
  const akun = db.akunById(a);
  assert.match(handle(db, `/kumpul P${t}`, { akun }), /ditandai sudah kamu kumpulkan/);
  assert.ok(db.prakKumpulSaya(a).has(t));
  assert.match(handle(db, `/batalkumpul p${t}`, { akun }), /belum kamu kumpulkan/);
  assert.ok(!db.prakKumpulSaya(a).has(t));
  assert.match(handle(db, '/kumpul P999', { akun }), /tidak ditemukan/);
  assert.match(handleBalasan(db, 'udah', `🧾 Pengingat\n▸ Laporan _(#P${t})_`, akun), /tugas praktikum/);
  assert.ok(db.prakKumpulSaya(a).has(t));
});

test('kalender ICS berisi sesi dan tenggat praktikum', () => {
  const db = openDb(':memory:'); isi(db);
  const ics = buildIcs(db, { now: at('2026-11-22 10:00') });
  assert.match(ics, /SUMMARY:🧪 Praktikum Kimia: Modul 1: Titrasi/);
  assert.match(ics, /SUMMARY:Tenggat Laporan Praktikum Kimia: Laporan Modul 1/);
});

test('API praktikum: CRUD, berulang, kumpul, perubahan diumumkan, hapus & kembalikan', async () => {
  const sent = [];
  const bot = { status: () => ({ wa: true, grupJid: 'g' }), send: async (x) => sent.push(x), sendTo: async () => {}, sendPoll: async () => ({ id: 'M', msg: '' }) };
  const db = openDb(':memory:');
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'up-'));
  const srv = createWeb(db, { password: 'rahasia123', cfg, bot, uploadDir, push: async () => 0 }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const req = async (p, { method = 'GET', body, token } = {}) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  try {
    const adm = (await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'rahasia123' } })).json.token;
    db.addAkun({ username: 'sari', nama: 'Sari', role: 'viewer', hash: hashPassword('sari12345') });
    const vw = (await req('/api/auth/login', { method: 'POST', body: { username: 'sari', password: 'sari12345' } })).json.token;

    assert.equal((await req('/api/praktikum', { method: 'POST', token: vw, body: { nama: 'X' } })).status, 403);
    const p = (await req('/api/praktikum', { method: 'POST', token: adm, body: { nama: 'Praktikum Fisika', lab: 'Lab Fisika', warna: 'ungu' } })).json.id;
    assert.equal((await req('/api/praktikum', { method: 'POST', token: adm, body: { nama: 'praktikum fisika' } })).status, 400); // nama kembar

    // sesi berulang tiap minggu
    const r = await req('/api/prak-sesi', { method: 'POST', token: adm, body: { praktikum_id: p, judul: 'Modul', tanggal: '2030-01-07', mulai: '13:00', selesai: '15:00', ulang: '2030-01-28' } });
    assert.equal(r.json.ids.length, 4);
    assert.equal((await req('/api/prak-sesi', { method: 'POST', token: adm, body: { praktikum_id: p, judul: 'X', tanggal: '2030-01-07', mulai: '15:00', selesai: '13:00' } })).status, 400);
    assert.equal((await req('/api/prak-sesi', { method: 'POST', token: adm, body: { praktikum_id: 999, judul: 'X', tanggal: '2030-01-07', mulai: '13:00' } })).status, 400);
    const ed = await req(`/api/prak-sesi/${r.json.ids[0]}`, { method: 'PUT', token: adm, body: { praktikum_id: p, judul: 'Modul (pertemuan 1)', tanggal: '2030-01-08', mulai: '13:00', selesai: '15:00' } });
    assert.equal(ed.json.umum, 'terkirim'); assert.match(sent.at(-1), /Jadwal praktikum berubah[\s\S]*~Senin, 7 Jan · 13\.00~/);

    // tugas praktikum + kumpul
    const t = (await req('/api/prak-tugas', { method: 'POST', token: adm, body: { praktikum_id: p, jenis: 'Pretest', judul: 'Pretest 1', deadline: '2030-01-07T12:00' } })).json.id;
    assert.equal((await req(`/api/prak-tugas/${t}/kumpul`, { method: 'POST', token: vw, body: { kumpul: true } })).status, 200);
    const d = (await req('/api/data', { token: vw })).json.prak;
    assert.equal(d.daftar[0].pakai.sesi, 4);
    assert.equal(d.sesi.length, 4); assert.equal(d.sesi[0].praktikum, 'Praktikum Fisika');
    assert.deepEqual([d.tugas[0].kumpulSaya, d.tugas[0].kumpulN, d.tugas[0].deadline], [true, 1, '2030-01-07 12:00']);
    assert.equal((await req(`/api/prak-tugas/${t}/kumpul`, { token: adm })).json.sudah[0].nama, 'Sari');
    await req(`/api/prak-tugas/${t}`, { method: 'PUT', token: adm, body: { praktikum_id: p, jenis: 'Pretest', judul: 'Pretest 1', deadline: '2030-01-08T12:00' } });
    assert.match(sent.at(-1), /Tenggat tugas praktikum diundur/);

    // praktikum yang masih dipakai tidak bisa dihapus
    assert.equal((await req(`/api/praktikum/${p}`, { method: 'DELETE', token: adm })).status, 409);
    // hapus tugas lalu kembalikan: status kumpul ikut kembali
    const del = await req(`/api/prak-tugas/${t}`, { method: 'DELETE', token: adm });
    assert.ok(del.json.sampah);
    assert.equal((await req(`/api/sampah/${del.json.sampah}/pulihkan`, { method: 'POST', token: adm })).status, 200);
    const back = (await req('/api/data', { token: vw })).json.prak.tugas[0];
    assert.equal(back.judul, 'Pretest 1'); assert.equal(back.kumpulSaya, true);

    // riwayat mencatat perubahan
    const rw = (await req('/api/riwayat', { token: adm })).json;
    assert.ok(JSON.stringify(rw).includes('sesi praktikum'));
  } finally { srv.close(); }
});
