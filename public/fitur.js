/* Six Seven 67: fitur tambahan web (dimuat setelah app.js dan memakai fungsi-fungsinya). */
'use strict';

// ================= Utilitas =================
const fxMenit = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const fxJam = (menit) => `${p2(Math.floor(menit / 60))}:${p2(menit % 60)}`;
const fxSama = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const fxLalu = (ms) => {
  if (!ms) return 'belum pernah';
  const d = Math.max(0, now() - ms); const mnt = Math.round(d / 6e4);
  if (mnt < 5) return 'baru saja';
  if (mnt < 60) return `${mnt} menit lalu`;
  if (mnt < 1440) return `${Math.round(mnt / 60)} jam lalu`;
  if (mnt < 2880) return 'kemarin';
  return `${Math.round(mnt / 1440)} hari lalu`;
};

// Gambar yang butuh login (foto profil): diunduh dengan token lalu ditampilkan sebagai blob.
const fxBlobCache = new Map();
async function muatGambarAuth(root = document) {
  for (const img of root.querySelectorAll('img[data-auth-img]:not([data-loaded])')) {
    img.dataset.loaded = '1';
    const src = img.getAttribute('src'); img.removeAttribute('src');
    try {
      if (!fxBlobCache.has(src)) {
        const r = await fetch(src, { headers: { Authorization: `Bearer ${token}` } });
        fxBlobCache.set(src, r.ok ? URL.createObjectURL(await r.blob()) : null);
      }
      const u = fxBlobCache.get(src);
      if (u) img.src = u; else img.replaceWith(document.createTextNode('?'));
    } catch { /* biarkan kosong */ }
  }
}
const fxAvatar = (o) => (o.foto || o.ada_foto ? `<img src="/api/akun/${o.id}/foto?t=${S.fotoVer || 0}" alt="" data-auth-img>` : esc((o.nama || '?')[0].toUpperCase()));

// Kembalikan data dari sampah (dipakai tombol "Batalkan" setelah hapus dan menu Riwayat).
async function pulihkan(sampahId) {
  try {
    await api(`/api/sampah/${sampahId}/pulihkan`, { method: 'POST' });
    toast('Data dikembalikan.');
    await refresh();
    if (S.view === 'riwayat') loadRiwayat();
    if (S.view === 'pengumuman') loadPengumuman();
  } catch (err) { toast(err.message, 'error'); }
}

// Modal kustom memakai #modal yang sama; submit ditangani fungsi masing-masing.
function bukaModal({ eyebrow, title, body, foot, onSubmit, onOpen, draft, ep }) {
  editing = { detail: true, custom: onSubmit || null };
  $('#mEyebrow').textContent = eyebrow; $('#mTitle').textContent = title;
  $('#mBody').innerHTML = body + '<p class="form-error" id="mErr"></p>';
  $('#mFoot').innerHTML = foot ?? `<button type="button" class="btn btn-secondary" data-close>Batal</button><button class="btn btn-primary" id="mSubmit"><i class="ph ph-floppy-disk"></i>Simpan</button>`;
  fxDraft = null;
  $('#modal').showModal(); a11yPass(); onOpen?.();
  if (draft) mulaiDraftModal(draft, ep, () => bukaModal({ eyebrow, title, body, foot, onSubmit, onOpen, draft, ep }));
}
$('#modalForm').addEventListener('submit', async (e) => {
  if (!editing?.custom) return;
  e.preventDefault();
  const btn = $('#mSubmit'); if (btn) btn.disabled = true;
  try { await editing.custom(new FormData(e.target), e.target); }
  catch (err) { $('#mErr').textContent = err.message; }
  if (btn) btn.disabled = false;
});

// ================= Tema terang / gelap =================
function temaSekarang() { try { return localStorage.getItem('tema') || 'gelap'; } catch { return 'gelap'; } }
function terapkanTema(pilihan) {
  try { localStorage.setItem('tema', pilihan); } catch {}
  const t = pilihan === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'terang' : 'gelap') : pilihan;
  document.documentElement.dataset.theme = t;
  $('#temaBtn i').className = `ph ph-${t === 'terang' ? 'moon' : 'sun'}`;
  $('meta[name=theme-color]')?.setAttribute('content', t === 'terang' ? '#f3f3f6' : '#050506');
}
$('#temaBtn').onclick = () => { terapkanTema(document.documentElement.dataset.theme === 'terang' ? 'gelap' : 'terang'); if (S.view === 'profil') viewProfil(); };
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => { if (temaSekarang() === 'auto') terapkanTema('auto'); });
terapkanTema(temaSekarang());

// ================= Cari cepat (Ctrl+K) =================
let fxPalItems = []; let fxPalIdx = 0;
function bukaPalette() {
  const d = $('#palette'); if (d.open) return;
  $('#palInput').value = ''; isiPalette(''); d.showModal(); $('#palInput').focus();
}
function isiPalette(q) {
  const s = q.trim().toLowerCase();
  const menu = NAV.flatMap((g) => g.items).filter(allowed).map((it) => ({ ikon: it.icon, judul: it.label, sub: 'Menu', aksi: () => go(it.id) }));
  const mk = (S.data.matkul || []).map((m) => ({ ikon: 'books', judul: m.nama, sub: `Mata kuliah${m.dosen ? ' · ' + m.dosen : ''}`, warna: mkVar(m.nama), aksi: () => go(`matkul/${m.id}`) }));
  const tg = S.data.tugas.map((t) => ({ ikon: t.selesai ? 'check-circle' : 'list-checks', judul: t.judul, sub: `Tugas · ${t.matkul} · ${tgl(t.ms)}`, warna: mkVar(t.matkul), cari: t.catatan, aksi: () => openDetail('tugas', t.id) }));
  const uj = S.data.ujian.map((u) => ({ ikon: 'exam', judul: `${u.jenis} ${u.matkul}`, sub: `Ujian · ${tgl(u.ms)} ${hm(u.ms)}`, warna: mkVar(u.matkul), aksi: () => openDetail('ujian', u.id) }));
  const aksi = canEdit() ? [
    { ikon: 'plus', judul: 'Tambah tugas', sub: 'Aksi', aksi: () => openForm('tugas') },
    { ikon: 'plus', judul: 'Tambah ujian', sub: 'Aksi', aksi: () => openForm('ujian') },
    { ikon: 'calendar-x', judul: 'Batalkan kelas', sub: 'Aksi', aksi: () => openForm('batal') },
  ] : [];
  const tema = [{ ikon: 'sun', judul: 'Ganti tema terang/gelap', sub: 'Tampilan', aksi: () => $('#temaBtn').click() }];
  const semua = [...menu, ...aksi, ...mk, ...tg, ...uj, ...tema];
  fxPalItems = (s ? semua.filter((x) => `${x.judul} ${x.sub} ${x.cari || ''}`.toLowerCase().includes(s)) : [...menu, ...aksi]).slice(0, 30);
  fxPalIdx = 0; gambarPalette();
}
function gambarPalette() {
  $('#palList').innerHTML = fxPalItems.length ? fxPalItems.map((x, i) => `<button type="button" class="pal-item" role="option" aria-selected="${i === fxPalIdx}" data-pal="${i}" ${x.warna ? `style="${x.warna}"` : ''}><i class="ph ph-${x.ikon}"></i><span><b>${esc(x.judul)}</b><small>${esc(x.sub)}</small></span></button>`).join('')
    : '<p class="muted pal-kosong">Tidak ada hasil.</p>';
  $('#palList [aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
}
function pilihPalette(i) { const x = fxPalItems[i]; if (!x) return; $('#palette').close(); x.aksi(); }
$('#palInput').addEventListener('input', (e) => isiPalette(e.target.value));
$('#palInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); fxPalIdx = Math.min(fxPalItems.length - 1, fxPalIdx + 1); gambarPalette(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); fxPalIdx = Math.max(0, fxPalIdx - 1); gambarPalette(); }
  if (e.key === 'Enter') { e.preventDefault(); pilihPalette(fxPalIdx); }
});
$('#palList').addEventListener('click', (e) => { const b = e.target.closest('[data-pal]'); if (b) pilihPalette(Number(b.dataset.pal)); });
$('#palette').addEventListener('click', (e) => { if (e.target.id === 'palette') e.target.close(); });
$('#cariBtn').onclick = bukaPalette;
document.addEventListener('keydown', (e) => {
  const mengetik = e.target.matches?.('input, textarea, select, [contenteditable]');
  if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !mengetik)) { if (S.user) { e.preventDefault(); bukaPalette(); } }
});

// ================= Dashboard: pengumuman disematkan, fokus hari ini, progres, minggu depan =================
function dashEkstra() {
  const n = now(); const sod = startOfDay(n); const tn = w(n);
  const pins = (S.data.pin || []).map((p) => `<div class="pin-banner"><i class="ph-fill ph-push-pin"></i><div class="grow"><div class="pin-teks">${waFormat(p.teks)}</div>
    ${p.gambar ? `<a href="${esc(p.gambar)}" target="_blank" rel="noopener"><img class="pin-img" src="${esc(p.gambar)}" alt="Lampiran pengumuman" loading="lazy"></a>` : ''}
    <small>${esc(p.oleh || 'Admin')} · ${tgl(p.kirim_at)}</small></div></div>`).join('');

  const kelas = kelasPada(sod);
  const libur = kelas.find((k) => k.libur)?.libur;
  const aktifT = S.data.tugas.filter((t) => !t.selesai);
  const mendesak = aktifT.filter((t) => t.ms > n && t.ms - n <= 36 * 36e5 && !t.kumpulSaya).sort((a, b) => a.ms - b.ms);
  const telat = aktifT.filter((t) => t.ms <= n && !t.kumpulSaya);
  const ujianDekat = S.data.ujian.filter((u) => u.ms > n && u.ms - n <= 3 * DAY).sort((a, b) => a.ms - b.ms);
  const sisaKelas = kelas.filter((k) => !k.batal && atToday(sod, k.selesai || fxJam(fxMenit(k.mulai) + 100)) > n);
  const fokus = [
    libur ? `<li class="fk" data-tone="info"><i class="ph ph-umbrella-simple"></i><span><b>Libur: ${esc(libur)}</b><small>Tidak ada kelas rutin hari ini</small></span></li>` : '',
    ...kelas.filter((k) => k.batal && !k.libur).map((k) => `<li class="fk" data-tone="danger" ${detailAttr(k)}><i class="ph ph-x-circle"></i><span><b>${esc(k.matkul)} batal</b><small>${k.mulai}${k.alasan ? ' · ' + esc(k.alasan) : ''}</small></span></li>`),
    ...sisaKelas.map((k) => `<li class="fk" style="${mkVar(k.matkul)}" ${detailAttr(k)}><i class="ph ph-chalkboard-teacher"></i><span><b>${esc(k.matkul)}${k.pengganti ? ' (pengganti)' : ''}</b><small>${k.mulai}${k.selesai ? '–' + k.selesai : ''}${k.ruang ? ' · ' + esc(k.ruang) : ''}</small></span><time>${k.mulai.replace(':', '.')}</time></li>`),
    ...telat.slice(0, 3).map((t) => `<li class="fk" data-tone="danger" data-detail="tugas" data-id="${t.id}"><i class="ph ph-warning"></i><span><b>${esc(t.judul)}</b><small>${esc(t.matkul)} · lewat tenggat, belum kamu tandai kumpul</small></span></li>`),
    ...mendesak.map((t) => `<li class="fk" data-tone="warning" style="${mkVar(t.matkul)}" data-detail="tugas" data-id="${t.id}"><i class="ph ph-hourglass-medium"></i><span><b>${esc(t.judul)}</b><small>${esc(t.matkul)} · tenggat ${relDay(t.ms)}</small></span><time>${fmtCountdown(t.ms - n).split(' ').slice(0, 2).join(' ')}</time></li>`),
    ...ujianDekat.map((u) => `<li class="fk" data-tone="warning" style="${mkVar(u.matkul)}" data-detail="ujian" data-id="${u.id}"><i class="ph ph-exam"></i><span><b>${esc(u.jenis)} ${esc(u.matkul)}</b><small>${relDay(u.ms)}${u.ruang ? ' · ' + esc(u.ruang) : ''}${u.bawa ? ' · bawa ' + esc(u.bawa) : ''}</small></span></li>`),
  ].filter(Boolean);

  const total = aktifT.length; const sudah = aktifT.filter((t) => t.kumpulSaya).length;
  const pct = total ? Math.round(sudah / total * 100) : 100;
  const belum = aktifT.filter((t) => !t.kumpulSaya).length;

  // Minggu depan: tampil Jumat–Minggu.
  let depan = '';
  if ([5, 6, 0].includes(tn.dow)) {
    const senin = sod + ((8 - tn.dow) % 7 || 7) * DAY;
    const hari = Array.from({ length: 7 }, (_, i) => senin + i * DAY);
    const kls = hari.reduce((a, d) => a + kelasPada(d).filter((k) => !k.batal).length, 0);
    const tg = S.data.tugas.filter((t) => !t.selesai && t.ms >= senin && t.ms < senin + 7 * DAY).sort((a, b) => a.ms - b.ms);
    const uj = S.data.ujian.filter((u) => u.ms >= senin && u.ms < senin + 7 * DAY).sort((a, b) => a.ms - b.ms);
    const lib = hari.map((d) => kelasPada(d).find((k) => k.libur)?.libur).filter(Boolean);
    depan = `<div class="panel"><div class="panel-head"><div><h2>Minggu depan</h2><span>${tgl(senin)} – ${tgl(senin + 6 * DAY)}</span></div></div>
      <div class="mini-stats"><div><b>${kls}</b><span>kelas</span></div><div><b>${tg.length}</b><span>tenggat</span></div><div><b>${uj.length}</b><span>ujian</span></div></div>
      ${lib.length ? `<p class="muted" style="margin:0;font-size:13px"><i class="ph ph-umbrella-simple"></i> Libur: ${esc([...new Set(lib)].join(', '))}</p>` : ''}
      <ul class="fokus">${[...uj.map((u) => `<li class="fk" style="${mkVar(u.matkul)}" data-detail="ujian" data-id="${u.id}"><i class="ph ph-exam"></i><span><b>${esc(u.jenis)} ${esc(u.matkul)}</b><small>${tgl(u.ms)} · ${hm(u.ms)}</small></span></li>`),
        ...tg.slice(0, 4).map((t) => `<li class="fk" style="${mkVar(t.matkul)}" data-detail="tugas" data-id="${t.id}"><i class="ph ph-list-checks"></i><span><b>${esc(t.judul)}</b><small>${esc(t.matkul)} · ${tgl(t.ms)}</small></span></li>`)].join('')}</ul></div>`;
  }

  return `${pins ? `<section class="pins">${pins}</section>` : ''}
  <section class="dash-grid">
    <div class="panel"><div class="panel-head"><div><h2>Fokus hari ini</h2><span>${fokus.length ? 'Yang perlu diperhatikan sekarang' : 'Tidak ada yang mendesak'}</span></div></div>
      ${fokus.length ? `<ul class="fokus">${fokus.join('')}</ul>` : panelEmpty('confetti', 'Aman untuk hari ini', 'Tidak ada kelas tersisa, tenggat dekat, atau ujian dalam 3 hari.')}</div>
    <div class="stack">
      <div class="panel"><div class="panel-head"><div><h2>Progres kamu</h2><span>Tugas aktif yang sudah kamu kumpulkan</span></div></div>
        <div class="progress"><div><span>${total ? `${sudah} dari ${total} tugas` : 'Belum ada tugas aktif'}</span><strong>${pct}%</strong></div><div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progres tugas kamu"><i style="width:${pct}%"></i></div></div>
        ${belum ? `<button class="ghost-btn panel-foot" data-view="tugas" data-filter-set="belum">${belum} tugas belum kamu kumpulkan<i class="ph ph-arrow-right"></i></button>` : ''}</div>
      ${depan}
    </div>
  </section>`;
}

