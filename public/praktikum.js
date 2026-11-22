/* Six Seven 67: menu Praktikum (jadwal sesi, tugas, kalender, daftar praktikum).
   Terpisah dari jadwal kuliah dan tugas biasa. Dimuat setelah app.js dan fitur.js. */
'use strict';

// ================= Data & utilitas =================
const prData = () => S.data.prak || { daftar: [], sesi: [], tugas: [] };
const prById = (id) => prData().daftar.find((p) => p.id === Number(id));
const prWarna = (id) => { const p = prById(id); return MK_WARNA[p?.warna] || MK_WARNA[MK_KEYS[mkHash(p?.nama) % MK_KEYS.length]]; };
const prVar = (id) => `--mk:${prWarna(id)}`;
const prChip = (id, nama) => `<span class="chip mk-chip" style="${prVar(id)}">${esc(nama || prById(id)?.nama || 'Praktikum')}</span>`;
const prInisial = (nama) => esc(String(nama || '').split(/\s+/).map((x) => x[0]).join('').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'P');
const prMenit = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const prMulai = (s) => msOfYmd(s.tanggal) + prMenit(s.mulai) * 6e4;
const prSelesai = (s) => (s.selesai ? msOfYmd(s.tanggal) + prMenit(s.selesai) * 6e4 : prMulai(s) + 120 * 6e4);
const prJam = (s) => `${s.mulai}${s.selesai ? '–' + s.selesai : ''}`;
const JENIS_PRAK = ['Laporan', 'Tugas pendahuluan', 'Pretest', 'Posttest', 'Responsi', 'Lainnya'];
const PR_TABS = [['ringkasan', 'Ringkasan', 'squares-four'], ['jadwal', 'Jadwal', 'calendar-dots'], ['tugas', 'Tugas', 'list-checks'], ['kalender', 'Kalender', 'calendar'], ['daftar', 'Daftar', 'flask']];
const PR = (S.pr ||= { tab: 'ringkasan', sesi: 'mendatang', tugas: 'aktif', pid: '', cal: null });

function prStatusSesi(s) {
  const n = now(); const a = prMulai(s); const z = prSelesai(s);
  if (z <= n) return ['b-done', 'Selesai'];
  if (a <= n) return ['b-urgent', 'Berlangsung'];
  return dueBadge(a);
}
const prCocok = (x) => !PR.pid || x.praktikum_id === Number(PR.pid);

function prSesiRow(s, { tanggal = true } = {}) {
  const ms = prMulai(s); const t = w(ms); const lewat = prSelesai(s) <= now();
  return `<div class="row clickable mk-accent pr-row ${lewat ? 'done' : ''}" style="${prVar(s.praktikum_id)}" data-pr-sesi="${s.id}" role="button" tabindex="0">
    ${tanggal ? `<time class="pr-date"><b>${t.d}</b><small>${BULAN[t.m]}</small></time>` : `<time class="pr-date pr-jam"><b>${s.mulai}</b>${s.selesai ? `<small>${s.selesai}</small>` : ''}</time>`}
    <div class="grow"><div class="title">${esc(s.judul)}</div>
      <div class="sub">${prChip(s.praktikum_id, s.praktikum)}<span>${tanggal ? `${HARI[t.dow].slice(0, 3)} · ` : ''}${prJam(s)}</span>${s.ruang || prById(s.praktikum_id)?.lab ? `<span><i class="ph ph-map-pin"></i>${esc(s.ruang || prById(s.praktikum_id).lab)}</span>` : ''}</div></div>
    ${badge(prStatusSesi(s))}</div>`;
}
function prKumpulBtn(t) {
  if (t.selesai) return '';
  return `<button class="kumpul-btn ${t.kumpulSaya ? 'on' : ''}" data-pr-kumpul="${t.id}" aria-pressed="${!!t.kumpulSaya}" title="${t.kumpulSaya ? 'Batalkan tanda sudah kumpul' : 'Tandai sudah kumpul'}"><i class="ph${t.kumpulSaya ? '-fill' : ''} ph-${t.kumpulSaya ? 'check-circle' : 'tray-arrow-up'}"></i><span>${t.kumpulSaya ? 'Sudah kumpul' : 'Kumpul'}</span><em aria-label="${t.kumpulN || 0} dari ${S.data.anggota || 0} anggota sudah kumpul">${t.kumpulN || 0}/${S.data.anggota || 0}</em></button>`;
}
function prTugasRow(t) {
  return `<div class="row clickable pr-row ${t.selesai ? 'done' : ''}" data-pr-tugas="${t.id}" role="button" tabindex="0">
    <button class="check ${t.selesai ? 'on' : ''}" data-pr-selesai="${t.id}" ${canEdit() ? '' : 'disabled'} aria-pressed="${!!t.selesai}" aria-label="${t.selesai ? 'Tandai belum selesai' : 'Tandai selesai'}: ${esc(t.judul)}"><i class="ph-bold ph-check"></i></button>
    <div class="grow"><div class="title">${esc(t.judul)}</div>
      <div class="sub">${prChip(t.praktikum_id, t.praktikum)}<span class="tag">${esc(t.jenis)}</span><span>${tgl(t.ms)} · ${hm(t.ms)} · #P${t.id}</span>${t.kumpulN ? `<span><i class="ph ph-users"></i>${t.kumpulN} kumpul</span>` : ''}</div></div>
    <span class="pr-side">${badge(dueBadge(t.ms, t.selesai))}${prKumpulBtn(t)}</span></div>`;
}
const prKosong = (teks) => `<p class="muted pr-kosong">${teks}</p>`;

