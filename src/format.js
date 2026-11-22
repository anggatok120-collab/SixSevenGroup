// Format pesan WhatsApp: blok yang rapi dan mudah dibaca di HP.
// WhatsApp: *tebal*, _miring_, ~coret~. Jam ditulis gaya Indonesia (08.40).
const { local, HARI_LABEL } = require('./time');

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const pad = (n) => String(n).padStart(2, '0');

/** "08:40" → "08.40" */
const jam = (hhmm) => String(hhmm || '').replace(':', '.');
/** "08.40–10.20" */
const rentang = (mulai, selesai) => `${jam(mulai)}${selesai ? '–' + jam(selesai) : ''}`;
/** "Senin, 23 November 2026" */
function tanggalPanjang(ms) { const t = local(ms); return `${HARI_LABEL[t.dow]}, ${t.d} ${BULAN_PANJANG[t.mo - 1]} ${t.y}`; }
/** "Rabu, 25 Nov · 08.40" */
function waktu(ms) { const t = local(ms); return `${HARI_LABEL[t.dow]}, ${t.d} ${BULAN[t.mo - 1]} · ${pad(t.h)}.${pad(t.mi)}`; }

function sisa(ms) {
  if (ms < 0) {
    const lewat = Math.round(-ms / 60000);
    return lewat < 60 ? `lewat ${lewat} menit` : lewat < 2880 ? `lewat ${Math.round(lewat / 60)} jam` : `lewat ${Math.floor(lewat / 1440)} hari`;
  }
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} menit lagi`;
  const j = Math.round(min / 60);
  if (j < 48) return `${j} jam lagi`;
  return `${Math.floor(min / 1440)} hari lagi`;
}
/** Sisa waktu yang mencolok kalau mepet: "_2 hari lagi_" atau "⚠️ *5 jam lagi*". */
function sisaTampil(ms) {
  const s = sisa(ms);
  if (ms < 0) return `⚠️ *${s}*`;
  return ms <= 24 * 3600000 ? `⚠️ *${s}*` : `_${s}_`;
}

function leadLabel(min) {
  if (min % 1440 === 0) return `H-${min / 1440}`;
  if (min % 60 === 0) return `${min / 60} jam lagi`;
  return `${min} menit lagi`;
}

const IND = '    '; // indentasi baris keterangan di bawah judul blok

/** Blok satu kelas. */
function kelasLine(k) {
  if (k.libur) return `▸ ~${k.matkul}~ 🏖️ *Libur*\n${IND}🕗 ${rentang(k.mulai, k.selesai)} · ${k.libur}`;
  if (k.batal) return `▸ ~${k.matkul}~ ❌ *Batal*\n${IND}🕗 ${rentang(k.mulai, k.selesai)}${k.alasan ? ` · ${k.alasan}` : ''}`;
  const baris = [`▸ *${k.matkul}*${k.pengganti ? ' 🔁 _kuliah pengganti_' : ''}`, `${IND}🕗 ${rentang(k.mulai, k.selesai)}${k.ruang ? ` · 📍 ${k.ruang}` : ''}`];
  if (k.dosen) baris.push(`${IND}👤 ${k.dosen}`);
  return baris.join('\n');
}

/** Blok satu tugas. Nomor (#id) dipakai untuk /kumpul. */
function tugasLine(t, now) {
  const baris = [`▸ *${t.matkul}* — ${t.judul}${t.kelompok ? ' 👥' : ''} _(#${t.id})_`, `${IND}⏰ ${waktu(t.deadline)} · ${sisaTampil(t.deadline - now)}`];
  if (t.link) baris.push(`${IND}📤 ${t.link}`);
  return baris.join('\n');
}

/** Blok satu ujian. */
function ujianLine(u, now) {
  const baris = [`▸ *${u.jenis} ${u.matkul}*`, `${IND}📅 ${waktu(u.waktu)} · ${sisaTampil(u.waktu - now)}`];
  const ket = [u.ruang && `📍 ${u.ruang}`, u.bawa && `🎒 ${u.bawa}`].filter(Boolean);
  if (ket.length) baris.push(`${IND}${ket.join(' · ')}`);
  if (u.link) baris.push(`${IND}🔗 ${u.link}`);
  return baris.join('\n');
}

/** Blok satu sesi praktikum. */
function prakSesiLine(s) {
  const baris = [`▸ *${s.praktikum}* — ${s.judul}`, `${IND}🕗 ${rentang(s.mulai, s.selesai)}${s.ruang || s.lab ? ` · 🧪 ${s.ruang || s.lab}` : ''}`];
  if (s.asisten) baris.push(`${IND}👤 Asisten: ${s.asisten}`);
  if (s.catatan) baris.push(`${IND}📝 ${s.catatan}`);
  return baris.join('\n');
}
/** Blok satu tugas praktikum. Nomor (#P3) dipakai untuk /kumpul P3. */
function prakTugasLine(t, now) {
  const baris = [`▸ *${t.praktikum}* — ${t.jenis}: ${t.judul} _(#P${t.id})_`, `${IND}⏰ ${waktu(t.deadline)} · ${sisaTampil(t.deadline - now)}`];
  if (t.link) baris.push(`${IND}📤 ${t.link}`);
  return baris.join('\n');
}

/** Daftar kelas satu hari (dipakai /hari, /besok, ringkasan). */
function jadwalHari(kelas, dow, judul = `*${HARI_LABEL[dow]}*`) {
  if (!kelas.length) return `${judul}\nTidak ada kelas 🎉`;
  const aktif = kelas.filter((k) => !k.batal).length;
  return `${judul}${aktif ? ` · ${aktif} kelas` : ''}\n${kelas.map(kelasLine).join('\n')}`;
}

// Kalimat penutup yang berganti tiap hari supaya pesan tidak terasa robotik.
const PENUTUP = [
  'Semangat kuliah hari ini! 💪',
  'Datang tepat waktu ya, sampai ketemu di kelas 🙌',
  'Jangan lupa sarapan sebelum berangkat 🍳',
  'Sedikit demi sedikit, lama-lama jadi sarjana 🎓',
  'Kerjakan yang paling dekat tenggatnya dulu ✍️',
  'Istirahat juga bagian dari rencana belajar 😌',
  'Kalau buntu, tanya teman sekelas, itu strategi 🤝',
];
const penutup = (ms) => { const t = local(ms); return PENUTUP[(t.y * 372 + t.mo * 31 + t.d) % PENUTUP.length]; };

module.exports = { prakSesiLine, prakTugasLine, sisa, sisaTampil, leadLabel, kelasLine, tugasLine, ujianLine, jadwalHari, jam, rentang, waktu, tanggalPanjang, penutup, BULAN, BULAN_PANJANG };
