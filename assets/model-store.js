/* Where downloaded models are kept.

   The obvious place is the Cache Storage the model library uses by default, and for
   a small model that works. It has one hard edge though: Chrome refuses any single
   entry of 256MB or more. Measured on this machine, 250MB stores and 256MB fails
   with "Unexpected internal error", and the library only warns about it, so a large
   model appeared to download and then quietly downloaded again on the next visit.
   Every chat model here is one file above that line, up to two gigabytes.

   IndexedDB has no such limit, so the models live there instead, split into chunks
   so no single value has to be enormous either. This module presents that store with
   the same two methods the Web Cache API has, which is exactly what transformers.js
   asks for when it is handed a custom cache.

   Anything already sitting in the old Cache Storage is still read, so a model
   downloaded by an earlier version of this page does not have to come down again. */

const DB_NAME = 'tools-for-everyone-models';
const DB_VERSION = 1;
const FILES = 'files';
const CHUNKS = 'chunks';
const LEGACY_CACHE = 'transformers-cache';

// Well under anything a browser objects to, and small enough that a failed write
// does not throw away much work.
const CHUNK_BYTES = 64 * 1024 * 1024;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'url' });
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('The model store is open in another tab.'));
  });
  return dbPromise;
}

function run(store, mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let result;
    try {
      result = work(tx.objectStore(store));
    } catch (e) {
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(result && result.value !== undefined ? result.value : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('The write was rolled back.'));
  }));
}

function asValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function keyOf(request) {
  if (typeof request === 'string') return request;
  if (request && request.url) return request.url;
  return String(request);
}

function chunkKey(url, index) {
  return url + '#' + index;
}

/* ---------- Reading ---------- */

export async function entry(url) {
  try {
    return await run(FILES, 'readonly', (store) => asValue(store.get(url)));
  } catch (e) {
    return undefined;
  }
}

export async function blobOf(url) {
  const record = await entry(url);
  if (!record) return null;
  const parts = [];
  for (let i = 0; i < record.chunks; i++) {
    const part = await run(CHUNKS, 'readonly', (store) => asValue(store.get(chunkKey(url, i))));
    if (!part) return null;
    parts.push(part);
  }
  return new Blob(parts, { type: record.type || 'application/octet-stream' });
}

// Every file held for one model, newest store first and then the old Cache Storage,
// so a model downloaded before this change is still found.
export async function filesFor(prefix) {
  const found = [];
  const seen = new Set();
  try {
    const records = await run(FILES, 'readonly', (store) => asValue(store.getAll()));
    for (const record of records || []) {
      if (!record.url.startsWith(prefix)) continue;
      found.push({ url: record.url, path: record.url.slice(prefix.length), size: record.size, where: 'db' });
      seen.add(record.url);
    }
  } catch (e) { /* the store may not exist yet */ }

  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(LEGACY_CACHE);
      for (const request of await cache.keys()) {
        if (!request.url.startsWith(prefix) || seen.has(request.url)) continue;
        found.push({ url: request.url, path: request.url.slice(prefix.length), size: 0, where: 'cache' });
      }
    }
  } catch (e) { /* no cache storage here */ }

  return found;
}

// Every model the store holds, as the address the files of each one sit under. Used
// to find weights belonging to a model that is no longer offered, which nothing else
// could ever reach again.
export async function listModels() {
  const prefixes = new Set();
  const mark = '/resolve/main/';
  const add = (url) => {
    const at = url.indexOf(mark);
    if (at > 0) prefixes.add(url.slice(0, at + mark.length));
  };
  try {
    const keys = await run(FILES, 'readonly', (store) => asValue(store.getAllKeys()));
    for (const url of keys || []) if (typeof url === 'string') add(url);
  } catch (e) { /* the store may not exist yet */ }
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(LEGACY_CACHE);
      for (const request of await cache.keys()) add(request.url);
    }
  } catch (e) { /* no cache storage here */ }
  return Array.from(prefixes);
}

export async function bytesFor(prefix) {
  const files = await filesFor(prefix);
  return files.reduce((total, file) => total + (file.size || 0), 0);
}

// Reads a file back whichever store it landed in.
export async function readFile(url) {
  const fromDb = await blobOf(url);
  if (fromDb) return fromDb;
  try {
    const hit = await caches.open(LEGACY_CACHE).then((c) => c.match(url));
    if (hit) return await hit.blob();
  } catch (e) { /* nothing there */ }
  return null;
}

