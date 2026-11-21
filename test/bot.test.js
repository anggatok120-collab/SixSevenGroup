process.env.TZ_OFFSET = '7';
const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { loadConfig } = require('../src/config');
const { handle } = require('../src/commands');
const { dueReminders } = require('../src/reminders');
const { getSettings } = require('../src/settings');
const { parseLocal, parseUserDate, fmtLocal } = require('../src/time');

const cfg = loadConfig({});
// Sabtu 21 Nov 2026
const at = (s) => parseLocal(s);

test('parse tanggal input user', () => {
  const now = at('2026-11-21 10:00');
  assert.equal(fmtLocal(parseUserDate('28-11 23:59', now)), '2026-11-28 23:59');
  assert.equal(fmtLocal(parseUserDate('28/11', now)), '2026-11-28 23:59');
  assert.equal(fmtLocal(parseUserDate('05-01 08:00', now)), '2027-01-05 08:00');
  assert.equal(fmtLocal(parseUserDate('2026-12-02 08.00', now)), '2026-12-02 08:00');
  assert.ok(Number.isNaN(parseUserDate('besok', now)));
});

test('perintah admin dan non-admin', () => {
  const db = openDb(':memory:');
  const now = at('2026-11-21 10:00');
  assert.match(handle(db, '/tambahkelas Senin | 08:00-09:40 | Kalkulus | R.301', { now }), /khusus admin/);
  assert.match(handle(db, '/tambahkelas Senin | 08:00-09:40 | Kalkulus | R.301', { isAdmin: true, now }), /Kelas ditambahkan/);
  assert.match(handle(db, '/importjadwal\nSelasa | 10:00-11:40 | Basis Data | Lab 2\nRabuu | 10:00 | X', { isAdmin: true, now }), /1 kelas ditambahkan[\s\S]*Gagal/);
  assert.match(handle(db, '/jadwal', { now }), /Senin[\s\S]*Kalkulus[\s\S]*Selasa[\s\S]*Basis Data/);
  assert.match(handle(db, '/tambahtugas Basis Data | ERD | 28-11 23:59', { isAdmin: true, now }), /Sabtu, 28 Nov 23:59/);
  assert.match(handle(db, '/tugas', { now }), /ERD[\s\S]*7 hari lagi/);
  assert.match(handle(db, '/selesai 1', { isAdmin: true, now }), /selesai/);
  assert.match(handle(db, '/tugas', { now }), /Tidak ada tugas/);
  assert.equal(handle(db, 'halo', { now }), null);
  assert.match(handle(db, '!hari', { now }), /Sabtu/);
  assert.match(handle(db, '.web', { now, webUrl: 'https://x.id' }), /https:\/\/x\.id/);
});

test('pengingat kelas, harian, tugas, ujian', () => {
  const db = openDb(':memory:');
  db.addKelas({ hari: 1, mulai: '08:00', selesai: '09:40', matkul: 'Kalkulus', ruang: 'R.301', dosen: null }); // Senin
  db.addTugas({ matkul: 'BD', judul: 'ERD', deadline: at('2026-11-26 23:59') });
  db.addUjian({ matkul: 'Kalkulus', jenis: 'UTS', waktu: at('2026-11-30 10:00'), ruang: 'R.1' });

  const st = getSettings(db, cfg);
  const send = (s) => { const r = dueReminders(db, st, at(s)); r.forEach((x) => db.tandaiTerkirim(x.key)); return r; };

  // Senin 23 Nov 07:30 -> pengingat kelas (30 menit sebelum)
  let r = send('2026-11-23 07:30');
  assert.equal(r.length, 1); assert.match(r[0].text, /Kalkulus\* mulai jam 08:00/);
  assert.equal(send('2026-11-23 07:31').length, 0, 'tidak dobel');

  // Ujian H-7: Senin 23 Nov 10:00
  r = send('2026-11-23 10:00');
  assert.ok(r.some((x) => /Pengingat ujian \(H-7\)/.test(x.text)));

  // Tugas H-3: 23 Nov 23:59
  r = send('2026-11-23 23:59');
  assert.ok(r.some((x) => /Pengingat tugas \(H-3\)/.test(x.text)));
  // Tugas 3 jam
  r = send('2026-11-26 20:59');
  assert.ok(r.some((x) => /3 jam lagi/.test(x.text)));

  // Ringkasan pagi Senin 30 Nov 06:00 + pagi hari-H ujian
  r = send('2026-11-30 06:00');
  assert.ok(r.some((x) => /Selamat pagi[\s\S]*Kalkulus/.test(x.text)));
  assert.ok(r.some((x) => /Hari ini ujian/.test(x.text)));

  // Pesan lama tidak dikirim setelah lewat jendela 10 menit
  assert.equal(dueReminders(db, st, at('2026-12-07 07:45')).filter((x) => x.key.startsWith('kelas')).length, 0);
});

test('pengaturan: mode nonaktif tidak dikirim, H-1 jadwal besok', () => {
  const db = openDb(':memory:');
  db.addKelas({ hari: 1, mulai: '08:00', selesai: null, matkul: 'Kalkulus', ruang: null, dosen: null }); // Senin
  db.setSetting('pengingat', { kelas: { on: false } });
  const st = getSettings(db, cfg);
  assert.equal(st.kelas.on, false); assert.equal(st.kelas.menit, 30);
  assert.equal(dueReminders(db, st, at('2026-11-23 07:30')).length, 0);
  // Minggu 22 Nov 18:00 -> persiapan besok (Senin ada kelas)
  const r = dueReminders(db, st, at('2026-11-22 18:00'));
  assert.equal(r.length, 1); assert.match(r[0].text, /Persiapan besok[\s\S]*Senin[\s\S]*Kalkulus/);
  // Sabtu 18:00 -> besok Minggu kosong, tidak dikirim
  assert.equal(dueReminders(db, st, at('2026-11-21 18:00')).length, 0);
  // Pagi di hari tanpa apa-apa dilewati
  assert.equal(dueReminders(db, st, at('2026-11-24 06:00')).length, 0);
});
