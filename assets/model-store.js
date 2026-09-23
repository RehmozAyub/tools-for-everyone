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

// The resumable downloader below writes smaller pieces, because a piece is also the
// unit a broken download resumes from: at 16MB an interrupted download loses at most
// that much. Readers do not care, since each record says how many pieces it has.
const DOWNLOAD_CHUNK_BYTES = 16 * 1024 * 1024;

// Bookkeeping kept in the chunks store beside the pieces themselves, so removing a
// model by its address clears these too, and the database needs no new version (a
// version bump would lock out any other tab still holding the old one open).
const PARTIAL_MARK = '#partial';
const MANIFEST_MARK = '#manifest';

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
    // The failing request carries the real error (QuotaExceededError when the disk is
    // full); the transaction's own is not always set yet when this fires.
    tx.onerror = (ev) => reject((ev && ev.target && ev.target.error) || tx.error || new Error('The model store could not be written.'));
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
  // Pieces of a download that never finished have no record yet, and still belong to
  // a model, so they count here too.
  try {
    const keys = await run(CHUNKS, 'readonly', (store) => asValue(store.getAllKeys()));
    for (const key of keys || []) if (typeof key === 'string') add(key);
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
  await run(CHUNKS, 'readwrite', (store) => store.delete(url + PARTIAL_MARK));
}

