const CACHE_NAME = 'tools-for-everyone-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/theme.css',
  './PDF%20Suite/pdf_suite.html',
  './QR%20Code%20Studio/qr_code_studio.html',
  './Metadata%20Scrubber/metadata_scrubber.html',
  './Bulk%20File%20Renamer/bulk_rename.html',
  './Audio%20Transcriber/audio_transcriber.html',
  './Virtual%20Card%20Manager/virtual_card_manager.html',
  './Image%20Compressor/image_compressor.html',
  './Video%20Converter/video_converter.html',
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

// Page navigations: always try the network first so edits are never masked by a stale
// cache; fall back to the cached shell only when the network is genuinely unavailable.
// Sub-resources (CSS, etc.) from this origin: cache first, since they're versioned by
// the page's own cache-busting if it ever needs it. Cross-origin CDN requests pass
// through untouched, letting the browser's own HTTP cache handle those.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
