/* Where the offline transcriber keeps its Whisper models.

   transformers.js looks a model file up by the address it would download it from,
   `https://huggingface.co/<repo>/resolve/main/<file>`, and by default keeps it in the
   Cache Storage bucket called `transformers-cache`. That works for the small models,
   but Chrome refuses any single cache entry of 256 MB or more, and the larger
   Whisper models here are made of files bigger than that. So the files live in
   IndexedDB instead, split into chunks, and this module hands them to the library
   through its custom cache hook (`env.customCache`), keyed by exactly the same
   address the library asks for.

   Anything an earlier version of this page left in `transformers-cache` is still
   read, so a model downloaded before this change does not come down again.

   The same module is imported by the worker (which loads models) and by the page
   (which shows what is saved, removes models, and saves or loads them as a file). */

const DB_NAME = 'tfe-audio-models';
const DB_VERSION = 1;
const FILES = 'files';
const CHUNKS = 'chunks';
export const LEGACY_CACHE = 'transformers-cache';
export const HF = 'https://huggingface.co/';

// Well under anything a browser objects to, and small enough that a failed write
// does not throw away much work.
const CHUNK_BYTES = 32 * 1024 * 1024;

export function repoPrefix(repo) {
  return HF + repo + '/resolve/main/';
}

export function fileUrl(repo, path) {
  return repoPrefix(repo) + path;
}

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
    request.onsuccess = () => {
      const db = request.result;
      // Another tab may upgrade later; let it, rather than blocking it forever.
      db.onversionchange = () => { try { db.close(); } catch (e) {} dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onblocked = () => { dbPromise = null; reject(new Error('The model store is open in another tab.')); };
  });
  return dbPromise;
}

function tx(store, mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let out;
    try {
      out = work(t.objectStore(store));
    } catch (e) {
      reject(e);
      return;
    }
    t.oncomplete = () => resolve(out && typeof out === 'object' && 'result' in out && 'readyState' in out ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('The write was rolled back.'));
  }));
}

function chunkKey(url, index) {
  return url + '#' + index;
}

function keyOf(request) {
  if (typeof request === 'string') return request;
  if (request && request.url) return request.url;
  return String(request);
}

async function legacyCache() {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(LEGACY_CACHE);
  } catch (e) {
    return null;
  }
}

/* ---------- Reading ---------- */

export async function record(url) {
  try {
    return await tx(FILES, 'readonly', (s) => s.get(url));
  } catch (e) {
    return undefined;
  }
}

async function blobFromDb(rec) {
  const parts = [];
  for (let i = 0; i < rec.chunks; i++) {
    const part = await tx(CHUNKS, 'readonly', (s) => s.get(chunkKey(rec.url, i)));
    if (!part) return null;
    parts.push(part);
  }
  return new Blob(parts, { type: rec.type || 'application/octet-stream' });
}

// Reads a file back from whichever store holds it.
export async function readFile(url) {
  const rec = await record(url);
  if (rec && !rec.missing) {
    const blob = await blobFromDb(rec);
    if (blob) return blob;
  }
  const cache = await legacyCache();
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) return await hit.blob();
    } catch (e) { /* nothing there */ }
  }
  return null;
}

// Files the library asked for that the server does not have. Remembering them means
// a saved model loads with no network at all, because nothing has to be asked twice.
export async function isMissing(url) {
  const rec = await record(url);
  return !!(rec && rec.missing);
}

export async function markMissing(url) {
  try {
    await tx(FILES, 'readwrite', (s) => s.put({ url, missing: true, size: 0, chunks: 0, saved: Date.now() }));
  } catch (e) { /* not worth failing a load over */ }
}