// The record is written last, so a download cut off half way leaves orphaned chunks
// rather than a file that claims to be complete.
async function finish(url, total, type, chunks) {
  await run(FILES, 'readwrite', (store) => store.put({
    url: url,
    size: total,
    type: type || 'application/octet-stream',
    chunks: chunks || Math.max(1, Math.ceil(total / CHUNK_BYTES)),
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
  if (!index) {
    await run(CHUNKS, 'readwrite', (store) => store.put(new Blob([]), chunkKey(url, 0)));
    index = 1;
  }
  await finish(url, total, type, index);
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

/* ---------- Knowing when a model is whole ----------

   A model is several files, and one of them can be tiny while the weights sit in
   another: Llama 3.2 3B keeps 260KB in model_q4f16.onnx and 2.4GB in the two data
   files beside it. Counting a model as saved because "some .onnx file is here" let an
   interrupted download pass as complete. The list of files a model needs, with their
   sizes, is kept here once it is known, and a model is whole only when every one of
   them is held at its full size. */

export async function setManifest(prefix, files) {
  const clean = (files || []).map((f) => ({ path: String(f.path), size: Number(f.size) || 0 }));
  await run(CHUNKS, 'readwrite', (store) => store.put({ files: clean, saved: Date.now() }, prefix + MANIFEST_MARK));
}

export async function getManifest(prefix) {
  try {
    const value = await run(CHUNKS, 'readonly', (store) => asValue(store.get(prefix + MANIFEST_MARK)));
    return value && Array.isArray(value.files) && value.files.length ? value.files : null;
  } catch (e) {
    return null;
  }
}

export async function partialOf(url) {
  try {
    const value = await run(CHUNKS, 'readonly', (store) => asValue(store.get(url + PARTIAL_MARK)));
    return value && typeof value.bytes === 'number' ? value : null;
  } catch (e) {
    return null;
  }
}

async function allPartials() {
  const found = new Map();
  try {
    const keys = await run(CHUNKS, 'readonly', (store) => asValue(store.getAllKeys()));
    for (const key of keys || []) {
      if (typeof key !== 'string' || !key.endsWith(PARTIAL_MARK)) continue;
      const url = key.slice(0, -PARTIAL_MARK.length);
      const value = await partialOf(url);
      if (value) found.set(url, value);
    }
  } catch (e) { /* nothing yet */ }
  return found;
}

// Bytes of downloads that were started and not finished, under one model.
export async function partialBytesFor(prefix) {
  let total = 0;
  for (const [url, value] of await allPartials()) {
    if (url.startsWith(prefix)) total += value.bytes || 0;
  }
  return total;
}

/* How much of a model is here. `expected` is the list of { path, size } it needs;
   without one, the stored manifest is used, and without either the answer can only
   say what is held. */
export async function modelStatus(prefix, expected) {
  const need = expected && expected.length ? expected : await getManifest(prefix);
  const files = await filesFor(prefix);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const partials = await allPartials();
  let held = 0;
  let total = 0;
  const missing = [];
  if (need) {
    for (const want of need) {
      total += want.size || 0;
      const have = byPath.get(want.path);
      // Files in the old Cache Storage report no size; they were whole when stored.
      const whole = have && (have.where === 'cache' || !want.size || have.size === want.size);
      if (whole) {
        held += want.size || have.size || 0;
      } else {
        const part = partials.get(prefix + want.path);
        held += part ? Math.min(part.bytes, want.size || part.bytes) : 0;
        missing.push(want.path);
      }
    }
  } else {
    for (const f of files) held += f.size || 0;
    for (const [url, value] of partials) if (url.startsWith(prefix)) held += value.bytes || 0;
  }
  return {
    known: !!need,
    complete: !!need && missing.length === 0,
    held: held,
    total: total,
    missing: missing,
  };
}

/* ---------- Downloading so that a broken connection is not a restart ----------

   Hugging Face serves model files with byte ranges (Accept-Ranges: bytes, and the
   CDN it redirects to answers 206 with an open CORS policy), so a download that was
   cut off asks for the rest rather than starting again. Each piece is stored with a
   note of how far the file has got, in one transaction, so the note never claims
   more than what is actually on the disk. */

export async function downloadFile(url, options = {}) {
  const expected = Number(options.size) || 0;
  const onBytes = options.onBytes || (() => {});
  const signal = options.signal;
  const fetcher = options.fetch || ((u, init) => fetch(u, init));
  const pieceBytes = Number(options.chunkBytes) || DOWNLOAD_CHUNK_BYTES;

  const record = await entry(url);
  if (record && (!expected || record.size === expected)) return { skipped: true, size: record.size };

  let attempts = 0;
  for (;;) {
    try {
      return await downloadOnce(url, expected, onBytes, signal, fetcher, pieceBytes);
    } catch (e) {
      attempts += 1;
      const aborted = (signal && signal.aborted) || (e && e.name === 'AbortError');
      const quota = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
      if (aborted || quota || attempts > 2 || (e && e.fatal)) throw e;
      // A dropped connection is worth two more tries from wherever it got to.
      await new Promise((r) => setTimeout(r, 1500 * attempts));
    }
  }
}

async function downloadOnce(url, expected, onBytes, signal, fetcher, pieceBytes) {
  let part = await partialOf(url);
  if (part && expected && part.total && part.total !== expected) {
    onBytes(-part.bytes);
    await clearPartial(url);
    part = null;
  }
  let offset = part ? part.bytes : 0;
  let index = part ? part.chunks : 0;

  const headers = {};
  if (offset > 0) headers.Range = 'bytes=' + offset + '-';
  const response = await fetcher(url, { headers: headers, signal: signal, cache: 'no-store' });
  if (!response.ok) {
    const err = new Error('The download failed: the server answered ' + response.status + '.');
    if (response.status === 404 || response.status === 401 || response.status === 403) err.fatal = true;
    if (response.status === 416 && part) await clearPartial(url);
    throw err;
  }

  const etag = response.headers.get('etag') || '';
  let total = expected;
  // Only a ranged answer states the full size for certain. A whole file may arrive
  // compressed, and then its Content-Length is not the size that gets stored.
  let mustMatch = 0;
  if (response.status === 206) {
    const range = /bytes\s+(\d+)-\d+\/(\d+)/.exec(response.headers.get('content-range') || '');
    const start = range ? Number(range[1]) : -1;
    const whole = range ? Number(range[2]) : 0;
    const changed = start !== offset
      || (part && part.etag && etag && part.etag !== etag)
      || (expected && whole && whole !== expected);
    if (changed) {
      // The file on the server is not the one the stored pieces came from.
      try { await response.body.cancel(); } catch (e) { /* already closed */ }
      onBytes(-offset);
      await clearPartial(url);
      return downloadOnce(url, expected, onBytes, signal, fetcher, pieceBytes);
    }
    total = whole || total;
    mustMatch = whole;
  } else {
    // The server sent the whole file, whatever was asked for, so start from nothing.
    if (offset > 0) onBytes(-offset);
    offset = 0;
    index = 0;
    // If the file changed since its size was noted, the new one is what gets stored,
    // and the caller records its new size.
    const length = Number(response.headers.get('content-length')) || 0;
    total = expected || length;
  }

  const type = response.headers.get('content-type') || 'application/octet-stream';
  const reader = response.body.getReader();
  let pending = [];
  let pendingBytes = 0;

  const flush = async () => {
    if (!pendingBytes) return;
    const chunk = new Blob(pending, { type: 'application/octet-stream' });
    const next = { bytes: offset + pendingBytes, chunks: index + 1, total: total, etag: etag, type: type };
    const at = index;
    await run(CHUNKS, 'readwrite', (store) => {
      store.put(chunk, chunkKey(url, at));
      store.put(next, url + PARTIAL_MARK);
    });
    offset += pendingBytes;
    index += 1;
    pending = [];
    pendingBytes = 0;
  };

  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    pending.push(step.value);
    pendingBytes += step.value.byteLength;
    onBytes(step.value.byteLength);
    if (pendingBytes >= pieceBytes) await flush();
  }
  await flush();

  if (mustMatch && offset !== mustMatch) {
    throw new Error('The download ended early, at ' + offset + ' of ' + total + ' bytes.');
  }
  if (!index) {
    await run(CHUNKS, 'readwrite', (store) => store.put(new Blob([]), chunkKey(url, 0)));
    index = 1;
  }
  await finish(url, offset, type, index);
  await run(CHUNKS, 'readwrite', (store) => store.delete(url + PARTIAL_MARK));
  return { skipped: false, size: offset };
}

async function clearPartial(url) {
  const part = await partialOf(url);
  const count = part ? part.chunks : 0;
  await run(CHUNKS, 'readwrite', (store) => {
    for (let i = 0; i < count; i++) store.delete(chunkKey(url, i));
    store.delete(url + PARTIAL_MARK);
  });
}

/* Pieces that nothing points at: left by an older version of this page when a
   download was cut off (it kept no note to resume from), or by a file written again
   with fewer pieces than before. They can never be read, so they only take up room.
   Returns the number of bytes freed. */
export async function sweepOrphans() {
  let freed = 0;
  try {
    const keys = await run(CHUNKS, 'readonly', (store) => asValue(store.getAllKeys()));
    const records = await run(FILES, 'readonly', (store) => asValue(store.getAll()));
    const recorded = new Map((records || []).map((r) => [r.url, r.chunks]));
    const partials = await allPartials();
    for (const key of keys || []) {
      if (typeof key !== 'string') continue;
      if (key.endsWith(PARTIAL_MARK) || key.endsWith(MANIFEST_MARK)) continue;
      const hash = key.lastIndexOf('#');
      if (hash < 0) continue;
      const url = key.slice(0, hash);
      const n = Number(key.slice(hash + 1));
      if (!Number.isInteger(n)) continue;
      const limit = recorded.has(url) ? recorded.get(url) : (partials.has(url) ? partials.get(url).chunks : 0);
      if (n < limit) continue;
      // Checked again inside the write, so a download running in another tab that
      // has just reached this piece keeps it.
      freed += await run(CHUNKS, 'readwrite', (store) => {
        const out = { value: 0 };
        const note = store.get(url + PARTIAL_MARK);
        note.onsuccess = () => {
          if (note.result && n < note.result.chunks) return;
          const piece = store.get(key);
          piece.onsuccess = () => {
            out.value = (piece.result && piece.result.size) || 0;
            store.delete(key);
          };
        };
        return out;
      }) || 0;
    }
  } catch (e) { /* nothing to sweep */ }
  return freed;
}

// A stored file one piece at a time, so a large one can be streamed into a zip
// without ever being held whole.
export async function* piecesOf(url) {
  const record = await entry(url);
  if (record) {
    for (let i = 0; i < record.chunks; i++) {
      const part = await run(CHUNKS, 'readonly', (store) => asValue(store.get(chunkKey(url, i))));
      if (!part) throw new Error('Part of ' + url.split('/').pop() + ' is missing from this device.');
      yield part;
    }
    return;
  }
  const legacy = await readFile(url);
  if (legacy) yield legacy;
}

// Everything stored, for the "models use" line.
export async function totalBytes() {
  let total = 0;
  try {
    const records = await run(FILES, 'readonly', (store) => asValue(store.getAll()));
    for (const r of records || []) total += r.size || 0;
  } catch (e) { /* nothing yet */ }
  for (const value of (await allPartials()).values()) total += value.bytes || 0;
  return total;
}

// Writing a file from a stream, for loading a saved model without holding it whole.
export async function writeFromStream(url, stream, type) {
  await writeStream(url, stream, type);
}
