// Waktu lokal (WIB/WITA/WIT) tanpa DST, cukup pakai offset tetap.
const OFFSET_MIN = Number(process.env.TZ_OFFSET || 7) * 60;

const HARI = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
const HARI_LABEL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const pad = (n) => String(n).padStart(2, '0');

/** Komponen waktu lokal dari epoch ms. */
function local(ms = Date.now()) {
  const d = new Date(ms + OFFSET_MIN * 60000);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay(),
  };
}

/** "YYYY-MM-DD HH:mm" lokal -> epoch ms. */
function parseLocal(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(str);
  if (!m) return NaN;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // Tolak tanggal/jam yang "meluber" (31-02, bulan 13, jam 25:99, dst.), jangan diam-diam digeser.
  const d = new Date(ms);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]
    || d.getUTCHours() !== +m[4] || d.getUTCMinutes() !== +m[5]) return NaN;
  return ms - OFFSET_MIN * 60000;
}

function fmtLocal(ms) {
  const t = local(ms);
  return `${t.y}-${pad(t.mo)}-${pad(t.d)} ${pad(t.h)}:${pad(t.mi)}`;
}

/** Tampilan ramah: "Sabtu, 28 Nov 23:59". */
function pretty(ms) {
  const t = local(ms);
  return `${HARI_LABEL[t.dow]}, ${t.d} ${BULAN[t.mo - 1]} ${pad(t.h)}:${pad(t.mi)}`;
}

/**
 * Terima input tanggal dari user:
 *  "28-11 23:59", "28-11-2026 23:59", "2026-11-28 23:59", "28/11 23:59".
 * Kalau tahun tidak ditulis dan tanggalnya sudah lewat, dianggap tahun depan.
 */
function parseUserDate(input, nowMs = Date.now()) {
  const s = input.trim().replace(/\//g, '-').replace(/\./g, ':');
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(s);
  let y, mo, d, h, mi;
  if (m) [, y, mo, d, h, mi] = m;
  else {
    m = /^(\d{1,2})-(\d{1,2})(?:-(\d{4}))?(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s);
    if (!m) return NaN;
    [, d, mo, y, h, mi] = m;
    if (h === undefined) { h = '23'; mi = '59'; }
  }
  const build = (yy) => parseLocal(`${yy}-${pad(+mo)}-${pad(+d)} ${pad(+h)}:${pad(+mi)}`);
  if (y) return build(+y);
  const now = local(nowMs);
  let ms = build(now.y);
  if (ms < nowMs - 86400000) ms = build(now.y + 1);
  return ms;
}

function parseHM(str) {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(str).trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${pad(+m[1])}:${pad(+m[2])}`;
}

function parseHari(str) {
  const s = String(str).trim().toLowerCase().replace("jum'at", 'jumat');
  const i = HARI.indexOf(s);
  return i === -1 ? null : i;
}

module.exports = { local, parseLocal, fmtLocal, pretty, parseUserDate, parseHM, parseHari, HARI_LABEL, pad };