// ================= Halaman =================
function viewPraktikum() {
  const P = prData(); const n = now(); const sod = startOfDay(n);
  const sesi7 = P.sesi.filter((s) => prSelesai(s) > n && prMulai(s) < sod + 7 * DAY);
  const aktif = P.tugas.filter((t) => !t.selesai);
  const belum = aktif.filter((t) => !t.kumpulSaya);
  const aksi = canEdit() ? (P.daftar.length
    ? `<button class="btn btn-secondary" data-pr-add="sesi">${PLUS}Sesi</button><button class="btn btn-primary" data-pr-add="tugas">${PLUS}Tugas praktikum</button>`
    : `<button class="btn btn-primary" data-pr-add="praktikum">${PLUS}Praktikum</button>`) : '';
  const head = pageHead('flask', 'Praktikum', 'Semua urusan praktikum di satu tempat: jadwal per pertemuan, tugas (laporan, pretest, dll.), dan kalendernya. Terpisah dari jadwal kuliah dan tugas biasa.',
    [[P.daftar.length, 'Praktikum'], [sesi7.length, 'Sesi 7 hari'], [belum.length, 'Belum kumpul']], aksi);
  if (!P.daftar.length) {
    $('#content').innerHTML = `${head}<div class="card">${empty('flask', 'Belum ada praktikum', 'Tambahkan mata praktikum dulu (mis. Praktikum Kimia Dasar), lalu isi jadwal sesi dan tugasnya. Bot akan mengingatkan grup sebelum praktikum dimulai.', canEdit() ? `<button class="btn btn-primary" data-pr-add="praktikum">${PLUS}Tambah praktikum</button>` : '')}</div>`;
    return;
  }
  const tabs = `<div class="segmented pr-tabs" role="tablist" aria-label="Bagian praktikum">${PR_TABS.map(([k, l, ic]) => `<button role="tab" class="${PR.tab === k ? 'on' : ''}" aria-selected="${PR.tab === k}" data-pr-tab="${k}"><i class="ph ph-${ic}"></i> ${l}</button>`).join('')}</div>`;
  const filter = ['jadwal', 'tugas', 'kalender'].includes(PR.tab) && P.daftar.length > 1
    ? `<label class="inline-field"><select id="prPid" aria-label="Filter praktikum"><option value="">Semua praktikum</option>${P.daftar.map((p) => `<option value="${p.id}" ${Number(PR.pid) === p.id ? 'selected' : ''}>${esc(p.nama)}</option>`).join('')}</select></label>` : '';
  const isi = { ringkasan: prRingkasan, jadwal: prJadwal, tugas: prTugas, kalender: prKalender, daftar: prDaftar }[PR.tab] || prRingkasan;
  $('#content').innerHTML = `${head}<div class="toolbar"><div class="toolbar-left">${tabs}</div>${filter ? `<div class="toolbar-right">${filter}</div>` : ''}</div>${isi(P)}`;
  const sel = $('#prPid'); if (sel) sel.onchange = () => { PR.pid = sel.value; viewPraktikum(); };
}

function prRingkasan(P) {
  const n = now();
  const datang = P.sesi.filter((s) => prSelesai(s) > n).slice(0, 6);
  const berikut = datang[0];
  const aktif = P.tugas.filter((t) => !t.selesai).slice(0, 6);
  const sorot = berikut ? (() => {
    const a = prMulai(berikut); const live = a <= n; const p = prById(berikut.praktikum_id);
    return `<div class="pr-next mk-accent" style="${prVar(berikut.praktikum_id)}" data-pr-sesi="${berikut.id}" role="button" tabindex="0">
      <span class="eyebrow">${live ? 'Sedang berlangsung' : 'Praktikum berikutnya'}</span>
      <b class="pr-next-judul">${esc(berikut.praktikum)}</b><span>${esc(berikut.judul)}</span>
      <div class="pr-next-meta"><span><i class="ph ph-calendar-blank"></i>${tgl(a)}</span><span><i class="ph ph-clock"></i>${prJam(berikut)}</span>${berikut.ruang || p?.lab ? `<span><i class="ph ph-map-pin"></i>${esc(berikut.ruang || p.lab)}</span>` : ''}${p?.asisten ? `<span><i class="ph ph-user"></i>${esc(p.asisten)}</span>` : ''}</div>
      ${badge(prStatusSesi(berikut))}</div>`;
  })() : '';
  return `<div class="split">
    <div class="stack">
      <div class="card"><div class="card-head"><h2><i class="ph ph-calendar-dots"></i>Sesi mendatang</h2><button class="link-btn" data-pr-tab="jadwal">Lihat semua</button></div>
        ${sorot}<div class="rows">${datang.slice(1).map((s) => prSesiRow(s)).join('') || (berikut ? '' : prKosong('Belum ada sesi praktikum terjadwal.'))}</div></div>
      <div class="card"><div class="card-head"><h2><i class="ph ph-list-checks"></i>Tugas praktikum aktif</h2><button class="link-btn" data-pr-tab="tugas">Lihat semua</button></div>
        <div class="rows">${aktif.map(prTugasRow).join('') || prKosong('Tidak ada tugas praktikum aktif 🎉')}</div></div>
    </div>
    <div class="stack">
      <div class="card"><div class="card-head"><h2><i class="ph ph-flask"></i>Praktikum semester ini</h2><button class="link-btn" data-pr-tab="daftar">Kelola</button></div>
        <div class="rows">${P.daftar.map((p) => { const ns = P.sesi.filter((s) => s.praktikum_id === p.id); const sisa = ns.filter((s) => prSelesai(s) > n).length; const nt = P.tugas.filter((t) => t.praktikum_id === p.id && !t.selesai).length;
          return `<div class="row mk-accent" style="${prVar(p.id)}"><span class="pr-tile">${prInisial(p.nama)}</span><div class="grow"><div class="title">${esc(p.nama)}</div><div class="sub">${p.lab ? `<span><i class="ph ph-map-pin"></i>${esc(p.lab)}</span>` : ''}<span>${ns.length - sisa}/${ns.length} sesi</span><span>${nt} tugas aktif</span></div>${ns.length ? `<div class="bar sm" aria-hidden="true"><i style="width:${Math.round((ns.length - sisa) / ns.length * 100)}%"></i></div>` : ''}</div></div>`; }).join('')}</div></div>
      <div class="card"><div class="card-head"><h2><i class="ph-fill ph-whatsapp-logo"></i>Di grup WhatsApp</h2></div>
        <ul class="pr-tips"><li><b>/praktikum</b> menampilkan agenda praktikum 7 hari dan tugas praktikum aktif.</li><li><b>/kumpul P3</b> menandai tugas praktikum #P3 sudah dikumpulkan.</li><li>Bot mengingatkan sebelum sesi dimulai dan menjelang tenggat. Atur waktunya di menu Pengingat.</li></ul>
        ${isAdmin() ? '<button class="btn btn-secondary btn-sm" data-send="praktikum"><i class="ph ph-paper-plane-tilt"></i>Kirim agenda praktikum sekarang</button>' : ''}</div>
    </div></div>`;
}

