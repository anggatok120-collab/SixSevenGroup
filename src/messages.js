// Penyusun pesan WA. Dipakai pengingat otomatis, tombol "kirim sekarang", dan pratinjau di web.
const { local, parseLocal, pad, HARI_LABEL } = require('./time');
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

/** Rekap agenda 7 hari ke depan (dikirim tiap Minggu malam). */
function pesanMingguan(db, now = Date.now()) {
  const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const hariIni = local(now);
  const awal = parseLocal(`${hariIni.y}-${pad(hariIni.mo)}-${pad(hariIni.d)} 00:00`) + DAY; // mulai besok
  const akhir = awal + 7 * DAY;
  const tugas = db.tugasAktif().filter((x) => x.deadline >= awal && x.deadline < akhir);
  const ujian = db.ujianMendatang(awal).filter((x) => x.waktu < akhir);
  const baris = [];
  let adaKelas = false;
  for (let i = 0; i < 7; i++) {
    const ms = awal + i * DAY; const t = local(ms);
    const kelas = kelasPada(db, ms);
    const aktif = kelas.filter((k) => !k.batal);
    if (aktif.length) adaKelas = true;
    const tg = tugas.filter((x) => local(x.deadline).d === t.d && local(x.deadline).mo === t.mo);
    const uj = ujian.filter((x) => local(x.waktu).d === t.d && local(x.waktu).mo === t.mo);
    if (!kelas.length && !tg.length && !uj.length) continue;
    const libur = kelas.find((k) => k.libur)?.libur;
    const isi = [
      libur ? `🏖️ Libur: ${libur}` : aktif.length ? `${aktif.length} kelas (${aktif.map((k) => k.matkul).join(', ')})` : '',
      ...kelas.filter((k) => k.batal && !k.libur).map((k) => `❌ ${k.matkul} batal`),
      ...tg.map((x) => `📝 Tenggat: ${x.matkul} – ${x.judul}`),
      ...uj.map((x) => `📚 ${x.jenis} ${x.matkul} jam ${pad(local(x.waktu).h)}:${pad(local(x.waktu).mi)}`),
    ].filter(Boolean);
    baris.push(`*${HARI_LABEL[t.dow]}, ${t.d} ${BLN[t.mo - 1]}*\n${isi.map((x) => `• ${x}`).join('\n')}`);
  }
  const text = `🗓️ *Agenda minggu depan*\n\n${baris.join('\n\n') || 'Tidak ada agenda.'}\n\nSemangat untuk minggu ini! 💪`;
  return { text, kosong: !adaKelas && !tugas.length && !ujian.length };
}

const BUILDERS = { pagi: pesanHariIni, besok: pesanBesok, tugas: pesanTugas, ujian: pesanUjian, mingguan: pesanMingguan };

module.exports = { pesanHariIni, pesanBesok, pesanTugas, pesanUjian, pesanMingguan, BUILDERS };
