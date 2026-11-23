// Laporan kondisi server harian, dikirim ke nomor WA admin saja (bukan ke grup).
// Isi: VPS (uptime, beban CPU, RAM, disk), aplikasi pm2 (bot ini, portofolio, dll.),
// situs (status HTTP, waktu respons, masa berlaku SSL), dan kesehatan bot WhatsApp.
const os = require('os');
const fs = require('fs');
const tls = require('tls');
const { execFile } = require('child_process');
const { listBackups } = require('./backup');
const { tanggalPanjang } = require('./format');

const MB = 1024 * 1024; const GB = 1024 * MB;
const gb = (b) => (b >= GB ? `${(b / GB).toFixed(1)} GB` : `${Math.round(b / MB)} MB`);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
function lama(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} menit`;
  const j = Math.floor(m / 60); if (j < 48) return `${j} jam`;
  return `${Math.floor(j / 24)} hari`;
}

/** Daftar aplikasi pm2 lewat `pm2 jlist`. Gagal → null. */
function pm2List(timeout = 10000) {
  return new Promise((resolve) => {
    execFile('pm2', ['jlist'], { timeout, maxBuffer: 8 * MB }, (err, out) => {
      if (err) return resolve(null);
      try {
        const i = out.indexOf('['); // pm2 kadang mencetak pesan sebelum JSON
        resolve(JSON.parse(out.slice(i)).map((p) => ({
          nama: p.name, status: p.pm2_env?.status, restart: p.pm2_env?.restart_time || 0,
          sejak: p.pm2_env?.pm_uptime, mem: p.monit?.memory || 0, cpu: p.monit?.cpu || 0,
        })));
      } catch { resolve(null); }
    });
  });
}

/** Sisa hari sertifikat SSL. Gagal → null. */
function sisaSsl(host, timeout = 8000) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout, rejectUnauthorized: false }, () => {
      const c = s.getPeerCertificate(); s.end();
      resolve(c?.valid_to ? Math.floor((new Date(c.valid_to).getTime() - Date.now()) / 86400000) : null);
    });
    s.on('error', () => resolve(null)); s.on('timeout', () => { s.destroy(); resolve(null); });
  });
}

/** Cek satu situs: status HTTP, waktu respons, SSL. */
async function cekSitus(url, timeout = 10000) {
  const t0 = Date.now(); let u;
  try { u = new URL(url); } catch { return { url, ok: false, error: 'URL tidak valid' }; }
  const out = { url, host: u.host };
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'six-seven-67-monitor' } });
    out.status = r.status; out.ms = Date.now() - t0; out.ok = r.status < 400;
    r.body?.cancel?.().catch(() => {});
  } catch (e) { out.ok = false; out.ms = Date.now() - t0; out.error = e.name === 'TimeoutError' ? 'tidak merespons (timeout)' : (e.cause?.code || e.message); }
  if (u.protocol === 'https:') out.ssl = await sisaSsl(u.hostname);
  return out;
}

function disk(dir) {
  try { const s = fs.statfsSync(dir); return { total: s.blocks * s.bsize, bebas: s.bavail * s.bsize }; } catch { return null; }
}

/**
 * Susun teks laporan. Semua sumber bisa diganti untuk tes (opsi `sumber`).
 * @returns {{ text: string, masalah: number }}
 */
async function buatLaporan({ db, bot, situs = [], dbFile, now = Date.now(), sumber = {} }) {
  const masalah = [];
  const s = {
    load: sumber.load || os.loadavg(), cpu: sumber.cpu || os.cpus().length,
    memTotal: sumber.memTotal ?? os.totalmem(), memBebas: sumber.memBebas ?? os.freemem(),
    uptime: sumber.uptime ?? os.uptime(), disk: sumber.disk !== undefined ? sumber.disk : disk('/'),
    pm2: sumber.pm2 !== undefined ? sumber.pm2 : await pm2List(),
    situs: sumber.situs || await Promise.all(situs.map((x) => cekSitus(x))),
    host: sumber.host || os.hostname(),
  };

  // ---- VPS ----
  const memPakai = s.memTotal - s.memBebas; const memP = pct(memPakai, s.memTotal);
  const beban = s.load[0] / s.cpu;
  const vps = [`🖥️ *Server (${s.host})*`, `    ⏱️ Menyala ${lama(s.uptime * 1000)}`];
  vps.push(`    ${beban >= 1 ? '⚠️' : '⚙️'} Beban CPU ${s.load.map((x) => x.toFixed(2)).join(' / ')} (${s.cpu} core)`);
  if (beban >= 1) masalah.push('beban CPU tinggi');
  vps.push(`    ${memP >= 90 ? '⚠️' : '🧠'} RAM ${gb(memPakai)} / ${gb(s.memTotal)} (${memP}%)`);
  if (memP >= 90) masalah.push('RAM hampir penuh');
  if (s.disk) {
    const dp = pct(s.disk.total - s.disk.bebas, s.disk.total);
    vps.push(`    ${dp >= 85 ? '⚠️' : '💾'} Disk ${gb(s.disk.total - s.disk.bebas)} / ${gb(s.disk.total)} (${dp}%), sisa ${gb(s.disk.bebas)}`);
    if (dp >= 85) masalah.push('disk hampir penuh');
  }

  // ---- Aplikasi pm2 ----
  const app = ['📦 *Aplikasi (pm2)*'];
  if (!s.pm2) app.push('    ⚠️ Daftar pm2 tidak bisa dibaca');
  else if (!s.pm2.length) app.push('    Tidak ada aplikasi terdaftar');
  else {
    for (const p of s.pm2) {
      const on = p.status === 'online';
      if (!on) masalah.push(`${p.nama} ${p.status || 'mati'}`);
      app.push(`▸ ${on ? '✅' : '❌'} *${p.nama}* · ${on ? `jalan ${lama(now - (p.sejak || now))}` : p.status || 'mati'}`);
      app.push(`    RAM ${gb(p.mem)} · CPU ${p.cpu}%${p.restart ? ` · restart ${p.restart}×` : ''}`);
    }
  }

  // ---- Situs ----
  const web = s.situs.length ? ['🌐 *Situs*'] : [];
  for (const x of s.situs) {
    if (!x.ok) masalah.push(`${x.host || x.url} tidak bisa dibuka`);
    if (x.ssl != null && x.ssl < 14) masalah.push(`SSL ${x.host} berakhir ${x.ssl} hari lagi`);
    web.push(`▸ ${x.ok ? '✅' : '❌'} *${x.host || x.url}*`);
    web.push(`    ${x.ok ? `HTTP ${x.status} · ${x.ms} ms` : x.status ? `HTTP ${x.status}` : x.error}${x.ssl != null ? ` · ${x.ssl < 14 ? '⚠️ ' : '🔒 '}SSL ${x.ssl < 0 ? 'sudah kedaluwarsa' : `${x.ssl} hari lagi`}` : ''}`);
  }

  // ---- Bot & data ----
  const st = bot?.status?.() || {};
  const sejak = now - 86400000;
  const log24 = db.logHarian(sejak).reduce((a, r) => { a[r.status] = (a[r.status] || 0) + r.n; return a; }, {});
  const bk = listBackups()[0];
  let ukuran = null; try { ukuran = dbFile ? fs.statSync(dbFile).size : null; } catch { /* abaikan */ }
  if (!st.wa) masalah.push('WhatsApp bot terputus');
  if (log24.gagal) masalah.push(`${log24.gagal} pesan gagal terkirim`);
  if (!bk || now - bk.at > 2 * 86400000) masalah.push('backup database sudah lama');
  const botBaris = [
    '🤖 *Bot iwak67gacor*',
    `    ${st.wa ? '✅ WhatsApp terhubung' : '❌ WhatsApp terputus'}${st.grupNama ? ` · grup ${st.grupNama}` : st.grupJid ? '' : ' · grup belum diatur'}`,
    `    📨 24 jam: ${log24.terkirim || 0} terkirim${log24.gagal ? `, ⚠️ ${log24.gagal} gagal` : ', 0 gagal'}`,
    `    ${bk ? (now - bk.at > 2 * 86400000 ? '⚠️' : '🗄️') : '⚠️'} Backup terakhir: ${bk ? `${lama(now - bk.at)} lalu (${gb(bk.size)})` : 'belum ada'}${ukuran ? ` · DB ${gb(ukuran)}` : ''}`,
  ];
  const akun = db.akunAll ? db.akunAll().filter((a) => a.status === 'aktif').length : null;
  const tugas = db.tugasAktif().length; const prak = db.prakTugasAktif ? db.prakTugasAktif().length : 0;
  botBaris.push(`    📊 ${akun != null ? `${akun} akun aktif · ` : ''}${tugas} tugas aktif${prak ? ` · ${prak} tugas praktikum` : ''}`);

  const ringkas = masalah.length ? `⚠️ *${masalah.length} hal perlu dicek:* ${masalah.join(', ')}` : '✅ *Semua normal*';
  const text = [`🛠️ *Laporan server harian*\n_${tanggalPanjang(now)}_`, ringkas, vps.join('\n'), app.join('\n'), web.join('\n'), botBaris.join('\n'),
    '_Pesan ini hanya dikirim ke nomor admin. Atur di web: Pengingat → Laporan server._'].filter(Boolean).join('\n\n');
  return { text, masalah: masalah.length };
}

module.exports = { buatLaporan, cekSitus, pm2List };