// ================= Semester & libur =================
function semesterCard() {
  const s = S.data.semester || {}; const hariIni = ymdOf(now());
  const libur = (s.libur || []).filter((l) => (l.sampai || l.dari) >= hariIni).slice(0, 4);
  if (!s.mulai && !s.selesai && !libur.length) {
    return canEdit() ? `<div class="card semester-card muted"><i class="ph ph-calendar-check"></i> Atur tanggal semester dan hari libur supaya bot berhenti mengingatkan kelas saat libur dan hitungan kehadiran akurat. <button class="link-btn" data-semester>Atur sekarang</button></div>` : '';
  }
  const msM = s.mulai && msOfYmd(s.mulai); const msS = s.selesai && msOfYmd(s.selesai);
  const pct = msM && msS ? Math.min(100, Math.max(0, Math.round((now() - msM) / (msS - msM) * 100))) : null;
  const pekan = msM ? Math.max(0, Math.floor((startOfDay(now()) - msM) / (7 * DAY)) + 1) : null;
  return `<div class="card semester-card"><div class="card-head"><h2><i class="ph ph-calendar-check"></i>Semester</h2>${canEdit() ? '<button class="btn btn-secondary btn-sm" data-semester><i class="ph ph-pencil-simple"></i>Ubah</button>' : ''}</div>
    <div class="sem-row"><span>${s.mulai ? tgl(msM) : '?'} – ${s.selesai ? tgl(msS) : '?'}</span>${pekan && pct < 100 ? `<b>Pekan ke-${pekan}</b>` : pct >= 100 ? '<b>Semester selesai</b>' : ''}</div>
    ${pct != null ? `<div class="bar" role="progressbar" aria-label="Progres semester" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>` : ''}
    ${libur.length ? `<div class="libur-list">${libur.map((l) => `<span class="tag"><i class="ph ph-umbrella-simple"></i>${esc(l.nama)} · ${tgl(msOfYmd(l.dari))}${l.sampai && l.sampai !== l.dari ? ` – ${tgl(msOfYmd(l.sampai))}` : ''}</span>`).join('')}</div>` : ''}</div>`;
}
function bukaSemester() {
  const s = S.data.semester || {};
  const baris = (l = {}) => `<div class="libur-row"><input type="text" data-l="nama" value="${esc(l.nama || '')}" placeholder="Nama libur (mis. Idulfitri)" aria-label="Nama libur"><input type="date" data-l="dari" value="${esc(l.dari || '')}" aria-label="Dari tanggal"><input type="date" data-l="sampai" value="${esc(l.sampai || '')}" aria-label="Sampai tanggal"><button type="button" class="tiny-btn danger" data-libur-del aria-label="Hapus libur"><i class="ph ph-x"></i></button></div>`;
  bukaModal({
    eyebrow: 'Jadwal kuliah', title: 'Semester & hari libur', draft: 'semester', ep: '/api/semester',
    body: `<div class="grid2"><label class="field"><span>Awal semester</span><input type="date" name="mulai" value="${esc(s.mulai || '')}"></label><label class="field"><span>Akhir semester</span><input type="date" name="selesai" value="${esc(s.selesai || '')}"></label></div>
      <small class="muted">Di luar tanggal ini bot tidak mengingatkan kelas rutin.</small>
      <label class="inline-field"><input type="checkbox" name="nasional" ${s.nasional !== false ? 'checked' : ''}> Libur nasional bertanggal tetap otomatis (1 Jan, 1 Mei, 1 Jun, 17 Agu, 25 Des)</label>
      <div class="field"><span>Libur lain (UTS/UAS, Idulfitri, Nyepi, dies natalis, dll.)</span><div id="liburRows" class="libur-rows">${(s.libur || []).map(baris).join('') || baris()}</div>
        <button type="button" class="btn btn-secondary btn-sm" data-libur-add style="justify-self:start">${PLUS}Tambah libur</button>
        <small class="muted">Libur yang tanggalnya berubah tiap tahun perlu diisi di sini. Kuliah pengganti tetap berjalan walau hari libur.</small></div>`,
    onOpen: () => { bukaSemester.baris = baris; },
    onSubmit: async (fd) => {
      const libur = $$('#liburRows .libur-row').map((r) => ({ nama: $('[data-l=nama]', r).value, dari: $('[data-l=dari]', r).value, sampai: $('[data-l=sampai]', r).value || $('[data-l=dari]', r).value })).filter((l) => l.dari);
      await api('/api/semester', { method: 'PUT', body: { mulai: fd.get('mulai'), selesai: fd.get('selesai'), nasional: fd.has('nasional'), libur } });
      $('#modal').close(); toast('Semester & libur disimpan.'); refresh();
    },
  });
}

// ================= Halaman detail mata kuliah =================
const SKALA = [['A', 85], ['A-', 80], ['B+', 75], ['B', 70], ['B-', 65], ['C+', 60], ['C', 55], ['D', 45]];
const hurufDari = (n) => (SKALA.find(([, b]) => n >= b) || ['E'])[0];

// Semua pertemuan mata kuliah ini dari awal semester (atau 8 pekan lalu) sampai `sampai`.
function pertemuanMatkul(m, sampai) {
  const sem = S.data.semester || {};
  const awal = sem.mulai ? msOfYmd(sem.mulai) : startOfDay(now()) - 56 * DAY;
  const akhir = Math.min(sampai, sem.selesai ? msOfYmd(sem.selesai) + DAY - 1 : sampai);
  const out = [];
  for (let d = startOfDay(awal); d <= akhir; d += DAY) {
    for (const k of kelasPada(d)) {
      if (!fxSama(k.matkul, m.nama)) continue;
      const mulai = atToday(d, k.mulai);
      out.push({ tanggal: ymdOf(d), ms: mulai, k, key: k.pengganti ? `p${k.ubahId}` : String(k.id), batal: k.batal, libur: k.libur, lewat: mulai <= now() });
    }
  }
  return out;
}

