// Optional resource cache worker. Explicit preloads write selected files into Cache Storage; ordinary successful
// downloads of art, fonts and media are recorded there too so the settings page reflects normal gameplay.

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE_PREFIX = 'sp-preload-';
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  const cacheable = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')
    || url.pathname.startsWith('/media/');
  const mayStore = cacheable && request.cache !== 'no-store' && !request.headers.has('range');
  event.respondWith((async () => {
    // reload/no-cache must reach the server, but successful art responses can still populate the app cache.
    if (request.cache !== 'reload' && request.cache !== 'no-store' && request.cache !== 'no-cache') {
      const hit = await caches.match(request, { cacheName: CACHE_NAME });
      if (hit) return hit;
    }
    const response = await fetch(request);
    if (mayStore && response.ok && response.status === 200) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      } catch { /* quota / range / shutdown: the network response still succeeds */ }
    }
    return response;
  })());
});