function prJadwal(P) {
  const n = now(); const f = PR.sesi;
  let list = P.sesi.filter(prCocok);
  if (f === 'mendatang') list = list.filter((s) => prSelesai(s) > n);
  if (f === 'selesai') list = list.filter((s) => prSelesai(s) <= n).reverse();
  const seg = `<div class="segmented" role="group" aria-label="Filter sesi">${[['mendatang', 'Mendatang'], ['selesai', 'Selesai'], ['semua', 'Semua']].map(([k, l]) => `<button class="${f === k ? 'on' : ''}" aria-pressed="${f === k}" data-pr-fsesi="${k}">${l}</button>`).join('')}</div>`;
  const grup = []; let kunci = '';
  for (const s of list) {
    const ms = prMulai(s);
    const k = `${w(ms).y}-${w(ms).m}`;
    if (k !== kunci) { kunci = k; grup.push({ label: `${BULAN_PANJANG[w(ms).m]} ${w(ms).y}`, items: [] }); }
    grup.at(-1).items.push(s);
  }
  return `<div class="card"><div class="card-head"><h2><i class="ph ph-calendar-dots"></i>Jadwal sesi praktikum</h2><div class="card-tools">${seg}${canEdit() ? `<button class="btn btn-secondary btn-sm" data-pr-add="sesi">${PLUS}Sesi</button>` : ''}</div></div>
    ${grup.length ? grup.map((g) => `<div class="pr-group"><div class="eyebrow">${g.label} · ${g.items.length} sesi</div><div class="rows">${g.items.map((s) => prSesiRow(s)).join('')}</div></div>`).join('')
      : empty('calendar-blank', f === 'selesai' ? 'Belum ada sesi yang selesai' : 'Belum ada sesi', canEdit() ? 'Tambahkan sesi praktikum. Bisa sekaligus berulang tiap minggu.' : 'Jadwal praktikum belum diisi.')}</div>`;
}

function prTugas(P) {
  const f = PR.tugas;
  const cek = { aktif: (t) => !t.selesai, belum: (t) => !t.selesai && !t.kumpulSaya, selesai: (t) => t.selesai, semua: () => true }[f] || (() => true);
  const list = P.tugas.filter(prCocok).filter(cek);
  const hit = (k) => P.tugas.filter(prCocok).filter({ aktif: (t) => !t.selesai, belum: (t) => !t.selesai && !t.kumpulSaya, selesai: (t) => t.selesai, semua: () => true }[k]).length;
  const seg = `<div class="segmented" role="group" aria-label="Filter tugas">${[['aktif', 'Aktif'], ['belum', 'Belum kumpul'], ['selesai', 'Selesai'], ['semua', 'Semua']].map(([k, l]) => `<button class="${f === k ? 'on' : ''}" aria-pressed="${f === k}" data-pr-ftugas="${k}">${l} <small>${hit(k)}</small></button>`).join('')}</div>`;
  return `<div class="card"><div class="card-head"><h2><i class="ph ph-list-checks"></i>Tugas praktikum</h2><div class="card-tools">${seg}${canEdit() ? `<button class="btn btn-secondary btn-sm" data-pr-add="tugas">${PLUS}Tugas</button>` : ''}</div></div>
    <div class="rows">${list.map(prTugasRow).join('') || empty('check-circle', f === 'belum' ? 'Semua sudah kamu kumpulkan' : 'Tidak ada tugas', f === 'aktif' || f === 'belum' ? 'Tidak ada tugas praktikum yang menunggu.' : 'Belum ada tugas praktikum di sini.')}</div>
    <p class="note-line"><i class="ph ph-info"></i><span>Tanda <b>Kumpul</b> hanya untuk dirimu sendiri. Centang di kiri (editor) menandai tugas sudah selesai untuk semua orang, dan bot berhenti mengingatkan.</span></p></div>`;
}

