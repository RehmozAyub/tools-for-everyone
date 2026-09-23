/* Image Compressor worker. Decodes, resizes and encodes one image at a time off
   the main thread, so the page stays responsive while a batch runs. The page
   keeps 2 to 4 of these busy at once. All the real work is in compress-core.js,
   shared with the main-thread fallback. */
importScripts('compress-core.js');

self.onmessage = async function (e) {
  var msg = e.data || {};
  if (msg.type === 'ping') { self.postMessage({ type: 'pong', offscreen: typeof OffscreenCanvas !== 'undefined' }); return; }
  if (msg.type !== 'job') return;
  var id = msg.jobId;
  try {
    var result = await self.ImageCore.run(msg.job, function (text) {
      self.postMessage({ type: 'progress', jobId: id, text: text });
    });
    self.postMessage({ type: 'done', jobId: id, result: result });
  } catch (err) {
    self.postMessage({ type: 'error', jobId: id, message: (err && err.message) || String(err) });
  }
};
