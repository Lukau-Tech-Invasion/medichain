/**
 * MediChain Service Worker
 * 
 * Provides offline support for critical medical information.
 * Caches emergency medical data for offline access.
 * 
 * VERSION 3 - Force cache bust for hackathon demo
 */

const CACHE_VERSION = 'v3';
const CACHE_NAME = `medichain-${CACHE_VERSION}`;
const STATIC_CACHE = `medichain-static-${CACHE_VERSION}`;
const DATA_CACHE = `medichain-data-${CACHE_VERSION}`;

// Static assets to cache
const STATIC_ASSETS = [
  '/offline.html',
];

// API endpoints to cache for offline
const CACHEABLE_API = [
  '/health',
];

// Install event - cache static assets and skip waiting immediately
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker v3...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  // Force immediate activation - don't wait for old tabs to close
  self.skipWaiting();
});

// Activate event - AGGRESSIVELY clean up ALL old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker v3 - clearing ALL old caches...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            // Delete ALL old medichain caches that don't match current version
            return name.startsWith('medichain-') && 
                   !name.includes(CACHE_VERSION);
          })
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  // Take control of all clients immediately
  self.clients.claim();
});

// Fetch event - NETWORK FIRST for everything (get fresh content)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // For development/demo: Always try network first for ALL requests
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache API responses for offline, not static assets
        if (response.ok && url.pathname.startsWith('/api/') && 
            CACHEABLE_API.some(path => url.pathname.startsWith(path))) {
          const clonedResponse = response.clone();
          caches.open(DATA_CACHE).then((cache) => {
            cache.put(request, clonedResponse);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed - try cache as fallback
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Offline navigation - show offline page
          if (request.mode === 'navigate') {
            return caches.match('/offline.html');
          }
          // Return offline error for API
          if (url.pathname.startsWith('/api/')) {
            return new Response(
              JSON.stringify({
                success: false,
                error: 'You are offline. This data is not available.',
                code: 'OFFLINE',
              }),
              {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              }
            );
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// Background sync for offline form submissions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-medical-data') {
    event.waitUntil(syncMedicalData());
  }
});

async function syncMedicalData() {
  console.log('[SW] Syncing medical data...');
  // Get pending submissions from IndexedDB and send to server
  // Implementation depends on IndexedDB setup
}

// Push notifications for critical alerts
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || 'New notification',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    vibrate: [200, 100, 200],
    tag: data.tag || 'medichain-notification',
    data: data.data || {},
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'MediChain', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data;
  let url = '/dashboard';

  if (data.url) {
    url = data.url;
  } else if (data.patient_id) {
    url = `/patients/${data.patient_id}`;
  }

  event.waitUntil(
    clients.openWindow(url)
  );
});
