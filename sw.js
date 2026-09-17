// BUILD:20260917-215633
// Strategy: stale-while-revalidate for the app shell — the cached copy paints
// immediately, a fresh copy is fetched in the background, and if the bytes
// actually changed the page shows a tap-to-refresh bar. Instant opens AND
// visible updates, with no forced reload racing page init.
// Fonts and icons are cache-first so an offline open still renders correctly.
const C = 'nola-pocket-20260917-215633';
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
    // Deliberately NOT reloading open windows here. Forcing a navigate on activate
    // yanks the page mid-boot and leaves the tab bar dead until the next launch.
    // Stale-while-revalidate below already refreshes the cache, so the new shell
    // lands on the next open by itself.
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
      // cache:'no-cache' forces a conditional request to the origin. Without it,
      // GitHub Pages' max-age=600 lets the browser HTTP cache hand back a copy up
      // to ten minutes old, so the "background refresh" could silently refetch
      // the stale shell and the app would look like it never updated.
      const net = fetch(req, { cache: 'no-cache' }).then(async res => {
        if (!res || !res.ok) return res;
        const fresh = await res.clone().text();
        const old = cached ? await cached.clone().text() : null;
        await cache.put(SHELL, res.clone());
        if (old !== null && fresh !== old) {
          // Bytes changed: tell open windows so they can offer a tap-to-refresh.
          // We never reload for them — that raced page init and killed the tab bar.
          const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
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
