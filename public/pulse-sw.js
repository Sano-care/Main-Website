// Pulse v1 Phase 1 — minimal service worker (registration only, no caching)
// Phase 2 may add offline fallback for /pulse home
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* pass through */ });
