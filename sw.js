const CACHE_NAME = 'tools-for-everyone-v6';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/theme.css',
  './assets/app.js',
  './assets/transcriber-worker.js',
  './assets/rewriter-worker.js',
  './assets/favicon.svg',
  './assets/fonts/geist-latin-wght-normal.woff2',
  './assets/fonts/geist-mono-latin-wght-normal.woff2',
  './PDF%20Suite/pdf_suite.html',
  './QR%20Code%20Studio/qr_code_studio.html',
  './Metadata%20Scrubber/metadata_scrubber.html',
  './Bulk%20File%20Renamer/bulk_rename.html',
  './Audio%20Transcriber/audio_transcriber.html',
  './Virtual%20Card%20Manager/virtual_card_manager.html',
  './Image%20Compressor/image_compressor.html',
  './Video%20Converter/video_converter.html',
  './Text%20Rewriter/text_rewriter.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Everything from this origin is network first, and the cache is refreshed on every
// success. The cache is read only when the network is genuinely unavailable, which is
// what keeps the tools working offline.
//
// Sub-resources used to be cache first. That meant a returning visitor kept the
// stylesheet from their previous visit until the service worker version changed and
// the page was loaded twice, so a redesign showed up as new markup wearing the old
// theme. Freshness matters more here than the few milliseconds cache first saved.
//
// Cross-origin CDN requests pass through untouched, letting the browser's own HTTP
// cache handle those.
function cacheFirstUpdate(req, res) {
  if (!res || !res.ok) return res;
  const copy = res.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
  return res;
}

// GitHub Pages serves this site with Cache-Control: max-age=600, so for ten minutes
// after a deploy the browser will happily reuse the previous copy of a page without
// asking the server. Going to the network is not enough on its own, because "the
// network" can still mean the browser's own HTTP cache. These force a real trip:
// pages are fetched outright, everything else revalidates and takes a cheap 304 when
// nothing has changed.
function networkRequest(req, mode) {
  try {
    return new Request(req.url, { cache: mode, credentials: 'same-origin' });
  } catch (e) {
    return req;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(networkRequest(req, 'reload'))
        .then((res) => cacheFirstUpdate(req, res))
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    fetch(networkRequest(req, 'no-cache'))
      .then((res) => cacheFirstUpdate(req, res))
      .catch(() => caches.match(req))
  );
});
