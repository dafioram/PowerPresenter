/* Service worker for Presentation Editor (spec §3.5).
 * Precaches the app shell so every feature works offline after the first load.
 * New versions install in the background and wait; the app shows
 * "Update ready — Reload" and only then tells the worker to take over. */
const VERSION = __VERSION__;
const PRECACHE = __PRECACHE__;
const APP_CACHE = 'pe-app-' + VERSION;
const FONT_CACHE = 'pe-fonts-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) =>
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      ),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('pe-app-') && k !== APP_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(APP_CACHE).then((cache) =>
        cache.match('./', { ignoreSearch: true }).then(
          (hit) => hit || fetch(req),
        ),
      ).catch(() => fetch(req)),
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        // Fonts for other scripts are downloaded on first use, then kept offline.
        if (res.ok && url.pathname.includes('/fonts/')) {
          const copy = res.clone();
          caches.open(FONT_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    }),
  );
});
