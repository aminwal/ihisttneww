
const CACHE_NAME = 'ihis-sentinel-v6.2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/index.tsx',
  '/manifest.json',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
];

// Offline fallback for specific data-driven views
const OFFLINE_URL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('IHIS: Pre-caching Core Matrix Assets');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('IHIS: Purging Legacy Matrix Cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  event.waitUntil(self.clients.claim());
});

// Advanced Fetch Interceptor: Network-First with Offline Fallback for Data
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Strategy: Cache First for Static Assets, Network First for Dynamic Data
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse && ASSETS_TO_CACHE.some(asset => event.request.url.includes(asset))) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          // If successful, clone and put in dynamic cache
          const clonedResponse = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clonedResponse);
          });
          return networkResponse;
        })
        .catch(() => {
          // Offline handling: Return cached version or fallback page
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
          return new Response('Offline: Matrix Data Unavailable', { status: 503 });
        });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'TRIGGER_NOTIFICATION') {
    const { title, options } = event.data;
    event.waitUntil(
      self.registration.showNotification(title, {
        ...options,
        badge: options.badge || 'https://i.imgur.com/SmEY27a.png',
        icon: options.icon || 'https://i.imgur.com/SmEY27a.png',
        vibrate: [100, 50, 100]
      })
    );
  }
  
  // Specific command to pre-cache current timetable/handbook data
  if (event.data && event.data.type === 'PRE_CACHE_OFFLINE') {
     console.log('IHIS: Initializing Incremental Offline Sync');
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        let client = clientList[0];
        for (let i = 0; i < clientList.length; i++) {
          if (clientList[i].focused) { client = clientList[i]; }
        }
        return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});