// Everything held, from both stores. Each entry is { url, size, where, missing }.
// `wanted` limits the old cache to matching addresses, so sizing its entries never
// touches files that belong to other tools.
export async function listAll(wanted) {
  const out = [];
  const seen = new Set();
  try {
    const recs = await tx(FILES, 'readonly', (s) => s.getAll());
    for (const r of recs || []) {
      out.push({ url: r.url, size: r.size || 0, where: 'db', missing: !!r.missing });
      seen.add(r.url);
    }
  } catch (e) { /* the store may not exist yet */ }
  const cache = await legacyCache();
  if (cache) {
    try {
      for (const req of await cache.keys()) {
        if (seen.has(req.url)) continue;
        if (wanted && !wanted(req.url)) continue;
        let size = 0;
        try {
          const hit = await cache.match(req);
          size = parseInt((hit && hit.headers.get('content-length')) || '0', 10) || 0;
          if (!size && hit) size = (await hit.blob()).size;
        } catch (e) { /* size unknown */ }
        out.push({ url: req.url, size, where: 'cache', missing: false });
      }
    } catch (e) { /* no cache storage here */ }
  }
  return out;
}

export async function filesFor(repo) {
  const prefix = repoPrefix(repo);
  return (await listAll((url) => url.startsWith(prefix)))
    .filter((f) => f.url.startsWith(prefix))
    .map((f) => Object.assign(f, { path: f.url.slice(prefix.length) }));
}

/* ---------- Writing ---------- */

async function finish(url, total, type, chunks) {
  await tx(FILES, 'readwrite', (s) => s.put({
    url,
    size: total,
    type: type || 'application/octet-stream',
    chunks,
    saved: Date.now(),
  }));
}

// Blobs taken from a File are read from disk as they are stored, so even a file of
// several hundred megabytes never has to sit in memory whole.
export async function writeFile(url, blob, type) {
  const total = blob.size;
  const chunks = Math.max(1, Math.ceil(total / CHUNK_BYTES));
  for (let i = 0; i < chunks; i++) {
    const slice = blob.slice(i * CHUNK_BYTES, Math.min((i + 1) * CHUNK_BYTES, total));
    // Reading the slice into memory first keeps the stored value independent of the
    // source file, which the person may move or delete afterwards.
    const bytes = new Blob([await slice.arrayBuffer()], { type: 'application/octet-stream' });
    await tx(CHUNKS, 'readwrite', (s) => s.put(bytes, chunkKey(url, i)));
  }
  await finish(url, total, type || blob.type, chunks);
}

// Straight off a response, a chunk at a time, so nothing larger than one chunk is held.
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
    await tx(CHUNKS, 'readwrite', (s) => s.put(chunk, chunkKey(url, index)));
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
  await finish(url, total, type, Math.max(1, index));
}

export async function removeFile(url) {
  const rec = await record(url);
  if (rec) {
    for (let i = 0; i < (rec.chunks || 0); i++) {
      await tx(CHUNKS, 'readwrite', (s) => s.delete(chunkKey(url, i)));
    }
  }
  try { await tx(FILES, 'readwrite', (s) => s.delete(url)); } catch (e) { /* not there */ }
  const cache = await legacyCache();
  if (cache) { try { await cache.delete(url); } catch (e) { /* not there */ } }
}

// Removes every file of one model, and any chunk a cut-off download left behind.
export async function removeRepo(repo) {
  const prefix = repoPrefix(repo);
  const files = await filesFor(repo);
  for (const f of files) await removeFile(f.url);
  try {
    const keys = await tx(CHUNKS, 'readonly', (s) => s.getAllKeys());
    for (const key of keys || []) {
      if (typeof key === 'string' && key.startsWith(prefix)) {
        await tx(CHUNKS, 'readwrite', (s) => s.delete(key));
      }
    }
  } catch (e) { /* nothing to sweep */ }
  return files.length;
}

