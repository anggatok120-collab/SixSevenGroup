process.env.TZ_OFFSET = '7';
const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createWeb } = require('../src/web');
const { loadConfig } = require('../src/config');
const { handle } = require('../src/commands');
const { dueReminders } = require('../src/reminders');
const { getSettings } = require('../src/settings');
const { pesanHariIni } = require('../src/messages');
const { parseLocal } = require('../src/time');
const { hashPassword } = require('../src/auth');

const cfg = loadConfig({});
const at = (s) => parseLocal(s);
const hanya = (mode) => ({ ...getSettingsOff(), [mode]: getSettings(openDb(':memory:'), cfg)[mode] });
function getSettingsOff() {
  const s = getSettings(openDb(':memory:'), cfg);
  for (const k of Object.keys(s)) s[k] = { ...s[k], on: false };
  return s;
}

test('kelas batal dilewati, kuliah pengganti diingatkan dan muncul di ringkasan', () => {
  const db = openDb(':memory:');
  const k = db.addKelas({ hari: 1, mulai: '08:00', selesai: '09:40', matkul: 'Kalkulus', ruang: 'R.1', dosen: null }); // Senin
  db.addKelasUbah({ tanggal: '2026-11-23', jenis: 'batal', kelas_id: k, catatan: 'Dosen dinas' });
  db.addKelasUbah({ tanggal: '2026-11-23', jenis: 'pengganti', mulai: '13:00', selesai: '14:40', matkul: 'Fisika', ruang: 'Lab' });
  const s = hanya('kelas');
  assert.equal(dueReminders(db, s, at('2026-11-23 07:30')).length, 0); // batal
  const r = dueReminders(db, s, at('2026-11-23 12:30'));
  assert.equal(r.length, 1);
  assert.match(r[0].text, /Fisika\* \(kuliah pengganti\)/);
  // minggu depannya kelas rutin normal lagi
  assert.equal(dueReminders(db, s, at('2026-11-30 07:30')).length, 1);
  const pagi = pesanHariIni(db, at('2026-11-23 06:00')).text;
  assert.match(pagi, /~08:00–09:40 Kalkulus~ ❌ \*BATAL\* \(Dosen dinas\)/);
  assert.match(pagi, /Fisika\*.*kuliah pengganti/);
  assert.match(handle(db, '/hari', { now: at('2026-11-23 06:00') }), /BATAL/);
});

test('status kumpul per anggota dan pengingat pribadi', () => {
  const db = openDb(':memory:');
  const a1 = db.addAkun({ username: 'a', nama: 'Ani', role: 'viewer', hash: 'x' }); db.setAkunWa(a1, '6281111');
  const a2 = db.addAkun({ username: 'b', nama: 'Beni', role: 'viewer', hash: 'x' }); db.setAkunWa(a2, '6282222');
  db.addAkun({ username: 'c', nama: 'Cici', role: 'viewer', hash: 'x' }); // tanpa nomor
  const t = db.addTugas({ matkul: 'BD', judul: 'ERD', deadline: at('2026-11-25 23:59') });
  assert.match(handle(db, `/kumpul ${t}`, { akun: db.akunById(a1) }), /sudah kamu kumpulkan/);
  assert.match(handle(db, `/kumpul ${t}`, {}), /belum terhubung/);
  assert.deepEqual(db.kumpulCount(), { [t]: 1 });

  const s = { ...hanya('pribadi'), pribadi: { on: true, menit: [1440], ujian: true } };
  const r = dueReminders(db, s, at('2026-11-24 23:59'));
  assert.deepEqual(r.map((x) => x.to), ['6282222@s.whatsapp.net']); // Ani sudah kumpul
  assert.match(r[0].text, /Halo Beni/);
  db.delTugas(t);
  assert.deepEqual(db.kumpulCount(), {});
});

test('pengumuman terjadwal ikut dikirim penjadwal', () => {
  const db = openDb(':memory:');
  const id = db.addPengumuman({ teks: 'Kumpul di aula', kirim_at: at('2026-11-23 10:00'), oleh: 'Admin' });
  const s = getSettingsOff();
  assert.equal(dueReminders(db, s, at('2026-11-23 09:59')).length, 0);
  const r = dueReminders(db, s, at('2026-11-23 10:01'));
  assert.equal(r[0].pengumumanId, id);
  assert.match(r[0].text, /Pengumuman\*\n\nKumpul di aula\n\n_— Admin_/);
  assert.equal(dueReminders(db, s, at('2026-11-23 17:00')).length, 0); // telat > 6 jam
});

