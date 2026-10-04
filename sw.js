// Service worker : jeu jouable hors ligne. Incrémenter VERSION à chaque déploiement modifiant les assets.
const VERSION = 'v2';
const CACHE = `solitaire-${VERSION}`;
const ASSETS = [
  '/', '/index.html', '/css/style.css',
  '/js/app.js', '/js/game.js', '/js/storage.js',
  '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Stale-while-revalidate : réponse instantanée depuis le cache, mise à jour en arrière-plan
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached);
      e.waitUntil(network.catch(() => {}));
      return cached || network;
    }),
  );
});
