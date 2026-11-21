// Penyusun pesan WA. Dipakai pengingat otomatis, tombol "kirim sekarang", dan pratinjau di web.
const { local } = require('./time');
const { tugasLine, ujianLine, jadwalHari } = require('./format');

const DAY = 86400000;

function pesanHariIni(db, now = Date.now()) {
  const t = local(now);
  const kelas = db.kelasByHari(t.dow);
  const tugas = db.tugasAktif().filter((x) => x.deadline > now && x.deadline - now <= 3 * DAY);
  const ujian = db.ujianMendatang(now).filter((x) => x.waktu - now <= 7 * DAY);
  let msg = `☀️ *Selamat pagi!* Ringkasan hari ini\n\n${jadwalHari(kelas, t.dow)}`;
  if (tugas.length) msg += `\n\n📝 *Tugas dekat deadline*\n${tugas.map((x) => tugasLine(x, now)).join('\n')}`;
  if (ujian.length) msg += `\n\n📚 *Ujian minggu ini*\n${ujian.map((x) => ujianLine(x, now)).join('\n')}`;
  return { text: msg, kosong: !kelas.length && !tugas.length && !ujian.length };
}

function pesanBesok(db, now = Date.now()) {
  const besok = local(now + DAY);
  const kelas = db.kelasByHari(besok.dow);
  const batasAwal = now; const batasAkhir = now + 2 * DAY;
  const tugas = db.tugasAktif().filter((x) => x.deadline > batasAwal && x.deadline <= batasAkhir);
  const ujian = db.ujianMendatang(now).filter((x) => x.waktu <= batasAkhir);
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
