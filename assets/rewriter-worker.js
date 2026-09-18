/* Text rewriting, kept off the page's own thread.

   A language model saturates whichever thread it runs on. On the main thread the
   page stops repainting for the whole job, which on a long passage looks like the
   tab has died. Running it here leaves the page free to draw and stay clickable.

   Terminating this worker when a job finishes hands back the model and its
   WebAssembly heap. The model files stay in the browser's cache, so the next run
   loads them from disk rather than the network. */

import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';

let rewriter = null;
let loadedModel = null;

self.addEventListener('message', async (event) => {
  const message = event.data || {};

  if (message.type === 'load') {
    try {
      if (!rewriter || loadedModel !== message.model) {
        rewriter = await pipeline('text2text-generation', message.model, {
          progress_callback: (p) => {
            if (p.status === 'progress' && p.file) {
              self.postMessage({ type: 'download', progress: Math.round(p.progress || 0), file: p.file });
            }
          },
        });
        loadedModel = message.model;
      }
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
    return;
  }

  if (message.type === 'rewrite') {
    try {
      if (!rewriter) throw new Error('The model was not ready.');
      const output = await rewriter(message.prompt, message.options || {});
      const text = (output && output[0] && output[0].generated_text) || '';
      self.postMessage({ type: 'result', index: message.index, text: text });
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
  }
});
