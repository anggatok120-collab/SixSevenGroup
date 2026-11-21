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

const S = { dashScope: 'today', dashDay: null, user: null, view: 'dashboard', data: { kelas: [], tugas: [], ujian: [], bot: {} }, skew: 0, filter: 'aktif', q: '', qUjian: '', pengingat: null, status: null, akun: null };
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
const waFormat = (t) => esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>');
const badge = ([cls, txt]) => `<span class="badge ${cls}">${esc(txt)}</span>`;
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
function toast(msg, kind = 'success') {
  const t = $('#toast');
  t.classList.toggle('error', kind === 'error');
  t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  $('i', t).className = kind === 'error' ? 'ph-fill ph-warning-circle' : 'ph-fill ph-check-circle';
  $('#toastText').textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}
$('#toastClose').onclick = () => $('#toast').classList.remove('show');

// ---------- Navigasi ----------
const NAV = [
  { title: 'Ringkasan', items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'squares-four' },
  ] },
  { title: 'Jadwal', items: [
    { id: 'jadwal', label: 'Jadwal Kuliah', icon: 'book-open' },
    { id: 'ujian', label: 'Jadwal Ujian', icon: 'clipboard-text' },
  ] },
  { title: 'Pekerjaan', items: [
    { id: 'tugas', label: 'Tugas', icon: 'list-checks', badge: () => S.data.tugas.filter((t) => !t.selesai).length },
    { id: 'pengingat', label: 'Pengingat', icon: 'bell', roles: ['admin'] },
  ] },
  { title: 'Akun', items: [
    { id: 'akun', label: 'Management Akun', icon: 'users', roles: ['admin'] },
    { id: 'status', label: 'Status Bot', icon: 'robot', roles: ['admin'] },
    { id: 'profil', label: 'Profil', icon: 'user' },
  ] },
];
const META = {
  dashboard: ['Dashboard', 'Ringkasan kelas, tugas, dan ujian kamu'],
  jadwal: ['Jadwal Kuliah', 'Jadwal rutin mingguan yang dipakai bot untuk mengingatkan grup'],
  tugas: ['Tugas', 'Daftar tugas beserta tenggatnya'],
  ujian: ['Ujian', 'UTS, UAS, kuis, dan praktikum'],
  pengingat: ['Pusat Pengingat', 'Atur kapan bot WhatsApp mengirim pengingat ke grup'],
  status: ['Status Bot', 'Kesehatan bot WhatsApp dan riwayat pengiriman'],
  akun: ['Kelola Akun', 'Siapa saja yang bisa masuk dan apa perannya'],
  profil: ['Profil Saya', 'Nama dan password akun kamu'],
};
const allowed = (it) => !it.roles || it.roles.includes(S.user.role);

function renderNav() {
  $('#nav').innerHTML = NAV.map((g) => {
    const items = g.items.filter(allowed);
    if (!items.length) return '';
    return `<div class="nav-group"><div class="nav-title">${g.title}</div>${items.map((it) => {
      const on = S.view === it.id; const b = it.badge ? it.badge() : 0;
      return `<button data-view="${it.id}" class="${on ? 'active' : ''}" ${on ? 'aria-current="page"' : ''}><i class="ph ph-${it.icon}"></i><span>${it.label}</span>${b ? `<em class="nav-badge" aria-label="${b} tugas aktif">${b}</em>` : ''}</button>`;
    }).join('')}</div>`;
  }).join('');
}
function go(view) {
  const item = NAV.flatMap((g) => g.items).find((i) => i.id === view);
  if (!item || !allowed(item)) view = 'dashboard';
  S.view = view;
  if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  $('#shell').classList.remove('nav-open');
  render();
  window.scrollTo(0, 0);
  $('#pageTitle').focus({ preventScroll: true });
  if (view === 'pengingat') loadPengingat();
  if (view === 'status') loadStatus();
  if (view === 'akun') loadAkun();
}

// Ikon dekoratif disembunyikan dari pembaca layar; label tetap di teks/aria-label tombol.
function a11yPass() {
  queueMicrotask(() => $$('i[class*="ph-"]:not([aria-hidden])').forEach((i) => i.setAttribute('aria-hidden', 'true')));
}

// ---------- Render utama ----------
function render() {
  renderNav();
  const [t, sub] = META[S.view];
  const tn = w(now());
  $('#pageTitle').textContent = t; $('#pageTitle').title = sub; $('#pageSub').textContent = `${HARI[tn.dow]}, ${tn.d} ${BULAN_PANJANG[tn.m]} ${tn.y}`;
  document.title = `${t} · Six Seven 67`;
  const aktif = S.data.tugas.filter((x) => !x.selesai).length;
  $('#bellCount').textContent = aktif ? `${aktif} aktif` : 'Beres';
  $('#bellBtn').setAttribute('aria-label', aktif ? `${aktif} tugas aktif, buka daftar tugas` : 'Tidak ada tugas aktif, buka daftar tugas');
  const b = S.data.bot || {};
  $('#botDot').classList.toggle('on', !!(b.wa && b.grup));
  $('#botText').textContent = b.wa ? (b.grup ? 'Bot WA aktif' : 'Bot aktif, grup belum diatur') : 'Bot WA offline';
  a11yPass();
  ({ dashboard: viewDashboard, jadwal: viewJadwal, tugas: viewTugas, ujian: viewUjian, pengingat: viewPengingat, status: viewStatus, akun: viewAkun, profil: viewProfil })[S.view]();
}

const empty = (icon, title, hint, action = '') => `<div class="empty"><i class="ph-duotone ph-${icon}"></i><b>${title}</b><p>${hint}</p>${action}</div>`;
const addBtn = (type, label) => canEdit() ? `<button class="btn btn-primary" data-add="${type}"><i class="ph ph-plus"></i>${label}</button>` : '';

