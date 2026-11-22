// Jadwal kelas pada tanggal tertentu: jadwal rutin mingguan + kelas batal + kuliah pengganti.
const { local, pad } = require('./time');

const ymd = (ms) => { const t = local(ms); return `${t.y}-${pad(t.mo)}-${pad(t.d)}`; };

/** Daftar kelas pada hari lokal yang memuat `ms`. Kelas batal tetap ada dengan `batal: true`. */
function kelasPada(db, ms) {
  const t = local(ms);
  const tanggal = ymd(ms);
  const ubah = db.kelasUbahTanggal(tanggal);
  const batal = new Map(ubah.filter((u) => u.jenis === 'batal').map((u) => [u.kelas_id, u]));
  const rutin = db.kelasByHari(t.dow).map((k) => ({
    ...k, tanggal, batal: batal.has(k.id), ubahId: batal.get(k.id)?.id || null, alasan: batal.get(k.id)?.catatan || null,
  }));
  const pengganti = ubah.filter((u) => u.jenis === 'pengganti').map((u) => ({
    id: `p${u.id}`, ubahId: u.id, hari: t.dow, mulai: u.mulai, selesai: u.selesai, matkul: u.matkul,
    ruang: u.ruang, dosen: u.dosen, tanggal, pengganti: true, batal: false, alasan: u.catatan,
  }));
  return [...rutin, ...pengganti].sort((a, b) => a.mulai.localeCompare(b.mulai));
}

module.exports = { kelasPada, ymd };
