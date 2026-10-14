// Todowork service worker — v3
// Network-first for navigation (always latest HTML), stale-while-revalidate for assets.
// Auto-activates on install and on SKIP_WAITING message so deployed updates apply instantly.

const CACHE = 'todowork-v3';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET.
  if (request.method !== 'GET') return;

  // Only handle http/https. chrome-extension://, moz-extension://, etc. are not cacheable
  // and trying to put them in the Cache API throws: "Request scheme 'chrome-extension' is unsupported."
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Skip Supabase API requests — always go to network.
  if (url.hostname.endsWith('.supabase.co')) return;

  // Network-first for navigation: always fetch the latest HTML so new deployments
  // appear without a manual refresh.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match('/'))
            .then(
              (cached) =>
                cached ||
                new Response(
                  '<!DOCTYPE html><meta charset="utf-8"><title>Offline</title>' +
                    '<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;' +
                    'justify-content:center;min-height:100vh;margin:0;color:#1a1a19;background:#fbfaff}' +
                    'p{text-align:center;font-size:1.125rem}</style>' +
                    '<p>You are offline. Reconnect to continue.</p>',
                  { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
                ),
            ),
        ),
    );
    return;
  }

  // Stale-while-revalidate for static assets: fast load from cache, fresh version in background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    }),
  );
});
