/* Offline transcription, kept off the page's own thread.

   Whisper inference saturates whichever thread it runs on. Run it on the main one
   and the page stops executing anything at all for the length of the job: no
   progress bar, no clicks, no repaint, which on a long recording looks exactly like
   the tab has died. Running it here leaves the page free to draw.

   Terminating this worker when a job finishes also hands back the model and its
   WebAssembly heap, which is what keeps a phone from being killed part way through a
   long recording. The model files stay in the browser's cache, so the next run loads
   them from disk rather than the network. */

import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';

let transcriber = null;

self.addEventListener('message', async (event) => {
  const message = event.data || {};

  if (message.type === 'load') {
    try {
      const model = message.model || 'Xenova/whisper-base.en';
      transcriber = await pipeline('automatic-speech-recognition', model, {
        progress_callback: (p) => {
          if (p.status === 'progress' && p.file) {
            self.postMessage({ type: 'download', progress: Math.round(p.progress || 0) });
          }
        },
      });
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
    return;
  }

  if (message.type === 'transcribe') {
    try {
      if (!transcriber) throw new Error('The offline engine was not ready.');
      const audio = new Float32Array(message.buffer);
      // Whisper only ever sees 30 seconds at a time. Without chunk_length_s the
      // library silently keeps the first 30 seconds and discards the rest.
      const result = await transcriber(audio, { chunk_length_s: 30, stride_length_s: 5 });
      self.postMessage({ type: 'result', index: message.index, text: (result && result.text) || '' });
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
    }
  }
});
