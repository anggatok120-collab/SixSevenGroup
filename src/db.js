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
  `);

  return {
    raw: db,
    kelasAll: () => db.prepare('SELECT * FROM kelas ORDER BY hari, mulai').all(),
    kelasByHari: (h) => db.prepare('SELECT * FROM kelas WHERE hari = ? ORDER BY mulai').all(h),
    addKelas: (k) => db.prepare('INSERT INTO kelas (hari, mulai, selesai, matkul, ruang, dosen) VALUES (@hari, @mulai, @selesai, @matkul, @ruang, @dosen)').run(k).lastInsertRowid,
    delKelas: (id) => db.prepare('DELETE FROM kelas WHERE id = ?').run(id).changes,

    tugasAktif: () => db.prepare('SELECT * FROM tugas WHERE selesai = 0 ORDER BY deadline').all(),
    addTugas: (t) => db.prepare('INSERT INTO tugas (matkul, judul, deadline) VALUES (@matkul, @judul, @deadline)').run(t).lastInsertRowid,
    selesaiTugas: (id) => db.prepare('UPDATE tugas SET selesai = 1 WHERE id = ?').run(id).changes,
    delTugas: (id) => db.prepare('DELETE FROM tugas WHERE id = ?').run(id).changes,

    ujianMendatang: (now) => db.prepare('SELECT * FROM ujian WHERE waktu >= ? ORDER BY waktu').all(now),
    addUjian: (u) => db.prepare('INSERT INTO ujian (matkul, jenis, waktu, ruang) VALUES (@matkul, @jenis, @waktu, @ruang)').run(u).lastInsertRowid,
    delUjian: (id) => db.prepare('DELETE FROM ujian WHERE id = ?').run(id).changes,

    tugasAll: () => db.prepare('SELECT * FROM tugas ORDER BY selesai, deadline').all(),
    ujianAll: () => db.prepare('SELECT * FROM ujian ORDER BY waktu').all(),
    updateKelas: (id, k) => db.prepare('UPDATE kelas SET hari=@hari, mulai=@mulai, selesai=@selesai, matkul=@matkul, ruang=@ruang, dosen=@dosen WHERE id=@id').run({ ...k, id }).changes,
    updateTugas: (id, t) => db.prepare('UPDATE tugas SET matkul=@matkul, judul=@judul, deadline=@deadline, selesai=@selesai WHERE id=@id').run({ ...t, id }).changes,
    updateUjian: (id, u) => db.prepare('UPDATE ujian SET matkul=@matkul, jenis=@jenis, waktu=@waktu, ruang=@ruang WHERE id=@id').run({ ...u, id }).changes,

    sudahTerkirim: (k) => !!db.prepare('SELECT 1 FROM terkirim WHERE kunci = ?').get(k),
    tandaiTerkirim: (k) => db.prepare('INSERT OR IGNORE INTO terkirim (kunci, at) VALUES (?, ?)').run(k, Date.now()),
    bersihkanTerkirim: (before) => db.prepare('DELETE FROM terkirim WHERE at < ?').run(before),
  };
}

module.exports = { openDb };
