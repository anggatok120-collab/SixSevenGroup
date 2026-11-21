// Pengaturan pengingat: default dari .env, bisa diubah admin lewat web (disimpan di DB).
const { parseHM } = require('./time');

const MODES = ['pagi', 'besok', 'kelas', 'tugas', 'ujian'];

function defaults(cfg) {
  return {
    pagi: { on: true, jam: cfg.dailyAt },
    besok: { on: true, jam: '18:00' },
    kelas: { on: true, menit: cfg.classLeadMin },
    tugas: { on: true, menit: cfg.taskLeadsMin },
    ujian: { on: true, menit: cfg.examLeadsMin, pagiJam: cfg.examMorningAt },
  };
}

function getSettings(db, cfg) {
  const saved = db.getSetting('pengingat') || {};
  const d = defaults(cfg);
  for (const m of MODES) d[m] = { ...d[m], ...(saved[m] || {}) };
  return d;
}

/** Validasi input dari web, kembalikan { value } atau { error }. */
function validate(input, cfg) {
  const cur = defaults(cfg);
  const out = {};
  for (const m of MODES) {
    const x = (input && input[m]) || {};
    const o = { on: !!x.on };
    if (m === 'pagi' || m === 'besok') {
      o.jam = parseHM(x.jam || cur[m].jam);
      if (!o.jam) return { error: `Jam pengingat ${m} tidak valid` };
    }
    if (m === 'kelas') {
      o.menit = Number(x.menit);
      if (!(o.menit >= 5 && o.menit <= 180)) return { error: 'Menit pengingat kelas harus 5–180' };
    }
    if (m === 'tugas' || m === 'ujian') {
      const arr = (Array.isArray(x.menit) ? x.menit : []).map(Number).filter((n) => n > 0 && n <= 60 * 24 * 30);
      o.menit = [...new Set(arr)].sort((a, b) => b - a);
    }
    if (m === 'ujian') {
      o.pagiJam = x.pagiJam === '' || x.pagiJam == null ? null : parseHM(x.pagiJam);
      if (x.pagiJam && !o.pagiJam) return { error: 'Jam pengingat pagi ujian tidak valid' };
    }
    out[m] = o;
  }
  return { value: out };
}

module.exports = { getSettings, validate, MODES };
