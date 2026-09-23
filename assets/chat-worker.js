/* The language model, kept off the page's own thread.

   A language model saturates whichever thread it runs on. On the main thread the
   page stops repainting for the whole job, which on a long answer looks like the
   tab has died. Running it here leaves the page free to draw, and free to stream
   the answer in as it arrives.

   Two families are supported. The T5 models are sequence to sequence: they take a
   single written instruction and answer it once, with no memory of what came
   before. The others are chat models and take the conversation as a list of turns,
   which the library renders into whatever prompt format that model was trained on.

   The model is loaded once and kept. An earlier version started and destroyed a
   worker per message, which meant reading the whole model back out of the cache
   every time somebody pressed send. */

import {
  pipeline,
  TextStreamer,
  InterruptableStoppingCriteria,
  ModelRegistry,
  env,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';

import {
  cache as modelStore,
  downloadFile,
  getManifest,
  setManifest,
  modelStatus,
} from './model-store.js';

const HF_BASE = 'https://huggingface.co/';

/* Models are kept in IndexedDB rather than the Cache Storage the library reaches for
   by default, because Chrome will not hold a single cache entry of 256MB or more and
   every chat model here is one file above that. See assets/model-store.js. */
env.useCustomCache = true;
env.customCache = modelStore;

let generator = null;
let loadedKey = null;
let stopper = null;

const SYSTEM_PROMPT =
  'You are a helpful assistant running privately on the user\'s own device. ' +
  'Answer the last message directly and in full. Keep to what was asked, and do ' +
  'not invent facts you were not given. When you are asked to rewrite a piece of ' +
  'text, reply with the rewritten text on its own, with no preamble and no ' +
  'quotation marks around it.';

/* Small models get stuck. Once one starts saying the same thing again it will keep
   going until the token budget runs out, which is a minute of watching a sentence
   repeat. This looks for the tail of what has been written turning up earlier in the
   same answer, and cuts the model off rather than letting it run on.

   The tail has to be long enough that ordinary repeated phrasing does not trip it,
   and it has to appear three times over, so a deliberate refrain survives. */
const LOOP_TAIL = 48;
const LOOP_TIMES = 3;

function looping(text) {
  if (text.length < LOOP_TAIL * LOOP_TIMES) return false;
  const tail = text.slice(-LOOP_TAIL);
  if (!tail.trim()) return false;
  let count = 0;
  let from = 0;
  let at = text.indexOf(tail, from);
  while (at !== -1) {
    count += 1;
    if (count >= LOOP_TIMES) return true;
    from = at + 1;
    at = text.indexOf(tail, from);
  }
  return false;
}

// Everything from the second time round is thrown away, so what is left reads as an
// answer that stops rather than one that stutters.
function trimLoop(text) {
  const tail = text.slice(-LOOP_TAIL);
  const first = text.indexOf(tail);
  const second = text.indexOf(tail, first + 1);
  return second > 0 ? text.slice(0, second).trimEnd() : text;
}

function extractText(output) {
  const generated = output && output[0] && output[0].generated_text;
  if (typeof generated === 'string') return generated;
  if (Array.isArray(generated)) {
    for (let i = generated.length - 1; i >= 0; i--) {
      const turn = generated[i];
      if (turn && turn.role === 'assistant' && typeof turn.content === 'string') return turn.content;
    }
    const last = generated[generated.length - 1];
    if (last && typeof last.content === 'string') return last.content;
  }
  return '';
}

/* ---------- Getting the files onto the device ----------

   Rather than leaving the download to the library, which starts again from nothing
   when a connection drops, the files a model needs are fetched here first with a
   downloader that resumes (see assets/model-store.js). The library then finds every
   one of them already stored and reads them from there. Anything the list below
   misses is still fetched by the library in the usual way, so a wrong list costs a
   download that cannot resume, never a broken model. */

function prefixOf(model) {
  return HF_BASE + model + '/resolve/main/';
}

async function treeSizes(model) {
  const sizes = {};
  const response = await fetch(HF_BASE + 'api/models/' + model + '/tree/main?recursive=true');
  if (!response.ok) throw new Error('Hugging Face answered ' + response.status + '.');
  for (const file of await response.json()) {
    if (file && file.type === 'file') sizes[file.path] = (file.lfs && file.lfs.size) || file.size || 0;
  }
  return sizes;
}

// Which files, and how big. The page sends the list for the models it knows; for
// anything else the library is asked, and the sizes come from Hugging Face.
async function manifestFor(message) {
  const prefix = prefixOf(message.model);
  if (Array.isArray(message.files) && message.files.length) return message.files;
  const stored = await getManifest(prefix);
  if (stored) return stored;
  const options = {};
  if (message.dtype) options.dtype = message.dtype;
  if (message.device) options.device = message.device;
  const [paths, sizes] = await Promise.all([
    ModelRegistry.get_pipeline_files(message.kind || 'text2text-generation', message.model, options),
    treeSizes(message.model),
  ]);
  return paths.map((path) => ({ path: path, size: sizes[path] || 0 }));
}

// Byte counts go to the page a few times a second, not on every network read.
function progressPoster(total, start) {
  let loaded = start;
  let last = 0;
  const post = (force) => {
    const now = Date.now();
    if (!force && now - last < 200) return;
    last = now;
    self.postMessage({
      type: 'download',
      loaded: loaded,
      total: total,
      progress: total ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
    });
  };
  return {
    add(n) { loaded += n; post(false); },
    done() { loaded = total; post(true); },
    now() { post(true); },
  };
}

async function fetchFiles(message) {
  const prefix = prefixOf(message.model);
  let files;
  try {
    files = await manifestFor(message);
  } catch (e) {
    // Offline with nothing known about this model: the library gets to try.
    return { listed: false };
  }
  await setManifest(prefix, files);
  const status = await modelStatus(prefix, files);
  if (status.complete) return { listed: true, fetched: false };

  const total = files.reduce((sum, f) => sum + (f.size || 0), 0);
  self.postMessage({ type: 'phase', phase: 'download', loaded: status.held, total: total });
  const progress = progressPoster(total, status.held);
  progress.now();
  for (const file of files) {
    if (!status.missing.includes(file.path)) continue;
    const got = await downloadFile(prefix + file.path, { size: file.size, onBytes: (n) => progress.add(n) });
    // A file that changed on Hugging Face since its size was noted comes down at its
    // new size, and the list is corrected so the model still counts as whole.
    if (got && got.size && got.size !== file.size) {
      file.size = got.size;
      await setManifest(prefix, files);
    }
  }
  progress.done();
  return { listed: true, fetched: true };
}

async function load(message) {
  const key = [message.model, message.kind, message.device, message.dtype].join('|');
  if (generator && loadedKey === key) return { fetched: false };

  if (generator) {
    try { await generator.dispose(); } catch (e) { /* nothing held it */ }
    generator = null;
    loadedKey = null;
  }

  const fetched = await fetchFiles(message);
  self.postMessage({ type: 'phase', phase: 'load' });

  /* Whatever the downloader did not fetch, the library does, and it reports each
     file on its own. Totalling across files gives one figure that never falls, as
     further files are discovered. When everything is already stored this is the
     time spent reading the model off the disk, which is reported as loading. */
  const seen = new Map();
  let highest = 0;

  const options = {
    progress_callback: (p) => {
      if (!p.file) return;
      if (p.status === 'done') {
        const known = seen.get(p.file);
        if (known) known.loaded = known.total;
      } else if (p.status === 'progress') {
        seen.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
      } else {
        return;
      }
      let loaded = 0, total = 0;
      for (const v of seen.values()) { loaded += v.loaded; total += v.total; }
      if (total <= 0) return;
      const pct = Math.min(99, Math.round((loaded / total) * 100));
      if (pct <= highest) return;
      highest = pct;
      self.postMessage({
        type: fetched.listed ? 'loading' : 'download',
        progress: pct,
        loaded: loaded,
        total: total,
      });
    },
  };
  if (message.dtype) options.dtype = message.dtype;
  if (message.device) options.device = message.device;

  generator = await pipeline(message.kind || 'text2text-generation', message.model, options);
  loadedKey = key;
  return { fetched: !!fetched.fetched || !fetched.listed };
}

async function generate(message) {
  if (!generator) throw new Error('The model was not ready.');

  const isChat = message.kind === 'text-generation';
  const maxNew = message.maxNew || 512;
  let produced = 0;
  let written = '';
  let looped = false;
  const started = performance.now();
  let firstAt = 0;

  stopper = new InterruptableStoppingCriteria();

  const streamer = new TextStreamer(generator.tokenizer, {
    /* A chat model is fed the whole conversation back, so without this the
       conversation would be streamed out again before the new answer. */
    skip_prompt: isChat,
    skip_special_tokens: true,
    token_callback_function: (tokens) => {
      if (!firstAt) firstAt = performance.now();
      produced += tokens.length;
    },
    callback_function: (text) => {
      if (!text) return;
      self.postMessage({ type: 'delta', id: message.id, text: text });
      if (looped) return;
      written += text;
      if (looping(written)) {
        looped = true;
        if (stopper) stopper.interrupt();
      }
    },
  });

  const options = Object.assign({}, message.options, {
    max_new_tokens: maxNew,
    streamer: streamer,
    stopping_criteria: stopper,
  });

  const input = isChat
    ? [{ role: 'system', content: SYSTEM_PROMPT }].concat(message.turns || [])
    : message.prompt;

  const output = await generator(input, options);
  const stopped = !looped && !!(stopper && stopper.interrupted);
  stopper = null;
  const ended = performance.now();

  const text = extractText(output);

  self.postMessage({
    type: 'done',
    id: message.id,
    text: looped ? trimLoop(text) : text,
    looped: looped,
    /* Running out of budget rather than finishing is the difference between an
       answer and half an answer, and the page says so rather than leaving someone
       to work out why a sentence stops mid word. */
    truncated: !stopped && produced >= maxNew - 2,
    stopped: stopped,
    // For the speed line under a reply: tokens written, how long until the first
    // one, and how long the writing took after that.
    produced: produced,
    firstMs: firstAt ? Math.round(firstAt - started) : 0,
    writeMs: firstAt ? Math.round(ended - firstAt) : 0,
  });
}

// The error's name is kept, because the page tells a full disk (QuotaExceededError)
// apart from a dropped connection by it.
function describe(e) {
  if (!e) return 'Something went wrong.';
  const message = e.message || String(e);
  return e.name && e.name !== 'Error' ? e.name + ': ' + message : message;
}

self.addEventListener('message', async (event) => {
  const message = event.data || {};

  if (message.type === 'stop') {
    if (stopper) stopper.interrupt();
    return;
  }

  if (message.type === 'load') {
    try {
      const result = await load(message);
      self.postMessage({ type: 'ready', fetched: !!(result && result.fetched) });
    } catch (e) {
      self.postMessage({ type: 'error', message: describe(e) });
    }
    return;
  }

  // Fetching the files and nothing else, for "Download now": the model is not
  // started, so a phone on Wi-Fi can fetch it ahead of time without the memory cost.
  if (message.type === 'prefetch') {
    try {
      const result = await fetchFiles(message);
      if (!result.listed) throw new Error('Hugging Face could not be reached to find the files this model needs.');
      self.postMessage({ type: 'fetched', fetched: !!result.fetched });
    } catch (e) {
      self.postMessage({ type: 'error', message: describe(e) });
    }
    return;
  }

  if (message.type === 'generate') {
    try {
      await generate(message);
    } catch (e) {
      stopper = null;
      self.postMessage({ type: 'error', id: message.id, message: describe(e) });
    }
  }
});
