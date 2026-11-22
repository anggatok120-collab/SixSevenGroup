/* Pengingat Kuliah: web pengelola. Web = tempat mengubah data, bot WA = pengirim pengingat. */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const HARI3 = ['MIN', 'SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB'];
const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const ROLE_LABEL = { admin: 'Admin', editor: 'Editor', viewer: 'Anggota' };
const DAY = 864e5, TZ = 7 * 36e5; // WIB

let jmode = 'papan'; try { jmode = localStorage.getItem('jmode') || 'papan'; } catch {}
const S = { jmode, cal: null, rwFilter: 'semua', pengumuman: null, riwayat: null, icsPath: null, dashScope: 'today', dashDay: null, user: null, view: 'dashboard', data: { kelas: [], tugas: [], ujian: [], bot: {} }, skew: 0, filter: 'aktif', q: '', qUjian: '', pengingat: null, status: null, akun: null };
let token = null;
try { token = sessionStorage.getItem('token'); } catch {}
const canEdit = () => ['admin', 'editor'].includes(S.user?.role);
const isAdmin = () => S.user?.role === 'admin';
const now = () => Date.now() + S.skew;

// ---------- Waktu (selalu WIB, tidak tergantung zona waktu HP) ----------
const w = (ms) => { const d = new Date(ms + TZ); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; };
const dayKey = (ms) => { const t = w(ms); return `${t.y}-${t.m}-${t.d}`; };
const startOfDay = (ms) => { const t = w(ms); return Date.UTC(t.y, t.m, t.d) - TZ; };
const hm = (ms) => { const t = w(ms); return `${String(t.h).padStart(2, '0')}:${String(t.mi).padStart(2, '0')}`; };
const tgl = (ms) => { const t = w(ms); return `${HARI[t.dow]}, ${t.d} ${BULAN[t.m]}`; };
const atToday = (base, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return startOfDay(base) + (h * 60 + m) * 6e4; };
function dueBadge(ms, done) {
  if (done) return ['b-done', 'Selesai'];
  const n = now();
  if (ms < n) return ['b-urgent', 'Terlambat'];
  const diff = Math.round((startOfDay(ms) - startOfDay(n)) / DAY);
  if (diff === 0) return ['b-urgent', 'Hari Ini'];
  if (diff === 1) return ['b-warn', 'Besok'];
  if (diff <= 3) return ['b-warn', `${diff} Hari Lagi`];
  if (diff <= 7) return ['b-info', `${diff} Hari Lagi`];
  return ['b-normal', `${w(ms).d} ${BULAN[w(ms).m]}`];
}
// Format WhatsApp sederhana: *tebal* dan _miring_
const waFormat = (t) => esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|[\s(])_([^_\n]+)_/g, '$1<i>$2</i>').replace(/(^|\s)~([^~\n]+)~/g, '$1<s>$2</s>');
const badge = ([cls, txt]) => `<span class="badge ${cls}">${esc(txt)}</span>`;

// ---------- Warna mata kuliah ----------
const MK_WARNA = { biru: '#60a5fa', toska: '#2dd4bf', hijau: '#4ade80', lime: '#a3e635', kuning: '#facc15', oranye: '#fb923c', merah: '#f87171', pink: '#f472b6', ungu: '#c084fc', indigo: '#818cf8' };
const MK_KEYS = Object.keys(MK_WARNA);
const mkHash = (s) => [...String(s || '').toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
// Warna pilihan di menu Mata Kuliah; kalau belum dipilih, otomatis dari nama (tetap sama tiap kali).
const mkKey = (nama) => { const m = (S.data.matkul || []).find((x) => x.nama.toLowerCase() === String(nama || '').toLowerCase()); return m?.warna || MK_KEYS[mkHash(nama) % MK_KEYS.length]; };
const mkVar = (nama) => `--mk:${MK_WARNA[mkKey(nama)]}`;
const mkChip = (nama) => `<span class="chip mk-chip" style="${mkVar(nama)}">${esc(nama)}</span>`;

// ---------- Jadwal per tanggal: rutin + kelas batal + kuliah pengganti ----------
const p2 = (x) => String(x).padStart(2, '0');
const ymdOf = (ms) => { const t = w(ms); return `${t.y}-${p2(t.m + 1)}-${p2(t.d)}`; };
const msOfYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) - TZ; };
function kelasPada(dayMs) {
  const tgl = ymdOf(dayMs); const dow = w(dayMs).dow;
  const ub = (S.data.kelasUbah || []).filter((u) => u.tanggal === tgl);
  const rutin = S.data.kelas.filter((k) => k.hari === dow).map((k) => {
    const b = ub.find((u) => u.jenis === 'batal' && u.kelas_id === k.id);
    return { ...k, batal: !!b, ubahId: b?.id || null, alasan: b?.catatan || null };
  });
  const pg = ub.filter((u) => u.jenis === 'pengganti').map((u) => ({ id: `p${u.id}`, ubahId: u.id, hari: dow, mulai: u.mulai, selesai: u.selesai, matkul: u.matkul, ruang: u.ruang, dosen: u.dosen, pengganti: true, batal: false, alasan: u.catatan }));
  return [...rutin, ...pg].sort((a, b) => a.mulai.localeCompare(b.mulai));
}
// Tanggal pertemuan berikutnya untuk kelas rutin (dipakai tombol "Batalkan pertemuan").
const nextDateOf = (k) => { const sod = startOfDay(now()); for (let i = 0; i < 7; i++) { const d = sod + i * DAY; if (w(d).dow === k.hari && (i || atToday(d, k.mulai) > now())) return ymdOf(d); } return ymdOf(sod + 7 * DAY); };
const detailAttr = (k) => (k.pengganti ? `data-detail="ubah" data-id="${k.ubahId}"` : `data-detail="kelas" data-id="${k.id}"`);
// Tombol "sudah kumpul" milik akun yang sedang masuk (semua peran boleh).
const kumpulBtn = (t, compact) => (t.selesai ? '' : `<button class="kumpul-btn" data-kumpul="${t.id}" aria-pressed="${!!t.kumpulSaya}" title="${t.kumpulSaya ? 'Kamu sudah kumpul. Klik untuk membatalkan' : 'Tandai sudah kamu kumpulkan'}"><i class="ph${t.kumpulSaya ? '-fill' : ''} ph-${t.kumpulSaya ? 'check-circle' : 'tray-arrow-up'}"></i>${compact ? '' : `<span>${t.kumpulSaya ? 'Sudah kumpul' : 'Kumpul'}</span>`}<em aria-label="${t.kumpulN || 0} dari ${S.data.anggota || 0} anggota sudah kumpul">${t.kumpulN || 0}/${S.data.anggota || 0}</em></button>`);
function relMinutes(min) {
  if (min < 60) return `${min} menit`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} jam ${m} menit` : `${h} jam`;
}

// ---------- API ----------
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { logout(true); throw new Error(j.error || 'Sesi berakhir'); }
  if (!r.ok) throw new Error(j.error || 'Terjadi kesalahan');
  return j;
}
function logout(expired) {
  try { sessionStorage.removeItem('token'); } catch {}
  location.replace('/login' + (expired ? `?next=${encodeURIComponent(location.pathname + location.hash)}` : ''));
}

// ---------- Toast ----------
let toastTimer;
function toast(msg, kind = 'success', aksi = null) {
  const t = $('#toast');
  $('#toastAksi')?.remove();
  if (aksi) {
    const b = Object.assign(document.createElement('button'), { id: 'toastAksi', className: 'btn btn-secondary btn-sm', type: 'button', textContent: aksi.label });
    b.onclick = () => { t.classList.remove('show'); aksi.fn(); };
    $('#toastClose').before(b);
  }
  t.classList.toggle('error', kind === 'error');
  t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  $('i', t).className = kind === 'error' ? 'ph-fill ph-warning-circle' : 'ph-fill ph-check-circle';
  $('#toastText').textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), aksi ? 8000 : 3600);
}
$('#toastClose').onclick = () => $('#toast').classList.remove('show');

// Konfirmasi di dalam aplikasi (pengganti confirm() bawaan browser), hanya untuk aksi yang menghapus data.
function askConfirm(title, text, okLabel = 'Hapus') {
  const dlg = $('#confirmDlg');
  $('#cTitle').textContent = title; $('#cText').textContent = text; $('#cYes').innerHTML = `<i class="ph ph-trash"></i>${okLabel}`;
  return new Promise((resolve) => {
    const done = (v) => { dlg.close(); resolve(v); };
    $('#cYes').onclick = () => done(true); $('#cNo').onclick = () => done(false);
    dlg.oncancel = (e) => { e.preventDefault(); done(false); };
    dlg.onclick = (e) => { if (e.target === dlg) done(false); };
    dlg.showModal(); setTimeout(() => $('#cNo').focus(), 20);
  });
}

// ---------- Navigasi ----------
const NAV = [
  { title: 'Ringkasan', items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'squares-four' },
  ] },
  { title: 'Jadwal', items: [
    { id: 'matkul', label: 'Mata Kuliah', icon: 'books' },
    { id: 'jadwal', label: 'Jadwal Kuliah', icon: 'book-open' },
    { id: 'kalender', label: 'Kalender', icon: 'calendar' },
    { id: 'ujian', label: 'Jadwal Ujian', icon: 'clipboard-text' },
  ] },
  { title: 'Praktikum', items: [
    { id: 'praktikum', label: 'Praktikum', icon: 'flask', badge: () => (S.data.prak?.tugas || []).filter((t) => !t.selesai && !t.kumpulSaya).length },
  ] },
  { title: 'Pekerjaan', items: [
    { id: 'tugas', label: 'Tugas', icon: 'list-checks', badge: () => S.data.tugas.filter((t) => !t.selesai).length },
    { id: 'pengumuman', label: 'Pengumuman', icon: 'megaphone', roles: ['admin', 'editor'] },
    { id: 'pengingat', label: 'Pengingat', icon: 'bell', roles: ['admin'] },
  ] },
  { title: 'Akun', items: [
    { id: 'akun', label: 'Management Akun', icon: 'users', roles: ['admin'] },
    { id: 'riwayat', label: 'Riwayat Perubahan', icon: 'clock-counter-clockwise', roles: ['admin'] },
    { id: 'status', label: 'Status Bot', icon: 'robot', roles: ['admin'] },
    { id: 'profil', label: 'Profil', icon: 'user' },
  ] },
];
const META = {
  dashboard: ['Dashboard', 'Ringkasan kelas, tugas, dan ujian kamu'],
  matkul: ['Mata Kuliah', 'Daftar mata kuliah semester ini'],
  jadwal: ['Jadwal Kuliah', 'Jadwal rutin mingguan yang dipakai bot untuk mengingatkan grup'],
  kalender: ['Kalender', 'Kelas, tenggat tugas, dan ujian dalam satu bulan'],
  pengumuman: ['Pengumuman', 'Kirim pesan ke grup WhatsApp kelas, sekarang atau terjadwal'],
  riwayat: ['Riwayat Perubahan', 'Siapa mengubah apa, dan kapan'],
  tugas: ['Tugas', 'Daftar tugas beserta tenggatnya'],
  ujian: ['Ujian', 'UTS, UAS, kuis, dan praktikum'],
  pengingat: ['Pusat Pengingat', 'Atur kapan bot WhatsApp mengirim pengingat ke grup'],
  status: ['Status Bot', 'Kesehatan bot WhatsApp dan riwayat pengiriman'],
  akun: ['Kelola Akun', 'Siapa saja yang bisa masuk dan apa perannya'],
  'matkul-detail': ['Mata Kuliah', 'Semua tentang satu mata kuliah'],
  praktikum: ['Praktikum', 'Jadwal, tugas, dan kalender praktikum, terpisah dari kuliah biasa'],
  profil: ['Profil Saya', 'Nama dan password akun kamu'],
};
const allowed = (it) => !it.roles || it.roles.includes(S.user.role);

function renderNav() {
  $('#nav').innerHTML = NAV.map((g) => {
    const items = g.items.filter(allowed);
    if (!items.length) return '';
    return `<div class="nav-group"><div class="nav-title">${g.title}</div>${items.map((it) => {
      const on = S.view === it.id || (S.view === 'matkul-detail' && it.id === 'matkul'); const b = it.badge ? it.badge() : 0;
      return `<button data-view="${it.id}" class="${on ? 'active' : ''}" ${on ? 'aria-current="page"' : ''}><i class="ph ph-${it.icon}"></i><span>${it.label}</span>${b ? `<em class="nav-badge" aria-label="${b} ${it.id === 'praktikum' ? 'tugas praktikum belum dikumpulkan' : 'tugas aktif'}">${b}</em>` : ''}</button>`;
    }).join('')}</div>`;
  }).join('');
}
const TABS = [['dashboard', 'Beranda', 'house'], ['jadwal', 'Jadwal', 'calendar-dots'], ['tugas', 'Tugas', 'list-checks'], ['ujian', 'Ujian', 'clipboard-text']];
function renderTabbar() {
  const main = TABS.some(([id]) => id === S.view);
  $('#tabbar').innerHTML = TABS.map(([id, label, icon]) => {
    const on = S.view === id;
    return `<button data-view="${id}" ${on ? 'aria-current="page"' : ''}><i class="ph${on ? '-fill' : ''} ph-${icon}"></i>${label}</button>`;
  }).join('') + `<button id="tabMore" ${main ? '' : 'aria-current="page"'}><i class="ph${main ? '' : '-fill'} ph-dots-three-outline"></i>Lainnya</button>`;
  $('#tabMore').onclick = () => $('#shell').classList.add('nav-open');
}
// Animasi masuk: hanya saat pindah menu atau saat data menu pertama kali tiba.
function enterAnim(draw) {
  const c = $('#content');
  c.classList.remove('enter'); void c.offsetWidth; c.classList.add('enter');
  clearTimeout(enterAnim.t); enterAnim.t = setTimeout(() => c.classList.remove('enter'), 1400);
  draw(); countUp(c);
}
function go(view) {
  // Halaman detail mata kuliah: #matkul/ID
  const mkm = /^matkul\/(\d+)$/.exec(view || '');
  if (mkm) { S.mkId = Number(mkm[1]); view = 'matkul-detail'; }
  const item = NAV.flatMap((g) => g.items).find((i) => i.id === view);
  if (view !== 'matkul-detail' && (!item || !allowed(item))) view = 'dashboard';
  S.view = view;
  const hash = view === 'matkul-detail' ? `matkul/${S.mkId}` : view;
  if (location.hash !== '#' + hash) history.replaceState(null, '', '#' + hash);
  $('#shell').classList.remove('nav-open');
  enterAnim(render);
  window.scrollTo(0, 0);
  $('#pageTitle').focus({ preventScroll: true });
  if (view === 'pengingat') loadPengingat();
  if (view === 'status') loadStatus();
  if (view === 'akun') loadAkun();
  if (view === 'pengumuman') loadPengumuman();
  if (view === 'riwayat') loadRiwayat();
  if (view === 'profil') loadIcs();
}

// Ikon dekoratif disembunyikan dari pembaca layar; label tetap di teks/aria-label tombol.
function a11yPass() {
  queueMicrotask(() => $$('i[class*="ph-"]:not([aria-hidden])').forEach((i) => i.setAttribute('aria-hidden', 'true')));
}

// ---------- Render utama ----------
function render() {
  renderNav();
  renderTabbar();
  const [t, sub] = META[S.view];
  const tn = w(now());
  $('#pageTitle').textContent = t; $('#pageTitle').title = sub; $('#pageSub').textContent = `${HARI[tn.dow]}, ${tn.d} ${BULAN_PANJANG[tn.m]} ${tn.y}`;
  document.title = `${t} · Six Seven 67`;
  const aktif = S.data.tugas.filter((x) => !x.selesai).length;
  $('#bellCount').textContent = `${aktif} tugas aktif`; $('#bellCount').dataset.n = aktif;
  $('#bellBtn').setAttribute('aria-label', aktif ? `${aktif} tugas aktif, buka daftar tugas` : 'Tidak ada tugas aktif, buka daftar tugas');
  const b = S.data.bot || {};
  $('#botDot').classList.toggle('on', !!(b.wa && b.grup));
  $('#botText').textContent = b.wa ? (b.grup ? 'Bot WA aktif' : 'Bot aktif, grup belum diatur') : 'Bot WA offline';
  a11yPass();
  ({ 'matkul-detail': () => viewMatkulDetail(), dashboard: viewDashboard, matkul: viewMatkul, jadwal: viewJadwal, kalender: viewKalender, pengumuman: viewPengumuman, riwayat: viewRiwayat, tugas: viewTugas, ujian: viewUjian, praktikum: () => viewPraktikum(), pengingat: viewPengingat, status: viewStatus, akun: viewAkun, profil: viewProfil })[S.view]();
}

// Ilustrasi garis sederhana untuk keadaan kosong (warna mengikuti teks, jadi tetap hitam-putih).
const ILLUS = {
  calendar: '<rect x="10" y="14" width="44" height="40" rx="7"/><path d="M10 25h44M21 9v9M43 9v9"/><path d="M32 33v12M26 39h12" class="accent"/>',
  tasks: '<rect x="14" y="10" width="36" height="46" rx="6"/><path d="M25 10v-1a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v1"/><path d="M21 25l3 3 5-6M21 37l3 3 5-6" class="accent"/><path d="M34 26h9M34 38h9"/>',
  exam: '<path d="M16 8h24l10 10v38H16z"/><path d="M40 8v10h10"/><path d="M23 30h18M23 38h18M23 46h10"/><path d="M46 40l8-8 4 4-8 8-5 1z" class="accent"/>',
  coffee: '<path d="M14 26h30v14a12 12 0 0 1-12 12h-6a12 12 0 0 1-12-12z"/><path d="M44 30h3a6 6 0 0 1 0 12h-4"/><path d="M22 18c0-3 3-3 3-6M30 18c0-3 3-3 3-6M38 18c0-3 3-3 3-6" class="accent"/><path d="M12 57h36"/>',
  done: '<circle cx="32" cy="34" r="18"/><path d="M24 34l6 6 11-12" class="accent"/><path d="M50 10v6M47 13h6M12 12v4M10 14h4M54 46v4M52 48h4"/>',
  inbox: '<path d="M10 36l7-22h30l7 22v14a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4z"/><path d="M10 36h13l3 6h12l3-6h13" class="accent"/>',
  books: '<rect x="10" y="14" width="10" height="40" rx="2"/><rect x="22" y="10" width="10" height="44" rx="2"/><path d="M36 15l9-2 8 39-9 2z"/><path d="M10 46h10M22 46h10M24 18h6" class="accent"/>',
  search: '<circle cx="28" cy="28" r="15"/><path d="M39 39l13 13" class="accent"/><path d="M22 28h12"/>',
};
const ILLUS_OF = { 'calendar-blank': 'calendar', 'calendar-dots': 'calendar', 'list-checks': 'tasks', exam: 'exam', coffee: 'coffee', 'check-circle': 'done', confetti: 'done', tray: 'inbox', 'magnifying-glass': 'search', books: 'books' };
const illus = (icon) => { const k = ILLUS_OF[icon]; return k ? `<svg class="illus" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ILLUS[k]}</svg>` : `<i class="ph-duotone ph-${icon}"></i>`; };
const empty = (icon, title, hint, action = '') => `<div class="empty">${illus(icon)}<b>${title}</b><p>${hint}</p>${action}</div>`;
// Keadaan kosong di dalam panel dashboard: ikon, judul, penjelasan, dan tombol kecil opsional.
// Plus digambar sebagai SVG (bukan font ikon) supaya di Windows tidak muncul pinggiran warna (ClearType).
const PLUS = '<svg class="ic-plus" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
const panelEmpty = (icon, title, hint, type, label) => `<div class="panel-empty">${illus(icon)}<b>${title}</b><p>${hint}</p>${type && canEdit() ? `<button class="btn btn-secondary btn-sm" data-add="${type}">${PLUS}${label}</button>` : ''}</div>`;
// Kepala halaman: ikon, judul, penjelasan singkat, angka ringkas, dan tombol aksi.
const pageHead = (icon, title, desc, stats = [], action = '') => `<section class="page-head">
  <span class="ph-tile"><i class="ph ph-${icon}" aria-hidden="true"></i></span>
  <div class="ph-text"><h2>${title}</h2><p>${desc.replace(/(\w)-(?=\w)/g, '$1\u2011')}</p></div>
  ${stats.length ? `<dl class="ph-stats">${stats.map(([v, l]) => `<div><dt>${l}</dt><dd${typeof v === 'number' && v > 0 ? ` data-count="${v}"` : ''}>${v}</dd></div>`).join('')}</dl>` : ''}
  ${action ? `<div class="ph-action">${action}</div>` : ''}
