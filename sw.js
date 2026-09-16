// BUILD:20260916-183421
// Network-first for the app shell so an update is never invisible;
// cache-first for icons. The cache name carries the build stamp, so every
// deploy retires the previous cache instead of serving it forever.
const C = 'nola-pocket-20260916-183421';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isShell = req.mode === 'navigate' || /\/(index\.html)?$/.test(new URL(req.url).pathname);
  if (isShell) {
    // network first: always take a fresh shell when there is signal, fall back to cache
    e.respondWith(
      fetch(req).then(res => {
        const cp = res.clone();
        caches.open(C).then(c => c.put(req, cp));
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }
  // everything else: cache first
  e.respondWith(
    caches.match(req).then(r => r || fetch(req).then(res => {
      const cp = res.clone();
      caches.open(C).then(c => c.put(req, cp));
      return res;
    }))
  );
});
