/* Offline transcription, kept off the page's own thread.

   Whisper inference saturates whichever thread it runs on. Run it on the main one
   and the page stops executing anything at all for the length of the job: no
   progress bar, no clicks, no repaint. Running it here leaves the page free to draw.

   The model is loaded once and kept. The page starts this worker as soon as the
   chosen model is saved on the device and reuses it for every transcription, so
   the second recording does not wait for the model to be read and compiled again.
   The page only ends the worker on Cancel (and then starts a fresh one in the
   background) or when a different model is chosen.

   Model files are kept by ../Audio Transcriber/model-cache.js, keyed by the same
   Hugging Face address the library downloads them from. */

import {
  pipeline,
  env,
  Tensor,
  AutoProcessor,
  AutoModelForAudioFrameClassification,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';

import * as store from '../Audio%20Transcriber/model-cache.js';

env.allowLocalModels = false;
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = store.cache;

/* Every network request the library makes goes through here. That is how the page
   can say "Loading from this device" honestly (nothing was fetched) and switch to
   "Downloading" the moment a file does have to come from the network. Files the
   server does not have are remembered, so a saved model never has to ask again. */
let networkFetches = 0;
let fetchedUrls = [];
const baseFetch = env.fetch || ((...a) => fetch(...a));
env.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  if (url.startsWith(store.HF) && await store.isMissing(url)) {
    return new Response(null, { status: 404, statusText: 'Not Found' });
  }
  if (url.startsWith(store.HF)) {
    networkFetches += 1;
    fetchedUrls.push(url);
    if (networkFetches === 1) self.postMessage({ type: 'network' });
  }
  const response = await baseFetch(input, init);
  if (response.status === 404 && url.startsWith(store.HF)) await store.markMissing(url);
  return response;
};

let transcriber = null;
let loadedKey = null;
let loadedDevice = null;
let diarizer = null;

const SAMPLE_RATE = 16000;
const WINDOW_S = 30;
const STRIDE_S = 5;

function errorText(e) {
  return (e && e.message) || String(e);
}

/* ---------- Loading ---------- */

async function load(message) {
  const key = [message.repo, message.device || 'wasm', JSON.stringify(message.dtype || null)].join('|');
  if (transcriber && loadedKey === key) {
    self.postMessage({ type: 'ready', reused: true, device: loadedDevice, networkFetches });
    return;
  }
  if (transcriber) {
    try { await transcriber.dispose(); } catch (e) { /* nothing held it */ }
    transcriber = null;
    loadedKey = null;
  }
  networkFetches = 0;
  fetchedUrls = [];

  /* A model is several files and the library reports each one separately. It also
     works out the total for every file up front and reports that as progress_total,
     which is the honest figure; totalling the files here is the fallback. The figure
     never falls. */
  const seen = new Map();
  let lastPost = 0;
  let best = { loaded: 0, total: 0 };
  let libraryTotal = null;
  const post = (force) => {
    let loaded, total;
    if (libraryTotal && libraryTotal.total > 0) {
      ({ loaded, total } = libraryTotal);
    } else {
      loaded = 0; total = 0;
      for (const v of seen.values()) { loaded += v.loaded; total += v.total; }
    }
    best = { loaded: Math.max(best.loaded, loaded), total: Math.max(best.total, total) };
    const now = Date.now();
    if (!force && now - lastPost < 120) return;
    lastPost = now;
    self.postMessage({ type: 'download', loaded: best.loaded, total: best.total });
  };

  const options = {
    progress_callback: (p) => {
      if (!p) return;
      if (p.status === 'progress_total') {
        libraryTotal = { loaded: p.loaded || 0, total: p.total || 0 };
        post(false);
        return;
      }
      if (!p.file) return;
      if (p.status === 'progress') {
        seen.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
        post(false);
      } else if (p.status === 'done') {
        const known = seen.get(p.file);
        if (known) { known.loaded = known.total; post(true); }
      }
    },
  };
  if (message.dtype) options.dtype = message.dtype;
  if (message.device) options.device = message.device;

  transcriber = await pipeline('automatic-speech-recognition', message.repo, options);
  loadedDevice = message.device || 'wasm';

  // The first run on a graphics card compiles its shaders, which takes a few seconds.
  // Doing that now means the first real window is not the slow one.
  if (loadedDevice === 'webgpu') {
    const multilingual = !!(transcriber.model.generation_config && transcriber.model.generation_config.is_multilingual);
    await transcriber(new Float32Array(SAMPLE_RATE), multilingual ? { language: 'en' } : {});
  }

  loadedKey = key;
  post(true);
  self.postMessage({ type: 'ready', reused: false, device: loadedDevice, networkFetches, urls: fetchedUrls });
}

