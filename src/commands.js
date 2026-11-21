const { local, parseUserDate, parseHM, parseHari, pretty, HARI_LABEL } = require('./time');
const { tugasLine, ujianLine, jadwalHari } = require('./format');

const MENU = `🤖 *Bot Pengingat Kuliah*

*Lihat*
/hari – jadwal hari ini
/besok – jadwal besok
/jadwal – jadwal seminggu
/tugas – daftar tugas aktif
/ujian – daftar ujian mendatang

*Tambah (admin)*
/tambahkelas Senin | 08:00-09:40 | Kalkulus | R.301 | Pak Budi
/tambahtugas Basis Data | Laporan ERD | 28-11 23:59
/tambahujian Kalkulus | UTS | 02-12 08:00 | R.301
/importjadwal (lalu tiap baris: Hari | jam | matkul | ruang | dosen)

*Ubah (admin)*
/selesai 3 – tandai tugas no. 3 selesai
/hapustugas 3 · /hapusujian 2 · /hapuskelas 5

/web – alamat web pengelola
login – kirim di chat pribadi ke bot untuk dapat link masuk web
/groupid – tampilkan ID chat ini

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

function handle(db, text, { isAdmin = false, chatJid = '', now = Date.now(), webUrl = process.env.WEB_URL || '' } = {}) {
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
    case 'hari':
      return jadwalHari(db.kelasByHari(t.dow), t.dow);
    case 'besok': {
      const d = (t.dow + 1) % 7;
      return jadwalHari(db.kelasByHari(d), d);
    }
    case 'jadwal': {
      const all = db.kelasAll();
      if (!all.length) return 'Jadwal kelas masih kosong. Admin bisa isi pakai /tambahkelas atau /importjadwal.';
      const hariUrut = [1, 2, 3, 4, 5, 6, 0];
      return '🗓️ *Jadwal Mingguan*\n\n' + hariUrut
        .map((h) => all.filter((k) => k.hari === h))
        .filter((ks) => ks.length)
        .map((ks) => `*${HARI_LABEL[ks[0].hari]}*\n` + ks.map((k) => `• [${k.id}] ${k.mulai}${k.selesai ? '–' + k.selesai : ''} *${k.matkul}*${k.ruang ? ' @ ' + k.ruang : ''}`).join('\n'))
        .join('\n\n');
    }
    case 'tugas': {
      const list = db.tugasAktif();
      if (!list.length) return '✅ Tidak ada tugas aktif.';
      return '📝 *Tugas Aktif*\n' + list.map((x) => (x.deadline < now ? tugasLine(x, now).replace('⏰', '⚠️ LEWAT') : tugasLine(x, now))).join('\n');
    }
    case 'ujian': {
      const list = db.ujianMendatang(now);
      if (!list.length) return 'Belum ada ujian terjadwal.';
      return '📚 *Ujian Mendatang*\n' + list.map((u) => ujianLine(u, now)).join('\n');
    }

    case 'tambahkelas': {
      const e = needAdmin(); if (e) return e;
      const r = parseKelas(arg);
      if (r.error) return `❌ ${r.error}\nContoh: /tambahkelas Senin | 08:00-09:40 | Kalkulus | R.301`;
      const id = db.addKelas(r.kelas);
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
      return `✅ ${ok.length} kelas ditambahkan.` + (gagal.length ? `\n❌ Gagal:\n${gagal.join('\n')}` : '');
    }
    case 'tambahtugas': {
      const e = needAdmin(); if (e) return e;
      const [matkul, judul, tgl] = split(arg);
      const deadline = parseUserDate(tgl || '', now);
      if (!matkul || !judul || Number.isNaN(deadline)) return '❌ Format: /tambahtugas Matkul | Judul tugas | 28-11 23:59';
      const id = db.addTugas({ matkul, judul, deadline });
      return `✅ Tugas ditambahkan [${id}]: *${matkul}* – ${judul}\n⏰ ${pretty(deadline)}`;
    }
    case 'tambahujian': {
      const e = needAdmin(); if (e) return e;
      const [matkul, jenis, tgl, ruang] = split(arg);
      const waktu = parseUserDate(tgl || '', now);
      if (!matkul || !jenis || Number.isNaN(waktu)) return '❌ Format: /tambahujian Matkul | UTS | 02-12 08:00 | Ruang';
      const id = db.addUjian({ matkul, jenis, waktu, ruang: ruang || null });
      return `✅ Ujian ditambahkan [${id}]: *${jenis} ${matkul}*\n📅 ${pretty(waktu)}`;
    }
    case 'selesai': case 'hapustugas': case 'hapusujian': case 'hapuskelas': {
      const e = needAdmin(); if (e) return e;
      const id = parseInt(arg, 10);
      if (!id) return `❌ Tulis nomornya, contoh: /${cmd} 3`;
      const fn = { selesai: db.selesaiTugas, hapustugas: db.delTugas, hapusujian: db.delUjian, hapuskelas: db.delKelas }[cmd];
      if (!fn(id)) return `❌ Nomor ${id} tidak ditemukan.`;
      return cmd === 'selesai' ? `✅ Tugas [${id}] ditandai selesai. Mantap!` : `🗑️ Data [${id}] dihapus.`;
    }
    default:
      return null;
  }
}

module.exports = { handle, MENU };
