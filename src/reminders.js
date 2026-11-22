// Logika murni: tentukan pesan pengingat apa yang harus dikirim pada waktu `now`.
const { local, parseLocal, pad } = require('./time');
const { kelasLine, tugasLine, ujianLine, prakSesiLine, prakTugasLine, leadLabel, waktu } = require('./format');
const { pesanHariIni, pesanBesok, pesanMingguan } = require('./messages');
const { kelasPada, ymd, getSemester } = require('./jadwal');

// Pengingat dikirim kalau waktunya sudah lewat, maksimal 30 menit (supaya tetap terkirim
// walau bot sempat restart/terputus, misalnya saat deploy, tapi tidak mengirim pesan basi).
// Pengingat kelas tetap tidak dikirim kalau kelasnya sudah mulai.
const WINDOW = 30 * 60000;
const inWindow = (target, now) => now >= target && now < target + WINDOW;

function todayAt(now, hm) {
  const t = local(now);
  return parseLocal(`${t.y}-${pad(t.mo)}-${pad(t.d)} ${hm}`);
}

const menitDari = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
/** Apakah waktu `ms` jatuh di jam tenang (bisa melewati tengah malam, mis. 22:00–05:00). */
function diJamTenang(tn, ms) {
  if (!tn?.on) return false;
  const t = local(ms); const m = t.h * 60 + t.mi; const a = menitDari(tn.dari); const b = menitDari(tn.sampai);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}
/** Akhir jam tenang berikutnya setelah `ms`. */
function akhirJamTenang(tn, ms) {
  let x = todayAt(ms, tn.sampai);
  if (x <= ms) x += 86400000;
  return x;
}

