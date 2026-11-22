// Web app + REST API. Konsep: web = tempat mengelola data, bot WA = pengirim pengingat.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const { parseLocal, fmtLocal, parseHM, local, HARI_LABEL, pretty } = require('./time');
const { buildIcs } = require('./ics');
const { waktu: waktuWa, rentang: rentangWa } = require('./format');
const { ymd, getSemester, validasiSemester } = require('./jadwal');
const { teksPengumuman, statusKumpulFn, antrean } = require('./reminders');
const { vapid, kirimPush } = require('./push');
const { hashPassword: hp } = require('./auth');
const { ROLES, hashPassword, checkPassword, makeToken, readToken, bootstrapAdmin, pwVer } = require('./auth');
const { getSettings, validate } = require('./settings');
const { BUILDERS } = require('./messages');
const { normalWa, redeemLoginToken } = require('./walogin');
const { DEFAULT_DIR, NAME_RE, listBackups, backupNow } = require('./backup');

const tidakAda = async () => { throw new Error('Bot tidak tersedia'); };
const noBot = { status: () => ({ wa: false }), send: tidakAda, sendTo: tidakAda, sendPoll: tidakAda, daftarGrup: tidakAda, pakaiGrup: tidakAda };

function createWeb(db, { password, cfg, bot: botIn = noBot, secret, backupDir = DEFAULT_DIR, uploadDir = path.join(__dirname, '..', 'data', 'uploads'), onRestore = null, push = kirimPush }) {
  const bot = { ...noBot, ...botIn };
  const sessionSecret = secret || crypto.createHash('sha256').update(`wa-pengingat-kuliah:${password || ''}`).digest('hex');
  bootstrapAdmin(db, password);

  const app = express();
  app.set('trust proxy', 1);
  app.use('/api/upload', express.json({ limit: '6mb' }));
  app.use('/api/auth/me', express.json({ limit: '300kb' }));
  app.use(express.json({ limit: '100kb' }));
  const pub = path.join(__dirname, '..', 'public');
  app.get('/login', (req, res) => res.sendFile(path.join(pub, 'login.html')));
  app.get('/daftar', (req, res) => res.sendFile(path.join(pub, 'daftar.html')));
  // Gambar lampiran pengumuman (nama file acak, tidak bisa ditebak).
  app.use('/uploads', express.static(uploadDir, { maxAge: '30d', immutable: true, index: false }));
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
    if (!a || (p.v && p.v !== pwVer(a.hash)) || a.status !== 'aktif') return null;
    // Catat "terakhir aktif" paling sering tiap 5 menit.
    const now = Date.now();
    if (!a.terakhir || now - a.terakhir > 5 * 60000) db.setTerakhir(a.id, now);
    return { id: a.id, username: a.username, nama: a.nama, role: a.role, dm: a.dm !== 0, foto: !!a.foto };
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
    if (akun.status === 'pending') return res.status(403).json({ error: 'Akun kamu masih menunggu persetujuan admin kelas.' });
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
    if (!akun || akun.status !== 'aktif') {
      attempts.set(ip, [...a, now]);
      return res.status(401).json({ error: 'Link masuk sudah dipakai atau kedaluwarsa. Kirim "login" lagi ke bot WhatsApp.' });
    }
    res.json({ token: sessionFor(akun), user: { id: akun.id, username: akun.username, nama: akun.nama, role: akun.role } });
  });
  app.get('/api/auth/me', anyUser, (req, res) => res.json({ user: req.user }));
  app.put('/api/auth/me', anyUser, (req, res) => {
    const b = req.body || {};
    // Preferensi saja (tanpa nama/password): DM pengingat pribadi dan foto profil.
    if ('dm' in b || 'foto' in b) {
      let foto;
      if (b.foto === null) db.hapusFoto(req.user.id);
      else if (b.foto !== undefined) {
        if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(b.foto)) || b.foto.length > 200000) return bad(res, 'Foto tidak valid atau terlalu besar');
        foto = b.foto;
      }
      db.setAkunPref(req.user.id, { dm: 'dm' in b ? !!b.dm : null, foto });
      if (!('nama' in b) && !('passwordBaru' in b)) return res.json({ ok: true });
    }
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
  // Ringkasan status kumpul semua tugas untuk satu akun (kelompok dihitung per kelompok).
  function infoKumpul(akunId) {
    const n = db.kumpulCount(); const sudah = statusKumpulFn(db);
    const rows = db.kelompokAll(); const nama = new Map(db.akunAll().map((a) => [a.id, a.nama]));
    const grup = new Map(); // tugas -> [{id,nama,anggota:[]}]
    for (const r of rows) {
      if (!grup.has(r.tugas_id)) grup.set(r.tugas_id, []);
      let g = grup.get(r.tugas_id).find((x) => x.id === r.id);
      if (!g) { g = { id: r.id, nama: r.nama, anggota: [] }; grup.get(r.tugas_id).push(g); }
      if (r.akun_id != null) g.anggota.push({ id: r.akun_id, nama: nama.get(r.akun_id) || '?' });
    }
    return (t) => {
      const gs = t.kelompok ? grup.get(t.id) || [] : [];
      if (!gs.length) return { kumpulN: n[t.id] || 0, kumpulTotal: db.akunCount(), kumpulSaya: sudah(t, akunId), grup: null, grupSaya: null };
      const selesai = gs.filter((g) => g.anggota.some((a) => db.sudahKumpul(t.id, a.id))).length;
      return { kumpulN: selesai, kumpulTotal: gs.length, kumpulSaya: sudah(t, akunId), grup: gs, grupSaya: gs.find((g) => g.anggota.some((a) => a.id === akunId))?.nama || null };
    };
  }
  const centangMap = (akunId) => {
    const m = {}; for (const c of db.centangSaya(akunId)) (m[`${c.jenis}:${c.ref_id}`] ||= []).push(c.idx); return m;
  };
  app.get('/api/data', anyUser, (req, res) => {
    const st = bot.status();
    const k = infoKumpul(req.user.id);
    const now = Date.now();
    res.json({
      matkul: db.matkulAll().map((m) => ({ ...m, bobot: m.bobot ? JSON.parse(m.bobot) : null })),
      kelas: db.kelasAll(),
      kelasUbah: db.kelasUbahAll(),
      semester: getSemester(db),
      materi: db.materiAll(),
      anggota: db.akunCount(),
      orang: db.akunAll().filter((a) => a.status === 'aktif').map((a) => ({ id: a.id, nama: a.nama, foto: !!a.ada_foto })),
      pin: db.pengumumanPin(now).map((p) => ({ id: p.id, teks: p.teks, oleh: p.oleh, kirim_at: p.kirim_at, pin_sampai: p.pin_sampai, gambar: p.gambar })),
      prak: (() => {
        const n = db.prakKumpulCount(); const saya = db.prakKumpulSaya(req.user.id);
        return {
          daftar: db.praktikumAll().map((p) => ({ ...p, pakai: db.pakaiPraktikum(p.id) })),
          sesi: db.prakSesiAll(),
          tugas: db.prakTugasAll().map((t) => ({ ...t, deadline: fmtLocal(t.deadline), ms: t.deadline, selesai: !!t.selesai, kumpulN: n[t.id] || 0, kumpulSaya: saya.has(t.id) })),
        };
      })(),
      saya: { nilai: db.nilaiSaya(req.user.id), centang: centangMap(req.user.id), absen: db.absenSaya(req.user.id).map((a) => `${a.tanggal}|${a.kelas_key}`) },
      tugas: db.tugasAll().map((t) => ({ ...out.tugas(t), kelompok: !!t.kelompok, ...k(t) })),
      ujian: db.ujianAll().map(out.ujian),
      bot: { wa: !!st.wa, grup: !!st.grupJid },
      serverTime: Date.now(),
    });
  });

  const bad = (res, msg) => res.status(400).json({ error: msg });
  const str = (v) => (v == null ? '' : String(v).trim());
  const dt = (v) => parseLocal(str(v).replace('T', ' ').slice(0, 16));
  // Link opsional: null kalau kosong, false kalau formatnya salah.
  const url = (v) => { const s = str(v); if (!s) return null; return /^https?:\/\/\S+$/i.test(s) && s.length <= 500 ? s : false; };

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
    const link = url(b.link); const lampiran = url(b.lampiran);
    if (link === false || lampiran === false) return { error: 'Link harus diawali http:// atau https://' };
    const langkah = str(b.langkah).split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 30).join('\n') || null;
    return { v: { matkul: str(b.matkul), judul: str(b.judul), deadline, selesai: b.selesai ? 1 : 0, prioritas, catatan: str(b.catatan) || null, link, lampiran, langkah, kelompok: b.kelompok ? 1 : 0 } };
  }
  function ujianBody(b) {
    const waktu = dt(b.waktu);
    if (!str(b.matkul) || !str(b.jenis)) return { error: 'Mata kuliah dan jenis wajib diisi' };
    if (Number.isNaN(waktu)) return { error: 'Waktu tidak valid' };
    const link = url(b.link); if (link === false) return { error: 'Link harus diawali http:// atau https://' };
    const materi = str(b.materi).split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 40).join('\n') || null;
    return { v: { matkul: str(b.matkul), jenis: str(b.jenis), waktu, ruang: str(b.ruang) || null, materi, bawa: str(b.bawa) || null, link } };
  }

  // Hapus = pindah ke sampah (30 hari) supaya bisa dikembalikan dari Riwayat.
  const buang = (req, jenis, tabel, row, ringkas, ekstra = {}) => {
    const sid = db.addSampah(tabel, { row, ...ekstra }, req.user.nama);
    db.addRiwayat(req.user.nama, 'hapus', jenis, ringkas, sid);
    return sid;
  };
  // Beri tahu grup kalau tenggat tugas / waktu ujian berubah.
  const umumkanPerubahan = async (teks) => {
    try { await bot.send(teks); db.addLog('pengumuman', 'terkirim', teks.split('\n')[0].replace(/[*_]/g, '')); return 'terkirim'; }
    catch (err) { db.addLog('pengumuman', 'gagal', err.message); return `gagal: ${err.message}`; }
  };
  const crud = (name, parse, add, update, del, { jenis, desc, byId, tabel, perubahan, banyak }) => {
    app.post(`/api/${name}`, editor, (req, res) => {
      const r = parse(req.body || {}); if (r.error) return bad(res, r.error);
      const list = banyak ? banyak(r.v, req.body || {}) : [r.v];
      if (list.error) return bad(res, list.error);
      const ids = list.map((v) => Number(add(v)));
      catat(req, 'tambah', jenis, desc(r.v) + (ids.length > 1 ? ` (${ids.length}×, berulang)` : ''));
      res.json({ id: ids[0], ids });
    });
    app.put(`/api/${name}/:id`, editor, async (req, res) => {
      const r = parse(req.body || {}); if (r.error) return bad(res, r.error);
      const lama = byId(Number(req.params.id));
      if (!lama || !update(Number(req.params.id), r.v)) return res.status(404).json({ error: 'Data tidak ditemukan' });
      catat(req, 'ubah', jenis, desc(r.v));
      const teks = perubahan && req.body?.umumkan !== false ? perubahan(lama, r.v) : null;
      res.json({ ok: true, umum: teks ? await umumkanPerubahan(teks) : null });
    });
    app.delete(`/api/${name}/:id`, editor, (req, res) => {
      const id = Number(req.params.id);
      const lama = byId(id);
      if (!lama) return res.status(404).json({ error: 'Data tidak ditemukan' });
      const ekstra = name === 'tugas' ? { kumpul: db.kumpulTugas(id).filter((a) => a.at).map((a) => ({ akun_id: a.id, at: a.at })) }
        : name === 'prak-tugas' ? { kumpul: db.prakKumpulTugas(id).filter((a) => a.at).map((a) => ({ akun_id: a.id, at: a.at })) } : {};
      if (!del(id)) return res.status(404).json({ error: 'Data tidak ditemukan' });
      const sid = buang(req, jenis, tabel, lama, desc(lama), ekstra);
      res.json({ ok: true, sampah: sid });
    });
  };
  // ---- Mata kuliah ----
  const WARNA = ['biru', 'toska', 'hijau', 'lime', 'kuning', 'oranye', 'merah', 'pink', 'ungu', 'indigo'];
  function matkulBody(b) {
    const nama = str(b.nama).replace(/\s+/g, ' ');
    if (!nama) return { error: 'Nama mata kuliah wajib diisi' };
    if (nama.length > 80) return { error: 'Nama mata kuliah terlalu panjang' };
    const warna = WARNA.includes(b.warna) ? b.warna : null;
    const maks = str(b.maks_bolos) === '' ? null : Number(b.maks_bolos);
    if (maks != null && !(Number.isInteger(maks) && maks >= 0 && maks <= 30)) return { error: 'Batas tidak hadir harus 0–30' };
    // Bobot nilai: baris "Tugas: 30" atau array [{nama, bobot}].
    let bobot = null;
    const mentah = Array.isArray(b.bobot) ? b.bobot : str(b.bobot).split('\n').filter((x) => x.trim()).map((x) => { const m = /^(.+?)[:=\s]+(\d+(?:[.,]\d+)?)\s*%?$/.exec(x.trim()); return m ? { nama: m[1].trim(), bobot: Number(m[2].replace(',', '.')) } : { nama: x, bobot: NaN }; });
    if (mentah.length) {
      if (mentah.some((x) => !str(x.nama) || !(x.bobot > 0))) return { error: 'Format bobot: satu komponen per baris, contoh "UTS: 30"' };
      const total = mentah.reduce((a, x) => a + Number(x.bobot), 0);
      if (Math.abs(total - 100) > 0.01) return { error: `Total bobot nilai harus 100% (sekarang ${total}%)` };
      bobot = JSON.stringify(mentah.slice(0, 10).map((x) => ({ nama: str(x.nama).slice(0, 30), bobot: Number(x.bobot) })));
    }
    return { v: { nama, kode: null, sks: null, dosen: str(b.dosen) || null, catatan: str(b.catatan) || null, warna, kontak: str(b.kontak) || null, maks_bolos: maks, bobot } };
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
    const materi = db.materiByMatkul(lama.id); materi.forEach((x) => db.delMateri(x.id));
    res.json({ ok: true, sampah: buang(req, 'mata kuliah', 'matkul', lama, lama.nama, { materi }) });
  });

  crud('kelas', kelasBody, db.addKelas, db.updateKelas, db.delKelas,
    { jenis: 'jadwal', tabel: 'kelas', byId: db.kelasById, desc: (k) => `${HARI_LABEL[k.hari]} ${k.mulai} ${k.matkul}` });
  crud('tugas', tugasBody, db.addTugas, db.updateTugas, db.delTugas, {
    jenis: 'tugas', tabel: 'tugas', byId: db.tugasById, desc: (t) => `${t.matkul}: ${t.judul}`,
    perubahan: (lama, baru) => (lama.deadline !== baru.deadline && !baru.selesai
      ? `${baru.deadline > lama.deadline ? '⏳' : '⚠️'} *Tenggat tugas ${baru.deadline > lama.deadline ? 'diundur' : 'dimajukan'}*\n\n▸ *${baru.matkul}* — ${baru.judul}\n    Sebelumnya: ~${waktuWa(lama.deadline)}~\n    Sekarang: *${waktuWa(baru.deadline)}*${baru.deadline > lama.deadline ? '' : '\n\nTenggatnya jadi lebih cepat, segera dikerjakan ya!'}` : null),
    // Tugas berulang: buat satu tugas per minggu sampai tanggal tertentu.
    banyak: (v, b) => {
      if (!b.ulang) return [v];
      const sampai = dt(`${str(b.ulang)} 23:59`);
      if (Number.isNaN(sampai) || sampai < v.deadline) return { error: 'Tanggal akhir pengulangan tidak valid' };
      const list = [];
      for (let d = v.deadline; d <= sampai && list.length < 20; d += 7 * 86400000) list.push({ ...v, deadline: d });
      return list.length > 1 ? list.map((x, i) => ({ ...x, judul: `${v.judul} (${i + 1})` })) : list;
    },
  });
  crud('ujian', ujianBody, db.addUjian, db.updateUjian, db.delUjian, {
    jenis: 'ujian', tabel: 'ujian', byId: db.ujianById, desc: (u) => `${u.jenis} ${u.matkul}`,
    perubahan: (lama, baru) => (lama.waktu !== baru.waktu && baru.waktu > Date.now()
      ? `📅 *Jadwal ujian berubah*\n\n▸ *${baru.jenis} ${baru.matkul}*\n    Sebelumnya: ~${waktuWa(lama.waktu)}~\n    Sekarang: *${waktuWa(baru.waktu)}*${baru.ruang ? `\n    📍 ${baru.ruang}` : ''}` : null),
  });
  app.post('/api/tugas/:id/selesai', editor, (req, res) => {
    const t = db.tugasById(Number(req.params.id));
    if (!t || !db.setSelesai(t.id, !!req.body?.selesai)) return res.status(404).json({ error: 'Data tidak ditemukan' });
    catat(req, 'ubah', 'tugas', `${t.matkul}: ${t.judul} ${req.body?.selesai ? 'ditutup (selesai)' : 'dibuka lagi'}`);
    res.json({ ok: true });
  });

  // ---- Praktikum: daftar praktikum, sesi per tanggal, tugas praktikum ----
  const prakBody = (b) => {
    const nama = str(b.nama).replace(/\s+/g, ' ');
    if (!nama) return { error: 'Nama praktikum wajib diisi' };
    if (nama.length > 80) return { error: 'Nama praktikum terlalu panjang' };
    return { v: { nama, lab: str(b.lab) || null, asisten: str(b.asisten) || null, kontak: str(b.kontak) || null, warna: WARNA.includes(b.warna) ? b.warna : null, catatan: str(b.catatan) || null } };
  };
  app.post('/api/praktikum', editor, (req, res) => {
    const r = prakBody(req.body || {}); if (r.error) return bad(res, r.error);
    if (db.praktikumByNama(r.v.nama)) return bad(res, `Praktikum "${r.v.nama}" sudah ada`);
    const id = Number(db.addPraktikum(r.v)); catat(req, 'tambah', 'praktikum', r.v.nama); res.json({ id });
  });
  app.put('/api/praktikum/:id', editor, (req, res) => {
    const id = Number(req.params.id); const r = prakBody(req.body || {}); if (r.error) return bad(res, r.error);
    const lain = db.praktikumByNama(r.v.nama); if (lain && lain.id !== id) return bad(res, `Praktikum "${r.v.nama}" sudah ada`);
    if (!db.updatePraktikum(id, r.v)) return res.status(404).json({ error: 'Data tidak ditemukan' });
    catat(req, 'ubah', 'praktikum', r.v.nama); res.json({ ok: true });
  });
  app.delete('/api/praktikum/:id', editor, (req, res) => {
    const p = db.praktikumById(Number(req.params.id)); if (!p) return res.status(404).json({ error: 'Data tidak ditemukan' });
    const u = db.pakaiPraktikum(p.id);
    if (u.sesi || u.tugas) return res.status(409).json({ error: `Masih dipakai di ${[u.sesi && `${u.sesi} sesi`, u.tugas && `${u.tugas} tugas`].filter(Boolean).join(' dan ')}. Hapus dulu sesi/tugasnya.` });
    db.delPraktikum(p.id); res.json({ ok: true, sampah: buang(req, 'praktikum', 'praktikum', p, p.nama) });
  });
  function prakSesiBody(b) {
    const p = db.praktikumById(Number(b.praktikum_id)); if (!p) return { error: 'Pilih praktikumnya' };
    const judul = str(b.judul).slice(0, 120); if (!judul) return { error: 'Judul/acara praktikum wajib diisi (mis. Modul 1: Mikroskop)' };
    const tanggal = str(b.tanggal); if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal) || Number.isNaN(parseLocal(`${tanggal} 00:00`))) return { error: 'Tanggal tidak valid' };
    const mulai = parseHM(str(b.mulai)); const selesai = str(b.selesai) ? parseHM(str(b.selesai)) : null;
    if (!mulai || (str(b.selesai) && !selesai)) return { error: 'Jam tidak valid' };
    if (selesai && selesai <= mulai) return { error: 'Jam selesai harus setelah jam mulai' };
    return { v: { praktikum_id: p.id, judul, tanggal, mulai, selesai, ruang: str(b.ruang) || null, catatan: str(b.catatan) || null }, p };
  }
  crud('prak-sesi', prakSesiBody, db.addPrakSesi, db.updatePrakSesi, db.delPrakSesi, {
    jenis: 'sesi praktikum', tabel: 'prak_sesi', byId: db.prakSesiById,
    desc: (s) => `${db.praktikumById(s.praktikum_id)?.nama || 'Praktikum'}: ${s.judul} (${s.tanggal})`,
    // Ulangi tiap minggu: buat sesi berikutnya sampai tanggal tertentu, judul diberi nomor pertemuan.
    banyak: (v, b) => {
      if (!b.ulang) return [v];
      const sampai = str(b.ulang); if (!/^\d{4}-\d{2}-\d{2}$/.test(sampai) || sampai < v.tanggal) return { error: 'Tanggal akhir pengulangan tidak valid' };
      const list = []; let d = parseLocal(`${v.tanggal} 12:00`);
      while (ymd(d) <= sampai && list.length < 20) { list.push({ ...v, tanggal: ymd(d) }); d += 7 * 86400000; }
      return list.length > 1 ? list.map((x, i) => ({ ...x, judul: `${v.judul} (pertemuan ${i + 1})` })) : list;
    },
    perubahan: (lama, baru) => (lama.tanggal !== baru.tanggal || lama.mulai !== baru.mulai
      ? `🧪 *Jadwal praktikum berubah*\n\n▸ *${db.praktikumById(baru.praktikum_id)?.nama}* — ${baru.judul}\n    Sebelumnya: ~${tglLabel(lama.tanggal)} · ${lama.mulai.replace(':', '.')}~\n    Sekarang: *${tglLabel(baru.tanggal)} · ${baru.mulai.replace(':', '.')}*${baru.ruang ? `\n    🧪 ${baru.ruang}` : ''}` : null),
  });
  const JENIS_PRAK = ['Laporan', 'Tugas pendahuluan', 'Pretest', 'Posttest', 'Responsi', 'Lainnya'];
  function prakTugasBody(b) {
    const p = db.praktikumById(Number(b.praktikum_id)); if (!p) return { error: 'Pilih praktikumnya' };
    const judul = str(b.judul).slice(0, 160); if (!judul) return { error: 'Judul tugas wajib diisi' };
    const deadline = dt(b.deadline); if (Number.isNaN(deadline)) return { error: 'Tenggat tidak valid' };
    const link = url(b.link); if (link === false) return { error: 'Link harus diawali http:// atau https://' };
    return { v: { praktikum_id: p.id, jenis: JENIS_PRAK.includes(b.jenis) ? b.jenis : 'Laporan', judul, deadline, link, catatan: str(b.catatan) || null, selesai: b.selesai ? 1 : 0 } };
  }
  crud('prak-tugas', prakTugasBody, db.addPrakTugas, db.updatePrakTugas, db.delPrakTugas, {
    jenis: 'tugas praktikum', tabel: 'prak_tugas', byId: (id) => { const t = db.prakTugasById(id); if (t) delete t.praktikum; return t; },
    desc: (t) => `${db.praktikumById(t.praktikum_id)?.nama || 'Praktikum'}: ${t.jenis} ${t.judul}`,
    perubahan: (lama, baru) => (lama.deadline !== baru.deadline && !baru.selesai
      ? `${baru.deadline > lama.deadline ? '⏳' : '⚠️'} *Tenggat tugas praktikum ${baru.deadline > lama.deadline ? 'diundur' : 'dimajukan'}*\n\n▸ *${db.praktikumById(baru.praktikum_id)?.nama}* — ${baru.jenis}: ${baru.judul}\n    Sebelumnya: ~${waktuWa(lama.deadline)}~\n    Sekarang: *${waktuWa(baru.deadline)}*` : null),
  });
  app.post('/api/prak-tugas/:id/kumpul', anyUser, (req, res) => {
    const t = db.prakTugasById(Number(req.params.id)); if (!t) return res.status(404).json({ error: 'Data tidak ditemukan' });
    db.setPrakKumpul(t.id, req.user.id, !!req.body?.kumpul); res.json({ ok: true });
  });
  app.get('/api/prak-tugas/:id/kumpul', anyUser, (req, res) => {
    const t = db.prakTugasById(Number(req.params.id)); if (!t) return res.status(404).json({ error: 'Data tidak ditemukan' });
    const list = db.prakKumpulTugas(t.id);
    res.json({ sudah: list.filter((a) => a.at).map((a) => ({ nama: a.nama, at: a.at })), belum: list.filter((a) => !a.at).map((a) => a.nama) });
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
    const info = infoKumpul(req.user.id)(t);
    if (info.grup) {
      const sudahSet = new Set(list.filter((a) => a.at).map((a) => a.id));
      return res.json({ grup: info.grup.map((g) => ({ nama: g.nama, anggota: g.anggota.map((a) => a.nama), sudah: g.anggota.some((a) => sudahSet.has(a.id)), oleh: g.anggota.filter((a) => sudahSet.has(a.id)).map((a) => a.nama) })) });
    }
    res.json({ sudah: list.filter((a) => a.at).map((a) => ({ nama: a.nama, at: a.at })), belum: list.filter((a) => !a.at).map((a) => a.nama) });
  });
  // Atur kelompok tugas: [{nama, anggota:[akunId]}]
  app.put('/api/tugas/:id/kelompok', editor, (req, res) => {
    const t = db.tugasById(Number(req.params.id));
    if (!t) return res.status(404).json({ error: 'Data tidak ditemukan' });
    const grup = Array.isArray(req.body?.grup) ? req.body.grup : [];
    const valid = new Set(db.akunAll().map((a) => a.id)); const dipakai = new Set();
    const bersih = [];
    for (const [i, g] of grup.slice(0, 60).entries()) {
      const anggota = (Array.isArray(g.anggota) ? g.anggota : []).map(Number).filter((a) => valid.has(a) && !dipakai.has(a));
      anggota.forEach((a) => dipakai.add(a));
      bersih.push({ nama: str(g.nama).slice(0, 40) || `Kelompok ${i + 1}`, anggota });
    }
    db.setKelompok(t.id, bersih);
    if (!t.kelompok && bersih.length) db.updateTugas(t.id, { ...t, kelompok: 1 });
    catat(req, 'ubah', 'kelompok tugas', `${t.matkul}: ${t.judul} (${bersih.length} kelompok)`);
    res.json({ ok: true });
  });

  // ---- Checklist pribadi, nilai, absensi (semua peran, hanya untuk diri sendiri) ----
  app.post('/api/centang', anyUser, (req, res) => {
    const { jenis, ref_id: ref, idx, v } = req.body || {};
    if (!['tugas', 'ujian'].includes(jenis) || !Number.isInteger(ref) || !Number.isInteger(idx) || idx < 0 || idx > 50) return bad(res, 'Data tidak valid');
    db.setCentang(req.user.id, jenis, ref, idx, !!v); res.json({ ok: true });
  });
  app.put('/api/nilai/:mk', anyUser, (req, res) => {
    const mk = db.matkulById(Number(req.params.mk)); if (!mk) return res.status(404).json({ error: 'Data tidak ditemukan' });
    const data = {};
    for (const [k, v] of Object.entries(req.body?.nilai || {}).slice(0, 12)) {
      if (v === '' || v == null) continue;
      const n = Number(v); if (!(n >= 0 && n <= 100)) return bad(res, `Nilai ${k} harus 0–100`);
      data[str(k).slice(0, 30)] = n;
    }
    db.setNilai(req.user.id, mk.id, data); res.json({ ok: true });
  });
  app.post('/api/absen', anyUser, (req, res) => {
    const { tanggal, kelas_key: key, v } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tanggal)) || !/^p?\d+$/.test(String(key))) return bad(res, 'Data tidak valid');
    if (tanggal > ymd(Date.now())) return bad(res, 'Pertemuan ini belum berlangsung');
    db.setAbsen(req.user.id, tanggal, String(key), !!v); res.json({ ok: true });
  });

  // ---- Semester & libur ----
  app.put('/api/semester', editor, (req, res) => {
    const r = validasiSemester(req.body || {}); if (r.error) return bad(res, r.error);
    db.setSetting('semester', r.value);
    catat(req, 'ubah', 'semester & libur', `${r.value.mulai || '?'} s/d ${r.value.selesai || '?'}, ${r.value.libur.length} libur`);
    res.json({ semester: getSemester(db) });
  });

  // ---- Materi per mata kuliah ----
  app.post('/api/materi', editor, (req, res) => {
    const mk = db.matkulById(Number(req.body?.matkul_id)); if (!mk) return bad(res, 'Mata kuliah tidak ditemukan');
    const judul = str(req.body?.judul).slice(0, 100); const u = url(req.body?.url);
    if (!judul) return bad(res, 'Judul materi wajib diisi');
    if (!u) return bad(res, 'Link harus diawali http:// atau https://');
    const id = Number(db.addMateri({ matkul_id: mk.id, judul, url: u }));
    catat(req, 'tambah', 'materi', `${mk.nama}: ${judul}`); res.json({ id });
  });
  app.delete('/api/materi/:id', editor, (req, res) => {
    const m = db.materiById(Number(req.params.id));
    if (!m || !db.delMateri(m.id)) return res.status(404).json({ error: 'Data tidak ditemukan' });
    res.json({ ok: true, sampah: buang(req, 'materi', 'materi', m, m.judul) });
  });

  // ---- Kembalikan data yang terhapus ----
  const TABEL_PULIH = ['kelas', 'tugas', 'ujian', 'matkul', 'kelas_ubah', 'pengumuman', 'materi', 'praktikum', 'prak_sesi', 'prak_tugas'];
  app.post('/api/sampah/:id/pulihkan', editor, (req, res) => {
    const s = db.sampahById(Number(req.params.id));
    if (!s || !TABEL_PULIH.includes(s.jenis)) return res.status(404).json({ error: 'Data sudah tidak bisa dikembalikan' });
    const { row, kumpul = [], materi = [] } = s.data;
    if (s.jenis === 'matkul' && db.matkulByNama(row.nama)) return bad(res, `Mata kuliah "${row.nama}" sudah ada lagi`);
    if (s.jenis === 'praktikum' && db.praktikumByNama(row.nama)) return bad(res, `Praktikum "${row.nama}" sudah ada lagi`);
    if (['prak_sesi', 'prak_tugas'].includes(s.jenis) && !db.praktikumById(row.praktikum_id)) return bad(res, 'Praktikumnya sudah dihapus. Kembalikan praktikumnya dulu.');
    try {
      const id = Number(db.pulihkanBaris(s.jenis, row));
      for (const k of kumpul) if (db.akunById(k.akun_id)) (s.jenis === 'prak_tugas' ? db.setPrakKumpul : db.setKumpul)(id, k.akun_id, true);
      for (const m of materi) db.addMateri({ matkul_id: id, judul: m.judul, url: m.url, dibuat: m.dibuat });
      db.delSampah(s.id);
      catat(req, 'tambah', 'pemulihan', `${s.jenis} dikembalikan: ${row.judul || row.nama || row.matkul || row.teks?.slice(0, 60) || ''}`);
      res.json({ ok: true, id });
    } catch (err) { res.status(409).json({ error: `Gagal mengembalikan: ${err.message}` }); }
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
      teks = `❌ *Kelas dibatalkan*\n\n▸ *${k.matkul}*\n    📅 ${tglLabel(tanggal)} · ${rentangWa(k.mulai, k.selesai)}${catatan ? `\n    📝 ${catatan}` : ''}\n\nJadwal lain tetap seperti biasa.`;
    } else if (b.jenis === 'pengganti') {
      const mulai = parseHM(str(b.mulai)); const selesai = str(b.selesai) ? parseHM(str(b.selesai)) : null;
      if (!mulai || (str(b.selesai) && !selesai)) return bad(res, 'Jam tidak valid');
      if (selesai && selesai <= mulai) return bad(res, 'Jam selesai harus setelah jam mulai');
      if (!str(b.matkul)) return bad(res, 'Mata kuliah wajib diisi');
      v = { tanggal, jenis: 'pengganti', mulai, selesai, matkul: str(b.matkul), ruang: str(b.ruang) || null, dosen: str(b.dosen) || null, catatan };
      teks = `🔁 *Kuliah pengganti*\n\n▸ *${v.matkul}*\n    📅 ${tglLabel(tanggal)} · ${rentangWa(mulai, selesai)}${v.ruang ? `\n    📍 ${v.ruang}` : ''}${v.dosen ? `\n    👤 ${v.dosen}` : ''}${catatan ? `\n    📝 ${catatan}` : ''}\n\nCatat di agendamu ya! 🗓️`;
    } else return bad(res, 'Jenis perubahan tidak dikenal');
    const id = Number(db.addKelasUbah(v));
    catat(req, 'tambah', b.jenis === 'batal' ? 'kelas batal' : 'kuliah pengganti', `${b.jenis === 'batal' ? db.kelasById(v.kelas_id)?.matkul : v.matkul}, ${tanggal}`);
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
    res.json({ ok: true, sampah: buang(req, u.jenis === 'batal' ? 'kelas batal' : 'kuliah pengganti', 'kelas_ubah', u, `${u.tanggal}${u.matkul ? ' ' + u.matkul : ''}`) });
  });

  // ---- Pengumuman ke grup (editor) ----
  app.get('/api/pengumuman', editor, (req, res) => res.json({ pengumuman: db.pengumumanAll() }));
  const fileUpload = (p) => (p && /^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(p) && fs.existsSync(path.join(uploadDir, path.basename(p))) ? p : null);
  const pathUpload = (p) => (p ? path.join(uploadDir, path.basename(p)) : null);
  const pushDiam = (opt) => { Promise.resolve().then(() => push(db, opt)).catch(() => {}); };
  app.post('/api/pengumuman', editor, async (req, res) => {
    const b = req.body || {};
    const teks = str(b.teks);
    if (!teks) return bad(res, 'Isi pengumuman wajib diisi');
    if (teks.length > 3000) return bad(res, 'Pengumuman terlalu panjang (maks. 3000 karakter)');
    const now = Date.now();
    let kirimAt = now;
    if (str(b.kirim_at)) {
      kirimAt = dt(b.kirim_at);
      if (Number.isNaN(kirimAt)) return bad(res, 'Waktu kirim tidak valid');
      if (kirimAt < now - 60000) return bad(res, 'Waktu kirim sudah lewat');
    }
    const hari = Number(b.pin_hari || 0);
    if (!(hari >= 0 && hari <= 60)) return bad(res, 'Lama pin 0–60 hari');
    const webSaja = !!b.web_saja;
    const gambar = b.gambar ? fileUpload(b.gambar) : null;
    if (b.gambar && !gambar) return bad(res, 'Gambar tidak ditemukan, unggah ulang');
    const terjadwal = !webSaja && kirimAt > now + 60000;
    const pinSampai = hari ? Math.max(kirimAt, now) + hari * 86400000 : (webSaja ? now + 7 * 86400000 : null);
    const id = Number(db.addPengumuman({ teks, kirim_at: kirimAt, oleh: req.user.nama, status: webSaja ? 'web' : terjadwal ? 'terjadwal' : 'mengirim', pin_sampai: pinSampai, web_saja: webSaja ? 1 : 0, gambar }));
    catat(req, 'tambah', 'pengumuman', teks.slice(0, 80));
    if (webSaja) { pushDiam({ title: '📌 Pengumuman kelas', body: teks.slice(0, 200), url: '/#dashboard' }); return res.json({ id, status: 'web' }); }
    if (terjadwal) return res.json({ id, status: 'terjadwal' });
    try {
      await bot.send(teksPengumuman({ teks, oleh: req.user.nama }), { gambar: pathUpload(gambar) });
      db.setPengumumanStatus(id, 'terkirim'); db.addLog('pengumuman', 'terkirim', teks.slice(0, 120));
      pushDiam({ title: '📢 Pengumuman kelas', body: teks.slice(0, 200), url: '/#dashboard' });
      res.json({ id, status: 'terkirim' });
    } catch (err) {
      db.setPengumumanStatus(id, 'gagal', err.message); db.addLog('pengumuman', 'gagal', err.message);
      res.status(502).json({ error: `Gagal mengirim: ${err.message}`, id });
    }
  });
  app.put('/api/pengumuman/:id/pin', editor, (req, res) => {
    const p = db.pengumumanById(Number(req.params.id)); if (!p) return res.status(404).json({ error: 'Data tidak ditemukan' });
    const hari = Number(req.body?.hari || 0); if (!(hari >= 0 && hari <= 60)) return bad(res, 'Lama pin 0–60 hari');
    db.setPin(p.id, hari ? Date.now() + hari * 86400000 : null);
    catat(req, 'ubah', 'pengumuman', `${hari ? `Disematkan ${hari} hari` : 'Lepas sematan'}: ${p.teks.slice(0, 60)}`);
    res.json({ ok: true });
  });

  // ---- Unggah gambar (lampiran pengumuman) ----
  app.post('/api/upload', editor, (req, res) => {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data || ''));
    if (!m) return bad(res, 'File harus gambar JPG, PNG, atau WEBP');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 4 * 1024 * 1024) return bad(res, 'Gambar maksimal 4 MB');
    fs.mkdirSync(uploadDir, { recursive: true });
    const name = `${crypto.randomBytes(16).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    fs.writeFileSync(path.join(uploadDir, name), buf);
    res.json({ path: `/uploads/${name}` });
  });

  // ---- Polling WhatsApp (editor) ----
  app.get('/api/polling', editor, (req, res) => res.json({ polling: db.pollingAll() }));
  app.post('/api/polling', editor, async (req, res) => {
    const pertanyaan = str(req.body?.pertanyaan).slice(0, 255);
    const opsi = [...new Set((Array.isArray(req.body?.opsi) ? req.body.opsi : []).map((x) => str(x).slice(0, 100)).filter(Boolean))];
    if (!pertanyaan) return bad(res, 'Pertanyaan wajib diisi');
    if (opsi.length < 2 || opsi.length > 12) return bad(res, 'Pilihan jawaban 2–12');
    const id = Number(db.addPolling({ pertanyaan, opsi, ganda: !!req.body?.ganda, oleh: req.user.nama }));
    catat(req, 'tambah', 'polling', pertanyaan);
    try {
      const sent = await bot.sendPoll(pertanyaan, opsi, !!req.body?.ganda);
      db.setPollingTerkirim(id, sent.id, sent.msg); db.addLog('polling', 'terkirim', pertanyaan.slice(0, 120));
      res.json({ id, status: 'terkirim' });
    } catch (err) {
      db.setPollingStatus(id, 'gagal'); db.addLog('polling', 'gagal', err.message);
      res.status(502).json({ error: `Gagal mengirim polling: ${err.message}`, id });
    }
  });
  app.delete('/api/polling/:id', editor, (req, res) => {
    if (!db.delPolling(Number(req.params.id))) return res.status(404).json({ error: 'Data tidak ditemukan' });
    res.json({ ok: true });
  });

  // ---- Notifikasi push ----
  app.get('/api/push/key', anyUser, (req, res) => res.json({ key: vapid(db).publicKey }));
  app.post('/api/push/sub', anyUser, (req, res) => {
    const s = req.body?.sub;
    if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) return bad(res, 'Langganan tidak valid');
    db.addPushSub(s.endpoint, req.user.id, { endpoint: s.endpoint, keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) } });
    res.json({ ok: true });
  });
  app.delete('/api/push/sub', anyUser, (req, res) => { db.delPushSub(String(req.body?.endpoint || '')); res.json({ ok: true }); });
  app.post('/api/push/tes', anyUser, async (req, res) => {
    const n = await push(db, { akunIds: [req.user.id], title: '🔔 Notifikasi aktif', body: 'Pengingat kelas akan muncul di perangkat ini.', url: '/#dashboard' }).catch(() => 0);
    res.json({ terkirim: n });
  });

  app.delete('/api/pengumuman/:id', editor, (req, res) => {
    const p = db.pengumumanById(Number(req.params.id));
    if (!p || !db.delPengumuman(p.id)) return res.status(404).json({ error: 'Data tidak ditemukan' });
    res.json({ ok: true, sampah: buang(req, 'pengumuman', 'pengumuman', p, p.teks.slice(0, 80)) });
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
    // Contoh pengingat pribadi untuk tugas aktif terdekat.
    const t0 = db.tugasAktif().find((x) => x.deadline > now);
    preview.pribadi = t0 ? `👋 Halo ${req.user.nama}, tugas ini belum kamu tandai sudah dikumpulkan (H-1):\n• [${t0.id}] *${t0.matkul}*: ${t0.judul}\n   ⏰ ${pretty(t0.deadline)}${t0.link ? `\n   📤 Kumpul di: ${t0.link}` : ''}\n\nSudah kumpul? Balas */kumpul ${t0.id}* atau centang di web.`
      : 'Belum ada tugas aktif untuk contoh pengingat pribadi.';
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
      antrean: antrean(db, getSettings(db, cfg), Date.now(), 24),
      harian: db.logHarian(Date.now() - 14 * 86400000),
      push: db.pushSubs().length,
      pesanTerakhir: st.pesanTerakhir || null,
      penjadwal: st.penjadwal || null,
      tujuan: st.tujuan || db.getSetting('tujuan') || { mode: 'grup' },
      catatan: st.catatan || [],
    });
  });
  // Pindah grup tujuan dari web: pilih dari grup yang diikuti bot.
  app.get('/api/status/grup', admin, async (req, res) => {
    try { res.json({ grup: await bot.daftarGrup(), aktif: bot.status().grupJid || null }); }
    catch (err) { res.status(502).json({ error: `Gagal mengambil daftar grup: ${err.message}` }); }
  });
  // Tujuan pesan bot: grup kelas, atau semua dialihkan ke satu nomor pribadi.
  app.get('/api/status/tujuan', admin, (req, res) => {
    res.json({ tujuan: db.getSetting('tujuan') || { mode: 'grup', nomor: null }, saran: db.akunById(req.user.id)?.wa || null });
  });
  app.post('/api/status/tujuan', admin, (req, res) => {
    const mode = req.body?.mode === 'pribadi' ? 'pribadi' : 'grup';
    const lama = db.getSetting('tujuan') || {};
    let nomor = lama.nomor || null;
    if (mode === 'pribadi') {
      nomor = normalWa(req.body?.nomor);
      if (!nomor) return bad(res, 'Nomor WhatsApp tidak valid. Contoh: 081234567890');
    }
    db.setSetting('tujuan', { mode, nomor });
    catat(req, 'ubah', 'tujuan pesan', mode === 'pribadi' ? `Semua pesan bot dialihkan ke +${nomor}` : 'Pesan bot kembali ke grup kelas');
    res.json({ tujuan: { mode, nomor } });
  });
  app.post('/api/status/grup', admin, async (req, res) => {
    const jid = String(req.body?.jid || '');
    if (!/^[\d-]+@g\.us$/.test(jid)) return bad(res, 'Grup tidak valid');
    try { await bot.pakaiGrup(jid); } catch (err) { return res.status(502).json({ error: err.message }); }
    catat(req, 'ubah', 'grup tujuan', jid);
    res.json({ ok: true });
  });
  app.post('/api/status/tes', admin, async (req, res) => {
    try {
      await bot.send(`🧪 *Pesan percobaan*\n\nBot pengingat kuliah aktif dan bisa mengirim pesan ke chat ini ✅\n\n— _dikirim dari web oleh ${req.user.nama}_`);
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
  // Pulihkan backup: file disiapkan, lalu bot restart (pm2) dan memakai database dari backup.
  app.post('/api/backup/:name/pulihkan', admin, async (req, res) => {
    const name = String(req.params.name);
    if (!NAME_RE.test(name) || !listBackups(backupDir).some((b) => b.name === name)) return res.status(404).json({ error: 'Backup tidak ditemukan' });
    if (!onRestore) return bad(res, 'Pemulihan hanya bisa dari server yang berjalan');
    try {
      await backupNow(db, { dir: backupDir, keep: (cfg?.backupKeep || 14) + 1 }); // simpan kondisi sekarang dulu
      catat(req, 'ubah', 'database', `Dipulihkan dari backup ${name}`);
      res.json({ ok: true });
      setTimeout(() => onRestore(path.join(backupDir, name)), 300);
    } catch (err) { res.status(500).json({ error: `Gagal: ${err.message}` }); }
  });
  app.get('/api/backup/:name', admin, (req, res) => {
    const name = String(req.params.name);
    if (!NAME_RE.test(name) || !listBackups(backupDir).some((b) => b.name === name)) return res.status(404).json({ error: 'Backup tidak ditemukan' });
    res.download(path.join(backupDir, name), name);
  });

  // ---- Kelola akun (admin) ----
  app.get('/api/akun', admin, (req, res) => res.json({ akun: db.akunAll(), undangan: db.getSetting('undangan') || null }));
  // Foto profil (semua anggota boleh melihat foto teman sekelas).
  app.get('/api/akun/:id/foto', anyUser, (req, res) => {
    const a = db.akunById(Number(req.params.id));
    const m = a?.foto && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(a.foto);
    if (!m) return res.status(404).end();
    res.set({ 'Content-Type': m[1], 'Cache-Control': 'private, max-age=300' }).send(Buffer.from(m[2], 'base64'));
  });
  // Username otomatis dari nama: "Siti Rahma" → "siti.rahma", ditambah angka kalau sudah dipakai.
  const usernameDari = (nama) => {
    const base = nama.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s.]/g, '').trim().split(/\s+/).slice(0, 2).join('.').slice(0, 24) || 'anggota';
    let u = base.length >= 3 ? base : `${base}.kelas`; let i = 2;
    while (db.akunByUsername(u)) u = `${base}${i++}`;
    return u;
  };
  // Tambah banyak anggota sekaligus: satu baris "Nama, nomor WA".
  app.post('/api/akun/massal', admin, async (req, res) => {
    const baris = str(req.body?.teks).split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 200);
    if (!baris.length) return bad(res, 'Tempel daftar anggota dulu');
    const role = ROLES.includes(req.body?.role) ? req.body.role : 'viewer';
    const dibuat = []; const gagal = [];
    for (const l of baris) {
      const [namaRaw, waRaw] = l.split(/[,;\t|]/).map((x) => x.trim());
      const nama = (namaRaw || '').replace(/\s+/g, ' ');
      if (!nama) { gagal.push(`${l}: nama kosong`); continue; }
      let wa = null;
      if (waRaw) {
        wa = normalWa(waRaw);
        if (!wa) { gagal.push(`${nama}: nomor tidak valid`); continue; }
        const lain = db.akunByWa(wa); if (lain) { gagal.push(`${nama}: nomor sudah dipakai ${lain.nama}`); continue; }
      }
      const username = usernameDari(nama);
      const id = Number(db.addAkun({ username, nama, role, hash: hashPassword(crypto.randomBytes(18).toString('base64url')) }));
      if (wa) db.setAkunWa(id, wa);
      dibuat.push({ id, nama, username, wa });
    }
    if (dibuat.length) catat(req, 'tambah', 'akun', `${dibuat.length} anggota ditambahkan sekaligus`);
    // Pesan sambutan lewat WA berisi cara masuk.
    let disapa = 0;
    if (req.body?.sambutan) {
      const base = (process.env.WEB_URL || '').replace(/\/+$/, '');
      for (const a of dibuat.filter((x) => x.wa)) {
        try {
          await bot.sendTo(a.wa, `👋 Halo ${a.nama}! Kamu sudah didaftarkan di web kelas *Six Seven 67*${base ? ` (${base})` : ''}.\n\nCara masuk: balas pesan ini dengan *login*, nanti bot mengirim link masuk.`);
          disapa++;
          await new Promise((r) => setTimeout(r, 1200));
        } catch { /* lanjut ke anggota berikutnya */ }
      }
    }
    res.json({ dibuat, gagal, disapa });
  });
  app.post('/api/akun/:id/setujui', admin, (req, res) => {
    const a = db.akunById(Number(req.params.id));
    if (!a || a.status !== 'pending') return res.status(404).json({ error: 'Pendaftaran tidak ditemukan' });
    db.setAkunStatus(a.id, 'aktif'); catat(req, 'ubah', 'akun', `Pendaftaran ${a.nama} disetujui`);
    if (a.wa) bot.sendTo(a.wa, `✅ Halo ${a.nama}, pendaftaranmu di web kelas sudah disetujui. Silakan masuk dengan username *${a.username}*.`).catch(() => {});
    res.json({ ok: true });
  });
  // Link undangan: anggota mendaftar sendiri, admin menyetujui.
  app.post('/api/undangan', admin, (req, res) => {
    const aktif = req.body?.aktif !== false;
    const u = aktif ? { kode: crypto.randomBytes(9).toString('base64url'), dibuat: Date.now() } : null;
    db.setSetting('undangan', u);
    catat(req, 'ubah', 'undangan', aktif ? 'Link undangan baru dibuat' : 'Link undangan dimatikan');
    res.json({ undangan: u });
  });
  app.get('/api/daftar/:kode', (req, res) => {
    const u = db.getSetting('undangan');
    res.json({ valid: !!(u && u.kode === req.params.kode) });
  });
  const daftarAttempts = new Map();
  app.post('/api/daftar', (req, res) => {
    const u = db.getSetting('undangan'); const b = req.body || {};
    if (!u || b.kode !== u.kode) return res.status(403).json({ error: 'Link undangan tidak berlaku. Minta link baru ke admin kelas.' });
    const now = Date.now(); const a = (daftarAttempts.get(req.ip) || []).filter((t) => now - t < 3600000);
    if (a.length >= 5) return res.status(429).json({ error: 'Terlalu banyak pendaftaran dari perangkat ini. Coba lagi nanti.' });
    const nama = str(b.nama).replace(/\s+/g, ' '); const username = str(b.username).toLowerCase(); const pw = String(b.password || '');
    if (!nama) return bad(res, 'Nama wajib diisi');
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return bad(res, 'Username 3–32 karakter: huruf kecil, angka, titik, minus');
    if (db.akunByUsername(username)) return bad(res, 'Username sudah dipakai');
    if (pw.length < 8) return bad(res, 'Password minimal 8 karakter');
    let wa = null;
    if (str(b.wa)) { wa = normalWa(b.wa); if (!wa) return bad(res, 'Nomor WhatsApp tidak valid'); if (db.akunByWa(wa)) return bad(res, 'Nomor ini sudah terdaftar'); }
    daftarAttempts.set(req.ip, [...a, now]);
    const id = Number(db.addAkun({ username, nama, role: 'viewer', hash: hashPassword(pw), status: 'pending' }));
    if (wa) db.setAkunWa(id, wa);
    db.addRiwayat(nama, 'tambah', 'pendaftaran', `@${username} mendaftar lewat link undangan`);
    for (const ad of db.adminWa()) bot.sendTo(ad.wa, `🆕 *Pendaftaran baru*\n${nama} (@${username}) menunggu persetujuan di menu Management Akun.`).catch(() => {});
    res.json({ ok: true });
  });
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