test('API fitur baru: kumpul, kelas batal, pengumuman, riwayat, kalender, warna', async () => {
  const sent = [];
  const bot = { status: () => ({ wa: true, grupJid: 'g@g.us' }), send: async (t) => { sent.push(t); } };
  const db = openDb(':memory:');
  const srv = createWeb(db, { password: 'rahasia123', cfg, bot }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const req = async (p, { method = 'GET', body, token } = {}) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  };
  try {
    const adm = (await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'rahasia123' } })).json.token;
    db.addAkun({ username: 'sari', nama: 'Sari', role: 'viewer', hash: hashPassword('password-sari') });
    const vw = (await req('/api/auth/login', { method: 'POST', body: { username: 'sari', password: 'password-sari' } })).json.token;

    // warna mata kuliah
    const mk = await req('/api/matkul', { method: 'POST', token: adm, body: { nama: 'Kalkulus', warna: 'ungu' } });
    assert.equal((await req('/api/data', { token: adm })).json.matkul[0].warna, 'ungu');
    await req(`/api/matkul/${mk.json.id}`, { method: 'PUT', token: adm, body: { nama: 'Kalkulus', warna: 'bukan-warna' } });
    assert.equal((await req('/api/data', { token: adm })).json.matkul[0].warna, null);

    // kumpul: anggota boleh menandai dirinya sendiri
    const t = await req('/api/tugas', { method: 'POST', token: adm, body: { matkul: 'Kalkulus', judul: 'PR 1', deadline: '2030-01-01T10:00' } });
    assert.equal((await req(`/api/tugas/${t.json.id}/kumpul`, { method: 'POST', token: vw, body: { kumpul: true } })).status, 200);
    const d = (await req('/api/data', { token: vw })).json;
    assert.deepEqual([d.tugas[0].kumpulN, d.tugas[0].kumpulSaya, d.anggota], [1, true, 2]);
    assert.equal((await req('/api/data', { token: adm })).json.tugas[0].kumpulSaya, false);
    const kp = (await req(`/api/tugas/${t.json.id}/kumpul`, { token: adm })).json;
    assert.deepEqual([kp.sudah.map((x) => x.nama), kp.belum], [['Sari'], ['Admin']]);

    // kelas batal & pengganti
    const k = await req('/api/kelas', { method: 'POST', token: adm, body: { hari: 1, mulai: '08:00', matkul: 'Kalkulus' } });
    assert.equal((await req('/api/kelas-ubah', { method: 'POST', token: vw, body: {} })).status, 403);
    assert.equal((await req('/api/kelas-ubah', { method: 'POST', token: adm, body: { jenis: 'batal', tanggal: '2030-01-02', kelas_id: k.json.id } })).status, 400); // Rabu
    const kb = await req('/api/kelas-ubah', { method: 'POST', token: adm, body: { jenis: 'batal', tanggal: '2030-01-07', kelas_id: k.json.id, catatan: 'Libur', umumkan: true } });
    assert.equal(kb.json.umum, 'terkirim');
    assert.match(sent.at(-1), /Kelas batal\*\n\*Kalkulus\* Senin, 7 Jan, jam 08:00\nKeterangan: Libur/);
    assert.equal((await req('/api/kelas-ubah', { method: 'POST', token: adm, body: { jenis: 'batal', tanggal: '2030-01-07', kelas_id: k.json.id } })).status, 400);
    assert.equal((await req('/api/kelas-ubah', { method: 'POST', token: adm, body: { jenis: 'pengganti', tanggal: '2030-01-08', mulai: '10:00', selesai: '09:00', matkul: 'Kalkulus' } })).status, 400);
    assert.equal((await req('/api/kelas-ubah', { method: 'POST', token: adm, body: { jenis: 'pengganti', tanggal: '2030-01-08', mulai: '10:00', matkul: 'Kalkulus' } })).status, 200);
    assert.equal((await req('/api/data', { token: vw })).json.kelasUbah.length, 2);

    // pengumuman langsung & terjadwal
    assert.equal((await req('/api/pengumuman', { method: 'POST', token: vw, body: { teks: 'x' } })).status, 403);
    assert.equal((await req('/api/pengumuman', { method: 'POST', token: adm, body: { teks: 'Halo kelas' } })).json.status, 'terkirim');
    assert.match(sent.at(-1), /Halo kelas/);
    assert.equal((await req('/api/pengumuman', { method: 'POST', token: adm, body: { teks: 'Nanti', kirim_at: '2030-01-01T08:00' } })).json.status, 'terjadwal');
    assert.equal((await req('/api/pengumuman', { method: 'POST', token: adm, body: { teks: 'Lalu', kirim_at: '2020-01-01T08:00' } })).status, 400);
    assert.deepEqual((await req('/api/pengumuman', { token: adm })).json.pengumuman.map((p) => p.status), ['terjadwal', 'terkirim']);

    // riwayat
    const rw = (await req('/api/riwayat', { token: adm })).json.riwayat;
    assert.ok(rw.some((r) => r.jenis === 'kelas batal' && r.oleh === 'Admin'));
    assert.ok(rw.some((r) => r.aksi === 'tambah' && r.jenis === 'tugas' && r.ringkas === 'Kalkulus: PR 1'));
    assert.equal((await req('/api/riwayat', { token: vw })).status, 403);

    // kalender
    const kal = (await req('/api/kalender', { token: vw })).json.path;
    const ics = await req(kal);
    assert.equal(ics.status, 200);
    assert.match(ics.text, /BEGIN:VCALENDAR/);
    assert.match(ics.text, /RRULE:FREQ=WEEKLY/);
    assert.match(ics.text, /EXDATE:20300107T010000Z/);
    assert.match(ics.text, /SUMMARY:Kalkulus \(pengganti\)/);
    assert.equal((await req('/kalender/salah-token-1234.ics')).status, 404);
    assert.equal((await req('/api/kalender/reset', { method: 'POST', token: vw })).status, 403);
    const baru = (await req('/api/kalender/reset', { method: 'POST', token: adm })).json.path;
    assert.notEqual(baru, kal);
    assert.equal((await req(kal)).status, 404);
  } finally { srv.close(); }
});
