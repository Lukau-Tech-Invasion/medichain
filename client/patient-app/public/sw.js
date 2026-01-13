/**
 * MediChain Patient App Service Worker
 * 
 * Provides offline support for patient medical information.
 * Prioritizes caching critical emergency data.
 */

const CACHE_NAME = 'medichain-patient-v1';
const STATIC_CACHE = 'medichain-patient-static-v1';
const DATA_CACHE = 'medichain-patient-data-v1';

// Static assets to cache
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[Patient SW] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Patient SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('medichain-patient-') && 
                          name !== STATIC_CACHE && 
                          name !== DATA_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Medical ID endpoint - always cache for offline emergency access
  if (url.pathname.includes('/api/medical-id/') || 
      url.pathname.includes('/api/my-records')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clonedResponse = response.clone();
            caches.open(DATA_CACHE).then((cache) => {
              cache.put(request, clonedResponse);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            return new Response(
              JSON.stringify({
                success: false,
                error: 'Offline - cached data unavailable',
                code: 'OFFLINE',
              }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            );
          });
        })
    );
    return;
  }

  // API requests - network first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Static assets - cache first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clonedResponse = response.clone();
          caches.open(STATIC_CACHE).then((cache) => {
            cache.put(request, clonedResponse);
          });
        }
        return response;
      });
    }).catch(() => {
      if (request.mode === 'navigate') {
        return caches.match('/offline.html');
      }
    })
  );
});

// Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    vibrate: [200, 100, 200],
    tag: data.tag || 'patient-notification',
    data: data.data || {},
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'MediChain', options)
  );
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
