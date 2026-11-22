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
const { dueReminders, antrean } = require('../src/reminders');
const { getSettings } = require('../src/settings');
const { pesanMingguan, pesanHariIni } = require('../src/messages');
const { kelasPada } = require('../src/jadwal');
const { parseLocal } = require('../src/time');
const { hashPassword } = require('../src/auth');

const cfg = loadConfig({});
const at = (s) => parseLocal(s);
const semua = (db, ubah) => { const s = getSettings(db, cfg); for (const k of Object.keys(s)) if ('on' in s[k]) s[k] = { ...s[k], on: false }; return { ...s, ...ubah }; };

test('semester & libur: kelas tidak jalan di luar semester dan saat libur', () => {
  const db = openDb(':memory:');
  db.addKelas({ hari: 1, mulai: '08:00', selesai: null, matkul: 'Kalkulus', ruang: null, dosen: null }); // Senin
  db.setSetting('semester', { mulai: '2026-09-01', selesai: '2027-01-15', nasional: true, libur: [{ dari: '2026-11-30', sampai: '2026-12-01', nama: 'Libur dies natalis' }] });
  assert.equal(kelasPada(db, at('2026-08-31 10:00')).length, 0); // sebelum semester
  assert.equal(kelasPada(db, at('2027-01-18 10:00')).length, 0); // sesudah semester
  const k = kelasPada(db, at('2026-11-30 10:00'));
  assert.deepEqual([k[0].batal, k[0].libur], [true, 'Libur dies natalis']);
  assert.equal(kelasPada(db, at('2026-11-23 10:00'))[0].batal, false);
  // libur nasional tetap: 17 Agustus 2026 hari Senin, tapi di luar semester; cek 1 Juni 2026 (Senin) dengan semester lain
  db.setSetting('semester', { mulai: null, selesai: null, nasional: true, libur: [] });
  assert.equal(kelasPada(db, at('2026-06-01 10:00'))[0].libur, 'Hari Lahir Pancasila');
  const s = semua(db, { kelas: { on: true, menit: 30 } });
  assert.equal(dueReminders(db, s, at('2026-06-01 07:30')).length, 0);
  assert.equal(dueReminders(db, s, at('2026-06-08 07:30')).length, 1);
  assert.match(pesanHariIni(db, at('2026-06-01 06:00')).text, /Hari ini libur: \*Hari Lahir Pancasila\*/);
});

test('jam tenang menunda pengingat dan mode libur menghentikannya', () => {
  const db = openDb(':memory:');
  db.addTugas({ matkul: 'BD', judul: 'ERD', deadline: at('2026-11-25 02:00') }); // H-1 jatuh jam 02:00
  const s = semua(db, { tugas: { on: true, menit: [1440] }, tenang: { on: true, dari: '22:00', sampai: '06:00' } });
  assert.equal(dueReminders(db, s, at('2026-11-24 02:00')).length, 0); // di jam tenang
  assert.equal(dueReminders(db, s, at('2026-11-24 06:01')).length, 1); // dikirim saat jam tenang selesai
  const s2 = { ...s, tenang: { on: false }, jeda: { sampai: '2026-11-30' } };
  assert.equal(dueReminders(db, s2, at('2026-11-24 02:00')).length, 0);
  // pengumuman terjadwal tetap jalan saat mode libur
  db.addPengumuman({ teks: 'Tetap terkirim', kirim_at: at('2026-11-24 02:00'), oleh: 'A' });
  assert.equal(dueReminders(db, s2, at('2026-11-24 02:01'))[0].mode, 'pengumuman');
});

test('rekap mingguan tiap Minggu dan antrean', () => {
  const db = openDb(':memory:');
  db.addKelas({ hari: 2, mulai: '08:00', selesai: null, matkul: 'Kalkulus', ruang: null, dosen: null });
  db.addTugas({ matkul: 'BD', judul: 'ERD', deadline: at('2026-11-26 23:59') });
  db.addUjian({ matkul: 'Fisika', jenis: 'UTS', waktu: at('2026-11-27 08:00'), ruang: null, bawa: 'Kalkulator' });
  const m = pesanMingguan(db, at('2026-11-22 19:00')).text;
  assert.match(m, /\*Selasa, 24 Nov\*\n▸ 📚 1 kelas: Kalkulus \(08\.00\)/);
  assert.match(m, /📝 Tenggat \*BD\* — ERD · 23\.59/);
  assert.match(m, /📖 \*UTS Fisika\* · 08\.00/);
  const s = semua(db, { mingguan: { on: true, jam: '19:00' } });
  assert.equal(dueReminders(db, s, at('2026-11-22 19:00'))[0].mode, 'mingguan');
  assert.equal(dueReminders(db, s, at('2026-11-23 19:00')).length, 0); // bukan Minggu
  const q = antrean(db, getSettings(db, cfg), at('2026-11-23 20:00'), 24);
  assert.ok(q.some((x) => x.mode === 'kelas'));
});

