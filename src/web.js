// Web UI + REST API untuk kelola jadwal, tugas, dan ujian.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { parseLocal, fmtLocal, parseHM } = require('./time');

function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function makeToken(secret, days = 30) {
  const exp = String(Date.now() + days * 86400000);
  return `${exp}.${sign(secret, exp)}`;
}

function validToken(secret, token = '') {
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(secret, exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}

const cookie = (req, name) => (req.headers.cookie || '').split(';').map((c) => c.trim().split('='))
  .find(([k]) => k === name)?.[1];

function createWeb(db, { password, publicView = false, getStatus = () => ({}) }) {
  if (!password) throw new Error('ADMIN_PASSWORD wajib diisi untuk web UI');
  const secret = sign(password, 'wa-pengingat-kuliah');
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const authed = (req) => validToken(secret, cookie(req, 'sesi'));
  const requireAuth = (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: 'Silakan login dulu' }));

  // Batasi percobaan login: 10 kali per 15 menit per IP
  const attempts = new Map();
  app.post('/api/login', (req, res) => {
    const ip = req.ip; const now = Date.now();
    const a = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60000);
    if (a.length >= 10) return res.status(429).json({ error: 'Terlalu banyak percobaan, coba lagi nanti' });
    const pw = String(req.body?.password || '');
    const ok = pw.length === password.length && crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(password));
    if (!ok) { attempts.set(ip, [...a, now]); return res.status(401).json({ error: 'Password salah' }); }
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sesi=${makeToken(secret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86400}${secure}`);
    res.json({ ok: true });
  });
  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'sesi=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => res.json({ admin: authed(req), publicView }));

  const out = {
    tugas: (t) => ({ ...t, deadline: fmtLocal(t.deadline), ms: t.deadline, selesai: !!t.selesai }),
    ujian: (u) => ({ ...u, waktu: fmtLocal(u.waktu), ms: u.waktu }),
  };

  app.get('/api/data', (req, res) => {
    if (!publicView && !authed(req)) return res.status(401).json({ error: 'Silakan login dulu' });
    res.json({
      kelas: db.kelasAll(),
      tugas: db.tugasAll().map(out.tugas),
      ujian: db.ujianAll().map(out.ujian),
      status: getStatus(),
    });
  });

  const bad = (res, msg) => res.status(400).json({ error: msg });
  const str = (v) => (v == null ? '' : String(v).trim());
  const dt = (v) => parseLocal(str(v).replace('T', ' ').slice(0, 16));

  function kelasBody(b) {
    const hari = Number(b.hari);
    const mulai = parseHM(str(b.mulai));
    const selesai = str(b.selesai) ? parseHM(str(b.selesai)) : null;
    if (!(hari >= 0 && hari <= 6)) return { error: 'Hari tidak valid' };
    if (!mulai || (str(b.selesai) && !selesai)) return { error: 'Jam tidak valid' };
    if (!str(b.matkul)) return { error: 'Mata kuliah wajib diisi' };
    return { v: { hari, mulai, selesai, matkul: str(b.matkul), ruang: str(b.ruang) || null, dosen: str(b.dosen) || null } };
  }
  function tugasBody(b) {
    const deadline = dt(b.deadline);
    if (!str(b.matkul) || !str(b.judul)) return { error: 'Mata kuliah dan judul wajib diisi' };
    if (Number.isNaN(deadline)) return { error: 'Deadline tidak valid' };
    return { v: { matkul: str(b.matkul), judul: str(b.judul), deadline, selesai: b.selesai ? 1 : 0 } };
  }
  function ujianBody(b) {
    const waktu = dt(b.waktu);
    if (!str(b.matkul) || !str(b.jenis)) return { error: 'Mata kuliah dan jenis wajib diisi' };
    if (Number.isNaN(waktu)) return { error: 'Waktu tidak valid' };
    return { v: { matkul: str(b.matkul), jenis: str(b.jenis), waktu, ruang: str(b.ruang) || null } };
  }

  const crud = (name, parse, add, update, del) => {
    app.post(`/api/${name}`, requireAuth, (req, res) => {
      const r = parse(req.body || {}); if (r.error) return bad(res, r.error);
      res.json({ id: Number(add(r.v)) });
    });
    app.put(`/api/${name}/:id`, requireAuth, (req, res) => {
      const r = parse(req.body || {}); if (r.error) return bad(res, r.error);
      if (!update(Number(req.params.id), r.v)) return res.status(404).json({ error: 'Tidak ditemukan' });
      res.json({ ok: true });
    });
    app.delete(`/api/${name}/:id`, requireAuth, (req, res) => {
      if (!del(Number(req.params.id))) return res.status(404).json({ error: 'Tidak ditemukan' });
      res.json({ ok: true });
    });
  };
  crud('kelas', kelasBody, db.addKelas, db.updateKelas, db.delKelas);
  crud('tugas', tugasBody, db.addTugas, db.updateTugas, db.delTugas);
  crud('ujian', ujianBody, db.addUjian, db.updateUjian, db.delUjian);

  return app;
}

module.exports = { createWeb, makeToken, validToken };
