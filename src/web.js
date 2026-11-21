// Web app + REST API. Konsep: web = tempat mengelola data, bot WA = pengirim pengingat.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { parseLocal, fmtLocal, parseHM } = require('./time');
const { ROLES, hashPassword, checkPassword, makeToken, readToken, bootstrapAdmin } = require('./auth');
const { getSettings, validate } = require('./settings');
const { BUILDERS } = require('./messages');

const noBot = { status: () => ({ wa: false }), send: async () => { throw new Error('Bot tidak tersedia'); } };

function createWeb(db, { password, cfg, bot = noBot, secret }) {
  const sessionSecret = secret || crypto.createHash('sha256').update(`wa-pengingat-kuliah:${password || ''}`).digest('hex');
  bootstrapAdmin(db, password);

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));
  const pub = path.join(__dirname, '..', 'public');
  app.get('/login', (req, res) => res.sendFile(path.join(pub, 'login.html')));
  const vendor = (pkg) => path.join(__dirname, '..', 'node_modules', pkg);
  const long = { maxAge: '30d', immutable: true };
  app.use('/vendor/phosphor', express.static(path.join(vendor('@phosphor-icons/web'), 'src'), long));
  app.use('/vendor/inter', express.static(vendor('@fontsource-variable/inter'), long));
  app.use('/vendor/mono', express.static(vendor('@fontsource/jetbrains-mono'), long));
  app.use(express.static(pub));

  // ---- Auth ----
  const userOf = (req) => {
    const h = req.headers.authorization || '';
    const p = readToken(sessionSecret, h.startsWith('Bearer ') ? h.slice(7) : '');
    if (!p) return null;
    const a = db.akunById(p.id);
    return a ? { id: a.id, username: a.username, nama: a.nama, role: a.role } : null;
  };
  const need = (...roles) => (req, res, next) => {
    const u = userOf(req);
    if (!u) return res.status(401).json({ error: 'Sesi berakhir, silakan masuk lagi' });
    if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: 'Kamu tidak punya akses untuk ini' });
    req.user = u; next();
  };
  const anyUser = need();
  const editor = need('admin', 'editor');
  const admin = need('admin');

  const attempts = new Map();
  app.post('/api/auth/login', (req, res) => {
    const ip = req.ip; const now = Date.now();
    const a = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60000);
    if (a.length >= 10) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' });
    const akun = db.akunByUsername(String(req.body?.username || '').trim());
    if (!akun || !checkPassword(String(req.body?.password || ''), akun.hash)) {
      attempts.set(ip, [...a, now]);
      return res.status(401).json({ error: 'Username atau password salah' });
    }
    attempts.delete(ip);
    res.json({ token: makeToken(sessionSecret, akun.id), user: { id: akun.id, username: akun.username, nama: akun.nama, role: akun.role } });
  });
  app.get('/api/auth/me', anyUser, (req, res) => res.json({ user: req.user }));
  app.put('/api/auth/me', anyUser, (req, res) => {
    const nama = str(req.body?.nama) || req.user.nama;
    const baru = String(req.body?.passwordBaru || '');
    let hash;
    if (baru) {
      const akun = db.akunById(req.user.id);
      if (!checkPassword(String(req.body?.passwordLama || ''), akun.hash)) return bad(res, 'Password lama salah');
      if (baru.length < 8) return bad(res, 'Password baru minimal 8 karakter');
      hash = hashPassword(baru);
    }
    db.updateAkun(req.user.id, { nama, role: req.user.role, hash });
    res.json({ ok: true });
  });

  // ---- Data akademik ----
  const out = {
    tugas: (t) => ({ ...t, deadline: fmtLocal(t.deadline), ms: t.deadline, selesai: !!t.selesai }),
    ujian: (u) => ({ ...u, waktu: fmtLocal(u.waktu), ms: u.waktu }),
  };
  app.get('/api/data', anyUser, (req, res) => {
    const st = bot.status();
    res.json({
      kelas: db.kelasAll(),
      tugas: db.tugasAll().map(out.tugas),
      ujian: db.ujianAll().map(out.ujian),
      bot: { wa: !!st.wa, grup: !!st.grupJid },
      serverTime: Date.now(),
    });
  });

  const bad = (res, msg) => res.status(400).json({ error: msg });
  const str = (v) => (v == null ? '' : String(v).trim());
  const dt = (v) => parseLocal(str(v).replace('T', ' ').slice(0, 16));

  function kelasBody(b) {
    const hari = Number(b.hari);
    const mulai = parseHM(str(b.mulai));
    const selesai = str(b.selesai) ? parseHM(str(b.selesai)) : null;
    if (!(Number.isInteger(hari) && hari >= 0 && hari <= 6)) return { error: 'Hari tidak valid' };
    if (!mulai || (str(b.selesai) && !selesai)) return { error: 'Jam tidak valid' };
    if (selesai && selesai <= mulai) return { error: 'Jam selesai harus setelah jam mulai' };
    if (!str(b.matkul)) return { error: 'Mata kuliah wajib diisi' };
    return { v: { hari, mulai, selesai, matkul: str(b.matkul), ruang: str(b.ruang) || null, dosen: str(b.dosen) || null } };
  }
  function tugasBody(b) {
    const deadline = dt(b.deadline);
    if (!str(b.matkul) || !str(b.judul)) return { error: 'Mata kuliah dan judul wajib diisi' };
    if (Number.isNaN(deadline)) return { error: 'Tenggat tidak valid' };
    const prioritas = b.prioritas === 'tinggi' ? 'tinggi' : 'normal';
    return { v: { matkul: str(b.matkul), judul: str(b.judul), deadline, selesai: b.selesai ? 1 : 0, prioritas, catatan: str(b.catatan) || null } };
  }
  function ujianBody(b) {
    const waktu = dt(b.waktu);
    if (!str(b.matkul) || !str(b.jenis)) return { error: 'Mata kuliah dan jenis wajib diisi' };
    if (Number.isNaN(waktu)) return { error: 'Waktu tidak valid' };
    return { v: { matkul: str(b.matkul), jenis: str(b.jenis), waktu, ruang: str(b.ruang) || null } };
  }

  const crud = (name, parse, add, update, del) => {
    app.post(`/api/${name}`, editor, (req, res) => {
      const r = parse(req.body || {}); if (r.error) return bad(res, r.error);
      res.json({ id: Number(add(r.v)) });
    });
    app.put(`/api/${name}/:id`, editor, (req, res) => {
      const r = parse(req.body || {}); if (r.error) return bad(res, r.error);
      if (!update(Number(req.params.id), r.v)) return res.status(404).json({ error: 'Data tidak ditemukan' });
      res.json({ ok: true });
    });
    app.delete(`/api/${name}/:id`, editor, (req, res) => {
      if (!del(Number(req.params.id))) return res.status(404).json({ error: 'Data tidak ditemukan' });
      res.json({ ok: true });
    });
  };
  crud('kelas', kelasBody, db.addKelas, db.updateKelas, db.delKelas);
  crud('tugas', tugasBody, db.addTugas, db.updateTugas, db.delTugas);
  crud('ujian', ujianBody, db.addUjian, db.updateUjian, db.delUjian);
  app.post('/api/tugas/:id/selesai', editor, (req, res) => {
    if (!db.setSelesai(Number(req.params.id), !!req.body?.selesai)) return res.status(404).json({ error: 'Data tidak ditemukan' });
    res.json({ ok: true });
  });

  // ---- Pusat pengingat (admin) ----
  app.get('/api/pengingat', admin, (req, res) => {
    const now = Date.now();
    const preview = Object.fromEntries(Object.entries(BUILDERS).map(([k, f]) => [k, f(db, now).text]));
    res.json({ pengaturan: getSettings(db, cfg), preview });
  });
  app.put('/api/pengingat', admin, (req, res) => {
    const r = validate(req.body || {}, cfg); if (r.error) return bad(res, r.error);
    db.setSetting('pengingat', r.value);
    res.json({ pengaturan: getSettings(db, cfg) });
  });
  app.post('/api/pengingat/kirim/:mode', admin, async (req, res) => {
    const f = BUILDERS[req.params.mode];
    if (!f) return bad(res, 'Jenis pesan tidak dikenal');
    const text = f(db, Date.now()).text;
    try {
      await bot.send(text);
      db.addLog(req.params.mode, 'terkirim', `Manual oleh ${req.user.nama}`);
      res.json({ ok: true });
    } catch (err) {
      db.addLog(req.params.mode, 'gagal', err.message);
      res.status(502).json({ error: `Gagal mengirim: ${err.message}` });
    }
  });

  // ---- Status bot (admin) ----
  app.get('/api/status', admin, (req, res) => {
    const st = bot.status();
    res.json({
      wa: !!st.wa, nomor: st.nomor || null, grupJid: st.grupJid || null, grupNama: st.grupNama || null,
      sejak: st.sejak || null, gagal24: db.logGagal24(), log: db.logTerbaru(30),
      jumlah: { kelas: db.kelasAll().length, tugasAktif: db.tugasAktif().length, ujian: db.ujianMendatang(Date.now()).length, akun: db.akunCount() },
    });
  });
  app.post('/api/status/tes', admin, async (req, res) => {
    try {
      await bot.send(`🧪 *Pesan percobaan*\nBot pengingat kuliah aktif dan terhubung ke grup ini.\n_Dikirim dari web oleh ${req.user.nama}_`);
      db.addLog('tes', 'terkirim', `Tes oleh ${req.user.nama}`);
      res.json({ ok: true });
    } catch (err) {
      db.addLog('tes', 'gagal', err.message);
      res.status(502).json({ error: `Gagal mengirim: ${err.message}` });
    }
  });

  // ---- Kelola akun (admin) ----
  app.get('/api/akun', admin, (req, res) => res.json({ akun: db.akunAll() }));
  app.post('/api/akun', admin, (req, res) => {
    const username = str(req.body?.username).toLowerCase();
    const nama = str(req.body?.nama); const role = str(req.body?.role); const pw = String(req.body?.password || '');
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return bad(res, 'Username 3–32 karakter: huruf kecil, angka, titik, minus');
    if (!nama) return bad(res, 'Nama wajib diisi');
    if (!ROLES.includes(role)) return bad(res, 'Peran tidak valid');
    if (pw.length < 8) return bad(res, 'Password minimal 8 karakter');
    if (db.akunByUsername(username)) return bad(res, 'Username sudah dipakai');
    res.json({ id: Number(db.addAkun({ username, nama, role, hash: hashPassword(pw) })) });
  });
  app.put('/api/akun/:id', admin, (req, res) => {
    const id = Number(req.params.id); const a = db.akunById(id);
    if (!a) return res.status(404).json({ error: 'Akun tidak ditemukan' });
    const nama = str(req.body?.nama) || a.nama; const role = str(req.body?.role) || a.role; const pw = String(req.body?.password || '');
    if (!ROLES.includes(role)) return bad(res, 'Peran tidak valid');
    if (a.role === 'admin' && role !== 'admin' && db.adminCount() <= 1) return bad(res, 'Harus ada minimal satu admin');
    if (pw && pw.length < 8) return bad(res, 'Password minimal 8 karakter');
    db.updateAkun(id, { nama, role, hash: pw ? hashPassword(pw) : undefined });
    res.json({ ok: true });
  });
  app.delete('/api/akun/:id', admin, (req, res) => {
    const id = Number(req.params.id); const a = db.akunById(id);
    if (!a) return res.status(404).json({ error: 'Akun tidak ditemukan' });
    if (id === req.user.id) return bad(res, 'Tidak bisa menghapus akun sendiri');
    if (a.role === 'admin' && db.adminCount() <= 1) return bad(res, 'Harus ada minimal satu admin');
    db.delAkun(id); res.json({ ok: true });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Tidak ditemukan' }));
  return app;
}

module.exports = { createWeb };