test('perintah WA baru dan balasan "udah"', () => {
  const db = openDb(':memory:');
  const mk = db.addMatkul({ nama: 'Basis Data', dosen: 'Bu Sari' });
  db.addMateri({ matkul_id: mk, judul: 'Slide 1', url: 'https://x.y/1' });
  const t = db.addTugas({ matkul: 'Basis Data', judul: 'Laporan ERD', deadline: at('2026-11-26 23:59'), link: 'https://lms/1' });
  const now = at('2026-11-22 10:00');
  assert.match(handle(db, '/cari erd', { now }), /Laporan ERD/);
  assert.match(handle(db, '/matkul basis', { now }), /Basis Data\*\n👤 Bu Sari[\s\S]*Slide 1/);
  assert.match(handle(db, '/materi bd', { now }), /Slide 1\n  https:\/\/x\.y\/1/);
  assert.match(handle(db, '/minggu', { now }), /Agenda minggu depan/);
  const a = db.addAkun({ username: 'ani', nama: 'Ani', role: 'viewer', hash: 'x' });
  assert.equal(handleBalasan(db, 'oke', `Kalau sudah dikumpulkan: /selesai ${t}`, db.akunById(a)), null);
  assert.match(handleBalasan(db, 'udah', `📝 Pengingat\n• [${t}] Basis Data\nSudah kumpul? Balas /kumpul ${t}`, db.akunById(a)), /sudah kamu kumpulkan/);
  assert.ok(db.sudahKumpul(t, a));
});

