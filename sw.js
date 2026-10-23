const CACHE_NAME = 'pauper-deck-arena-v6';
const FONT_CACHE = 'pauper-fonts-v1';
const CDN_CACHE = 'pauper-cdn-v1';

// The app cannot start offline without these: if one fails, the new version does not install.
const SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/base.css',
  '/css/shell.css',
  '/css/controls.css',
  '/css/cards.css',
  '/css/deck-cards.css',
  '/css/analysis.css',
  '/css/log.css',
  '/css/forms.css',
  '/css/colour.css',
  '/css/views.css',
  '/js/register-sw.js',
  '/js/config.js',
  '/js/data.js',
  '/js/state.js',
  '/js/analytics.js',
  '/js/format.js',
  '/js/arena.js',
  '/js/arena-insights.js',
  '/js/arena-decks.js',
  '/js/arena-history.js',
  '/js/arena-logger.js',
  '/js/arena-undo.js',
  '/js/arena-shell.js',
  '/js/arena-data.js',
  '/js/main.js'
];

// Nice to have offline. A missing image must not block an update, so each is cached on its own.
const ASSETS = [
  '/Imgs/icons/icon-192.png',
  '/Imgs/icons/icon-512.png',
  '/Imgs/logo.png',
  '/Imgs/mana/W.png',
  '/Imgs/mana/U.png',
  '/Imgs/mana/B.png',
  '/Imgs/mana/R.png',
  '/Imgs/mana/G.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(SHELL);
        await Promise.allSettled(ASSETS.map((asset) => cache.add(asset)));
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== FONT_CACHE && key !== CDN_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (!url.protocol.startsWith('http')) return;

  // Google Fonts CSS — stale-while-revalidate so new font weights are picked up
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        const networkFetch = fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            cache.put(event.request, response.clone());
          }
          return response;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // Google Fonts woff2 files — cache-first (font binaries never change for a given URL)
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response && response.status === 200) {
          cache.put(event.request, response.clone());
        }
        return response;
      })
    );
    return;
  }

  // Tesseract CDN — cache-first (versioned URLs don't change)
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response && response.status === 200) {
          cache.put(event.request, response.clone());
        }
        return response;
      })
    );
    return;
  }

  // All other cross-origin requests pass through (e.g., Tesseract workers, traineddata)
  if (url.origin !== self.location.origin) return;

  // The page, its scripts and styles ship together, so they are always fetched as a set: a new page must never run old code.
  const isHtml = event.request.mode === 'navigate' || /\.(html|js|css)$/.test(url.pathname) || url.pathname.endsWith('manifest.json');

  if (isHtml) {
    // Network-first for HTML, scripts, styles and manifest: always fetch fresh, fallback to cache
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return response;
        })
        .catch(async () => {
          // This page if it was saved, otherwise the app shell. '/' comes before '/index.html' because
          // the host redirects the latter, and a redirected response cannot answer a page navigation.
          return (await caches.match(event.request))
            || (await caches.match('/'))
            || caches.match('/index.html');
        })
    );
  } else {
    // Stale-while-revalidate for same-origin assets: answer from the cache at once and refresh it in the
    // background. The images keep their file names when they change, so cache-first would show the old
    // one until the next release.
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        const refresh = fetch(event.request).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            event.waitUntil(cache.put(event.request, response.clone()));
          }
          return response;
        });
        if (cached) {
          event.waitUntil(refresh.catch(() => {}));
          return cached;
        }
        return refresh.catch(() => Response.error());
      })
    );
  }
});
