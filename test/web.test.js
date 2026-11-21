process.env.TZ_OFFSET = '7';
const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createWeb } = require('../src/web');
const { loadConfig } = require('../src/config');

function setup(bot) {
  const db = openDb(':memory:');
  const app = createWeb(db, { password: 'rahasia123', cfg: loadConfig({}), bot, backupDir: require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'bk-')) });
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const req = async (p, { method = 'GET', body, token } = {}) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const login = async (username, password) => (await req('/api/auth/login', { method: 'POST', body: { username, password } })).json?.token;
  return { db, srv, req, login };
}

test('login, peran, dan CRUD', async () => {
  const { srv, req, login } = setup();
  try {
    assert.equal((await req('/api/data')).status, 401);
    assert.equal((await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'salah' } })).status, 401);
    const adm = await login('admin', 'rahasia123');
    assert.ok(adm);
    assert.equal((await req('/api/auth/me', { token: adm })).json.user.role, 'admin');
    assert.equal((await req('/api/auth/me', { token: adm + 'x' })).status, 401);

    // buat akun editor & anggota
    assert.equal((await req('/api/akun', { method: 'POST', token: adm, body: { username: 'budi', nama: 'Budi', role: 'editor', password: 'pendek' } })).status, 400);
    assert.equal((await req('/api/akun', { method: 'POST', token: adm, body: { username: 'budi', nama: 'Budi', role: 'editor', password: 'password-budi' } })).status, 200);
    assert.equal((await req('/api/akun', { method: 'POST', token: adm, body: { username: 'sari', nama: 'Sari', role: 'viewer', password: 'password-sari' } })).status, 200);
    const ed = await login('BUDI', 'password-budi');
    const vw = await login('sari', 'password-sari');

    // anggota hanya lihat
    assert.equal((await req('/api/kelas', { method: 'POST', token: vw, body: { hari: 1, mulai: '08:00', matkul: 'X' } })).status, 403);
    assert.equal((await req('/api/akun', { token: ed })).status, 403);
    assert.equal((await req('/api/pengingat', { token: ed })).status, 403);

    // editor kelola data
    assert.equal((await req('/api/kelas', { method: 'POST', token: ed, body: { hari: 1, mulai: '10:00', selesai: '09:00', matkul: 'X' } })).status, 400);
    assert.equal((await req('/api/kelas', { method: 'POST', token: ed, body: { hari: 1, mulai: '08:00', selesai: '09:40', matkul: 'Kalkulus', ruang: 'R.1' } })).status, 200);
    const t = await req('/api/tugas', { method: 'POST', token: ed, body: { matkul: 'BD', judul: 'ERD', deadline: '2026-11-28T23:59', prioritas: 'tinggi', catatan: 'via Drive' } });
    assert.equal(t.status, 200);
    assert.equal((await req(`/api/tugas/${t.json.id}/selesai`, { method: 'POST', token: ed, body: { selesai: true } })).status, 200);
    const u = await req('/api/ujian', { method: 'POST', token: ed, body: { matkul: 'Kalkulus', jenis: 'UTS', waktu: '2026-12-02T08:00' } });
    const data = (await req('/api/data', { token: vw })).json;
    assert.equal(data.kelas[0].matkul, 'Kalkulus');
    assert.deepEqual([data.tugas[0].judul, data.tugas[0].deadline, data.tugas[0].selesai, data.tugas[0].prioritas, data.tugas[0].catatan], ['ERD', '2026-11-28 23:59', true, 'tinggi', 'via Drive']);
    assert.equal(data.ujian[0].waktu, '2026-12-02 08:00');
    assert.ok(data.serverTime > 0);
    assert.equal((await req(`/api/ujian/${u.json.id}`, { method: 'DELETE', token: ed })).status, 200);

    // ganti password sendiri
    assert.equal((await req('/api/auth/me', { method: 'PUT', token: vw, body: { nama: 'Sari W', passwordLama: 'salah', passwordBaru: 'password-baru' } })).status, 400);
    assert.equal((await req('/api/auth/me', { method: 'PUT', token: vw, body: { nama: 'Sari W', passwordLama: 'password-sari', passwordBaru: 'password-baru' } })).status, 200);
    assert.ok(await login('sari', 'password-baru'));

    // admin terakhir tidak bisa diturunkan / hapus diri sendiri
    const akun = (await req('/api/akun', { token: adm })).json.akun;
    const adminId = akun.find((a) => a.username === 'admin').id;
    assert.equal((await req(`/api/akun/${adminId}`, { method: 'PUT', token: adm, body: { role: 'viewer' } })).status, 400);
    assert.equal((await req(`/api/akun/${adminId}`, { method: 'DELETE', token: adm })).status, 400);
  } finally { srv.close(); }
});