</section>`;
const addBtn = (type, label) => canEdit() ? `<button class="btn btn-primary" data-add="${type}">${PLUS}${label}</button>` : '';

// ---------- Dashboard ----------
function nextClass() {
  const n = now();
  for (let i = 0; i < 8; i++) {
    const base = n + i * DAY;
    for (const k of kelasPada(base).filter((x) => !x.batal)) {
      const start = atToday(base, k.mulai);
      const end = k.selesai ? atToday(base, k.selesai) : start + 100 * 6e4;
      if (end > n) return { k, start, end, i };
    }
  }
  return null;
}
function taskRow(t, compact) {
  const done = t.selesai;
  return `<div class="row clickable ${done ? 'done' : ''}" data-detail="tugas" data-id="${t.id}">
    <button class="check ${done ? 'on' : ''}" data-toggle="${t.id}" ${canEdit() ? '' : 'disabled'} aria-pressed="${!!done}" aria-label="${done ? 'Tandai belum selesai' : 'Tandai selesai'}: ${esc(t.judul)}"><i class="ph-bold ph-check"></i></button>
    <div class="grow"><div class="title">${esc(t.judul)}</div><div class="sub">${mkChip(t.matkul)}${compact ? '' : `<span>${tgl(t.ms)} · ${hm(t.ms)}</span>`}${t.prioritas === 'tinggi' ? '<span class="pri-high"><i class="ph-fill ph-fire"></i>Tinggi</span>' : ''}</div></div>
    ${kumpulBtn(t, true)}${badge(dueBadge(t.ms, done))}
  </div>`;
}
function sessionsOn(dayMs) {
  const n = now();
  return kelasPada(dayMs).map((k) => {
    const start = atToday(dayMs, k.mulai); const end = k.selesai ? atToday(dayMs, k.selesai) : start + 100 * 6e4;
    return { k, start, end, dayMs, live: !k.batal && start <= n && n < end, past: end <= n };
  });
}
function sessionRow(x, showDay) {
  const k = x.k; const praktikum = /praktikum|lab/i.test(k.matkul + ' ' + (k.ruang || ''));
  const tag = k.batal ? '<span class="tag" data-tone="danger"><i class="ph ph-x-circle"></i>Batal</span>' : x.live ? '<span class="tag" data-tone="live"><i class="ph ph-broadcast"></i>Berlangsung</span>' : k.pengganti && !x.past ? '<span class="tag" data-tone="warning"><i class="ph ph-arrows-clockwise"></i>Pengganti</span>' : x.past ? '<span class="tag" data-tone="done">Selesai</span>' : `<span class="tag">${praktikum ? 'Praktikum' : 'Kuliah'}</span>`;
  return `<div class="session mk-accent" style="${mkVar(k.matkul)}" data-live="${x.live}" data-past="${x.past}" data-batal="${!!k.batal}" ${detailAttr(k)} role="button" tabindex="0">
    <span class="session-time"><strong>${k.mulai.replace(':', '.')}</strong><span>${(k.selesai || '').replace(':', '.')}</span></span>
    <span class="session-main"><b>${esc(k.matkul)}</b><span class="session-meta">${k.batal && k.alasan ? `<span>${esc(k.alasan)}</span>` : ''}${showDay ? `<span>${HARI[w(x.dayMs).dow]}</span>` : ''}${k.ruang ? `<span>${esc(k.ruang)}</span>` : ''}${k.dosen ? `<span>${esc(k.dosen)}</span>` : ''}</span></span>
    ${tag}</div>`;
}
function dueTone(ms, done) {
  if (done) return ['success', 'Selesai'];
  const n = now(); const diff = Math.round((startOfDay(ms) - startOfDay(n)) / DAY);
  if (ms < n) return ['danger', 'Terlambat'];
  if (diff === 0) return ['danger', 'Hari ini'];
  if (diff === 1) return ['warning', 'Besok'];
  if (diff <= 3) return ['warning', `${diff} hari lagi`];
  return ['', `${diff} hari lagi`];
}
function relDay(ms) {
  const diff = Math.round((startOfDay(ms) - startOfDay(now())) / DAY);
  const jam = hm(ms).replace(':', '.');
  if (diff === 0) return `Hari ini, ${jam}`;
  if (diff === 1) return `Besok, ${jam}`;
  if (diff > 1 && diff < 7) return `${HARI[w(ms).dow]}, ${jam}`;
  return `${tgl(ms)}, ${jam}`;
}
function taskItem(t) {
  const done = !!t.selesai; const [tone, label] = dueTone(t.ms, done);
  return `<div class="task" data-done="${done}">
    <button class="task-check" role="checkbox" aria-checked="${done}" data-toggle="${t.id}" ${canEdit() ? '' : 'disabled'} aria-label="Tandai ${esc(t.judul)} ${done ? 'belum selesai' : 'selesai'}">${done ? '<i class="ph-bold ph-check"></i>' : ''}</button>
    <div class="task-main" data-detail="tugas" data-id="${t.id}"><span class="task-title">${esc(t.judul)}</span><span class="task-meta">${mkChip(t.matkul)}<span>${relDay(t.ms)}</span>${t.prioritas === 'tinggi' ? '<span class="hi">Prioritas tinggi</span>' : ''}</span></div>
    <span class="task-side">${kumpulBtn(t, true)}<span class="tag" data-tone="${tone}">${label}</span></span></div>`;
}
// Kalimat penyemangat harian (berganti tiap hari).
const QUOTES = [
  'Sedikit demi sedikit, lama-lama jadi sarjana.',
  'Kerjakan yang paling dekat tenggatnya dulu, sisanya menyusul.',
  'Catatan rapi hari ini, belajar ringan menjelang ujian.',
  'Datang tepat waktu itu setengah dari paham materi.',
  'Satu tugas selesai lebih baik dari tiga tugas dipikirkan.',
  'Istirahat juga bagian dari rencana belajar.',
  'Tanya teman sekelas bukan kalah, itu strategi.',
  'Mulai 25 menit saja. Biasanya sisanya jadi lancar.',
  'Baca ulang slide kemarin selama lima menit sebelum kelas.',
  'Tenggat bukan musuh, tenggat itu pengingat.',
  'Kelas pagi lebih mudah kalau tidurnya cukup.',
  'Progres kecil setiap hari tetap progres.',
  'Simpan file tugas dengan nama yang jelas. Kamu di masa depan akan berterima kasih.',
  'Kalau buntu, ganti tempat belajar sebentar.',
];
const quoteOfDay = () => { const t = w(now()); return QUOTES[(t.y * 372 + t.m * 31 + t.d) % QUOTES.length]; };
function fmtCountdown(ms) {
  if (ms <= 0) return 'sekarang';
  const s = Math.floor(ms / 1000); const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  if (d) return `${d} hari ${h} jam`;
  if (h) return `${h} jam ${m} menit`;
  return `${m} menit ${String(sec).padStart(2, '0')} detik`;
}
const clockText = (ms) => { const d = new Date(ms + TZ); const p = (x) => String(x).padStart(2, '0'); return `${p(d.getUTCHours())}<span class="colon">:</span>${p(d.getUTCMinutes())}<small>${p(d.getUTCSeconds())}</small>`; };
// Acara berikutnya untuk hitung mundur: kelas yang sedang/akan berlangsung atau ujian terdekat.
function nextEvent() {
  const n = now(); const c = nextClass();
  const u = S.data.ujian.filter((x) => x.ms > n).sort((a, b) => a.ms - b.ms)[0];
  const ev = [];
  if (c) ev.push({ kind: c.start <= n ? 'Sedang berlangsung' : 'Kelas berikutnya', title: c.k.matkul, sub: `${tgl(c.start)} · ${c.k.mulai.replace(':', '.')}${c.k.ruang ? ` · ${c.k.ruang}` : ''}`, at: c.start <= n ? c.end : c.start, live: c.start <= n, id: c.k.pengganti ? c.k.ubahId : c.k.id, type: c.k.pengganti ? 'ubah' : 'kelas' });
  if (u) ev.push({ kind: 'Ujian terdekat', title: `${u.jenis} ${u.matkul}`, sub: `${tgl(u.ms)} · ${hm(u.ms).replace(':', '.')}${u.ruang ? ` · ${u.ruang}` : ''}`, at: u.ms, id: u.id, type: 'ujian' });
  return ev.sort((a, b) => (b.live - a.live) || a.at - b.at)[0] || null;
}
let clockTimer = null;
function startClock() {
  if (clockTimer) return;
  clockTimer = setInterval(() => {
    if (S.view !== 'dashboard') return;
    const n = now();
    const c = $('[data-clock]'); if (c) c.innerHTML = clockText(n);
    const cd = $('[data-countdown]');
    if (cd) {
      const left = Number(cd.dataset.countdown) - n;
      if (left <= 0) { viewDashboard(); return; }
      cd.textContent = fmtCountdown(left);
    }
  }, 1000);
}
// Angka di kartu metrik naik dari 0 saat halaman dibuka.
function countUp(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $$('[data-count]', root).forEach((el) => {
    const to = Number(el.dataset.count); const suf = el.dataset.suffix || ''; if (!(to > 0)) return;
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 650); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))) + suf; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

function viewDashboard() {
  const n = now(); const sod = startOfDay(n); const today = w(n).dow;
  const aktif = S.data.tugas.filter((t) => !t.selesai).sort((a, b) => a.ms - b.ms);
  const total = S.data.tugas.length; const selesai = total - aktif.length;
  const dueToday = aktif.filter((t) => startOfDay(t.ms) <= sod).length;
  const todaySessions = sessionsOn(sod);
  const todayAktif = todaySessions.filter((x) => !x.k.batal);
  const nc = nextClass();
  const ujianNext = S.data.ujian.filter((u) => u.ms > n).sort((a, b) => a.ms - b.ms);
  const u0 = ujianNext[0]; const uDays = u0 ? Math.max(0, Math.round((startOfDay(u0.ms) - sod) / DAY)) : null;
  const jam = w(n).h; const salam = jam < 11 ? 'Selamat pagi' : jam < 15 ? 'Selamat siang' : jam < 18 ? 'Selamat sore' : 'Selamat malam';
  const tn = w(n); const tanggal = `${HARI[tn.dow]}, ${tn.d} ${BULAN_PANJANG[tn.m]} ${tn.y}`;
  const b = S.data.bot || {};
  const ev = nextEvent();

  // jadwal: hari ini / pekan ini / hari terpilih
  const offset = (today + 6) % 7;
  const weekDays = Array.from({ length: 7 }, (_, i) => sod + (i - offset) * DAY);
  let list, hint, title = 'Jadwal hari ini';
  if (S.dashScope === 'week') {
    list = weekDays.filter((d) => d > sod).flatMap((d) => sessionsOn(d)); title = 'Jadwal pekan ini';
    hint = list.length ? `${list.length} sesi sampai ${HARI[w(weekDays[6]).dow]}` : 'Sisa pekan ini';
  } else if (S.dashScope === 'day' && S.dashDay && S.dashDay !== sod) {
    list = sessionsOn(S.dashDay); title = `Jadwal ${HARI[w(S.dashDay).dow]}`; hint = `${list.length} sesi · ${w(S.dashDay).d} ${BULAN_PANJANG[w(S.dashDay).m]}`;
  } else {
    list = todaySessions; hint = `${HARI[w(sod).dow]}, ${w(sod).d} ${BULAN_PANJANG[w(sod).m]}${list.length ? ` · ${list.length} sesi` : ''}`;
  }
  const selDay = S.dashScope === 'day' && S.dashDay ? S.dashDay : S.dashScope === 'today' ? sod : null;
  const strip = weekDays.map((d) => {
    const t = w(d); const cnt = kelasPada(d).filter((k) => !k.batal).length;
    const hasU = S.data.ujian.some((u) => dayKey(u.ms) === dayKey(d)); const hasT = aktif.some((x) => dayKey(x.ms) === dayKey(d));
    const label = `${HARI[t.dow]} ${t.d} ${BULAN[t.m]}, ${cnt} kelas${hasT ? ', ada tenggat tugas' : ''}${hasU ? ', ada ujian' : ''}`;
    return `<button class="wday" data-pick-day="${d}" data-active="${d === selDay}" data-today="${d === sod}" aria-pressed="${d === selDay}" aria-label="${label}"><span>${HARI[t.dow].slice(0, 3)}</span><strong>${t.d}</strong><i class="wbar" data-has="${cnt > 0}" data-alert="${hasU || hasT}"></i></button>`;
  }).join('');

  const reminders = [
    ...ujianNext.slice(0, 3).map((u) => { const dd = Math.round((startOfDay(u.ms) - sod) / DAY); return { tone: dd <= 3 ? 'warning' : '', title: `${u.jenis} ${u.matkul}`, detail: u.ruang ? `Ruang ${u.ruang}` : 'Ruang belum diisi', time: relDay(u.ms), id: u.id, type: 'ujian' }; }),
  ];
  const pct = total ? Math.round(selesai / total * 100) : 0;
  const wkDays = weekDays.map((d) => { const t = w(d); return { ms: d, label: HARI[t.dow].slice(0, 3), full: `${HARI[t.dow]} ${t.d} ${BULAN[t.m]}`, today: d === sod, kelas: kelasPada(d).filter((k) => !k.batal).length, tenggat: aktif.filter((x) => dayKey(x.ms) === dayKey(d)).length, ujian: S.data.ujian.filter((u) => dayKey(u.ms) === dayKey(d)).length }; });
  const wk = { days: wkDays, max: Math.max(0, ...wkDays.map((d) => d.kelas)), kelas: wkDays.reduce((a, d) => a + d.kelas, 0), tenggat: wkDays.reduce((a, d) => a + d.tenggat, 0), ujian: wkDays.reduce((a, d) => a + d.ujian, 0) };

  $('#content').innerHTML = `
  <section class="hero">
    <div class="hero-main">
      <span class="eyebrow">${tanggal}</span>
      <h2>${salam}, ${esc(S.user.nama.split(' ')[0])}</h2>
      <p>${todayAktif.length ? `${todayAktif.length} kelas` : 'Tidak ada kelas'} hari ini dan ${aktif.length ? `${aktif.length} tugas menunggu` : 'tidak ada tugas yang menunggu'}.</p>
      <blockquote class="quote"><i class="ph ph-quotes" aria-hidden="true"></i>${quoteOfDay()}</blockquote>
      <div class="hero-actions">${canEdit() ? `<button class="btn btn-primary" data-add="tugas">${PLUS}Tugas baru</button>` : ''}<button class="btn btn-secondary" data-view="jadwal"><i class="ph ph-calendar-blank"></i>Lihat jadwal</button></div>
    </div>
    <div class="hero-side">
      <div class="clock" aria-label="Jam sekarang"><span data-clock>${clockText(n)}</span><em>WIB</em></div>
      ${ev ? `<button class="next-ev" data-detail="${ev.type}" data-id="${ev.id}" ${ev.live ? 'data-live="true"' : ''}>
        <span class="eyebrow">${ev.live ? '<i class="pulse" aria-hidden="true"></i>' : ''}${ev.kind}</span>
        <b>${esc(ev.title)}</b><small>${esc(ev.sub)}</small>
        <span class="cd">${ev.live ? 'Selesai dalam ' : 'Mulai dalam '}<strong data-countdown="${ev.at}">${fmtCountdown(ev.at - n)}</strong></span></button>`
        : '<div class="next-ev empty-ev"><span class="eyebrow">Berikutnya</span><b>Belum ada agenda</b><small>Isi jadwal kuliah atau ujian supaya hitung mundur muncul di sini.</small></div>'}
    </div>
  </section>
  ${typeof dashEkstra === 'function' ? dashEkstra() : ''}
  <section class="metrics">
    <article class="metric"><span class="metric-label"><i class="ph ph-book-open"></i>Kelas hari ini</span><strong data-count="${todayAktif.length}" data-suffix=" sesi">${todayAktif.length} sesi</strong><small>${nc ? `Berikutnya ${nc.k.mulai.replace(':', '.')}${nc.i ? ` (${HARI[w(nc.start).dow]})` : ''} · ${esc(nc.k.ruang || nc.k.matkul)}` : 'Belum ada jadwal'}</small></article>
    <article class="metric"><span class="metric-label"><i class="ph ph-list-checks"></i>Tugas aktif</span><strong data-count="${aktif.length}" data-suffix=" tugas">${aktif.length} tugas</strong><small data-tone="${dueToday ? 'warning' : ''}">${dueToday ? `${dueToday} jatuh tempo hari ini` : aktif[0] ? `Terdekat ${relDay(aktif[0].ms)}` : 'Semua beres'}</small></article>
    <article class="metric"><span class="metric-label"><i class="ph ph-clipboard-text"></i>Ujian terdekat</span><strong ${u0 && uDays ? `data-count="${uDays}" data-suffix=" hari"` : ''}>${u0 ? (uDays === 0 ? 'Hari ini' : `${uDays} hari`) : '–'}</strong><small>${u0 ? `${esc(u0.jenis)} ${esc(u0.matkul)} · ${w(u0.ms).d} ${BULAN[w(u0.ms).m]}` : 'Belum ada ujian'}</small></article>
    <article class="metric"><span class="metric-label"><i class="ph ph-whatsapp-logo"></i>Bot WhatsApp</span><strong>${b.wa ? 'Aktif' : 'Offline'}</strong><small data-tone="${b.wa && b.grup ? '' : 'warning'}">${b.wa ? (b.grup ? 'Mengirim ke grup kelas' : 'Grup belum diatur') : 'Pengingat tertunda'}</small></article>
  </section>
  <section class="dash-grid">
    <div class="panel">
      <div class="panel-head"><div><h2>${title}</h2><span>${hint}</span></div>
        <div class="segment" role="group" aria-label="Rentang jadwal"><button data-scope="today" aria-pressed="${S.dashScope !== 'week'}">Hari ini</button><button data-scope="week" aria-pressed="${S.dashScope === 'week'}">Pekan ini</button></div></div>
      ${list.length ? `<div class="sessions">${list.map((x) => sessionRow(x, S.dashScope === 'week')).join('')}</div>` : S.data.kelas.length
        ? panelEmpty('coffee', S.dashScope === 'week' ? 'Tidak ada kelas lagi pekan ini' : 'Tidak ada kelas', 'Pilih hari lain di bawah untuk melihat jadwalnya.')
        : panelEmpty('calendar-blank', 'Jadwal kuliah belum diisi', 'Tambahkan jadwal mingguan supaya bot bisa mengingatkan grup sebelum kelas.', 'kelas', 'Tambah jadwal')}
      <div class="week" role="group" aria-label="Agenda pekan">${strip}</div>
    </div>
    <div class="panel">
      <div class="panel-head"><div><h2>Tugas mendekat</h2><span>${total ? `${aktif.length} dari ${total} belum selesai` : 'Belum ada tugas'}</span></div></div>
      ${aktif.length ? `<div class="tasks">${aktif.slice(0, 5).map(taskItem).join('')}</div>` : total
        ? panelEmpty('check-circle', 'Semua tugas selesai', 'Tidak ada tenggat yang menunggu. Waktu yang tersisa bisa dipakai untuk mereview materi.')
        : panelEmpty('list-checks', 'Belum ada tugas', 'Tugas yang ditambahkan akan muncul di sini, diurutkan dari tenggat terdekat.', 'tugas', 'Tambah tugas')}
      ${total ? '<button class="ghost-btn panel-foot" data-view="tugas">Kelola semua tugas<i class="ph ph-arrow-right"></i></button>' : ''}
    </div>
  </section>
  <section class="dash-grid">
    <div class="panel">
      <div class="panel-head"><div><h2>Pengingat</h2><span>${reminders.length ? `${reminders.length} ujian mendatang · bot mengingatkan grup otomatis` : 'Ujian mendatang'}</span></div></div>
      ${reminders.length ? `<div class="reminders">${reminders.map((r) => `<div class="reminder" data-tone="${r.tone}" data-detail="${r.type}" data-id="${r.id}" role="button" tabindex="0"><i class="rdot" aria-hidden="true"></i><div><span><b>${esc(r.title)}</b><small>${esc(r.detail)}</small></span><time>${r.time}</time></div></div>`).join('')}</div>`
        : panelEmpty('exam', 'Belum ada ujian terjadwal', 'Bot otomatis mengingatkan grup H-7, H-1, dan pagi hari ujian.', 'ujian', 'Tambah ujian')}
    </div>
    <div class="panel">
      <div class="panel-head"><div><h2>Ringkasan pekan</h2><span>${wk.kelas} kelas · ${wk.tenggat} tenggat · ${wk.ujian} ujian</span></div></div>
      <div class="wchart" role="img" aria-label="Jumlah kelas per hari pekan ini: ${wk.days.map((d) => `${d.label} ${d.kelas}`).join(', ')}">
        ${wk.days.map((d, i) => `<button class="wcol" data-pick-day="${d.ms}" data-today="${d.today}" style="--h:${d.kelas ? Math.max(8, Math.round(d.kelas / wk.max * 100)) : 0}%;--i:${i}" aria-label="${d.full}: ${d.kelas} kelas, ${d.tenggat} tenggat, ${d.ujian} ujian">
          <span class="wnum">${d.kelas || ''}</span><span class="wtrack"><i></i></span><span class="wmarks">${d.tenggat ? '<i class="m-t" title="Tenggat"></i>' : ''}${d.ujian ? '<i class="m-u" title="Ujian"></i>' : ''}</span><span class="wlbl">${d.label}</span></button>`).join('')}
      </div>
      <div class="legend"><span><i class="lg-bar"></i>Kelas</span><span><i class="m-t"></i>Tenggat tugas</span><span><i class="m-u"></i>Ujian</span></div>
      <div class="progress panel-foot"><div><span>Progres tugas</span><strong>${total ? `${selesai} dari ${total} selesai · ${pct}%` : 'Belum ada tugas'}</strong></div><div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progres tugas"><i style="width:${pct}%"></i></div></div>
    </div>
  </section>`;
  startClock();
 
}

// ---------- Mata kuliah ----------
function viewMatkul() {
  const n = now(); const list = S.data.matkul || [];
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const info = list.map((m) => ({
    m,
    jadwal: S.data.kelas.filter((k) => same(k.matkul, m.nama)).sort((a, b) => ((a.hari + 6) % 7) - ((b.hari + 6) % 7) || a.mulai.localeCompare(b.mulai)),
    tugas: S.data.tugas.filter((t) => same(t.matkul, m.nama) && !t.selesai).length,
    tTotal: S.data.tugas.filter((t) => same(t.matkul, m.nama)).length,
    tDone: S.data.tugas.filter((t) => same(t.matkul, m.nama) && t.selesai).length,
    ujian: S.data.ujian.filter((u) => same(u.matkul, m.nama) && u.ms >= n).sort((a, b) => a.ms - b.ms)[0],
  }));
  const cards = info.map(({ m, jadwal, tugas, ujian, tTotal, tDone }) => `<article class="mk-card" style="${mkVar(m.nama)}">
      <div class="mk-top"><span class="mk-badge">${esc(m.nama.split(/\s+/).map((x) => x[0]).join('').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'MK')}</span>
        <div class="mk-title"><a class="mk-link" href="#matkul/${m.id}"><b>${esc(m.nama)}</b></a><small>${jadwal.length ? `${jadwal.length}× seminggu` : 'Belum ada jadwal'}</small></div>
        ${canEdit() ? `<div class="mk-act"><button class="tiny-btn" data-edit="matkul" data-id="${m.id}" aria-label="Ubah ${esc(m.nama)}"><i class="ph ph-pencil-simple"></i></button><button class="tiny-btn danger" data-del="matkul" data-id="${m.id}" aria-label="Hapus ${esc(m.nama)}"><i class="ph ph-trash"></i></button></div>` : ''}</div>
      <dl class="mk-meta">
        <div><dt><i class="ph ph-chalkboard-teacher"></i>Dosen</dt><dd>${esc(m.dosen || '–')}</dd></div>
        <div><dt><i class="ph ph-calendar-dots"></i>Jadwal</dt><dd>${jadwal.length ? jadwal.map((k) => `${HARI[k.hari].slice(0, 3)} ${k.mulai.replace(':', '.')}`).join(', ') : 'Belum ada'}</dd></div>
      </dl>
      <div class="mk-prog"><div><span>Tugas selesai</span><b>${tTotal ? `${tDone}/${tTotal}` : '–'}</b></div><div class="bar" role="progressbar" aria-label="Tugas ${esc(m.nama)} selesai" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${tTotal ? Math.round(tDone / tTotal * 100) : 0}"><i style="width:${tTotal ? Math.round(tDone / tTotal * 100) : 0}%"></i></div></div>
      <div class="mk-foot"><a class="tag mk-buka" href="#matkul/${m.id}">Buka detail<i class="ph ph-arrow-right"></i></a><span class="tag">${tugas} tugas aktif</span>${ujian ? `<button class="tag" data-tone="${dueTone(ujian.ms)[0] || 'live'}" data-detail="ujian" data-id="${ujian.id}"><i class="ph ph-hourglass-medium"></i>${esc(ujian.jenis)} · ${dueTone(ujian.ms)[1]}</button>` : ''}${m.catatan ? `<span class="mk-note" title="${esc(m.catatan)}"><i class="ph ph-note"></i>Catatan</span>` : ''}</div>
    </article>`).join('');
  $('#content').innerHTML = `
    ${pageHead('books', 'Mata kuliah', 'Daftar mata kuliah semester ini. Jadwal, tugas, dan ujian memilih mata kuliah dari daftar ini.', [[list.length, 'Mata kuliah'], [info.filter((x) => x.jadwal.length).length, 'Punya jadwal'], [info.reduce((a, x) => a + x.tugas, 0), 'Tugas aktif']], addBtn('matkul', 'Tambah mata kuliah'))}
    ${list.length ? `<div class="mk-grid">${cards}</div>` : `<div class="card">${empty('books', 'Belum ada mata kuliah', canEdit() ? 'Tambahkan mata kuliah dulu, lalu atur jadwal, tugas, dan ujiannya.' : 'Admin belum mengisi daftar mata kuliah.', addBtn('matkul', 'Tambah sekarang'))}</div>`}`;
}

// ---------- Jadwal ----------
function viewJadwal() {
  const today = w(now()).dow;
  const ada = (h) => S.data.kelas.some((k) => k.hari === h);
  const hari = [1, 2, 3, 4, 5, ...(ada(6) ? [6] : []), ...(ada(0) ? [0] : [])];
  const cols = hari.map((h) => {
    const list = S.data.kelas.filter((k) => k.hari === h).sort((a, b) => a.mulai.localeCompare(b.mulai));
    return `<div class="col ${h === today ? 'today' : ''}"><div class="col-head"><b>${HARI[h]}</b><small>${list.length} kelas</small></div>
      ${list.length ? list.map((k, i) => `${i && jedaLabel(list[i - 1], k)}<div class="class-card mk-accent" style="${mkVar(k.matkul)}" data-detail="kelas" data-id="${k.id}" role="button" tabindex="0">
        <span class="time">${k.mulai}${k.selesai ? ' – ' + k.selesai : ''}</span><span class="name">${esc(k.matkul)}</span>
        <div class="meta">${k.ruang ? `<span><i class="ph ph-map-pin"></i>${esc(k.ruang)}</span>` : ''}${k.dosen ? `<span><i class="ph ph-chalkboard-teacher"></i>${esc(k.dosen)}</span>` : ''}</div>
        ${canEdit() ? `<div class="actions"><button class="tiny-btn" data-edit="kelas" data-id="${k.id}" aria-label="Ubah"><i class="ph ph-pencil-simple"></i></button><button class="tiny-btn danger" data-del="kelas" data-id="${k.id}" aria-label="Hapus"><i class="ph ph-trash"></i></button></div>` : ''}
      </div>`).join('') : '<div class="none">Tidak ada kelas</div>'}</div>`;
  }).join('');
  const grid = S.jmode === 'grid';
  const tools = `<div class="toolbar"><div class="toolbar-left"><div class="segmented" role="group" aria-label="Tampilan jadwal">
      <button class="${grid ? '' : 'on'}" data-jmode="papan" aria-pressed="${!grid}"><i class="ph ph-kanban"></i> Papan</button>
      <button class="${grid ? 'on' : ''}" data-jmode="grid" aria-pressed="${grid}"><i class="ph ph-grid-nine"></i> Grid jam</button></div></div>
    <div class="toolbar-right"><button class="btn btn-secondary btn-sm" data-png><i class="ph ph-image"></i>Simpan gambar</button>${canEdit() ? '<button class="btn btn-secondary btn-sm" data-semester><i class="ph ph-calendar-check"></i>Semester & libur</button><button class="btn btn-secondary btn-sm" data-add="batal"><i class="ph ph-calendar-x"></i>Batalkan kelas</button><button class="btn btn-secondary btn-sm" data-add="pengganti"><i class="ph ph-arrows-clockwise"></i>Kuliah pengganti</button>' : ''}</div></div>`;
  $('#content').innerHTML = `
    ${pageHead('book-open', 'Jadwal mingguan', 'Hari dan jam tiap mata kuliah. Bot memakai jadwal ini untuk mengingatkan grup sebelum kelas dimulai.', [[S.data.kelas.length, 'Kelas / minggu'], [new Set(S.data.kelas.map((k) => k.hari)).size, 'Hari kuliah'], [S.data.kelas.filter((k) => /praktikum|lab/i.test(`${k.matkul} ${k.ruang || ''}`)).length, 'Praktikum'], [S.data.kelas.filter((k) => k.hari === today).length, 'Hari ini']], addBtn('kelas', 'Tambah jadwal'))}
    ${S.data.kelas.length ? tools : ''}
    ${typeof semesterCard === 'function' ? semesterCard() : ''}
    ${perubahanCard()}
    ${S.data.kelas.length ? (grid ? jadwalGrid(hari, today) + (canEdit() ? '<p class="muted" style="font-size:12.5px;margin:0"><i class="ph ph-hand-grabbing"></i> Geser blok untuk mengubah hari atau jam kelas.</p>' : '') : `<div class="board" style="--cols:${hari.length}">${cols}</div>`) : `<div class="card">${empty('calendar-dots', 'Belum ada jadwal', canEdit() ? 'Tambahkan jadwal kuliah mingguan untuk mulai.' : 'Admin belum mengisi jadwal kuliah.', addBtn('kelas', 'Tambah sekarang'))}</div>`}`;
}

// Jeda antar kelas di hari yang sama ("jeda 1 jam 20 menit").
function jedaLabel(a, b) {
  const m = (x) => { const [h, mi] = x.split(':').map(Number); return h * 60 + mi; };
  const akhir = a.selesai ? m(a.selesai) : m(a.mulai) + 100; const gap = m(b.mulai) - akhir;
  if (gap < 0) return '<div class="jeda bentrok"><i class="ph-fill ph-warning"></i>Bentrok dengan kelas sebelumnya</div>';
  if (gap < 15) return '';
  return `<div class="jeda"><i class="ph ph-coffee"></i>Jeda ${relMinutes(gap)}${gap >= 60 ? ' · cukup untuk makan/istirahat' : ''}</div>`;
}

// Grid jam: blok kelas mengikuti jam mulai-selesai, jadi jam kosong dan jadwal bentrok terlihat.
function jadwalGrid(hari, today) {
  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const endMin = (k) => (k.selesai ? toMin(k.selesai) : toMin(k.mulai) + 100);
  const lo = Math.floor(Math.min(...S.data.kelas.map((k) => toMin(k.mulai))) / 60) * 60;
  const hi = Math.ceil(Math.max(...S.data.kelas.map(endMin)) / 60) * 60;
  const PX = 1.15; const H = (hi - lo) * PX;
  const jam = []; for (let m = lo; m <= hi; m += 60) jam.push(m);
  let bentrok = 0;
  const cols = hari.map((h) => {
    const list = S.data.kelas.filter((k) => k.hari === h).sort((a, b) => a.mulai.localeCompare(b.mulai));
    const lanes = [];
    const placed = list.map((k) => {
      const s = toMin(k.mulai); const e = endMin(k);
      let li = lanes.findIndex((end) => end <= s); if (li === -1) { li = lanes.length; lanes.push(e); } else lanes[li] = e;
      return { k, s, e, li };
    });
    const n = Math.max(1, lanes.length);
    const blocks = placed.map((p) => {
      const clash = placed.some((q) => q !== p && q.s < p.e && p.s < q.e); if (clash) bentrok++;
      return `<div class="tblock" data-clash="${clash}" style="${mkVar(p.k.matkul)};top:${(p.s - lo) * PX}px;height:${Math.max(26, (p.e - p.s) * PX - 3)}px;left:calc(${p.li / n * 100}% + 3px);width:calc(${100 / n}% - 6px)" data-detail="kelas" data-id="${p.k.id}" role="button" tabindex="0" title="${esc(p.k.matkul)} ${p.k.mulai}${p.k.selesai ? '–' + p.k.selesai : ''}${clash ? ' (bentrok)' : ''}">
        <b>${esc(p.k.matkul)}</b><span>${p.k.mulai}${p.k.selesai ? '–' + p.k.selesai : ''}${p.k.ruang ? ` · ${esc(p.k.ruang)}` : ''}</span>${clash ? '<em><i class="ph-fill ph-warning"></i>Bentrok</em>' : ''}</div>`;
    }).join('');
    return `<div class="tcol ${h === today ? 'today' : ''}"><div class="tcol-head">${HARI[h].slice(0, 3)}</div><div class="tcol-body" data-hari="${h}" data-lo="${lo}" data-px="${PX}" style="height:${H}px;--hour:${60 * PX}px">${blocks}</div></div>`;
  }).join('');
  bentrok = bentrok / 2;
  return `${bentrok ? `<div class="card warn-note"><i class="ph-fill ph-warning"></i> Ada ${Math.round(bentrok)} pasang jadwal yang jamnya bertabrakan. Cek blok yang bergaris merah.</div>` : ''}
    <div class="card tgrid-card"><div class="tgrid" style="--cols:${hari.length}">
      <div class="taxis"><div class="tcol-head"></div><div class="tcol-body" style="height:${H}px">${jam.map((m) => `<span style="top:${(m - lo) * PX}px">${p2(m / 60)}.00</span>`).join('')}</div></div>
      ${cols}</div></div>`;
}

// Daftar kelas batal & kuliah pengganti yang akan datang.
function perubahanCard() {
  const hariIni = ymdOf(now());
  const list = (S.data.kelasUbah || []).filter((u) => u.tanggal >= hariIni).sort((a, b) => a.tanggal.localeCompare(b.tanggal) || String(a.mulai).localeCompare(String(b.mulai)));
  if (!list.length) return '';
  const row = (u) => {
    const k = u.jenis === 'batal' ? S.data.kelas.find((x) => x.id === u.kelas_id) : u;
    const nama = k?.matkul || 'Kelas'; const ms = msOfYmd(u.tanggal);
    return `<div class="row clickable mk-accent" style="${mkVar(nama)}" data-detail="ubah" data-id="${u.id}">
      ${u.jenis === 'batal' ? '<span class="tag" data-tone="danger"><i class="ph ph-x-circle"></i>Batal</span>' : '<span class="tag" data-tone="warning"><i class="ph ph-arrows-clockwise"></i>Pengganti</span>'}
      <div class="grow"><div class="title">${esc(nama)}</div><div class="sub"><span>${tgl(ms)}${k?.mulai ? ` · ${k.mulai}${k.selesai ? '–' + k.selesai : ''}` : ''}</span>${u.ruang ? `<span>${esc(u.ruang)}</span>` : ''}${u.catatan ? `<span>${esc(u.catatan)}</span>` : ''}</div></div>
      ${canEdit() ? `<button class="tiny-btn danger" data-del="ubah" data-id="${u.id}" aria-label="Hapus perubahan ${esc(nama)}"><i class="ph ph-trash"></i></button>` : ''}</div>`;
  };
  return `<div class="card"><div class="card-head"><h2><i class="ph ph-calendar-x"></i>Perubahan jadwal</h2><span class="muted" style="font-size:13px">${list.length} akan datang</span></div><div class="rows">${list.map(row).join('')}</div></div>`;
}

// ---------- Tugas ----------
function viewTugas() {
  const all = S.data.tugas;
  const cnt = { aktif: all.filter((t) => !t.selesai).length, belum: all.filter((t) => !t.selesai && !t.kumpulSaya).length, selesai: all.filter((t) => t.selesai).length, semua: all.length };
  const FLABEL = { aktif: 'Aktif', belum: 'Belum kumpul', selesai: 'Selesai', semua: 'Semua' };
  const q = S.q.toLowerCase();
  const list = all.filter((t) => ({ semua: true, aktif: !t.selesai, belum: !t.selesai && !t.kumpulSaya, selesai: !!t.selesai })[S.filter] ?? true)
    .filter((t) => !q || `${t.judul} ${t.matkul} ${t.catatan || ''}`.toLowerCase().includes(q))
    .sort((a, b) => (S.filter === 'selesai' ? b.ms - a.ms : a.ms - b.ms));
  const seg = ['aktif', 'belum', 'selesai', 'semua'].map((f) => `<button class="${S.filter === f ? 'on' : ''}" data-filter="${f}" aria-pressed="${S.filter === f}">${FLABEL[f]}<em>${cnt[f]}</em></button>`).join('');
  const rows = list.map((t) => {
    const pri = t.prioritas === 'tinggi' ? '<span class="pri-high"><i class="ph-fill ph-fire"></i>Tinggi</span>' : '<span class="pri-normal">Normal</span>';
    return `<div class="trow ${t.selesai ? 'done' : ''}">
      <div><button class="check ${t.selesai ? 'on' : ''}" data-toggle="${t.id}" ${canEdit() ? '' : 'disabled'} aria-pressed="${!!t.selesai}" aria-label="${t.selesai ? 'Tandai belum selesai' : 'Tandai selesai'}: ${esc(t.judul)}"><i class="ph-bold ph-check"></i></button></div>
      <div style="min-width:0;cursor:pointer" data-detail="tugas" data-id="${t.id}"><div class="title">${esc(t.judul)}</div>${t.catatan ? `<div class="note">${esc(t.catatan)}</div>` : ''}
        <div class="m-meta">${mkChip(t.matkul)}${badge(dueBadge(t.ms, t.selesai))}<span>${tgl(t.ms)} · ${hm(t.ms)}</span>${t.prioritas === 'tinggi' ? pri : ''}</div>${t.selesai ? '' : `<div class="kumpul-line">${kumpulBtn(t)}</div>`}</div>
      <div class="d-only">${mkChip(t.matkul)}</div>
      <div class="d-only"><div>${tgl(t.ms)} · ${hm(t.ms)}</div>${badge(dueBadge(t.ms, t.selesai))}</div>
      <div class="d-only">${pri}</div>
      <div class="row-actions">${canEdit() ? `<button class="tiny-btn" data-edit="tugas" data-id="${t.id}" aria-label="Ubah"><i class="ph ph-pencil-simple"></i></button><button class="tiny-btn danger" data-del="tugas" data-id="${t.id}" aria-label="Hapus"><i class="ph ph-trash"></i></button>` : ''}</div>
    </div>`;
  }).join('');
  const kosong = q ? empty('magnifying-glass', 'Tidak ada hasil', 'Coba kata kunci lain.', '<button class="btn btn-secondary" data-clear-q>Bersihkan pencarian</button>')
    : S.filter === 'selesai' ? empty('check-circle', 'Belum ada tugas selesai', 'Tugas yang dicentang akan pindah ke sini.')
    : S.filter === 'belum' ? empty('confetti', 'Semua sudah kamu kumpulkan', 'Tidak ada tugas aktif yang belum kamu tandai kumpul.')
      : empty('confetti', 'Tidak ada tugas aktif', 'Semua beres. Tambahkan tugas baru kalau ada.', addBtn('tugas', 'Tambah sekarang'));
  const nT = now(); const aktifT = all.filter((t) => !t.selesai);
  $('#content').innerHTML = `
    ${pageHead('list-checks', 'Daftar tugas', 'Semua tugas kelas beserta tenggatnya. Bot mengingatkan grup H-3, H-1, dan 3 jam sebelum tenggat.', [[aktifT.length, 'Aktif'], [aktifT.filter((t) => t.ms - nT < 3 * DAY).length, '≤ 3 hari'], [aktifT.filter((t) => t.prioritas === 'tinggi').length, 'Prioritas tinggi'], [all.length - aktifT.length, 'Selesai']], addBtn('tugas', 'Tambah tugas'))}
    <div class="toolbar"><div class="toolbar-left"><label class="search"><i class="ph ph-magnifying-glass"></i><input id="q" placeholder="Cari tugas atau mata kuliah…" value="${esc(S.q)}"></label><div class="segmented">${seg}</div></div></div>
    <div class="card">${list.length ? `<div class="table"><div class="thead"><span>Status</span><span>Tugas</span><span>Mata kuliah</span><span>Tenggat</span><span>Prioritas</span><span style="text-align:right">Aksi</span></div>${rows}</div>` : kosong}</div>`;
  const qi = $('#q'); qi.oninput = () => { S.q = qi.value; const pos = qi.selectionStart; viewTugas(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
}

// ---------- Ujian ----------
function viewUjian() {
  const n = now();
  const list = [...S.data.ujian].sort((a, b) => {
    const la = a.ms < n, lb = b.ms < n; if (la !== lb) return la ? 1 : -1;
    return la ? b.ms - a.ms : a.ms - b.ms;
  });
  const rows = list.map((u) => {
    const lewat = u.ms < n;
    return `<div class="trow mk-accent ${lewat ? 'done' : ''}" style="${mkVar(u.matkul)}">
      <div><span class="badge b-warn">${esc(u.jenis)}</span></div>
      <div style="min-width:0;cursor:pointer" data-detail="ujian" data-id="${u.id}"><div class="title">${esc(u.matkul)}</div>
        <div class="m-meta"><span>${tgl(u.ms)} · ${hm(u.ms)}</span>${u.ruang ? `<span><i class="ph ph-map-pin"></i> ${esc(u.ruang)}</span>` : ''}${lewat ? badge(['b-normal', 'Selesai']) : badge(dueBadge(u.ms))}</div></div>
      <div class="d-only">${tgl(u.ms)} · ${hm(u.ms)}</div>
      <div class="d-only">${u.ruang ? esc(u.ruang) : '<span class="muted">–</span>'}</div>
      <div class="d-only">${lewat ? badge(['b-normal', 'Selesai']) : badge(dueBadge(u.ms))}</div>
      <div class="row-actions">${canEdit() ? `<button class="tiny-btn" data-edit="ujian" data-id="${u.id}" aria-label="Ubah"><i class="ph ph-pencil-simple"></i></button><button class="tiny-btn danger" data-del="ujian" data-id="${u.id}" aria-label="Hapus"><i class="ph ph-trash"></i></button>` : ''}</div>
    </div>`;
  }).join('');
  $('#content').innerHTML = `
    ${pageHead('clipboard-text', 'Jadwal ujian', 'UTS, UAS, kuis, dan ujian praktikum. Bot mengingatkan grup H-7, H-1, dan pagi hari-H.', [[list.filter((u) => u.ms >= n).length, 'Mendatang'], [(() => { const u = list.find((x) => x.ms >= n); return u ? `${Math.max(0, Math.round((startOfDay(u.ms) - startOfDay(n)) / DAY))} hari` : '–'; })(), 'Terdekat'], [list.filter((u) => u.ms < n).length, 'Selesai']], addBtn('ujian', 'Tambah ujian'))}
    <div class="card">${list.length ? `<div class="table ujian"><div class="thead"><span>Jenis</span><span>Mata kuliah</span><span>Waktu</span><span>Ruang</span><span>Status</span><span style="text-align:right">Aksi</span></div>${rows}</div>`
      : empty('exam', 'Belum ada ujian', canEdit() ? 'Tambahkan jadwal UTS, UAS, atau kuis.' : 'Belum ada ujian terjadwal.', addBtn('ujian', 'Tambah sekarang'))}</div>`;
}

// ---------- Kalender bulanan ----------
function viewKalender() {
  const n = now(); const tn = w(n); const sod = startOfDay(n);
  if (!S.cal) S.cal = { y: tn.y, m: tn.m };
  const { y, m } = S.cal;
  const first = Date.UTC(y, m, 1) - TZ;
  const lead = (w(first).dow + 6) % 7; // minggu dimulai Senin
  const nDays = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells = Math.ceil((lead + nDays) / 7) * 7;
  let tot = { kelas: 0, tugas: 0, ujian: 0 };
  const html = Array.from({ length: cells }, (_, i) => {
    const ms = first + (i - lead) * DAY; const t = w(ms); const inMonth = t.m === m; const key = dayKey(ms);
    const kelas = kelasPada(ms); const aktif = kelas.filter((k) => !k.batal);
    const tg = S.data.tugas.filter((x) => dayKey(x.ms) === key); const uj = S.data.ujian.filter((x) => dayKey(x.ms) === key);
    if (inMonth) { tot.kelas += aktif.length; tot.tugas += tg.length; tot.ujian += uj.length; }
    const items = [
      ...uj.map((u) => `<li class="ev ev-ujian" style="${mkVar(u.matkul)}"><i class="ph-fill ph-exam"></i>${esc(u.jenis)} ${esc(u.matkul)}</li>`),
      ...tg.map((x) => `<li class="ev ev-tugas ${x.selesai ? 'done' : ''}" style="${mkVar(x.matkul)}"><i class="ph${x.kumpulSaya || x.selesai ? '-fill' : ''} ph-${x.kumpulSaya || x.selesai ? 'check-circle' : 'circle'}"></i>${esc(x.judul)}</li>`),
      ...kelas.filter((k) => k.batal || k.pengganti).map((k) => `<li class="ev ${k.batal ? 'ev-batal' : 'ev-pengganti'}" style="${mkVar(k.matkul)}"><i class="ph ph-${k.batal ? 'x-circle' : 'arrows-clockwise'}"></i>${esc(k.matkul)}</li>`),
    ];
    const dots = [...new Set(aktif.map((k) => mkKey(k.matkul)))].slice(0, 5).map((c) => `<i style="background:${MK_WARNA[c]}"></i>`).join('');
    const label = `${tgl(ms)}: ${aktif.length} kelas, ${tg.length} tenggat, ${uj.length} ujian`;
    return `<div class="cal-cell" data-day="${ms}" data-out="${!inMonth}" data-today="${ms === sod}" data-past="${ms < sod}" role="button" tabindex="0" aria-label="${label}">
      <div class="cal-top"><span class="cal-num">${t.d}</span>${aktif.length ? `<span class="cal-dots" title="${aktif.length} kelas">${dots}</span>` : ''}</div>
      ${items.length ? `<ul>${items.slice(0, 3).join('')}${items.length > 3 ? `<li class="ev-more">+${items.length - 3} lagi</li>` : ''}</ul>` : ''}
      ${items.length ? `<span class="cal-badge" aria-hidden="true">${items.length}</span>` : ''}</div>`;
  }).join('');
  const sameMonth = y === tn.y && m === tn.m;
  $('#content').innerHTML = `
    ${pageHead('calendar', `${BULAN_PANJANG[m]} ${y}`, 'Ketuk tanggal untuk melihat agenda hari itu. Titik berwarna = kelas, sesuai warna mata kuliah.', [[tot.kelas, 'Pertemuan'], [tot.tugas, 'Tenggat'], [tot.ujian, 'Ujian']],
      `<div class="cal-nav"><button class="icon-btn" data-cal-nav="-1" aria-label="Bulan sebelumnya"><i class="ph ph-caret-left"></i></button><button class="btn btn-secondary btn-sm" data-cal-nav="0" ${sameMonth ? 'disabled' : ''}>Bulan ini</button><button class="icon-btn" data-cal-nav="1" aria-label="Bulan berikutnya"><i class="ph ph-caret-right"></i></button></div>`)}
    <div class="card cal-card"><div class="cal-grid">${['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((d) => `<div class="cal-dow">${d}</div>`).join('')}${html}</div>
      <div class="legend cal-legend"><span><i class="lg-dot"></i>Kelas</span><span><i class="ph-fill ph-exam"></i>Ujian</span><span><i class="ph ph-circle"></i>Tenggat tugas</span><span><i class="ph ph-x-circle"></i>Kelas batal</span><span><i class="ph ph-arrows-clockwise"></i>Pengganti</span></div></div>`;
}

// ---------- Pengumuman (editor) ----------
async function loadPengumuman() {
  try { const first = !S.pengumuman; S.pengumuman = (await api('/api/pengumuman')).pengumuman; if (S.view === 'pengumuman') (first ? enterAnim : (f) => f())(viewPengumuman); } catch (e) { toast(e.message, 'error'); }
}
const P_STATUS = { terjadwal: ['b-info', 'Terjadwal'], terkirim: ['b-done', 'Terkirim'], gagal: ['b-urgent', 'Gagal'], kedaluwarsa: ['b-normal', 'Kedaluwarsa'], mengirim: ['b-warn', 'Mengirim'] };
const pengumumanText = (teks) => `📢 *Pengumuman*\n\n${teks}\n\n_— ${S.user.nama}_`;
function viewPengumuman() {
  const list = S.pengumuman;
  if (!list) { $('#content').innerHTML = '<div class="card muted">Memuat pengumuman…</div>'; return; }
  const draft = S.pDraft || '';
  const b = S.data.bot || {};
  $('#content').innerHTML = `
    ${pageHead('megaphone', 'Pengumuman ke grup', 'Kirim info seperti link materi, ruang pindah, atau pengingat bawa alat. Bisa langsung dikirim atau dijadwalkan.', [[list.filter((p) => p.status === 'terjadwal').length, 'Terjadwal'], [list.filter((p) => p.status === 'terkirim').length, 'Terkirim']])}
    <div class="split">
      <form class="card" id="pgForm"><div class="card-head"><h2><i class="ph ph-pencil-simple-line"></i>Tulis pengumuman</h2></div>
        <div class="rows" style="gap:14px">
          <label class="field"><span>Isi pesan</span><textarea name="teks" rows="7" maxlength="3000" required placeholder="Contoh: Besok kelas *Kalkulus* pindah ke R.204. Jangan lupa bawa kalkulator.">${esc(draft)}</textarea>
            <small class="muted">Format WhatsApp: *tebal*, _miring_. <span id="pgCount">${draft.length}</span>/3000</small></label>
          <label class="inline-field"><input type="checkbox" id="pgJadwal"> Jadwalkan</label>
          <label class="field" id="pgWaktuWrap" hidden><span>Kirim pada (WIB)</span><input type="datetime-local" name="kirim_at"></label>
          <p class="form-error" id="pgErr"></p>
          <div style="display:flex;justify-content:flex-end"><button class="btn btn-primary" id="pgSubmit"><i class="ph ph-paper-plane-tilt"></i><span>Kirim sekarang</span></button></div>
          ${b.wa && b.grup ? '' : '<p class="muted" style="margin:0;font-size:13px"><i class="ph ph-warning"></i> Bot sedang offline atau grup belum diatur. Pengumuman terjadwal tetap disimpan dan dikirim saat bot aktif (maks. 6 jam terlambat).</p>'}
        </div></form>
      <div class="stack">
        <div class="card"><div class="card-head"><h2><i class="ph ph-eye"></i>Pratinjau</h2></div>
          <div class="phone"><div class="phone-head"><span class="avatar"><i class="ph-fill ph-users-three"></i></span><div><b>Grup kelas</b><small>Bot Pengingat Kuliah</small></div></div>
            <div class="chat"><div class="bubble"><pre id="pgPreview">${waFormat(pengumumanText(draft || '…'))}</pre><small>${hm(now())}</small></div></div></div></div>
        <div class="card"><div class="card-head"><h2><i class="ph ph-clock-counter-clockwise"></i>Riwayat pengumuman</h2></div>
          <div class="rows">${list.length ? list.map((p) => `<div class="row"><div class="grow"><div class="title pg-teks">${waFormat(p.teks)}</div>
            <div class="sub"><span>${p.status === 'terjadwal' ? 'Dijadwalkan ' : ''}${tgl(p.kirim_at)} · ${hm(p.kirim_at)}</span><span>oleh ${esc(p.oleh || '–')}</span>${p.detail ? `<span>${esc(p.detail)}</span>` : ''}</div></div>
            ${badge(P_STATUS[p.status] || ['b-normal', p.status])}${p.status === 'terjadwal' || isAdmin() ? `<button class="tiny-btn danger" data-del="pengumuman" data-id="${p.id}" aria-label="Hapus pengumuman"><i class="ph ph-trash"></i></button>` : ''}</div>`).join('')
            : empty('tray', 'Belum ada pengumuman', 'Pengumuman yang dikirim atau dijadwalkan akan muncul di sini.')}</div></div>
      </div></div>`;
  const f = $('#pgForm'); const ta = f.teks; const cb = $('#pgJadwal'); const wrap = $('#pgWaktuWrap');
  ta.oninput = () => { S.pDraft = ta.value; $('#pgCount').textContent = ta.value.length; $('#pgPreview').innerHTML = waFormat(pengumumanText(ta.value || '…')); };
  cb.onchange = () => { wrap.hidden = !cb.checked; f.kirim_at.required = cb.checked; $('#pgSubmit span').textContent = cb.checked ? 'Jadwalkan' : 'Kirim sekarang'; if (cb.checked && !f.kirim_at.value) { const t = w(now() + 3600e3); f.kirim_at.value = `${t.y}-${p2(t.m + 1)}-${p2(t.d)}T${p2(t.h)}:00`; } };
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!ta.value.trim()) { $('#pgErr').textContent = 'Isi pesan dulu.'; ta.focus(); return; }
    const btn = $('#pgSubmit'); btn.disabled = true;
    try {
      const r = await api('/api/pengumuman', { method: 'POST', body: { teks: ta.value, kirim_at: cb.checked ? f.kirim_at.value : '' } });
      S.pDraft = ''; toast(r.status === 'terjadwal' ? 'Pengumuman dijadwalkan.' : 'Pengumuman terkirim ke grup.');
    } catch (err) { $('#pgErr').textContent = err.message; }
    btn.disabled = false; loadPengumuman();
  };
}

// ---------- Riwayat perubahan (admin) ----------
async function loadRiwayat() {
  try { const first = !S.riwayat; S.riwayat = (await api('/api/riwayat')).riwayat; if (S.view === 'riwayat') (first ? enterAnim : (f) => f())(viewRiwayat); } catch (e) { toast(e.message, 'error'); }
}
const AKSI = { tambah: ['plus-circle', 'success', 'menambah'], ubah: ['pencil-simple', '', 'mengubah'], hapus: ['trash', 'danger', 'menghapus'] };
function viewRiwayat() {
  const all = S.riwayat;
  if (!all) { $('#content').innerHTML = '<div class="card muted">Memuat riwayat…</div>'; return; }
  const list = all.filter((x) => S.rwFilter === 'semua' || x.aksi === S.rwFilter);
  const groups = []; for (const x of list) { const k = dayKey(x.at); const g = groups.at(-1); if (g && g.k === k) g.items.push(x); else groups.push({ k, ms: x.at, items: [x] }); }
  const seg = ['semua', 'tambah', 'ubah', 'hapus'].map((f) => `<button class="${S.rwFilter === f ? 'on' : ''}" data-rw="${f}" aria-pressed="${S.rwFilter === f}">${f[0].toUpperCase() + f.slice(1)}<em>${f === 'semua' ? all.length : all.filter((x) => x.aksi === f).length}</em></button>`).join('');
  $('#content').innerHTML = `
    ${pageHead('clock-counter-clockwise', 'Riwayat perubahan', 'Catatan siapa menambah, mengubah, atau menghapus data, dari web maupun dari perintah WhatsApp. 500 catatan terakhir disimpan.', [[all.filter((x) => dayKey(x.at) === dayKey(now())).length, 'Hari ini'], [new Set(all.map((x) => x.oleh)).size, 'Orang']])}
    <div class="toolbar"><div class="toolbar-left"><div class="segmented">${seg}</div></div></div>
    ${groups.length ? groups.map((g) => `<div class="card"><div class="card-head"><h2>${dayKey(g.ms) === dayKey(now()) ? 'Hari ini' : dayKey(g.ms) === dayKey(now() - DAY) ? 'Kemarin' : HARI[w(g.ms).dow]}</h2><span class="muted" style="font-size:13px">${tgl(g.ms)}</span></div>
      <div class="rows">${g.items.map((x) => { const [ic, tone, kata] = AKSI[x.aksi] || ['dot', '', x.aksi]; return `<div class="row"><span class="rw-ic" data-tone="${tone}"><i class="ph ph-${ic}"></i></span><div class="grow"><div class="title"><b>${esc(x.oleh)}</b> ${kata} ${esc(x.jenis)}</div>${x.ringkas ? `<div class="sub">${esc(x.ringkas)}</div>` : ''}</div><time class="muted" style="font-size:12px;font-family:var(--font-mono)">${hm(x.at)}</time></div>`; }).join('')}</div></div>`).join('')
      : `<div class="card">${empty('tray', 'Belum ada riwayat', 'Perubahan data akan tercatat di sini.')}</div>`}`;
}

// ---------- Langganan kalender (.ics) ----------
async function loadIcs() {
  try { S.icsPath = (await api('/api/kalender')).path; const box = $('#icsBox'); if (box) box.innerHTML = icsCard(); } catch (e) { toast(e.message, 'error'); }
}
function icsCard() {
  if (!S.icsPath) return '<p class="muted" style="margin:0">Memuat link…</p>';
  const url = location.origin + S.icsPath; const webcal = url.replace(/^https?:/, 'webcal:');
  return `<p class="muted" style="margin:0 0 12px">Jadwal kuliah, tenggat tugas, dan ujian otomatis muncul di Google Calendar atau kalender HP, dan ikut berubah kalau data di sini berubah.</p>
    <div class="copy-row"><input readonly id="icsUrl" value="${esc(url)}" aria-label="Link langganan kalender" onfocus="this.select()"><button type="button" class="btn btn-secondary btn-sm" data-copy="#icsUrl"><i class="ph ph-copy"></i>Salin</button></div>
    <div class="cal-links"><a class="btn btn-secondary btn-sm" href="https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}" target="_blank" rel="noopener"><i class="ph ph-google-logo"></i>Google Calendar</a><a class="btn btn-secondary btn-sm" href="${esc(webcal)}"><i class="ph ph-device-mobile"></i>Kalender HP (iPhone/Mac)</a></div>
    <small class="muted" style="display:block;margin-top:10px">Android: buka Google Calendar di browser → Kalender lain → Dari URL, lalu tempel link di atas. Link ini berlaku untuk satu kelas, jangan disebar di luar kelas.${isAdmin() ? ' <button type="button" class="link-btn" data-ics-reset>Ganti link</button>' : ''}</small>`;
}

// ---------- Pengingat (admin) ----------
const PLANS = [
  { id: 'pagi', icon: 'sun-horizon', title: 'Ringkasan pagi', desc: 'Kelas hari ini, tugas ≤ 3 hari, dan ujian minggu ini', preview: 'pagi' },
  { id: 'besok', icon: 'moon-stars', title: 'Persiapan besok (H-1)', desc: 'Jadwal besok dan tugas yang tenggatnya sampai besok', preview: 'besok' },
  { id: 'kelas', icon: 'chalkboard-teacher', title: 'Kelas akan dimulai', desc: 'Dikirim beberapa menit sebelum tiap kelas' },
  { id: 'tugas', icon: 'list-checks', title: 'Tenggat tugas', desc: 'Dikirim untuk tiap tugas aktif menjelang tenggat', preview: 'tugas' },
  { id: 'ujian', icon: 'exam', title: 'Pengingat ujian', desc: 'Menjelang ujian dan pagi hari-H', preview: 'ujian' },
  { id: 'pribadi', icon: 'chat-circle-dots', title: 'Pengingat pribadi (chat WA)', desc: 'Dikirim ke chat pribadi anggota yang nomornya terdaftar dan belum menandai tugas sudah kumpul', preview: null },
  { id: 'mingguan', icon: 'calendar-star', title: 'Rekap mingguan', desc: 'Agenda 7 hari ke depan, dikirim tiap hari Minggu', preview: 'mingguan' },
  { id: 'praktikum', icon: 'flask', title: 'Praktikum', desc: 'Sebelum sesi praktikum dimulai dan menjelang tenggat tugas praktikum', preview: 'praktikum' },
];
const LEADS_PRAK = [[2880, 'H-2'], [1440, 'H-1'], [360, '6 jam'], [180, '3 jam'], [60, '1 jam']];
const LEADS_TUGAS = [[4320, 'H-3'], [1440, 'H-1'], [360, '6 jam'], [180, '3 jam'], [60, '1 jam']];
const LEADS_UJIAN = [[10080, 'H-7'], [4320, 'H-3'], [1440, 'H-1']];
let previewTab = 'pagi';
async function loadPengingat() {
  try { const first = !S.pengingat; S.pengingat = await api('/api/pengingat'); if (S.view === 'pengingat') (first ? enterAnim : (f) => f())(viewPengingat); } catch (e) { toast(e.message, 'error'); }
}
function viewPengingat() {
  if (!S.pengingat) { $('#content').innerHTML = '<div class="card muted">Memuat pengaturan…</div>'; return; }
  const p = S.pengingat.pengaturan;
  // Nilai dari .env yang tidak ada di daftar tetap ditampilkan, supaya tidak hilang saat disimpan.
  const leadLabel = (m) => (m % 1440 === 0 ? `H-${m / 1440}` : relMinutes(m));
  const withSaved = (mode, opts) => [...opts, ...p[mode].menit.filter((m) => !opts.some(([v]) => v === m)).map((m) => [m, leadLabel(m)])].sort((a, b) => b[0] - a[0]);
  const leadChecks = (mode, opts) => `<div class="checks">${withSaved(mode, opts).map(([v, l]) => `<label><input type="checkbox" name="${mode}.menit" value="${v}" ${p[mode].menit.includes(v) ? 'checked' : ''}>${l}</label>`).join('')}</div>`;
  const body = {
    pagi: `<label class="inline-field">Jam <input type="time" name="pagi.jam" value="${p.pagi.jam}"> WIB</label>`,
    besok: `<label class="inline-field">Jam <input type="time" name="besok.jam" value="${p.besok.jam}"> WIB</label>`,
    kelas: `<label class="inline-field"><input type="number" min="5" max="180" step="1" name="kelas.menit" value="${p.kelas.menit}"> menit sebelum mulai</label>`,
    tugas: leadChecks('tugas', LEADS_TUGAS),
    ujian: `${leadChecks('ujian', LEADS_UJIAN)}<label class="inline-field">Pagi hari-H <input type="time" name="ujian.pagiJam" value="${p.ujian.pagiJam || ''}"></label>`,
    mingguan: `<label class="inline-field">Minggu jam <input type="time" name="mingguan.jam" value="${p.mingguan?.jam || '19:00'}"> WIB</label>`,
    praktikum: `<label class="inline-field">Sesi: <input type="number" min="5" max="240" step="5" name="praktikum.menit" value="${p.praktikum?.menit ?? 60}"> menit sebelum</label><div class="checks" aria-label="Pengingat tugas praktikum">${[...LEADS_PRAK, ...(p.praktikum?.tugas || []).filter((m) => !LEADS_PRAK.some(([v]) => v === m)).map((m) => [m, leadLabel(m)])].sort((a, b) => b[0] - a[0]).map(([v, l]) => `<label><input type="checkbox" name="praktikum.tugas" value="${v}" ${(p.praktikum?.tugas || []).includes(v) ? 'checked' : ''}>${l}</label>`).join('')}</div>`,
    pribadi: `${leadChecks('pribadi', LEADS_TUGAS)}<div class="checks"><label><input type="checkbox" name="pribadi.ujian" ${p.pribadi?.ujian ? 'checked' : ''}>Ujian H-1</label></div><small class="muted" style="flex-basis:100%">Pesan dikirim satu per satu dengan jeda supaya nomor bot aman dari blokir. Anggota bisa membalas <b>/kumpul nomor</b>.</small>`,
  };
  const plans = PLANS.map((pl) => `<div class="plan">
    <div class="plan-head"><i class="ph-duotone ph-${pl.icon} ic"></i><div class="grow"><b>${pl.title}</b><small>${pl.desc}</small></div>
      <label class="switch" title="Aktif/nonaktif"><input type="checkbox" name="${pl.id}.on" ${p[pl.id].on ? 'checked' : ''}><span></span></label></div>
    <div class="plan-body">${body[pl.id]}${pl.preview ? `<button type="button" class="btn btn-secondary btn-sm" data-send="${pl.preview}"><i class="ph ph-paper-plane-tilt"></i>Kirim sekarang</button>` : ''}</div>
  </div>`).join('');
  const tabs = [['pagi', 'Hari ini'], ['besok', 'Besok'], ['tugas', 'Tugas'], ['ujian', 'Ujian'], ['praktikum', 'Praktikum'], ['mingguan', 'Mingguan'], ['pribadi', 'Pribadi']];
  const jedaAktif = p.jeda?.sampai && p.jeda.sampai >= ymdOf(now());
  const ekstra = `<div class="plan" data-tone="${jedaAktif ? 'warning' : ''}">
      <div class="plan-head"><i class="ph-duotone ph-pause-circle ic"></i><div class="grow"><b>Mode libur</b><small>${jedaAktif ? `Semua pengingat otomatis berhenti sampai ${tgl(msOfYmd(p.jeda.sampai))}. Pengumuman terjadwal tetap dikirim.` : 'Hentikan semua pengingat otomatis sementara, misalnya saat libur semester.'}</small></div></div>
      <div class="plan-body"><label class="inline-field">Jeda sampai <input type="date" name="jeda.sampai" value="${jedaAktif ? p.jeda.sampai : ''}" min="${ymdOf(now())}"></label>${jedaAktif ? '<button type="button" class="btn btn-secondary btn-sm" data-jeda-off>Aktifkan lagi sekarang</button>' : ''}</div></div>
    <div class="plan">
      <div class="plan-head"><i class="ph-duotone ph-moon ic"></i><div class="grow"><b>Jam tenang</b><small>Tidak ada pesan otomatis di jam ini. Pengingat yang jatuh di jam tenang dikirim begitu jam tenang selesai.</small></div>
        <label class="switch" title="Aktif/nonaktif"><input type="checkbox" name="tenang.on" ${p.tenang?.on ? 'checked' : ''}><span></span></label></div>
      <div class="plan-body"><label class="inline-field">Dari <input type="time" name="tenang.dari" value="${p.tenang?.dari || '22:00'}"></label><label class="inline-field">sampai <input type="time" name="tenang.sampai" value="${p.tenang?.sampai || '05:00'}"></label></div></div>`;
  const n = now();
  $('#content').innerHTML = `
    ${pageHead('bell', 'Pusat pengingat', 'Atur kapan bot WhatsApp mengirim pengingat ke grup kelas. Pratinjau pesan ada di sebelah kanan.', [[PLANS.filter((pl) => p[pl.id].on).length + ' / ' + PLANS.length, 'Jenis aktif']])}<div class="split">
    <form class="card" id="pForm"><div class="card-head"><h2><i class="ph-fill ph-whatsapp-logo"></i>Jadwal pengingat otomatis</h2></div>
      <div class="rows" style="gap:10px">${plans}${ekstra}</div>
      <div style="display:flex;justify-content:flex-end;align-items:center;gap:12px;margin-top:16px;flex-wrap:wrap"><span class="draft-status" id="pStatus" aria-live="polite"></span><button class="btn btn-primary" id="pSave"><i class="ph ph-floppy-disk"></i>Simpan &amp; aktifkan</button></div>
    </form>
    <div class="stack">
      <div class="card"><div class="card-head"><h2><i class="ph ph-eye"></i>Pratinjau pesan</h2></div>
        <div class="segmented" style="margin-bottom:12px">${tabs.map(([k, l]) => `<button class="${previewTab === k ? 'on' : ''}" data-ptab="${k}">${l}</button>`).join('')}</div>
        <div class="phone"><div class="phone-head"><span class="avatar"><i class="ph-fill ph-users-three"></i></span><div><b>Grup kelas</b><small>Bot Pengingat Kuliah</small></div></div>
          <div class="chat"><span class="date-chip">${tgl(n)}</span><div class="bubble"><pre>${waFormat(S.pengingat.preview[previewTab] || '')}</pre><small>${hm(n)}</small></div></div></div>
        <p class="note-line"><i class="ph ph-info"></i><span>Pengingat pagi dan H-1 dilewati kalau tidak ada kelas, tugas, ujian, atau praktikum. Semua waktu dalam WIB.</span></p>
      </div>
    </div></div>`;
  $('#pForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target); const out = {};
    for (const pl of PLANS) out[pl.id] = { on: fd.has(`${pl.id}.on`) };
    out.pagi.jam = fd.get('pagi.jam'); out.besok.jam = fd.get('besok.jam'); out.kelas.menit = Number(fd.get('kelas.menit'));
    out.tugas.menit = fd.getAll('tugas.menit').map(Number); out.ujian.menit = fd.getAll('ujian.menit').map(Number); out.ujian.pagiJam = fd.get('ujian.pagiJam');
    out.pribadi.menit = fd.getAll('pribadi.menit').map(Number); out.pribadi.ujian = fd.has('pribadi.ujian');
    out.mingguan.jam = fd.get('mingguan.jam');
    out.praktikum.menit = Number(fd.get('praktikum.menit')); out.praktikum.tugas = fd.getAll('praktikum.tugas').map(Number);
    out.tenang = { on: fd.has('tenang.on'), dari: fd.get('tenang.dari'), sampai: fd.get('tenang.sampai') };
    out.jeda = { sampai: fd.get('jeda.sampai') || null };
    const btn = $('#pSave'); btn.disabled = true; btn.lastChild.textContent = 'Menyimpan…';
    const auto = S.pAuto; S.pAuto = false;
    try {
      const r = await api('/api/pengingat', { method: 'PUT', body: out }); S.pengingat.pengaturan = r.pengaturan;
      if (auto) { const st = $('#pStatus'); if (st) st.innerHTML = `<i class="ph ph-check-circle"></i> Tersimpan otomatis ${hm(now())}`; } else toast('Pengaturan pengingat disimpan.');
    }
    catch (err) { toast(err.message, 'error'); }
    btn.disabled = false; btn.lastChild.textContent = 'Simpan & aktifkan';
  };
}

// ---------- Status bot (admin) ----------
async function loadStatus() {
  try { const first = !S.status; const [st, bk] = await Promise.all([api('/api/status'), api('/api/backup').catch(() => null)]); S.status = st; S.backup = bk; if (S.view === 'status') (first ? enterAnim : (f) => f())(viewStatus); } catch (e) { toast(e.message, 'error'); }
}
const LOG_MODE = { pagi: 'Ringkasan pagi', besok: 'Persiapan besok', kelas: 'Kelas dimulai', tugas: 'Tenggat tugas', ujian: 'Ujian', tes: 'Pesan percobaan', pribadi: 'Pengingat pribadi', pengumuman: 'Pengumuman', mingguan: 'Rekap mingguan', polling: 'Polling', praktikum: 'Praktikum' };
function viewStatus() {
  const s = S.status;
  if (!s) { $('#content').innerHTML = '<div class="card muted">Memeriksa bot…</div>'; return; }
  const tile = (ok, icon, title, sub) => `<div class="tile ${ok ? 'ok' : 'warn'}"><i class="ph-fill ph-${ok ? 'check-circle' : 'warning-circle'}"></i><b>${title}</b><small>${sub}</small></div>`;
  const numTile = (icon, label, val) => `<div class="tile num-tile"><small><i class="ph ph-${icon}"></i> ${label}</small><strong>${val}</strong></div>`;
  $('#content').innerHTML = `
    ${pageHead('robot', 'Status bot', 'Kesehatan bot WhatsApp, isi database, dan riwayat pesan yang dikirim ke grup.', [[s.wa ? 'Online' : 'Offline', 'WhatsApp'], [s.gagal24, 'Gagal 24 jam']])}
    <div class="card"><div class="card-head"><h2><i class="ph ph-heartbeat"></i>Kesehatan sistem</h2><button class="btn btn-secondary btn-sm" data-reload-status><i class="ph ph-arrows-clockwise"></i>Periksa ulang</button></div>
      <div class="tiles">
        ${tile(s.wa, 'whatsapp-logo', 'WhatsApp', s.wa ? `Terhubung${s.nomor ? ` sebagai +${esc(s.nomor)}` : ''}` : 'Belum terhubung')}
        ${tile(!!s.grupJid, 'users-three', 'Grup tujuan', s.grupJid ? esc(s.grupNama || s.grupJid) : 'GROUP_JID belum diisi')}
        ${tile(true, 'clock', 'Penjadwal', 'Memeriksa pengingat tiap menit')}
        ${tile(s.gagal24 === 0, 'paper-plane-tilt', 'Pengiriman 24 jam', s.gagal24 ? `${s.gagal24} pesan gagal` : 'Tidak ada kegagalan')}
      </div></div>
    <div class="tiles">${numTile('calendar-dots', 'Kelas / minggu', s.jumlah.kelas)}${numTile('list-checks', 'Tugas aktif', s.jumlah.tugasAktif)}${numTile('exam', 'Ujian mendatang', s.jumlah.ujian)}${numTile('users', 'Akun', s.jumlah.akun)}</div>
    <div class="split">
      <div class="card"><div class="card-head"><h2><i class="ph ph-clock-counter-clockwise"></i>Riwayat pengiriman</h2></div>
        <div class="rows">${s.log.length ? s.log.map((l) => `<div class="row"><div class="grow"><div class="title">${LOG_MODE[l.mode] || esc(l.mode)}</div><div class="sub">${tgl(l.at)} · ${hm(l.at)}${l.detail ? ` · ${esc(l.detail)}` : ''}</div></div>${badge(l.status === 'terkirim' ? ['b-done', 'Terkirim'] : ['b-urgent', 'Gagal'])}</div>`).join('') : empty('tray', 'Belum ada riwayat', 'Pesan yang dikirim bot akan tercatat di sini.')}</div></div>
      <div class="card"><div class="card-head"><h2><i class="ph ph-flask"></i>Kirim pesan percobaan</h2></div>
        <p class="muted" style="margin:0 0 14px;font-size:13px">Kirim satu pesan uji ke grup untuk memastikan bot bisa mengirim.</p>
        <button class="btn btn-primary" data-test-send ${s.wa && s.grupJid ? '' : 'disabled'}><i class="ph ph-paper-plane-tilt"></i>Kirim tes ke grup</button></div>
    </div>
    ${backupCard()}`;
}
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
function backupCard() {
  const b = S.backup; if (!b) return '';
  const last = b.daftar[0];
  return `<div class="card"><div class="card-head"><div><h2><i class="ph ph-database"></i>Backup database</h2>
      <span class="muted" style="font-size:13px">Otomatis tiap hari jam ${esc(b.jam)} WIB, ${b.simpan} backup terakhir disimpan di server.</span></div>
      <button class="btn btn-secondary btn-sm" data-backup-now><i class="ph ph-floppy-disk"></i>Backup sekarang</button></div>
    ${last ? `<p class="muted" style="margin:0;font-size:13px">Terakhir: <b style="color:var(--color-text)">${tgl(last.at)} · ${hm(last.at)}</b></p>` : ''}
    <div class="rows">${b.daftar.length ? b.daftar.slice(0, 7).map((x) => `<div class="row"><div class="grow"><div class="title">${tgl(x.at)} · ${hm(x.at)}</div><div class="sub">${esc(x.name)} · ${fmtSize(x.size)}</div></div><button class="tiny-btn" data-backup-dl="${esc(x.name)}" aria-label="Unduh ${esc(x.name)}" title="Unduh"><i class="ph ph-download-simple"></i></button></div>`).join('') : empty('database', 'Belum ada backup', 'Backup pertama dibuat otomatis, atau klik Backup sekarang.')}</div></div>`;
}
async function downloadBackup(name) {
  const r = await fetch(`/api/backup/${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error('Gagal mengunduh backup');
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Akun (admin) ----------
async function loadAkun() {
  try { const first = !S.akun; S.akun = (await api('/api/akun')).akun; if (S.view === 'akun') (first ? enterAnim : (f) => f())(viewAkun); } catch (e) { toast(e.message, 'error'); }
}
function viewAkun() {
  if (!S.akun) { $('#content').innerHTML = '<div class="card muted">Memuat akun…</div>'; return; }
  const roleBadge = (r) => badge([r === 'admin' ? 'b-urgent' : r === 'editor' ? 'b-info' : 'b-normal', ROLE_LABEL[r]]);
  $('#content').innerHTML = `
    ${pageHead('users', 'Akun kelas', '<b>Admin</b> mengatur semuanya, <b>Editor</b> mengubah jadwal, tugas, dan ujian, <b>Anggota</b> hanya melihat.', [[S.akun.length, 'Akun'], [S.akun.filter((a) => a.role === 'admin').length, 'Admin'], [S.akun.filter((a) => a.role === 'editor').length, 'Editor'], [S.akun.filter((a) => a.wa).length, 'Login WA']], '<button class="btn btn-primary" data-add="akun"><i class="ph ph-user-plus"></i>Tambah akun</button>')}
    <div class="card"><div class="rows">${S.akun.map((a) => `<div class="row"><span class="avatar">${esc(a.nama[0] || '?').toUpperCase()}</span><div class="grow"><div class="title">${esc(a.nama)}${a.id === S.user.id ? ' <span class="muted">(kamu)</span>' : ''}</div><div class="sub">@${esc(a.username)}${a.wa ? ` · <i class="ph ph-whatsapp-logo" aria-hidden="true"></i> +${esc(a.wa)}` : ' · <span class="muted">WA belum diisi</span>'}</div></div>${roleBadge(a.role)}
      <button class="tiny-btn" data-edit="akun" data-id="${a.id}" aria-label="Ubah"><i class="ph ph-pencil-simple"></i></button>${a.id !== S.user.id ? `<button class="tiny-btn danger" data-del="akun" data-id="${a.id}" aria-label="Hapus"><i class="ph ph-trash"></i></button>` : '<span style="width:30px"></span>'}</div>`).join('')}</div></div>`;
}

// ---------- Profil ----------
function viewProfil() {
  const izin = { admin: ['Mengelola jadwal, tugas, dan ujian', 'Mengatur pengingat bot', 'Mengelola akun anggota'], editor: ['Mengelola jadwal, tugas, dan ujian', 'Melihat semua data kelas'], viewer: ['Melihat jadwal, tugas, dan ujian', 'Menandai tugas yang sudah kamu kumpulkan', 'Berlangganan kalender kelas'] }[S.user.role] || [];
  $('#content').innerHTML = `${pageHead('user-circle', S.user.nama, `@${esc(S.user.username)} · ${ROLE_LABEL[S.user.role]}`)}
  <div class="profil-grid"><form class="card" id="profForm">
    <div class="card-head"><h2><i class="ph ph-user-circle"></i>Akun kamu</h2>${badge(['b-info', ROLE_LABEL[S.user.role]])}</div>
    <div class="rows" style="gap:14px">
      <label class="field"><span>Username</span><input value="${esc(S.user.username)}" disabled></label>
      <label class="field"><span>Nama</span><input name="nama" value="${esc(S.user.nama)}" required></label>
      <div class="grid2"><label class="field"><span>Password lama</span><input type="password" name="passwordLama" autocomplete="current-password"></label>
      <label class="field"><span>Password baru</span><input type="password" name="passwordBaru" minlength="8" autocomplete="new-password" placeholder="Kosongkan kalau tidak diganti"></label></div>
      <p class="form-error" id="profErr"></p>
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-secondary" data-logout><i class="ph ph-sign-out"></i>Keluar</button><button class="btn btn-primary"><i class="ph ph-floppy-disk"></i>Simpan profil</button></div>
    </div></form>
    <div class="stack">
      <div class="card"><div class="card-head"><h2><i class="ph ph-shield-check"></i>Yang bisa kamu lakukan</h2></div>
        <ul class="checklist">${izin.map((x) => `<li><i class="ph ph-check" aria-hidden="true"></i>${x}</li>`).join('')}</ul></div>
      <div class="card"><div class="card-head"><h2><i class="ph ph-calendar-plus"></i>Langganan kalender</h2></div><div id="icsBox">${icsCard()}</div></div>
      <div class="card"><div class="card-head"><h2><i class="ph ph-whatsapp-logo"></i>Masuk lewat WhatsApp</h2></div>
        <p class="muted" style="margin:0">Kirim <b>login</b> ke bot WhatsApp dari nomor yang terdaftar di akunmu, lalu ketuk link yang dibalas bot. Nomor diatur oleh admin di menu Management Akun.</p></div>
    </div></div>`;
  $('#profForm').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('/api/auth/me', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); if (r.token) { token = r.token; try { sessionStorage.setItem('token', token); } catch {} } S.user.nama = new FormData(e.target).get('nama') || S.user.nama; setUserChip(); e.target.passwordLama.value = ''; e.target.passwordBaru.value = ''; $('#profErr').textContent = ''; toast('Profil disimpan.'); }
    catch (err) { $('#profErr').textContent = err.message; }
  };
}

// ---------- Modal tambah/ubah/detail ----------
// Pilihan mata kuliah dari menu Mata Kuliah, plus opsi menambah yang baru langsung di form.
function mkField(v, hint = '') {
  const list = S.data.matkul || []; const cur = v.matkul || '';
  const known = list.some((m) => m.nama === cur);
  const baru = !list.length || (cur && !known);
  return `<label class="field"><span>Mata kuliah</span><select name="matkul" data-mk-select ${baru && !list.length ? 'hidden' : ''}>
      ${cur ? '' : '<option value="" disabled selected>Pilih mata kuliah…</option>'}
      ${list.map((m) => `<option value="${esc(m.nama)}" ${m.nama === cur ? 'selected' : ''}>${esc(m.nama)}</option>`).join('')}
      <option value="__baru" ${baru && list.length ? 'selected' : ''}>+ Mata kuliah baru…</option></select>
    <input name="matkulBaru" data-mk-new placeholder="Nama mata kuliah baru, contoh: Ekologi Perairan" value="${known ? '' : esc(cur)}" ${baru ? '' : 'hidden'}>
    <small class="muted">${list.length ? 'Daftar diambil dari menu Mata Kuliah.' : 'Belum ada mata kuliah. Ketik namanya, nanti otomatis masuk menu Mata Kuliah.'}${hint ? ` ${hint}` : ''}</small></label>`;
}
const FORMS = {
  matkul: { label: 'mata kuliah', eyebrow: 'Mata kuliah', fields: (v) => `
    <label class="field"><span>Nama mata kuliah</span><input name="nama" required maxlength="80" value="${esc(v.nama)}" placeholder="Ekologi Perairan"></label>
    <label class="field"><span>Dosen pengampu (opsional)</span><input name="dosen" value="${esc(v.dosen)}" placeholder="Dr. Sari"></label>
    <fieldset class="field swatches"><span>Warna</span><div class="sw-row">${MK_KEYS.map((k) => `<label class="sw" style="--mk:${MK_WARNA[k]}" title="${k[0].toUpperCase() + k.slice(1)}"><input type="radio" name="warna" value="${k}" ${(v.warna || (v.nama ? mkKey(v.nama) : MK_KEYS[0])) === k ? 'checked' : ''} aria-label="Warna ${k}"><i></i></label>`).join('')}</div>
      <small class="muted">Dipakai di jadwal, tugas, ujian, dan kalender supaya mata kuliah mudah dikenali.</small></fieldset>
    <div class="grid2"><label class="field"><span>Kontak dosen (opsional)</span><input name="kontak" value="${esc(v.kontak)}" placeholder="0812… / email"></label>
      <label class="field"><span>Batas tidak hadir</span><input type="number" name="maks_bolos" min="0" max="30" value="${v.maks_bolos ?? ''}" placeholder="mis. 3"></label></div>
    <label class="field"><span>Bobot nilai (opsional)</span><textarea name="bobot" rows="3" placeholder="Tugas: 30&#10;UTS: 30&#10;UAS: 40">${esc((v.bobot || []).map((b) => `${b.nama}: ${b.bobot}`).join('\n'))}</textarea><small class="muted">Satu komponen per baris, total 100%. Dipakai kalkulator nilai di halaman mata kuliah.</small></label>
    <label class="field"><span>Catatan (opsional)</span><textarea name="catatan" placeholder="Link grup kelas, buku wajib, aturan absen, dll.">${esc(v.catatan)}</textarea></label>
    ${v.id && v.pakai && (v.pakai.jadwal + v.pakai.tugas + v.pakai.ujian) ? '<small class="muted">Mengganti nama ikut mengubah jadwal, tugas, dan ujian yang memakai mata kuliah ini.</small>' : ''}` },
  kelas: { label: 'jadwal', eyebrow: 'Jadwal kuliah', fields: (v) => `
    ${mkField(v, 'Kuliah 2× seminggu? Tambahkan 2 jadwal untuk mata kuliah yang sama.')}
    <label class="field"><span>Hari</span><select name="hari">${[1, 2, 3, 4, 5, 6, 0].map((h) => `<option value="${h}" ${+v.hari === h ? 'selected' : ''}>${HARI[h]}</option>`).join('')}</select></label>
    <div class="grid2"><label class="field"><span>Mulai</span><input type="time" name="mulai" required value="${esc(v.mulai)}"></label><label class="field"><span>Selesai</span><input type="time" name="selesai" value="${esc(v.selesai)}"></label></div>
    <div class="grid2"><label class="field"><span>Ruang</span><input name="ruang" value="${esc(v.ruang)}" placeholder="R.301"></label><label class="field"><span>Dosen</span><input name="dosen" value="${esc(v.dosen)}"></label></div>` },
  tugas: { label: 'tugas', eyebrow: 'Tugas', fields: (v) => `
    <label class="field"><span>Judul tugas</span><input name="judul" required value="${esc(v.judul)}" placeholder="Laporan praktikum 3"></label>
    ${mkField(v)}
    <div class="grid2"><label class="field"><span>Tenggat</span><input type="datetime-local" name="deadline" required value="${esc((v.deadline || '').replace(' ', 'T'))}"></label>
    <label class="field"><span>Prioritas</span><select name="prioritas"><option value="normal">Normal</option><option value="tinggi" ${v.prioritas === 'tinggi' ? 'selected' : ''}>Tinggi</option></select></label></div>
    <div class="grid2"><label class="field"><span>Link pengumpulan</span><input name="link" type="url" value="${esc(v.link)}" placeholder="https://…"></label>
      <label class="field"><span>Link soal / lampiran</span><input name="lampiran" type="url" value="${esc(v.lampiran)}" placeholder="https://…"></label></div>
    <label class="field"><span>Catatan</span><textarea name="catatan" placeholder="Format pengumpulan, ketentuan, dll.">${esc(v.catatan)}</textarea></label>
    <label class="field"><span>Langkah pengerjaan (opsional)</span><textarea name="langkah" rows="3" placeholder="Satu langkah per baris&#10;Cari referensi&#10;Buat draf&#10;Upload">${esc(v.langkah)}</textarea><small class="muted">Tiap anggota bisa mencentang progresnya sendiri.</small></label>
    <label class="inline-field"><input type="checkbox" name="kelompok" ${v.kelompok ? 'checked' : ''}> Tugas kelompok <small class="muted">(atur anggota kelompok dari detail tugas)</small></label>
    ${v.id ? `<label class="inline-field"><input type="checkbox" name="selesai" ${v.selesai ? 'checked' : ''}> Sudah selesai (tutup tugas)</label>
      <label class="inline-field"><input type="checkbox" name="umumkan" checked> Beri tahu grup kalau tenggat berubah</label>`
    : `<label class="inline-field"><input type="checkbox" data-ulang-cb> Ulangi tiap minggu</label><label class="field" data-ulang-wrap hidden><span>Ulangi sampai tanggal</span><input type="date" name="ulang"></label>`}` },
  ujian: { label: 'ujian', eyebrow: 'Ujian', fields: (v) => `
    ${mkField(v)}
    <div class="grid2"><label class="field"><span>Jenis</span><select name="jenis">${[...new Set(['UTS', 'UAS', 'Kuis', 'Praktikum', ...(v.jenis ? [v.jenis] : [])])].map((j) => `<option ${v.jenis === j ? 'selected' : ''}>${esc(j)}</option>`).join('')}</select></label>
    <label class="field"><span>Ruang</span><input name="ruang" value="${esc(v.ruang)}"></label></div>
    <label class="field"><span>Waktu</span><input type="datetime-local" name="waktu" required value="${esc((v.waktu || '').replace(' ', 'T'))}"></label>
    <div class="grid2"><label class="field"><span>Yang harus dibawa</span><input name="bawa" value="${esc(v.bawa)}" placeholder="Kalkulator, KTM, pensil 2B"></label>
      <label class="field"><span>Link ujian online</span><input name="link" type="url" value="${esc(v.link)}" placeholder="https://meet…"></label></div>
    <label class="field"><span>Materi / kisi-kisi</span><textarea name="materi" rows="4" placeholder="Satu bab per baris&#10;Bab 1 Limit&#10;Bab 2 Turunan">${esc(v.materi)}</textarea><small class="muted">Jadi checklist belajar untuk tiap anggota.</small></label>
    ${v.id ? '<label class="inline-field"><input type="checkbox" name="umumkan" checked> Beri tahu grup kalau jadwal ujian berubah</label>' : ''}` },
  batal: { label: 'kelas batal', eyebrow: 'Perubahan jadwal', endpoint: 'kelas-ubah', fields: (v) => `
    <input type="hidden" name="jenis" value="batal">
    <label class="field"><span>Tanggal</span><input type="date" name="tanggal" required min="${ymdOf(now())}" value="${esc(v.tanggal || '')}"></label>
    <label class="field"><span>Kelas yang batal</span><select name="kelas_id" required data-batal-kelas>${opsiKelas(v.tanggal, v.kelas_id)}</select></label>
    <label class="field"><span>Keterangan (opsional)</span><input name="catatan" placeholder="Dosen dinas luar kota" maxlength="200"></label>
    <label class="inline-field"><input type="checkbox" name="umumkan" checked> Umumkan ke grup WhatsApp sekarang</label>
    <small class="muted">Bot tidak akan mengirim pengingat untuk kelas ini di tanggal tersebut.</small>` },
  pengganti: { label: 'kuliah pengganti', eyebrow: 'Perubahan jadwal', endpoint: 'kelas-ubah', fields: (v) => `
    <input type="hidden" name="jenis" value="pengganti">
    ${mkField(v)}
    <label class="field"><span>Tanggal</span><input type="date" name="tanggal" required min="${ymdOf(now())}" value="${esc(v.tanggal || '')}"></label>
    <div class="grid2"><label class="field"><span>Mulai</span><input type="time" name="mulai" required></label><label class="field"><span>Selesai</span><input type="time" name="selesai"></label></div>
    <div class="grid2"><label class="field"><span>Ruang</span><input name="ruang" placeholder="R.301"></label><label class="field"><span>Dosen</span><input name="dosen"></label></div>
    <label class="field"><span>Keterangan (opsional)</span><input name="catatan" placeholder="Pengganti pertemuan 12 Nov" maxlength="200"></label>
    <label class="inline-field"><input type="checkbox" name="umumkan" checked> Umumkan ke grup WhatsApp sekarang</label>
    <small class="muted">Bot ikut mengingatkan kuliah pengganti ini sebelum dimulai.</small>` },
  akun: { label: 'akun', eyebrow: 'Kelola akun', fields: (v) => `
    <label class="field"><span>Nama</span><input name="nama" required value="${esc(v.nama)}"></label>
    <label class="field"><span>Username</span><input name="username" required value="${esc(v.username)}" ${v.id ? 'disabled' : ''} autocapitalize="none" placeholder="huruf kecil, tanpa spasi"></label>
    <label class="field"><span>Peran</span><select name="role">${['viewer', 'editor', 'admin'].map((r) => `<option value="${r}" ${(v.role || 'viewer') === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></label>
    <label class="field"><span>Nomor WhatsApp (opsional)</span><input name="wa" type="tel" inputmode="tel" value="${v.wa ? '+' + esc(v.wa) : ''}" placeholder="081234567890"><small class="muted">Kalau diisi, pemilik akun bisa masuk dengan mengirim <b>login</b> ke bot WhatsApp.</small></label>
    <label class="field"><span>${v.id ? 'Password baru (opsional)' : 'Password'}</span><input type="password" name="password" minlength="8" ${v.id ? '' : 'required'} autocomplete="new-password"></label>` },
};
const LIST_OF = { akun: () => S.akun, ubah: () => S.data.kelasUbah, pengumuman: () => S.pengumuman };
const findItem = (type, id) => ((LIST_OF[type] ? LIST_OF[type]() : S.data[type]) || []).find((x) => x.id === id);
const endpointOf = (type) => FORMS[type]?.endpoint || ({ ubah: 'kelas-ubah' })[type] || type;
const dowOfYmd = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();
// Pilihan kelas untuk form "kelas batal": hanya kelas yang ada di hari tanggal terpilih.
function opsiKelas(tanggal, sel) {
  const list = S.data.kelas.filter((k) => !tanggal || k.hari === dowOfYmd(tanggal)).sort((a, b) => ((a.hari + 6) % 7) - ((b.hari + 6) % 7) || a.mulai.localeCompare(b.mulai));
  if (!list.length) return `<option value="" disabled selected>${tanggal ? `Tidak ada kelas hari ${HARI[dowOfYmd(tanggal)]}` : 'Belum ada jadwal'}</option>`;
  return `${sel ? '' : '<option value="" disabled selected>Pilih kelas…</option>'}${list.map((k) => `<option value="${k.id}" ${k.id === Number(sel) ? 'selected' : ''}>${HARI[k.hari]} ${k.mulai} · ${esc(k.matkul)}</option>`).join('')}`;
}
let editing = null;
function openForm(type, id, preset) {
  const v = id ? findItem(type, id) : preset || (type === 'kelas' ? { hari: w(now()).dow || 1 } : {});
  editing = { type, id };
  const f = FORMS[type];
  $('#mEyebrow').textContent = f.eyebrow;
  $('#mTitle').textContent = `${id ? 'Ubah' : 'Tambah'} ${f.label}`;
  $('#mBody').innerHTML = f.fields(v) + '<p class="form-error" id="mErr"></p>';
  const sel = $('#mBody [data-mk-select]'); const inp = $('#mBody [data-mk-new]');
  if (sel) {
    const sync = () => { const b = sel.value === '__baru'; inp.hidden = !b; inp.required = b; if (b && document.activeElement === sel) inp.focus(); };
    sel.required = !sel.hidden; inp.required = !inp.hidden;
    sel.addEventListener('change', () => {
      sync();
      // Jadwal: isi dosen otomatis dari data mata kuliah kalau masih kosong.
      const m = (S.data.matkul || []).find((x) => x.nama === sel.value); const dosen = $('#mBody [name=dosen]');
      if (type === 'kelas' && m?.dosen && dosen && !dosen.value) dosen.value = m.dosen;
    });
  }
  const ulangCb = $('#mBody [data-ulang-cb]');
  if (ulangCb) ulangCb.onchange = () => { const wrap = $('#mBody [data-ulang-wrap]'); wrap.hidden = !ulangCb.checked; wrap.querySelector('input').required = ulangCb.checked; };
  if (type === 'batal') {
    const d = $('#mBody [name=tanggal]'); const ks = $('#mBody [data-batal-kelas]');
    d.addEventListener('change', () => { const cur = ks.value; ks.innerHTML = opsiKelas(d.value, cur); });
  }
  $('#mFoot').innerHTML = `<button type="button" class="btn btn-secondary" data-close>Batal</button><button class="btn btn-primary" id="mSubmit"><i class="ph ph-floppy-disk"></i>Simpan</button>`;
  $('#modal').showModal(); a11yPass();
  setTimeout(() => $('#mBody input:not([disabled]), #mBody select')?.focus(), 30);
}
function openDetail(type, id) {
  const v = findItem(type, id); if (!v) return;
  editing = { type, id, detail: true };
  const ubahKelas = type === 'ubah' && v.jenis === 'batal' ? S.data.kelas.find((k) => k.id === v.kelas_id) : null;
  const rows = {
    ubah: type === 'ubah' && [['Jenis', v.jenis === 'batal' ? 'Kelas batal' : 'Kuliah pengganti'], ['Tanggal', tgl(msOfYmd(v.tanggal))], ['Jam', ubahKelas ? `${ubahKelas.mulai}${ubahKelas.selesai ? ' – ' + ubahKelas.selesai : ''}` : `${v.mulai || ''}${v.selesai ? ' – ' + v.selesai : ''}`], ['Ruang', v.ruang], ['Dosen', v.dosen], ['Keterangan', v.catatan]],
    kelas: [['Hari', HARI[v.hari]], ['Jam', `${v.mulai}${v.selesai ? ' – ' + v.selesai : ''}`], ['Ruang', v.ruang], ['Dosen', v.dosen]],
    tugas: [['Mata kuliah', v.matkul], ['Tenggat', `${tgl(v.ms)} · ${hm(v.ms)} WIB`], ['Status', badge(dueBadge(v.ms, v.selesai))], ['Prioritas', v.prioritas === 'tinggi' ? 'Tinggi' : 'Normal'], ['Catatan', v.catatan], ['Pengumpulan', `<div id="kumpulBox"><span class="muted">${v.kumpulN || 0} dari ${S.data.anggota || 0} anggota sudah kumpul</span></div>`]],
    ujian: [['Jenis', v.jenis], ['Waktu', `${tgl(v.ms)} · ${hm(v.ms)} WIB`], ['Ruang', v.ruang], ['Status', v.ms < now() ? 'Selesai' : badge(dueBadge(v.ms))]],
  }[type];
  $('#mEyebrow').textContent = type === 'ubah' ? 'Perubahan jadwal' : FORMS[type].eyebrow;
  $('#mTitle').textContent = type === 'tugas' ? v.judul : (ubahKelas?.matkul || v.matkul || 'Kelas');
  $('#mBody').innerHTML = `<dl class="detail-list">${rows.filter(([, val]) => val).map(([k, val]) => `<div><dt>${k}</dt><dd>${['Status', 'Pengumpulan'].includes(k) ? val : esc(val).replace(/\n/g, '<br>')}</dd></div>`).join('')}</dl>`;
  const edit = type !== 'ubah' ? `<button type="button" class="btn btn-primary" data-edit="${type}" data-id="${id}"><i class="ph ph-pencil-simple"></i>Ubah</button>` : '';
  const ekstra = type === 'tugas' ? kumpulBtn(v) : type === 'kelas' && canEdit() ? `<button type="button" class="btn btn-secondary" data-batalkan="${v.id}"><i class="ph ph-calendar-x"></i>Batalkan pertemuan</button>` : '';
  $('#mFoot').innerHTML = canEdit()
    ? `<button type="button" class="btn btn-danger left" data-del="${type}" data-id="${id}"><i class="ph ph-trash"></i>Hapus</button>${ekstra}<button type="button" class="btn btn-secondary" data-close>Tutup</button>${edit}`
    : `${ekstra}<button type="button" class="btn btn-secondary" data-close>Tutup</button>`;
  $('#modal').showModal();
  if (type === 'tugas') loadKumpul(v);
  if (typeof detailEkstra === 'function') detailEkstra(type, v);
}
// Siapa saja yang sudah / belum kumpul (dimuat saat detail tugas dibuka).
async function loadKumpul(t) {
  try {
    const r = await api(`/api/tugas/${t.id}/kumpul`); const box = $('#kumpulBox'); if (!box) return;
    const pct = (r.sudah.length + r.belum.length) ? Math.round(r.sudah.length / (r.sudah.length + r.belum.length) * 100) : 0;
    box.innerHTML = `<div class="kumpul-sum"><b>${r.sudah.length}/${r.sudah.length + r.belum.length}</b> anggota sudah kumpul<div class="bar"><i style="width:${pct}%"></i></div></div>
      ${r.sudah.length ? `<details><summary>Sudah (${r.sudah.length})</summary><p>${r.sudah.map((x) => esc(x.nama)).join(', ')}</p></details>` : ''}
      ${r.belum.length ? `<details ${r.belum.length <= 8 ? 'open' : ''}><summary>Belum (${r.belum.length})</summary><p>${r.belum.map(esc).join(', ')}</p></details>` : ''}`;
  } catch { /* biarkan ringkasan angka */ }
}
$('#modalForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editing || editing.detail) return;
  const form = e.target; const bad = [...form.elements].find((el) => el.willValidate && !el.checkValidity());
  if (bad) { $('#mErr').textContent = `${bad.closest('.field')?.querySelector('span')?.textContent || 'Isian'} belum valid.`; bad.focus(); return; }
  const fd = new FormData(form); const body = Object.fromEntries(fd);
  // "selesai" di tugas = kotak centang; di jadwal = jam selesai (jangan ditimpa).
  if (editing.type === 'tugas') { body.selesai = fd.has('selesai'); body.kelompok = fd.has('kelompok'); }
  if ((editing.type === 'tugas' || editing.type === 'ujian') && editing.id) body.umumkan = fd.has('umumkan');
  if (editing.type === 'tugas' && !$('#mBody [data-ulang-cb]')?.checked) delete body.ulang;
  if (editing.type === 'batal' || editing.type === 'pengganti') body.umumkan = fd.has('umumkan');
  if ('matkulBaru' in body) { if (body.matkul === '__baru' || !body.matkul) body.matkul = body.matkulBaru; delete body.matkulBaru; }
  const { type, id } = editing; const btn = $('#mSubmit'); btn.disabled = true; btn.lastChild.textContent = 'Menyimpan…';
  try {
    const res = await api(`/api/${endpointOf(type)}${id ? '/' + id : ''}`, { method: id ? 'PUT' : 'POST', body });
    $('#modal').close();
    if (res.umum && res.umum !== 'terkirim') toast(`Disimpan, tapi gagal diumumkan ke grup (${res.umum.replace(/^gagal: /, '')}).`, 'error');
    else toast(`${FORMS[type].label[0].toUpperCase() + FORMS[type].label.slice(1)} ${id ? 'diperbarui' : res.ids?.length > 1 ? `ditambahkan (${res.ids.length} pekan)` : 'ditambahkan'}${res.umum ? ' dan diumumkan ke grup' : ''}.`);
    type === 'akun' ? loadAkun() : refresh();
  } catch (err) { $('#mErr').textContent = err.message; btn.disabled = false; btn.lastChild.textContent = 'Simpan'; }
});
$('#modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

async function del(type, id) {
  const v = findItem(type, id);
  const label = type === 'tugas' ? `tugas "${v?.judul}"` : type === 'akun' ? `akun ${v?.nama}` : type === 'matkul' ? `mata kuliah ${v?.nama}`
    : type === 'ubah' ? (v?.jenis === 'batal' ? 'tanda kelas batal' : 'kuliah pengganti') : type === 'pengumuman' ? 'pengumuman ini' : `${FORMS[type].label} ${v?.matkul}`;
  const ket = type === 'matkul' ? 'Mata kuliah akan dihapus dari daftar.' : type === 'ubah' && v?.jenis === 'batal' ? 'Kelas akan kembali berjalan normal di tanggal itu dan bot mengingatkan seperti biasa.' : type === 'pengumuman' && v?.status === 'terjadwal' ? 'Pengumuman batal dikirim.' : 'Data yang dihapus tidak bisa dikembalikan.';
  if (!(await askConfirm(`Hapus ${label}?`, ket))) return;
  try {
    const hasil = await api(`/api/${endpointOf(type)}/${id}`, { method: 'DELETE' });
    if ($('#modal').open) $('#modal').close();
    toast('Data dihapus.', 'success', hasil.sampah ? { label: 'Batalkan', fn: () => pulihkan(hasil.sampah) } : null);
    type === 'akun' ? loadAkun() : type === 'pengumuman' ? loadPengumuman() : refresh();
  } catch (err) { toast(err.message, 'error'); }
}

function openDay(ms) {
  const k = dayKey(ms); const dow = w(ms).dow;
  const kelas = kelasPada(ms);
  const tugas = S.data.tugas.filter((x) => dayKey(x.ms) === k);
  const ujian = S.data.ujian.filter((x) => dayKey(x.ms) === k);
  editing = { detail: true };
  $('#mEyebrow').textContent = 'Agenda harian';
  $('#mTitle').textContent = tgl(ms);
  const sec = (title, html) => `<div><div class="eyebrow" style="margin-bottom:8px">${title}</div><div class="rows">${html}</div></div>`;
  $('#mBody').innerHTML = (kelas.length || tugas.length || ujian.length)
    ? [kelas.length && sec('Kelas', kelas.map((x) => `<div class="row clickable mk-accent ${x.batal ? 'is-batal' : ''}" style="${mkVar(x.matkul)}" ${detailAttr(x)}><b style="font-size:12px;font-family:var(--font-mono)">${x.mulai}</b><div class="grow"><div class="title">${esc(x.matkul)}</div><div class="sub">${esc(x.ruang || '')}${x.alasan ? `<span>${esc(x.alasan)}</span>` : ''}</div></div>${x.batal ? '<span class="tag" data-tone="danger">Batal</span>' : x.pengganti ? '<span class="tag" data-tone="warning">Pengganti</span>' : ''}</div>`).join('')),
      tugas.length && sec('Tenggat tugas', tugas.map((t) => taskRow(t, true)).join('')),
      ujian.length && sec('Ujian', ujian.map((u) => `<div class="row"><span class="badge b-warn">${esc(u.jenis)}</span><div class="grow"><div class="title">${esc(u.matkul)}</div><div class="sub">${hm(u.ms)}${u.ruang ? ' · ' + esc(u.ruang) : ''}</div></div></div>`).join(''))].filter(Boolean).join('')
    : empty('coffee', 'Hari kosong', 'Tidak ada kelas, tenggat, atau ujian.');
  $('#mFoot').innerHTML = `${canEdit() && ms >= startOfDay(now()) ? `<div class="left day-add"><button type="button" class="btn btn-secondary btn-sm" data-add-tugas-on="${ymdOf(ms)}">${PLUS}Tugas</button><button type="button" class="btn btn-secondary btn-sm" data-add-ujian-on="${ymdOf(ms)}">${PLUS}Ujian</button><button type="button" class="btn btn-secondary btn-sm" data-add-on="${ymdOf(ms)}">${PLUS}Pengganti</button></div>` : ''}<button type="button" class="btn btn-secondary" data-close>Tutup</button>`;
  $('#modal').showModal();
}

// ---------- Event global ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-kumpul],[data-jmode],[data-cal-nav],[data-rw],[data-copy],[data-ics-reset],[data-batalkan],[data-add-on],[data-view],[data-add],[data-edit],[data-del],[data-detail],[data-toggle],[data-close],[data-filter],[data-day],[data-pick-day],[data-scope],[data-ptab],[data-send],[data-test-send],[data-backup-now],[data-backup-dl],[data-reload-status],[data-clear-q],[data-logout]');
  if (!el) return;
  const d = el.dataset; const id = Number(d.id);
  if ('kumpul' in d) {
    e.stopPropagation();
    const t = S.data.tugas.find((x) => x.id === Number(d.kumpul)); if (!t) return;
    el.disabled = true;
    try {
      await api(`/api/tugas/${t.id}/kumpul`, { method: 'POST', body: { kumpul: !t.kumpulSaya } });
      toast(t.kumpulSaya ? 'Tanda kumpul dibatalkan.' : 'Mantap! Tugas ditandai sudah kamu kumpulkan.');
      await refresh();
      if ($('#modal').open && editing?.type === 'tugas' && editing.detail) openDetail('tugas', t.id);
    } catch (err) { toast(err.message, 'error'); el.disabled = false; }
    return;
  }
  if ('jmode' in d) { S.jmode = d.jmode; try { localStorage.setItem('jmode', d.jmode); } catch {} return viewJadwal(); }
  if ('calNav' in d) { const st = Number(d.calNav); const tn = w(now()); if (!st) S.cal = { y: tn.y, m: tn.m }; else { const m = S.cal.m + st; S.cal = { y: S.cal.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }; } return viewKalender(); }
  if ('rw' in d) { S.rwFilter = d.rw; return viewRiwayat(); }
  if ('copy' in d) { const inp = $(d.copy); try { await navigator.clipboard.writeText(inp.value); toast('Link disalin.'); } catch { inp.select(); toast('Tekan Ctrl+C untuk menyalin.'); } return; }
  if ('icsReset' in d) {
    if (!(await askConfirm('Ganti link kalender?', 'Link lama berhenti bekerja. Semua anggota yang sudah berlangganan perlu menambahkan link baru.', 'Ganti link'))) return;
    try { S.icsPath = (await api('/api/kalender/reset', { method: 'POST' })).path; $('#icsBox').innerHTML = icsCard(); toast('Link kalender diganti.'); } catch (err) { toast(err.message, 'error'); }
    return;
  }
  if ('batalkan' in d) { const k = S.data.kelas.find((x) => x.id === Number(d.batalkan)); $('#modal').close(); return openForm('batal', null, { kelas_id: k.id, tanggal: nextDateOf(k) }); }
  if ('addOn' in d) { $('#modal').close(); return openForm('pengganti', null, { tanggal: d.addOn }); }
  if ('toggle' in d) {
    e.stopPropagation(); if (!canEdit()) return;
    const t = S.data.tugas.find((x) => x.id === Number(d.toggle));
    try { await api(`/api/tugas/${t.id}/selesai`, { method: 'POST', body: { selesai: !t.selesai } }); toast(t.selesai ? 'Tugas berhasil dipulihkan.' : 'Tugas ditandai selesai.'); refresh(); } catch (err) { toast(err.message, 'error'); }
    return;
  }
  if ('close' in d) { el.closest('dialog')?.close(); return; }
  if ('view' in d) return go(d.view);
  if ('add' in d) return openForm(d.add);
  if ('edit' in d) { e.stopPropagation(); return openForm(d.edit, id); }
  if ('del' in d) { e.stopPropagation(); return del(d.del, id); }
  if ('detail' in d) return openDetail(d.detail, id);
  if ('filter' in d) { S.filter = d.filter; return viewTugas(); }
  if ('clearQ' in d) { S.q = ''; return viewTugas(); }
  if ('day' in d) return openDay(Number(d.day));
  if ('pickDay' in d) { S.dashDay = Number(d.pickDay); S.dashScope = 'day'; return viewDashboard(); }
  if ('scope' in d) { S.dashScope = d.scope; S.dashDay = null; return viewDashboard(); }
  if ('ptab' in d) { previewTab = d.ptab; return viewPengingat(); }
  if ('backupNow' in d) { el.disabled = true; try { S.backup = await api('/api/backup', { method: 'POST' }); toast('Backup database dibuat.'); viewStatus(); } catch (err) { toast(err.message, 'error'); el.disabled = false; } return; }
  if ('backupDl' in d) { try { await downloadBackup(d.backupDl); } catch (err) { toast(err.message, 'error'); } return; }
  if ('reloadStatus' in d) { S.status = null; viewStatus(); return loadStatus(); }
  if ('logout' in d) return logout();
  if ('send' in d || 'testSend' in d) {
    el.disabled = true; const old = el.innerHTML; el.innerHTML = '<i class="ph ph-spinner"></i>Mengirim…';
    try { await api('send' in d ? `/api/pengingat/kirim/${d.send}` : '/api/status/tes', { method: 'POST' }); toast('Pesan terkirim ke grup.'); if ('testSend' in d) loadStatus(); }
    catch (err) { toast(err.message, 'error'); }
    el.disabled = false; el.innerHTML = old;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.class-card, .session, .reminder, .cal-cell, .tblock')) e.target.click();
  if (e.key === 'Escape') $('#shell').classList.remove('nav-open');
});
$('#menuBtn').onclick = () => $('#shell').classList.add('nav-open');
$('#scrim').onclick = () => $('#shell').classList.remove('nav-open');
$('#bellBtn').onclick = () => { S.filter = 'aktif'; go('tugas'); };
$('#profileBtn').onclick = () => go('profil');
$('#logoutBtn').onclick = () => logout();
$('#globalSearch').addEventListener('input', (e) => {
  S.q = e.target.value; S.filter = 'semua';
  if (S.view !== 'tugas') { go('tugas'); e.target.focus(); } else viewTugas();
});
window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  const sama = v === S.view || (S.view === 'matkul-detail' && v === `matkul/${S.mkId}`);
  if (v && !sama) go(v);
});

// ---------- Sinkronisasi ----------
async function refresh() {
  try {
    const d = await api('/api/data');
    S.skew = d.serverTime - Date.now();
    S.data = d;
    render();
  } catch (err) { if (err.message) console.warn(err.message); }
}
function setUserChip() {
  $('#avatar').innerHTML = S.user.foto ? `<img src="/api/akun/${S.user.id}/foto?t=${S.fotoVer || 0}" alt="" data-auth-img>` : esc((S.user.nama[0] || '?').toUpperCase());
  if (typeof muatGambarAuth === 'function') muatGambarAuth($('#avatar'));
  $('#userName').textContent = S.user.nama;
  $('#userRole').textContent = ROLE_LABEL[S.user.role];
}
async function boot() {
  if (!token) return logout(true);
  try {
    S.user = (await api('/api/auth/me')).user;
    setUserChip();
    const d = await api('/api/data'); S.skew = d.serverTime - Date.now(); S.data = d;
    $('#boot').remove();
    $('#shell').removeAttribute('aria-busy');
    go(location.hash.slice(1) || 'dashboard');
  } catch { /* api() sudah mengarahkan ke login kalau sesi habis */ }
  setInterval(() => { if (!document.hidden && !$('#modal').open) refresh(); }, 30000);
  window.addEventListener('focus', () => { if (!$('#modal').open) refresh(); });
}
boot();
// Bisa di-install di HP (PWA). Gagal daftar tidak mengganggu aplikasi.
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
