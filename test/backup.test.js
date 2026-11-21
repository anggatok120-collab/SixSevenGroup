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
const { backupNow, backupDue, listBackups } = require('../src/backup');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
const at = (s) => Date.parse(s); // ISO UTC

test('backup dibuat, bisa dibuka, dan dirotasi', async () => {
  const dir = tmp(); const db = openDb(':memory:');
  db.addKelas({ hari: 1, mulai: '08:00', selesai: '09:40', matkul: 'Kalkulus I', ruang: null, dosen: null });
  for (let i = 0; i < 4; i++) await backupNow(db, { dir, keep: 3, now: at('2026-11-20T00:00:00Z') + i * 86400000 });
  const list = listBackups(dir);
  assert.equal(list.length, 3);
  assert.equal(list[0].name, 'kuliah-2026-11-23_0700.db');
  const copy = new Database(path.join(dir, list[0].name), { readonly: true });
  assert.equal(copy.prepare('SELECT matkul FROM kelas').get().matkul, 'Kalkulus I');
  copy.close();
  assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith('.tmp')));
});

test('jadwal backup harian', () => {
  // 01:59 WIB belum waktunya, 02:00 WIB waktunya, setelah ada backup hari ini tidak lagi
  assert.equal(backupDue([], '02:00', at('2026-11-21T18:59:00Z')), false);
  assert.equal(backupDue([], '02:00', at('2026-11-21T19:00:00Z')), true);
  assert.equal(backupDue([{ name: 'kuliah-2026-11-22_0200.db' }], '02:00', at('2026-11-21T20:00:00Z')), false);
  assert.equal(backupDue([{ name: 'kuliah-2026-11-21_0200.db' }], '02:00', at('2026-11-21T20:00:00Z')), true);
});

test('API backup hanya untuk admin', async () => {
  const dir = tmp(); const db = openDb(':memory:');
  const app = createWeb(db, { password: 'rahasia123', cfg: loadConfig({}), backupDir: dir });
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const req = (p, { method = 'GET', token } = {}) => fetch(base + p, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  try {
    const adm = (await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'rahasia123' }) })).json()).token;
    assert.equal((await req('/api/backup')).status, 401);
    assert.equal((await (await req('/api/backup', { token: adm })).json()).daftar.length, 0);
    const made = await (await req('/api/backup', { method: 'POST', token: adm })).json();
    assert.equal(made.daftar.length, 1);
    const dl = await req(`/api/backup/${made.daftar[0].name}`, { token: adm });
    assert.equal(dl.status, 200);
    assert.equal(Buffer.from(await dl.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');
    assert.equal((await req('/api/backup/..%2F..%2Fkuliah.db', { token: adm })).status, 404);
    assert.equal((await req('/api/backup/kuliah-2020-01-01_0000.db', { token: adm })).status, 404);
  } finally { srv.close(); }
});