// ---------- Dashboard ----------
function nextClass() {
  const n = now();
  for (let i = 0; i < 8; i++) {
    const base = n + i * DAY; const dow = w(base).dow;
    const list = S.data.kelas.filter((k) => k.hari === dow).sort((a, b) => a.mulai.localeCompare(b.mulai));
    for (const k of list) {
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
    <div class="grow"><div class="title">${esc(t.judul)}</div><div class="sub"><span class="chip">${esc(t.matkul)}</span>${compact ? '' : `<span>${tgl(t.ms)} · ${hm(t.ms)}</span>`}${t.prioritas === 'tinggi' ? '<span class="pri-high"><i class="ph-fill ph-fire"></i>Tinggi</span>' : ''}</div></div>
    ${badge(dueBadge(t.ms, done))}
  </div>`;
}
function sessionsOn(dayMs) {
  const n = now(); const dow = w(dayMs).dow;
  return S.data.kelas.filter((k) => k.hari === dow).sort((a, b) => a.mulai.localeCompare(b.mulai)).map((k) => {
    const start = atToday(dayMs, k.mulai); const end = k.selesai ? atToday(dayMs, k.selesai) : start + 100 * 6e4;
    return { k, start, end, dayMs, live: start <= n && n < end, past: end <= n };
  });
}
function sessionRow(x, showDay) {
  const k = x.k; const praktikum = /praktikum|lab/i.test(k.matkul + ' ' + (k.ruang || ''));
  const tag = x.live ? '<span class="tag" data-tone="live"><i class="ph ph-broadcast"></i>Berlangsung</span>' : x.past ? '<span class="tag" data-tone="done">Selesai</span>' : `<span class="tag">${praktikum ? 'Praktikum' : 'Kuliah'}</span>`;
  return `<div class="session" data-live="${x.live}" data-past="${x.past}" data-detail="kelas" data-id="${k.id}" role="button" tabindex="0">
    <span class="session-time"><strong>${k.mulai.replace(':', '.')}</strong><span>${(k.selesai || '').replace(':', '.')}</span></span>
    <span class="session-main"><b>${esc(k.matkul)}</b><span class="session-meta">${showDay ? `<span>${HARI[w(x.dayMs).dow]}</span>` : ''}${k.ruang ? `<span>${esc(k.ruang)}</span>` : ''}${k.dosen ? `<span>${esc(k.dosen)}</span>` : ''}</span></span>
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
    <div class="task-main" data-detail="tugas" data-id="${t.id}"><span class="task-title">${esc(t.judul)}</span><span class="task-meta"><span>${esc(t.matkul)}</span><span>${relDay(t.ms)}</span>${t.prioritas === 'tinggi' ? '<span class="hi">Prioritas tinggi</span>' : ''}</span></div>
    <span class="tag" data-tone="${tone}">${label}</span></div>`;
}
function viewDashboard() {
  const n = now(); const sod = startOfDay(n); const today = w(n).dow;
  const aktif = S.data.tugas.filter((t) => !t.selesai).sort((a, b) => a.ms - b.ms);
  const total = S.data.tugas.length; const selesai = total - aktif.length;
  const dueToday = aktif.filter((t) => startOfDay(t.ms) <= sod).length;
  const todaySessions = sessionsOn(sod);
  const nc = nextClass();
  const ujianNext = S.data.ujian.filter((u) => u.ms > n).sort((a, b) => a.ms - b.ms);
  const u0 = ujianNext[0]; const uDays = u0 ? Math.max(0, Math.round((startOfDay(u0.ms) - sod) / DAY)) : null;
  const jam = w(n).h; const salam = jam < 11 ? 'Selamat pagi' : jam < 15 ? 'Selamat siang' : jam < 18 ? 'Selamat sore' : 'Selamat malam';
  const tn = w(n); const tanggal = `${HARI[tn.dow]}, ${tn.d} ${BULAN_PANJANG[tn.m]} ${tn.y}`;
  const b = S.data.bot || {};

  // jadwal: hari ini / pekan ini / hari terpilih
  const offset = (today + 6) % 7;
  const weekDays = Array.from({ length: 7 }, (_, i) => sod + (i - offset) * DAY);
  let list, hint, title = 'Jadwal hari ini';
  if (S.dashScope === 'week') {
    list = weekDays.filter((d) => d > sod).flatMap((d) => sessionsOn(d)); title = 'Jadwal pekan ini';
    hint = list.length ? `${list.length} sesi sampai ${HARI[w(weekDays[6]).dow]}` : 'Tidak ada kelas lagi pekan ini';
  } else if (S.dashScope === 'day' && S.dashDay && S.dashDay !== sod) {
    list = sessionsOn(S.dashDay); title = `Jadwal ${HARI[w(S.dashDay).dow]}`; hint = `${list.length} sesi · ${w(S.dashDay).d} ${BULAN_PANJANG[w(S.dashDay).m]}`;
  } else {
    list = todaySessions; hint = list.length ? `${list.length} sesi · kuliah dan praktikum` : 'Tidak ada kelas hari ini';
  }
  const selDay = S.dashScope === 'day' && S.dashDay ? S.dashDay : S.dashScope === 'today' ? sod : null;
  const strip = weekDays.map((d) => {
    const t = w(d); const cnt = S.data.kelas.filter((k) => k.hari === t.dow).length;
    const hasU = S.data.ujian.some((u) => dayKey(u.ms) === dayKey(d)); const hasT = aktif.some((x) => dayKey(x.ms) === dayKey(d));
    const label = `${HARI[t.dow]} ${t.d} ${BULAN[t.m]}, ${cnt} kelas${hasT ? ', ada tenggat tugas' : ''}${hasU ? ', ada ujian' : ''}`;
    return `<button class="wday" data-pick-day="${d}" data-active="${d === selDay}" data-today="${d === sod}" aria-pressed="${d === selDay}" aria-label="${label}"><span>${HARI[t.dow].slice(0, 3)}</span><strong>${t.d}</strong><i class="wbar" data-has="${cnt > 0}" data-alert="${hasU || hasT}"></i></button>`;
  }).join('');

  const reminders = [
    ...ujianNext.slice(0, 3).map((u) => { const dd = Math.round((startOfDay(u.ms) - sod) / DAY); return { tone: dd <= 3 ? 'warning' : '', title: `${u.jenis} ${u.matkul}`, detail: u.ruang ? `Ruang ${u.ruang}` : 'Ruang belum diisi', time: relDay(u.ms), id: u.id, type: 'ujian' }; }),
  ];
  const pct = total ? Math.round(selesai / total * 100) : 0;

  $('#content').innerHTML = `
  <section class="greet">
    <div><h2>${salam}, ${esc(S.user.nama.split(' ')[0])}</h2>
      <p>${tanggal} · ${todaySessions.length ? `${todaySessions.length} kelas` : 'tidak ada kelas'} dan ${aktif.length} tugas menunggu</p></div>
    ${canEdit() ? '<button class="btn btn-primary" data-add="tugas"><i class="ph ph-plus"></i>Tugas baru</button>' : ''}
  </section>
  <section class="metrics">
    <article class="metric"><span class="metric-label"><i class="ph ph-book-open"></i>Kelas hari ini</span><strong>${todaySessions.length} sesi</strong><small>${nc ? `Berikutnya ${nc.k.mulai.replace(':', '.')}${nc.i ? ` (${HARI[w(nc.start).dow]})` : ''} · ${esc(nc.k.ruang || nc.k.matkul)}` : 'Belum ada jadwal'}</small></article>
    <article class="metric"><span class="metric-label"><i class="ph ph-list-checks"></i>Tugas aktif</span><strong>${aktif.length} tugas</strong><small data-tone="${dueToday ? 'warning' : ''}">${dueToday ? `${dueToday} jatuh tempo hari ini` : aktif[0] ? `Terdekat ${relDay(aktif[0].ms)}` : 'Semua beres'}</small></article>
    <article class="metric"><span class="metric-label"><i class="ph ph-clipboard-text"></i>Ujian terdekat</span><strong>${u0 ? (uDays === 0 ? 'Hari ini' : `${uDays} hari`) : '–'}</strong><small>${u0 ? `${esc(u0.jenis)} ${esc(u0.matkul)} · ${w(u0.ms).d} ${BULAN[w(u0.ms).m]}` : 'Belum ada ujian'}</small></article>
    <article class="metric"><span class="metric-label"><i class="ph ph-whatsapp-logo"></i>Bot WhatsApp</span><strong>${b.wa ? 'Aktif' : 'Offline'}</strong><small data-tone="${b.wa && b.grup ? '' : 'warning'}">${b.wa ? (b.grup ? 'Mengirim ke grup kelas' : 'Grup belum diatur') : 'Pengingat tertunda'}</small></article>
  </section>
  <section class="dash-grid">
    <div class="panel">
      <div class="panel-head"><div><h2>${title}</h2><span>${hint}</span></div>
        <div class="segment" role="group" aria-label="Rentang jadwal"><button data-scope="today" aria-pressed="${S.dashScope !== 'week'}">Hari ini</button><button data-scope="week" aria-pressed="${S.dashScope === 'week'}">Pekan ini</button></div></div>
      <div class="sessions">${list.length ? list.map((x) => sessionRow(x, S.dashScope === 'week')).join('') : `<p class="soft">${S.data.kelas.length ? 'Tidak ada kelas di rentang ini. Pilih hari lain di bawah.' : 'Jadwal kuliah belum diisi.'}</p>${!S.data.kelas.length && canEdit() ? addBtn('kelas', 'Tambah jadwal') : ''}`}</div>
      <div class="week" role="group" aria-label="Agenda pekan">${strip}</div>
    </div>
    <div class="panel">
      <div class="panel-head"><div><h2>Tugas mendekat</h2><span>${aktif.length} dari ${total} belum selesai</span></div></div>
      <div class="tasks">${aktif.length ? aktif.slice(0, 5).map(taskItem).join('') : '<p class="soft">Semua tugas sudah selesai. Waktu yang tersisa bisa dipakai untuk mereview materi.</p>'}</div>
      <button class="ghost-btn" data-view="tugas">Kelola semua tugas<i class="ph ph-arrow-right"></i></button>
    </div>
  </section>
  <section class="dash-grid">
    <div class="panel">
      <div class="panel-head"><div><h2>Pengingat</h2><span>${reminders.length ? `${reminders.length} ujian mendatang · bot mengingatkan grup otomatis` : 'Bot mengingatkan grup otomatis'}</span></div></div>
      <div class="reminders">${reminders.length ? reminders.map((r) => `<div class="reminder" data-tone="${r.tone}" data-detail="${r.type}" data-id="${r.id}" role="button" tabindex="0"><i class="rdot" aria-hidden="true"></i><div><span><b>${esc(r.title)}</b><small>${esc(r.detail)}</small></span><time>${r.time}</time></div></div>`).join('') : '<p class="soft">Belum ada ujian mendatang.</p>'}</div>
    </div>
    <div class="panel">
      <div class="panel-head"><div><h2>Akses cepat</h2></div></div>
      <div class="quick">
        <button class="quicklink" data-view="jadwal"><i class="ph ph-book-open"></i><span>Jadwal kuliah pekan ini</span><i class="ph ph-caret-right"></i></button>
        <button class="quicklink" data-view="ujian"><i class="ph ph-clipboard-text"></i><span>Jadwal ujian</span><i class="ph ph-caret-right"></i></button>
        <button class="quicklink" data-view="tugas"><i class="ph ph-list-checks"></i><span>Semua tugas aktif</span><i class="ph ph-caret-right"></i></button>
      </div>
      <div class="progress"><div><span>Progres tugas</span><strong>${pct}%</strong></div><div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progres tugas"><i style="width:${pct}%"></i></div></div>
    </div>
  </section>`;
}

// ---------- Jadwal ----------
function viewJadwal() {
  const today = w(now()).dow;
  const ada = (h) => S.data.kelas.some((k) => k.hari === h);
  const hari = [1, 2, 3, 4, 5, ...(ada(6) ? [6] : []), ...(ada(0) ? [0] : [])];
  const cols = hari.map((h) => {
    const list = S.data.kelas.filter((k) => k.hari === h).sort((a, b) => a.mulai.localeCompare(b.mulai));
    return `<div class="col ${h === today ? 'today' : ''}"><div class="col-head"><b>${HARI[h]}</b><small>${list.length} kelas</small></div>
      ${list.length ? list.map((k) => `<div class="class-card" data-detail="kelas" data-id="${k.id}" role="button" tabindex="0">
        <span class="time">${k.mulai}${k.selesai ? ' – ' + k.selesai : ''}</span><span class="name">${esc(k.matkul)}</span>
        <div class="meta">${k.ruang ? `<span><i class="ph ph-map-pin"></i>${esc(k.ruang)}</span>` : ''}${k.dosen ? `<span><i class="ph ph-chalkboard-teacher"></i>${esc(k.dosen)}</span>` : ''}</div>
        ${canEdit() ? `<div class="actions"><button class="tiny-btn" data-edit="kelas" data-id="${k.id}" aria-label="Ubah"><i class="ph ph-pencil-simple"></i></button><button class="tiny-btn danger" data-del="kelas" data-id="${k.id}" aria-label="Hapus"><i class="ph ph-trash"></i></button></div>` : ''}
      </div>`).join('') : '<div class="none">Tidak ada kelas</div>'}</div>`;
  }).join('');
  $('#content').innerHTML = `
    <div class="toolbar"><div class="toolbar-left"><span class="muted">${S.data.kelas.length} kelas per minggu. Bot mengingatkan grup sebelum tiap kelas dimulai.</span></div>${addBtn('kelas', 'Tambah jadwal')}</div>
    ${S.data.kelas.length ? `<div class="board" style="--cols:${hari.length}">${cols}</div>` : `<div class="card">${empty('calendar-dots', 'Belum ada jadwal', canEdit() ? 'Tambahkan jadwal kuliah mingguan untuk mulai.' : 'Admin belum mengisi jadwal kuliah.', addBtn('kelas', 'Tambah sekarang'))}</div>`}`;
}

// ---------- Tugas ----------
function viewTugas() {
  const all = S.data.tugas;
  const cnt = { aktif: all.filter((t) => !t.selesai).length, selesai: all.filter((t) => t.selesai).length, semua: all.length };
  const q = S.q.toLowerCase();
  const list = all.filter((t) => (S.filter === 'semua' || (S.filter === 'aktif' ? !t.selesai : t.selesai)))
    .filter((t) => !q || `${t.judul} ${t.matkul} ${t.catatan || ''}`.toLowerCase().includes(q))
    .sort((a, b) => (S.filter === 'selesai' ? b.ms - a.ms : a.ms - b.ms));
  const seg = ['aktif', 'selesai', 'semua'].map((f) => `<button class="${S.filter === f ? 'on' : ''}" data-filter="${f}" aria-pressed="${S.filter === f}">${f[0].toUpperCase() + f.slice(1)}<em>${cnt[f]}</em></button>`).join('');
  const rows = list.map((t) => {
    const pri = t.prioritas === 'tinggi' ? '<span class="pri-high"><i class="ph-fill ph-fire"></i>Tinggi</span>' : '<span class="pri-normal">Normal</span>';
    return `<div class="trow ${t.selesai ? 'done' : ''}">
      <div><button class="check ${t.selesai ? 'on' : ''}" data-toggle="${t.id}" ${canEdit() ? '' : 'disabled'} aria-pressed="${!!t.selesai}" aria-label="${t.selesai ? 'Tandai belum selesai' : 'Tandai selesai'}: ${esc(t.judul)}"><i class="ph-bold ph-check"></i></button></div>
      <div style="min-width:0;cursor:pointer" data-detail="tugas" data-id="${t.id}"><div class="title">${esc(t.judul)}</div>${t.catatan ? `<div class="note">${esc(t.catatan)}</div>` : ''}
        <div class="m-meta"><span class="chip">${esc(t.matkul)}</span>${badge(dueBadge(t.ms, t.selesai))}<span>${tgl(t.ms)} · ${hm(t.ms)}</span>${t.prioritas === 'tinggi' ? pri : ''}</div></div>
      <div class="d-only"><span class="chip">${esc(t.matkul)}</span></div>
      <div class="d-only"><div>${tgl(t.ms)} · ${hm(t.ms)}</div>${badge(dueBadge(t.ms, t.selesai))}</div>
      <div class="d-only">${pri}</div>
      <div class="row-actions">${canEdit() ? `<button class="tiny-btn" data-edit="tugas" data-id="${t.id}" aria-label="Ubah"><i class="ph ph-pencil-simple"></i></button><button class="tiny-btn danger" data-del="tugas" data-id="${t.id}" aria-label="Hapus"><i class="ph ph-trash"></i></button>` : ''}</div>
    </div>`;
  }).join('');
  const kosong = q ? empty('magnifying-glass', 'Tidak ada hasil', 'Coba kata kunci lain.', '<button class="btn btn-secondary" data-clear-q>Bersihkan pencarian</button>')
    : S.filter === 'selesai' ? empty('check-circle', 'Belum ada tugas selesai', 'Tugas yang dicentang akan pindah ke sini.')
      : empty('confetti', 'Tidak ada tugas aktif', 'Semua beres. Tambahkan tugas baru kalau ada.', addBtn('tugas', 'Tambah sekarang'));
  $('#content').innerHTML = `
    <div class="toolbar"><div class="toolbar-left"><label class="search"><i class="ph ph-magnifying-glass"></i><input id="q" placeholder="Cari tugas atau mata kuliah…" value="${esc(S.q)}"></label><div class="segmented">${seg}</div></div>${addBtn('tugas', 'Tambah tugas')}</div>
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
    return `<div class="trow ${lewat ? 'done' : ''}">
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
    <div class="toolbar"><div class="toolbar-left"><span class="muted">Bot mengingatkan grup H-7, H-1, dan pagi hari-H ujian.</span></div>${addBtn('ujian', 'Tambah ujian')}</div>
    <div class="card">${list.length ? `<div class="table ujian"><div class="thead"><span>Jenis</span><span>Mata kuliah</span><span>Waktu</span><span>Ruang</span><span>Status</span><span style="text-align:right">Aksi</span></div>${rows}</div>`
      : empty('exam', 'Belum ada ujian', canEdit() ? 'Tambahkan jadwal UTS, UAS, atau kuis.' : 'Belum ada ujian terjadwal.', addBtn('ujian', 'Tambah sekarang'))}</div>`;
}

// ---------- Pengingat (admin) ----------
const PLANS = [
  { id: 'pagi', icon: 'sun-horizon', title: 'Ringkasan pagi', desc: 'Kelas hari ini, tugas ≤ 3 hari, dan ujian minggu ini', preview: 'pagi' },
  { id: 'besok', icon: 'moon-stars', title: 'Persiapan besok (H-1)', desc: 'Jadwal besok dan tugas yang tenggatnya sampai besok', preview: 'besok' },
  { id: 'kelas', icon: 'chalkboard-teacher', title: 'Kelas akan dimulai', desc: 'Dikirim beberapa menit sebelum tiap kelas' },
  { id: 'tugas', icon: 'list-checks', title: 'Tenggat tugas', desc: 'Dikirim untuk tiap tugas aktif menjelang tenggat', preview: 'tugas' },
  { id: 'ujian', icon: 'exam', title: 'Pengingat ujian', desc: 'Menjelang ujian dan pagi hari-H', preview: 'ujian' },
];
const LEADS_TUGAS = [[4320, 'H-3'], [1440, 'H-1'], [360, '6 jam'], [180, '3 jam'], [60, '1 jam']];
const LEADS_UJIAN = [[10080, 'H-7'], [4320, 'H-3'], [1440, 'H-1']];
let previewTab = 'pagi';
async function loadPengingat() {
  try { S.pengingat = await api('/api/pengingat'); if (S.view === 'pengingat') viewPengingat(); } catch (e) { toast(e.message, 'error'); }
}
function viewPengingat() {
  if (!S.pengingat) { $('#content').innerHTML = '<div class="card muted">Memuat pengaturan…</div>'; return; }
  const p = S.pengingat.pengaturan;
  const leadChecks = (mode, opts) => `<div class="checks">${opts.map(([v, l]) => `<label><input type="checkbox" name="${mode}.menit" value="${v}" ${p[mode].menit.includes(v) ? 'checked' : ''}>${l}</label>`).join('')}</div>`;
  const body = {
    pagi: `<label class="inline-field">Jam <input type="time" name="pagi.jam" value="${p.pagi.jam}"> WIB</label>`,
    besok: `<label class="inline-field">Jam <input type="time" name="besok.jam" value="${p.besok.jam}"> WIB</label>`,
    kelas: `<label class="inline-field"><input type="number" min="5" max="180" step="5" name="kelas.menit" value="${p.kelas.menit}"> menit sebelum mulai</label>`,
    tugas: leadChecks('tugas', LEADS_TUGAS),
    ujian: `${leadChecks('ujian', LEADS_UJIAN)}<label class="inline-field">Pagi hari-H <input type="time" name="ujian.pagiJam" value="${p.ujian.pagiJam || ''}"></label>`,
  };
  const plans = PLANS.map((pl) => `<div class="plan">
    <div class="plan-head"><i class="ph-duotone ph-${pl.icon} ic"></i><div class="grow"><b>${pl.title}</b><small>${pl.desc}</small></div>
      <label class="switch" title="Aktif/nonaktif"><input type="checkbox" name="${pl.id}.on" ${p[pl.id].on ? 'checked' : ''}><span></span></label></div>
    <div class="plan-body">${body[pl.id]}${pl.preview ? `<button type="button" class="btn btn-secondary btn-sm" data-send="${pl.preview}"><i class="ph ph-paper-plane-tilt"></i>Kirim sekarang</button>` : ''}</div>
  </div>`).join('');
  const tabs = [['pagi', 'Hari ini'], ['besok', 'Besok'], ['tugas', 'Tugas'], ['ujian', 'Ujian']];
  const n = now();
  $('#content').innerHTML = `<div class="split">
    <form class="card" id="pForm"><div class="card-head"><h2><i class="ph-fill ph-whatsapp-logo"></i>Jadwal pengingat otomatis</h2></div>
      <div class="rows" style="gap:10px">${plans}</div>
      <div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn btn-primary" id="pSave"><i class="ph ph-floppy-disk"></i>Simpan &amp; aktifkan</button></div>
    </form>
    <div class="stack">
      <div class="card"><div class="card-head"><h2><i class="ph ph-eye"></i>Pratinjau pesan</h2></div>
        <div class="segmented" style="margin-bottom:12px">${tabs.map(([k, l]) => `<button class="${previewTab === k ? 'on' : ''}" data-ptab="${k}">${l}</button>`).join('')}</div>
        <div class="phone"><div class="phone-head"><span class="avatar"><i class="ph-fill ph-users-three"></i></span><div><b>Grup kelas</b><small>Bot Pengingat Kuliah</small></div></div>
          <div class="chat"><span class="date-chip">${tgl(n)}</span><div class="bubble"><pre>${waFormat(S.pengingat.preview[previewTab])}</pre><small>${hm(n)}</small></div></div></div>
      </div>
      <div class="card muted" style="font-size:12.5px"><i class="ph ph-info"></i> Pengingat pagi dan H-1 dilewati kalau tidak ada kelas, tugas, atau ujian. Semua waktu dalam WIB.</div>
    </div></div>`;
  $('#pForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target); const out = {};
    for (const pl of PLANS) out[pl.id] = { on: fd.has(`${pl.id}.on`) };
    out.pagi.jam = fd.get('pagi.jam'); out.besok.jam = fd.get('besok.jam'); out.kelas.menit = Number(fd.get('kelas.menit'));
    out.tugas.menit = fd.getAll('tugas.menit').map(Number); out.ujian.menit = fd.getAll('ujian.menit').map(Number); out.ujian.pagiJam = fd.get('ujian.pagiJam');
    const btn = $('#pSave'); btn.disabled = true; btn.lastChild.textContent = 'Menyimpan…';
    try { const r = await api('/api/pengingat', { method: 'PUT', body: out }); S.pengingat.pengaturan = r.pengaturan; toast('Pengaturan pengingat disimpan.'); }
    catch (err) { toast(err.message, 'error'); }
    btn.disabled = false; btn.lastChild.textContent = 'Simpan & aktifkan';
  };
}

// ---------- Status bot (admin) ----------
async function loadStatus() {
  try { S.status = await api('/api/status'); if (S.view === 'status') viewStatus(); } catch (e) { toast(e.message, 'error'); }
}
const LOG_MODE = { pagi: 'Ringkasan pagi', besok: 'Persiapan besok', kelas: 'Kelas dimulai', tugas: 'Tenggat tugas', ujian: 'Ujian', tes: 'Pesan percobaan' };
function viewStatus() {
  const s = S.status;
  if (!s) { $('#content').innerHTML = '<div class="card muted">Memeriksa bot…</div>'; return; }
  const tile = (ok, icon, title, sub) => `<div class="tile ${ok ? 'ok' : 'warn'}"><i class="ph-fill ph-${ok ? 'check-circle' : 'warning-circle'}"></i><b>${title}</b><small>${sub}</small></div>`;
  const numTile = (icon, label, val) => `<div class="tile num-tile"><small><i class="ph ph-${icon}"></i> ${label}</small><strong>${val}</strong></div>`;
  $('#content').innerHTML = `
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
    </div>`;
}

// ---------- Akun (admin) ----------
async function loadAkun() {
  try { S.akun = (await api('/api/akun')).akun; if (S.view === 'akun') viewAkun(); } catch (e) { toast(e.message, 'error'); }
}
function viewAkun() {
  if (!S.akun) { $('#content').innerHTML = '<div class="card muted">Memuat akun…</div>'; return; }
  const roleBadge = (r) => badge([r === 'admin' ? 'b-urgent' : r === 'editor' ? 'b-info' : 'b-normal', ROLE_LABEL[r]]);
  $('#content').innerHTML = `
    <div class="toolbar"><div class="toolbar-left"><span class="muted"><b>Admin</b> mengatur semuanya · <b>Editor</b> mengubah jadwal, tugas, ujian · <b>Anggota</b> hanya melihat.</span></div><button class="btn btn-primary" data-add="akun"><i class="ph ph-user-plus"></i>Tambah akun</button></div>
    <div class="card"><div class="rows">${S.akun.map((a) => `<div class="row"><span class="avatar">${esc(a.nama[0] || '?').toUpperCase()}</span><div class="grow"><div class="title">${esc(a.nama)}${a.id === S.user.id ? ' <span class="muted">(kamu)</span>' : ''}</div><div class="sub">@${esc(a.username)}</div></div>${roleBadge(a.role)}
      <button class="tiny-btn" data-edit="akun" data-id="${a.id}" aria-label="Ubah"><i class="ph ph-pencil-simple"></i></button>${a.id !== S.user.id ? `<button class="tiny-btn danger" data-del="akun" data-id="${a.id}" aria-label="Hapus"><i class="ph ph-trash"></i></button>` : '<span style="width:30px"></span>'}</div>`).join('')}</div></div>`;
}

// ---------- Profil ----------
function viewProfil() {
  $('#content').innerHTML = `<form class="card" id="profForm" style="max-width:560px">
    <div class="card-head"><h2><i class="ph ph-user-circle"></i>Akun kamu</h2>${badge(['b-info', ROLE_LABEL[S.user.role]])}</div>
    <div class="rows" style="gap:14px">
      <label class="field"><span>Username</span><input value="${esc(S.user.username)}" disabled></label>
      <label class="field"><span>Nama</span><input name="nama" value="${esc(S.user.nama)}" required></label>
      <div class="grid2"><label class="field"><span>Password lama</span><input type="password" name="passwordLama" autocomplete="current-password"></label>
      <label class="field"><span>Password baru</span><input type="password" name="passwordBaru" minlength="8" autocomplete="new-password" placeholder="Kosongkan kalau tidak diganti"></label></div>
      <p class="form-error" id="profErr"></p>
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-secondary" data-logout><i class="ph ph-sign-out"></i>Keluar</button><button class="btn btn-primary"><i class="ph ph-floppy-disk"></i>Simpan profil</button></div>
    </div></form>`;
  $('#profForm').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/auth/me', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); S.user.nama = new FormData(e.target).get('nama') || S.user.nama; setUserChip(); e.target.passwordLama.value = ''; e.target.passwordBaru.value = ''; $('#profErr').textContent = ''; toast('Profil disimpan.'); }
    catch (err) { $('#profErr').textContent = err.message; }
  };
}

// ---------- Modal tambah/ubah/detail ----------
const FORMS = {
  kelas: { label: 'jadwal', eyebrow: 'Jadwal kuliah', fields: (v) => `
    <label class="field"><span>Mata kuliah</span><input name="matkul" required value="${esc(v.matkul)}" list="dlMatkul"></label>
    <label class="field"><span>Hari</span><select name="hari">${[1, 2, 3, 4, 5, 6, 0].map((h) => `<option value="${h}" ${+v.hari === h ? 'selected' : ''}>${HARI[h]}</option>`).join('')}</select></label>
    <div class="grid2"><label class="field"><span>Mulai</span><input type="time" name="mulai" required value="${esc(v.mulai)}"></label><label class="field"><span>Selesai</span><input type="time" name="selesai" value="${esc(v.selesai)}"></label></div>
    <div class="grid2"><label class="field"><span>Ruang</span><input name="ruang" value="${esc(v.ruang)}" placeholder="R.301"></label><label class="field"><span>Dosen</span><input name="dosen" value="${esc(v.dosen)}"></label></div>` },
  tugas: { label: 'tugas', eyebrow: 'Tugas', fields: (v) => `
    <label class="field"><span>Judul tugas</span><input name="judul" required value="${esc(v.judul)}" placeholder="Laporan praktikum 3"></label>
    <label class="field"><span>Mata kuliah</span><input name="matkul" required value="${esc(v.matkul)}" list="dlMatkul"></label>
    <div class="grid2"><label class="field"><span>Tenggat</span><input type="datetime-local" name="deadline" required value="${esc((v.deadline || '').replace(' ', 'T'))}"></label>
    <label class="field"><span>Prioritas</span><select name="prioritas"><option value="normal">Normal</option><option value="tinggi" ${v.prioritas === 'tinggi' ? 'selected' : ''}>Tinggi</option></select></label></div>
    <label class="field"><span>Catatan</span><textarea name="catatan" placeholder="Format pengumpulan, link Drive, dll.">${esc(v.catatan)}</textarea></label>
    ${v.id ? `<label class="inline-field"><input type="checkbox" name="selesai" ${v.selesai ? 'checked' : ''}> Sudah selesai</label>` : ''}` },
  ujian: { label: 'ujian', eyebrow: 'Ujian', fields: (v) => `
    <label class="field"><span>Mata kuliah</span><input name="matkul" required value="${esc(v.matkul)}" list="dlMatkul"></label>
    <div class="grid2"><label class="field"><span>Jenis</span><select name="jenis">${['UTS', 'UAS', 'Kuis', 'Praktikum'].map((j) => `<option ${v.jenis === j ? 'selected' : ''}>${j}</option>`).join('')}</select></label>
    <label class="field"><span>Ruang</span><input name="ruang" value="${esc(v.ruang)}"></label></div>
    <label class="field"><span>Waktu</span><input type="datetime-local" name="waktu" required value="${esc((v.waktu || '').replace(' ', 'T'))}"></label>` },
  akun: { label: 'akun', eyebrow: 'Kelola akun', fields: (v) => `
    <label class="field"><span>Nama</span><input name="nama" required value="${esc(v.nama)}"></label>
    <label class="field"><span>Username</span><input name="username" required value="${esc(v.username)}" ${v.id ? 'disabled' : ''} autocapitalize="none" placeholder="huruf kecil, tanpa spasi"></label>
    <label class="field"><span>Peran</span><select name="role">${['viewer', 'editor', 'admin'].map((r) => `<option value="${r}" ${(v.role || 'viewer') === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></label>
    <label class="field"><span>${v.id ? 'Password baru (opsional)' : 'Password'}</span><input type="password" name="password" minlength="8" ${v.id ? '' : 'required'} autocomplete="new-password"></label>` },
};
const findItem = (type, id) => (type === 'akun' ? S.akun : S.data[type]).find((x) => x.id === id);
let editing = null;
function openForm(type, id) {
  const v = id ? findItem(type, id) : (type === 'kelas' ? { hari: w(now()).dow || 1 } : {});
  editing = { type, id };
  const f = FORMS[type];
  $('#mEyebrow').textContent = f.eyebrow;
  $('#mTitle').textContent = `${id ? 'Ubah' : 'Tambah'} ${f.label}`;
  const matkul = [...new Set([...S.data.kelas, ...S.data.tugas, ...S.data.ujian].map((x) => x.matkul))].sort();
  $('#mBody').innerHTML = f.fields(v) + `<datalist id="dlMatkul">${matkul.map((m) => `<option value="${esc(m)}">`).join('')}</datalist><p class="form-error" id="mErr"></p>`;
  $('#mFoot').innerHTML = `<button type="button" class="btn btn-secondary" data-close>Batal</button><button class="btn btn-primary" id="mSubmit"><i class="ph ph-floppy-disk"></i>Simpan</button>`;
  $('#modal').showModal(); a11yPass();
  setTimeout(() => $('#mBody input:not([disabled]), #mBody select')?.focus(), 30);
}
function openDetail(type, id) {
  const v = findItem(type, id); if (!v) return;
  editing = { type, id, detail: true };
  const rows = {
    kelas: [['Hari', HARI[v.hari]], ['Jam', `${v.mulai}${v.selesai ? ' – ' + v.selesai : ''}`], ['Ruang', v.ruang], ['Dosen', v.dosen]],
    tugas: [['Mata kuliah', v.matkul], ['Tenggat', `${tgl(v.ms)} · ${hm(v.ms)} WIB`], ['Status', badge(dueBadge(v.ms, v.selesai))], ['Prioritas', v.prioritas === 'tinggi' ? 'Tinggi' : 'Normal'], ['Catatan', v.catatan]],
    ujian: [['Jenis', v.jenis], ['Waktu', `${tgl(v.ms)} · ${hm(v.ms)} WIB`], ['Ruang', v.ruang], ['Status', v.ms < now() ? 'Selesai' : badge(dueBadge(v.ms))]],
  }[type];
  $('#mEyebrow').textContent = FORMS[type].eyebrow;
  $('#mTitle').textContent = type === 'tugas' ? v.judul : v.matkul;
  $('#mBody').innerHTML = `<dl class="detail-list">${rows.filter(([, val]) => val).map(([k, val]) => `<div><dt>${k}</dt><dd>${['Status'].includes(k) ? val : esc(val).replace(/\n/g, '<br>')}</dd></div>`).join('')}</dl>`;
  $('#mFoot').innerHTML = canEdit()
    ? `<button type="button" class="btn btn-danger left" data-del="${type}" data-id="${id}"><i class="ph ph-trash"></i>Hapus</button><button type="button" class="btn btn-secondary" data-close>Tutup</button><button type="button" class="btn btn-primary" data-edit="${type}" data-id="${id}"><i class="ph ph-pencil-simple"></i>Ubah</button>`
    : '<button type="button" class="btn btn-secondary" data-close>Tutup</button>';
  $('#modal').showModal();
}
$('#modalForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editing || editing.detail) return;
  const form = e.target; const bad = [...form.elements].find((el) => el.willValidate && !el.checkValidity());
  if (bad) { $('#mErr').textContent = `${bad.closest('.field')?.querySelector('span')?.textContent || 'Isian'} belum valid.`; bad.focus(); return; }
  const fd = new FormData(form); const body = Object.fromEntries(fd); body.selesai = fd.has('selesai');
  const { type, id } = editing; const btn = $('#mSubmit'); btn.disabled = true; btn.lastChild.textContent = 'Menyimpan…';
  try {
    await api(`/api/${type}${id ? '/' + id : ''}`, { method: id ? 'PUT' : 'POST', body });
    $('#modal').close();
    toast(`${FORMS[type].label[0].toUpperCase() + FORMS[type].label.slice(1)} ${id ? 'diperbarui' : 'ditambahkan'}.`);
    type === 'akun' ? loadAkun() : refresh();
  } catch (err) { $('#mErr').textContent = err.message; btn.disabled = false; btn.lastChild.textContent = 'Simpan'; }
});
$('#modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

async function del(type, id) {
  const v = findItem(type, id);
  const label = type === 'tugas' ? `tugas "${v?.judul}"` : type === 'akun' ? `akun ${v?.nama}` : `${FORMS[type].label} ${v?.matkul}`;
  if (!confirm(`Hapus ${label}?`)) return;
  try {
    await api(`/api/${type}/${id}`, { method: 'DELETE' });
    if ($('#modal').open) $('#modal').close();
    toast('Data dihapus.');
    type === 'akun' ? loadAkun() : refresh();
  } catch (err) { toast(err.message, 'error'); }
}

function openDay(ms) {
  const k = dayKey(ms); const dow = w(ms).dow;
  const kelas = S.data.kelas.filter((x) => x.hari === dow).sort((a, b) => a.mulai.localeCompare(b.mulai));
  const tugas = S.data.tugas.filter((x) => dayKey(x.ms) === k);
  const ujian = S.data.ujian.filter((x) => dayKey(x.ms) === k);
  editing = { detail: true };
  $('#mEyebrow').textContent = 'Agenda harian';
  $('#mTitle').textContent = tgl(ms);
  const sec = (title, html) => `<div><div class="eyebrow" style="margin-bottom:8px">${title}</div><div class="rows">${html}</div></div>`;
  $('#mBody').innerHTML = (kelas.length || tugas.length || ujian.length)
    ? [kelas.length && sec('Kelas', kelas.map((x) => `<div class="row"><b style="color:var(--accent);font-size:12px">${x.mulai}</b><div class="grow"><div class="title">${esc(x.matkul)}</div><div class="sub">${esc(x.ruang || '')}</div></div></div>`).join('')),
      tugas.length && sec('Tenggat tugas', tugas.map((t) => taskRow(t, true)).join('')),
      ujian.length && sec('Ujian', ujian.map((u) => `<div class="row"><span class="badge b-warn">${esc(u.jenis)}</span><div class="grow"><div class="title">${esc(u.matkul)}</div><div class="sub">${hm(u.ms)}${u.ruang ? ' · ' + esc(u.ruang) : ''}</div></div></div>`).join(''))].filter(Boolean).join('')
    : empty('coffee', 'Hari kosong', 'Tidak ada kelas, tenggat, atau ujian.');
  $('#mFoot').innerHTML = '<button type="button" class="btn btn-secondary" data-close>Tutup</button>';
  $('#modal').showModal();
}

// ---------- Event global ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-view],[data-add],[data-edit],[data-del],[data-detail],[data-toggle],[data-close],[data-filter],[data-day],[data-pick-day],[data-scope],[data-ptab],[data-send],[data-test-send],[data-reload-status],[data-clear-q],[data-logout]');
  if (!el) return;
  const d = el.dataset; const id = Number(d.id);
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
  if ('reloadStatus' in d) { S.status = null; viewStatus(); return loadStatus(); }
  if ('logout' in d) return logout();
  if ('send' in d || 'testSend' in d) {
    const label = 'send' in d ? `Kirim pesan "${{ pagi: 'ringkasan hari ini', besok: 'persiapan besok', tugas: 'daftar tugas', ujian: 'daftar ujian' }[d.send]}" ke grup sekarang?` : 'Kirim pesan percobaan ke grup?';
    if (!confirm(label)) return;
    el.disabled = true; const old = el.innerHTML; el.innerHTML = '<i class="ph ph-spinner"></i>Mengirim…';
    try { await api('send' in d ? `/api/pengingat/kirim/${d.send}` : '/api/status/tes', { method: 'POST' }); toast('Pesan terkirim ke grup.'); if ('testSend' in d) loadStatus(); }
    catch (err) { toast(err.message, 'error'); }
    el.disabled = false; el.innerHTML = old;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.class-card, .session, .reminder')) e.target.click();
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
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && v !== S.view) go(v); });

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
  $('#avatar').textContent = (S.user.nama[0] || '?').toUpperCase();
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