/* ---------- Writing ---------- */

export async function writeFile(url, blob, type) {
  const total = blob.size;
  const chunks = Math.max(1, Math.ceil(total / CHUNK_BYTES));
  for (let i = 0; i < chunks; i++) {
    const slice = blob.slice(i * CHUNK_BYTES, Math.min((i + 1) * CHUNK_BYTES, total));
    await run(CHUNKS, 'readwrite', (store) => store.put(slice, chunkKey(url, i)));
  }
  await finish(url, total, type || blob.type);
}

// The record is written last, so a download cut off half way leaves orphaned chunks
// rather than a file that claims to be complete.
async function finish(url, total, type) {
  await run(FILES, 'readwrite', (store) => store.put({
    url: url,
    size: total,
    type: type || 'application/octet-stream',
    chunks: Math.max(1, Math.ceil(total / CHUNK_BYTES)),
    saved: Date.now(),
  }));
}

/* Writing straight off the response, a chunk at a time.

   The obvious version asks the response for one Blob and slices that up, and for a
   file of a few hundred megabytes it is fine. The largest model here is a single two
   gigabyte file, and that version silently failed on it: the model ran, because the
   library already had the bytes, and then failed to store them, so it came down again
   on every visit. Reading the stream instead means nothing bigger than one chunk is
   ever held at once. */
async function writeStream(url, body, type) {
  const reader = body.getReader();
  let index = 0;
  let total = 0;
  let pending = [];
  let pendingBytes = 0;

  const flush = async () => {
    if (!pendingBytes) return;
    const chunk = new Blob(pending, { type: 'application/octet-stream' });
    pending = [];
    pendingBytes = 0;
    await run(CHUNKS, 'readwrite', (store) => store.put(chunk, chunkKey(url, index)));
    index += 1;
  };

  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    pending.push(step.value);
    pendingBytes += step.value.byteLength;
    total += step.value.byteLength;
    if (pendingBytes >= CHUNK_BYTES) await flush();
  }
  await flush();
  await finish(url, total, type);
}

export async function removeFile(url) {
  const record = await entry(url);
  if (record) {
    for (let i = 0; i < record.chunks; i++) {
      await run(CHUNKS, 'readwrite', (store) => store.delete(chunkKey(url, i)));
    }
  }
  await run(FILES, 'readwrite', (store) => store.delete(url));
  try {
    const cache = await caches.open(LEGACY_CACHE);
    await cache.delete(url);
  } catch (e) { /* nothing there */ }
}

export async function removeAll(prefix) {
  const files = await filesFor(prefix);
  for (const file of files) await removeFile(file.url);
  await sweepChunks(prefix);
  return files.length;
}

// A download cut off half way leaves chunks with no record naming them, and nothing
// would ever go looking for those again. Removing a model clears anything under its
// address, recorded or not, so an abandoned attempt cannot sit there taking up room.
async function sweepChunks(prefix) {
  try {
    const keys = await run(CHUNKS, 'readonly', (store) => asValue(store.getAllKeys()));
    for (const key of keys || []) {
      if (typeof key === 'string' && key.startsWith(prefix)) {
        await run(CHUNKS, 'readwrite', (store) => store.delete(key));
      }
    }
  } catch (e) { /* nothing to sweep */ }
}

/* ---------- The shape transformers.js asks for ---------- */

// Only match and put are used, and both have to behave like the Web Cache API:
// match answers undefined when it holds nothing, and put returns a promise that the
// library attaches a catch to.
export const cache = {
  async match(request) {
    const url = keyOf(request);
    if (!/^https?:/.test(url)) return undefined;
    const record = await entry(url);
    if (record) {
      const blob = await blobOf(url);
      if (blob) {
        return new Response(blob, {
          headers: { 'Content-Type': record.type, 'Content-Length': String(record.size) },
        });
      }
    }
    try {
      const hit = await caches.open(LEGACY_CACHE).then((c) => c.match(url));
      if (hit) return hit;
    } catch (e) { /* no cache storage here */ }
    return undefined;
  },

  async put(request, response) {
    const url = keyOf(request);
    if (!/^https?:/.test(url)) return;
    const type = response.headers.get('content-type') || 'application/octet-stream';
    if (response.body) {
      await writeStream(url, response.body, type);
      return;
    }
    await writeFile(url, await response.blob(), type);
  },
};
