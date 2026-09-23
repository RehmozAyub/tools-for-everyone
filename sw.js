const CACHE_NAME = 'tools-for-everyone-v12';
// Libraries from the CDNs live in their own cache. Every one of them is pinned to
// an exact version, so a copy never goes stale and does not need to be dropped
// when the site itself changes.
const CDN_CACHE = 'tfe-cdn-v1';
const OWN_CACHES = [CACHE_NAME, CDN_CACHE];
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/theme.css',
  './assets/app.js',
  './assets/transcriber-worker.js',
  './assets/chat-worker.js?v=3',
  './assets/model-store.js',
  './assets/favicon.svg',
  './assets/icon-192.png',
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
  './Private%20AI%20Chat/private_ai_chat.html',
  // Scripts the tool pages load from their own folders.
  './Image%20Compressor/compress-worker.js',
  './Image%20Compressor/compress-core.js',
  './Bulk%20File%20Renamer/renamer-core.js',
  './Metadata%20Scrubber/scrub-engine.js',
  './Audio%20Transcriber/model-cache.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // Each file is added on its own: addAll fails as a whole when one file is
    // missing, which would leave nothing cached at all.
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(APP_SHELL.map((path) => cache.add(path).catch(() => {}))))
      .catch(() => {})
  );
  self.skipWaiting();
});

// Only this site's own old caches are removed. Other caches on this origin belong
// to the tools themselves (transformers.js keeps downloaded models in
// "transformers-cache"), and wiping them on every deploy would make people
// download a model again each time the site changes.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names
        .filter((n) => (n.indexOf('tools-for-everyone-') === 0 || n.indexOf('tfe-cdn-') === 0) && OWN_CACHES.indexOf(n) === -1)
        .map((n) => caches.delete(n)))
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

// ---------- Libraries from the CDNs ----------
//
// pdf-lib, pdf.js and its worker, jszip, exifr, jsQR, qrcode-generator, the ffmpeg
// core, transformers.js with its onnxruntime wasm, and the icon font all come from
// jsDelivr or cdnjs. Leaving them to the browser's HTTP cache meant "works offline"
// held only until that cache was evicted. Anything with an exact version in its
// address never changes, so it is served cache first from CDN_CACHE.
//
// Model weights from huggingface.co are not touched: transformers.js and the chat's
// own model store keep those, and they are far too big to copy twice.
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];
const PINNED = /@\d+\.\d+\.\d+|\/\d+\.\d+\.\d+(\/|$)/;

// The Video Converter keeps the 31 MB ffmpeg core and Mediabunny in caches of its
// own, so storing them here as well would only double the space they take.
const SELF_CACHED = /\/@ffmpeg\/core@|\/mediabunny@/;

function isPinnedCdn(url) {
  return CDN_HOSTS.indexOf(url.hostname) !== -1 && PINNED.test(url.pathname) && !SELF_CACHED.test(url.pathname);
}

function cacheable(res) {
  return !!res && (res.ok || res.type === 'opaque');
}

// Script and stylesheet tags without a crossorigin attribute make no-cors requests,
// which come back opaque: unreadable, and counted at a padded size against storage.
// Both CDNs send Access-Control-Allow-Origin: *, so the copy is fetched with CORS
// instead, which a no-cors request can use as well. If that fails for any reason the
// original request goes out unchanged.
function fetchForCache(req) {
  if (req.mode !== 'no-cors') return fetch(req);
  let corsReq;
  try {
    corsReq = new Request(req.url, { mode: 'cors', credentials: 'omit' });
  } catch (e) {
    return fetch(req);
  }
  return fetch(corsReq).then((res) => (res && res.ok ? res : fetch(req)), () => fetch(req));
}

function cdnCacheFirst(req) {
  return caches.open(CDN_CACHE).then((cache) =>
    cache.match(req).then((hit) => {
      // An opaque copy cannot answer a CORS request (a module import, fetch()),
      // so that case goes to the network and replaces the copy.
      if (hit && !(hit.type === 'opaque' && req.mode === 'cors')) return hit;
      return fetchForCache(req).then((res) => {
        if (cacheable(res)) cache.put(req, res.clone()).catch(() => {});
        return res;
      }, (err) => hit || Promise.reject(err));
    })
  ).catch(() => fetch(req));
}

// Google Fonts, should a page ever use them: the font files are versioned and never
// change, the stylesheet is refreshed in the background.
function fontsStaleWhileRevalidate(req) {
  return caches.open(CDN_CACHE).then((cache) =>
    cache.match(req).then((hit) => {
      const fresh = fetch(req).then((res) => {
        if (cacheable(res)) cache.put(req, res.clone()).catch(() => {});
        return res;
      });
      if (hit) {
        fresh.catch(() => {});
        return hit;
      }
      return fresh;
    })
  );
}

// ---------- Share target ----------
//
// Installed as an app, the site appears in the system share sheet for PDFs and
// images (see share_target in manifest.json). The shared files are put in the same
// IndexedDB store the tools use to hand files to each other, then the home page
// opens with ?handoff=1 and asks what to do with them.
const HANDOFF_DB = 'tfe-handoff';
const HANDOFF_STORE = 'files';

function putHandoff(files) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(HANDOFF_DB, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(HANDOFF_STORE)) open.result.createObjectStore(HANDOFF_STORE);
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(HANDOFF_STORE, 'readwrite');
      tx.objectStore(HANDOFF_STORE).put({ files, ts: Date.now() }, 'pending');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}

function handleShare(req) {
  const home = new URL('./index.html', self.registration.scope);
  return req.formData().then((form) => {
    const files = form.getAll('files').filter((f) => f && typeof f === 'object' && typeof f.size === 'number');
    if (!files.length) return Response.redirect(home.href, 303);
    return putHandoff(files).then(() => {
      home.searchParams.set('handoff', '1');
      return Response.redirect(home.href, 303);
    });
  }).catch(() => Response.redirect(home.href, 303));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method === 'POST' && url.origin === self.location.origin && /\/share-target\/?$/.test(url.pathname)) {
    event.respondWith(handleShare(req));
    return;
  }

  // Never cache anything other than GET, and leave ranged requests alone.
  if (req.method !== 'GET' || req.headers.has('range')) return;

  if (url.origin !== self.location.origin) {
    if (isPinnedCdn(url)) {
      event.respondWith(cdnCacheFirst(req));
    } else if (url.hostname === 'fonts.gstatic.com') {
      event.respondWith(cdnCacheFirst(req));
    } else if (url.hostname === 'fonts.googleapis.com') {
      event.respondWith(fontsStaleWhileRevalidate(req));
    }
    // Everything else (huggingface.co models, the OpenAI API, anything unpinned)
    // passes through untouched.
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(networkRequest(req, 'reload'))
        .then((res) => cacheFirstUpdate(req, res))
        .catch(() =>
          caches.match(req)
            .then((cached) => cached || caches.match(req, { ignoreSearch: true }))
            .then((cached) => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  event.respondWith(
    fetch(networkRequest(req, 'no-cache'))
      .then((res) => cacheFirstUpdate(req, res))
      .catch(() => caches.match(req))
  );
});
