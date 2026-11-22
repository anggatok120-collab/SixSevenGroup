// Jadwal kelas pada tanggal tertentu: jadwal rutin mingguan + kelas batal + kuliah pengganti,
// dengan memperhitungkan periode semester dan hari libur.
const { local, pad } = require('./time');

const ymd = (ms) => { const t = local(ms); return `${t.y}-${pad(t.mo)}-${pad(t.d)}`; };

// Libur nasional bertanggal tetap. Libur yang tanggalnya berubah tiap tahun (Idulfitri, Iduladha,
// Nyepi, Waisak, Imlek, dst.) diisi admin di menu Jadwal → Semester & libur.
const LIBUR_TETAP = { '01-01': 'Tahun Baru Masehi', '05-01': 'Hari Buruh', '06-01': 'Hari Lahir Pancasila', '08-17': 'Hari Kemerdekaan RI', '12-25': 'Hari Natal' };

const SEMESTER_DEFAULT = { mulai: null, selesai: null, nasional: true, libur: [] };
const getSemester = (db) => ({ ...SEMESTER_DEFAULT, ...(db.getSetting?.('semester') || {}) });

/** Nama libur kalau tanggal (YYYY-MM-DD) libur, selain itu null. */
function liburPada(sem, tanggal) {
  if (sem.nasional && LIBUR_TETAP[tanggal.slice(5)]) return LIBUR_TETAP[tanggal.slice(5)];
  const l = (sem.libur || []).find((x) => tanggal >= x.dari && tanggal <= (x.sampai || x.dari));
  return l ? l.nama || 'Libur' : null;
}
const diLuarSemester = (sem, tanggal) => !!((sem.mulai && tanggal < sem.mulai) || (sem.selesai && tanggal > sem.selesai));

/** Daftar kelas pada hari lokal yang memuat `ms`. Kelas batal/libur tetap ada dengan `batal: true`. */
function kelasPada(db, ms, sem = getSemester(db)) {
  const t = local(ms);
  const tanggal = ymd(ms);
  if (diLuarSemester(sem, tanggal)) return [];
  const libur = liburPada(sem, tanggal);
  const ubah = db.kelasUbahTanggal(tanggal);
  const batal = new Map(ubah.filter((u) => u.jenis === 'batal').map((u) => [u.kelas_id, u]));
  const rutin = db.kelasByHari(t.dow).map((k) => {
    const b = batal.get(k.id);
    return { ...k, tanggal, batal: !!b || !!libur, libur: !b && libur ? libur : null, ubahId: b?.id || null, alasan: b ? b.catatan : libur };
  });
  // Kuliah pengganti tetap berjalan walau hari libur (sengaja dijadwalkan).
  const pengganti = ubah.filter((u) => u.jenis === 'pengganti').map((u) => ({
    id: `p${u.id}`, ubahId: u.id, hari: t.dow, mulai: u.mulai, selesai: u.selesai, matkul: u.matkul,
    ruang: u.ruang, dosen: u.dosen, tanggal, pengganti: true, batal: false, alasan: u.catatan,
  }));
  return [...rutin, ...pengganti].sort((a, b) => a.mulai.localeCompare(b.mulai));
}

/** Validasi pengaturan semester dari web. */
function validasiSemester(b) {
  const tgl = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : null);
  const mulai = b.mulai ? tgl(b.mulai) : null; const selesai = b.selesai ? tgl(b.selesai) : null;
  if ((b.mulai && !mulai) || (b.selesai && !selesai)) return { error: 'Tanggal semester tidak valid' };
  if (mulai && selesai && selesai <= mulai) return { error: 'Akhir semester harus setelah awal semester' };
  const libur = [];
  for (const x of Array.isArray(b.libur) ? b.libur.slice(0, 60) : []) {
    const dari = tgl(x.dari); const sampai = x.sampai ? tgl(x.sampai) : dari;
    if (!dari || !sampai || sampai < dari) return { error: `Tanggal libur "${x.nama || ''}" tidak valid` };
    libur.push({ dari, sampai, nama: String(x.nama || 'Libur').trim().slice(0, 60) || 'Libur' });
  }
  return { value: { mulai, selesai, nasional: b.nasional !== false, libur: libur.sort((a, c) => a.dari.localeCompare(c.dari)) } };
}

module.exports = { kelasPada, ymd, getSemester, liburPada, diLuarSemester, validasiSemester, LIBUR_TETAP };
