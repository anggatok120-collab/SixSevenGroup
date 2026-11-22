// Penyusun pesan WA. Dipakai pengingat otomatis, tombol "kirim sekarang", dan pratinjau di web.
const { local, parseLocal, pad, HARI_LABEL } = require('./time');
const { kelasLine, tugasLine, ujianLine, prakSesiLine, prakTugasLine, tanggalPanjang, penutup, jam, BULAN, BULAN_PANJANG } = require('./format');
const { kelasPada } = require('./jadwal');

const DAY = 86400000;
const tgl = (ms) => { const t = local(ms); return `${t.y}-${pad(t.mo)}-${pad(t.d)}`; };
const KUMPUL_P = '✅ Sudah kumpul tugas praktikum? Balas */kumpul P nomor*, contoh */kumpul P3*';
const KUMPUL = '✅ Sudah kumpul? Balas */kumpul nomor*, contoh */kumpul 5*';
const bagian = (ikon, judul, n, isi) => `${ikon} *${judul}*${n ? ` · ${n}` : ''}\n${isi}`;

function pesanHariIni(db, now = Date.now()) {
  const kelas = kelasPada(db, now);
  const tugas = db.tugasAktif().filter((x) => x.deadline > now && x.deadline - now <= 3 * DAY);
  const ujian = db.ujianMendatang(now).filter((x) => x.waktu - now <= 7 * DAY);
  const sesi = db.prakSesiTanggal(tgl(now));
  const ptugas = db.prakTugasAktif().filter((x) => x.deadline > now && x.deadline - now <= 3 * DAY);
  const libur = kelas.find((k) => k.libur)?.libur;
  const aktif = kelas.filter((k) => !k.batal).length;
  const isi = [
    `☀️ *Selamat pagi!*\n_${tanggalPanjang(now)}_`,
    libur && !aktif ? `🏖️ Hari ini libur: *${libur}*` : bagian('📚', 'Jadwal hari ini', aktif ? `${aktif} kelas` : '', kelas.length ? kelas.map(kelasLine).join('\n') : 'Tidak ada kelas hari ini 🎉'),
    tugas.length && bagian('📝', 'Tugas mendekati tenggat', tugas.length, tugas.map((x) => tugasLine(x, now)).join('\n')),
    ujian.length && bagian('📖', 'Ujian 7 hari ke depan', ujian.length, ujian.map((x) => ujianLine(x, now)).join('\n')),
    sesi.length && bagian('🧪', 'Praktikum hari ini', sesi.length, sesi.map(prakSesiLine).join('\n')),
    ptugas.length && bagian('🧾', 'Tugas praktikum mendekati tenggat', ptugas.length, ptugas.map((x) => prakTugasLine(x, now)).join('\n')),
    tugas.length ? KUMPUL : '',
    ptugas.length ? KUMPUL_P : '',
    penutup(now),
  ].filter(Boolean);
  return { text: isi.join('\n\n'), kosong: !kelas.length && !tugas.length && !ujian.length && !sesi.length && !ptugas.length };
}

