const { local, parseUserDate, parseHM, parseHari, pretty, HARI_LABEL } = require('./time');
const { tugasLine, ujianLine, jadwalHari } = require('./format');
const { kelasPada } = require('./jadwal');
const { pesanMingguan, pesanTugas, pesanUjian } = require('./messages');
const { jam: jamWa, rentang: rentangWa } = require('./format');

// Cari mata kuliah dari potongan nama (tidak peka huruf besar/kecil).
const cariMatkul = (db, q) => {
  const s = q.toLowerCase();
  const all = db.matkulAll();
  return all.find((m) => m.nama.toLowerCase() === s) || all.find((m) => m.nama.toLowerCase().includes(s))
    || all.find((m) => m.nama.split(/\s+/).map((w) => w[0]).join('').toLowerCase() === s);
};

const MENU = `🤖 *Bot Pengingat Kuliah*

*Lihat*
/hari – jadwal hari ini
/besok – jadwal besok
/jadwal – jadwal seminggu
/tugas – daftar tugas aktif
/ujian – daftar ujian mendatang
/minggu – agenda 7 hari ke depan
/cari kata – cari tugas, ujian, mata kuliah
/matkul nama – info satu mata kuliah
/materi nama – link materi mata kuliah

*Tambah (admin)*
/tambahkelas Senin | 08:00-09:40 | Kalkulus | R.301 | Pak Budi
/tambahtugas Basis Data | Laporan ERD | 28-11 23:59
/tambahujian Kalkulus | UTS | 02-12 08:00 | R.301
/importjadwal (lalu tiap baris: Hari | jam | matkul | ruang | dosen)

*Pribadi*
/kumpul 3 – tandai tugas no. 3 sudah kamu kumpulkan (nomor WA harus terdaftar di akun web)
Atau balas pesan pengingat tugas dengan *udah*

*Ubah (admin)*
/selesai 3 – tandai tugas no. 3 selesai
/hapustugas 3 · /hapusujian 2 · /hapuskelas 5

/web – alamat web pengelola
login – kirim di chat pribadi ke bot untuk dapat link masuk web
/groupid – tampilkan ID chat ini
/pakaigrup – (admin) jadikan grup ini tujuan pengingat
/kirimkesini – (admin, di chat pribadi) semua pesan bot dikirim ke kamu saja
/kegrup – (admin) kembalikan pesan bot ke grup

Prefix boleh / ! atau .`;

const split = (s) => s.split('|').map((x) => x.trim());

function parseKelas(line) {
  const [hariS, jam, matkul, ruang, dosen] = split(line);
  const hari = parseHari(hariS || '');
  if (hari === null) return { error: `Hari "${hariS}" tidak dikenal. Pakai Senin, Selasa, ...` };
  const [m, s] = (jam || '').split('-');
  const mulai = parseHM(m || '');
  const selesai = s ? parseHM(s) : null;
  if (!mulai || (s && !selesai)) return { error: `Jam "${jam}" tidak valid. Contoh: 08:00-09:40` };
  if (selesai && selesai <= mulai) return { error: 'Jam selesai harus setelah jam mulai.' };
  if (!matkul) return { error: 'Nama mata kuliah wajib diisi.' };
  return { kelas: { hari, mulai, selesai, matkul, ruang: ruang || null, dosen: dosen || null } };
}

