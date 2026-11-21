process.env.TZ_OFFSET = '7';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDb } = require('../src/db');
const { createWeb } = require('../src/web');
const { loadConfig } = require('../src/config');
const { hashPassword } = require('../src/auth');

test('database lama: daftar mata kuliah terisi dari data yang ada', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mk-')), 'lama.db');
  const raw = new Database(file);
  raw.exec(`CREATE TABLE kelas (id INTEGER PRIMARY KEY AUTOINCREMENT, hari INTEGER NOT NULL, mulai TEXT NOT NULL, selesai TEXT, matkul TEXT NOT NULL, ruang TEXT, dosen TEXT);
    CREATE TABLE tugas (id INTEGER PRIMARY KEY AUTOINCREMENT, matkul TEXT NOT NULL, judul TEXT NOT NULL, deadline INTEGER NOT NULL, selesai INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE ujian (id INTEGER PRIMARY KEY AUTOINCREMENT, matkul TEXT NOT NULL, jenis TEXT NOT NULL, waktu INTEGER NOT NULL, ruang TEXT);
    INSERT INTO kelas (hari, mulai, matkul, dosen) VALUES (1, '08:00', 'Kalkulus I', 'Pak Budi');
    INSERT INTO tugas (matkul, judul, deadline) VALUES ('Kimia Dasar', 'Laporan', 1);
    INSERT INTO ujian (matkul, jenis, waktu) VALUES ('kalkulus i', 'UTS', 1);`);
  raw.close();
  const db = openDb(file);
  const mk = db.matkulAll();
  assert.deepEqual(mk.map((m) => m.nama), ['Kalkulus I', 'Kimia Dasar']);
  assert.equal(mk[0].dosen, 'Pak Budi');
  assert.deepEqual(mk[0].pakai, { jadwal: 1, tugas: 0, ujian: 1 });
  db.raw.close();
  // buka lagi: tidak menggandakan
  assert.equal(openDb(file).matkulAll().length, 2);
});

test('API mata kuliah: tambah, ganti nama ikut jadwal, hapus, dan peran', async () => {
  const db = openDb(':memory:');
  const app = createWeb(db, { password: 'rahasia123', cfg: loadConfig({}), backupDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bk-')) });
  db.addAkun({ username: 'sari', nama: 'Sari', role: 'viewer', hash: hashPassword('password-sari') });
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const req = async (p, { method = 'GET', body, token } = {}) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const login = async (u, p) => (await req('/api/auth/login', { method: 'POST', body: { username: u, password: p } })).json.token;
  try {
    const adm = await login('admin', 'rahasia123'); const vw = await login('sari', 'password-sari');
    assert.equal((await req('/api/matkul', { method: 'POST', token: vw, body: { nama: 'X' } })).status, 403);
    assert.equal((await req('/api/matkul', { method: 'POST', token: adm, body: { nama: '' } })).status, 400);
    assert.equal((await req('/api/matkul', { method: 'POST', token: adm, body: { nama: 'Ekologi', sks: 'abc' } })).status, 400);
    const mk = await req('/api/matkul', { method: 'POST', token: adm, body: { nama: 'Ekologi Perairan', kode: 'PI201', sks: '3', dosen: 'Dr. Sari' } });
    assert.equal(mk.status, 200);
    assert.equal((await req('/api/matkul', { method: 'POST', token: adm, body: { nama: 'ekologi perairan' } })).status, 400);
    // jadwal dengan penulisan beda huruf memakai nama yang terdaftar
    assert.equal((await req('/api/kelas', { method: 'POST', token: adm, body: { hari: 2, mulai: '08:00', matkul: 'EKOLOGI PERAIRAN' } })).status, 200);
    // nama baru dari form tugas otomatis terdaftar
    assert.equal((await req('/api/tugas', { method: 'POST', token: adm, body: { matkul: 'Statistika', judul: 'PR 1', deadline: '2026-12-01T10:00' } })).status, 200);
    let data = (await req('/api/data', { token: vw })).json;
    assert.deepEqual(data.matkul.map((m) => m.nama), ['Ekologi Perairan', 'Statistika']);
    assert.equal(data.kelas[0].matkul, 'Ekologi Perairan');
    // ganti nama
    assert.equal((await req(`/api/matkul/${mk.json.id}`, { method: 'PUT', token: adm, body: { nama: 'Ekologi Perairan Lanjut', sks: 3 } })).status, 200);
    data = (await req('/api/data', { token: adm })).json;
    assert.equal(data.kelas[0].matkul, 'Ekologi Perairan Lanjut');
    // masih dipakai: tidak bisa dihapus
    const del = await req(`/api/matkul/${mk.json.id}`, { method: 'DELETE', token: adm });
    assert.equal(del.status, 409); assert.match(del.json.error, /1 jadwal/);
    await req(`/api/kelas/${data.kelas[0].id}`, { method: 'DELETE', token: adm });
    assert.equal((await req(`/api/matkul/${mk.json.id}`, { method: 'DELETE', token: adm })).status, 200);
  } finally { srv.close(); }
});
