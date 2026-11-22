// Logika murni: tentukan pesan pengingat apa yang harus dikirim pada waktu `now`.
const { local, parseLocal, pad } = require('./time');
const { tugasLine, ujianLine, leadLabel } = require('./format');
const { pesanHariIni, pesanBesok } = require('./messages');
const { kelasPada } = require('./jadwal');

// Pengingat dikirim kalau waktunya sudah lewat, maksimal 10 menit (supaya
// tetap terkirim walau bot sempat restart sebentar, tapi tidak spam pesan lama).
const WINDOW = 10 * 60000;
const inWindow = (target, now) => now >= target && now < target + WINDOW;

function todayAt(now, hm) {
  const t = local(now);
  return parseLocal(`${t.y}-${pad(t.mo)}-${pad(t.d)} ${hm}`);
}

/** s = hasil getSettings(). */
function dueReminders(db, s, now = Date.now()) {
  const out = [];
  const t = local(now);
  const tanggal = `${t.y}-${pad(t.mo)}-${pad(t.d)}`;
  const add = (mode, key, text, extra = {}) => { if (!db.sudahTerkirim(key)) out.push({ mode, key, text, ...extra }); };

  // 1. Ringkasan pagi (dilewati kalau hari itu kosong)
  if (s.pagi.on && inWindow(todayAt(now, s.pagi.jam), now)) {
    const m = pesanHariIni(db, now);
    if (!m.kosong) add('pagi', `harian:${tanggal}`, m.text);
  }

  // 2. Persiapan besok (H-1), dilewati kalau besok kosong
  if (s.besok.on && inWindow(todayAt(now, s.besok.jam), now)) {
    const m = pesanBesok(db, now);
    if (!m.kosong) add('besok', `besok:${tanggal}`, m.text);
  }

  // 3. Kelas akan dimulai (cek juga kelas besok: kelas 00:15 diingatkan 23:45 malam ini).
  // Kelas yang dibatalkan dilewati, kuliah pengganti ikut diingatkan.
  if (s.kelas.on) {
    for (const hariKe of [0, 1]) {
      const base = now + hariKe * 86400000;
      for (const k of kelasPada(db, base)) {
        if (k.batal) continue;
        const start = todayAt(base, k.mulai);
        if (inWindow(start - s.kelas.menit * 60000, now)) {
          add('kelas', `kelas:${k.id}:${k.tanggal}`,
            `🔔 *${k.matkul}*${k.pengganti ? ' (kuliah pengganti)' : ''} mulai jam ${k.mulai}${k.ruang ? ' di ' + k.ruang : ''} (${s.kelas.menit} menit lagi)`);
        }
      }
    }
  }

  // 4. Deadline tugas
  if (s.tugas.on) {
    for (const x of db.tugasAktif()) {
      for (const lead of s.tugas.menit) {
        if (inWindow(x.deadline - lead * 60000, now)) {
          // Tenggat ikut di kunci: kalau tenggat diubah, pengingat dikirim lagi untuk tenggat baru.
          add('tugas', `tugas:${x.id}:${lead}:${x.deadline}`, `📝 *Pengingat tugas (${leadLabel(lead)})*\n${tugasLine(x, now)}\n\nKalau sudah dikumpulkan: /selesai ${x.id}`);
        }
      }
    }
  }

  // 5. Ujian
  if (s.ujian.on) {
    for (const u of db.ujianMendatang(now)) {
      for (const lead of s.ujian.menit) {
        if (inWindow(u.waktu - lead * 60000, now)) {
          add('ujian', `ujian:${u.id}:${lead}:${u.waktu}`, `📚 *Pengingat ujian (${leadLabel(lead)})*\n${ujianLine(u, now)}`);
        }
      }
      if (s.ujian.pagiJam) {
        const ul = local(u.waktu);
        const ujianHariIni = ul.y === t.y && ul.mo === t.mo && ul.d === t.d;
        const pagi = todayAt(now, s.ujian.pagiJam);
        if (ujianHariIni && pagi < u.waktu && inWindow(pagi, now)) {
          add('ujian', `ujianpagi:${u.id}:${u.waktu}`, `🍀 *Hari ini ujian!*\n${ujianLine(u, now)}\n\nSemangat, semoga lancar!`);
        }
      }
    }
  }

  // 6. Pengingat pribadi lewat chat WA: hanya untuk anggota yang nomornya terdaftar
  //    dan belum menandai tugas itu "sudah kumpul".
  if (s.pribadi?.on) {
    const akun = db.akunDenganWa();
    if (akun.length) {
      for (const x of db.tugasAktif()) {
        for (const lead of s.pribadi.menit) {
          if (!inWindow(x.deadline - lead * 60000, now)) continue;
          for (const a of akun) {
            if (db.sudahKumpul(x.id, a.id)) continue;
            add('pribadi', `dm:${a.id}:t:${x.id}:${lead}:${x.deadline}`,
              `👋 Halo ${a.nama}, tugas ini belum kamu tandai sudah dikumpulkan (${leadLabel(lead)}):\n${tugasLine(x, now)}\n\nSudah kumpul? Balas */kumpul ${x.id}* atau centang di web.`,
              { to: `${a.wa}@s.whatsapp.net` });
          }
        }
      }
      if (s.pribadi.ujian) {
        for (const u of db.ujianMendatang(now)) {
          if (!inWindow(u.waktu - 1440 * 60000, now)) continue;
          for (const a of akun) {
            add('pribadi', `dm:${a.id}:u:${u.id}:${u.waktu}`, `📚 Halo ${a.nama}, besok ujian:\n${ujianLine(u, now)}\n\nSemangat belajarnya!`, { to: `${a.wa}@s.whatsapp.net` });
          }
        }
      }
    }
  }

  // 7. Pengumuman terjadwal dari web (yang terlambat lebih dari 6 jam tidak dikirim lagi)
  for (const p of db.pengumumanJatuhTempo?.(now) || []) {
    if (p.kirim_at < now - 6 * 3600000) continue;
    add('pengumuman', `pengumuman:${p.id}`, teksPengumuman(p), { pengumumanId: p.id });
  }

  return out;
}

const teksPengumuman = (p) => `📢 *Pengumuman*\n\n${p.teks}${p.oleh ? `\n\n_— ${p.oleh}_` : ''}`;

module.exports = { dueReminders, teksPengumuman, WINDOW };
