/* Text rewriting, kept off the page's own thread.

   A language model saturates whichever thread it runs on. On the main thread the
   page stops repainting for the whole job, which on a long passage looks like the
   tab has died. Running it here leaves the page free to draw.

   Two families are supported. The T5 models are sequence to sequence and take a
   plain instruction string. The others are chat models and take a list of messages
   that the library turns into whatever prompt format that model was trained on. */

import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';

let generator = null;
let loadedKey = null;

const SYSTEM_PROMPT =
  'You rewrite text exactly as asked. Reply with the rewritten text only, with no preamble, ' +
  'no explanation and no quotation marks around it.';

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

self.addEventListener('message', async (event) => {
  const message = event.data || {};

  if (message.type === 'load') {
    try {
      const key = [message.model, message.kind, message.device, message.dtype].join('|');
      if (!generator || loadedKey !== key) {
        /* A model is several files, and the library reports each one's progress
           separately. Forwarding those raw makes the bar jump backwards every time a
           new file starts, which reads as flickering. Totalling the bytes across
           every file gives one honest figure, and it is never allowed to fall,
           because the total keeps growing as further files are discovered. */
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
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
    return;
  }

  if (message.type === 'rewrite') {
    try {
      if (!generator) throw new Error('The model was not ready.');
      const options = message.options || {};
      let output;
      if (message.kind === 'text-generation') {
        output = await generator([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message.prompt },
        ], options);
      } else {
        output = await generator(message.prompt, options);
      }
      self.postMessage({ type: 'result', index: message.index, text: extractText(output) });
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
  }
});
