process.env.TZ_OFFSET = '7';
const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createWeb } = require('../src/web');
const { loadConfig } = require('../src/config');
const { handle } = require('../src/commands');

test('/pakaigrup: hanya admin, hanya di grup', () => {
  const db = openDb(':memory:');
  assert.match(handle(db, '/pakaigrup', { isAdmin: false, chatJid: '123@g.us' }), /khusus admin/);
  assert.match(handle(db, '/pakaigrup', { isAdmin: true, chatJid: '62812@s.whatsapp.net' }), /di dalam grup/);
  assert.match(handle(db, '/pakaigrup', { isAdmin: true, chatJid: '120363-99@g.us' }), /grup kelas/);
  assert.equal(db.getSetting('grupJid'), '120363-99@g.us');
});

test('API ganti grup tujuan dan diagnosis status', async () => {
  let dipakai = null;
  const bot = {
    status: () => ({ wa: true, grupJid: dipakai, pesanTerakhir: 123, catatan: [{ at: 1, level: 'error', pesan: 'x' }] }),
    daftarGrup: async () => [{ jid: '111@g.us', nama: 'Kelas A', anggota: 30 }],
    pakaiGrup: async (jid) => { dipakai = jid; },
  };
  const db = openDb(':memory:');
  const srv = createWeb(db, { password: 'rahasia123', cfg: loadConfig({}), bot }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const req = async (p, { method = 'GET', body, token } = {}) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  try {
    const adm = (await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'rahasia123' } })).json.token;
    assert.equal((await req('/api/status/grup', { token: adm })).json.grup[0].nama, 'Kelas A');
    assert.equal((await req('/api/status/grup', { method: 'POST', token: adm, body: { jid: 'bukan-grup' } })).status, 400);
    assert.equal((await req('/api/status/grup', { method: 'POST', token: adm, body: { jid: '111@g.us' } })).status, 200);
    const st = (await req('/api/status', { token: adm })).json;
    assert.deepEqual([st.grupJid, st.pesanTerakhir, st.catatan.length], ['111@g.us', 123, 1]);
  } finally { srv.close(); }
});
