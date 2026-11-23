// Pengaturan pengingat: default dari .env, bisa diubah admin lewat web (disimpan di DB).
const { parseHM } = require('./time');

const MODES = ['pagi', 'besok', 'kelas', 'tugas', 'ujian', 'pribadi', 'mingguan', 'praktikum'];
const EXTRA = ['tenang', 'jeda', 'laporan'];

function defaults(cfg) {
  return {
    pagi: { on: true, jam: cfg.dailyAt },
    besok: { on: true, jam: '18:00' },
    kelas: { on: true, menit: cfg.classLeadMin },
    tugas: { on: true, menit: cfg.taskLeadsMin },
    ujian: { on: true, menit: cfg.examLeadsMin, pagiJam: cfg.examMorningAt },
    pribadi: { on: false, menit: [1440], ujian: true },
    mingguan: { on: true, jam: '19:00' },        // rekap agenda seminggu, tiap Minggu
    praktikum: { on: true, menit: 60, tugas: [1440, 180] }, // sesi praktikum & tenggat tugas praktikum
    tenang: { on: false, dari: '22:00', sampai: '05:00' }, // jam tenang: pesan ditunda
    jeda: { sampai: null },                      // mode libur: semua pengingat berhenti sampai tanggal ini
    laporan: { on: true, jam: '00:00', nomor: null, situs: [] }, // laporan server harian, hanya ke nomor admin
  };
}

function getSettings(db, cfg) {
  const saved = db.getSetting('pengingat') || {};
  const d = defaults(cfg);
  for (const m of [...MODES, ...EXTRA]) d[m] = { ...d[m], ...(saved[m] || {}) };
  return d;
}

/** Validasi input dari web, kembalikan { value } atau { error }. */
function validate(input, cfg) {
  const cur = defaults(cfg);
  const out = {};
  for (const m of MODES) {
    const x = (input && input[m]) || {};
    const o = { on: !!x.on };
    if (m === 'pagi' || m === 'besok' || m === 'mingguan') {
      o.jam = parseHM(x.jam || cur[m].jam);
      if (!o.jam) return { error: `Jam pengingat ${m} tidak valid` };
    }
    if (m === 'kelas') {
      o.menit = Number(x.menit);
      if (!(o.menit >= 5 && o.menit <= 180)) return { error: 'Menit pengingat kelas harus 5–180' };
    }
    if (m === 'tugas' || m === 'ujian' || m === 'pribadi') {
      const arr = (Array.isArray(x.menit) ? x.menit : []).map(Number).filter((n) => n > 0 && n <= 60 * 24 * 30);
      o.menit = [...new Set(arr)].sort((a, b) => b - a);
    }
    if (m === 'ujian') {
      o.pagiJam = x.pagiJam === '' || x.pagiJam == null ? null : parseHM(x.pagiJam);
      if (x.pagiJam && !o.pagiJam) return { error: 'Jam pengingat pagi ujian tidak valid' };
    }
    if (m === 'pribadi') o.ujian = !!x.ujian;
    if (m === 'praktikum') {
      o.menit = Number(x.menit);
      if (!(o.menit >= 5 && o.menit <= 240)) return { error: 'Menit pengingat praktikum harus 5–240' };
      const arr = (Array.isArray(x.tugas) ? x.tugas : []).map(Number).filter((n) => n > 0 && n <= 60 * 24 * 30);
      o.tugas = [...new Set(arr)].sort((a, b) => b - a);
    }
    out[m] = o;
  }
  const tn = (input && input.tenang) || {};
  out.tenang = { on: !!tn.on, dari: parseHM(tn.dari || '22:00'), sampai: parseHM(tn.sampai || '05:00') };
  if (!out.tenang.dari || !out.tenang.sampai) return { error: 'Jam tenang tidak valid' };
  const j = (input && input.jeda) || {};
  out.jeda = { sampai: j.sampai && /^\d{4}-\d{2}-\d{2}$/.test(j.sampai) ? j.sampai : null };
  const l = (input && input.laporan) || {};
  const situs = (Array.isArray(l.situs) ? l.situs : String(l.situs || '').split(/[\s,]+/)).map((x) => String(x).trim()).filter(Boolean)
    .map((x) => (/^https?:\/\//i.test(x) ? x : `https://${x}`));
  if (situs.length > 10) return { error: 'Maksimal 10 situs untuk laporan server' };
  if (situs.some((x) => { try { new URL(x); return x.length > 300; } catch { return true; } })) return { error: 'Ada alamat situs yang tidak valid' };
  const nomor = String(l.nomor || '').replace(/\D/g, '').replace(/^0/, '62');
  if (nomor && !/^\d{9,15}$/.test(nomor)) return { error: 'Nomor WA laporan tidak valid' };
  out.laporan = { on: !!l.on, jam: parseHM(l.jam || '00:00'), nomor: nomor || null, situs: [...new Set(situs)] };
  if (!out.laporan.jam) return { error: 'Jam laporan server tidak valid' };
  return { value: out };
}

module.exports = { getSettings, validate, MODES };