function viewMatkulDetail() {
  const m = (S.data.matkul || []).find((x) => x.id === S.mkId);
  if (!m) { $('#content').innerHTML = `<div class="card">${empty('books', 'Mata kuliah tidak ditemukan', 'Mungkin sudah dihapus.', '<button class="btn btn-secondary" data-view="matkul">Kembali ke daftar</button>')}</div>`; return; }
  $('#pageTitle').textContent = m.nama; document.title = `${m.nama} · Six Seven 67`;
  const n = now();
  const jadwal = S.data.kelas.filter((k) => fxSama(k.matkul, m.nama)).sort((a, b) => ((a.hari + 6) % 7) - ((b.hari + 6) % 7) || a.mulai.localeCompare(b.mulai));
  const tugas = S.data.tugas.filter((t) => fxSama(t.matkul, m.nama)).sort((a, b) => (a.selesai - b.selesai) || a.ms - b.ms);
  const ujian = S.data.ujian.filter((u) => fxSama(u.matkul, m.nama)).sort((a, b) => a.ms - b.ms);
  const materi = (S.data.materi || []).filter((x) => x.matkul_id === m.id);
  const ubah = (S.data.kelasUbah || []).filter((u) => u.tanggal >= ymdOf(n) && (fxSama(u.matkul, m.nama) || (u.jenis === 'batal' && jadwal.some((k) => k.id === u.kelas_id))));

  // Kehadiran
  const sem = S.data.semester || {};
  const semua = jadwal.length || ubah.length ? pertemuanMatkul(m, sem.selesai ? msOfYmd(sem.selesai) + DAY : n) : [];
  const lewat = semua.filter((x) => x.lewat && !x.batal);
  const totalSemester = sem.selesai ? semua.filter((x) => !x.batal).length : null;
  const absen = new Set(S.data.saya?.absen || []);
  const bolos = lewat.filter((x) => absen.has(`${x.tanggal}|${x.key}`)).length;
  const maks = m.maks_bolos;
  const sisa = maks != null ? maks - bolos : null;
  const nadaSisa = sisa == null ? '' : sisa < 0 ? 'danger' : sisa <= 1 ? 'warning' : 'success';
  const kehadiran = semua.length ? `<div class="card"><div class="card-head"><h2><i class="ph ph-user-check"></i>Kehadiran kamu</h2>${sisa != null ? `<span class="tag" data-tone="${nadaSisa}">${sisa < 0 ? `Lewat batas ${-sisa}×` : `Sisa jatah tidak hadir ${sisa}×`}</span>` : ''}</div>
      <div class="mini-stats"><div><b>${lewat.length - bolos}</b><span>hadir</span></div><div><b>${bolos}</b><span>tidak hadir${maks != null ? ` / maks ${maks}` : ''}</span></div><div><b>${lewat.length}${totalSemester ? `/${totalSemester}` : ''}</b><span>pertemuan${totalSemester ? ' semester' : ' berjalan'}</span></div></div>
      ${!sem.mulai ? '<p class="muted" style="font-size:12.5px;margin:0">Tanggal semester belum diatur, jadi pertemuan dihitung dari 8 pekan terakhir.</p>' : ''}
      ${lewat.length ? `<div class="absen-list">${lewat.slice().reverse().slice(0, S.absenSemua ? 999 : 8).map((x) => { const off = absen.has(`${x.tanggal}|${x.key}`); return `<div class="absen-row"><span><b>${tgl(x.ms)}</b><small>${x.k.mulai}${x.k.pengganti ? ' · pengganti' : ''}</small></span><button class="absen-btn" data-absen="${x.tanggal}|${x.key}" aria-pressed="${!off}">${off ? '<i class="ph ph-x-circle"></i>Tidak hadir' : '<i class="ph-fill ph-check-circle"></i>Hadir'}</button></div>`; }).join('')}</div>
        ${lewat.length > 8 && !S.absenSemua ? `<button class="ghost-btn" data-absen-semua>Tampilkan semua ${lewat.length} pertemuan</button>` : ''}` : '<p class="muted" style="margin:0">Belum ada pertemuan yang lewat.</p>'}
      <small class="muted">Tandai pertemuan yang tidak kamu hadiri. Data ini hanya terlihat oleh kamu.</small></div>` : '';

  // Kalkulator nilai
  const bobot = m.bobot || [];
  const nilaiSaya = S.data.saya?.nilai?.[m.id] || {};
  const nilaiCard = `<div class="card"><div class="card-head"><h2><i class="ph ph-calculator"></i>Kalkulator nilai</h2></div>
    ${bobot.length ? `<form id="nilaiForm" class="nilai-form">${bobot.map((b) => `<label class="field"><span>${esc(b.nama)} <small class="muted">${b.bobot}%</small></span><input type="number" name="${esc(b.nama)}" min="0" max="100" step="0.01" value="${nilaiSaya[b.nama] ?? ''}" placeholder="belum"></label>`).join('')}
      <label class="field"><span>Target huruf</span><select name="__target">${SKALA.map(([h, bt]) => `<option value="${bt}" ${Number(S.target?.[m.id] || 80) === bt ? 'selected' : ''}>${h} (≥ ${bt})</option>`).join('')}</select></label></form>
      <div id="nilaiHasil" class="nilai-hasil"></div>
      <small class="muted">Nilai yang kamu isi hanya terlihat oleh kamu. Skala huruf bisa berbeda tiap kampus.</small>`
    : `<p class="muted" style="margin:0">Bobot nilai belum diisi.${canEdit() ? ' <button class="link-btn" data-edit="matkul" data-id="' + m.id + '">Isi bobot</button>' : ''}</p>`}</div>`;

  const kontak = m.kontak ? (/^[\d+\s-]{8,}$/.test(m.kontak) ? `<a href="https://wa.me/${m.kontak.replace(/\D/g, '').replace(/^0/, '62')}" target="_blank" rel="noopener">${esc(m.kontak)}</a>` : /@/.test(m.kontak) ? `<a href="mailto:${esc(m.kontak)}">${esc(m.kontak)}</a>` : esc(m.kontak)) : '';
  $('#content').innerHTML = `
    <a class="back-link" href="#matkul"><i class="ph ph-arrow-left"></i>Semua mata kuliah</a>
    <section class="page-head mk-head" style="${mkVar(m.nama)}">
      <span class="ph-tile mk-tile">${esc(m.nama.split(/\s+/).map((x) => x[0]).join('').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'MK')}</span>
      <div class="ph-text"><h2>${esc(m.nama)}</h2><p>${m.dosen ? `<i class="ph ph-chalkboard-teacher"></i> ${esc(m.dosen)}` : 'Dosen belum diisi'}${kontak ? ` · ${kontak}` : ''}</p></div>
      <dl class="ph-stats"><div><dt>Pertemuan/pekan</dt><dd>${jadwal.length}</dd></div><div><dt>Tugas aktif</dt><dd>${tugas.filter((t) => !t.selesai).length}</dd></div><div><dt>Ujian</dt><dd>${ujian.filter((u) => u.ms > n).length}</dd></div></dl>
      ${canEdit() ? `<div class="ph-action"><button class="btn btn-secondary" data-edit="matkul" data-id="${m.id}"><i class="ph ph-pencil-simple"></i>Ubah</button></div>` : ''}
    </section>
    <div class="split">
      <div class="stack">
        <div class="card"><div class="card-head"><h2><i class="ph ph-calendar-dots"></i>Jadwal</h2>${canEdit() ? `<button class="btn btn-secondary btn-sm" data-add-kelas-mk="${esc(m.nama)}">${PLUS}Jadwal</button>` : ''}</div>
          <div class="rows">${jadwal.length ? jadwal.map((k) => `<div class="row clickable mk-accent" style="${mkVar(m.nama)}" data-detail="kelas" data-id="${k.id}"><b style="min-width:62px">${HARI[k.hari]}</b><div class="grow"><div class="title">${k.mulai}${k.selesai ? '–' + k.selesai : ''}</div><div class="sub">${k.ruang ? esc(k.ruang) : 'Ruang belum diisi'}</div></div></div>`).join('') : '<p class="muted" style="margin:0">Belum ada jadwal.</p>'}
          ${ubah.map((u) => `<div class="row clickable" data-detail="ubah" data-id="${u.id}">${u.jenis === 'batal' ? '<span class="tag" data-tone="danger">Batal</span>' : '<span class="tag" data-tone="warning">Pengganti</span>'}<div class="grow"><div class="title">${tgl(msOfYmd(u.tanggal))}</div><div class="sub">${u.mulai || ''}${u.catatan ? ' · ' + esc(u.catatan) : ''}</div></div></div>`).join('')}</div></div>
        ${kehadiran}
        <div class="card"><div class="card-head"><h2><i class="ph ph-list-checks"></i>Tugas</h2>${canEdit() ? `<button class="btn btn-secondary btn-sm" data-add-tugas-mk="${esc(m.nama)}">${PLUS}Tugas</button>` : ''}</div>
          <div class="rows">${tugas.length ? tugas.map((t) => taskRow(t)).join('') : '<p class="muted" style="margin:0">Belum ada tugas.</p>'}</div></div>
      </div>
      <div class="stack">
        <div class="card"><div class="card-head"><h2><i class="ph ph-exam"></i>Ujian</h2>${canEdit() ? `<button class="btn btn-secondary btn-sm" data-add-ujian-mk="${esc(m.nama)}">${PLUS}Ujian</button>` : ''}</div>
          <div class="rows">${ujian.length ? ujian.map((u) => `<div class="row clickable ${u.ms < n ? 'done' : ''}" data-detail="ujian" data-id="${u.id}"><span class="badge b-warn">${esc(u.jenis)}</span><div class="grow"><div class="title">${tgl(u.ms)} · ${hm(u.ms)}</div><div class="sub">${u.ruang ? esc(u.ruang) : ''}${u.materi ? ` · ${u.materi.split('\n').length} materi` : ''}</div></div>${u.ms < n ? badge(['b-normal', 'Selesai']) : badge(dueBadge(u.ms))}</div>`).join('') : '<p class="muted" style="margin:0">Belum ada ujian.</p>'}</div></div>
        <div class="card"><div class="card-head"><h2><i class="ph ph-folder-open"></i>Materi & link</h2></div>
          <div class="rows">${materi.length ? materi.map((x) => `<div class="row"><i class="ph ph-link"></i><div class="grow"><a class="title" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.judul)}</a><div class="sub">${esc(x.url.replace(/^https?:\/\//, '').slice(0, 48))}</div></div>${canEdit() ? `<button class="tiny-btn danger" data-materi-del="${x.id}" aria-label="Hapus ${esc(x.judul)}"><i class="ph ph-trash"></i></button>` : ''}</div>`).join('') : '<p class="muted" style="margin:0">Belum ada materi. Anggota bisa membuka materi lewat <b>/materi</b> di WA.</p>'}</div>
          ${canEdit() ? `<form id="materiForm" class="materi-form" data-draft="materi:${m.id}"><input name="judul" placeholder="Judul (mis. Slide pekan 3)" required aria-label="Judul materi"><input name="url" type="url" placeholder="https://…" required aria-label="Link materi"><button class="btn btn-secondary btn-sm">${PLUS}Tambah</button></form>` : ''}</div>
        ${nilaiCard}
        ${m.catatan ? `<div class="card"><div class="card-head"><h2><i class="ph ph-note"></i>Catatan</h2></div><p style="margin:0;white-space:pre-wrap">${esc(m.catatan)}</p></div>` : ''}
      </div>
    </div>`;

  // Materi
  const mf = $('#materiForm');
  if (mf) mf.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/materi', { method: 'POST', body: { matkul_id: m.id, judul: mf.judul.value, url: mf.url.value } }); hapusDraft(`materi:${m.id}`); toast('Materi ditambahkan.'); refresh(); } catch (err) { toast(err.message, 'error'); }
  };
  pulihkanFormHalaman();
  // Kalkulator nilai: hitung langsung saat mengetik, simpan otomatis.
  const nf = $('#nilaiForm');
  if (nf) {
    const hitung = () => {
      const target = Number(nf.__target.value); (S.target ||= {})[m.id] = target;
      let isi = 0; let bIsi = 0; let bSisa = 0; const sisaNama = [];
      for (const b of bobot) { const v = nf[b.nama].value; if (v === '') { bSisa += b.bobot; sisaNama.push(b.nama); } else { isi += Number(v) * b.bobot / 100; bIsi += b.bobot; } }
      const sementara = bIsi ? isi / bIsi * 100 : null;
      let pesan;
      if (!bSisa) pesan = `<b class="big">${isi.toFixed(1)}</b><span>Nilai akhir · huruf <b>${hurufDari(isi)}</b></span>`;
      else {
        const butuh = (target - isi) / (bSisa / 100);
        pesan = `${sementara != null ? `<span>Rata-rata sementara <b>${sementara.toFixed(1)}</b> (${hurufDari(sementara)}) dari ${bIsi}% komponen.</span>` : ''}
          <span>${butuh <= 0 ? `🎉 Target sudah aman, berapa pun nilai ${esc(sisaNama.join(' & '))}.` : butuh > 100 ? `Target sulit tercapai: butuh rata-rata <b>${butuh.toFixed(1)}</b> di ${esc(sisaNama.join(' & '))}. Coba target lebih rendah.` : `Butuh rata-rata <b class="big">${butuh.toFixed(1)}</b> di ${esc(sisaNama.join(' & '))} untuk target ini.`}</span>`;
      }
      $('#nilaiHasil').innerHTML = pesan;
    };
    let tSimpan;
    nf.oninput = () => { hitung(); clearTimeout(tSimpan); tSimpan = setTimeout(async () => {
      const data = Object.fromEntries(bobot.map((b) => [b.nama, nf[b.nama].value]));
      try { await api(`/api/nilai/${m.id}`, { method: 'PUT', body: { nilai: data } }); S.data.saya.nilai[m.id] = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])); } catch (err) { toast(err.message, 'error'); }
    }, 700); };
    hitung();
  }
}

// ================= Detail tugas & ujian: link, checklist pribadi, kelompok =================
function daftarCentang(jenis, id, teks, judul) {
  const items = String(teks || '').split('\n').filter(Boolean); if (!items.length) return '';
  const done = new Set(S.data.saya?.centang?.[`${jenis}:${id}`] || []);
  const pct = Math.round(items.filter((_, i) => done.has(i)).length / items.length * 100);
  return `<div class="ck-box"><div class="ck-head"><b>${judul}</b><span>${items.filter((_, i) => done.has(i)).length}/${items.length}</span></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    ${items.map((x, i) => `<label class="ck-item"><input type="checkbox" data-centang="${jenis}|${id}|${i}" ${done.has(i) ? 'checked' : ''}><span>${esc(x)}</span></label>`).join('')}
    <small class="muted">Centangan ini hanya untuk kamu.</small></div>`;
}
function detailEkstra(type, v) {
  if (type !== 'tugas' && type !== 'ujian') return;
  const box = document.createElement('div'); box.className = 'detail-ekstra';
  const link = (href, ikon, label) => (href ? `<a class="btn btn-secondary btn-sm" href="${esc(href)}" target="_blank" rel="noopener"><i class="ph ph-${ikon}"></i>${label}</a>` : '');
  if (type === 'tugas') {
    const grup = v.kelompok ? `<div class="ck-box"><div class="ck-head"><b><i class="ph ph-users-three"></i> Tugas kelompok</b>${canEdit() ? `<button type="button" class="btn btn-secondary btn-sm" data-kelompok-edit="${v.id}">Atur kelompok</button>` : ''}</div>
      ${v.grup?.length ? (v.grupSaya ? `<p style="margin:0">Kamu di <b>${esc(v.grupSaya)}</b>: ${esc(v.grup.find((g) => g.nama === v.grupSaya).anggota.map((a) => a.nama).join(', '))}</p>` : '<p class="muted" style="margin:0">Kamu belum masuk kelompok mana pun.</p>')
        : '<p class="muted" style="margin:0">Kelompok belum diatur.</p>'}
      <small class="muted">Cukup satu anggota kelompok yang menandai kumpul.</small></div>` : '';
    box.innerHTML = `${v.link || v.lampiran ? `<div class="link-row">${link(v.link, 'upload-simple', 'Kumpulkan di sini')}${link(v.lampiran, 'paperclip', 'Lihat soal')}</div>` : ''}${grup}${daftarCentang('tugas', v.id, v.langkah, 'Langkah pengerjaan')}`;
  } else {
    box.innerHTML = `${v.bawa ? `<p class="bawa"><i class="ph ph-backpack"></i> Bawa: <b>${esc(v.bawa)}</b></p>` : ''}${v.link ? `<div class="link-row">${link(v.link, 'video-camera', 'Buka link ujian')}</div>` : ''}${daftarCentang('ujian', v.id, v.materi, 'Checklist belajar')}`;
  }
  if (box.innerHTML.trim()) $('#mBody').append(box);
}
function bukaKelompok(id) {
  const t = S.data.tugas.find((x) => x.id === id); if (!t) return;
  const teks = (t.grup || []).map((g) => `${g.nama}: ${g.anggota.map((a) => a.nama).join(', ')}`).join('\n');
  bukaModal({
    eyebrow: 'Tugas kelompok', title: t.judul, draft: `kelompok:${id}`, ep: `/api/tugas/${id}/kelompok`,
    body: `<label class="field"><span>Pembagian kelompok</span><textarea name="teks" rows="8" placeholder="Kelompok 1: Ani, Budi, Cici&#10;Kelompok 2: Dodi, Eka">${esc(teks)}</textarea>
        <small class="muted">Satu kelompok per baris. Nama harus sama dengan nama akun di web (tidak peka huruf besar/kecil).</small></label>
      <div class="inline-field">Bagi acak, <input type="number" id="ukGrup" min="2" max="20" value="4" aria-label="Anggota per kelompok"> orang per kelompok <button type="button" class="btn btn-secondary btn-sm" data-bagi-acak>Bagi</button></div>`,
    onSubmit: async (fd) => {
      const orang = S.data.orang || []; const salah = [];
      const grup = String(fd.get('teks')).split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
        const [nama, isi] = l.includes(':') ? [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1)] : [`Kelompok ${i + 1}`, l];
        const anggota = isi.split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const o = orang.find((p) => fxSama(p.nama, x)); if (!o) salah.push(x); return o?.id; }).filter(Boolean);
        return { nama, anggota };
      });
      if (salah.length) throw new Error(`Nama tidak ditemukan: ${salah.join(', ')}`);
      await api(`/api/tugas/${id}/kelompok`, { method: 'PUT', body: { grup } });
      $('#modal').close(); toast('Kelompok disimpan.'); await refresh(); openDetail('tugas', id);
    },
  });
}

// ================= Kalender: filter dan tampilan agenda =================
viewKalender = function viewKalenderBaru() {
  const n = now(); const tn = w(n); const sod = startOfDay(n);
  if (!S.cal) S.cal = { y: tn.y, m: tn.m };
  const F = (S.calF ||= { mk: '', kelas: true, tugas: true, ujian: true, mode: innerWidth < 640 ? 'agenda' : 'bulan' });
  const cocok = (nama) => !F.mk || fxSama(nama, F.mk);
  const isiHari = (ms) => {
    const key = dayKey(ms);
    const kelas = F.kelas ? kelasPada(ms).filter((k) => cocok(k.matkul)) : [];
    const tg = F.tugas ? S.data.tugas.filter((x) => dayKey(x.ms) === key && cocok(x.matkul)) : [];
    const uj = F.ujian ? S.data.ujian.filter((x) => dayKey(x.ms) === key && cocok(x.matkul)) : [];
    return { kelas, aktif: kelas.filter((k) => !k.batal), tg, uj, libur: kelasPada(ms).find((k) => k.libur)?.libur };
  };
  const { y, m } = S.cal;
  const first = Date.UTC(y, m, 1) - TZ;
  let body; let tot = { kelas: 0, tugas: 0, ujian: 0 };
  if (F.mode === 'bulan') {
    const lead = (w(first).dow + 6) % 7; const nDays = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const cells = Math.ceil((lead + nDays) / 7) * 7;
    const html = Array.from({ length: cells }, (_, i) => {
      const ms = first + (i - lead) * DAY; const t = w(ms); const inMonth = t.m === m;
      const d = isiHari(ms);
      if (inMonth) { tot.kelas += d.aktif.length; tot.tugas += d.tg.length; tot.ujian += d.uj.length; }
      const items = [
        ...d.uj.map((u) => `<li class="ev ev-ujian" style="${mkVar(u.matkul)}"><i class="ph-fill ph-exam"></i>${esc(u.jenis)} ${esc(u.matkul)}</li>`),
        ...d.tg.map((x) => `<li class="ev ev-tugas ${x.selesai ? 'done' : ''}" style="${mkVar(x.matkul)}"><i class="ph${x.kumpulSaya || x.selesai ? '-fill' : ''} ph-${x.kumpulSaya || x.selesai ? 'check-circle' : 'circle'}"></i>${esc(x.judul)}</li>`),
        ...d.kelas.filter((k) => (k.batal && !k.libur) || k.pengganti).map((k) => `<li class="ev ${k.batal ? 'ev-batal' : 'ev-pengganti'}" style="${mkVar(k.matkul)}"><i class="ph ph-${k.batal ? 'x-circle' : 'arrows-clockwise'}"></i>${esc(k.matkul)}</li>`),
      ];
      const dots = [...new Set(d.aktif.map((k) => mkKey(k.matkul)))].slice(0, 5).map((c) => `<i style="background:${MK_WARNA[c]}"></i>`).join('');
      return `<div class="cal-cell" data-day="${ms}" data-out="${!inMonth}" data-today="${ms === sod}" data-past="${ms < sod}" data-libur="${!!d.libur}" role="button" tabindex="0" aria-label="${tgl(ms)}: ${d.aktif.length} kelas, ${d.tg.length} tenggat, ${d.uj.length} ujian${d.libur ? ', libur ' + esc(d.libur) : ''}">
        <div class="cal-top"><span class="cal-num">${t.d}</span>${d.aktif.length ? `<span class="cal-dots">${dots}</span>` : ''}</div>
        ${d.libur && inMonth ? `<span class="cal-libur">${esc(d.libur)}</span>` : ''}
        ${items.length ? `<ul>${items.slice(0, 3).join('')}${items.length > 3 ? `<li class="ev-more">+${items.length - 3} lagi</li>` : ''}</ul><span class="cal-badge" aria-hidden="true">${items.length}</span>` : ''}</div>`;
    }).join('');
    body = `<div class="cal-grid">${['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((d) => `<div class="cal-dow">${d}</div>`).join('')}${html}</div>`;
  } else {
    // Agenda: daftar hari yang ada isinya, mulai hari ini (bulan ini) atau awal bulan terpilih.
    const mulai = y === tn.y && m === tn.m ? sod : first; const hari = [];
    for (let d = mulai; hari.length < 45 && d < mulai + 62 * DAY; d += DAY) {
      const x = isiHari(d); if (!x.kelas.length && !x.tg.length && !x.uj.length) continue;
      tot.kelas += x.aktif.length; tot.tugas += x.tg.length; tot.ujian += x.uj.length;
      hari.push(`<div class="ag-day" data-today="${d === sod}"><button class="ag-date" data-day="${d}"><b>${w(d).d}</b><span>${HARI[w(d).dow].slice(0, 3)}</span><small>${BULAN[w(d).m]}</small></button><div class="ag-items">
        ${x.libur ? `<div class="ag-item" data-tone="info"><i class="ph ph-umbrella-simple"></i>Libur: ${esc(x.libur)}</div>` : ''}
        ${x.uj.map((u) => `<button class="ag-item mk-accent" style="${mkVar(u.matkul)}" data-detail="ujian" data-id="${u.id}"><i class="ph-fill ph-exam"></i><b>${esc(u.jenis)} ${esc(u.matkul)}</b><span>${hm(u.ms)}${u.ruang ? ' · ' + esc(u.ruang) : ''}</span></button>`).join('')}
        ${x.tg.map((t) => `<button class="ag-item mk-accent ${t.selesai ? 'done' : ''}" style="${mkVar(t.matkul)}" data-detail="tugas" data-id="${t.id}"><i class="ph ph-list-checks"></i><b>${esc(t.judul)}</b><span>${esc(t.matkul)} · ${hm(t.ms)}${t.kumpulSaya ? ' · sudah kumpul' : ''}</span></button>`).join('')}
        ${x.kelas.filter((k) => !k.libur).map((k) => `<button class="ag-item mk-accent ${k.batal ? 'is-batal' : ''}" style="${mkVar(k.matkul)}" ${detailAttr(k)}><i class="ph ph-chalkboard-teacher"></i><b>${esc(k.matkul)}</b><span>${k.mulai}${k.selesai ? '–' + k.selesai : ''}${k.batal ? ' · batal' : k.pengganti ? ' · pengganti' : ''}${k.ruang ? ' · ' + esc(k.ruang) : ''}</span></button>`).join('')}
      </div></div>`);
    }
    body = hari.length ? `<div class="agenda">${hari.join('')}</div>` : empty('calendar', 'Agenda kosong', 'Tidak ada kelas, tenggat, atau ujian di rentang ini.');
  }
  const sameMonth = y === tn.y && m === tn.m;
  const chip = (k, label) => `<button class="chip-toggle" data-cal-jenis="${k}" aria-pressed="${F[k]}">${label}</button>`;
  $('#content').innerHTML = `
    ${pageHead('calendar', `${BULAN_PANJANG[m]} ${y}`, 'Ketuk tanggal untuk melihat agenda hari itu. Titik berwarna = kelas, sesuai warna mata kuliah.', [[tot.kelas, 'Pertemuan'], [tot.tugas, 'Tenggat'], [tot.ujian, 'Ujian']],
      `<div class="cal-nav"><button class="icon-btn" data-cal-nav="-1" aria-label="Bulan sebelumnya"><i class="ph ph-caret-left"></i></button><button class="btn btn-secondary btn-sm" data-cal-nav="0" ${sameMonth ? 'disabled' : ''}>Bulan ini</button><button class="icon-btn" data-cal-nav="1" aria-label="Bulan berikutnya"><i class="ph ph-caret-right"></i></button></div>`)}
    <div class="toolbar"><div class="toolbar-left">
      <div class="segmented" role="group" aria-label="Tampilan"><button class="${F.mode === 'bulan' ? 'on' : ''}" data-cal-mode="bulan" aria-pressed="${F.mode === 'bulan'}"><i class="ph ph-calendar"></i> Bulan</button><button class="${F.mode === 'agenda' ? 'on' : ''}" data-cal-mode="agenda" aria-pressed="${F.mode === 'agenda'}"><i class="ph ph-list"></i> Agenda</button></div>
      <div class="chips">${chip('kelas', 'Kelas')}${chip('tugas', 'Tenggat')}${chip('ujian', 'Ujian')}</div>
      <label class="inline-field"><select id="calMk" aria-label="Filter mata kuliah"><option value="">Semua mata kuliah</option>${(S.data.matkul || []).map((x) => `<option ${fxSama(F.mk, x.nama) ? 'selected' : ''}>${esc(x.nama)}</option>`).join('')}</select></label>
    </div></div>
    <div class="card cal-card">${body}
      ${F.mode === 'bulan' ? '<div class="legend cal-legend"><span><i class="lg-dot"></i>Kelas</span><span><i class="ph-fill ph-exam"></i>Ujian</span><span><i class="ph ph-circle"></i>Tenggat</span><span><i class="ph ph-x-circle"></i>Batal</span><span><i class="ph ph-arrows-clockwise"></i>Pengganti</span><span><i class="lg-libur"></i>Libur</span></div>' : ''}</div>`;
  $('#calMk').onchange = (e) => { F.mk = e.target.value; viewKalender(); };
};

// ================= Jadwal: simpan sebagai gambar & geser blok di grid jam =================
function simpanJadwalPng() {
  const kelas = S.data.kelas; if (!kelas.length) return toast('Jadwal masih kosong.', 'error');
  const terang = document.documentElement.dataset.theme === 'terang';
  const C = terang ? { bg: '#f3f3f6', card: '#ffffff', teks: '#121216', sub: '#5b5b66', garis: 'rgba(0,0,0,.08)' } : { bg: '#0b0b0d', card: '#141417', teks: '#f5f5f7', sub: '#a1a1aa', garis: 'rgba(255,255,255,.08)' };
  const ada = (h) => kelas.some((k) => k.hari === h);
  const hari = [1, 2, 3, 4, 5, ...(ada(6) ? [6] : []), ...(ada(0) ? [0] : [])];
  const end = (k) => (k.selesai ? fxMenit(k.selesai) : fxMenit(k.mulai) + 100);
  const lo = Math.floor(Math.min(...kelas.map((k) => fxMenit(k.mulai))) / 60) * 60; const hi = Math.ceil(Math.max(...kelas.map(end)) / 60) * 60;
  const S2 = 2; const W = 1400; const top = 130; const left = 80; const colW = (W - left - 30) / hari.length; const px = Math.max(1.4, Math.min(2.4, 900 / (hi - lo))); const H = top + (hi - lo) * px + 70;
  const c = document.createElement('canvas'); c.width = W * S2; c.height = H * S2; const g = c.getContext('2d'); g.scale(S2, S2);
  const font = (wt, sz) => `${wt} ${sz}px Inter, system-ui, sans-serif`;
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  g.fillStyle = C.teks; g.font = font(700, 34); g.fillText('Jadwal Kuliah', left, 62);
  g.fillStyle = C.sub; g.font = font(500, 16); const s = S.data.semester || {};
  g.fillText(`Six Seven 67${s.mulai ? ` · Semester ${tgl(msOfYmd(s.mulai))} – ${s.selesai ? tgl(msOfYmd(s.selesai)) : ''}` : ''}`, left, 92);
  hari.forEach((h, i) => { g.fillStyle = C.sub; g.font = font(700, 14); g.fillText(HARI[h].toUpperCase(), left + i * colW + 8, top - 14); });
  for (let mnt = lo; mnt <= hi; mnt += 60) {
    const yy = top + (mnt - lo) * px; g.strokeStyle = C.garis; g.lineWidth = 1; g.beginPath(); g.moveTo(left, yy); g.lineTo(W - 30, yy); g.stroke();
    g.fillStyle = C.sub; g.font = font(500, 12); g.fillText(`${p2(mnt / 60)}.00`, 24, yy + 4);
  }
  const rr = (x, yy, w2, h2, r) => { g.beginPath(); g.moveTo(x + r, yy); g.arcTo(x + w2, yy, x + w2, yy + h2, r); g.arcTo(x + w2, yy + h2, x, yy + h2, r); g.arcTo(x, yy + h2, x, yy, r); g.arcTo(x, yy, x + w2, yy, r); g.closePath(); };
  hari.forEach((h, i) => {
    const list = kelas.filter((k) => k.hari === h).sort((a, b) => a.mulai.localeCompare(b.mulai)); const lanes = [];
    const pl = list.map((k) => { const s0 = fxMenit(k.mulai); const e0 = end(k); let li = lanes.findIndex((x) => x <= s0); if (li < 0) { li = lanes.length; lanes.push(e0); } else lanes[li] = e0; return { k, s0, e0, li }; });
    const nl = Math.max(1, lanes.length);
    for (const p of pl) {
      const x = left + i * colW + 4 + p.li * (colW - 8) / nl; const yy = top + (p.s0 - lo) * px + 2; const w2 = (colW - 8) / nl - 4; const h2 = Math.max(30, (p.e0 - p.s0) * px - 4);
      const warna = MK_WARNA[mkKey(p.k.matkul)];
      rr(x, yy, w2, h2, 10); g.fillStyle = warna + (terang ? '2a' : '33'); g.fill(); g.strokeStyle = warna; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = warna; g.fillRect(x, yy + 6, 4, h2 - 12);
      g.save(); g.beginPath(); g.rect(x, yy, w2, h2); g.clip();
      g.fillStyle = C.teks; g.font = font(700, 14); g.fillText(p.k.matkul, x + 12, yy + 22);
      g.fillStyle = C.sub; g.font = font(500, 12); g.fillText(`${p.k.mulai}${p.k.selesai ? '–' + p.k.selesai : ''}`, x + 12, yy + 40);
      if (p.k.ruang && h2 > 58) g.fillText(p.k.ruang, x + 12, yy + 56);
      g.restore();
    }
  });
  g.fillStyle = C.sub; g.font = font(500, 12); g.fillText(`Dibuat ${tgl(now())} · ${location.host}`, left, H - 26);
  c.toBlob((b) => { const u = URL.createObjectURL(b); const a = Object.assign(document.createElement('a'), { href: u, download: 'jadwal-kuliah.png' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); toast('Gambar jadwal diunduh.'); }, 'image/png');
}

// Geser blok kelas di grid jam: atas/bawah = jam (kelipatan 5 menit), kiri/kanan = hari.
function pasangDragGrid() {
  if (!canEdit() || S.jmode !== 'grid') return;
  for (const el of $$('.tblock')) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const body = el.closest('.tcol-body'); const px = Number(body.dataset.px); const lo = Number(body.dataset.lo);
      const k = S.data.kelas.find((x) => x.id === Number(el.dataset.id)); if (!k) return;
      const y0 = e.clientY; const x0 = e.clientX; let dragging = false; let target = { hari: k.hari, mulai: fxMenit(k.mulai) };
      const dur = (k.selesai ? fxMenit(k.selesai) : fxMenit(k.mulai) + 100) - fxMenit(k.mulai);
      const move = (ev) => {
        const dy = ev.clientY - y0; const dx = ev.clientX - x0;
        if (!dragging && Math.hypot(dx, dy) < 6) return;
        if (!dragging) { dragging = true; el.setPointerCapture(e.pointerId); el.classList.add('dragging'); }
        const dm = Math.round(dy / px / 5) * 5; const mulai = Math.max(0, Math.min(24 * 60 - dur, fxMenit(k.mulai) + dm));
        el.style.transform = `translate(${dx}px, ${(mulai - fxMenit(k.mulai)) * px}px)`;
        el.style.pointerEvents = 'none';
        const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tcol-body'); el.style.pointerEvents = '';
        target = { hari: col ? Number(col.dataset.hari) : k.hari, mulai };
        el.dataset.ghost = `${HARI[target.hari].slice(0, 3)} ${fxJam(mulai)}–${fxJam(mulai + dur)}`;
      };
      const up = async () => {
        el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        if (!dragging) return;
        el.addEventListener('click', (ce) => ce.stopPropagation(), { capture: true, once: true });
        const baru = { ...k, hari: target.hari, mulai: fxJam(target.mulai), selesai: k.selesai ? fxJam(target.mulai + dur) : null };
        if (baru.hari === k.hari && baru.mulai === k.mulai) { viewJadwal(); return; }
        try { await api(`/api/kelas/${k.id}`, { method: 'PUT', body: baru }); toast(`${k.matkul} dipindah ke ${HARI[baru.hari]} ${baru.mulai}.`); refresh(); }
        catch (err) { toast(err.message, 'error'); viewJadwal(); }
      };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  }
}
const fxViewJadwalAsli = viewJadwal;
viewJadwal = function viewJadwalBaru() { fxViewJadwalAsli(); pasangDragGrid(); };

// ================= Pengumuman & polling =================
const TEMPLATE = [
  ['Ruang pindah', 'Info: kelas *[mata kuliah]* hari ini pindah ke ruang *[ruang]*.'],
  ['Dosen telat', 'Info: dosen *[mata kuliah]* datang terlambat sekitar [x] menit. Tetap di kelas ya.'],
  ['Bawa alat', 'Jangan lupa besok bawa *[alat]* untuk *[mata kuliah]*.'],
  ['Materi baru', 'Materi *[mata kuliah]* pekan ini sudah ada: [link]'],
  ['Kumpul kelas', 'Kumpul kelas *[hari/jam]* di *[tempat]* untuk membahas [topik]. Mohon hadir semua.'],
];
async function loadPolling() { try { S.polling = (await api('/api/polling')).polling; if (S.view === 'pengumuman' && S.pgTab === 'polling') viewPengumuman(); } catch (e) { toast(e.message, 'error'); } }
const fxLoadPengumumanAsli = loadPengumuman;
loadPengumuman = async function () { await fxLoadPengumumanAsli(); if (S.pgTab === 'polling') loadPolling(); };

// Perkecil gambar di browser sebelum diunggah (maks 1600px, JPEG) supaya hemat kuota.
function kecilkanGambar(file, maks = 1600, kualitas = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const u = URL.createObjectURL(file);
    img.onload = () => {
      const sk = Math.min(1, maks / Math.max(img.width, img.height));
      const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * sk), height: Math.round(img.height * sk) });
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      resolve(c.toDataURL('image/jpeg', kualitas));
    };
    img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('File bukan gambar yang bisa dibaca')); };
    img.src = u;
  });
}

