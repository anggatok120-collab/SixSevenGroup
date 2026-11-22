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
    CREATE TABLE IF NOT EXISTS kelas_ubah (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT NOT NULL,          -- YYYY-MM-DD lokal
      jenis TEXT NOT NULL,            -- batal | pengganti
      kelas_id INTEGER,               -- kelas rutin yang dibatalkan
      mulai TEXT, selesai TEXT, matkul TEXT, ruang TEXT, dosen TEXT,
      catatan TEXT
    );
    CREATE TABLE IF NOT EXISTS tugas_kumpul (
      tugas_id INTEGER NOT NULL,
      akun_id INTEGER NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (tugas_id, akun_id)
    );
    CREATE TABLE IF NOT EXISTS pengumuman (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teks TEXT NOT NULL,
      kirim_at INTEGER NOT NULL,      -- epoch ms
      status TEXT NOT NULL DEFAULT 'terjadwal',  -- terjadwal | terkirim | gagal | kedaluwarsa
      oleh TEXT,
      dibuat INTEGER NOT NULL,
      dikirim INTEGER,
      detail TEXT
    );
    CREATE TABLE IF NOT EXISTS riwayat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      oleh TEXT NOT NULL,
      aksi TEXT NOT NULL,             -- tambah | ubah | hapus | lainnya
      jenis TEXT NOT NULL,
      ringkas TEXT
    );
    CREATE TABLE IF NOT EXISTS log_kirim (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,           -- terkirim | gagal
      detail TEXT
    );
  `);
  // Daftar mata kuliah. Jadwal/tugas/ujian tetap menyimpan nama mata kuliah sebagai teks.
  const adaMatkul = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='matkul'").get();
  db.exec(`
    CREATE TABLE IF NOT EXISTS matkul (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL UNIQUE COLLATE NOCASE,
      kode TEXT,
      sks INTEGER,
      dosen TEXT,
      catatan TEXT
    );
  `);
  if (!adaMatkul) {
    // Database lama: isi daftar dari nama mata kuliah yang sudah dipakai.
    db.exec(`
      INSERT OR IGNORE INTO matkul (nama)
        SELECT matkul FROM kelas UNION SELECT matkul FROM tugas UNION SELECT matkul FROM ujian;
      UPDATE matkul SET dosen = (SELECT k.dosen FROM kelas k WHERE k.matkul = matkul.nama COLLATE NOCASE AND k.dosen IS NOT NULL ORDER BY k.id LIMIT 1);
    `);
  }
  // Migrasi kolom baru untuk database lama
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  if (!cols('tugas').includes('prioritas')) db.exec("ALTER TABLE tugas ADD COLUMN prioritas TEXT NOT NULL DEFAULT 'normal'");
  if (!cols('tugas').includes('catatan')) db.exec('ALTER TABLE tugas ADD COLUMN catatan TEXT');
  if (!cols('akun').includes('wa')) db.exec('ALTER TABLE akun ADD COLUMN wa TEXT');
  if (!cols('matkul').includes('warna')) db.exec('ALTER TABLE matkul ADD COLUMN warna TEXT');

  const one = (sql) => db.prepare(sql);
  // Pakai penulisan nama yang sudah terdaftar; nama baru otomatis didaftarkan.
  const canon = (nama, dosen = null) => {
    const ada = one('SELECT nama FROM matkul WHERE nama = ?').get(nama);
    if (ada) return ada.nama;
    one('INSERT INTO matkul (nama, dosen) VALUES (?, ?)').run(nama, dosen || null);
    return nama;
  };
  const ada = (t, id) => !!one(`SELECT 1 FROM ${t} WHERE id = ?`).get(id);
  const withMk = (x) => ({ ...x, matkul: canon(x.matkul, x.dosen) });
  const pakaiMatkul = (nama) => one(`SELECT
      (SELECT COUNT(*) FROM kelas WHERE matkul = @n COLLATE NOCASE) jadwal,
      (SELECT COUNT(*) FROM tugas WHERE matkul = @n COLLATE NOCASE) tugas,
      (SELECT COUNT(*) FROM ujian WHERE matkul = @n COLLATE NOCASE) ujian`).get({ n: nama });
  return {
    raw: db,
    matkulAll: () => one('SELECT * FROM matkul ORDER BY nama COLLATE NOCASE').all().map((m) => ({ ...m, pakai: pakaiMatkul(m.nama) })),
    matkulById: (id) => one('SELECT * FROM matkul WHERE id = ?').get(id),
    matkulByNama: (n) => one('SELECT * FROM matkul WHERE nama = ?').get(n),
    addMatkul: (m) => one('INSERT INTO matkul (nama, kode, sks, dosen, catatan, warna) VALUES (@nama, @kode, @sks, @dosen, @catatan, @warna)').run({ warna: null, ...m }).lastInsertRowid,
    // Ganti nama ikut mengubah jadwal, tugas, dan ujian yang memakai nama lama.
    updateMatkul: db.transaction((id, m) => {
      const lama = one('SELECT nama FROM matkul WHERE id = ?').get(id);
      if (!lama) return 0;
      one('UPDATE matkul SET nama=@nama, kode=@kode, sks=@sks, dosen=@dosen, catatan=@catatan, warna=@warna WHERE id=@id').run({ warna: null, ...m, id });
      if (lama.nama !== m.nama) for (const t of ['kelas', 'tugas', 'ujian', 'kelas_ubah']) one(`UPDATE ${t} SET matkul = ? WHERE matkul = ? COLLATE NOCASE`).run(m.nama, lama.nama);
      return 1;
    }),
    delMatkul: (id) => {
      const m = one('SELECT nama FROM matkul WHERE id = ?').get(id);
      if (!m) return { changes: 0 };
      const p = pakaiMatkul(m.nama);
      if (p.jadwal + p.tugas + p.ujian) return { changes: 0, pakai: p };
      return { changes: one('DELETE FROM matkul WHERE id = ?').run(id).changes };
    },
    kelasAll: () => one('SELECT * FROM kelas ORDER BY hari, mulai').all(),
    kelasByHari: (h) => one('SELECT * FROM kelas WHERE hari = ? ORDER BY mulai').all(h),
    addKelas: (k) => one('INSERT INTO kelas (hari, mulai, selesai, matkul, ruang, dosen) VALUES (@hari, @mulai, @selesai, @matkul, @ruang, @dosen)').run(withMk(k)).lastInsertRowid,
    // Cek dulu datanya ada, supaya id yang salah tidak ikut mendaftarkan mata kuliah baru.
    updateKelas: (id, k) => ada('kelas', id) && one('UPDATE kelas SET hari=@hari, mulai=@mulai, selesai=@selesai, matkul=@matkul, ruang=@ruang, dosen=@dosen WHERE id=@id').run({ ...withMk(k), id }).changes,
    delKelas: db.transaction((id) => {
      one("DELETE FROM kelas_ubah WHERE kelas_id = ? AND jenis = 'batal'").run(id);
      return one('DELETE FROM kelas WHERE id = ?').run(id).changes;
    }),
    kelasById: (id) => one('SELECT * FROM kelas WHERE id = ?').get(id),

    // Kelas batal / kuliah pengganti untuk tanggal tertentu
    kelasUbahAll: () => one('SELECT * FROM kelas_ubah ORDER BY tanggal, mulai').all(),
    kelasUbahTanggal: (tgl) => one('SELECT * FROM kelas_ubah WHERE tanggal = ? ORDER BY mulai').all(tgl),
    kelasUbahById: (id) => one('SELECT * FROM kelas_ubah WHERE id = ?').get(id),
    addKelasUbah: (u) => one(`INSERT INTO kelas_ubah (tanggal, jenis, kelas_id, mulai, selesai, matkul, ruang, dosen, catatan)
      VALUES (@tanggal, @jenis, @kelas_id, @mulai, @selesai, @matkul, @ruang, @dosen, @catatan)`)
      .run({ kelas_id: null, mulai: null, selesai: null, ruang: null, dosen: null, catatan: null, ...u, matkul: u.matkul ? canon(u.matkul, u.dosen) : null }).lastInsertRowid,
    delKelasUbah: (id) => one('DELETE FROM kelas_ubah WHERE id = ?').run(id).changes,
    bersihkanKelasUbah: (sebelumTgl) => one('DELETE FROM kelas_ubah WHERE tanggal < ?').run(sebelumTgl),

    tugasAktif: () => one('SELECT * FROM tugas WHERE selesai = 0 ORDER BY deadline').all(),
    tugasAll: () => one('SELECT * FROM tugas ORDER BY selesai, deadline').all(),
    addTugas: (t) => one("INSERT INTO tugas (matkul, judul, deadline, prioritas, catatan) VALUES (@matkul, @judul, @deadline, @prioritas, @catatan)")
      .run({ prioritas: 'normal', catatan: null, ...withMk(t) }).lastInsertRowid,
    updateTugas: (id, t) => ada('tugas', id) && one('UPDATE tugas SET matkul=@matkul, judul=@judul, deadline=@deadline, selesai=@selesai, prioritas=@prioritas, catatan=@catatan WHERE id=@id')
      .run({ prioritas: 'normal', catatan: null, selesai: 0, ...withMk(t), id }).changes,
    setSelesai: (id, v) => one('UPDATE tugas SET selesai = ? WHERE id = ?').run(v ? 1 : 0, id).changes,
    selesaiTugas: (id) => one('UPDATE tugas SET selesai = 1 WHERE id = ?').run(id).changes,
    delTugas: db.transaction((id) => {
      one('DELETE FROM tugas_kumpul WHERE tugas_id = ?').run(id);
      return one('DELETE FROM tugas WHERE id = ?').run(id).changes;
    }),
    tugasById: (id) => one('SELECT * FROM tugas WHERE id = ?').get(id),

    // Status "sudah kumpul" per anggota
    setKumpul: (tugasId, akunId, v) => (v
      ? one('INSERT OR IGNORE INTO tugas_kumpul (tugas_id, akun_id, at) VALUES (?, ?, ?)').run(tugasId, akunId, Date.now())
      : one('DELETE FROM tugas_kumpul WHERE tugas_id = ? AND akun_id = ?').run(tugasId, akunId)),
    sudahKumpul: (tugasId, akunId) => !!one('SELECT 1 FROM tugas_kumpul WHERE tugas_id = ? AND akun_id = ?').get(tugasId, akunId),
    kumpulCount: () => Object.fromEntries(one('SELECT tugas_id, COUNT(*) n FROM tugas_kumpul GROUP BY tugas_id').all().map((r) => [r.tugas_id, r.n])),
    kumpulSaya: (akunId) => new Set(one('SELECT tugas_id FROM tugas_kumpul WHERE akun_id = ?').all(akunId).map((r) => r.tugas_id)),
    kumpulTugas: (tugasId) => one(`SELECT a.id, a.nama, k.at FROM akun a LEFT JOIN tugas_kumpul k ON k.akun_id = a.id AND k.tugas_id = ?
      ORDER BY a.nama COLLATE NOCASE`).all(tugasId),

    ujianAll: () => one('SELECT * FROM ujian ORDER BY waktu').all(),
    ujianMendatang: (now) => one('SELECT * FROM ujian WHERE waktu >= ? ORDER BY waktu').all(now),
    addUjian: (u) => one('INSERT INTO ujian (matkul, jenis, waktu, ruang) VALUES (@matkul, @jenis, @waktu, @ruang)').run(withMk(u)).lastInsertRowid,
    updateUjian: (id, u) => ada('ujian', id) && one('UPDATE ujian SET matkul=@matkul, jenis=@jenis, waktu=@waktu, ruang=@ruang WHERE id=@id').run({ ...withMk(u), id }).changes,
    delUjian: (id) => one('DELETE FROM ujian WHERE id = ?').run(id).changes,
    ujianById: (id) => one('SELECT * FROM ujian WHERE id = ?').get(id),

    // Pengumuman ke grup
    pengumumanAll: () => one('SELECT * FROM pengumuman ORDER BY kirim_at DESC LIMIT 100').all(),
    pengumumanById: (id) => one('SELECT * FROM pengumuman WHERE id = ?').get(id),
    addPengumuman: (p) => one('INSERT INTO pengumuman (teks, kirim_at, status, oleh, dibuat) VALUES (@teks, @kirim_at, @status, @oleh, @dibuat)')
      .run({ status: 'terjadwal', dibuat: Date.now(), ...p }).lastInsertRowid,
    setPengumumanStatus: (id, status, detail = null) => one('UPDATE pengumuman SET status = ?, dikirim = ?, detail = ? WHERE id = ?')
      .run(status, status === 'terkirim' ? Date.now() : null, detail, id).changes,
    pengumumanJatuhTempo: (now) => one("SELECT * FROM pengumuman WHERE status = 'terjadwal' AND kirim_at <= ? ORDER BY kirim_at").all(now),
    delPengumuman: (id) => one('DELETE FROM pengumuman WHERE id = ?').run(id).changes,

    // Riwayat perubahan data
    addRiwayat: (oleh, aksi, jenis, ringkas = null) => {
      one('INSERT INTO riwayat (at, oleh, aksi, jenis, ringkas) VALUES (?, ?, ?, ?, ?)').run(Date.now(), oleh, aksi, jenis, ringkas);
      one('DELETE FROM riwayat WHERE id NOT IN (SELECT id FROM riwayat ORDER BY id DESC LIMIT 500)').run();
    },
    riwayatTerbaru: (n = 200) => one('SELECT * FROM riwayat ORDER BY id DESC LIMIT ?').all(n),

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
    delAkun: db.transaction((id) => {
      one('DELETE FROM tugas_kumpul WHERE akun_id = ?').run(id);
      return one('DELETE FROM akun WHERE id = ?').run(id).changes;
    }),
    akunDenganWa: () => one("SELECT * FROM akun WHERE wa IS NOT NULL AND wa != ''").all(),
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
