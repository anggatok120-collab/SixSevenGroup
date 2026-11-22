// Web app + REST API. Konsep: web = tempat mengelola data, bot WA = pengirim pengingat.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { parseLocal, fmtLocal, parseHM, local, HARI_LABEL } = require('./time');
const { buildIcs } = require('./ics');
const { ymd } = require('./jadwal');
const { teksPengumuman } = require('./reminders');
const { ROLES, hashPassword, checkPassword, makeToken, readToken, bootstrapAdmin, pwVer } = require('./auth');
const { getSettings, validate } = require('./settings');
const { BUILDERS } = require('./messages');
const { normalWa, redeemLoginToken } = require('./walogin');
const { DEFAULT_DIR, NAME_RE, listBackups, backupNow } = require('./backup');

const noBot = { status: () => ({ wa: false }), send: async () => { throw new Error('Bot tidak tersedia'); } };

function createWeb(db, { password, cfg, bot = noBot, secret, backupDir = DEFAULT_DIR }) {
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
  const sessionFor = (akun) => makeToken(sessionSecret, akun.id, undefined, pwVer(akun.hash));
  const userOf = (req) => {
    const h = req.headers.authorization || '';
    const p = readToken(sessionSecret, h.startsWith('Bearer ') ? h.slice(7) : '');
    if (!p) return null;
    const a = db.akunById(p.id);
    if (!a || (p.v && p.v !== pwVer(a.hash))) return null;
    return { id: a.id, username: a.username, nama: a.nama, role: a.role };
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
  const catat = (req, aksi, jenis, ringkas) => db.addRiwayat(req.user.nama, aksi, jenis, ringkas);
  const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const tglLabel = (tgl) => { const t = local(parseLocal(`${tgl} 12:00`)); return `${HARI_LABEL[t.dow]}, ${t.d} ${BLN[t.mo - 1]}`; };

  const attempts = new Map();
  // Buang catatan percobaan login yang sudah lewat 15 menit, supaya memori tidak terus bertambah.
  setInterval(() => {
    const now = Date.now();
    for (const [ip, list] of attempts) if (!list.some((t) => now - t < 15 * 60000)) attempts.delete(ip);
  }, 10 * 60000).unref();
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
    res.json({ token: sessionFor(akun), user: { id: akun.id, username: akun.username, nama: akun.nama, role: akun.role } });
  });
  // Masuk lewat WhatsApp: halaman login butuh nomor bot, lalu menukar token dari link yang dikirim bot.
  app.get('/api/auth/wa', (req, res) => {
    const st = bot.status();
    res.json({ aktif: !!(st.wa && st.nomor), nomor: st.wa ? st.nomor || null : null });
  });
  app.post('/api/auth/wa', (req, res) => {
    const ip = req.ip; const now = Date.now();
    const a = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60000);
    if (a.length >= 10) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' });
    const akun = redeemLoginToken(db, req.body?.token, now);
    if (!akun) {
      attempts.set(ip, [...a, now]);
      return res.status(401).json({ error: 'Link masuk sudah dipakai atau kedaluwarsa. Kirim "login" lagi ke bot WhatsApp.' });
    }
    res.json({ token: sessionFor(akun), user: { id: akun.id, username: akun.username, nama: akun.nama, role: akun.role } });
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
    // Ganti password: sesi lain keluar, sesi ini dapat token baru.
    res.json(hash ? { ok: true, token: sessionFor(db.akunById(req.user.id)) } : { ok: true });
  });

  // ---- Data akademik ----
  const out = {
    tugas: (t) => ({ ...t, deadline: fmtLocal(t.deadline), ms: t.deadline, selesai: !!t.selesai }),
    ujian: (u) => ({ ...u, waktu: fmtLocal(u.waktu), ms: u.waktu }),
  };
  app.get('/api/data', anyUser, (req, res) => {
    const st = bot.status();
    const n = db.kumpulCount(); const saya = db.kumpulSaya(req.user.id);
    const dariTgl = ymd(Date.now() - 7 * 86400000);
    res.json({
      matkul: db.matkulAll(),
      kelas: db.kelasAll(),
      kelasUbah: db.kelasUbahAll().filter((u) => u.tanggal >= dariTgl),
      anggota: db.akunCount(),
      tugas: db.tugasAll().map((t) => ({ ...out.tugas(t), kumpulN: n[t.id] || 0, kumpulSaya: saya.has(t.id) })),
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

  const crud = (name, parse, add, update, del, { jenis, desc, byId }) => {
    app.post(`/api/${name}`, editor, (req, res) => {
      const r = parse(req.body || {}); if (r.error) return bad(res, r.error);
      const id = Number(add(r.v));
      catat(req, 'tambah', jenis, desc(r.v));
      res.json({ id });
    });
    app.put(`/api/${name}/:id`, editor, (req, res) => {
      const r = parse(req.body || {}); if (r.error) return bad(res, r.error);
      if (!update(Number(req.params.id), r.v)) return res.status(404).json({ error: 'Data tidak ditemukan' });
      catat(req, 'ubah', jenis, desc(r.v));
      res.json({ ok: true });
    });
    app.delete(`/api/${name}/:id`, editor, (req, res) => {
      const lama = byId(Number(req.params.id));
      if (!lama || !del(Number(req.params.id))) return res.status(404).json({ error: 'Data tidak ditemukan' });
      catat(req, 'hapus', jenis, desc(lama));
      res.json({ ok: true });
    });
  };
  // ---- Mata kuliah ----
  const WARNA = ['biru', 'toska', 'hijau', 'lime', 'kuning', 'oranye', 'merah', 'pink', 'ungu', 'indigo'];
  function matkulBody(b) {
    const nama = str(b.nama).replace(/\s+/g, ' ');
    if (!nama) return { error: 'Nama mata kuliah wajib diisi' };
    if (nama.length > 80) return { error: 'Nama mata kuliah terlalu panjang' };
    const warna = WARNA.includes(b.warna) ? b.warna : null;
    return { v: { nama, kode: null, sks: null, dosen: str(b.dosen) || null, catatan: str(b.catatan) || null, warna } };
  }
  const dupe = (nama, selfId) => { const m = db.matkulByNama(nama); return m && m.id !== selfId; };
  app.post('/api/matkul', editor, (req, res) => {
    const r = matkulBody(req.body || {}); if (r.error) return bad(res, r.error);
    if (dupe(r.v.nama)) return bad(res, `Mata kuliah "${r.v.nama}" sudah ada`);
    const id = Number(db.addMatkul(r.v));
    catat(req, 'tambah', 'mata kuliah', r.v.nama);
    res.json({ id });
  });
  app.put('/api/matkul/:id', editor, (req, res) => {
    const id = Number(req.params.id);
    const r = matkulBody(req.body || {}); if (r.error) return bad(res, r.error);
    if (dupe(r.v.nama, id)) return bad(res, `Mata kuliah "${r.v.nama}" sudah ada`);
    const lama = db.matkulById(id);
    if (!db.updateMatkul(id, r.v)) return res.status(404).json({ error: 'Data tidak ditemukan' });
    catat(req, 'ubah', 'mata kuliah', lama && lama.nama !== r.v.nama ? `${lama.nama} → ${r.v.nama}` : r.v.nama);
    res.json({ ok: true });
  });
  app.delete('/api/matkul/:id', editor, (req, res) => {
    const lama = db.matkulById(Number(req.params.id));
    const r = db.delMatkul(Number(req.params.id));
    if (r.pakai) {
      const p = r.pakai; const bagian = [p.jadwal && `${p.jadwal} jadwal`, p.tugas && `${p.tugas} tugas`, p.ujian && `${p.ujian} ujian`].filter(Boolean).join(', ');
      return res.status(409).json({ error: `Masih dipakai di ${bagian}. Hapus atau pindahkan dulu.` });
    }
    if (!r.changes) return res.status(404).json({ error: 'Data tidak ditemukan' });
    catat(req, 'hapus', 'mata kuliah', lama?.nama);
    res.json({ ok: true });
  });

  crud('kelas', kelasBody, db.addKelas, db.updateKelas, db.delKelas,
    { jenis: 'jadwal', byId: db.kelasById, desc: (k) => `${HARI_LABEL[k.hari]} ${k.mulai} ${k.matkul}` });
  crud('tugas', tugasBody, db.addTugas, db.updateTugas, db.delTugas,
    { jenis: 'tugas', byId: db.tugasById, desc: (t) => `${t.matkul}: ${t.judul}` });
  crud('ujian', ujianBody, db.addUjian, db.updateUjian, db.delUjian,
    { jenis: 'ujian', byId: db.ujianById, desc: (u) => `${u.jenis} ${u.matkul}` });
  app.post('/api/tugas/:id/selesai', editor, (req, res) => {
    const t = db.tugasById(Number(req.params.id));
    if (!t || !db.setSelesai(t.id, !!req.body?.selesai)) return res.status(404).json({ error: 'Data tidak ditemukan' });
    catat(req, 'ubah', 'tugas', `${t.matkul}: ${t.judul} ${req.body?.selesai ? 'ditutup (selesai)' : 'dibuka lagi'}`);
    res.json({ ok: true });
  });

  // ---- Status kumpul per anggota (semua peran boleh menandai dirinya sendiri) ----
  app.post('/api/tugas/:id/kumpul', anyUser, (req, res) => {
    const t = db.tugasById(Number(req.params.id));
    if (!t) return res.status(404).json({ error: 'Data tidak ditemukan' });
    db.setKumpul(t.id, req.user.id, !!req.body?.kumpul);
    res.json({ ok: true });
  });
  app.get('/api/tugas/:id/kumpul', anyUser, (req, res) => {
    const t = db.tugasById(Number(req.params.id));
    if (!t) return res.status(404).json({ error: 'Data tidak ditemukan' });
    const list = db.kumpulTugas(t.id);
    res.json({ sudah: list.filter((a) => a.at).map((a) => ({ nama: a.nama, at: a.at })), belum: list.filter((a) => !a.at).map((a) => a.nama) });
  });

  // ---- Kelas batal & kuliah pengganti ----
  app.post('/api/kelas-ubah', editor, async (req, res) => {
    const b = req.body || {};
    const tanggal = str(b.tanggal);
    const tglMs = /^\d{4}-\d{2}-\d{2}$/.test(tanggal) ? parseLocal(`${tanggal} 12:00`) : NaN;
    if (Number.isNaN(tglMs)) return bad(res, 'Tanggal tidak valid');
    if (tanggal < ymd(Date.now())) return bad(res, 'Tanggal sudah lewat');
    const catatan = str(b.catatan) || null;
    let v; let teks;
    if (b.jenis === 'batal') {
      const k = db.kelasById(Number(b.kelas_id));
      if (!k) return bad(res, 'Pilih kelas yang dibatalkan');
      if (k.hari !== local(tglMs).dow) return bad(res, `Kelas ${k.matkul} tidak ada di hari ${HARI_LABEL[local(tglMs).dow]}`);
      if (db.kelasUbahTanggal(tanggal).some((u) => u.jenis === 'batal' && u.kelas_id === k.id)) return bad(res, 'Kelas ini sudah ditandai batal di tanggal itu');
      v = { tanggal, jenis: 'batal', kelas_id: k.id, catatan };
      teks = `❌ *Kelas batal*\n*${k.matkul}* ${tglLabel(tanggal)}, jam ${k.mulai}${catatan ? `\nKeterangan: ${catatan}` : ''}`;
    } else if (b.jenis === 'pengganti') {
      const mulai = parseHM(str(b.mulai)); const selesai = str(b.selesai) ? parseHM(str(b.selesai)) : null;
      if (!mulai || (str(b.selesai) && !selesai)) return bad(res, 'Jam tidak valid');
      if (selesai && selesai <= mulai) return bad(res, 'Jam selesai harus setelah jam mulai');
      if (!str(b.matkul)) return bad(res, 'Mata kuliah wajib diisi');
      v = { tanggal, jenis: 'pengganti', mulai, selesai, matkul: str(b.matkul), ruang: str(b.ruang) || null, dosen: str(b.dosen) || null, catatan };
      teks = `🔁 *Kuliah pengganti*\n*${v.matkul}* ${tglLabel(tanggal)}, jam ${mulai}${selesai ? '–' + selesai : ''}${v.ruang ? ` @ ${v.ruang}` : ''}${catatan ? `\nKeterangan: ${catatan}` : ''}`;
    } else return bad(res, 'Jenis perubahan tidak dikenal');
    const id = Number(db.addKelasUbah(v));
    catat(req, 'tambah', b.jenis === 'batal' ? 'kelas batal' : 'kuliah pengganti', teks.split('\n')[1].replace(/\*/g, ''));
    let umum = null;
    if (b.umumkan) {
      try { await bot.send(teks); db.addLog('pengumuman', 'terkirim', teks.split('\n')[0].replace(/[*_]/g, '')); umum = 'terkirim'; }
      catch (err) { db.addLog('pengumuman', 'gagal', err.message); umum = `gagal: ${err.message}`; }
    }
    res.json({ id, umum });
  });
  app.delete('/api/kelas-ubah/:id', editor, (req, res) => {
    const u = db.kelasUbahById(Number(req.params.id));
    if (!u || !db.delKelasUbah(u.id)) return res.status(404).json({ error: 'Data tidak ditemukan' });
    catat(req, 'hapus', u.jenis === 'batal' ? 'kelas batal' : 'kuliah pengganti', `${u.tanggal}${u.matkul ? ' ' + u.matkul : ''}`);
    res.json({ ok: true });
  });

  // ---- Pengumuman ke grup (editor) ----
  app.get('/api/pengumuman', editor, (req, res) => res.json({ pengumuman: db.pengumumanAll() }));
  app.post('/api/pengumuman', editor, async (req, res) => {
    const teks = str(req.body?.teks);
    if (!teks) return bad(res, 'Isi pengumuman wajib diisi');
    if (teks.length > 3000) return bad(res, 'Pengumuman terlalu panjang (maks. 3000 karakter)');
    const now = Date.now();
    let kirimAt = now;
    if (str(req.body?.kirim_at)) {
      kirimAt = dt(req.body.kirim_at);
      if (Number.isNaN(kirimAt)) return bad(res, 'Waktu kirim tidak valid');
      if (kirimAt < now - 60000) return bad(res, 'Waktu kirim sudah lewat');
    }
    const terjadwal = kirimAt > now + 60000;
    const id = Number(db.addPengumuman({ teks, kirim_at: kirimAt, oleh: req.user.nama, status: terjadwal ? 'terjadwal' : 'mengirim' }));
    catat(req, 'tambah', 'pengumuman', teks.slice(0, 80));
    if (terjadwal) return res.json({ id, status: 'terjadwal' });
    try {
      await bot.send(teksPengumuman({ teks, oleh: req.user.nama }));
      db.setPengumumanStatus(id, 'terkirim'); db.addLog('pengumuman', 'terkirim', teks.slice(0, 120));
      res.json({ id, status: 'terkirim' });
    } catch (err) {
      db.setPengumumanStatus(id, 'gagal', err.message); db.addLog('pengumuman', 'gagal', err.message);
      res.status(502).json({ error: `Gagal mengirim: ${err.message}`, id });
    }
  });
  app.delete('/api/pengumuman/:id', editor, (req, res) => {
    const p = db.pengumumanById(Number(req.params.id));
    if (!p || !db.delPengumuman(p.id)) return res.status(404).json({ error: 'Data tidak ditemukan' });
    catat(req, 'hapus', 'pengumuman', p.teks.slice(0, 80));
    res.json({ ok: true });
  });

  // ---- Riwayat perubahan (admin) ----
  app.get('/api/riwayat', admin, (req, res) => res.json({ riwayat: db.riwayatTerbaru(200) }));

  // ---- Langganan kalender (.ics) ----
  const icsToken = () => {
    let t = db.getSetting('icsToken');
    if (!t) { t = crypto.randomBytes(18).toString('base64url'); db.setSetting('icsToken', t); }
    return t;
  };
  app.get('/api/kalender', anyUser, (req, res) => res.json({ path: `/kalender/${icsToken()}.ics` }));
  app.post('/api/kalender/reset', admin, (req, res) => {
    db.setSetting('icsToken', crypto.randomBytes(18).toString('base64url'));
    catat(req, 'ubah', 'kalender', 'Link langganan kalender diganti');
    res.json({ path: `/kalender/${icsToken()}.ics` });
  });
  app.get('/kalender/:file', (req, res) => {
    const m = /^([A-Za-z0-9_-]{10,64})\.ics$/.exec(req.params.file);
    const good = icsToken();
    if (!m || m[1].length !== good.length || !crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(good))) return res.status(404).send('Tidak ditemukan');
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Disposition': 'inline; filename="six-seven-67.ics"' });
    res.send(buildIcs(db));
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
    catat(req, 'ubah', 'pengingat', 'Pengaturan pengingat diperbarui');
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

  // ---- Backup database (admin) ----
  const backupInfo = () => ({ jam: cfg?.backupAt || '02:00', simpan: cfg?.backupKeep || 14, daftar: listBackups(backupDir) });
  app.get('/api/backup', admin, (req, res) => res.json(backupInfo()));
  app.post('/api/backup', admin, async (req, res) => {
    try { await backupNow(db, { dir: backupDir, keep: cfg?.backupKeep || 14 }); res.json(backupInfo()); }
    catch (err) { res.status(500).json({ error: `Backup gagal: ${err.message}` }); }
  });
  app.get('/api/backup/:name', admin, (req, res) => {
    const name = String(req.params.name);
    if (!NAME_RE.test(name) || !listBackups(backupDir).some((b) => b.name === name)) return res.status(404).json({ error: 'Backup tidak ditemukan' });
    res.download(path.join(backupDir, name), name);
  });

  // ---- Kelola akun (admin) ----
  app.get('/api/akun', admin, (req, res) => res.json({ akun: db.akunAll() }));
  // Nomor WA opsional; harus unik supaya satu nomor hanya bisa masuk ke satu akun.
  const waOf = (body, selfId) => {
    if (body?.wa === undefined) return { skip: true };
    const raw = str(body.wa); if (!raw) return { v: null };
    const wa = normalWa(raw);
    if (!wa) return { error: 'Nomor WhatsApp tidak valid. Contoh: 081234567890' };
    const other = db.akunByWa(wa);
    if (other && other.id !== selfId) return { error: `Nomor ini sudah dipakai akun ${other.nama}` };
    return { v: wa };
  };
  app.post('/api/akun', admin, (req, res) => {
    const username = str(req.body?.username).toLowerCase();
    const nama = str(req.body?.nama); const role = str(req.body?.role); const pw = String(req.body?.password || '');
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return bad(res, 'Username 3–32 karakter: huruf kecil, angka, titik, minus');
    if (!nama) return bad(res, 'Nama wajib diisi');
    if (!ROLES.includes(role)) return bad(res, 'Peran tidak valid');
    if (pw.length < 8) return bad(res, 'Password minimal 8 karakter');
    if (db.akunByUsername(username)) return bad(res, 'Username sudah dipakai');
    const w = waOf(req.body); if (w.error) return bad(res, w.error);
    const id = Number(db.addAkun({ username, nama, role, hash: hashPassword(pw) }));
    if (w.v) db.setAkunWa(id, w.v);
    catat(req, 'tambah', 'akun', `${nama} (@${username}, ${role})`);
    res.json({ id });
  });
  app.put('/api/akun/:id', admin, (req, res) => {
    const id = Number(req.params.id); const a = db.akunById(id);
    if (!a) return res.status(404).json({ error: 'Akun tidak ditemukan' });
    const nama = str(req.body?.nama) || a.nama; const role = str(req.body?.role) || a.role; const pw = String(req.body?.password || '');
    if (!ROLES.includes(role)) return bad(res, 'Peran tidak valid');
    if (a.role === 'admin' && role !== 'admin' && db.adminCount() <= 1) return bad(res, 'Harus ada minimal satu admin');
    if (pw && pw.length < 8) return bad(res, 'Password minimal 8 karakter');
    const w = waOf(req.body, id); if (w.error) return bad(res, w.error);
    db.updateAkun(id, { nama, role, hash: pw ? hashPassword(pw) : undefined });
    if (!w.skip) db.setAkunWa(id, w.v);
    catat(req, 'ubah', 'akun', `${nama} (@${a.username}${role !== a.role ? `, ${a.role} → ${role}` : ''}${pw ? ', password direset' : ''})`);
    res.json({ ok: true });
  });
  app.delete('/api/akun/:id', admin, (req, res) => {
    const id = Number(req.params.id); const a = db.akunById(id);
    if (!a) return res.status(404).json({ error: 'Akun tidak ditemukan' });
    if (id === req.user.id) return bad(res, 'Tidak bisa menghapus akun sendiri');
    if (a.role === 'admin' && db.adminCount() <= 1) return bad(res, 'Harus ada minimal satu admin');
    db.delAkun(id); catat(req, 'hapus', 'akun', `${a.nama} (@${a.username})`); res.json({ ok: true });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Tidak ditemukan' }));
  return app;
}

module.exports = { createWeb };
