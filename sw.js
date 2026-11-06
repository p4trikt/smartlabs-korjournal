// Service worker: gör att appen startar snabbt och kan öppnas utan nät.
// Höj VERSION vid varje uppdatering.
const VERSION = 'kj-v14';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.json', 'js/app.js', 'js/api.js', 'js/config.js', 'admin.html', 'admin.css', 'js/admin.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Databasanrop går alltid direkt till nätet.
  if (url.hostname.endsWith('supabase.co')) return;

  // Bibliotek från CDN: cache först (versionerade, ändras aldrig).
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res;
    })));
    return;
  }

  // Appens egna filer: nätet först så uppdateringar slår igenom, cache som reserv.
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))));
  }
});
