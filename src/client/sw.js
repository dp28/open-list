// Service Worker for offline support
// Caches app shell and provides offline functionality

const CACHE_NAME = 'shopping-list-mlknhs8f-10t6sm';
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
  console.log('[SW] Installing version:', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching assets...');
      return cache.addAll(ASSETS);
    }).then(() => {
      console.log('[SW] Skip waiting to activate immediately');
      return self.skipWaiting();
    })
  );
});

// Activate - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating version:', CACHE_NAME);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Claiming clients');
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
  
  // For navigation requests, always try network first, then fallback to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        // Update cache with fresh version
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      }).catch(() => {
        return caches.match(request).then((cached) => {
          return cached || caches.match('/index.html');
        });
      })
    );
    return;
  }
  
  // For other assets, use stale-while-revalidate strategy
  event.respondWith(
    caches.match(request).then((cached) => {
      // Return cached version immediately if available
      const fetchPromise = fetch(request).then((networkResponse) => {
        // Update cache with fresh version
        if (networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Network failed, we already returned cached version
        return cached;
      });
      
      // Return cached or fetch
      return cached || fetchPromise;
    })
  );
});

// Handle messages from the client
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    console.log('[SW] Received SKIP_WAITING, skipping wait...');
    self.skipWaiting();
  }
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
