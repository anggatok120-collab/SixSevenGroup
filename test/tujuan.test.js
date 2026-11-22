process.env.TZ_OFFSET = '7';
const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createWeb } = require('../src/web');
const { loadConfig } = require('../src/config');
const { handle } = require('../src/commands');

test('/kirimkesini dan /kegrup: hanya admin, hanya di chat pribadi', () => {
  const db = openDb(':memory:');
  assert.match(handle(db, '/kirimkesini', { isAdmin: false, chatJid: '6281234@s.whatsapp.net' }), /khusus admin/);
  assert.match(handle(db, '/kirimkesini', { isAdmin: true, chatJid: '123@g.us' }), /chat pribadi/);
  assert.match(handle(db, '/kirimkesini', { isAdmin: true, chatJid: '6281234567890@s.whatsapp.net' }), /tidak ke grup/);
  assert.deepEqual(db.getSetting('tujuan'), { mode: 'pribadi', nomor: '6281234567890' });
  // Akun LID: nomor diambil dari akun web
  assert.match(handle(db, '/kirimkesini', { isAdmin: true, chatJid: '99999@lid', akun: { wa: '6289999' } }), /tidak ke grup/);
  assert.equal(db.getSetting('tujuan').nomor, '6289999');
  assert.match(handle(db, '/kegrup', { isAdmin: true, chatJid: '6281234567890@s.whatsapp.net' }), /grup kelas/);
  assert.equal(db.getSetting('tujuan').mode, 'grup');
  // /pakaigrup juga mengembalikan tujuan ke grup
  db.setSetting('tujuan', { mode: 'pribadi', nomor: '628' });
  handle(db, '/pakaigrup', { isAdmin: true, chatJid: '1-2@g.us' });
  assert.equal(db.getSetting('tujuan').mode, 'grup');
});

test('API tujuan pesan', async () => {
  const db = openDb(':memory:');
  const srv = createWeb(db, { password: 'rahasia123', cfg: loadConfig({}) }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const req = async (p, { method = 'GET', body, token } = {}) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  try {
    const adm = (await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'rahasia123' } })).json.token;
    db.setAkunWa(1, '6281111222233');
    assert.equal((await req('/api/status/tujuan', { token: adm })).json.saran, '6281111222233');
    assert.equal((await req('/api/status/tujuan', { method: 'POST', token: adm, body: { mode: 'pribadi', nomor: 'abc' } })).status, 400);
    const r = await req('/api/status/tujuan', { method: 'POST', token: adm, body: { mode: 'pribadi', nomor: '0812-1111-2222' } });
    assert.deepEqual(r.json.tujuan, { mode: 'pribadi', nomor: '6281211112222' });
    assert.equal((await req('/api/status/tujuan', { method: 'POST', token: adm, body: { mode: 'grup' } })).json.tujuan.mode, 'grup');
    assert.equal(db.getSetting('tujuan').nomor, '6281211112222'); // nomor diingat untuk dipakai lagi
  } finally { srv.close(); }
});
