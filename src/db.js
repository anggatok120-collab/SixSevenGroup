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
    CREATE TABLE IF NOT EXISTS absen (            -- pertemuan yang ditandai "tidak hadir" oleh anggota
      akun_id INTEGER NOT NULL, tanggal TEXT NOT NULL, kelas_key TEXT NOT NULL,
      PRIMARY KEY (akun_id, tanggal, kelas_key)
    );
    CREATE TABLE IF NOT EXISTS materi (
      id INTEGER PRIMARY KEY AUTOINCREMENT, matkul_id INTEGER NOT NULL, judul TEXT NOT NULL, url TEXT NOT NULL, dibuat INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nilai (            -- nilai pribadi per mata kuliah (JSON komponen -> angka)
      akun_id INTEGER NOT NULL, matkul_id INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (akun_id, matkul_id)
    );
    CREATE TABLE IF NOT EXISTS centang (          -- checklist pribadi: langkah tugas / materi ujian
      akun_id INTEGER NOT NULL, jenis TEXT NOT NULL, ref_id INTEGER NOT NULL, idx INTEGER NOT NULL,
      PRIMARY KEY (akun_id, jenis, ref_id, idx)
    );
    CREATE TABLE IF NOT EXISTS sampah (           -- data terhapus, bisa dikembalikan
      id INTEGER PRIMARY KEY AUTOINCREMENT, jenis TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL, oleh TEXT
    );
    CREATE TABLE IF NOT EXISTS kelompok (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tugas_id INTEGER NOT NULL, nama TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kelompok_anggota (
      kelompok_id INTEGER NOT NULL, akun_id INTEGER NOT NULL, PRIMARY KEY (kelompok_id, akun_id)
    );
    CREATE TABLE IF NOT EXISTS polling (
      id INTEGER PRIMARY KEY AUTOINCREMENT, pertanyaan TEXT NOT NULL, opsi TEXT NOT NULL, ganda INTEGER NOT NULL DEFAULT 0,
      msg_id TEXT, msg TEXT, hasil TEXT, status TEXT NOT NULL DEFAULT 'baru', oleh TEXT, dibuat INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_sub (
      endpoint TEXT PRIMARY KEY, akun_id INTEGER NOT NULL, data TEXT NOT NULL, dibuat INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS praktikum (       -- mata praktikum (terpisah dari mata kuliah)
      id INTEGER PRIMARY KEY AUTOINCREMENT, nama TEXT NOT NULL UNIQUE COLLATE NOCASE,
      lab TEXT, asisten TEXT, kontak TEXT, warna TEXT, catatan TEXT
    );
    CREATE TABLE IF NOT EXISTS prak_sesi (        -- satu pertemuan praktikum pada tanggal tertentu
      id INTEGER PRIMARY KEY AUTOINCREMENT, praktikum_id INTEGER NOT NULL, judul TEXT NOT NULL,
      tanggal TEXT NOT NULL, mulai TEXT NOT NULL, selesai TEXT, ruang TEXT, catatan TEXT
    );
    CREATE TABLE IF NOT EXISTS prak_tugas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, praktikum_id INTEGER NOT NULL, jenis TEXT NOT NULL, judul TEXT NOT NULL,
      deadline INTEGER NOT NULL, link TEXT, catatan TEXT, selesai INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS prak_kumpul (
      tugas_id INTEGER NOT NULL, akun_id INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (tugas_id, akun_id)
    );
    CREATE TABLE IF NOT EXISTS pesan_keluar (     -- salinan pesan yang dikirim bot, untuk melayani permintaan kirim ulang WhatsApp
      id TEXT PRIMARY KEY, msg TEXT NOT NULL, at INTEGER NOT NULL
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
  const tambahKolom = (t, defs) => { const ada = cols(t); for (const [c, d] of defs) if (!ada.includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`); };
  tambahKolom('matkul', [['warna', 'TEXT'], ['kontak', 'TEXT'], ['maks_bolos', 'INTEGER'], ['bobot', 'TEXT']]);
  tambahKolom('tugas', [['link', 'TEXT'], ['lampiran', 'TEXT'], ['langkah', 'TEXT'], ['kelompok', 'INTEGER NOT NULL DEFAULT 0']]);
  tambahKolom('ujian', [['materi', 'TEXT'], ['bawa', 'TEXT'], ['link', 'TEXT']]);
  tambahKolom('pengumuman', [['pin_sampai', 'INTEGER'], ['web_saja', 'INTEGER NOT NULL DEFAULT 0'], ['gambar', 'TEXT']]);
  tambahKolom('akun', [['status', "TEXT NOT NULL DEFAULT 'aktif'"], ['terakhir', 'INTEGER'], ['dm', 'INTEGER NOT NULL DEFAULT 1'], ['foto', 'TEXT']]);
  tambahKolom('riwayat', [['sampah_id', 'INTEGER']]);

  const one = (sql) => db.prepare(sql);
  const MK_DEF = { kode: null, sks: null, dosen: null, catatan: null, warna: null, kontak: null, maks_bolos: null, bobot: null };
  const TG_DEF = { prioritas: 'normal', catatan: null, selesai: 0, link: null, lampiran: null, langkah: null, kelompok: 0 };
  const UJ_DEF = { ruang: null, materi: null, bawa: null, link: null };
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
    addMatkul: (m) => one(`INSERT INTO matkul (nama, kode, sks, dosen, catatan, warna, kontak, maks_bolos, bobot)
      VALUES (@nama, @kode, @sks, @dosen, @catatan, @warna, @kontak, @maks_bolos, @bobot)`).run({ ...MK_DEF, ...m }).lastInsertRowid,
    // Ganti nama ikut mengubah jadwal, tugas, dan ujian yang memakai nama lama.
    updateMatkul: db.transaction((id, m) => {
      const lama = one('SELECT nama FROM matkul WHERE id = ?').get(id);
      if (!lama) return 0;
      one(`UPDATE matkul SET nama=@nama, kode=@kode, sks=@sks, dosen=@dosen, catatan=@catatan, warna=@warna, kontak=@kontak,
        maks_bolos=@maks_bolos, bobot=@bobot WHERE id=@id`).run({ ...MK_DEF, ...m, id });
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
    addTugas: (t) => one(`INSERT INTO tugas (matkul, judul, deadline, prioritas, catatan, link, lampiran, langkah, kelompok)
      VALUES (@matkul, @judul, @deadline, @prioritas, @catatan, @link, @lampiran, @langkah, @kelompok)`)
      .run({ ...TG_DEF, ...withMk(t) }).lastInsertRowid,
    updateTugas: (id, t) => ada('tugas', id) && one(`UPDATE tugas SET matkul=@matkul, judul=@judul, deadline=@deadline, selesai=@selesai, prioritas=@prioritas,
      catatan=@catatan, link=@link, lampiran=@lampiran, langkah=@langkah, kelompok=@kelompok WHERE id=@id`)
      .run({ ...TG_DEF, ...withMk(t), id }).changes,
    setSelesai: (id, v) => one('UPDATE tugas SET selesai = ? WHERE id = ?').run(v ? 1 : 0, id).changes,
    selesaiTugas: (id) => one('UPDATE tugas SET selesai = 1 WHERE id = ?').run(id).changes,
    delTugas: db.transaction((id) => {
      one('DELETE FROM tugas_kumpul WHERE tugas_id = ?').run(id);
      one('DELETE FROM kelompok_anggota WHERE kelompok_id IN (SELECT id FROM kelompok WHERE tugas_id = ?)').run(id);
      one('DELETE FROM kelompok WHERE tugas_id = ?').run(id);
      one("DELETE FROM centang WHERE jenis = 'tugas' AND ref_id = ?").run(id);
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
    addUjian: (u) => one('INSERT INTO ujian (matkul, jenis, waktu, ruang, materi, bawa, link) VALUES (@matkul, @jenis, @waktu, @ruang, @materi, @bawa, @link)').run({ ...UJ_DEF, ...withMk(u) }).lastInsertRowid,
    updateUjian: (id, u) => ada('ujian', id) && one('UPDATE ujian SET matkul=@matkul, jenis=@jenis, waktu=@waktu, ruang=@ruang, materi=@materi, bawa=@bawa, link=@link WHERE id=@id').run({ ...UJ_DEF, ...withMk(u), id }).changes,
    delUjian: (id) => one('DELETE FROM ujian WHERE id = ?').run(id).changes,
    ujianById: (id) => one('SELECT * FROM ujian WHERE id = ?').get(id),

    // Pengumuman ke grup
    pengumumanAll: () => one('SELECT * FROM pengumuman ORDER BY kirim_at DESC LIMIT 100').all(),
    pengumumanById: (id) => one('SELECT * FROM pengumuman WHERE id = ?').get(id),
    addPengumuman: (p) => one(`INSERT INTO pengumuman (teks, kirim_at, status, oleh, dibuat, pin_sampai, web_saja, gambar)
      VALUES (@teks, @kirim_at, @status, @oleh, @dibuat, @pin_sampai, @web_saja, @gambar)`)
      .run({ status: 'terjadwal', dibuat: Date.now(), pin_sampai: null, web_saja: 0, gambar: null, ...p }).lastInsertRowid,
    pengumumanPin: (now) => one('SELECT * FROM pengumuman WHERE pin_sampai IS NOT NULL AND pin_sampai > ? AND status IN (\'terkirim\', \'web\') ORDER BY kirim_at DESC').all(now),
    setPin: (id, sampai) => one('UPDATE pengumuman SET pin_sampai = ? WHERE id = ?').run(sampai, id).changes,
    setPengumumanStatus: (id, status, detail = null) => one('UPDATE pengumuman SET status = ?, dikirim = ?, detail = ? WHERE id = ?')
      .run(status, status === 'terkirim' ? Date.now() : null, detail, id).changes,
    pengumumanJatuhTempo: (now) => one("SELECT * FROM pengumuman WHERE status = 'terjadwal' AND web_saja = 0 AND kirim_at <= ? ORDER BY kirim_at").all(now),
    delPengumuman: (id) => one('DELETE FROM pengumuman WHERE id = ?').run(id).changes,

    // Riwayat perubahan data
    addRiwayat: (oleh, aksi, jenis, ringkas = null, sampahId = null) => {
      one('INSERT INTO riwayat (at, oleh, aksi, jenis, ringkas, sampah_id) VALUES (?, ?, ?, ?, ?, ?)').run(Date.now(), oleh, aksi, jenis, ringkas, sampahId);
      one('DELETE FROM riwayat WHERE id NOT IN (SELECT id FROM riwayat ORDER BY id DESC LIMIT 500)').run();
    },
    riwayatTerbaru: (n = 200) => one(`SELECT r.*, CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END bisa_pulih FROM riwayat r
      LEFT JOIN sampah s ON s.id = r.sampah_id ORDER BY r.id DESC LIMIT ?`).all(n),

    // Sampah: data terhapus disimpan 30 hari supaya bisa dikembalikan
    addSampah: (jenis, data, oleh) => one('INSERT INTO sampah (jenis, data, at, oleh) VALUES (?, ?, ?, ?)').run(jenis, JSON.stringify(data), Date.now(), oleh).lastInsertRowid,
    sampahById: (id) => { const s = one('SELECT * FROM sampah WHERE id = ?').get(id); return s && { ...s, data: JSON.parse(s.data) }; },
    delSampah: (id) => one('DELETE FROM sampah WHERE id = ?').run(id).changes,
    bersihkanSampah: (before) => one('DELETE FROM sampah WHERE at < ?').run(before),
    // Masukkan lagi baris apa adanya (id lama dipakai kalau masih kosong).
    pulihkanBaris: (table, row) => {
      const c = cols(table).filter((k) => k in row);
      if (row.id != null && one(`SELECT 1 FROM ${table} WHERE id = ?`).get(row.id)) c.splice(c.indexOf('id'), 1);
      return one(`INSERT INTO ${table} (${c.join(', ')}) VALUES (${c.map((k) => '@' + k).join(', ')})`).run(row).lastInsertRowid;
    },

    // ---- Salinan pesan keluar (dipakai saat HP penerima gagal membuka pesan dan meminta kirim ulang) ----
    simpanPesanKeluar: (id, msg) => one('INSERT OR REPLACE INTO pesan_keluar (id, msg, at) VALUES (?, ?, ?)').run(id, msg, Date.now()),
    pesanKeluar: (id) => one('SELECT msg FROM pesan_keluar WHERE id = ?').get(id)?.msg || null,
    bersihkanPesanKeluar: (before) => one('DELETE FROM pesan_keluar WHERE at < ?').run(before).changes,

    // ---- Praktikum ----
    praktikumAll: () => one('SELECT * FROM praktikum ORDER BY nama COLLATE NOCASE').all(),
    praktikumById: (id) => one('SELECT * FROM praktikum WHERE id = ?').get(id),
    praktikumByNama: (n) => one('SELECT * FROM praktikum WHERE nama = ?').get(n),
    addPraktikum: (p) => one('INSERT INTO praktikum (nama, lab, asisten, kontak, warna, catatan) VALUES (@nama, @lab, @asisten, @kontak, @warna, @catatan)')
      .run({ lab: null, asisten: null, kontak: null, warna: null, catatan: null, ...p }).lastInsertRowid,
    updatePraktikum: (id, p) => one('UPDATE praktikum SET nama=@nama, lab=@lab, asisten=@asisten, kontak=@kontak, warna=@warna, catatan=@catatan WHERE id=@id')
      .run({ lab: null, asisten: null, kontak: null, warna: null, catatan: null, ...p, id }).changes,
    pakaiPraktikum: (id) => one('SELECT (SELECT COUNT(*) FROM prak_sesi WHERE praktikum_id = @id) sesi, (SELECT COUNT(*) FROM prak_tugas WHERE praktikum_id = @id) tugas').get({ id }),
    delPraktikum: (id) => one('DELETE FROM praktikum WHERE id = ?').run(id).changes,

    prakSesiAll: () => one('SELECT s.*, p.nama praktikum FROM prak_sesi s JOIN praktikum p ON p.id = s.praktikum_id ORDER BY s.tanggal, s.mulai').all(),
    prakSesiTanggal: (tgl) => one('SELECT s.*, p.nama praktikum, p.lab, p.asisten FROM prak_sesi s JOIN praktikum p ON p.id = s.praktikum_id WHERE s.tanggal = ? ORDER BY s.mulai').all(tgl),
    prakSesiById: (id) => one('SELECT * FROM prak_sesi WHERE id = ?').get(id),
    addPrakSesi: (s) => one('INSERT INTO prak_sesi (praktikum_id, judul, tanggal, mulai, selesai, ruang, catatan) VALUES (@praktikum_id, @judul, @tanggal, @mulai, @selesai, @ruang, @catatan)')
      .run({ selesai: null, ruang: null, catatan: null, ...s }).lastInsertRowid,
    updatePrakSesi: (id, s) => one('UPDATE prak_sesi SET praktikum_id=@praktikum_id, judul=@judul, tanggal=@tanggal, mulai=@mulai, selesai=@selesai, ruang=@ruang, catatan=@catatan WHERE id=@id')
      .run({ selesai: null, ruang: null, catatan: null, ...s, id }).changes,
    delPrakSesi: (id) => one('DELETE FROM prak_sesi WHERE id = ?').run(id).changes,

    prakTugasAll: () => one('SELECT t.*, p.nama praktikum FROM prak_tugas t JOIN praktikum p ON p.id = t.praktikum_id ORDER BY t.selesai, t.deadline').all(),
    prakTugasAktif: () => one('SELECT t.*, p.nama praktikum FROM prak_tugas t JOIN praktikum p ON p.id = t.praktikum_id WHERE t.selesai = 0 ORDER BY t.deadline').all(),
    prakTugasById: (id) => one('SELECT t.*, p.nama praktikum FROM prak_tugas t JOIN praktikum p ON p.id = t.praktikum_id WHERE t.id = ?').get(id),
    addPrakTugas: (t) => one('INSERT INTO prak_tugas (praktikum_id, jenis, judul, deadline, link, catatan, selesai) VALUES (@praktikum_id, @jenis, @judul, @deadline, @link, @catatan, @selesai)')
      .run({ link: null, catatan: null, selesai: 0, ...t }).lastInsertRowid,
    updatePrakTugas: (id, t) => one('UPDATE prak_tugas SET praktikum_id=@praktikum_id, jenis=@jenis, judul=@judul, deadline=@deadline, link=@link, catatan=@catatan, selesai=@selesai WHERE id=@id')
      .run({ link: null, catatan: null, selesai: 0, ...t, id }).changes,
    delPrakTugas: db.transaction((id) => { one('DELETE FROM prak_kumpul WHERE tugas_id = ?').run(id); return one('DELETE FROM prak_tugas WHERE id = ?').run(id).changes; }),
    setPrakKumpul: (tid, aid, v) => (v ? one('INSERT OR IGNORE INTO prak_kumpul (tugas_id, akun_id, at) VALUES (?, ?, ?)').run(tid, aid, Date.now()) : one('DELETE FROM prak_kumpul WHERE tugas_id = ? AND akun_id = ?').run(tid, aid)),
    prakKumpulCount: () => Object.fromEntries(one('SELECT tugas_id, COUNT(*) n FROM prak_kumpul GROUP BY tugas_id').all().map((r) => [r.tugas_id, r.n])),
    prakKumpulSaya: (aid) => new Set(one('SELECT tugas_id FROM prak_kumpul WHERE akun_id = ?').all(aid).map((r) => r.tugas_id)),
    prakKumpulTugas: (tid) => one('SELECT a.id, a.nama, k.at FROM akun a LEFT JOIN prak_kumpul k ON k.akun_id = a.id AND k.tugas_id = ? WHERE a.status = \'aktif\' ORDER BY a.nama COLLATE NOCASE').all(tid),

    // Absensi pribadi
    absenSaya: (akunId) => one('SELECT tanggal, kelas_key FROM absen WHERE akun_id = ?').all(akunId),
    setAbsen: (akunId, tanggal, key, v) => (v
      ? one('INSERT OR IGNORE INTO absen (akun_id, tanggal, kelas_key) VALUES (?, ?, ?)').run(akunId, tanggal, key)
      : one('DELETE FROM absen WHERE akun_id = ? AND tanggal = ? AND kelas_key = ?').run(akunId, tanggal, key)),

    // Materi per mata kuliah
    materiAll: () => one('SELECT * FROM materi ORDER BY dibuat').all(),
    materiByMatkul: (mkId) => one('SELECT * FROM materi WHERE matkul_id = ? ORDER BY dibuat').all(mkId),
    materiById: (id) => one('SELECT * FROM materi WHERE id = ?').get(id),
    addMateri: (m) => one('INSERT INTO materi (matkul_id, judul, url, dibuat) VALUES (@matkul_id, @judul, @url, @dibuat)').run({ dibuat: Date.now(), ...m }).lastInsertRowid,
    delMateri: (id) => one('DELETE FROM materi WHERE id = ?').run(id).changes,

    // Nilai pribadi
    nilaiSaya: (akunId) => Object.fromEntries(one('SELECT matkul_id, data FROM nilai WHERE akun_id = ?').all(akunId).map((r) => [r.matkul_id, JSON.parse(r.data)])),
    setNilai: (akunId, mkId, data) => one('INSERT INTO nilai (akun_id, matkul_id, data) VALUES (?, ?, ?) ON CONFLICT(akun_id, matkul_id) DO UPDATE SET data = excluded.data').run(akunId, mkId, JSON.stringify(data)),

    // Checklist pribadi
    centangSaya: (akunId) => one('SELECT jenis, ref_id, idx FROM centang WHERE akun_id = ?').all(akunId),
    setCentang: (akunId, jenis, ref, idx, v) => (v
      ? one('INSERT OR IGNORE INTO centang (akun_id, jenis, ref_id, idx) VALUES (?, ?, ?, ?)').run(akunId, jenis, ref, idx)
      : one('DELETE FROM centang WHERE akun_id = ? AND jenis = ? AND ref_id = ? AND idx = ?').run(akunId, jenis, ref, idx)),

    // Kelompok tugas
    kelompokAll: () => one(`SELECT k.id, k.tugas_id, k.nama, a.akun_id FROM kelompok k LEFT JOIN kelompok_anggota a ON a.kelompok_id = k.id ORDER BY k.id`).all(),
    setKelompok: db.transaction((tugasId, grup) => {
      one('DELETE FROM kelompok_anggota WHERE kelompok_id IN (SELECT id FROM kelompok WHERE tugas_id = ?)').run(tugasId);
      one('DELETE FROM kelompok WHERE tugas_id = ?').run(tugasId);
      for (const g of grup) {
        const kid = one('INSERT INTO kelompok (tugas_id, nama) VALUES (?, ?)').run(tugasId, g.nama).lastInsertRowid;
        for (const a of g.anggota) one('INSERT OR IGNORE INTO kelompok_anggota (kelompok_id, akun_id) VALUES (?, ?)').run(kid, a);
      }
    }),

    // Polling WhatsApp
    pollingAll: () => one('SELECT id, pertanyaan, opsi, ganda, hasil, status, oleh, dibuat, msg_id FROM polling ORDER BY id DESC LIMIT 50').all()
      .map((p) => ({ ...p, opsi: JSON.parse(p.opsi), hasil: p.hasil ? JSON.parse(p.hasil) : null })),
    addPolling: (p) => one('INSERT INTO polling (pertanyaan, opsi, ganda, oleh, dibuat) VALUES (@pertanyaan, @opsi, @ganda, @oleh, @dibuat)')
      .run({ ...p, opsi: JSON.stringify(p.opsi), ganda: p.ganda ? 1 : 0, dibuat: Date.now() }).lastInsertRowid,
    setPollingTerkirim: (id, msgId, msg) => one("UPDATE polling SET msg_id = ?, msg = ?, status = 'terkirim' WHERE id = ?").run(msgId, msg, id),
    setPollingStatus: (id, status) => one('UPDATE polling SET status = ? WHERE id = ?').run(status, id),
    pollingByMsgId: (msgId) => one('SELECT * FROM polling WHERE msg_id = ?').get(msgId),
    setPollingHasil: (id, hasil) => one('UPDATE polling SET hasil = ? WHERE id = ?').run(JSON.stringify(hasil), id),
    delPolling: (id) => one('DELETE FROM polling WHERE id = ?').run(id).changes,

    // Langganan notifikasi push
    pushSubs: (akunIds = null) => (akunIds ? one(`SELECT * FROM push_sub WHERE akun_id IN (${akunIds.map(() => '?').join(',') || 'NULL'})`).all(...akunIds) : one('SELECT * FROM push_sub').all()),
    addPushSub: (endpoint, akunId, data) => one('INSERT INTO push_sub (endpoint, akun_id, data, dibuat) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET akun_id = excluded.akun_id, data = excluded.data').run(endpoint, akunId, JSON.stringify(data), Date.now()),
    delPushSub: (endpoint) => one('DELETE FROM push_sub WHERE endpoint = ?').run(endpoint).changes,

    // Akun: status, terakhir aktif, preferensi
    setTerakhir: (id, at) => one('UPDATE akun SET terakhir = ? WHERE id = ?').run(at, id),
    setAkunStatus: (id, status) => one('UPDATE akun SET status = ? WHERE id = ?').run(status, id).changes,
    setAkunPref: (id, { dm, foto }) => one('UPDATE akun SET dm = COALESCE(?, dm), foto = COALESCE(?, foto) WHERE id = ?').run(dm == null ? null : dm ? 1 : 0, foto === undefined ? null : foto, id),
    hapusFoto: (id) => one('UPDATE akun SET foto = NULL WHERE id = ?').run(id),
    logHarian: (since) => one(`SELECT date((at + 25200000) / 1000, 'unixepoch') hari, status, COUNT(*) n FROM log_kirim WHERE at >= ? GROUP BY hari, status ORDER BY hari`).all(since),

    sudahTerkirim: (k) => !!one('SELECT 1 FROM terkirim WHERE kunci = ?').get(k),
    tandaiTerkirim: (k) => one('INSERT OR IGNORE INTO terkirim (kunci, at) VALUES (?, ?)').run(k, Date.now()),
    bersihkanTerkirim: (before) => one('DELETE FROM terkirim WHERE at < ?').run(before),

    akunAll: () => one("SELECT id, username, nama, role, wa, status, terakhir, dm, foto IS NOT NULL ada_foto FROM akun ORDER BY status = 'aktif', role, nama").all(),
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
    addAkun: (a) => one('INSERT INTO akun (username, nama, role, hash, status) VALUES (@username, @nama, @role, @hash, @status)').run({ status: 'aktif', ...a }).lastInsertRowid,
    updateAkun: (id, { nama, role, hash }) => (hash
      ? one('UPDATE akun SET nama=@nama, role=@role, hash=@hash WHERE id=@id').run({ nama, role, hash, id })
      : one('UPDATE akun SET nama=@nama, role=@role WHERE id=@id').run({ nama, role, id })).changes,
    delAkun: db.transaction((id) => {
      for (const t of ['tugas_kumpul', 'prak_kumpul', 'absen', 'nilai', 'centang', 'kelompok_anggota', 'push_sub']) one(`DELETE FROM ${t} WHERE akun_id = ?`).run(id);
      return one('DELETE FROM akun WHERE id = ?').run(id).changes;
    }),
    akunDenganWa: () => one("SELECT * FROM akun WHERE wa IS NOT NULL AND wa != '' AND status = 'aktif'").all(),
    adminWa: () => one("SELECT * FROM akun WHERE role = 'admin' AND wa IS NOT NULL AND wa != '' AND status = 'aktif'").all(),
    adminCount: () => one("SELECT COUNT(*) n FROM akun WHERE role = 'admin'").get().n,

    getSetting: (k) => { const r = one('SELECT nilai FROM pengaturan WHERE kunci = ?').get(k); return r ? JSON.parse(r.nilai) : undefined; },
    setSetting: (k, v) => one('INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?) ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai').run(k, JSON.stringify(v)),

    addLog: (mode, status, detail = null) => {
      one('INSERT INTO log_kirim (at, mode, status, detail) VALUES (?, ?, ?, ?)').run(Date.now(), mode, status, detail);
      one('DELETE FROM log_kirim WHERE id NOT IN (SELECT id FROM log_kirim ORDER BY id DESC LIMIT 3000)').run();
    },
    logTerbaru: (n = 30) => one('SELECT * FROM log_kirim ORDER BY id DESC LIMIT ?').all(n),
    logGagal24: () => one("SELECT COUNT(*) n FROM log_kirim WHERE status = 'gagal' AND at > ?").get(Date.now() - 86400000).n,
  };
}

module.exports = { openDb };
