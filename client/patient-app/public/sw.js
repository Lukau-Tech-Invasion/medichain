/**
 * MediChain Patient App Service Worker
 * 
 * Provides offline support for patient medical information.
 * Prioritizes caching critical emergency data.
 */

const STATIC_CACHE = 'medichain-patient-static-v3';
const DATA_CACHE = 'medichain-patient-data-v3';

// Docker mounts this app at `/patient/`. Keep every cached and notification
// URL inside that scope instead of accidentally navigating to nginx's root.
const APP_BASE_URL = new URL('./', self.registration.scope);
const appPath = (path) => new URL(path.replace(/^\//, ''), APP_BASE_URL).pathname;
const OFFLINE_PAGE = appPath('offline.html');

// Static assets to cache
const STATIC_ASSETS = [
  appPath(''),
  appPath('index.html'),
  appPath('manifest.json'),
  OFFLINE_PAGE,
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[Patient SW] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      // Offline fallback is optional. A cache miss during a rolling deploy must
      // not leave a rejected service-worker installation behind.
      return cache.addAll(STATIC_ASSETS).catch(() => undefined);
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

  // DevTools and extensions may issue chrome-extension:// requests from a
  // controlled page. They must bypass this worker because Cache Storage only
  // supports HTTP(S) requests.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

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
        return caches.match(OFFLINE_PAGE);
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
    icon: appPath('medichain-icon.svg'),
    badge: appPath('medichain-icon.svg'),
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
  event.waitUntil(clients.openWindow(appPath('dashboard')));
});
