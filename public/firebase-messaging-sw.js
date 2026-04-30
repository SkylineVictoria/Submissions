/* global firebase */
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

let messaging = null;
let firebaseInitialized = false;

function ensureFirebaseInitialized(config) {
  if (firebaseInitialized) return;
  if (!config || !config.apiKey || !config.projectId || !config.messagingSenderId || !config.appId) return;
  firebase.initializeApp(config);
  messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const n = payload?.notification || {};
    const title = n.title || payload?.data?.title || 'Notification';
    const body = n.body || payload?.data?.message || '';
    const url = (payload?.data && payload.data.url) || n.link || '/';
    const type = (payload?.data && payload.data.type) || 'general';
    // icon helps Windows Action Center / macOS show a proper tile (not just a blank bubble).
    self.registration.showNotification(title, {
      body,
      data: { url: String(url) },
      tag: `signflow-${type}`,
      renotify: true,
      icon: '/vite.svg',
      badge: '/vite.svg',
    });
  });
  firebaseInitialized = true;
}

self.addEventListener('message', (event) => {
  const data = event?.data || {};
  if (data.type === 'FIREBASE_CONFIG') {
    ensureFirebaseInitialized(data.config);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification?.data && event.notification.data.url) || '/';
  let target;
  try {
    target = new URL(raw, self.location.origin).href;
  } catch {
    target = self.location.origin + (String(raw).startsWith('/') ? raw : '/' + raw);
  }
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(target);
      }
    })
  );
});

