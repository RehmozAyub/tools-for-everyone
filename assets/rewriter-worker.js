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
  env,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';

import { cache as modelStore } from './model-store.js';

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

async function load(message) {
  const key = [message.model, message.kind, message.device, message.dtype].join('|');
  if (generator && loadedKey === key) return;

  if (generator) {
    try { await generator.dispose(); } catch (e) { /* nothing held it */ }
    generator = null;
    loadedKey = null;
  }

  /* A model is several files, and the library reports each one's progress
     separately. Forwarding those raw makes the bar jump backwards every time a new
     file starts, which reads as flickering. Totalling the bytes across every file
     gives one honest figure, and it is never allowed to fall, because the total
     keeps growing as further files are discovered. */
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
      self.postMessage({ type: 'download', progress: pct });
    },
  };
  if (message.dtype) options.dtype = message.dtype;
  if (message.device) options.device = message.device;

  generator = await pipeline(message.kind || 'text2text-generation', message.model, options);
  loadedKey = key;
  self.postMessage({ type: 'download', progress: 100 });
}

async function generate(message) {
  if (!generator) throw new Error('The model was not ready.');

  const isChat = message.kind === 'text-generation';
  const maxNew = message.maxNew || 512;
  let produced = 0;

  stopper = new InterruptableStoppingCriteria();

  const streamer = new TextStreamer(generator.tokenizer, {
    /* A chat model is fed the whole conversation back, so without this the
       conversation would be streamed out again before the new answer. */
    skip_prompt: isChat,
    skip_special_tokens: true,
    token_callback_function: (tokens) => { produced += tokens.length; },
    callback_function: (text) => {
      if (text) self.postMessage({ type: 'delta', id: message.id, text: text });
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
  const stopped = !!(stopper && stopper.interrupted);
  stopper = null;

  self.postMessage({
    type: 'done',
    id: message.id,
    text: extractText(output),
    /* Running out of budget rather than finishing is the difference between an
       answer and half an answer, and the page says so rather than leaving someone
       to work out why a sentence stops mid word. */
    truncated: !stopped && produced >= maxNew - 2,
    stopped: stopped,
  });
}

self.addEventListener('message', async (event) => {
  const message = event.data || {};

  if (message.type === 'stop') {
    if (stopper) stopper.interrupt();
    return;
  }

  if (message.type === 'load') {
    try {
      await load(message);
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
    return;
  }

  if (message.type === 'generate') {
    try {
      await generate(message);
    } catch (e) {
      stopper = null;
      self.postMessage({ type: 'error', id: message.id, message: (e && e.message) || String(e) });
    }
  }
});