function prKalender(P) {
  const tn = w(now()); const sod = startOfDay(now());
  if (!PR.cal) PR.cal = { y: tn.y, m: tn.m };
  const { y, m } = PR.cal; const first = Date.UTC(y, m, 1) - TZ;
  const lead = (w(first).dow + 6) % 7; const nDays = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells = Math.ceil((lead + nDays) / 7) * 7;
  const sesi = P.sesi.filter(prCocok); const tugas = P.tugas.filter(prCocok);
  let nS = 0; let nT = 0;
  const html = Array.from({ length: cells }, (_, i) => {
    const ms = first + (i - lead) * DAY; const t = w(ms); const inMonth = t.m === m; const ymd = ymdOf(ms);
    const ss = sesi.filter((s) => s.tanggal === ymd); const tt = tugas.filter((x) => dayKey(x.ms) === dayKey(ms));
    if (inMonth) { nS += ss.length; nT += tt.length; }
    const items = [
      ...ss.map((s) => `<li class="ev ev-ujian" style="${prVar(s.praktikum_id)}"><i class="ph-fill ph-flask"></i>${esc(s.mulai)} ${esc(s.praktikum)}</li>`),
      ...tt.map((x) => `<li class="ev ev-tugas ${x.selesai ? 'done' : ''}" style="${prVar(x.praktikum_id)}"><i class="ph${x.kumpulSaya || x.selesai ? '-fill' : ''} ph-${x.kumpulSaya || x.selesai ? 'check-circle' : 'circle'}"></i>${esc(x.jenis)}: ${esc(x.judul)}</li>`),
    ];
    return `<div class="cal-cell" data-pr-day="${ms}" data-out="${!inMonth}" data-today="${ms === sod}" data-past="${ms < sod}" role="button" tabindex="0" aria-label="${tgl(ms)}: ${ss.length} sesi praktikum, ${tt.length} tenggat">
      <div class="cal-top"><span class="cal-num">${t.d}</span></div>
      ${items.length ? `<ul>${items.slice(0, 3).join('')}${items.length > 3 ? `<li class="ev-more">+${items.length - 3} lagi</li>` : ''}</ul><span class="cal-badge" aria-hidden="true">${items.length}</span>` : ''}</div>`;
  }).join('');
  const sama = y === tn.y && m === tn.m;
  return `<div class="card cal-card"><div class="card-head"><h2><i class="ph ph-calendar"></i>${BULAN_PANJANG[m]} ${y}</h2>
      <div class="card-tools"><span class="muted pr-cal-ring">${nS} sesi · ${nT} tenggat</span><div class="cal-nav"><button class="icon-btn" data-pr-cal="-1" aria-label="Bulan sebelumnya"><i class="ph ph-caret-left"></i></button><button class="btn btn-secondary btn-sm" data-pr-cal="0" ${sama ? 'disabled' : ''}>Bulan ini</button><button class="icon-btn" data-pr-cal="1" aria-label="Bulan berikutnya"><i class="ph ph-caret-right"></i></button></div></div></div>
    <div class="cal-grid">${['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((d) => `<div class="cal-dow">${d}</div>`).join('')}${html}</div>
    <div class="legend cal-legend"><span><i class="ph-fill ph-flask"></i>Sesi praktikum</span><span><i class="ph ph-circle"></i>Tenggat tugas</span><span><i class="ph-fill ph-check-circle"></i>Sudah kumpul / selesai</span></div></div>`;
}

function prDaftar(P) {
  const n = now();
  const kontak = (k) => (!k ? '' : /^[\d+\s-]{8,}$/.test(k) ? `<a href="https://wa.me/${k.replace(/\D/g, '').replace(/^0/, '62')}" target="_blank" rel="noopener">${esc(k)}</a>` : /@/.test(k) ? `<a href="mailto:${esc(k)}">${esc(k)}</a>` : esc(k));
  return `<div class="pr-grid">${P.daftar.map((p) => {
    const ns = P.sesi.filter((s) => s.praktikum_id === p.id); const lewat = ns.filter((s) => prSelesai(s) <= n).length;
    const nt = P.tugas.filter((t) => t.praktikum_id === p.id); const berikut = ns.find((s) => prSelesai(s) > n);
    return `<div class="card pr-card mk-accent" style="${prVar(p.id)}">
      <div class="pr-card-head"><span class="pr-tile">${prInisial(p.nama)}</span><div class="grow"><b>${esc(p.nama)}</b><small>${p.lab ? esc(p.lab) : 'Lab belum diisi'}</small></div>
        ${canEdit() ? `<div class="mk-act"><button class="tiny-btn" data-pr-edit="praktikum" data-id="${p.id}" aria-label="Ubah ${esc(p.nama)}"><i class="ph ph-pencil-simple"></i></button><button class="tiny-btn danger" data-pr-del="praktikum" data-id="${p.id}" aria-label="Hapus ${esc(p.nama)}"><i class="ph ph-trash"></i></button></div>` : ''}</div>
      <dl class="pr-info">${p.asisten ? `<div><dt>Asisten</dt><dd>${esc(p.asisten)}</dd></div>` : ''}${p.kontak ? `<div><dt>Kontak</dt><dd>${kontak(p.kontak)}</dd></div>` : ''}<div><dt>Berikutnya</dt><dd>${berikut ? `${tgl(prMulai(berikut))} · ${berikut.mulai}` : '–'}</dd></div></dl>
      <div class="mini-stats"><div><b>${lewat}/${ns.length}</b><span>sesi</span></div><div><b>${nt.filter((t) => !t.selesai).length}</b><span>tugas aktif</span></div><div><b>${nt.filter((t) => t.kumpulSaya).length}</b><span>kamu kumpul</span></div></div>
      ${p.catatan ? `<p class="pr-catatan">${esc(p.catatan)}</p>` : ''}
      ${canEdit() ? `<div class="pr-card-foot"><button class="btn btn-secondary btn-sm" data-pr-add="sesi" data-pid="${p.id}">${PLUS}Sesi</button><button class="btn btn-secondary btn-sm" data-pr-add="tugas" data-pid="${p.id}">${PLUS}Tugas</button></div>` : ''}
    </div>`;
  }).join('')}${canEdit() ? `<button class="card pr-card pr-card-add" data-pr-add="praktikum">${PLUS}<b>Tambah praktikum</b><small>Mis. Praktikum Fisika Dasar</small></button>` : ''}</div>`;
}