/** s = hasil getSettings(). */
function dueReminders(db, s, now = Date.now()) {
  const out = [];
  const t = local(now);
  const tanggal = `${t.y}-${pad(t.mo)}-${pad(t.d)}`;
  const add = (mode, key, text, extra = {}) => { if (!db.sudahTerkirim(key)) out.push({ mode, key, text, ...extra }); };
  // Mode libur: semua pengingat otomatis berhenti (pengumuman terjadwal tetap jalan).
  const dijeda = !!(s.jeda?.sampai && tanggal <= s.jeda.sampai);
  // Jam tenang: tidak ada pesan otomatis; pengingat yang jatuh di jam tenang dikirim saat jam tenang selesai.
  const tenangSekarang = diJamTenang(s.tenang, now);
  const jatuhTempo = (target) => {
    if (diJamTenang(s.tenang, target)) target = akhirJamTenang(s.tenang, target);
    return inWindow(target, now);
  };
  const sem = getSemester(db);

  if (!dijeda && !tenangSekarang) {
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
      for (const k of kelasPada(db, base, sem)) {
        if (k.batal) continue;
        const start = todayAt(base, k.mulai);
        if (jatuhTempo(start - s.kelas.menit * 60000) && start > now) {
          add('kelas', `kelas:${k.id}:${k.tanggal}`,
            `🔔 *Kelas dimulai ${s.kelas.menit} menit lagi*${k.pengganti ? ' · _kuliah pengganti_' : ''}\n\n${kelasLine({ ...k, pengganti: false })}\n\nSampai ketemu di kelas! 🙌`);
        }
      }
    }
  }

  // 4. Deadline tugas
  if (s.tugas.on) {
    for (const x of db.tugasAktif()) {
      for (const lead of s.tugas.menit) {
        if (jatuhTempo(x.deadline - lead * 60000) && x.deadline > now) {
          // Tenggat ikut di kunci: kalau tenggat diubah, pengingat dikirim lagi untuk tenggat baru.
          add('tugas', `tugas:${x.id}:${lead}:${x.deadline}`, `⏰ *Pengingat tugas · ${leadLabel(lead)}*\n\n${tugasLine(x, now)}${x.catatan ? `\n    📝 ${x.catatan}` : ''}\n\n✅ Sudah kumpul? Balas */kumpul ${x.id}*`);
        }
      }
    }
  }

  // 5. Ujian
  if (s.ujian.on) {
    for (const u of db.ujianMendatang(now)) {
      for (const lead of s.ujian.menit) {
        if (jatuhTempo(u.waktu - lead * 60000) && u.waktu > now) {
          add('ujian', `ujian:${u.id}:${lead}:${u.waktu}`, `📖 *Pengingat ujian · ${leadLabel(lead)}*\n\n${ujianLine(u, now)}${u.materi ? `\n\n📋 *Materi:*\n${u.materi.split('\n').map((m) => `• ${m}`).join('\n')}` : ''}\n\nSemangat belajarnya! 📚`);
        }
      }
      if (s.ujian.pagiJam) {
        const ul = local(u.waktu);
        const ujianHariIni = ul.y === t.y && ul.mo === t.mo && ul.d === t.d;
        const pagi = todayAt(now, s.ujian.pagiJam);
        if (ujianHariIni && pagi < u.waktu && inWindow(pagi, now)) {
          add('ujian', `ujianpagi:${u.id}:${u.waktu}`, `🍀 *Hari ini ujian!*\n\n${ujianLine(u, now)}${u.bawa ? `\n\n🎒 Jangan lupa bawa: *${u.bawa}*` : ''}\n\nTarik napas, tetap tenang. Semoga lancar! 🙏`);
        }
      }
    }
  }

  // 6. Pengingat pribadi lewat chat WA: hanya untuk anggota yang nomornya terdaftar
  //    dan belum menandai tugas itu "sudah kumpul".
  if (s.pribadi?.on) {
    const akun = db.akunDenganWa().filter((a) => a.dm !== 0);
    const sudah = statusKumpulFn(db);
    if (akun.length) {
      for (const x of db.tugasAktif()) {
        for (const lead of s.pribadi.menit) {
          if (!jatuhTempo(x.deadline - lead * 60000) || x.deadline <= now) continue;
          for (const a of akun) {
            if (sudah(x, a.id)) continue;
            add('pribadi', `dm:${a.id}:t:${x.id}:${lead}:${x.deadline}`,
              `👋 Halo *${a.nama}*,\ntugas ini belum kamu tandai sudah dikumpulkan _(${leadLabel(lead)})_:\n\n${tugasLine(x, now)}\n\n✅ Sudah kumpul? Balas */kumpul ${x.id}* atau centang di web.`,
              { to: `${a.wa}@s.whatsapp.net`, akunId: a.id });
          }
        }
      }
      if (s.pribadi.ujian) {
        for (const u of db.ujianMendatang(now)) {
          if (!jatuhTempo(u.waktu - 1440 * 60000)) continue;
          for (const a of akun) {
            add('pribadi', `dm:${a.id}:u:${u.id}:${u.waktu}`, `👋 Halo *${a.nama}*, besok ada ujian:\n\n${ujianLine(u, now)}\n\nSemangat belajarnya, kamu pasti bisa! 📚`, { to: `${a.wa}@s.whatsapp.net`, akunId: a.id });
          }
        }
      }
    }
  }

  // 9. Praktikum: sesi akan dimulai & tenggat tugas praktikum
  if (s.praktikum?.on) {
    for (const hariKe of [0, 1]) {
      const base = now + hariKe * 86400000;
      for (const p of db.prakSesiTanggal(ymd(base))) {
        const start = todayAt(base, p.mulai);
        if (jatuhTempo(start - s.praktikum.menit * 60000) && start > now) {
          add('praktikum', `prak:${p.id}:${p.tanggal}:${p.mulai}`, `🧪 *Praktikum dimulai ${s.praktikum.menit >= 60 && s.praktikum.menit % 60 === 0 ? `${s.praktikum.menit / 60} jam` : `${s.praktikum.menit} menit`} lagi*\n\n${prakSesiLine(p)}\n\nJangan lupa jas lab dan modulnya 🥼`);
        }
      }
    }
    for (const x of db.prakTugasAktif()) {
      for (const lead of s.praktikum.tugas || []) {
        if (jatuhTempo(x.deadline - lead * 60000) && x.deadline > now) {
          add('praktikum', `praktugas:${x.id}:${lead}:${x.deadline}`, `🧾 *Pengingat tugas praktikum · ${leadLabel(lead)}*\n\n${prakTugasLine(x, now)}${x.catatan ? `\n    📝 ${x.catatan}` : ''}\n\n✅ Sudah kumpul? Balas */kumpul P${x.id}*`);
        }
      }
    }
  }

  // 8. Rekap mingguan tiap Minggu
  if (s.mingguan?.on && t.dow === 0 && inWindow(todayAt(now, s.mingguan.jam), now)) {
    const m = pesanMingguan(db, now);
    if (!m.kosong) add('mingguan', `mingguan:${tanggal}`, m.text);
  }
  } // akhir: tidak dijeda & bukan jam tenang

  // 7. Pengumuman terjadwal dari web (yang terlambat lebih dari 6 jam tidak dikirim lagi)
  for (const p of db.pengumumanJatuhTempo?.(now) || []) {
    if (p.kirim_at < now - 6 * 3600000) continue;
    add('pengumuman', `pengumuman:${p.id}`, teksPengumuman(p), { pengumumanId: p.id, gambar: p.gambar });
  }

  return out;
}

