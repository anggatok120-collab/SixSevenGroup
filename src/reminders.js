// Logika murni: tentukan pesan pengingat apa yang harus dikirim pada waktu `now`.
const { local, parseLocal, pad } = require('./time');
const { tugasLine, ujianLine, jadwalHari, leadLabel } = require('./format');

// Pengingat dikirim kalau waktunya sudah lewat, maksimal 10 menit (supaya
// tetap terkirim walau bot sempat restart sebentar, tapi tidak spam pesan lama).
const WINDOW = 10 * 60000;
const inWindow = (target, now) => now >= target && now < target + WINDOW;

function todayAt(now, hm) {
  const t = local(now);
  return parseLocal(`${t.y}-${pad(t.mo)}-${pad(t.d)} ${hm}`);
}

function dueReminders(db, cfg, now = Date.now()) {
  const out = [];
  const t = local(now);
  const tanggal = `${t.y}-${pad(t.mo)}-${pad(t.d)}`;
  const add = (key, text) => { if (!db.sudahTerkirim(key)) out.push({ key, text }); };

  // 1. Ringkasan pagi
  if (inWindow(todayAt(now, cfg.dailyAt), now)) {
    const kelas = db.kelasByHari(t.dow);
    const tugas = db.tugasAktif().filter((x) => x.deadline > now && x.deadline - now <= 3 * 86400000);
    const ujian = db.ujianMendatang(now).filter((x) => x.waktu - now <= 7 * 86400000);
    let msg = `☀️ *Selamat pagi!* Ringkasan hari ini\n\n${jadwalHari(kelas, t.dow)}`;
    if (tugas.length) msg += `\n\n📝 *Tugas dekat deadline*\n${tugas.map((x) => tugasLine(x, now)).join('\n')}`;
    if (ujian.length) msg += `\n\n📚 *Ujian minggu ini*\n${ujian.map((x) => ujianLine(x, now)).join('\n')}`;
    add(`harian:${tanggal}`, msg);
  }

  // 2. Kelas akan dimulai
  for (const k of db.kelasByHari(t.dow)) {
    const start = todayAt(now, k.mulai);
    if (inWindow(start - cfg.classLeadMin * 60000, now)) {
      add(`kelas:${k.id}:${tanggal}`,
        `🔔 *${k.matkul}* mulai jam ${k.mulai}${k.ruang ? ' di ' + k.ruang : ''} (${cfg.classLeadMin} menit lagi)`);
    }
  }

  // 3. Deadline tugas
  for (const x of db.tugasAktif()) {
    for (const lead of cfg.taskLeadsMin) {
      if (inWindow(x.deadline - lead * 60000, now)) {
        add(`tugas:${x.id}:${lead}`, `📝 *Pengingat tugas (${leadLabel(lead)})*\n${tugasLine(x, now)}\n\nKalau sudah dikumpulkan: /selesai ${x.id}`);
      }
    }
  }

  // 4. Ujian
  for (const u of db.ujianMendatang(now)) {
    for (const lead of cfg.examLeadsMin) {
      if (inWindow(u.waktu - lead * 60000, now)) {
        add(`ujian:${u.id}:${lead}`, `📚 *Pengingat ujian (${leadLabel(lead)})*\n${ujianLine(u, now)}`);
      }
    }
    const ul = local(u.waktu);
    const ujianHariIni = ul.y === t.y && ul.mo === t.mo && ul.d === t.d;
    const pagi = todayAt(now, cfg.examMorningAt);
    if (ujianHariIni && pagi < u.waktu && inWindow(pagi, now)) {
      add(`ujianpagi:${u.id}`, `🍀 *Hari ini ujian!*\n${ujianLine(u, now)}\n\nSemangat, semoga lancar!`);
    }
  }

  return out;
}

module.exports = { dueReminders, WINDOW };