// ================= Form =================
const prPilihan = (sel) => prData().daftar.map((p) => `<option value="${p.id}" ${Number(sel) === p.id ? 'selected' : ''}>${esc(p.nama)}</option>`).join('');
const prSelesaiModal = async (pesan) => { $('#modal').close(); toast(pesan); await refresh(); };

function prFormPraktikum(id) {
  const v = id ? prById(id) : {};
  const warna = v.warna || (v.nama ? MK_KEYS[mkHash(v.nama) % MK_KEYS.length] : MK_KEYS[(prData().daftar.length + 4) % MK_KEYS.length]);
  bukaModal({
    eyebrow: 'Praktikum', title: id ? `Ubah ${v.nama}` : 'Tambah praktikum', draft: id ? `prak:${id}` : 'prak', ep: '/api/praktikum',
    body: `<label class="field"><span>Nama praktikum</span><input name="nama" required maxlength="80" value="${esc(v.nama || '')}" placeholder="Mis. Praktikum Kimia Dasar"></label>
      <div class="grid2"><label class="field"><span>Laboratorium</span><input name="lab" value="${esc(v.lab || '')}" placeholder="Mis. Lab Kimia 2"></label>
        <label class="field"><span>Asisten / koordinator</span><input name="asisten" value="${esc(v.asisten || '')}" placeholder="Nama asisten"></label></div>
      <label class="field"><span>Kontak asisten <small class="muted">(nomor WA atau email)</small></span><input name="kontak" value="${esc(v.kontak || '')}" placeholder="08xxxxxxxxxx"></label>
      <fieldset class="field swatches"><span>Warna</span><div class="sw-row">${MK_KEYS.map((k) => `<label class="sw" style="--mk:${MK_WARNA[k]}" title="${k[0].toUpperCase() + k.slice(1)}"><input type="radio" name="warna" value="${k}" ${warna === k ? 'checked' : ''} aria-label="Warna ${k}"><i></i></label>`).join('')}</div></fieldset>
      <label class="field"><span>Catatan</span><textarea name="catatan" rows="3" placeholder="Mis. wajib jas lab, bawa modul, aturan telat 15 menit">${esc(v.catatan || '')}</textarea></label>`,
    onSubmit: async (fd) => {
      const body = Object.fromEntries(fd);
      await api(`/api/praktikum${id ? '/' + id : ''}`, { method: id ? 'PUT' : 'POST', body });
      await prSelesaiModal(id ? 'Praktikum diperbarui.' : 'Praktikum ditambahkan. Sekarang isi jadwal sesinya.');
    },
  });
}

function prFormSesi(id, preset = {}) {
  const v = id ? prData().sesi.find((s) => s.id === id) : { praktikum_id: preset.pid || PR.pid || prData().daftar[0]?.id, tanggal: preset.tanggal || ymdOf(now() + DAY), mulai: '08:00', selesai: '10:00' };
  const lab = (pid) => prById(pid)?.lab || 'Ruang/lab';
  bukaModal({
    eyebrow: 'Sesi praktikum', title: id ? 'Ubah sesi' : 'Tambah sesi', draft: id ? `prak-sesi:${id}` : 'prak-sesi', ep: '/api/prak-sesi',
    body: `<label class="field"><span>Praktikum</span><select name="praktikum_id" id="prSesiPid" required>${prPilihan(v.praktikum_id)}</select></label>
      <label class="field"><span>Acara / modul</span><input name="judul" required maxlength="120" value="${esc(v.judul || '')}" placeholder="Mis. Modul 1: Titrasi asam basa"></label>
      <div class="grid3"><label class="field"><span>Tanggal</span><input type="date" name="tanggal" required value="${esc(v.tanggal || '')}"></label>
        <label class="field"><span>Mulai</span><input type="time" name="mulai" required value="${esc(v.mulai || '')}"></label>
        <label class="field"><span>Selesai</span><input type="time" name="selesai" value="${esc(v.selesai || '')}"></label></div>
      <label class="field"><span>Ruang <small class="muted">(kosongkan untuk memakai lab praktikum)</small></span><input name="ruang" id="prSesiRuang" value="${esc(v.ruang || '')}" placeholder="${esc(lab(v.praktikum_id))}"></label>
      <label class="field"><span>Catatan / yang dibawa</span><textarea name="catatan" rows="2" placeholder="Mis. bawa jas lab, tugas pendahuluan dikumpulkan sebelum masuk">${esc(v.catatan || '')}</textarea></label>
      ${id ? '<label class="inline-field"><input type="checkbox" name="umumkan" checked> Beri tahu grup kalau tanggal/jam berubah</label>'
        : `<div class="pr-ulang"><label class="inline-field"><input type="checkbox" id="prUlang" name="ulang_on"> Ulangi tiap minggu</label>
          <label class="inline-field" id="prUlangWrap" hidden>sampai <input type="date" name="ulang"></label></div>
          <small class="muted">Kalau diulang, judul otomatis diberi nomor pertemuan (maks. 20 sesi).</small>`}`,
    onOpen: () => {
      $('#prSesiPid').onchange = (e) => { $('#prSesiRuang').placeholder = lab(e.target.value); };
      const u = $('#prUlang'); if (u) { const sync = () => { $('#prUlangWrap').hidden = !u.checked; $('[name=ulang]').required = u.checked; }; u.onchange = sync; sync(); }
    },
    onSubmit: async (fd) => {
      const body = Object.fromEntries(fd);
      if (!fd.has('ulang_on')) delete body.ulang; delete body.ulang_on;
      if (id) body.umumkan = fd.has('umumkan');
      const r = await api(`/api/prak-sesi${id ? '/' + id : ''}`, { method: id ? 'PUT' : 'POST', body });
      if (r.umum && r.umum !== 'terkirim') toast(`Disimpan, tapi gagal diumumkan ke grup (${String(r.umum).replace(/^gagal: /, '')}).`, 'error');
      await prSelesaiModal(id ? `Sesi diperbarui${r.umum === 'terkirim' ? ' dan diumumkan ke grup' : ''}.` : r.ids?.length > 1 ? `${r.ids.length} sesi ditambahkan (tiap minggu).` : 'Sesi ditambahkan.');
    },
  });
}