function handle(db, text, { isAdmin = false, chatJid = '', now = Date.now(), webUrl = process.env.WEB_URL || '', akun = null, oleh = 'WhatsApp' } = {}) {
  const catat = (aksi, jenis, ringkas) => db.addRiwayat?.(`${oleh} (WA)`, aksi, jenis, ringkas);
  const m = /^[/!.](\w+)\s*([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  const arg = m[2].trim();
  const t = local(now);
  const needAdmin = () => (isAdmin ? null : '⛔ Perintah ini khusus admin.');

  switch (cmd) {
    case 'menu': case 'help': case 'bantuan':
      return MENU;
    case 'web':
      return webUrl ? `🌐 Kelola jadwal, tugas, dan ujian di: ${webUrl}` : 'Alamat web belum diatur (WEB_URL).';
    case 'groupid':
      return `ID chat ini: ${chatJid}`;
    case 'kirimkesini': case 'kepribadi': {
      const e = needAdmin(); if (e) return e;
      if (chatJid.endsWith('@g.us')) return 'Ketik perintah ini di chat pribadi dengan bot, bukan di grup.';
      const nomor = chatJid.endsWith('@s.whatsapp.net') ? chatJid.split('@')[0].split(':')[0] : akun?.wa;
      if (!nomor) return 'Nomor kamu tidak terbaca. Atur lewat web: Status Bot → Tujuan pesan.';
      db.setSetting('tujuan', { mode: 'pribadi', nomor });
      catat('ubah', 'tujuan pesan', `Semua pesan bot dialihkan ke +${nomor}`);
      return '✅ Mulai sekarang *semua pesan otomatis bot* (pengingat, pengumuman, polling, info perubahan) dikirim ke chat ini, *tidak ke grup*.\n\nKetik */kegrup* untuk mengembalikan ke grup kelas.';
    }
    case 'kegrup': {
      const e = needAdmin(); if (e) return e;
      db.setSetting('tujuan', { ...(db.getSetting('tujuan') || {}), mode: 'grup' });
      catat('ubah', 'tujuan pesan', 'Pesan bot kembali ke grup kelas');
      return '✅ Pesan bot kembali dikirim ke *grup kelas*.';
    }
    case 'pakaigrup': {
      const e = needAdmin(); if (e) return e;
      if (!chatJid.endsWith('@g.us')) return 'Ketik /pakaigrup di dalam grup yang mau dijadikan grup kelas.';
      db.setSetting('grupJid', chatJid);
      db.setSetting('tujuan', { ...(db.getSetting('tujuan') || {}), mode: 'grup' });
      catat('ubah', 'grup tujuan', chatJid);
      return '✅ Grup ini sekarang jadi *grup kelas*. Semua pengingat dan pengumuman akan dikirim ke sini.';
    }
    case 'hari':
      return jadwalHari(kelasPada(db, now), t.dow, `📚 *Jadwal hari ini* (${HARI_LABEL[t.dow]})`);
    case 'besok':
      return jadwalHari(kelasPada(db, now + 86400000), (t.dow + 1) % 7, `📚 *Jadwal besok* (${HARI_LABEL[(t.dow + 1) % 7]})`);
    case 'jadwal': {
      const all = db.kelasAll();
      if (!all.length) return 'Jadwal kelas masih kosong. Admin bisa isi pakai /tambahkelas atau /importjadwal.';
      const hariUrut = [1, 2, 3, 4, 5, 6, 0];
      return `🗓️ *Jadwal kuliah mingguan* · ${all.length} kelas\n\n` + hariUrut
        .map((h) => all.filter((k) => k.hari === h))
        .filter((ks) => ks.length)
        .map((ks) => `*${HARI_LABEL[ks[0].hari]}*\n` + ks.map((k) => `▸ ${rentangWa(k.mulai, k.selesai)} · *${k.matkul}*${k.ruang ? ` · 📍 ${k.ruang}` : ''} _(#${k.id})_`).join('\n'))
        .join('\n\n');
    }
    case 'tugas': {
      return pesanTugas(db, now).text;
    }
    case 'ujian': {
      return pesanUjian(db, now).text;
    }

    case 'tambahkelas': {
      const e = needAdmin(); if (e) return e;
      const r = parseKelas(arg);
      if (r.error) return `❌ ${r.error}\nContoh: /tambahkelas Senin | 08:00-09:40 | Kalkulus | R.301`;
      const id = db.addKelas(r.kelas);
      catat('tambah', 'jadwal', `${HARI_LABEL[r.kelas.hari]} ${r.kelas.mulai} ${r.kelas.matkul}`);
      return `✅ Kelas ditambahkan [${id}]: ${HARI_LABEL[r.kelas.hari]} ${r.kelas.mulai} *${r.kelas.matkul}*`;
    }
    case 'importjadwal': {
      const e = needAdmin(); if (e) return e;
      const lines = arg.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return 'Kirim /importjadwal lalu di baris berikutnya: Hari | jam | matkul | ruang | dosen (satu kelas per baris).';
      const ok = []; const gagal = [];
      for (const l of lines) {
        const r = parseKelas(l);
        if (r.error) gagal.push(`"${l}": ${r.error}`);
        else { db.addKelas(r.kelas); ok.push(r.kelas.matkul); }
      }
      if (ok.length) catat('tambah', 'jadwal', `Import ${ok.length} kelas`);
      return `✅ ${ok.length} kelas ditambahkan.` + (gagal.length ? `\n❌ Gagal:\n${gagal.join('\n')}` : '');
    }
    case 'tambahtugas': {
      const e = needAdmin(); if (e) return e;
      const [matkul, judul, tgl] = split(arg);
      const deadline = parseUserDate(tgl || '', now);
      if (!matkul || !judul || Number.isNaN(deadline)) return '❌ Format: /tambahtugas Matkul | Judul tugas | 28-11 23:59';
      const id = db.addTugas({ matkul, judul, deadline });
      catat('tambah', 'tugas', `${matkul}: ${judul}`);
      return `✅ Tugas ditambahkan [${id}]: *${matkul}* – ${judul}\n⏰ ${pretty(deadline)}`;
    }
    case 'tambahujian': {
      const e = needAdmin(); if (e) return e;
      const [matkul, jenis, tgl, ruang] = split(arg);
      const waktu = parseUserDate(tgl || '', now);
      if (!matkul || !jenis || Number.isNaN(waktu)) return '❌ Format: /tambahujian Matkul | UTS | 02-12 08:00 | Ruang';
      const id = db.addUjian({ matkul, jenis, waktu, ruang: ruang || null });
      catat('tambah', 'ujian', `${jenis} ${matkul}`);
      return `✅ Ujian ditambahkan [${id}]: *${jenis} ${matkul}*\n📅 ${pretty(waktu)}`;
    }
    case 'selesai': case 'hapustugas': case 'hapusujian': case 'hapuskelas': {
      const e = needAdmin(); if (e) return e;
      const id = parseInt(arg, 10);
      if (!id) return `❌ Tulis nomornya, contoh: /${cmd} 3`;
      const fn = { selesai: db.selesaiTugas, hapustugas: db.delTugas, hapusujian: db.delUjian, hapuskelas: db.delKelas }[cmd];
      if (!fn(id)) return `❌ Nomor ${id} tidak ditemukan.`;
      catat(cmd === 'selesai' ? 'ubah' : 'hapus', { selesai: 'tugas', hapustugas: 'tugas', hapusujian: 'ujian', hapuskelas: 'jadwal' }[cmd], cmd === 'selesai' ? `Tugas [${id}] ditandai selesai` : `Data [${id}] dihapus`);
      return cmd === 'selesai' ? `✅ Tugas [${id}] ditandai selesai. Mantap!` : `🗑️ Data [${id}] dihapus.`;
    }
    case 'minggu':
      return pesanMingguan(db, now).text;
    case 'cari': {
      if (arg.length < 2) return 'Tulis kata yang dicari, contoh: /cari laporan';
      const s = arg.toLowerCase();
      const tg = db.tugasAll().filter((x) => !x.selesai && `${x.judul} ${x.matkul} ${x.catatan || ''}`.toLowerCase().includes(s));
      const uj = db.ujianMendatang(now).filter((x) => `${x.jenis} ${x.matkul}`.toLowerCase().includes(s));
      const mk = db.matkulAll().filter((x) => x.nama.toLowerCase().includes(s));
      if (!tg.length && !uj.length && !mk.length) return `Tidak ada hasil untuk "${arg}".`;
      return [`🔎 *Hasil "${arg}"*`,
        mk.length ? `\n*Mata kuliah*\n${mk.map((m) => `• ${m.nama}${m.dosen ? ` (${m.dosen})` : ''}`).join('\n')}` : '',
        tg.length ? `\n*Tugas*\n${tg.slice(0, 8).map((x) => tugasLine(x, now)).join('\n')}` : '',
        uj.length ? `\n*Ujian*\n${uj.slice(0, 5).map((x) => ujianLine(x, now)).join('\n')}` : ''].filter(Boolean).join('\n');
    }
    case 'matkul': {
      if (!arg) return `Contoh: /matkul kalkulus\n\nDaftar: ${db.matkulAll().map((m) => m.nama).join(', ') || '-'}`;
      const m = cariMatkul(db, arg);
      if (!m) return `Mata kuliah "${arg}" tidak ditemukan.`;
      const jadwal = db.kelasAll().filter((k) => k.matkul.toLowerCase() === m.nama.toLowerCase());
      const tg = db.tugasAktif().filter((x) => x.matkul.toLowerCase() === m.nama.toLowerCase());
      const uj = db.ujianMendatang(now).filter((x) => x.matkul.toLowerCase() === m.nama.toLowerCase());
      const materi = db.materiByMatkul(m.id);
      return [`📘 *${m.nama}*`, m.dosen ? `👤 ${m.dosen}${m.kontak ? ` · ${m.kontak}` : ''}` : '',
        jadwal.length ? `🗓️ ${jadwal.map((k) => `${HARI_LABEL[k.hari]} ${k.mulai}${k.ruang ? ' @ ' + k.ruang : ''}`).join(', ')}` : '',
        tg.length ? `\n*Tugas aktif*\n${tg.map((x) => tugasLine(x, now)).join('\n')}` : '\n✅ Tidak ada tugas aktif',
        uj.length ? `\n*Ujian*\n${uj.map((x) => ujianLine(x, now)).join('\n')}` : '',
        materi.length ? `\n*Materi*\n${materi.map((x) => `• ${x.judul}: ${x.url}`).join('\n')}` : '',
        m.catatan ? `\n📝 ${m.catatan}` : ''].filter(Boolean).join('\n');
    }
    case 'materi': {
      if (!arg) return 'Contoh: /materi kalkulus';
      const m = cariMatkul(db, arg);
      if (!m) return `Mata kuliah "${arg}" tidak ditemukan.`;
      const materi = db.materiByMatkul(m.id);
      return materi.length ? `📚 *Materi ${m.nama}*\n${materi.map((x) => `• ${x.judul}\n  ${x.url}`).join('\n')}` : `Belum ada link materi untuk ${m.nama}.`;
    }
    case 'kumpul': case 'batalkumpul': {
      if (!akun) return 'Nomor WhatsApp ini belum terhubung ke akun web. Minta admin menambahkan nomormu di menu Management Akun.';
      const id = parseInt(arg, 10);
      const tg = id && db.tugasById(id);
      if (!tg) return `❌ Tulis nomor tugasnya, contoh: /${cmd} 3`;
      db.setKumpul(id, akun.id, cmd === 'kumpul');
      return cmd === 'kumpul' ? `✅ Tugas [${id}] *${tg.matkul}: ${tg.judul}* ditandai sudah kamu kumpulkan.` : `↩️ Tugas [${id}] ditandai belum kamu kumpulkan.`;
    }
    default:
      return null;
  }
}

/**
 * Balasan "udah"/"sudah" ke pesan pengingat tugas → tandai kumpul.
 * Nomor tugas diambil dari pesan yang dibalas ("/kumpul 3" atau "[3]").
 */
function handleBalasan(db, text, quoted, akun) {
  if (!/^\s*(udah|sudah|udh|sdh|done|beres|kumpul|sudah kumpul|udah kumpul)\b/i.test(text || '') || !quoted) return null;
  const m = /\/kumpul\*? ?(\d+)/.exec(quoted.replace(/\*/g, '')) || /\(#(\d+)\)/.exec(quoted) || /\[(\d+)\]/.exec(quoted);
  if (!m) return null;
  if (!akun) return 'Nomor WhatsApp ini belum terhubung ke akun web, jadi belum bisa ditandai. Minta admin menambahkan nomormu.';
  const tg = db.tugasById(Number(m[1]));
  if (!tg) return null;
  db.setKumpul(tg.id, akun.id, true);
  return `✅ Sip, *${tg.matkul}: ${tg.judul}* ditandai sudah kamu kumpulkan.`;
}

module.exports = { handle, handleBalasan, MENU };
