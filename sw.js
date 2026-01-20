const CACHE_NAME = 'ihis-v2.5';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/index.tsx',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  // Force the waiting service worker to become the active service worker.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Ensure that updates to the service worker take effect immediately.
  event.waitUntil(self.clients.claim());
});

// Bridge for UI-triggered notifications (Critical for Android reliability)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'TRIGGER_NOTIFICATION') {
    const { title, options } = event.data;
    event.waitUntil(
      self.registration.showNotification(title, {
        ...options,
        // Ensure standard Android behaviors
        badge: options.badge || 'https://i.imgur.com/SmEY27a.png',
        icon: options.icon || 'https://i.imgur.com/SmEY27a.png',
        vibrate: [100, 50, 100]
      })
    );
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clonedResponse = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clonedResponse);
        });
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        let client = clientList[0];
        for (let i = 0; i < clientList.length; i++) {
          if (clientList[i].focused) {
            client = clientList[i];
          }
        }
        return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});

self.addEventListener('push', (event) => {
  let data = {};

  try {
    // Android is strict: if the server sends a payload, we must parse it correctly.
    data = event.data ? event.data.json() : { title: 'IHIS Alert', body: 'New update in the Staff Gateway' };
  } catch (e) {
    // Fallback if data is sent as plain text instead of JSON
    data = { title: 'IHIS Alert', body: event.data ? event.data.text() : 'New update available' };
  }

  const options = {
    body: data.body || 'New update in the Staff Gateway',
    icon: 'https://i.imgur.com/SmEY27a.png', // Make sure these are direct .png links
    badge: 'https://i.imgur.com/SmEY27a.png',
    vibrate: [200, 100, 200],
    tag: 'ihis-notification', // Helps group notifications on Android
    renotify: true,           // Ensures phone vibrates even if a previous notification is present
    data: { dateOfArrival: Date.now() }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'IHIS Alert', options)
  );
});