viewPengumuman = function viewPengumumanBaru() {
  const list = S.pengumuman;
  if (!list) { $('#content').innerHTML = '<div class="card muted">Memuat pengumuman…</div>'; return; }
  const tab = S.pgTab || 'pengumuman';
  const b = S.data.bot || {};
  const tabs = `<div class="segmented" role="tablist"><button class="${tab === 'pengumuman' ? 'on' : ''}" data-pg-tab="pengumuman" role="tab" aria-selected="${tab === 'pengumuman'}"><i class="ph ph-megaphone"></i> Pengumuman</button><button class="${tab === 'polling' ? 'on' : ''}" data-pg-tab="polling" role="tab" aria-selected="${tab === 'polling'}"><i class="ph ph-chart-bar"></i> Polling</button></div>`;
  const head = pageHead('megaphone', 'Pengumuman ke grup', 'Kirim info seperti link materi, ruang pindah, atau pengingat bawa alat. Bisa langsung, dijadwalkan, atau hanya disematkan di web.', [[list.filter((p) => p.status === 'terjadwal').length, 'Terjadwal'], [list.filter((p) => p.pin_sampai && p.pin_sampai > now()).length, 'Disematkan'], [list.filter((p) => p.status === 'terkirim').length, 'Terkirim']]);
  if (tab === 'polling') return viewPolling(head, tabs);
  const d = S.pDraft || {};
  $('#content').innerHTML = `${head}<div class="toolbar"><div class="toolbar-left">${tabs}</div></div>
    <div class="split">
      <form class="card" id="pgForm"><div class="card-head"><h2><i class="ph ph-pencil-simple-line"></i>Tulis pengumuman</h2></div>
        <div class="rows" style="gap:14px">
          <div class="chips" aria-label="Template">${TEMPLATE.map(([n], i) => `<button type="button" class="chip-toggle" data-template="${i}">${n}</button>`).join('')}</div>
          <label class="field"><span>Isi pesan</span><textarea name="teks" rows="7" maxlength="3000" required placeholder="Contoh: Besok kelas *Kalkulus* pindah ke R.204.">${esc(d.teks || '')}</textarea>
            <small class="muted">Format WhatsApp: *tebal*, _miring_. <span id="pgCount">${(d.teks || '').length}</span>/3000</small></label>
          <div class="field"><span>Gambar (opsional)</span>
            <div class="gambar-row">${d.gambar ? `<img src="${esc(d.gambar)}" alt="Pratinjau gambar" class="gambar-thumb"><button type="button" class="btn btn-secondary btn-sm" data-gambar-hapus><i class="ph ph-x"></i>Hapus</button>` : `<label class="btn btn-secondary btn-sm"><i class="ph ph-image"></i>Pilih gambar<input type="file" accept="image/*" id="pgGambar" hidden></label><small class="muted">Foto papan pengumuman, poster, dll.</small>`}</div></div>
          <div class="grid2"><label class="field"><span>Sematkan di dashboard</span><select name="pin_hari">${[[0, 'Tidak'], [1, '1 hari'], [3, '3 hari'], [7, '1 minggu'], [14, '2 minggu'], [30, '1 bulan']].map(([v, l]) => `<option value="${v}" ${Number(d.pin_hari || 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field" id="pgWaktuWrap" ${d.jadwal ? '' : 'hidden'}><span>Kirim pada (WIB)</span><input type="datetime-local" name="kirim_at" value="${esc(d.kirim_at || '')}"></label></div>
          <div class="chips"><label class="inline-field"><input type="checkbox" id="pgJadwal" ${d.jadwal ? 'checked' : ''}> Jadwalkan</label><label class="inline-field"><input type="checkbox" name="web_saja" id="pgWeb" ${d.web_saja ? 'checked' : ''}> Hanya tampil di web (tidak dikirim ke grup)</label></div>
          <p class="form-error" id="pgErr"></p>
          <div style="display:flex;justify-content:flex-end"><button class="btn btn-primary" id="pgSubmit"><i class="ph ph-paper-plane-tilt"></i><span>Kirim sekarang</span></button></div>
          ${b.wa && b.grup ? '' : '<p class="muted" style="margin:0;font-size:13px"><i class="ph ph-warning"></i> Bot sedang offline atau grup belum diatur. Pengumuman terjadwal tetap disimpan dan dikirim saat bot aktif (maks. 6 jam terlambat).</p>'}
        </div></form>
      <div class="stack">
        <div class="card"><div class="card-head"><h2><i class="ph ph-eye"></i>Pratinjau</h2></div>
          <div class="phone"><div class="phone-head"><span class="avatar"><i class="ph-fill ph-users-three"></i></span><div><b>Grup kelas</b><small>Bot Pengingat Kuliah</small></div></div>
            <div class="chat"><div class="bubble">${d.gambar ? `<img src="${esc(d.gambar)}" alt="" class="bubble-img">` : ''}<pre id="pgPreview">${waFormat(pengumumanText(d.teks || '…'))}</pre><small>${hm(now())}</small></div></div></div></div>
        <div class="card"><div class="card-head"><h2><i class="ph ph-clock-counter-clockwise"></i>Riwayat pengumuman</h2></div>
          <div class="rows">${list.length ? list.map((p) => { const pin = p.pin_sampai && p.pin_sampai > now(); return `<div class="row"><div class="grow"><div class="title pg-teks">${waFormat(p.teks)}</div>
            ${p.gambar ? `<img src="${esc(p.gambar)}" alt="" class="gambar-thumb sm" loading="lazy">` : ''}
            <div class="sub"><span>${p.status === 'terjadwal' ? 'Dijadwalkan ' : ''}${tgl(p.kirim_at)} · ${hm(p.kirim_at)}</span><span>oleh ${esc(p.oleh || '–')}</span>${pin ? `<span><i class="ph-fill ph-push-pin"></i> sampai ${tgl(p.pin_sampai)}</span>` : ''}${p.detail ? `<span>${esc(p.detail)}</span>` : ''}</div></div>
            ${badge(p.status === 'web' ? ['b-info', 'Hanya web'] : P_STATUS[p.status] || ['b-normal', p.status])}
            <button class="tiny-btn" data-pin="${p.id}" data-pin-on="${pin}" aria-label="${pin ? 'Lepas sematan' : 'Sematkan 7 hari'}" title="${pin ? 'Lepas sematan' : 'Sematkan 7 hari di dashboard'}"><i class="ph${pin ? '-fill' : ''} ph-push-pin"></i></button>
            ${['terjadwal', 'web'].includes(p.status) || isAdmin() ? `<button class="tiny-btn danger" data-del="pengumuman" data-id="${p.id}" aria-label="Hapus pengumuman"><i class="ph ph-trash"></i></button>` : ''}</div>`; }).join('')
            : empty('tray', 'Belum ada pengumuman', 'Pengumuman yang dikirim, dijadwalkan, atau disematkan akan muncul di sini.')}</div></div>
      </div></div>`;
  const f = $('#pgForm'); const ta = f.teks; const cb = $('#pgJadwal'); const web = $('#pgWeb');
  const label = () => { $('#pgSubmit span').textContent = web.checked ? 'Simpan & sematkan' : cb.checked ? 'Jadwalkan' : 'Kirim sekarang'; if (web.checked && f.pin_hari.value === '0') f.pin_hari.value = '7'; };
  const simpanDraft = () => { S.pDraft = { ...S.pDraft, teks: ta.value, pin_hari: f.pin_hari.value, jadwal: cb.checked, kirim_at: f.kirim_at.value, web_saja: web.checked }; };
  ta.oninput = () => { simpanDraft(); $('#pgCount').textContent = ta.value.length; $('#pgPreview').innerHTML = waFormat(pengumumanText(ta.value || '…')); };
  cb.onchange = () => { $('#pgWaktuWrap').hidden = !cb.checked; f.kirim_at.required = cb.checked; if (cb.checked && !f.kirim_at.value) { const t = w(now() + 3600e3); f.kirim_at.value = `${t.y}-${p2(t.m + 1)}-${p2(t.d)}T${p2(t.h)}:00`; } if (cb.checked) web.checked = false; simpanDraft(); label(); };
  web.onchange = () => { if (web.checked) { cb.checked = false; $('#pgWaktuWrap').hidden = true; } simpanDraft(); label(); };
  f.pin_hari.onchange = simpanDraft; f.kirim_at.onchange = simpanDraft; label();
  $('#pgGambar')?.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const data = await kecilkanGambar(file); const r = await api('/api/upload', { method: 'POST', body: { data } }); simpanDraft(); S.pDraft.gambar = r.path; viewPengumuman(); }
    catch (err) { toast(err.message, 'error'); }
  });
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!ta.value.trim()) { $('#pgErr').textContent = 'Isi pesan dulu.'; ta.focus(); return; }
    const btn = $('#pgSubmit'); btn.disabled = true;
    try {
      const r = await api('/api/pengumuman', { method: 'POST', body: { teks: ta.value, kirim_at: cb.checked ? f.kirim_at.value : '', pin_hari: Number(f.pin_hari.value), web_saja: web.checked, gambar: S.pDraft?.gambar || null } });
      S.pDraft = {}; toast(r.status === 'terjadwal' ? 'Pengumuman dijadwalkan.' : r.status === 'web' ? 'Pengumuman disematkan di dashboard.' : 'Pengumuman terkirim ke grup.');
      refresh();
    } catch (err) { $('#pgErr').textContent = err.message; }
    btn.disabled = false; loadPengumuman();
  };
};

function viewPolling(head, tabs) {
  const list = S.polling;
  const opsi = S.pollDraft?.opsi || ['', ''];
  $('#content').innerHTML = `${head}<div class="toolbar"><div class="toolbar-left">${tabs}</div></div>
    <div class="split">
      <form class="card" id="plForm"><div class="card-head"><h2><i class="ph ph-chart-bar"></i>Buat polling WhatsApp</h2></div>
        <div class="rows" style="gap:14px">
          <label class="field"><span>Pertanyaan</span><input name="pertanyaan" maxlength="255" required value="${esc(S.pollDraft?.pertanyaan || '')}" placeholder="Kuliah pengganti Kalkulus enaknya kapan?"></label>
          <div class="field"><span>Pilihan jawaban</span><div class="opsi-list">${opsi.map((o, i) => `<div class="opsi-row"><input data-opsi value="${esc(o)}" maxlength="100" placeholder="Pilihan ${i + 1}" aria-label="Pilihan ${i + 1}">${opsi.length > 2 ? `<button type="button" class="tiny-btn" data-opsi-del="${i}" aria-label="Hapus pilihan"><i class="ph ph-x"></i></button>` : ''}</div>`).join('')}</div>
            ${opsi.length < 12 ? `<button type="button" class="btn btn-secondary btn-sm" data-opsi-add style="justify-self:start">${PLUS}Tambah pilihan</button>` : ''}</div>
          <label class="inline-field"><input type="checkbox" name="ganda" ${S.pollDraft?.ganda ? 'checked' : ''}> Boleh memilih lebih dari satu</label>
          <p class="form-error" id="plErr"></p>
          <div style="display:flex;justify-content:flex-end"><button class="btn btn-primary" id="plSubmit"><i class="ph ph-paper-plane-tilt"></i>Kirim ke grup</button></div>
          <small class="muted">Polling dikirim sebagai polling WhatsApp asli. Hasilnya muncul di sini setiap ada anggota yang memilih.</small>
        </div></form>
      <div class="card"><div class="card-head"><h2><i class="ph ph-list-numbers"></i>Hasil polling</h2><button class="btn btn-secondary btn-sm" data-poll-muat><i class="ph ph-arrows-clockwise"></i>Muat ulang</button></div>
        <div class="rows">${!list ? '<p class="muted">Memuat…</p>' : list.length ? list.map((p) => {
          const total = p.hasil?.opsi?.reduce((a, o) => a + o.suara, 0) || 0; const maks = Math.max(1, ...(p.hasil?.opsi || []).map((o) => o.suara));
          return `<div class="poll"><div class="poll-head"><b>${esc(p.pertanyaan)}</b>${badge(p.status === 'terkirim' ? ['b-done', 'Terkirim'] : p.status === 'gagal' ? ['b-urgent', 'Gagal'] : ['b-normal', p.status])}<button class="tiny-btn danger" data-poll-del="${p.id}" aria-label="Hapus polling"><i class="ph ph-trash"></i></button></div>
            ${p.opsi.map((o) => { const s = p.hasil?.opsi?.find((x) => x.nama === o)?.suara || 0; return `<div class="poll-opsi" data-top="${s && s === maks}"><span>${esc(o)}</span><b>${s}</b><div class="bar"><i style="width:${total ? Math.round(s / total * 100) : 0}%"></i></div></div>`; }).join('')}
            <small class="muted">${p.hasil?.pemilih ? `${p.hasil.pemilih} orang memilih · diperbarui ${fxLalu(p.hasil.at)}` : 'Belum ada suara'}${p.ganda ? ' · pilihan ganda' : ''} · ${esc(p.oleh || '')}, ${tgl(p.dibuat)}</small></div>`;
        }).join('') : empty('tray', 'Belum ada polling', 'Buat polling untuk menentukan jadwal pengganti, ketua kelompok, dan lainnya.')}</div></div>
    </div>`;
  if (!list) loadPolling();
  const f = $('#plForm');
  const draft = () => { S.pollDraft = { pertanyaan: f.pertanyaan.value, opsi: $$('[data-opsi]', f).map((x) => x.value), ganda: f.ganda.checked }; };
  f.oninput = draft;
  f.onsubmit = async (e) => {
    e.preventDefault(); draft();
    const o = S.pollDraft.opsi.map((x) => x.trim()).filter(Boolean);
    if (o.length < 2) { $('#plErr').textContent = 'Isi minimal 2 pilihan.'; return; }
    $('#plSubmit').disabled = true;
    try { await api('/api/polling', { method: 'POST', body: { pertanyaan: S.pollDraft.pertanyaan, opsi: o, ganda: S.pollDraft.ganda } }); S.pollDraft = null; toast('Polling terkirim ke grup.'); }
    catch (err) { toast(err.message, 'error'); }
    loadPolling();
  };
}

// ================= Riwayat: filter & kembalikan =================
viewRiwayat = function viewRiwayatBaru() {
  const all = S.riwayat;
  if (!all) { $('#content').innerHTML = '<div class="card muted">Memuat riwayat…</div>'; return; }
  const F = (S.rwF ||= { orang: '', jenis: '' });
  const list = all.filter((x) => (S.rwFilter === 'semua' || x.aksi === S.rwFilter) && (!F.orang || x.oleh === F.orang) && (!F.jenis || x.jenis === F.jenis));
  const groups = []; for (const x of list) { const k = dayKey(x.at); const g = groups.at(-1); if (g && g.k === k) g.items.push(x); else groups.push({ k, ms: x.at, items: [x] }); }
  const seg = ['semua', 'tambah', 'ubah', 'hapus'].map((f) => `<button class="${S.rwFilter === f ? 'on' : ''}" data-rw="${f}" aria-pressed="${S.rwFilter === f}">${f[0].toUpperCase() + f.slice(1)}<em>${f === 'semua' ? all.length : all.filter((x) => x.aksi === f).length}</em></button>`).join('');
  const opsi = (arr, cur) => [...new Set(arr)].sort().map((x) => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
  $('#content').innerHTML = `
    ${pageHead('clock-counter-clockwise', 'Riwayat perubahan', 'Catatan siapa menambah, mengubah, atau menghapus data, dari web maupun WhatsApp. Data yang dihapus bisa dikembalikan selama 30 hari.', [[all.filter((x) => dayKey(x.at) === dayKey(now())).length, 'Hari ini'], [new Set(all.map((x) => x.oleh)).size, 'Orang'], [all.filter((x) => x.bisa_pulih).length, 'Bisa dikembalikan']])}
    <div class="toolbar"><div class="toolbar-left"><div class="segmented">${seg}</div>
      <label class="inline-field"><select id="rwOrang" aria-label="Filter orang"><option value="">Semua orang</option>${opsi(all.map((x) => x.oleh), F.orang)}</select></label>
      <label class="inline-field"><select id="rwJenis" aria-label="Filter jenis data"><option value="">Semua jenis</option>${opsi(all.map((x) => x.jenis), F.jenis)}</select></label></div></div>
    ${groups.length ? groups.map((g) => `<div class="card"><div class="card-head"><h2>${dayKey(g.ms) === dayKey(now()) ? 'Hari ini' : dayKey(g.ms) === dayKey(now() - DAY) ? 'Kemarin' : HARI[w(g.ms).dow]}</h2><span class="muted" style="font-size:13px">${tgl(g.ms)}</span></div>
      <div class="rows">${g.items.map((x) => { const [ic, tone, kata] = AKSI[x.aksi] || ['dot', '', x.aksi]; return `<div class="row"><span class="rw-ic" data-tone="${tone}"><i class="ph ph-${ic}"></i></span><div class="grow"><div class="title"><b>${esc(x.oleh)}</b> ${kata} ${esc(x.jenis)}</div>${x.ringkas ? `<div class="sub">${esc(x.ringkas)}</div>` : ''}</div>${x.bisa_pulih && canEdit() ? `<button class="btn btn-secondary btn-sm" data-pulih="${x.sampah_id}"><i class="ph ph-arrow-counter-clockwise"></i>Kembalikan</button>` : ''}<time class="muted" style="font-size:12px;font-family:var(--font-mono)">${hm(x.at)}</time></div>`; }).join('')}</div></div>`).join('')
      : `<div class="card">${empty('tray', 'Tidak ada riwayat', 'Coba ubah filter.')}</div>`}`;
  $('#rwOrang').onchange = (e) => { F.orang = e.target.value; viewRiwayat(); };
  $('#rwJenis').onchange = (e) => { F.jenis = e.target.value; viewRiwayat(); };
};

// ================= Akun: tambah massal, undangan, persetujuan =================
const fxLoadAkunAsli = loadAkun;
loadAkun = async function () {
  try { const first = !S.akun; const r = await api('/api/akun'); S.akun = r.akun; S.undangan = r.undangan; if (S.view === 'akun') (first ? enterAnim : (f) => f())(viewAkun); } catch (e) { toast(e.message, 'error'); }
};
viewAkun = function viewAkunBaru() {
  if (!S.akun) { $('#content').innerHTML = '<div class="card muted">Memuat akun…</div>'; return; }
  const aktif = S.akun.filter((a) => a.status === 'aktif'); const pending = S.akun.filter((a) => a.status === 'pending');
  const roleBadge = (r) => badge([r === 'admin' ? 'b-urgent' : r === 'editor' ? 'b-info' : 'b-normal', ROLE_LABEL[r]]);
  const und = S.undangan; const linkUnd = und ? `${location.origin}/daftar?kode=${und.kode}` : '';
  $('#content').innerHTML = `
    ${pageHead('users', 'Akun kelas', '<b>Admin</b> mengatur semuanya, <b>Editor</b> mengubah jadwal, tugas, dan ujian, <b>Anggota</b> melihat dan menandai progres sendiri.', [[aktif.length, 'Akun'], [aktif.filter((a) => a.wa).length, 'Punya nomor WA'], [aktif.filter((a) => a.terakhir && now() - a.terakhir < 7 * DAY).length, 'Aktif 7 hari'], [pending.length, 'Menunggu']],
      `<button class="btn btn-secondary" data-akun-massal><i class="ph ph-users-three"></i>Tambah sekaligus</button>${addBtn('akun', 'Tambah akun')}`)}
    ${pending.length ? `<div class="card" data-tone="warning"><div class="card-head"><h2><i class="ph ph-hourglass-medium"></i>Menunggu persetujuan</h2></div><div class="rows">${pending.map((a) => `<div class="row"><span class="avatar">${fxAvatar(a)}</span><div class="grow"><div class="title">${esc(a.nama)}</div><div class="sub">@${esc(a.username)}${a.wa ? ` · +${esc(a.wa)}` : ''}</div></div><button class="btn btn-primary btn-sm" data-setujui="${a.id}"><i class="ph ph-check"></i>Setujui</button><button class="btn btn-secondary btn-sm" data-del="akun" data-id="${a.id}">Tolak</button></div>`).join('')}</div></div>` : ''}
    <div class="card"><div class="card-head"><h2><i class="ph ph-link"></i>Link undangan</h2>${und ? '<button class="btn btn-secondary btn-sm" data-undangan="off">Matikan</button>' : ''}</div>
      ${und ? `<p class="muted" style="margin:0 0 10px">Bagikan link ini ke grup kelas. Pendaftar masuk daftar "Menunggu persetujuan" sampai kamu setujui.</p>
        <div class="copy-row"><input readonly id="undUrl" value="${esc(linkUnd)}" onfocus="this.select()" aria-label="Link undangan"><button type="button" class="btn btn-secondary btn-sm" data-copy="#undUrl"><i class="ph ph-copy"></i>Salin</button><button type="button" class="btn btn-secondary btn-sm" data-undangan="baru" title="Buat link baru (link lama berhenti)"><i class="ph ph-arrows-clockwise"></i>Ganti</button></div>`
        : `<p class="muted" style="margin:0 0 10px">Biarkan anggota mendaftar sendiri lewat link, lalu kamu tinggal menyetujui.</p><button class="btn btn-secondary btn-sm" data-undangan="baru"><i class="ph ph-link"></i>Buat link undangan</button>`}</div>
    <div class="card"><div class="rows">${aktif.map((a) => `<div class="row"><span class="avatar">${fxAvatar(a)}</span><div class="grow"><div class="title">${esc(a.nama)}${a.id === S.user.id ? ' <span class="muted">(kamu)</span>' : ''}</div>
      <div class="sub">@${esc(a.username)}${a.wa ? `<span><i class="ph ph-whatsapp-logo"></i> +${esc(a.wa)}${a.dm === 0 ? ' · DM mati' : ''}</span>` : '<span class="muted">tanpa nomor WA</span>'}<span>${a.terakhir ? `aktif ${fxLalu(a.terakhir)}` : 'belum pernah masuk'}</span></div></div>
      ${roleBadge(a.role)}<button class="tiny-btn" data-edit="akun" data-id="${a.id}" aria-label="Ubah ${esc(a.nama)}"><i class="ph ph-pencil-simple"></i></button>${a.id !== S.user.id ? `<button class="tiny-btn danger" data-del="akun" data-id="${a.id}" aria-label="Hapus ${esc(a.nama)}"><i class="ph ph-trash"></i></button>` : '<span style="width:30px"></span>'}</div>`).join('')}</div></div>`;
  muatGambarAuth($('#content'));
};
function bukaMassal() {
  bukaModal({
    eyebrow: 'Kelola akun', title: 'Tambah anggota sekaligus', draft: 'massal', ep: '/api/akun/massal',
    body: `<label class="field"><span>Daftar anggota</span><textarea name="teks" rows="10" required placeholder="Siti Rahma, 081234567890&#10;Budi Santoso, 0812 9876 5432&#10;Cici"></textarea>
        <small class="muted">Satu orang per baris: <b>Nama, nomor WA</b> (nomor boleh kosong). Bisa langsung tempel dari Excel/Google Sheets. Username dibuat otomatis; anggota masuk dengan mengirim <b>login</b> ke bot.</small></label>
      <label class="field"><span>Peran</span><select name="role">${['viewer', 'editor'].map((r) => `<option value="${r}">${ROLE_LABEL[r]}</option>`).join('')}</select></label>
      <label class="inline-field"><input type="checkbox" name="sambutan" checked> Kirim pesan sambutan + cara masuk lewat WhatsApp</label>`,
    onSubmit: async (fd) => {
      const r = await api('/api/akun/massal', { method: 'POST', body: { teks: fd.get('teks'), role: fd.get('role'), sambutan: fd.has('sambutan') } });
      $('#mBody').innerHTML = `<div class="hasil-massal"><p><b>${r.dibuat.length}</b> akun dibuat${r.disapa ? `, <b>${r.disapa}</b> disapa lewat WA` : ''}.</p>
        ${r.dibuat.length ? `<div class="rows">${r.dibuat.map((a) => `<div class="row"><div class="grow"><div class="title">${esc(a.nama)}</div><div class="sub">@${esc(a.username)}${a.wa ? ` · +${a.wa}` : ''}</div></div></div>`).join('')}</div>` : ''}
        ${r.gagal.length ? `<p class="form-error">Dilewati:<br>${r.gagal.map(esc).join('<br>')}</p>` : ''}</div>`;
      $('#mFoot').innerHTML = '<button type="button" class="btn btn-primary" data-close>Selesai</button>';
      editing = { detail: true }; loadAkun(); refresh();
    },
  });
}

// ================= Profil: tampilan, notifikasi, foto =================
const fxViewProfilAsli = viewProfil;
viewProfil = function viewProfilBaru() {
  fxViewProfilAsli();
  const tema = temaSekarang();
  const pushOk = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const kartu = document.createElement('div'); kartu.className = 'stack'; kartu.id = 'profilEkstra';
  kartu.innerHTML = `
    <div class="card"><div class="card-head"><h2><i class="ph ph-paint-brush"></i>Tampilan</h2></div>
      <div class="segmented" role="group" aria-label="Tema">${[['gelap', 'Gelap', 'moon'], ['terang', 'Terang', 'sun'], ['auto', 'Ikuti HP', 'device-mobile']].map(([v, l, i]) => `<button class="${tema === v ? 'on' : ''}" data-tema="${v}" aria-pressed="${tema === v}"><i class="ph ph-${i}"></i> ${l}</button>`).join('')}</div></div>
    <div class="card"><div class="card-head"><h2><i class="ph ph-bell-ringing"></i>Notifikasi</h2></div>
      <label class="toggle-row"><span><b>Pengingat pribadi lewat WhatsApp</b><small>Chat pribadi dari bot untuk tugas yang belum kamu kumpulkan (kalau admin menyalakannya).</small></span><label class="switch"><input type="checkbox" data-dm ${S.user.dm !== false ? 'checked' : ''}><span></span></label></label>
      <label class="toggle-row"><span><b>Notifikasi di perangkat ini</b><small>${pushOk ? 'Muncul di HP/laptop walau web tidak dibuka. Paling bagus setelah web di-install ke layar utama.' : 'Browser ini belum mendukung notifikasi push.'}</small></span><label class="switch"><input type="checkbox" data-push ${pushOk ? '' : 'disabled'}><span></span></label></label>
      <button type="button" class="btn btn-secondary btn-sm" data-push-tes hidden><i class="ph ph-paper-plane-tilt"></i>Kirim notifikasi tes</button></div>
    <div class="card"><div class="card-head"><h2><i class="ph ph-user-circle"></i>Foto profil</h2></div>
      <div class="foto-row"><span class="avatar big">${S.user.foto ? fxAvatar({ id: S.user.id, foto: true, nama: S.user.nama }) : esc(S.user.nama[0].toUpperCase())}</span>
        <label class="btn btn-secondary btn-sm"><i class="ph ph-camera"></i>${S.user.foto ? 'Ganti foto' : 'Pilih foto'}<input type="file" accept="image/*" id="fotoInput" hidden></label>
        ${S.user.foto ? '<button type="button" class="btn btn-secondary btn-sm" data-foto-del>Hapus</button>' : ''}</div></div>`;
  $('.profil-grid .stack')?.prepend(...kartu.children);
  // Susun ulang jadi kolom yang saling mengisi (bukan satu tumpukan panjang).
  const grid = $('.profil-grid');
  if (grid) {
    const [tampilan, notif, foto, izin, kalender, wa] = $$('.stack > .card', grid);
    grid.className = 'profil-cards';
    grid._kartu = [$('#profForm', grid), foto, tampilan, notif, kalender, wa, izin].filter(Boolean);
    grid.replaceChildren(...grid._kartu);
    susunProfil();
  }
  muatGambarAuth($('#content'));
  cekPush();
  $('#fotoInput')?.addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const data = await kecilkanGambar(f, 256, 0.82); await api('/api/auth/me', { method: 'PUT', body: { foto: data } }); S.user.foto = true; S.fotoVer = Date.now(); fxBlobCache.clear(); setUserChip(); viewProfil(); toast('Foto profil disimpan.'); }
    catch (err) { toast(err.message, 'error'); }
  });
};

// Profil: bagi kartu ke beberapa kolom (sesuai lebar) dengan tinggi seimbang,
// lalu kartu terakhir tiap kolom dipanjangkan supaya ujung bawah semua kolom rata.
function susunProfil() {
  const box = $('.profil-cards'); if (!box?._kartu) return;
  const n = box.clientWidth >= 980 ? 3 : box.clientWidth >= 600 ? 2 : 1;
  if (box._n === n) return; box._n = n;
  box.style.setProperty('--n', n);
  box.classList.add('menyusun');
  const cols = Array.from({ length: n }, () => Object.assign(document.createElement('div'), { className: 'pcol' }));
  box.replaceChildren(...cols);
  for (const c of box._kartu) cols.reduce((a, b) => (b.offsetHeight < a.offsetHeight ? b : a)).append(c);
  box.classList.remove('menyusun');
}
let fxTimerSusun;
window.addEventListener('resize', () => { clearTimeout(fxTimerSusun); fxTimerSusun = setTimeout(() => { if (S.view === 'profil') susunProfil(); }, 120); });

// Notifikasi push
const b64ke8 = (s) => { const p = '='.repeat((4 - s.length % 4) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
async function cekPush() {
  const cb = $('[data-push]'); if (!cb || cb.disabled) return;
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); cb.checked = !!sub && Notification.permission === 'granted'; $('[data-push-tes]').hidden = !cb.checked; } catch {}
}
async function aturPush(on) {
  const reg = await navigator.serviceWorker.ready;
  if (on) {
    if (await Notification.requestPermission() !== 'granted') throw new Error('Izin notifikasi ditolak. Aktifkan dari pengaturan browser.');
    const { key } = await api('/api/push/key');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ke8(key) });
    await api('/api/push/sub', { method: 'POST', body: { sub: sub.toJSON() } });
  } else {
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await api('/api/push/sub', { method: 'DELETE', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
  }
}

// ================= Status bot: antrean, grafik, pulihkan backup =================
const fxViewStatusAsli = viewStatus;
viewStatus = function viewStatusBaru() {
  fxViewStatusAsli();
  const s = S.status; if (!s || !s.antrean) return;
  const hari = Array.from({ length: 14 }, (_, i) => ymdOf(now() - (13 - i) * DAY));
  const data = hari.map((h) => ({ h, ok: s.harian.find((x) => x.hari === h && x.status === 'terkirim')?.n || 0, gagal: s.harian.find((x) => x.hari === h && x.status === 'gagal')?.n || 0 }));
  const maks = Math.max(1, ...data.map((d) => d.ok + d.gagal));
  const el = document.createElement('div'); el.className = 'split status-split';
  const totOk = data.reduce((a, x) => a + x.ok, 0); const totGagal = data.reduce((a, x) => a + x.gagal, 0);
  el.innerHTML = `<div class="card"><div class="card-head"><h2><i class="ph ph-queue"></i>Pesan berikutnya (24 jam)</h2></div>
      <div class="rows">${s.antrean.length ? s.antrean.map((x) => `<div class="row"><time class="antre-jam">${hm(x.at)}<small>${dayKey(x.at) === dayKey(now()) ? 'hari ini' : 'besok'}</small></time><div class="grow"><div class="title">${esc(x.judul)}</div><div class="sub">${LOG_MODE[x.mode] || esc(x.mode)}${x.n ? ` · ${x.n} orang` : ''}</div></div></div>`).join('')
        : '<p class="muted" style="margin:0">Tidak ada pesan otomatis dalam 24 jam ke depan.</p>'}</div>
      <p class="muted antre-foot"><i class="ph ph-info"></i> Perkiraan dari pengaturan Pengingat. Pengumuman manual tidak termasuk.</p></div>
    <div class="card"><div class="card-head"><div><h2><i class="ph ph-chart-bar"></i>Pesan per hari</h2><span class="muted" style="font-size:13px">14 hari terakhir · ${totOk} terkirim${totGagal ? ` · ${totGagal} gagal` : ''}</span></div></div>
      <div class="chart14" role="img" aria-label="Jumlah pesan 14 hari terakhir: ${totOk} terkirim, ${totGagal} gagal">${data.map((d) => `<div class="c14" data-hari-ini="${d.h === ymdOf(now())}" title="${tgl(msOfYmd(d.h))}: ${d.ok} terkirim, ${d.gagal} gagal"><b class="c14-n">${d.ok + d.gagal || ''}</b><div class="c14-bar"><i class="ok" style="height:${d.ok / maks * 100}%"></i><i class="gagal" style="height:${d.gagal / maks * 100}%"></i></div><span>${Number(d.h.slice(8))}</span></div>`).join('')}</div>
      <div class="legend c14-legend"><span><i class="lg-ok"></i>Terkirim</span><span><i class="lg-gagal"></i>Gagal</span><span class="muted"><i class="ph ph-device-mobile"></i>${s.push} perangkat menerima notifikasi push</span></div></div>`;
  const tiles = $$('#content > .tiles')[0]; tiles ? tiles.after(el) : $('#content').append(el);
  // Diagnosis: grup tujuan, pesan terakhir yang diterima, catatan error bot.
  const diag = document.createElement('div'); diag.className = 'card';
  const lamaDiam = s.pesanTerakhir ? now() - s.pesanTerakhir : null;
  diag.innerHTML = `<div class="card-head"><h2><i class="ph ph-stethoscope"></i>Diagnosis bot</h2><button class="btn btn-secondary btn-sm" data-ganti-grup><i class="ph ph-users-three"></i>Ganti grup tujuan</button></div>
    <div class="diag-grid">
      <div><small>Pesan bot dikirim ke</small><b>${s.tujuan?.mode === 'pribadi' ? `Nomor pribadi +${esc(s.tujuan.nomor)}` : esc(s.grupNama || s.grupJid || 'Grup belum diatur')}</b><button class="link-btn" data-ubah-tujuan style="justify-self:start">Ubah tujuan</button></div>
      <div><small>Pesan terakhir diterima bot</small><b>${s.pesanTerakhir ? fxLalu(s.pesanTerakhir) : 'belum ada sejak bot menyala'}</b></div>
      <div><small>Tersambung sejak</small><b>${s.sejak ? `${tgl(s.sejak)} · ${hm(s.sejak)}` : '–'}</b></div>
      <div><small>Penjadwal pengingat</small><b>${s.penjadwal?.terakhir ? `${now() - s.penjadwal.terakhir < 3 * 6e4 ? 'Aktif' : 'Macet'} · cek ${fxLalu(s.penjadwal.terakhir)}` : 'Belum berjalan'}</b>${s.penjadwal?.info && s.penjadwal.info !== 'berjalan normal' ? `<small>${esc(s.penjadwal.info)}</small>` : ''}</div>
    </div>
    ${!s.wa ? '<p class="diag-tip" data-tone="danger"><i class="ph-fill ph-warning-circle"></i><span>Bot tidak tersambung ke WhatsApp. Kalau lebih dari beberapa menit, kemungkinan sesi WA ter-logout: perlu scan QR ulang di VPS (lihat README).</span></p>'
      : lamaDiam == null || lamaDiam > 30 * 6e4 ? '<p class="diag-tip" data-tone="warning"><i class="ph ph-info"></i><span>Bot tersambung tapi belum menerima pesan baru. Di grup yang baru dimasuki, WhatsApp kadang butuh beberapa menit sebelum bot bisa membaca pesan anggota. Coba kirim <b>/menu</b> lagi, atau chat pribadi ke nomor bot.</span></p>' : ''}
    <div class="rows">${s.catatan?.length ? s.catatan.map((c) => `<div class="row"><span class="badge ${c.level === 'error' ? 'b-urgent' : 'b-warn'}">${c.level === 'error' ? 'Error' : 'Peringatan'}</span><div class="grow"><div class="title" style="font-family:var(--font-mono);font-size:12.5px">${esc(c.pesan)}</div><div class="sub">${tgl(c.at)} · ${hm(c.at)}</div></div></div>`).join('') : '<p class="muted" style="margin:0">Tidak ada error sejak bot terakhir menyala.</p>'}</div>`;
  $('#content .page-head').after(diag);
  if (s.tujuan?.mode === 'pribadi') {
    const w2 = document.createElement('div'); w2.className = 'card diag-tip'; w2.dataset.tone = 'warning';
    w2.innerHTML = `<i class="ph-fill ph-user-focus"></i><span><b>Mode nomor pribadi aktif.</b> Semua pesan otomatis bot (pengingat, pengumuman, polling, info perubahan) dikirim ke <b>+${esc(s.tujuan.nomor)}</b>, grup kelas tidak menerima apa pun. <button class="link-btn" data-ubah-tujuan>Ubah</button></span>`;
    $('#content .page-head').after(w2);
  }
};
async function bukaTujuan() {
  const r = await api('/api/status/tujuan'); const t = r.tujuan || {};
  bukaModal({
    eyebrow: 'Status bot', title: 'Tujuan pesan bot',
    body: `<label class="pilih-tujuan"><input type="radio" name="mode" value="grup" ${t.mode !== 'pribadi' ? 'checked' : ''}><span><b>Grup kelas</b><small>Normal: pengingat dan pengumuman masuk ke grup.</small></span></label>
      <label class="pilih-tujuan"><input type="radio" name="mode" value="pribadi" ${t.mode === 'pribadi' ? 'checked' : ''}><span><b>Nomor pribadi saja</b><small>Semua pesan otomatis dikirim ke satu nomor, grup tidak menerima apa pun. Cocok untuk uji coba.</small></span></label>
      <label class="field" id="tujuanNomor"><span>Nomor WhatsApp tujuan</span><input name="nomor" type="tel" inputmode="tel" value="${esc(t.nomor ? '+' + t.nomor : r.saran ? '+' + r.saran : '')}" placeholder="081234567890"><small class="muted">Bisa juga lewat WA: kirim <b>/kirimkesini</b> ke bot dari chat pribadi, dan <b>/kegrup</b> untuk kembali.</small></label>`,
    onOpen: () => { const sync = () => { $('#tujuanNomor').hidden = $('#mBody input[name=mode]:checked').value !== 'pribadi'; }; $$('#mBody input[name=mode]').forEach((x) => x.addEventListener('change', sync)); sync(); },
    onSubmit: async (fd) => {
      const x = await api('/api/status/tujuan', { method: 'POST', body: { mode: fd.get('mode'), nomor: fd.get('nomor') } });
      $('#modal').close(); toast(x.tujuan.mode === 'pribadi' ? `Semua pesan bot dikirim ke +${x.tujuan.nomor}.` : 'Pesan bot kembali ke grup kelas.');
      S.status = null; viewStatus(); loadStatus();
    },
  });
}
async function bukaGantiGrup() {
  bukaModal({ eyebrow: 'Status bot', title: 'Pilih grup tujuan', body: '<p class="muted">Memuat daftar grup yang diikuti bot…</p>', foot: '<button type="button" class="btn btn-secondary" data-close>Tutup</button>' });
  try {
    const r = await api('/api/status/grup');
    $('#mBody').innerHTML = `${r.grup.length ? `<div class="rows">${r.grup.map((g) => `<button type="button" class="row clickable grup-pilih" data-pakai-grup="${esc(g.jid)}" aria-pressed="${g.jid === r.aktif}"><i class="ph${g.jid === r.aktif ? '-fill ph-check-circle' : ' ph-users-three'}"></i><div class="grow"><div class="title">${esc(g.nama)}</div><div class="sub">${g.anggota} anggota${g.jid === r.aktif ? ' · grup tujuan sekarang' : ''}</div></div></button>`).join('')}</div>`
      : '<p class="muted">Bot belum masuk grup mana pun. Tambahkan nomor bot ke grup kelas dulu.</p>'}
      <small class="muted">Grup tidak ada di daftar? Pastikan nomor bot sudah dimasukkan ke grup itu. Bisa juga dengan mengetik <b>/pakaigrup</b> di grup tersebut (khusus admin).</small><p class="form-error" id="mErr"></p>`;
  } catch (err) { $('#mBody').innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }
}
const fxBackupCardAsli = backupCard;
backupCard = function () {
  const html = fxBackupCardAsli();
  return html.replace(/<button class="tiny-btn" data-backup-dl="([^"]+)"/g, '<button class="tiny-btn" data-backup-pulih="$1" aria-label="Pulihkan dari backup ini" title="Pulihkan database dari backup ini"><i class="ph ph-arrow-counter-clockwise"></i></button><button class="tiny-btn" data-backup-dl="$1"');
};

// ================= Klik untuk fitur tambahan =================
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-ubah-tujuan],[data-ganti-grup],[data-pakai-grup],[data-semester],[data-png],[data-absen],[data-absen-semua],[data-materi-del],[data-kelompok-edit],[data-bagi-acak],[data-add-tugas-on],[data-add-ujian-on],[data-add-kelas-mk],[data-add-tugas-mk],[data-add-ujian-mk],[data-pin],[data-pg-tab],[data-template],[data-gambar-hapus],[data-opsi-add],[data-opsi-del],[data-poll-del],[data-poll-muat],[data-pulih],[data-akun-massal],[data-setujui],[data-undangan],[data-tema],[data-push-tes],[data-foto-del],[data-jeda-off],[data-cal-mode],[data-cal-jenis],[data-libur-add],[data-libur-del],[data-backup-pulih],[data-filter-set]');
  if (!el) return;
  const d = el.dataset;
  try {
    if ('ubahTujuan' in d) return bukaTujuan();
    if ('gantiGrup' in d) return bukaGantiGrup();
    if ('pakaiGrup' in d) { await api('/api/status/grup', { method: 'POST', body: { jid: d.pakaiGrup } }); $('#modal').close(); toast('Grup tujuan diganti.'); S.status = null; viewStatus(); return loadStatus(); }
    if ('semester' in d) return bukaSemester();
    if ('png' in d) return simpanJadwalPng();
    if ('absen' in d) {
      const [tanggal, key] = d.absen.split('|'); const tidak = el.getAttribute('aria-pressed') === 'true';
      await api('/api/absen', { method: 'POST', body: { tanggal, kelas_key: key, v: tidak } });
      const set = new Set(S.data.saya.absen); tidak ? set.add(d.absen) : set.delete(d.absen); S.data.saya.absen = [...set];
      return viewMatkulDetail();
    }
    if ('absenSemua' in d) { S.absenSemua = true; return viewMatkulDetail(); }
    if ('materiDel' in d) { if (!(await askConfirm('Hapus materi ini?', 'Bisa dikembalikan dari menu Riwayat.'))) return; await api(`/api/materi/${d.materiDel}`, { method: 'DELETE' }); toast('Materi dihapus.'); return refresh(); }
    if ('kelompokEdit' in d) return bukaKelompok(Number(d.kelompokEdit));
    if ('bagiAcak' in d) {
      const n = Math.max(2, Number($('#ukGrup').value) || 4); const orang = [...(S.data.orang || [])].sort(() => Math.random() - 0.5);
      const g = []; for (let i = 0; i < orang.length; i += n) g.push(`Kelompok ${g.length + 1}: ${orang.slice(i, i + n).map((o) => o.nama).join(', ')}`);
      $('#mBody textarea[name=teks]').value = g.join('\n'); return;
    }
    if ('addTugasOn' in d) { $('#modal').close(); return openForm('tugas', null, { deadline: `${d.addTugasOn} 23:59` }); }
    if ('addUjianOn' in d) { $('#modal').close(); return openForm('ujian', null, { waktu: `${d.addUjianOn} 08:00`, jenis: 'UTS' }); }
    if ('addKelasMk' in d) return openForm('kelas', null, { hari: 1, matkul: d.addKelasMk });
    if ('addTugasMk' in d) return openForm('tugas', null, { matkul: d.addTugasMk });
    if ('addUjianMk' in d) return openForm('ujian', null, { matkul: d.addUjianMk });
    if ('pin' in d) { await api(`/api/pengumuman/${d.pin}/pin`, { method: 'PUT', body: { hari: d.pinOn === 'true' ? 0 : 7 } }); toast(d.pinOn === 'true' ? 'Sematan dilepas.' : 'Disematkan 7 hari di dashboard.'); refresh(); return loadPengumuman(); }
    if ('pgTab' in d) { S.pgTab = d.pgTab; viewPengumuman(); if (d.pgTab === 'polling') loadPolling(); return; }
    if ('template' in d) { const ta = $('#pgForm textarea'); ta.value = TEMPLATE[Number(d.template)][1]; ta.dispatchEvent(new Event('input')); ta.focus(); return; }
    if ('gambarHapus' in d) { S.pDraft.gambar = null; return viewPengumuman(); }
    if ('opsiAdd' in d) { S.pollDraft = { ...(S.pollDraft || {}), opsi: [...$$('[data-opsi]').map((x) => x.value), ''] , pertanyaan: $('#plForm').pertanyaan.value, ganda: $('#plForm').ganda.checked }; viewPengumuman(); return $$('[data-opsi]').at(-1).focus(); }
    if ('opsiDel' in d) { const o = $$('[data-opsi]').map((x) => x.value); o.splice(Number(d.opsiDel), 1); S.pollDraft = { ...(S.pollDraft || {}), opsi: o }; return viewPengumuman(); }
    if ('pollDel' in d) { if (!(await askConfirm('Hapus polling ini dari daftar?', 'Polling di grup WhatsApp tidak ikut terhapus.'))) return; await api(`/api/polling/${d.pollDel}`, { method: 'DELETE' }); return loadPolling(); }
    if ('pollMuat' in d) return loadPolling();
    if ('pulih' in d) return pulihkan(Number(d.pulih));
    if ('akunMassal' in d) return bukaMassal();
    if ('setujui' in d) { await api(`/api/akun/${d.setujui}/setujui`, { method: 'POST' }); toast('Pendaftaran disetujui.'); return loadAkun(); }
    if ('undangan' in d) {
      if (d.undangan === 'baru' && S.undangan && !(await askConfirm('Buat link undangan baru?', 'Link lama berhenti bekerja.', 'Buat baru'))) return;
      S.undangan = (await api('/api/undangan', { method: 'POST', body: { aktif: d.undangan !== 'off' } })).undangan; return viewAkun();
    }
    if ('tema' in d) { terapkanTema(d.tema); return viewProfil(); }
    if ('pushTes' in d) { const r = await api('/api/push/tes', { method: 'POST' }); return toast(r.terkirim ? 'Notifikasi tes dikirim.' : 'Belum ada perangkat yang berlangganan.', r.terkirim ? 'success' : 'error'); }
    if ('fotoDel' in d) { await api('/api/auth/me', { method: 'PUT', body: { foto: null } }); S.user.foto = false; setUserChip(); return viewProfil(); }
    if ('jedaOff' in d) { $('#pForm [name="jeda.sampai"]').value = ''; return $('#pForm').requestSubmit(); }
    if ('calMode' in d) { S.calF.mode = d.calMode; return viewKalender(); }
    if ('calJenis' in d) { S.calF[d.calJenis] = !S.calF[d.calJenis]; return viewKalender(); }
    if ('liburAdd' in d) { $('#liburRows').insertAdjacentHTML('beforeend', bukaSemester.baris()); return $$('#liburRows [data-l=nama]').at(-1).focus(); }
    if ('liburDel' in d) return el.closest('.libur-row').remove();
    if ('backupPulih' in d) {
      if (!(await askConfirm('Pulihkan database dari backup ini?', `Semua data kembali seperti saat backup ${d.backupPulih} dibuat. Kondisi sekarang disimpan dulu sebagai backup baru. Bot akan restart sekitar 10 detik.`, 'Pulihkan'))) return;
      await api(`/api/backup/${encodeURIComponent(d.backupPulih)}/pulihkan`, { method: 'POST' });
      toast('Memulihkan… halaman dimuat ulang sebentar lagi.'); setTimeout(() => location.reload(), 12000); return;
    }
    if ('filterSet' in d) { S.filter = d.filterSet; setTimeout(() => viewTugas(), 0); }
  } catch (err) { toast(err.message, 'error'); }
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  try {
    if (t.matches('[data-centang]')) {
      const [jenis, id, idx] = t.dataset.centang.split('|');
      await api('/api/centang', { method: 'POST', body: { jenis, ref_id: Number(id), idx: Number(idx), v: t.checked } });
      const k = `${jenis}:${id}`; const set = new Set(S.data.saya.centang[k] || []); t.checked ? set.add(Number(idx)) : set.delete(Number(idx)); S.data.saya.centang[k] = [...set];
      const box = t.closest('.ck-box'); const all = $$('input', box); const n = all.filter((x) => x.checked).length;
      $('.ck-head span', box).textContent = `${n}/${all.length}`; $('.bar i', box).style.width = `${Math.round(n / all.length * 100)}%`;
    }
    if (t.matches('[data-dm]')) { await api('/api/auth/me', { method: 'PUT', body: { dm: t.checked } }); S.user.dm = t.checked; toast(t.checked ? 'Pengingat pribadi WA aktif.' : 'Pengingat pribadi WA dimatikan.'); }
    if (t.matches('[data-push]')) { await aturPush(t.checked); $('[data-push-tes]').hidden = !t.checked; toast(t.checked ? 'Notifikasi aktif di perangkat ini.' : 'Notifikasi dimatikan.'); }
  } catch (err) { toast(err.message, 'error'); if (t.type === 'checkbox') t.checked = !t.checked; }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.cal-cell, .tblock')) e.target.click(); });

// ================= Keterangan tanggal dalam bahasa Indonesia =================
// Kolom tanggal bawaan browser mengikuti bahasa HP (bisa "mm/dd/yyyy"),
// jadi di bawahnya ditampilkan tanggal yang terbaca jelas: "Senin, 24 Agustus 2026".
function teksTanggal(input) {
  const v = input.value; if (!v) return '';
  if (input.type === 'time') return '';
  const [tg, jam] = v.split('T'); const [y, m, d] = tg.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${HARI[dow]}, ${d} ${BULAN_PANJANG[m - 1]} ${y}${jam ? ` · ${jam.slice(0, 5)} WIB` : ''}`;
}
function pasangInfoTanggal(root = document) {
  if (!root) return;
  for (const inp of root.querySelectorAll('.field > input[type="date"], .field > input[type="datetime-local"]')) {
    let info = inp.nextElementSibling?.classList.contains('tgl-info') ? inp.nextElementSibling : null;
    if (!info) { info = Object.assign(document.createElement('small'), { className: 'tgl-info' }); info.setAttribute('aria-live', 'polite'); inp.after(info); }
    const t = teksTanggal(inp); if (info.textContent !== t) info.textContent = t; // hindari perulangan observer
  }
}
document.addEventListener('input', (e) => { if (e.target.matches?.('input[type="date"], input[type="datetime-local"]')) pasangInfoTanggal(e.target.parentElement); });
document.addEventListener('change', (e) => { if (e.target.matches?.('input[type="date"], input[type="datetime-local"]')) pasangInfoTanggal(e.target.parentElement); });
new MutationObserver(() => pasangInfoTanggal($('#mBody'))).observe($('#mBody'), { childList: true, subtree: true });

// ================= Draf otomatis =================
// Isian form disimpan di perangkat ini saat diketik. Kalau modal tertutup tidak sengaja,
// halaman ter-refresh, atau HP mati, isian muncul lagi saat form dibuka. Draf dihapus begitu data tersimpan.
const DRAF_UMUR = 14 * DAY;
const kunciDraf = (k) => `ss67:draf:${S.user?.id || 0}:${k}`;
function bacaDraft(k) {
  try { const d = JSON.parse(localStorage.getItem(kunciDraf(k)) || 'null'); if (!d || Date.now() - d.at > DRAF_UMUR) return null; return d; } catch { return null; }
}
function tulisDraft(k, data) { try { localStorage.setItem(kunciDraf(k), JSON.stringify({ at: Date.now(), data })); } catch { /* penyimpanan penuh/diblokir */ } }
function hapusDraft(k) { try { localStorage.removeItem(kunciDraf(k)); } catch {} }

// Ambil & isi nilai form (password, file, dan field tersembunyi tidak ikut disimpan).
function ambilNilaiForm(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || ['password', 'file', 'hidden', 'submit', 'button'].includes(el.type) || el.disabled) continue;
    if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; continue; }
    o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  const rows = form.querySelector('#liburRows');
  if (rows) o.__libur = $$('.libur-row', rows).map((r) => ({ nama: $('[data-l=nama]', r).value, dari: $('[data-l=dari]', r).value, sampai: $('[data-l=sampai]', r).value }));
  const opsi = $$('[data-opsi]', form); if (opsi.length) o.__opsi = opsi.map((x) => x.value);
  return o;
}
const drafKosong = (o) => !Object.entries(o).some(([k, v]) => (k === '__libur' ? v.some((x) => x.nama || x.dari) : k === '__opsi' ? v.some(Boolean) : typeof v === 'string' && v.trim() && !['hari', 'prioritas', 'jenis', 'role', 'pin_hari', 'warna', '__target'].includes(k)));
function isiNilaiForm(form, o) {
  if (o.__libur && form.querySelector('#liburRows') && bukaSemester.baris) form.querySelector('#liburRows').innerHTML = o.__libur.map(bukaSemester.baris).join('');
  for (const [n, v] of Object.entries(o)) {
    if (n.startsWith('__')) continue;
    const el = form.elements.namedItem(n); if (!el) continue;
    if (el instanceof RadioNodeList) { for (const x of el) x.checked = x.value === v; continue; }
    if (el.type === 'password' || el.type === 'file') continue;
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Tugas berulang: kotak "Ulangi tiap minggu" ikut dicentang kalau tanggal ulang terisi.
  const cb = form.querySelector('[data-ulang-cb]');
  if (cb && form.elements.namedItem('ulang')?.value) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
}

// --- Draf di modal ---
let fxDraft = null; let fxDraftTimer = null;
function mulaiDraftModal(key, ep, bukaUlang) {
  const form = $('#modalForm');
  fxDraft = { key, ep, awal: JSON.stringify(ambilNilaiForm(form)) };
  const d = bacaDraft(key);
  if (d && !drafKosong(d.data) && JSON.stringify(d.data) !== fxDraft.awal) {
    isiNilaiForm(form, d.data);
    const b = document.createElement('div'); b.className = 'draft-banner'; b.setAttribute('role', 'status');
    b.innerHTML = `<i class="ph ph-clock-counter-clockwise"></i><span>Isian yang belum disimpan (${fxLalu(d.at)}) dipulihkan.</span><button type="button" class="link-btn" data-draf-buang>Buang draf</button>`;
    $('#mBody').prepend(b);
    b.querySelector('[data-draf-buang]').onclick = () => { hapusDraft(key); fxDraft = null; bukaUlang(); };
  }
  const st = document.createElement('span'); st.className = 'draft-status'; st.id = 'drafStatus'; st.setAttribute('aria-live', 'polite');
  $('#mFoot').prepend(st);
}
function simpanDraftModal() {
  clearTimeout(fxDraftTimer); fxDraftTimer = null;
  if (!fxDraft || !$('#modal').open) return;
  const o = ambilNilaiForm($('#modalForm'));
  if (drafKosong(o) || JSON.stringify(o) === fxDraft.awal) { hapusDraft(fxDraft.key); return; }
  tulisDraft(fxDraft.key, o);
  const st = $('#drafStatus'); if (st) st.innerHTML = '<i class="ph ph-check-circle"></i> Draf tersimpan otomatis';
}
for (const ev of ['input', 'change']) $('#modalForm').addEventListener(ev, () => { if (!fxDraft) return; clearTimeout(fxDraftTimer); fxDraftTimer = setTimeout(simpanDraftModal, 400); });
// Modal ditutup tanpa disimpan: simpan dulu isian terakhir (tidak menunggu jeda ketik).
$('#modal').addEventListener('close', () => { if (fxDraftTimer) simpanDraftModal(); fxDraft = null; });

// Form tambah/ubah dari app.js (tugas, ujian, jadwal, mata kuliah, akun, kelas batal, pengganti).
const fxOpenFormAsli = openForm;
openForm = function (type, id, preset) {
  fxOpenFormAsli(type, id, preset);
  // Isian bawaan (mis. "+ Jadwal" dari halaman mata kuliah) punya draf sendiri supaya tidak tertimpa draf lain.
  const asal = !id && preset ? `:${preset.matkul || preset.tanggal || preset.kelas_id || preset.deadline || preset.waktu || ''}` : '';
  mulaiDraftModal(`${type}:${id || 'baru'}${asal}`, `/api/${endpointOf(type)}${id ? '/' + id : ''}`, () => openForm(type, id, preset));
};

// Draf dihapus otomatis begitu data berhasil tersimpan ke server.
const fxApiAsli = api;
api = async function (path, opts = {}) {
  const res = await fxApiAsli(path, opts);
  const m = (opts.method || 'GET').toUpperCase();
  if (m !== 'GET' && fxDraft && (path === fxDraft.ep || path.startsWith(fxDraft.ep + '?'))) { clearTimeout(fxDraftTimer); fxDraftTimer = null; hapusDraft(fxDraft.key); fxDraft = null; }
  return res;
};

// --- Draf form di halaman (form[data-draft]) ---
function pulihkanFormHalaman() {
  for (const f of $$('form[data-draft]')) { const d = bacaDraft(f.dataset.draft); if (d) isiNilaiForm(f, d.data); }
}
let fxHalTimer;
document.addEventListener('input', (e) => {
  const f = e.target.closest?.('form[data-draft]'); if (!f) return;
  clearTimeout(fxHalTimer); fxHalTimer = setTimeout(() => { const o = ambilNilaiForm(f); drafKosong(o) ? hapusDraft(f.dataset.draft) : tulisDraft(f.dataset.draft, o); }, 400);
});

// --- Draf pengumuman & polling (disimpan di S.pDraft / S.pollDraft) ---
let fxDrafPg = ''; let fxDrafPl = '';
function muatDrafHalaman() {
  if (!S.pDraft) S.pDraft = bacaDraft('pengumuman')?.data || {};
  if (!S.pollDraft) S.pollDraft = bacaDraft('polling')?.data || null;
  fxDrafPg = JSON.stringify(S.pDraft); fxDrafPl = JSON.stringify(S.pollDraft);
}
setInterval(() => {
  if (!S.user) return;
  if (fxDrafPg === '' && fxDrafPl === '') return muatDrafHalaman();
  const pg = JSON.stringify(S.pDraft || {}); const pl = JSON.stringify(S.pollDraft || null);
  if (pg !== fxDrafPg) { fxDrafPg = pg; (!S.pDraft?.teks && !S.pDraft?.gambar) ? hapusDraft('pengumuman') : tulisDraft('pengumuman', S.pDraft); }
  if (pl !== fxDrafPl) { fxDrafPl = pl; (!S.pollDraft || (!S.pollDraft.pertanyaan && !(S.pollDraft.opsi || []).some(Boolean))) ? hapusDraft('polling') : tulisDraft('polling', S.pollDraft); }
}, 1000);
window.addEventListener('pagehide', () => { try { if (S.pDraft?.teks) tulisDraft('pengumuman', S.pDraft); if (S.pollDraft?.pertanyaan) tulisDraft('polling', S.pollDraft); if (fxDraftTimer) simpanDraftModal(); } catch {} });
const fxLoadPgDraf = loadPengumuman;
loadPengumuman = async function () { if (fxDrafPg === '') muatDrafHalaman(); return fxLoadPgDraf(); };

// ================= Autosave: pengaturan pengingat, profil, dan pilihan tampilan tiap menu =================
// Pengingat: setiap perubahan langsung disimpan ke server (tanpa harus menekan tombol).
let fxPTimer;
for (const ev of ['change', 'input']) {
  document.addEventListener(ev, (e) => {
    const f = e.target.closest?.('#pForm'); if (!f) return;
    if (ev === 'input' && e.target.type !== 'number') return; // jam/tanggal & centang sudah memicu "change"
    const st = $('#pStatus'); if (st) st.textContent = 'Menyimpan…';
    clearTimeout(fxPTimer); fxPTimer = setTimeout(() => { if (!$('#pForm')) return; S.pAuto = true; $('#pForm').requestSubmit(); }, 700);
  });
}

// Profil: nama disimpan sebagai draf (password tidak pernah disimpan).
const fxViewProfilDraf = viewProfil;
viewProfil = function () { fxViewProfilDraf(); const f = $('#profForm'); if (f) { f.dataset.draft = 'profil'; pulihkanFormHalaman(); } };
const fxApiProfil = api;
api = async function (path, opts = {}) {
  const res = await fxApiProfil(path, opts);
  if (path === '/api/auth/me' && (opts.method || '').toUpperCase() === 'PUT' && opts.body && 'nama' in opts.body) hapusDraft('profil');
  return res;
};

// Pilihan tampilan diingat di perangkat ini: filter tugas, kalender, riwayat, tab, rentang dashboard, target nilai.
const UI_KUNCI = ['filter', 'calF', 'cal', 'rwFilter', 'rwF', 'dashScope', 'pgTab', 'target'];
(function pulihkanUi() {
  try {
    const u = JSON.parse(localStorage.getItem('ss67:ui') || 'null'); if (!u) return;
    for (const k of UI_KUNCI) if (u[k] != null) S[k] = u[k];
    if (u.previewTab) previewTab = u.previewTab;
    // Bulan kalender yang tersimpan hanya dipakai kalau masih bulan yang sama dengan sekarang atau lebih baru.
    if (S.cal) { const t = w(Date.now()); if (S.cal.y * 12 + S.cal.m < t.y * 12 + t.m) S.cal = null; }
    if (S.dashScope === 'day') { S.dashScope = 'today'; S.dashDay = null; }
  } catch {}
})();
let fxUiTerakhir = '';
setInterval(() => {
  try {
    const u = Object.fromEntries(UI_KUNCI.map((k) => [k, S[k] ?? null])); u.previewTab = previewTab;
    const s = JSON.stringify(u); if (s !== fxUiTerakhir) { fxUiTerakhir = s; localStorage.setItem('ss67:ui', s); }
  } catch {}
}, 1500);

// ================= Tata letak dua kolom: seimbang & rata bawah =================
// Status Bot: riwayat pengiriman diringkas, kartu backup pindah ke kolom kanan.
const fxViewStatusRata = viewStatus;
viewStatus = function () {
  fxViewStatusRata();
  const rw = $$('#content .card').find((c) => /Riwayat pengiriman/.test(c.querySelector('h2')?.textContent || ''));
  if (rw) {
    const rows = $$('.rows > .row', rw);
    if (rows.length > 8 && !S.logSemua) {
      rows.slice(8).forEach((r) => { r.hidden = true; });
      rw.querySelector('.rows').insertAdjacentHTML('afterend', `<button class="ghost-btn" data-log-semua>Tampilkan semua ${rows.length} pengiriman</button>`);
    }
    const split = rw.closest('.split'); const kanan = split?.children[1];
    const backup = $$('#content > .card').find((c) => /Backup database/.test(c.querySelector('h2')?.textContent || ''));
    if (split && kanan && backup) { const st = document.createElement('div'); st.className = 'stack'; kanan.replaceWith(st); st.append(kanan, backup); }
  }
};
document.addEventListener('click', (e) => { if (e.target.closest('[data-log-semua]')) { S.logSemua = true; viewStatus(); } });

// Pengingat & pengumuman: kolom kanan (pratinjau) menempel saat menggulir kolom kiri yang panjang.
function tandaiSplitMenempel() {
  if (S.view === 'pengingat' || (S.view === 'pengumuman' && S.pgTab !== 'polling')) $('#content .split')?.classList.add('menempel');
  if (S.view === 'pengingat') $('#content .split')?.classList.add('split-pengingat');
}

// Semua .split dua kolom: kartu dibagi seimbang (kalau kolomnya berupa tumpukan) dan ujung bawah diratakan.
function rapikanSplit() {
  for (const sp of $$('#content .split:not([data-rapi])')) {
    sp.dataset.rapi = '1';
    if (sp.classList.contains('menempel') || sp.classList.contains('status-split')) continue;
    const dua = getComputedStyle(sp).gridTemplateColumns.split(' ').length >= 2;
    const [a, b] = sp.children;
    if (!a || !b) continue;
    if (dua && a.classList.contains('stack') && b.classList.contains('stack')) {
      // Bagi ulang kartu: urutan tetap, tiap kartu masuk ke kolom yang sedang lebih pendek.
      const kartu = [...a.children, ...b.children];
      sp.classList.add('menyusun'); a.replaceChildren(); b.replaceChildren();
      for (const k of kartu) (a.offsetHeight <= b.offsetHeight ? a : b).append(k);
      sp.classList.remove('menyusun');
    }
    sp.classList.add('rata');
  }
}
let fxRapiJadwal = 0;
new MutationObserver(() => {
  cancelAnimationFrame(fxRapiJadwal);
  fxRapiJadwal = requestAnimationFrame(() => { tandaiSplitMenempel(); rapikanSplit(); });
}).observe($('#content'), { childList: true });
