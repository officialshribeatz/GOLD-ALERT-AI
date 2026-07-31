/* This service worker handles push notifications even when the app/tab is
   closed or the phone is locked. It must live at the site root. */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
importScripts('firebase-config.js');

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || '🔔 Gold Alert AI';
  const options = {
    body: payload.notification?.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png'
  };
  self.registration.showNotification(title, options);
});

// Tapping a background push notification should open/focus the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientsArr => {
      const appUrl = self.registration.scope;
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
