// Akun & sesi: password di-hash scrypt, token Bearer bertanda tangan HMAC.
const crypto = require('crypto');

const ROLES = ['admin', 'editor', 'viewer'];
const SESSION_DAYS = 14;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `scrypt$${salt}$${h}`;
}

function checkPassword(pw, stored) {
  const [alg, salt, h] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !h) return false;
  const a = crypto.scryptSync(String(pw), salt, 32);
  const b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString();

// Sidik jari password: token lama otomatis tidak berlaku setelah password diganti.
const pwVer = (hash) => crypto.createHash('sha256').update(String(hash)).digest('base64url').slice(0, 12);

function makeToken(secret, id, days = SESSION_DAYS, v) {
  const body = b64(JSON.stringify({ id, exp: Date.now() + days * 86400000, ...(v ? { v } : {}) }));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readToken(secret, token = '') {
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(unb64(body));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

/** Buat akun admin pertama dari ADMIN_PASSWORD kalau belum ada akun sama sekali. */
function bootstrapAdmin(db, password) {
  if (db.akunCount() > 0 || !password) return false;
  db.addAkun({ username: 'admin', nama: 'Admin', role: 'admin', hash: hashPassword(password) });
  return true;
}

module.exports = { ROLES, hashPassword, checkPassword, makeToken, readToken, bootstrapAdmin, pwVer };
