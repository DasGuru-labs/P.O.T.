// POT offline support.
// - Opening the app: ask GitHub for the newest copy (skipping the phone's 10-minute file cache),
//   wait up to 4 seconds, otherwise use the saved copy so the app still opens at the gym.
// - Safari shows a blank page if a service worker hands it a redirected response
//   (GitHub redirects /P.O.T. to /P.O.T./), so redirected responses are rebuilt as plain ones.
const CACHE = 'pot-v15';
const CORE = ['./index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function clean(r) {
  if (!r || !r.redirected) return r;
  const body = await r.blob();
  return new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers });
}
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const r = await clean(await withTimeout(fetch(req.url, { cache: 'no-store', credentials: 'same-origin' }), 4000));
        if (r && r.ok) { const c = await caches.open(CACHE); c.put('./index.html', r.clone()); return r; }
        throw new Error('bad response');
      } catch (err) {
        const cached = await caches.match('./index.html');
        return cached || fetch('./index.html').then(clean);
      }
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      try {
        const r = await clean(await withTimeout(fetch(req, { cache: 'no-cache' }), 4000));
        if (r && r.ok) { const c = await caches.open(CACHE); c.put(req, r.clone()); }
        return r;
      } catch (err) { return (await caches.match(req)) || Response.error(); }
    })());
    return;
  }

  // Fonts and other outside files: use the saved copy first, refresh it in the background.
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) caches.open(CACHE).then(c => c.put(req, r.clone())); return r; }).catch(() => null);
    return cached || (await net) || Response.error();
  })());
});
