// BUILD:20260917-220904
// Strategy: stale-while-revalidate for the app shell. The cached copy paints
// instantly; a fresh copy is fetched straight from the origin in the background.
// If the bytes changed, open windows are told, and the page decides whether to
// reload quietly (just launched, untouched) or show a tap-to-refresh bar.
//
// Two rules learned the hard way:
//  1. Every fetch that fills the cache bypasses the browser HTTP cache
//     (cache:'reload' / 'no-cache'). GitHub Pages marks files fresh for ten
//     minutes, and a plain fetch during install was copying the OLD shell into
//     the NEW cache, so an update looked like it never happened.
//  2. Never re-fetch a navigation Request object with an init (browsers throw),
//     and clone the cached response BEFORE returning it to the page — reading
//     it afterwards throws "body already used". Both errors were being
//     swallowed, which is why the background refresh never actually ran.
const C = 'nola-pocket-20260917-220904';
const SHELL = new URL('./index.html', self.location).href;
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(C);
    await Promise.all(FILES.map(async f => {
      const res = await fetch(f, { cache: 'reload' });      // origin, never HTTP cache
      if (!res.ok) throw new Error('precache failed: ' + f + ' ' + res.status);
      const url = new URL(f, self.location).href;
      await c.put(url, res.clone());
      if (url.endsWith('/')) await c.put(SHELL, res.clone()); // './' and './index.html' are the same doc
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)));
    await self.clients.claim();
    // No client.navigate() here — reloading mid-boot killed the tab bar.
  })());
});

const isFont = u => u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

async function refreshShell(oldCopy) {
  // oldCopy is a CLONE taken before the cached response was handed to the
  // browser. Reading the original after that throws "body already used" — and
  // that exact error was silently killing every update check until now.
  const res = await fetch(SHELL, { cache: 'no-cache' });   // URL string, not the navigate Request
  if (!res || !res.ok) return null;
  const fresh = await res.clone().text();
  const old = oldCopy ? await oldCopy.text() : null;
  const c = await caches.open(C);
  await c.put(SHELL, res.clone());
  if (old !== null && fresh !== old) {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    cs.forEach(cl => cl.postMessage({ type: 'shell-updated' }));
  }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);

  if (isFont(u)) {                                   // fonts: cache-first
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
      const oldCopy = cached ? cached.clone() : null;           // clone BEFORE returning cached
      const net = refreshShell(oldCopy).catch(err => { console.warn('[sw] shell refresh failed', err); return null; });
      if (cached) { e.waitUntil(net); return cached; }           // paint now, refresh behind
      return (await net) || new Response('Offline and nothing cached yet.', { status: 503 });
    })());
    return;
  }

  // everything else same-origin: cache-first, but never cache an error response
  e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
    if (res && res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(req, cp)); }
    return res;
  })));
});