/* ---------- Language ---------- */

// transformers.js does not detect the language itself: for a multilingual model it
// silently assumes English. Whisper does the detection with one decoder step after
// the start token, and the most likely language token is the answer.
async function detectLanguage(audio) {
  const config = transcriber.model.generation_config || {};
  const langToId = config.lang_to_id;
  if (!config.is_multilingual || !langToId) return null;
  const inputs = await transcriber.processor(audio.subarray(0, WINDOW_S * SAMPLE_RATE));
  const start = BigInt(config.decoder_start_token_id);
  const out = await transcriber.model({
    input_features: inputs.input_features,
    decoder_input_ids: new Tensor('int64', BigInt64Array.from([start]), [1, 1]),
  });
  const logits = out.logits;
  const vocab = logits.dims.at(-1);
  const data = logits.data;
  const base = data.length - vocab;
  let best = null;
  let bestScore = -Infinity;
  for (const [token, id] of Object.entries(langToId)) {
    const score = data[base + Number(id)];
    if (score > bestScore) { bestScore = score; best = token; }
  }
  return best ? best.replace(/^<\|/, '').replace(/\|>$/, '') : null;
}

/* ---------- Transcribing ---------- */

function windowCount(samples) {
  const win = WINDOW_S * SAMPLE_RATE;
  const jump = (WINDOW_S - 2 * STRIDE_S) * SAMPLE_RATE;
  let n = 0;
  for (let offset = 0; ; offset += jump) {
    n += 1;
    if (offset + win >= samples) break;
  }
  return n;
}

function cleanChunks(chunks, partSeconds) {
  const out = [];
  for (const c of chunks || []) {
    const text = (c.text || '').trim();
    if (!text) continue;
    let [start, end] = c.timestamp || [null, null];
    if (start == null) start = out.length ? out[out.length - 1].end : 0;
    if (end == null || end < start) end = Math.min(partSeconds, start + Math.max(1, text.split(/\s+/).length * 0.4));
    out.push({ start, end, text });
  }
  return out;
}

