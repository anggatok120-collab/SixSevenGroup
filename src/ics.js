// Feed kalender iCalendar (.ics) untuk langganan di Google Calendar / kalender HP.
const { parseLocal, local, pad } = require('./time');

const DAY = 86400000;
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // 20261122T010000Z
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Baris iCalendar maksimal 75 byte; lanjutan diawali spasi (tidak memotong karakter UTF-8).
function fold(line) {
  const out = []; let cur = ''; let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const durasi = (mulai, selesai) => {
  if (!selesai) return 100 * 60000;
  const [h1, m1] = mulai.split(':').map(Number); const [h2, m2] = selesai.split(':').map(Number);
  return Math.max(15, h2 * 60 + m2 - (h1 * 60 + m1)) * 60000;
};

function buildIcs(db, { now = Date.now(), nama = 'Six Seven 67' } = {}) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Six Seven 67//Pengingat Kuliah//ID', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(nama)}`, 'X-WR-TIMEZONE:Asia/Jakarta', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  const dtstamp = stamp(now);
  const ev = (uid, start, end, summary, { lokasi, desk, alarm } = {}) => {
    L.push('BEGIN:VEVENT', `UID:${uid}@sixseven67`, `DTSTAMP:${dtstamp}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${esc(summary)}`);
    if (lokasi) L.push(`LOCATION:${esc(lokasi)}`);
    if (desk) L.push(`DESCRIPTION:${esc(desk)}`);
    return { rrule: (r) => L.push(r), exdate: (ms) => L.push(`EXDATE:${stamp(ms)}`), end: () => {
      if (alarm) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, `TRIGGER:-PT${alarm}M`, 'END:VALARM');
      L.push('END:VEVENT');
    } };
  };

  // Jadwal rutin: mulai dari kemunculan pertama sejak 8 minggu lalu, berulang tiap minggu.
  const ubah = db.kelasUbahAll();
  const awal = now - 56 * DAY;
  for (const k of db.kelasAll()) {
    let d = awal; while (local(d).dow !== k.hari) d += DAY;
    const t = local(d);
    const start = parseLocal(`${t.y}-${pad(t.mo)}-${pad(t.d)} ${k.mulai}`);
    const e = ev(`kelas-${k.id}`, start, start + durasi(k.mulai, k.selesai), k.matkul, { lokasi: k.ruang, desk: k.dosen ? `Dosen: ${k.dosen}` : '', alarm: 30 });
    e.rrule('RRULE:FREQ=WEEKLY');
    for (const u of ubah) if (u.jenis === 'batal' && u.kelas_id === k.id) e.exdate(parseLocal(`${u.tanggal} ${k.mulai}`));
    e.end();
  }
  for (const u of ubah) {
    if (u.jenis !== 'pengganti') continue;
    const start = parseLocal(`${u.tanggal} ${u.mulai}`);
    ev(`pengganti-${u.id}`, start, start + durasi(u.mulai, u.selesai), `${u.matkul} (pengganti)`, { lokasi: u.ruang, desk: u.catatan, alarm: 30 }).end();
  }
  for (const x of db.tugasAll()) {
    if (x.selesai && x.deadline < now - 30 * DAY) continue;
    ev(`tugas-${x.id}`, x.deadline - 30 * 60000, x.deadline, `${x.selesai ? '✓ ' : ''}Tenggat: ${x.judul} (${x.matkul})`, { desk: x.catatan, alarm: x.selesai ? 0 : 24 * 60 }).end();
  }
  for (const u of db.ujianAll()) {
    ev(`ujian-${u.id}`, u.waktu, u.waktu + 2 * 3600000, `${u.jenis} ${u.matkul}`, { lokasi: u.ruang, alarm: 24 * 60 }).end();
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildIcs, fold };
