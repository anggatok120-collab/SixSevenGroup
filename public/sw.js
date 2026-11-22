// Service worker: aplikasi bisa di-install dan tampilan dasarnya tetap terbuka saat sinyal jelek.
// Data (/api) selalu diambil langsung dari server, tidak pernah disimpan di cache.
const CACHE = 'ss67-v3';
const SHELL = ['/', '/login', '/app.css', '/app.js', '/fitur.js', '/praktikum.js', '/logo.svg', '/manifest.webmanifest', '/icon-192.png'];

// Notifikasi push dari server (pengingat, pengumuman).
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Six Seven 67', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Six Seven 67', { body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: d.tag, data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => new URL(c.url).origin === location.origin);
    if (w) { w.focus(); return w.navigate(url).catch(() => {}); }
    return self.clients.openWindow(url);
  }));
});

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/kalender/')) return;
  // Font & ikon vendor tidak pernah berubah: ambil dari cache dulu.
  if (url.pathname.startsWith('/vendor/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
    return;
  }
  // Selainnya: jaringan dulu (supaya update langsung terasa), cache kalau offline.
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/') : Response.error()))));
});