test('API: berulang, tenggat diundur, sampah, kelompok, nilai, absen, akun massal, undangan', async () => {
  const sent = []; const dm = [];
  const bot = { status: () => ({ wa: true, grupJid: 'g' }), send: async (t) => sent.push(t), sendTo: async (n, t) => dm.push([n, t]), sendPoll: async () => ({ id: 'MSG1', msg: '' }) };
  const db = openDb(':memory:');
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'up-'));
  const srv = createWeb(db, { password: 'rahasia123', cfg, bot, uploadDir, push: async () => 0 }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const req = async (p, { method = 'GET', body, token } = {}) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const login = async (u, p) => (await req('/api/auth/login', { method: 'POST', body: { username: u, password: p } }));
  try {
    const adm = (await login('admin', 'rahasia123')).json.token;
    // tugas berulang
    const r1 = await req('/api/tugas', { method: 'POST', token: adm, body: { matkul: 'Fisika', judul: 'Laporan praktikum', deadline: '2030-01-07T23:59', ulang: '2030-01-28', link: 'https://lms/x' } });
    assert.equal(r1.json.ids.length, 4);
    assert.equal((await req('/api/tugas', { method: 'POST', token: adm, body: { matkul: 'F', judul: 'x', deadline: '2030-01-07T23:59', link: 'ftp://salah' } })).status, 400);
    // tenggat diundur → grup diberi tahu
    const t1 = r1.json.ids[0];
    const ed = await req(`/api/tugas/${t1}`, { method: 'PUT', token: adm, body: { matkul: 'Fisika', judul: 'Laporan praktikum (1)', deadline: '2030-01-09T23:59' } });
    assert.equal(ed.json.umum, 'terkirim');
    assert.match(sent.at(-1), /Tenggat tugas diundur/);
    await req(`/api/tugas/${t1}`, { method: 'PUT', token: adm, body: { matkul: 'Fisika', judul: 'Laporan praktikum (1)', deadline: '2030-01-10T23:59', umumkan: false } });
    assert.match(sent.at(-1), /diundur/); assert.equal(sent.length, 1);
    // hapus lalu kembalikan (status kumpul ikut kembali)
    db.setKumpul(t1, 1, true);
    const del = await req(`/api/tugas/${t1}`, { method: 'DELETE', token: adm });
    assert.ok(del.json.sampah);
    const rw = (await req('/api/riwayat', { token: adm })).json.riwayat.find((x) => x.aksi === 'hapus');
    assert.equal(rw.bisa_pulih, 1);
    const pul = await req(`/api/sampah/${del.json.sampah}/pulihkan`, { method: 'POST', token: adm });
    assert.equal(pul.json.id, t1);
    assert.ok(db.sudahKumpul(t1, 1));
    assert.equal((await req(`/api/sampah/${del.json.sampah}/pulihkan`, { method: 'POST', token: adm })).status, 404);
    // akun massal + sambutan WA
    const m = await req('/api/akun/massal', { method: 'POST', token: adm, body: { teks: 'Siti Rahma, 0812-1111-2222\nBudi\nCacat, 123\nSiti Rahma', sambutan: true } });
    assert.deepEqual(m.json.dibuat.map((x) => x.username), ['siti.rahma', 'budi', 'siti.rahma2']);
    assert.equal(m.json.gagal.length, 1);
    assert.equal(dm[0][0], '6281211112222');
    // kelompok: kumpul satu anggota = satu kelompok
    const [siti, budi] = m.json.dibuat.map((x) => x.id);
    await req(`/api/tugas/${t1}/kelompok`, { method: 'PUT', token: adm, body: { grup: [{ nama: 'K1', anggota: [1, siti] }, { nama: 'K2', anggota: [budi] }] } });
    let d = (await req('/api/data', { token: adm })).json.tugas.find((x) => x.id === t1);
    assert.deepEqual([d.kelompok, d.kumpulN, d.kumpulTotal, d.kumpulSaya, d.grupSaya], [true, 1, 2, true, 'K1']);
    const kp = (await req(`/api/tugas/${t1}/kumpul`, { token: adm })).json.grup;
    assert.deepEqual(kp.map((g) => g.sudah), [true, false]);
    // nilai, centang, absen, materi, semester
    const mk = (await req('/api/matkul', { method: 'POST', token: adm, body: { nama: 'Kalkulus', bobot: 'Tugas: 30\nUTS: 30\nUAS: 40', maks_bolos: 3 } })).json.id;
    assert.equal((await req('/api/matkul', { method: 'POST', token: adm, body: { nama: 'X', bobot: 'UTS: 50' } })).status, 400);
    assert.equal((await req(`/api/nilai/${mk}`, { method: 'PUT', token: adm, body: { nilai: { Tugas: 90, UTS: 101 } } })).status, 400);
    await req(`/api/nilai/${mk}`, { method: 'PUT', token: adm, body: { nilai: { Tugas: 90, UTS: 75 } } });
    await req('/api/centang', { method: 'POST', token: adm, body: { jenis: 'tugas', ref_id: t1, idx: 0, v: true } });
    await req('/api/absen', { method: 'POST', token: adm, body: { tanggal: '2026-01-05', kelas_key: '1', v: true } });
    assert.equal((await req('/api/absen', { method: 'POST', token: adm, body: { tanggal: '2099-01-05', kelas_key: '1', v: true } })).status, 400);
    await req('/api/materi', { method: 'POST', token: adm, body: { matkul_id: mk, judul: 'Modul 1', url: 'https://drive/1' } });
    assert.equal((await req('/api/semester', { method: 'PUT', token: adm, body: { mulai: '2026-09-01', selesai: '2026-08-01' } })).status, 400);
    await req('/api/semester', { method: 'PUT', token: adm, body: { mulai: '2026-09-01', selesai: '2027-01-15', libur: [{ dari: '2026-12-24', sampai: '2026-12-26', nama: 'Natal' }] } });
    d = (await req('/api/data', { token: adm })).json;
    assert.deepEqual(d.saya.nilai[mk], { Tugas: 90, UTS: 75 });
    assert.deepEqual(d.saya.centang[`tugas:${t1}`], [0]);
    assert.deepEqual(d.saya.absen, ['2026-01-05|1']);
    assert.equal(d.matkul.find((x) => x.id === mk).bobot.length, 3);
    assert.equal(d.materi[0].judul, 'Modul 1');
    assert.equal(d.semester.libur[0].nama, 'Natal');
    // undangan → daftar → menunggu → disetujui
    const kode = (await req('/api/undangan', { method: 'POST', token: adm, body: {} })).json.undangan.kode;
    assert.equal((await req('/api/daftar', { method: 'POST', body: { kode: 'salah', nama: 'A', username: 'aaa', password: 'password1' } })).status, 403);
    assert.equal((await req('/api/daftar', { method: 'POST', body: { kode, nama: 'Dewi', username: 'dewi', password: 'password1' } })).status, 200);
    assert.equal((await login('dewi', 'password1')).status, 403);
    const dewi = db.akunByUsername('dewi').id;
    await req(`/api/akun/${dewi}/setujui`, { method: 'POST', token: adm });
    assert.equal((await login('dewi', 'password1')).status, 200);
    // pengumuman khusus web + pin, polling
    const pg = await req('/api/pengumuman', { method: 'POST', token: adm, body: { teks: 'Bawa jas lab', web_saja: true } });
    assert.equal(pg.json.status, 'web');
    assert.equal((await req('/api/data', { token: adm })).json.pin[0].teks, 'Bawa jas lab');
    const pl = await req('/api/polling', { method: 'POST', token: adm, body: { pertanyaan: 'Kapan?', opsi: ['Kamis', 'Jumat', 'Kamis'] } });
    assert.equal(pl.json.status, 'terkirim');
    assert.deepEqual((await req('/api/polling', { token: adm })).json.polling[0].opsi, ['Kamis', 'Jumat']);
    // upload gambar
    const png = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71]).toString('base64');
    const up = await req('/api/upload', { method: 'POST', token: adm, body: { data: png } });
    assert.match(up.json.path, /^\/uploads\/[a-f0-9]{32}\.png$/);
    assert.equal((await fetch(base + up.json.path)).status, 200);
    // status: antrean & grafik
    const st = (await req('/api/status', { token: adm })).json;
    assert.ok(Array.isArray(st.antrean) && Array.isArray(st.harian));
  } finally { srv.close(); }
});
