process.env.TZ_OFFSET = '7';
const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createWeb } = require('../src/web');

test('web API: login, CRUD, public view', async () => {
  const db = openDb(':memory:');
  const app = createWeb(db, { password: 'rahasia123', publicView: true });
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const req = async (p, opts = {}, ck) => {
    const r = await fetch(base + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', ...(ck ? { cookie: ck } : {}) }, body: opts.body && JSON.stringify(opts.body) });
    return { status: r.status, json: await r.json().catch(() => null), cookie: r.headers.get('set-cookie') };
  };
  try {
    assert.equal((await req('/api/kelas', { method: 'POST', body: { hari: 1, mulai: '08:00', matkul: 'X' } })).status, 401);
    assert.equal((await req('/api/login', { method: 'POST', body: { password: 'salah' } })).status, 401);
    const login = await req('/api/login', { method: 'POST', body: { password: 'rahasia123' } });
    assert.equal(login.status, 200);
    const ck = login.cookie.split(';')[0];
    assert.equal((await req('/api/me', {}, ck)).json.admin, true);
    assert.equal((await req('/api/kelas', { method: 'POST', body: { hari: 1, mulai: '25:00', matkul: 'X' } }, ck)).status, 400);
    const k = await req('/api/kelas', { method: 'POST', body: { hari: 1, mulai: '08:00', selesai: '09:40', matkul: 'Kalkulus', ruang: 'R.1' } }, ck);
    assert.equal(k.status, 200);
    const t = await req('/api/tugas', { method: 'POST', body: { matkul: 'BD', judul: 'ERD', deadline: '2026-11-28T23:59' } }, ck);
    assert.equal(t.status, 200);
    assert.equal((await req(`/api/tugas/${t.json.id}`, { method: 'PUT', body: { matkul: 'BD', judul: 'ERD v2', deadline: '2026-11-28T23:59', selesai: true } }, ck)).status, 200);
    const u = await req('/api/ujian', { method: 'POST', body: { matkul: 'Kalkulus', jenis: 'UTS', waktu: '2026-12-02T08:00' } }, ck);
    assert.equal(u.status, 200);
    const data = (await req('/api/data')).json; // public view, tanpa login
    assert.equal(data.kelas[0].matkul, 'Kalkulus');
    assert.deepEqual([data.tugas[0].judul, data.tugas[0].deadline, data.tugas[0].selesai], ['ERD v2', '2026-11-28 23:59', true]);
    assert.equal(data.ujian[0].waktu, '2026-12-02 08:00');
    assert.equal((await req(`/api/ujian/${u.json.id}`, { method: 'DELETE' }, ck)).status, 200);
    assert.equal((await req('/api/ujian/999', { method: 'DELETE' }, ck)).status, 404);
  } finally { srv.close(); }
});
