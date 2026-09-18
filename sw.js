// Self-destroying worker for the retired root scope. Any phone still carrying the
// old /nola-pocket/ worker picks this up on its next update check: it wipes the
// caches, unregisters itself, and moves open windows to the new app path.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
  await self.registration.unregister();
  const cs = await self.clients.matchAll({ type: 'window' });
  cs.forEach(c => { try { c.navigate(new URL('app/', self.location).href); } catch (_) {} });
})()));
