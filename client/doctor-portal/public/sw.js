/**
 * MediChain Service Worker
 *
 * Lets the portal open and work with no signal (owner request, 2026-11-04).
 *
 * VERSION 7 - the whole built app is stored on the first online visit, from
 * the build's `precache-manifest.json`, so every form opens offline, not just
 * the ones visited that day. Navigations fall back to the stored app shell.
 *
 * API requests are never answered from here. Version 5 turned an unreachable
 * API read into a `503 OFFLINE` reply; to the app that is the server answering,
 * not a lost connection, so the client kept believing it was online and the
 * offline search and chart never took over. Patient data is also never
 * put in Cache Storage: the day's patients live sealed in IndexedDB
 * (`offlineRoster.ts`), deleted at sign-out, which a response cache is not.
 */

const CACHE_VERSION = 'v7';
const STATIC_CACHE = `medichain-static-${CACHE_VERSION}`;

// The doctor portal can be served below a prefix (`/doctor/` in Docker), so
// root-relative paths would fetch the nginx root rather than this portal.
// A service worker's scope is the deployment-owned source of truth.
const APP_BASE_URL = new URL('./', self.registration.scope);
const appPath = (path) => new URL(path.replace(/^\//, ''), APP_BASE_URL).pathname;
const OFFLINE_PAGE = appPath('offline.html');
const APP_SHELL = appPath('index.html');
const ASSETS_PREFIX = appPath('assets/');

// Files outside the bundle that the shell needs.
// Lookups ignore `Vary`. A module script is requested with an `Origin` header
// and the stored copy (fetched by the worker at install) without one; a server
// answering `Vary: Origin` (or `Accept-Encoding`) made every lookup miss, so the
// app came up blank offline although every file was stored.
const MATCH = { ignoreVary: true };

const STATIC_ASSETS = [OFFLINE_PAGE, APP_SHELL, appPath('medichain.svg'), appPath('manifest.json')];

/** Every file of this build, or none when there is no manifest (the dev server). */
async function buildFiles() {
  try {
    const response = await fetch(appPath('precache-manifest.json'), { cache: 'no-store' });
    if (!response.ok) return [];
    const manifest = await response.json();
    return (manifest.files || []).map((file) => appPath(file));
  } catch {
    return [];
  }
}

// Install: store the shell and the whole build. One file failing (a rolling
// deploy) must not fail the install; it is fetched again when first used.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const files = [...new Set([...STATIC_ASSETS, ...(await buildFiles())])];
    await Promise.all(files.map((file) => cache.add(file).catch(() => undefined)));
  })());
  self.skipWaiting();
});

// Activate: remove every older MediChain cache.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names
        .filter((name) => name.startsWith('medichain-') && name !== STATIC_CACHE)
        .map((name) => caches.delete(name))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // External providers own their network and TLS errors.
  if (url.origin !== APP_BASE_URL.origin) return;
  if (request.method !== 'GET') return;
  // Cache Storage only accepts HTTP(S) requests.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  // The API is the network's alone (see the header comment).
  if (url.pathname.startsWith('/api/')) return;

  // Pages: the network when there is one, otherwise the stored app, which
  // routes itself. The offline page only if the app was never stored.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(APP_SHELL, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(APP_SHELL, MATCH)) || (await caches.match(OFFLINE_PAGE, MATCH))
          || new Response('Offline', { status: 503 }))
    );
    return;
  }

  // Built files are content-hashed and never change: stored copy first.
  if (url.pathname.startsWith(ASSETS_PREFIX)) {
    event.respondWith(
      caches.match(request, MATCH).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      }))
    );
    return;
  }

  // Anything else of the app's own (icons, manifest): network, then stored.
  event.respondWith(
    fetch(request).catch(async () => (await caches.match(request, MATCH)) || new Response('Offline', { status: 503 }))
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
    icon: appPath('medichain.svg'),
    badge: appPath('medichain.svg'),
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
  let url = appPath('dashboard');

  if (data.url) {
    url = data.url;
  } else if (data.patient_id) {
    url = appPath(`patients/${data.patient_id}`);
  }

  event.waitUntil(
    clients.openWindow(url)
  );
});
