const { pretty, HARI_LABEL } = require('./time');

function sisa(ms) {
  if (ms < 0) {
    const lewat = Math.round(-ms / 60000);
    return lewat < 60 ? `lewat ${lewat} menit` : lewat < 2880 ? `lewat ${Math.round(lewat / 60)} jam` : `lewat ${Math.floor(lewat / 1440)} hari`;
  }
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} menit lagi`;
  const jam = Math.round(min / 60);
  if (jam < 48) return `${jam} jam lagi`;
  return `${Math.floor(min / 1440)} hari lagi`;
}

function leadLabel(min) {
  if (min % 1440 === 0) return `H-${min / 1440}`;
  if (min % 60 === 0) return `${min / 60} jam lagi`;
  return `${min} menit lagi`;
}

const kelasLine = (k) =>
  `• ${k.mulai}${k.selesai ? '–' + k.selesai : ''} *${k.matkul}*${k.ruang ? ' @ ' + k.ruang : ''}${k.dosen ? ' (' + k.dosen + ')' : ''}`;

const tugasLine = (t, now) => `• [${t.id}] *${t.matkul}*: ${t.judul}\n   ⏰ ${pretty(t.deadline)} (${sisa(t.deadline - now)})`;

const ujianLine = (u, now) => `• [${u.id}] *${u.jenis} ${u.matkul}*${u.ruang ? ' @ ' + u.ruang : ''}\n   📅 ${pretty(u.waktu)} (${sisa(u.waktu - now)})`;

function jadwalHari(kelas, dow) {
  if (!kelas.length) return `*${HARI_LABEL[dow]}*: tidak ada kelas 🎉`;
  return `*${HARI_LABEL[dow]}*\n${kelas.map(kelasLine).join('\n')}`;
}

module.exports = { sisa, leadLabel, kelasLine, tugasLine, ujianLine, jadwalHari };