function pesanBesok(db, now = Date.now()) {
  const besok = local(now + DAY);
  const kelas = kelasPada(db, now + DAY);
  // Batas = akhir hari besok (waktu lokal), bukan 48 jam dari sekarang.
  const awalBesok = parseLocal(`${besok.y}-${pad(besok.mo)}-${pad(besok.d)} 00:00`);
  const akhirBesok = awalBesok + DAY;
  const tugas = db.tugasAktif().filter((x) => x.deadline > now && x.deadline < akhirBesok);
  const ujian = db.ujianMendatang(now).filter((x) => x.waktu >= awalBesok && x.waktu < akhirBesok);
  const sesi = db.prakSesiTanggal(tgl(now + DAY));
  const ptugas = db.prakTugasAktif().filter((x) => x.deadline > now && x.deadline < akhirBesok);
  const libur = kelas.find((k) => k.libur)?.libur;
  const aktif = kelas.filter((k) => !k.batal).length;
  const isi = [
    `🌙 *Persiapan untuk besok*\n_${tanggalPanjang(now + DAY)}_`,
    libur && !aktif ? `🏖️ Besok libur: *${libur}*` : bagian('📚', 'Jadwal besok', aktif ? `${aktif} kelas` : '', kelas.length ? kelas.map(kelasLine).join('\n') : 'Tidak ada kelas besok 🎉'),
    tugas.length && bagian('📝', 'Tenggat sampai besok', tugas.length, tugas.map((x) => tugasLine(x, now)).join('\n')),
    ujian.length && bagian('📖', 'Ujian besok', ujian.length, ujian.map((x) => ujianLine(x, now)).join('\n')),
    sesi.length && bagian('🧪', 'Praktikum besok', sesi.length, sesi.map(prakSesiLine).join('\n')),
    ptugas.length && bagian('🧾', 'Tugas praktikum sampai besok', ptugas.length, ptugas.map((x) => prakTugasLine(x, now)).join('\n')),
    tugas.length ? KUMPUL : '',
    ptugas.length ? KUMPUL_P : '',
    sesi.length ? 'Jangan lupa jas lab, modul, dan tugas pendahuluan untuk praktikum 🥼' : 'Siapkan tas dan tugasnya dari sekarang, lalu istirahat yang cukup 🎒',
  ].filter(Boolean);
  return { text: isi.join('\n\n'), kosong: !kelas.length && !tugas.length && !ujian.length && !sesi.length && !ptugas.length };
}

function pesanTugas(db, now = Date.now()) {
  const list = db.tugasAktif();
  if (!list.length) return { text: '✅ *Tidak ada tugas aktif.*\nSemua beres, mantap! 🎉', kosong: true };
  const telat = list.filter((x) => x.deadline <= now); const jalan = list.filter((x) => x.deadline > now);
  const isi = [
    `📝 *Daftar tugas aktif* · ${list.length}`,
    jalan.length && jalan.map((x) => tugasLine(x, now)).join('\n'),
    telat.length && bagian('⚠️', 'Sudah lewat tenggat', telat.length, telat.map((x) => tugasLine(x, now)).join('\n')),
    KUMPUL,
  ].filter(Boolean);
  return { text: isi.join('\n\n'), kosong: false };
}

function pesanUjian(db, now = Date.now()) {
  const list = db.ujianMendatang(now);
  if (!list.length) return { text: '📖 Belum ada ujian terjadwal.', kosong: true };
  return { text: `📖 *Jadwal ujian mendatang* · ${list.length}\n\n${list.map((u) => ujianLine(u, now)).join('\n')}\n\nSemangat belajarnya! 📚`, kosong: false };
}

