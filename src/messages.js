// Penyusun pesan WA. Dipakai pengingat otomatis, tombol "kirim sekarang", dan pratinjau di web.
const { local, parseLocal, pad } = require('./time');
const { tugasLine, ujianLine, jadwalHari } = require('./format');
const { kelasPada } = require('./jadwal');

const DAY = 86400000;

function pesanHariIni(db, now = Date.now()) {
  const t = local(now);
  const kelas = kelasPada(db, now);
  const tugas = db.tugasAktif().filter((x) => x.deadline > now && x.deadline - now <= 3 * DAY);
  const ujian = db.ujianMendatang(now).filter((x) => x.waktu - now <= 7 * DAY);
  let msg = `☀️ *Selamat pagi!* Ringkasan hari ini\n\n${jadwalHari(kelas, t.dow)}`;
  if (tugas.length) msg += `\n\n📝 *Tugas dekat deadline*\n${tugas.map((x) => tugasLine(x, now)).join('\n')}`;
  if (ujian.length) msg += `\n\n📚 *Ujian minggu ini*\n${ujian.map((x) => ujianLine(x, now)).join('\n')}`;
  return { text: msg, kosong: !kelas.length && !tugas.length && !ujian.length };
}

function pesanBesok(db, now = Date.now()) {
  const besok = local(now + DAY);
  const kelas = kelasPada(db, now + DAY);
  // Batas = akhir hari besok (waktu lokal), bukan 48 jam dari sekarang.
  const awalBesok = parseLocal(`${besok.y}-${pad(besok.mo)}-${pad(besok.d)} 00:00`);
  const akhirBesok = awalBesok + DAY;
  const tugas = db.tugasAktif().filter((x) => x.deadline > now && x.deadline < akhirBesok);
  const ujian = db.ujianMendatang(now).filter((x) => x.waktu >= awalBesok && x.waktu < akhirBesok);
  let msg = `🌙 *Persiapan besok*\n\n${jadwalHari(kelas, besok.dow)}`;
  if (tugas.length) msg += `\n\n📝 *Tugas deadline sampai besok*\n${tugas.map((x) => tugasLine(x, now)).join('\n')}`;
  if (ujian.length) msg += `\n\n📚 *Ujian besok*\n${ujian.map((x) => ujianLine(x, now)).join('\n')}`;
  return { text: msg, kosong: !kelas.length && !tugas.length && !ujian.length };
}

function pesanTugas(db, now = Date.now()) {
  const list = db.tugasAktif();
  if (!list.length) return { text: '✅ Tidak ada tugas aktif.', kosong: true };
  return { text: `📝 *Tugas Aktif*\n${list.map((x) => tugasLine(x, now)).join('\n')}`, kosong: false };
}

function pesanUjian(db, now = Date.now()) {
  const list = db.ujianMendatang(now);
  if (!list.length) return { text: 'Belum ada ujian terjadwal.', kosong: true };
  return { text: `📚 *Ujian Mendatang*\n${list.map((u) => ujianLine(u, now)).join('\n')}`, kosong: false };
}

const BUILDERS = { pagi: pesanHariIni, besok: pesanBesok, tugas: pesanTugas, ujian: pesanUjian };

module.exports = { pesanHariIni, pesanBesok, pesanTugas, pesanUjian, BUILDERS };