test('pengingat & status bot', async () => {
  const sent = [];
  let online = true;
  const bot = { status: () => ({ wa: online, grupJid: 'g@g.us', grupNama: 'Kelas' }), send: async (t) => { if (!online) throw new Error('offline'); sent.push(t); } };
  const { srv, req, login } = setup(bot);
  try {
    const adm = await login('admin', 'rahasia123');
    const p = (await req('/api/pengingat', { token: adm })).json;
    assert.equal(p.pengaturan.pagi.jam, '06:00');
    assert.match(p.preview.pagi, /Selamat pagi/);
    assert.equal((await req('/api/pengingat', { method: 'PUT', token: adm, body: { ...p.pengaturan, pagi: { on: true, jam: '25:00' } } })).status, 400);
    const r = await req('/api/pengingat', { method: 'PUT', token: adm, body: { ...p.pengaturan, pagi: { on: true, jam: '05:30' }, kelas: { on: false, menit: 15 } } });
    assert.equal(r.json.pengaturan.pagi.jam, '05:30'); assert.equal(r.json.pengaturan.kelas.on, false);
    assert.equal((await req('/api/pengingat/kirim/tugas', { method: 'POST', token: adm })).status, 200);
    assert.equal((await req('/api/status/tes', { method: 'POST', token: adm })).status, 200);
    assert.equal(sent.length, 2);
    online = false;
    assert.equal((await req('/api/status/tes', { method: 'POST', token: adm })).status, 502);
    const s = (await req('/api/status', { token: adm })).json;
    assert.equal(s.grupNama, 'Kelas'); assert.equal(s.gagal24, 1); assert.equal(s.log.length, 3);
  } finally { srv.close(); }
});

test('masuk lewat WhatsApp: link sekali pakai', async () => {
  const { normalWa, senderNumbers, isLoginRequest, createLoginToken, loginReply } = require('../src/walogin');
  assert.equal(normalWa('0812-3456-7890'), '6281234567890');
  assert.equal(normalWa('+62 812 3456 7890'), '6281234567890');
  assert.equal(normalWa('12'), null);
  assert.deepEqual(senderNumbers({ remoteJid: '123@lid', senderPn: '6281234567890@s.whatsapp.net' }), ['6281234567890']);
  assert.ok(isLoginRequest('login') && isLoginRequest(' Masuk ') && isLoginRequest('/login'));
  assert.ok(!isLoginRequest('masuk kelas jam berapa'));

  const bot = { status: () => ({ wa: true, nomor: '6285199282919' }), send: async () => {} };
  const { db, srv, req, login } = setup(bot);
  try {
    const adm = await login('admin', 'rahasia123');
    assert.deepEqual((await req('/api/auth/wa')).json, { aktif: true, nomor: '6285199282919' });
    assert.equal((await req('/api/akun', { method: 'POST', token: adm, body: { username: 'sari', nama: 'Sari', role: 'viewer', password: 'password-sari', wa: 'abc' } })).status, 400);
    const sari = await req('/api/akun', { method: 'POST', token: adm, body: { username: 'sari', nama: 'Sari', role: 'viewer', password: 'password-sari', wa: '0812 3456 7890' } });
    assert.equal(sari.status, 200);
    assert.equal((await req('/api/akun', { token: adm })).json.akun.find((a) => a.username === 'sari').wa, '6281234567890');
    // nomor yang sama tidak boleh dipakai akun lain
    assert.equal((await req('/api/akun', { method: 'POST', token: adm, body: { username: 'budi', nama: 'Budi', role: 'viewer', password: 'password-budi', wa: '+6281234567890' } })).status, 400);

    assert.equal(createLoginToken(db, ['6289999999999']).error, 'unknown');
    const r = createLoginToken(db, ['6281234567890']);
    assert.equal(r.akun.username, 'sari');
    assert.match(loginReply(r, 'https://contoh.id/'), /https:\/\/contoh\.id\/login\?wa=/);
    assert.equal((await req('/api/auth/wa', { method: 'POST', body: { token: 'x'.repeat(32) } })).status, 401);
    const ok = await req('/api/auth/wa', { method: 'POST', body: { token: r.token } });
    assert.equal(ok.status, 200);
    assert.equal((await req('/api/auth/me', { token: ok.json.token })).json.user.username, 'sari');
    // sekali pakai
    assert.equal((await req('/api/auth/wa', { method: 'POST', body: { token: r.token } })).status, 401);
    // kedaluwarsa
    const old = createLoginToken(db, ['6281234567890'], Date.now() - 11 * 60000);
    assert.equal((await req('/api/auth/wa', { method: 'POST', body: { token: old.token } })).status, 401);
    // batas 3 link per 10 menit
    createLoginToken(db, ['6281234567890']);
    assert.equal(createLoginToken(db, ['6281234567890']).error, undefined);
    assert.equal(createLoginToken(db, ['6281234567890']).error, 'limit');
    // hapus nomor
    assert.equal((await req(`/api/akun/${sari.json.id}`, { method: 'PUT', token: adm, body: { wa: '' } })).status, 200);
    assert.equal(createLoginToken(db, ['6281234567890']).error, 'unknown');
  } finally { srv.close(); }
});
