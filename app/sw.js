// BUILD:20260918-171627
// Network-first for the app shell: every open asks the server for the page
// (conditional request, so a 304 costs almost nothing) and falls back to the
// cached copy only if the network fails or takes more than 4s. There is no
// update detection, no reload, no banner — the page you see is always the one
// on the server. Fonts and icons are cache-first so an offline open still renders.
const C = 'nola-pocket-20260918-171627';
const SHELL = new URL('./index.html', self.location).href;
const STATIC = ['./manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(C);
    const res = await fetch(SHELL, { cache: 'reload' });
    if (res.ok) await c.put(SHELL, res);
    await Promise.all(STATIC.map(async f => { try { const r = await fetch(f, { cache: 'reload' }); if (r.ok) await c.put(new URL(f, self.location).href, r); } catch (_) {} }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isFont = u => u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

function withTimeout(p, ms) {
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);

  if (isFont(u)) {
    e.respondWith(caches.open(C).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      try { const r = await fetch(req); if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }
      catch (_) { return Response.error(); }
    }));
    return;
  }
  if (u.origin !== location.origin) return;

  const isShell = req.mode === 'navigate' || /\/(index\.html)?$/.test(u.pathname);
  if (isShell) {
    e.respondWith((async () => {
      const c = await caches.open(C);
      try {
        const r = await withTimeout(fetch(SHELL, { cache: 'no-cache' }), 4000);
        if (r && r.ok) { await c.put(SHELL, r.clone()); return r; }
        throw new Error('bad status ' + (r && r.status));
      } catch (_) {
        const hit = await c.match(SHELL);
        return hit || new Response('Offline and nothing cached yet.', { status: 503 });
      }
    })());
    return;
  }

  e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
    if (res && res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(req, cp)); }
    return res;
  })));
});
