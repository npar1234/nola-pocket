// BUILD:20260916-185733
// Strategy: stale-while-revalidate for the app shell — the cached copy paints
// immediately, a fresh copy is fetched in the background, and if the bytes
// actually changed the page is told to reload. That gives instant opens AND
// automatic updates, instead of trading one for the other.
// Fonts and icons are cache-first so an offline open still renders correctly.
const C = 'nola-pocket-20260916-185733';
const SHELL = './index.html';
const FILES = ['./', SHELL, './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)));
    await self.clients.claim();
    // The worker we may be replacing was cache-first with a fixed cache name, so
    // an installed app can hold a stale shell with no way to know it. Reload the
    // windows ourselves. Runs once per worker version, so it cannot loop.
    const cs = await self.clients.matchAll({ type: 'window' });
    for (const c of cs) { try { await c.navigate(c.url); } catch (_) {} }
  })());
});

const isFont = u => u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);

  // Google Fonts: cache-first, so a cold offline open still has the typefaces.
  if (isFont(u)) {
    e.respondWith(caches.open(C).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }
      catch (_) { return hit || Response.error(); }
    }));
    return;
  }

  if (u.origin !== location.origin) return;

  const isShell = req.mode === 'navigate' || /\/(index\.html)?$/.test(u.pathname);
  if (isShell) {
    e.respondWith((async () => {
      const cache = await caches.open(C);
      const cached = await cache.match(SHELL);
      const net = fetch(req).then(async res => {
        if (!res || !res.ok) return res;
        const fresh = await res.clone().text();
        const old = cached ? await cached.clone().text() : null;
        await cache.put(SHELL, res.clone());
        if (old !== null && old !== fresh) {
          const cs = await self.clients.matchAll({ type: 'window' });
          cs.forEach(c => c.postMessage({ type: 'shell-updated' }));
        }
        return res;
      }).catch(() => null);
      if (cached) { e.waitUntil(net); return cached; }   // paint now
      return (await net) || new Response('Offline and nothing cached yet.', { status: 503 });
    })());
    return;
  }

  // everything else same-origin: cache-first
  e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
    const cp = res.clone();
    caches.open(C).then(c => c.put(req, cp));
    return res;
  })));
});