async function transcribe(message) {
  if (!transcriber) throw new Error('The offline engine was not ready.');
  const audio = new Float32Array(message.buffer);
  const partSeconds = audio.length / SAMPLE_RATE;
  const total = windowCount(audio.length);
  const jumpS = WINDOW_S - 2 * STRIDE_S;
  const config = transcriber.model.generation_config || {};
  const timePrecision = transcriber.processor.feature_extractor.config.chunk_length / transcriber.model.config.max_source_positions;

  /* The pipeline hands each 30 second window to model.generate in turn. Wrapping it
     for the length of this call is what gives progress within a part, and a first
     look at each window's text so the transcript fills in as it goes. The final,
     properly merged text for the part replaces these when the part finishes. */
  const model = transcriber.model;
  const original = model.generate;
  let index = 0;
  model.generate = async function (args) {
    const k = index;
    self.postMessage({ type: 'window', id: message.id, index: k, total });
    const result = await original.call(this, args);
    index += 1;
    self.postMessage({ type: 'window', id: message.id, index: index, total });
    try {
      const tokens = (result && result[0] && result[0].tolist) ? result[0].tolist() : null;
      if (tokens) {
        const [, extra] = transcriber.tokenizer._decode_asr(
          [{ tokens, stride: [WINDOW_S, 0, 0] }],
          { time_precision: timePrecision, return_timestamps: true, force_full_sequences: false },
        );
        const winStart = k * jumpS;
        const isLast = index >= total;
        const segments = [];
        for (const c of cleanChunks(extra && extra.chunks, WINDOW_S)) {
          const mid = (c.start + c.end) / 2;
          if (k > 0 && mid < STRIDE_S) continue;
          if (!isLast && mid > WINDOW_S - STRIDE_S) continue;
          segments.push({ start: winStart + c.start, end: winStart + c.end, text: c.text });
        }
        if (segments.length) self.postMessage({ type: 'segments', id: message.id, segments });
      }
    } catch (e) { /* a first look is optional */ }
    return result;
  };

  try {
    const options = {
      // Whisper only ever sees 30 seconds at a time. Without chunk_length_s the
      // library silently keeps the first 30 seconds and discards the rest.
      chunk_length_s: WINDOW_S,
      stride_length_s: STRIDE_S,
      return_timestamps: true,
    };
    if (config.is_multilingual) {
      options.language = message.language || 'en';
      options.task = message.task === 'translate' ? 'translate' : 'transcribe';
    }
    const result = await transcriber(audio, options);
    return {
      text: (result && result.text) || '',
      segments: cleanChunks(result && result.chunks, partSeconds),
    };
  } finally {
    model.generate = original;
  }
}

/* ---------- Speakers (experimental) ---------- */

// pyannote segmentation 3.0 labels each 17 ms frame with one of seven classes:
// nobody, one of three speakers, or a pair talking over each other. The first
// speaker of a pair is taken as the one talking.
const OVERLAP_FIRST = { 4: 1, 5: 1, 6: 2 };

async function diarize(message) {
  const audio = new Float32Array(message.buffer);
  if (!diarizer) {
    const repo = 'onnx-community/pyannote-segmentation-3.0';
    const [model, processor] = await Promise.all([
      AutoModelForAudioFrameClassification.from_pretrained(repo, { dtype: 'fp32', device: 'wasm' }),
      AutoProcessor.from_pretrained(repo),
    ]);
    diarizer = { model, processor };
  }
  const { model, processor } = diarizer;
  const inputs = await processor(audio);
  const { logits } = await model(inputs);
  const raw = processor.post_process_speaker_diarization(logits, audio.length)[0] || [];
  const segments = [];
  for (const s of raw) {
    let id = s.id;
    if (OVERLAP_FIRST[id]) id = OVERLAP_FIRST[id];
    if (!id) continue;
    const last = segments[segments.length - 1];
    if (last && last.speaker === id && s.start - last.end < 0.05) last.end = s.end;
    else segments.push({ start: s.start, end: s.end, speaker: id });
  }
  return segments;
}

/* ---------- Messages ---------- */

self.addEventListener('message', async (event) => {
  const message = event.data || {};
  try {
    if (message.type === 'load') {
      await load(message);
    } else if (message.type === 'detect') {
      if (!transcriber) throw new Error('The offline engine was not ready.');
      const code = await detectLanguage(new Float32Array(message.buffer));
      self.postMessage({ type: 'language', id: message.id, code });
    } else if (message.type === 'transcribe') {
      const out = await transcribe(message);
      self.postMessage({ type: 'result', id: message.id, text: out.text, segments: out.segments });
    } else if (message.type === 'diarize') {
      const segments = await diarize(message);
      self.postMessage({ type: 'speakers', id: message.id, segments });
    }
  } catch (e) {
    self.postMessage({ type: 'error', id: message.id, message: errorText(e), during: message.type });
  }
});
