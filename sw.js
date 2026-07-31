const CACHE_NAME = 'gold-alert-ai-v15';
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
  const url = event.request.url;

  // Live/dynamic data — never cache, always go straight to network.
  if(url.includes('goldprice.org') || url.includes('allorigins') || url.includes('corsproxy') || url.includes('gold-api.com') || url.includes('rss2json') || url.includes('mymemory') || url.includes('firebase') || url.includes('gstatic') || url.includes('rss')){
    return;
  }

  // App shell (index.html, script.js, manifest.json, etc.) — NETWORK-FIRST.
  // This is the key fix: previously this was cache-first, which meant once
  // a version was cached, the app kept serving that same old code forever
  // no matter how many times new code was committed on GitHub — Force
  // Update / clearing Chrome's cache was the only way to see changes.
  // Now every time the app is opened it tries to fetch the LATEST file from
  // the network first; only if that fails (phone is offline) does it fall
  // back to whatever was last cached, so the app still works without internet.
  event.respondWith(
    fetch(event.request, {cache:'no-store'})
      .then(networkRes => {
        // keep the cache fresh with whatever we just fetched, for offline fallback
        const resClone = networkRes.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
        return networkRes;
      })
      .catch(() => caches.match(event.request))
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