function prFormTugas(id, preset = {}) {
  const v = id ? prData().tugas.find((t) => t.id === id) : { praktikum_id: preset.pid || PR.pid || prData().daftar[0]?.id, jenis: 'Laporan', deadline: preset.deadline || `${ymdOf(now() + 7 * DAY)} 23:59` };
  bukaModal({
    eyebrow: 'Tugas praktikum', title: id ? 'Ubah tugas praktikum' : 'Tambah tugas praktikum', draft: id ? `prak-tugas:${id}` : 'prak-tugas', ep: '/api/prak-tugas',
    body: `<div class="grid2"><label class="field"><span>Praktikum</span><select name="praktikum_id" required>${prPilihan(v.praktikum_id)}</select></label>
        <label class="field"><span>Jenis</span><select name="jenis">${JENIS_PRAK.map((j) => `<option ${v.jenis === j ? 'selected' : ''}>${j}</option>`).join('')}</select></label></div>
      <label class="field"><span>Judul</span><input name="judul" required maxlength="160" value="${esc(v.judul || '')}" placeholder="Mis. Laporan Modul 1"></label>
      <label class="field"><span>Tenggat (WIB)</span><input type="datetime-local" name="deadline" required value="${esc(String(v.deadline || '').replace(' ', 'T'))}"></label>
      <label class="field"><span>Link pengumpulan <small class="muted">(opsional)</small></span><input type="url" name="link" value="${esc(v.link || '')}" placeholder="https://…"></label>
      <label class="field"><span>Catatan</span><textarea name="catatan" rows="2" placeholder="Mis. ditulis tangan, format PDF, maks. 10 halaman">${esc(v.catatan || '')}</textarea></label>
      ${id ? `<label class="inline-field"><input type="checkbox" name="selesai" ${v.selesai ? 'checked' : ''}> Sudah selesai (bot berhenti mengingatkan)</label><label class="inline-field"><input type="checkbox" name="umumkan" checked> Beri tahu grup kalau tenggat berubah</label>` : ''}`,
    onSubmit: async (fd) => {
      const body = Object.fromEntries(fd); body.selesai = fd.has('selesai'); if (id) body.umumkan = fd.has('umumkan');
      const r = await api(`/api/prak-tugas${id ? '/' + id : ''}`, { method: id ? 'PUT' : 'POST', body });
      if (r.umum && r.umum !== 'terkirim') toast(`Disimpan, tapi gagal diumumkan ke grup (${String(r.umum).replace(/^gagal: /, '')}).`, 'error');
      await prSelesaiModal(id ? `Tugas praktikum diperbarui${r.umum === 'terkirim' ? ' dan diumumkan ke grup' : ''}.` : 'Tugas praktikum ditambahkan.');
    },
  });
}

