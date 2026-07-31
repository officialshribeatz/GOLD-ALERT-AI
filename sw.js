const CACHE_NAME = 'gold-alert-ai-v8';
const ASSETS = [
  './index.html',
  './script.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network-first for live data (price/news), cache-first for static shell
  const url = event.request.url;
  if(url.includes('goldprice.org') || url.includes('allorigins') || url.includes('corsproxy') || url.includes('gold-api.com') || url.includes('rss2json') || url.includes('mymemory') || url.includes('firebase') || url.includes('gstatic') || url.includes('rss')){
    return; // let it hit network directly, don't cache live data
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// Tapping a notification should bring the app to the front (or open it fresh)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientsArr => {
      const appUrl = self.registration.scope; // e.g. .../gold-alert-ai/
      for (const client of clientsArr) {
        if (client.url.startsWith(appUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(appUrl);
      }
    })
  );
});
