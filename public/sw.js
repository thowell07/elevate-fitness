const CACHE_NAME = 'elevate-shell-v5';
const APP_SHELL = ['/', '/manifest.webmanifest', '/icons/elevate-icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('elevate-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Only public application assets enter the shell cache. Auth/API responses do not.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode !== 'navigate' && !url.pathname.startsWith('/assets/') && !url.pathname.startsWith('/icons/') && url.pathname !== '/manifest.webmanifest') return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request.mode === 'navigate' ? '/' : event.request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(event.request.mode === 'navigate' ? '/' : event.request)) || Response.error()));
});