// ================= Detail =================
const prFoot = (jenis, id, ekstra = '') => `${canEdit() ? `<button type="button" class="btn btn-danger left" data-pr-del="${jenis}" data-id="${id}"><i class="ph ph-trash"></i>Hapus</button>` : ''}${ekstra}<button type="button" class="btn btn-secondary" data-close>Tutup</button>${canEdit() ? `<button type="button" class="btn btn-primary" data-pr-edit="${jenis}" data-id="${id}"><i class="ph ph-pencil-simple"></i>Ubah</button>` : ''}`;
const prDl = (pairs) => `<dl class="detail-list">${pairs.filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;

function prDetailSesi(id) {
  const s = prData().sesi.find((x) => x.id === id); if (!s) return;
  const p = prById(s.praktikum_id); const a = prMulai(s);
  bukaModal({
    eyebrow: s.praktikum, title: s.judul, foot: prFoot('sesi', id),
    body: `<div class="pr-detail-top">${prChip(s.praktikum_id, s.praktikum)}${badge(prStatusSesi(s))}</div>
      ${prDl([['Tanggal', tgl(a)], ['Jam', `${prJam(s)} WIB`], ['Ruang', esc(s.ruang || p?.lab || '')], ['Asisten', esc(p?.asisten || '')], ['Catatan', s.catatan ? `<span style="white-space:pre-wrap">${esc(s.catatan)}</span>` : '']])}
      ${(() => { const tt = prData().tugas.filter((t) => t.praktikum_id === s.praktikum_id && !t.selesai); return tt.length ? `<div><div class="eyebrow" style="margin-bottom:8px">Tugas ${esc(s.praktikum)} yang masih aktif</div><div class="rows">${tt.map(prTugasRow).join('')}</div></div>` : ''; })()}`,
  });
}

async function prDetailTugas(id) {
  const t = prData().tugas.find((x) => x.id === id); if (!t) return;
  bukaModal({
    eyebrow: `${t.praktikum} · ${t.jenis}`, title: t.judul, foot: prFoot('tugas', id, prKumpulBtn(t)),
    body: `<div class="pr-detail-top">${prChip(t.praktikum_id, t.praktikum)}<span class="tag">#P${t.id}</span>${badge(dueBadge(t.ms, t.selesai))}</div>
      ${prDl([['Tenggat', `${tgl(t.ms)} · ${hm(t.ms)} WIB`], ['Kumpul di', t.link ? `<a href="${esc(t.link)}" target="_blank" rel="noopener">${esc(t.link.replace(/^https?:\/\//, '').slice(0, 60))}</a>` : ''], ['Catatan', t.catatan ? `<span style="white-space:pre-wrap">${esc(t.catatan)}</span>` : '']])}
      <div id="prKumpulList" class="muted">Memuat status kumpul…</div>
      <small class="muted">Di grup, anggota bisa membalas <b>/kumpul P${t.id}</b> untuk menandai sudah kumpul.</small>`,
  });
  try {
    const r = await api(`/api/prak-tugas/${id}/kumpul`);
    const box = $('#prKumpulList'); if (!box) return;
    box.className = 'kumpul-list';
    box.innerHTML = `<div class="eyebrow">Sudah kumpul · ${r.sudah.length}/${r.sudah.length + r.belum.length}</div>
      <div class="bar" aria-hidden="true"><i style="width:${r.sudah.length + r.belum.length ? Math.round(r.sudah.length / (r.sudah.length + r.belum.length) * 100) : 0}%"></i></div>
      ${r.sudah.length ? `<div class="chips">${r.sudah.map((a) => `<span class="tag" data-tone="success" title="${tgl(a.at)} ${hm(a.at)}"><i class="ph-fill ph-check-circle"></i>${esc(a.nama)}</span>`).join('')}</div>` : ''}
      ${r.belum.length ? `<details><summary>Belum kumpul (${r.belum.length})</summary><div class="chips">${r.belum.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div></details>` : ''}`;
  } catch { const box = $('#prKumpulList'); if (box) box.textContent = ''; }
}

function prBukaHari(ms) {
  const ymd = ymdOf(ms);
  const ss = prData().sesi.filter((s) => s.tanggal === ymd && prCocok(s));
  const tt = prData().tugas.filter((x) => dayKey(x.ms) === dayKey(ms) && prCocok(x));
  const bisaTambah = canEdit() && ms >= startOfDay(now());
  bukaModal({
    eyebrow: 'Agenda praktikum', title: tgl(ms),
    foot: `${bisaTambah ? `<div class="left day-add"><button type="button" class="btn btn-secondary btn-sm" data-pr-add="sesi" data-tanggal="${ymd}">${PLUS}Sesi</button><button type="button" class="btn btn-secondary btn-sm" data-pr-add="tugas" data-tanggal="${ymd}">${PLUS}Tugas</button></div>` : ''}<button type="button" class="btn btn-secondary" data-close>Tutup</button>`,
    body: ss.length || tt.length
      ? `${ss.length ? `<div><div class="eyebrow" style="margin-bottom:8px">Sesi praktikum</div><div class="rows">${ss.map((s) => prSesiRow(s, { tanggal: false })).join('')}</div></div>` : ''}
         ${tt.length ? `<div><div class="eyebrow" style="margin-bottom:8px">Tenggat tugas</div><div class="rows">${tt.map(prTugasRow).join('')}</div></div>` : ''}`
      : empty('coffee', 'Tidak ada praktikum', 'Tidak ada sesi atau tenggat tugas praktikum di tanggal ini.'),
  });
}

// ================= Aksi =================
async function prHapus(jenis, id) {
  const ep = { praktikum: 'praktikum', sesi: 'prak-sesi', tugas: 'prak-tugas' }[jenis];
  const P = prData();
  const v = jenis === 'praktikum' ? prById(id) : (jenis === 'sesi' ? P.sesi : P.tugas).find((x) => x.id === id);
  if (!v) return;
  const label = jenis === 'praktikum' ? `praktikum ${v.nama}` : jenis === 'sesi' ? `sesi "${v.judul}"` : `tugas "${v.judul}"`;
  if (jenis === 'praktikum' && (v.pakai?.sesi || v.pakai?.tugas)) return toast(`Hapus dulu ${[v.pakai.sesi && `${v.pakai.sesi} sesi`, v.pakai.tugas && `${v.pakai.tugas} tugas`].filter(Boolean).join(' dan ')} milik ${v.nama}.`, 'error');
  if (!(await askConfirm(`Hapus ${label}?`, 'Bisa dikembalikan lewat tombol Batalkan atau menu Riwayat.'))) return;
  try {
    const r = await api(`/api/${ep}/${id}`, { method: 'DELETE' });
    if ($('#modal').open) $('#modal').close();
    toast('Data dihapus.', 'success', r.sampah ? { label: 'Batalkan', fn: () => pulihkan(r.sampah) } : null);
    refresh();
  } catch (err) { toast(err.message, 'error'); }
}

async function prToggleSelesai(id) {
  const t = prData().tugas.find((x) => x.id === id); if (!t || !canEdit()) return;
  try {
    await api(`/api/prak-tugas/${id}`, { method: 'PUT', body: { ...t, deadline: t.deadline, selesai: !t.selesai, umumkan: false } });
    toast(t.selesai ? 'Tugas praktikum aktif lagi.' : 'Tugas praktikum ditandai selesai.'); refresh();
  } catch (err) { toast(err.message, 'error'); }
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-pr-tab],[data-pr-fsesi],[data-pr-ftugas],[data-pr-cal],[data-pr-add],[data-pr-edit],[data-pr-del],[data-pr-kumpul],[data-pr-selesai],[data-pr-sesi],[data-pr-tugas],[data-pr-day]');
  if (!el) return;
  const d = el.dataset; const id = Number(d.id);
  if ('prTab' in d) { PR.tab = d.prTab; if (S.view !== 'praktikum') return go('praktikum'); viewPraktikum(); return window.scrollTo({ top: 0 }); }
  if ('prFsesi' in d) { PR.sesi = d.prFsesi; return viewPraktikum(); }
  if ('prFtugas' in d) { PR.tugas = d.prFtugas; return viewPraktikum(); }
  if ('prCal' in d) { const st = Number(d.prCal); const tn = w(now()); if (!st) PR.cal = { y: tn.y, m: tn.m }; else { const m = PR.cal.m + st; PR.cal = { y: PR.cal.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }; } return viewPraktikum(); }
  if ('prAdd' in d) {
    e.stopPropagation(); if ($('#modal').open) $('#modal').close();
    const preset = { pid: d.pid ? Number(d.pid) : undefined, tanggal: d.tanggal, deadline: d.tanggal ? `${d.tanggal} 23:59` : undefined };
    return d.prAdd === 'praktikum' ? prFormPraktikum() : d.prAdd === 'sesi' ? prFormSesi(null, preset) : prFormTugas(null, preset);
  }
  if ('prEdit' in d) { e.stopPropagation(); if ($('#modal').open) $('#modal').close(); return d.prEdit === 'praktikum' ? prFormPraktikum(id) : d.prEdit === 'sesi' ? prFormSesi(id) : prFormTugas(id); }
  if ('prDel' in d) { e.stopPropagation(); return prHapus(d.prDel, id); }
  if ('prKumpul' in d) {
    e.stopPropagation();
    const t = prData().tugas.find((x) => x.id === Number(d.prKumpul)); if (!t) return;
    el.disabled = true;
    try {
      await api(`/api/prak-tugas/${t.id}/kumpul`, { method: 'POST', body: { kumpul: !t.kumpulSaya } });
      toast(t.kumpulSaya ? 'Tanda kumpul dibatalkan.' : 'Mantap! Tugas praktikum ditandai sudah kamu kumpulkan.');
      const diModal = $('#modal').open && el.closest('#modal');
      await refresh(); if (diModal) prDetailTugas(t.id);
    } catch (err) { toast(err.message, 'error'); el.disabled = false; }
    return;
  }
  if ('prSelesai' in d) { e.stopPropagation(); return prToggleSelesai(Number(d.prSelesai)); }
  if ('prSesi' in d) { if ($('#modal').open) $('#modal').close(); return prDetailSesi(Number(d.prSesi)); }
  if ('prTugas' in d) { if ($('#modal').open) $('#modal').close(); return prDetailTugas(Number(d.prTugas)); }
  if ('prDay' in d) return prBukaHari(Number(d.prDay));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches?.('[data-pr-sesi],[data-pr-tugas],[data-pr-day]') && !e.target.matches('button')) e.target.click();
});

// Cari cepat (Ctrl+K): praktikum, sesi, dan tugas praktikum ikut dicari.
const prIsiPaletteAsli = isiPalette;
isiPalette = function (q) {
  prIsiPaletteAsli(q);
  const s = q.trim().toLowerCase(); if (!s) return;
  const P = prData();
  const ekstra = [
    ...P.daftar.map((p) => ({ ikon: 'flask', judul: p.nama, sub: `Praktikum${p.lab ? ' · ' + p.lab : ''}`, aksi: () => { PR.tab = 'daftar'; go('praktikum'); } })),
    ...P.sesi.map((x) => ({ ikon: 'flask', judul: x.judul, sub: `Sesi praktikum · ${x.praktikum} · ${tgl(prMulai(x))}`, aksi: () => { go('praktikum'); prDetailSesi(x.id); } })),
    ...P.tugas.map((x) => ({ ikon: 'list-checks', judul: x.judul, sub: `Tugas praktikum #P${x.id} · ${x.praktikum} · ${tgl(x.ms)}`, cari: x.catatan, aksi: () => { go('praktikum'); prDetailTugas(x.id); } })),
  ].filter((x) => `${x.judul} ${x.sub} ${x.cari || ''}`.toLowerCase().includes(s));
  if (!ekstra.length) return;
  fxPalItems = [...fxPalItems, ...ekstra].slice(0, 30); gambarPalette();
};