// A download cut off part way leaves chunks that no file record names. They are
// cleared without touching the files of this model that did finish.
export async function sweepOrphans(repo) {
  const prefix = repoPrefix(repo);
  try {
    const keys = await tx(CHUNKS, 'readonly', (s) => s.getAllKeys());
    const urls = new Set();
    for (const key of keys || []) {
      if (typeof key === 'string' && key.startsWith(prefix)) urls.add(key.slice(0, key.lastIndexOf('#')));
    }
    for (const url of urls) {
      const rec = await record(url);
      if (rec && !rec.missing) continue;
      for (const key of keys) {
        if (typeof key === 'string' && key.startsWith(url + '#')) await tx(CHUNKS, 'readwrite', (s) => s.delete(key));
      }
    }
  } catch (e) { /* nothing to sweep */ }
}

/* ---------- The shape transformers.js asks for ---------- */

// Only match and put are used, and both behave like the Web Cache API: match answers
// undefined when nothing is held, and put returns a promise.
export const cache = {
  async match(request) {
    const url = keyOf(request);
    if (!/^https?:/.test(url)) return undefined;
    const rec = await record(url);
    if (rec && !rec.missing) {
      const blob = await blobFromDb(rec);
      if (blob) {
        return new Response(blob, {
          headers: { 'Content-Type': rec.type || 'application/octet-stream', 'Content-Length': String(rec.size) },
        });
      }
    }
    const legacy = await legacyCache();
    if (legacy) {
      try {
        const hit = await legacy.match(url);
        if (hit) return hit;
      } catch (e) { /* nothing there */ }
    }
    return undefined;
  },

  async put(request, response) {
    const url = keyOf(request);
    if (!/^https?:/.test(url)) return;
    const type = (response.headers && response.headers.get('content-type')) || 'application/octet-stream';
    if (response.body) {
      await writeStream(url, response.body, type);
      return;
    }
    await writeFile(url, await response.blob(), type);
  },
};

/* ---------- Moving a model as one file ----------

   A plain ZIP with every entry stored, not compressed: model weights do not
   compress, and storing means the archive can be assembled as a Blob made of the
   saved chunks, so saving a model of several hundred megabytes never holds more
   than one chunk in memory. Reading goes the other way, slicing each entry straight
   out of the chosen file. Deflated entries (as in a .docx) can be read too. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crcUpdate(crc, bytes) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function crcOfBlob(blob, onBytes) {
  let crc = 0;
  const step = 8 * 1024 * 1024;
  for (let at = 0; at < blob.size; at += step) {
    const bytes = new Uint8Array(await blob.slice(at, Math.min(at + step, blob.size)).arrayBuffer());
    crc = crcUpdate(crc, bytes);
    if (onBytes) onBytes(bytes.length);
  }
  return crc;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// entries: [{ name, blob }]. onProgress(doneBytes, totalBytes).
export async function buildZip(entries, onProgress) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const total = entries.reduce((n, e) => n + e.blob.size, 0);
  let done = 0;
  const { time, date } = dosDateTime(new Date());
  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const size = entry.blob.size;
    if (size >= 0xffffffff || offset >= 0xffffffff) throw new Error('That model is too large to save as one file.');
    const crc = await crcOfBlob(entry.blob, (n) => { done += n; if (onProgress) onProgress(done, total); });
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, entry.blob);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((n, p) => n + (p.byteLength || p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

// Returns [{ name, size, method, blob() }] without reading the entries themselves.
export async function readZip(file) {
  const tailSize = Math.min(file.size, 65557);
  const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
  let eocd = -1;
  for (let i = tailSize - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That file is not a ZIP.');
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const out = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('That ZIP is damaged.');
    const method = cd.getUint16(p + 10, true);
    const compSize = cd.getUint32(p + 20, true);
    const size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const localOffset = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    out.push({
      name,
      size,
      method,
      async blob() {
        const head = new DataView(await file.slice(localOffset, localOffset + 30).arrayBuffer());
        const start = localOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
        const raw = file.slice(start, start + compSize);
        if (method === 0) return raw;
        if (method === 8 && typeof DecompressionStream !== 'undefined') {
          return await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
        }
        throw new Error('That ZIP uses a compression this browser cannot read.');
      },
    });
  }
  return out;
}