// Sudah kumpul? Untuk tugas kelompok, cukup satu anggota kelompoknya yang menandai.
function statusKumpulFn(db) {
  const grup = new Map(); // tugas_id -> Map(akun_id -> kelompok_id)
  const anggotaGrup = new Map(); // kelompok_id -> [akun_id]
  for (const r of db.kelompokAll()) {
    if (!grup.has(r.tugas_id)) grup.set(r.tugas_id, new Map());
    if (r.akun_id != null) { grup.get(r.tugas_id).set(r.akun_id, r.id); anggotaGrup.set(r.id, [...(anggotaGrup.get(r.id) || []), r.akun_id]); }
  }
  return (tugas, akunId) => {
    if (db.sudahKumpul(tugas.id, akunId)) return true;
    const kid = tugas.kelompok && grup.get(tugas.id)?.get(akunId);
    return !!kid && (anggotaGrup.get(kid) || []).some((a) => db.sudahKumpul(tugas.id, a));
  };
}

const teksPengumuman = (p) => `📢 *PENGUMUMAN*\n\n${p.teks}${p.oleh ? `\n\n— _${p.oleh}_` : ''}`;

module.exports = { dueReminders, teksPengumuman, statusKumpulFn, diJamTenang, WINDOW };

/** Perkiraan pesan otomatis dalam `jam` ke depan (untuk tampilan "antrean" di Status Bot). */
function antrean(db, s, now = Date.now(), jam = 24) {
  const seen = new Map();
  for (let t = now; t <= now + jam * 3600000; t += 5 * 60000) {
    for (const r of dueReminders(db, s, t)) {
      if (seen.has(r.key) || r.mode === 'pengumuman' && t === now) continue;
      seen.set(r.key, { at: t, mode: r.mode, judul: r.text.split('\n')[0].replace(/[*_]/g, '').slice(0, 100), pribadi: !!r.to });
    }
  }
  // Pesan pribadi digabung per waktu supaya daftar tidak kepanjangan.
  const out = []; const dm = new Map();
  for (const x of seen.values()) {
    if (!x.pribadi) { out.push(x); continue; }
    const k = `${x.at}`; dm.set(k, { ...x, judul: 'Pengingat pribadi ke anggota', n: (dm.get(k)?.n || 0) + 1 });
  }
  return [...out, ...dm.values()].sort((a, b) => a.at - b.at).slice(0, 40);
}
module.exports.antrean = antrean;
