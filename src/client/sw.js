// Service Worker for offline support
// Caches app shell and provides offline functionality

const CACHE_NAME = 'shopping-list-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/db.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install - cache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Skip non-GET requests and API calls
  if (request.method !== 'GET' || request.url.includes('/api/')) {
    return;
  }
  
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      
      return fetch(request).then((response) => {
        // Cache successful responses
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      }).catch(() => {
        // If fetch fails and not in cache, return offline fallback
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// Background sync for changes
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-shopping-list') {
    event.waitUntil(syncWithServer());
  }
});

async function syncWithServer() {
  // The actual sync happens in the client app
  // This just notifies clients to sync
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_NOW' });
  });
}