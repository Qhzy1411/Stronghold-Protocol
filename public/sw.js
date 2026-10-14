// Optional resource cache worker. It never caches automatically: the settings cache manager writes selected files
// into Cache Storage, and ordinary requests only read those entries before falling back to the network.

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
  // Preserve the app's explicit revalidation requests for data and manifests.
  if (request.cache === 'reload' || request.cache === 'no-store' || request.cache === 'no-cache') {
    event.respondWith(fetch(request));
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
