// Backup otomatis database SQLite: satu salinan per hari, simpan N terakhir.
const fs = require('fs');
const path = require('path');
const { local } = require('./time');

const DEFAULT_DIR = path.join(__dirname, '..', 'data', 'backups');
const NAME_RE = /^kuliah-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})\.db$/;
const pad = (n) => String(n).padStart(2, '0');

function listBackups(dir = DEFAULT_DIR) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => NAME_RE.test(n)).map((name) => {
    const st = fs.statSync(path.join(dir, name));
    return { name, size: st.size, at: st.mtimeMs };
  }).sort((a, b) => b.name.localeCompare(a.name));
}

/** Buat backup sekarang (aman walau bot sedang menulis), lalu buang yang lama. */
async function backupNow(db, { dir = DEFAULT_DIR, keep = 14, now = Date.now() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const t = local(now);
  const name = `kuliah-${t.y}-${pad(t.mo)}-${pad(t.d)}_${pad(t.h)}${pad(t.mi)}.db`;
  const tmp = path.join(dir, `.${name}.tmp`);
  await db.raw.backup(tmp);
  fs.renameSync(tmp, path.join(dir, name));
  const all = listBackups(dir);
  for (const old of all.slice(Math.max(1, keep))) fs.rmSync(path.join(dir, old.name), { force: true });
  return all.find((b) => b.name === name) || { name, size: 0, at: now };
}

const dayKey = (ms) => { const t = local(ms); return `${t.y}-${pad(t.mo)}-${pad(t.d)}`; };

/** Apakah backup harian sudah waktunya: lewat jam `at` dan hari ini belum ada backup. */
function backupDue(list, at, now = Date.now()) {
  const t = local(now);
  const [h, m] = String(at).split(':').map(Number);
  if (t.h * 60 + t.mi < h * 60 + (m || 0)) return false;
  const today = dayKey(now);
  return !list.some((b) => b.name.startsWith(`kuliah-${today}_`));
}

function startAutoBackup(db, { dir = DEFAULT_DIR, at = '02:00', keep = 14, log = console } = {}) {
  let busy = false;
  const check = async () => {
    if (busy || !backupDue(listBackups(dir), at)) return;
    busy = true;
    try { const b = await backupNow(db, { dir, keep }); log.info?.({ file: b.name }, 'backup database dibuat'); }
    catch (err) { log.error?.({ err }, 'backup database gagal'); }
    finally { busy = false; }
  };
  check();
  return setInterval(check, 60 * 1000);
}

module.exports = { DEFAULT_DIR, NAME_RE, listBackups, backupNow, backupDue, startAutoBackup };
