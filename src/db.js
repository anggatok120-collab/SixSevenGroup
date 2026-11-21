const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function openDb(file = path.join(__dirname, '..', 'data', 'kuliah.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS kelas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hari INTEGER NOT NULL,          -- 0=Minggu .. 6=Sabtu
      mulai TEXT NOT NULL,            -- HH:mm
      selesai TEXT,                   -- HH:mm
      matkul TEXT NOT NULL,
      ruang TEXT,
      dosen TEXT
    );
    CREATE TABLE IF NOT EXISTS tugas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matkul TEXT NOT NULL,
      judul TEXT NOT NULL,
      deadline INTEGER NOT NULL,      -- epoch ms
      selesai INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS ujian (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matkul TEXT NOT NULL,
      jenis TEXT NOT NULL,            -- UTS / UAS / Kuis
      waktu INTEGER NOT NULL,         -- epoch ms
      ruang TEXT
    );
    CREATE TABLE IF NOT EXISTS terkirim (
      kunci TEXT PRIMARY KEY,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS akun (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      nama TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',   -- admin | editor | viewer
      hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pengaturan (
      kunci TEXT PRIMARY KEY,
      nilai TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_link (
      hash TEXT PRIMARY KEY,          -- sha256 token, token aslinya tidak disimpan
      akun_id INTEGER NOT NULL,
      dibuat INTEGER NOT NULL,
      exp INTEGER NOT NULL,
      dipakai INTEGER
    );
    CREATE TABLE IF NOT EXISTS log_kirim (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,           -- terkirim | gagal
      detail TEXT
    );
  `);
  // Migrasi kolom baru untuk database lama
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  if (!cols('tugas').includes('prioritas')) db.exec("ALTER TABLE tugas ADD COLUMN prioritas TEXT NOT NULL DEFAULT 'normal'");
  if (!cols('tugas').includes('catatan')) db.exec('ALTER TABLE tugas ADD COLUMN catatan TEXT');
  if (!cols('akun').includes('wa')) db.exec('ALTER TABLE akun ADD COLUMN wa TEXT');

  const one = (sql) => db.prepare(sql);
  return {
    raw: db,
    kelasAll: () => one('SELECT * FROM kelas ORDER BY hari, mulai').all(),
    kelasByHari: (h) => one('SELECT * FROM kelas WHERE hari = ? ORDER BY mulai').all(h),
    addKelas: (k) => one('INSERT INTO kelas (hari, mulai, selesai, matkul, ruang, dosen) VALUES (@hari, @mulai, @selesai, @matkul, @ruang, @dosen)').run(k).lastInsertRowid,
    updateKelas: (id, k) => one('UPDATE kelas SET hari=@hari, mulai=@mulai, selesai=@selesai, matkul=@matkul, ruang=@ruang, dosen=@dosen WHERE id=@id').run({ ...k, id }).changes,
    delKelas: (id) => one('DELETE FROM kelas WHERE id = ?').run(id).changes,

    tugasAktif: () => one('SELECT * FROM tugas WHERE selesai = 0 ORDER BY deadline').all(),
    tugasAll: () => one('SELECT * FROM tugas ORDER BY selesai, deadline').all(),
    addTugas: (t) => one("INSERT INTO tugas (matkul, judul, deadline, prioritas, catatan) VALUES (@matkul, @judul, @deadline, @prioritas, @catatan)")
      .run({ prioritas: 'normal', catatan: null, ...t }).lastInsertRowid,
    updateTugas: (id, t) => one('UPDATE tugas SET matkul=@matkul, judul=@judul, deadline=@deadline, selesai=@selesai, prioritas=@prioritas, catatan=@catatan WHERE id=@id')
      .run({ prioritas: 'normal', catatan: null, selesai: 0, ...t, id }).changes,
    setSelesai: (id, v) => one('UPDATE tugas SET selesai = ? WHERE id = ?').run(v ? 1 : 0, id).changes,
    selesaiTugas: (id) => one('UPDATE tugas SET selesai = 1 WHERE id = ?').run(id).changes,
    delTugas: (id) => one('DELETE FROM tugas WHERE id = ?').run(id).changes,

    ujianAll: () => one('SELECT * FROM ujian ORDER BY waktu').all(),
    ujianMendatang: (now) => one('SELECT * FROM ujian WHERE waktu >= ? ORDER BY waktu').all(now),
    addUjian: (u) => one('INSERT INTO ujian (matkul, jenis, waktu, ruang) VALUES (@matkul, @jenis, @waktu, @ruang)').run(u).lastInsertRowid,
    updateUjian: (id, u) => one('UPDATE ujian SET matkul=@matkul, jenis=@jenis, waktu=@waktu, ruang=@ruang WHERE id=@id').run({ ...u, id }).changes,
    delUjian: (id) => one('DELETE FROM ujian WHERE id = ?').run(id).changes,

    sudahTerkirim: (k) => !!one('SELECT 1 FROM terkirim WHERE kunci = ?').get(k),
    tandaiTerkirim: (k) => one('INSERT OR IGNORE INTO terkirim (kunci, at) VALUES (?, ?)').run(k, Date.now()),
    bersihkanTerkirim: (before) => one('DELETE FROM terkirim WHERE at < ?').run(before),

    akunAll: () => one('SELECT id, username, nama, role, wa FROM akun ORDER BY role, nama').all(),
    akunByWa: (wa) => (wa ? one('SELECT * FROM akun WHERE wa = ?').get(wa) : undefined),
    setAkunWa: (id, wa) => one('UPDATE akun SET wa = ? WHERE id = ?').run(wa || null, id).changes,

    addLoginLink: (l) => one('INSERT INTO login_link (hash, akun_id, dibuat, exp) VALUES (@hash, @akun_id, @dibuat, @exp)').run(l),
    loginLinkCount: (akunId, since) => one('SELECT COUNT(*) n FROM login_link WHERE akun_id = ? AND dibuat > ?').get(akunId, since).n,
    pakaiLoginLink: (hash, now) => {
      const r = one('UPDATE login_link SET dipakai = ? WHERE hash = ? AND dipakai IS NULL AND exp > ?').run(now, hash, now);
      return r.changes ? one('SELECT * FROM login_link WHERE hash = ?').get(hash) : null;
    },
    bersihkanLoginLink: (now) => one('DELETE FROM login_link WHERE exp < ?').run(now - 86400000),
    akunCount: () => one('SELECT COUNT(*) n FROM akun').get().n,
    akunById: (id) => one('SELECT * FROM akun WHERE id = ?').get(id),
    akunByUsername: (u) => one('SELECT * FROM akun WHERE username = ?').get(u),
    addAkun: (a) => one('INSERT INTO akun (username, nama, role, hash) VALUES (@username, @nama, @role, @hash)').run(a).lastInsertRowid,
    updateAkun: (id, { nama, role, hash }) => (hash
      ? one('UPDATE akun SET nama=@nama, role=@role, hash=@hash WHERE id=@id').run({ nama, role, hash, id })
      : one('UPDATE akun SET nama=@nama, role=@role WHERE id=@id').run({ nama, role, id })).changes,
    delAkun: (id) => one('DELETE FROM akun WHERE id = ?').run(id).changes,
    adminCount: () => one("SELECT COUNT(*) n FROM akun WHERE role = 'admin'").get().n,

    getSetting: (k) => { const r = one('SELECT nilai FROM pengaturan WHERE kunci = ?').get(k); return r ? JSON.parse(r.nilai) : undefined; },
    setSetting: (k, v) => one('INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?) ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai').run(k, JSON.stringify(v)),

    addLog: (mode, status, detail = null) => {
      one('INSERT INTO log_kirim (at, mode, status, detail) VALUES (?, ?, ?, ?)').run(Date.now(), mode, status, detail);
      one('DELETE FROM log_kirim WHERE id NOT IN (SELECT id FROM log_kirim ORDER BY id DESC LIMIT 200)').run();
    },
    logTerbaru: (n = 30) => one('SELECT * FROM log_kirim ORDER BY id DESC LIMIT ?').all(n),
    logGagal24: () => one("SELECT COUNT(*) n FROM log_kirim WHERE status = 'gagal' AND at > ?").get(Date.now() - 86400000).n,
  };
}

module.exports = { openDb };