/** Rekap agenda 7 hari ke depan (dikirim tiap Minggu malam). */
function pesanMingguan(db, now = Date.now()) {
  const hariIni = local(now);
  const awal = parseLocal(`${hariIni.y}-${pad(hariIni.mo)}-${pad(hariIni.d)} 00:00`) + DAY; // mulai besok
  const akhir = awal + 7 * DAY;
  const tugas = db.tugasAktif().filter((x) => x.deadline >= awal && x.deadline < akhir);
  const ujian = db.ujianMendatang(awal).filter((x) => x.waktu < akhir);
  const sama = (ms, t) => { const x = local(ms); return x.d === t.d && x.mo === t.mo; };
  const hm = (ms) => { const x = local(ms); return `${pad(x.h)}.${pad(x.mi)}`; };
  const baris = [];
  let adaKelas = false;
  for (let i = 0; i < 7; i++) {
    const ms = awal + i * DAY; const t = local(ms);
    const kelas = kelasPada(db, ms);
    const aktif = kelas.filter((k) => !k.batal);
    if (aktif.length) adaKelas = true;
    const tg = tugas.filter((x) => sama(x.deadline, t));
    const uj = ujian.filter((x) => sama(x.waktu, t));
    const ps = db.prakSesiTanggal(tgl(ms));
    const pt = db.prakTugasAktif().filter((x) => sama(x.deadline, t) && x.deadline >= awal && x.deadline < akhir);
    if (ps.length || pt.length) adaKelas = true;
    if (!kelas.length && !tg.length && !uj.length && !ps.length && !pt.length) continue;
    const libur = kelas.find((k) => k.libur)?.libur;
    const isi = [
      libur ? `🏖️ Libur: ${libur}` : aktif.length ? `📚 ${aktif.length} kelas: ${aktif.map((k) => `${k.matkul} (${jam(k.mulai)})`).join(', ')}` : '',
      ...kelas.filter((k) => k.batal && !k.libur).map((k) => `❌ ${k.matkul} batal`),
      ...uj.map((x) => `📖 *${x.jenis} ${x.matkul}* · ${hm(x.waktu)}`),
      ...tg.map((x) => `📝 Tenggat *${x.matkul}* — ${x.judul} · ${hm(x.deadline)}`),
      ...ps.map((x) => `🧪 Praktikum *${x.praktikum}* — ${x.judul} · ${jam(x.mulai)}`),
      ...pt.map((x) => `🧾 Tenggat ${x.jenis} *${x.praktikum}* · ${hm(x.deadline)}`),
    ].filter(Boolean);
    baris.push(`*${HARI_LABEL[t.dow]}, ${t.d} ${BULAN[t.mo - 1]}*\n${isi.map((x) => `▸ ${x}`).join('\n')}`);
  }
  const a = local(awal); const z = local(akhir - DAY);
  const periode = a.mo === z.mo ? `${a.d}–${z.d} ${BULAN_PANJANG[z.mo - 1]} ${z.y}` : `${a.d} ${BULAN[a.mo - 1]} – ${z.d} ${BULAN[z.mo - 1]} ${z.y}`;
  const ringkas = [adaKelas && 'kelas', tugas.length && `${tugas.length} tenggat`, ujian.length && `${ujian.length} ujian`].filter(Boolean);
  const text = [`🗓️ *Agenda minggu depan*\n_${periode}_`, baris.join('\n\n') || 'Tidak ada agenda minggu depan 🎉', ringkas.length ? 'Atur waktu dari sekarang supaya tidak menumpuk di akhir pekan. Semangat untuk minggu ini! 💪' : 'Selamat menikmati minggu yang santai 😌'].join('\n\n');
  return { text, kosong: !adaKelas && !tugas.length && !ujian.length };
}

/** Agenda praktikum 7 hari ke depan + tugas praktikum aktif (/praktikum dan "Kirim sekarang"). */
function pesanPraktikum(db, now = Date.now()) {
  const hari = []; let nSesi = 0;
  for (let i = 0; i < 7; i++) {
    const ms = now + i * DAY; const ss = db.prakSesiTanggal(tgl(ms)).filter((s) => parseLocal(`${s.tanggal} ${s.selesai || s.mulai}`) > now); // yang sudah selesai tidak ditampilkan
    if (!ss.length) continue; nSesi += ss.length;
    const t = local(ms);
    hari.push(`*${i === 0 ? 'Hari ini' : i === 1 ? 'Besok' : HARI_LABEL[t.dow]}, ${t.d} ${BULAN[t.mo - 1]}*\n${ss.map(prakSesiLine).join('\n')}`);
  }
  const ptugas = db.prakTugasAktif();
  if (!nSesi && !ptugas.length) return { text: '🧪 Tidak ada praktikum dan tugas praktikum dalam waktu dekat 🎉', kosong: true };
  const isi = [
    '🧪 *Agenda praktikum*',
    nSesi ? bagian('🗓️', '7 hari ke depan', `${nSesi} sesi`, hari.join('\n\n')) : '',
    ptugas.length ? bagian('🧾', 'Tugas praktikum aktif', ptugas.length, ptugas.map((x) => prakTugasLine(x, now)).join('\n')) : '',
    ptugas.length ? KUMPUL_P : '',
  ].filter(Boolean);
  return { text: isi.join('\n\n'), kosong: false };
}

const BUILDERS = { pagi: pesanHariIni, besok: pesanBesok, tugas: pesanTugas, ujian: pesanUjian, mingguan: pesanMingguan, praktikum: pesanPraktikum };

module.exports = { pesanHariIni, pesanBesok, pesanTugas, pesanUjian, pesanMingguan, pesanPraktikum, BUILDERS, KUMPUL, KUMPUL_P };
