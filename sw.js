// Offline cache.
// App files (page, styles, script, program data): always try the network first so an update
// shows on the next open, and fall back to the saved copy when offline or slow.
// Photos, icons and fonts: saved copy first, they don't change.
const CACHE = 'training-v13';
const CORE = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest',
  'data/program.json', 'data/howto.json', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  // cache:'reload' skips the browser's own 10-minute cache, so a new version is really new
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === location.origin;
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !fonts) return; // YouTube etc. go straight to the network

  const staticFile = fonts || /\/(photos|icons)\//.test(url.pathname);
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: sameOrigin });
    if (staticFile) {
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res && (res.ok || res.type === 'opaque')) cache.put(e.request, res.clone());
      return res;
    }
    const fresh = fetch(e.request.url, { cache: 'no-cache' }).then(res => {
      if (res && res.ok) cache.put(e.request, res.clone());
      return res;
    });
    if (!hit) return fresh;
    // saved copy if the network fails or takes longer than 3 s
    const slow = new Promise(r => setTimeout(() => r(hit), 3000));
    return Promise.race([fresh.catch(() => hit), slow]);
  }));
});
