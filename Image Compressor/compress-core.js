/* Image Compressor, encoding core.
   One file used in two places: compress-worker.js loads it with importScripts,
   and the page loads it with a <script> tag only when workers with
   OffscreenCanvas are not available (Safari before 16.4). Everything here
   works in both, so the two paths always give the same result.

   Libraries load on first use, never up front:
   - pako 1.0.11 + upng-js 2.1.0 (UMD globals `pako`, `UPNG`) for colour reduced PNG
   - jSquash codecs (ESM, dynamic import of the raw codec files so the .wasm
     files resolve next to them on jsdelivr) for AVIF, MozJPEG, libwebp, OxiPNG */
(function (root) {
  'use strict';

  var CDN = 'https://cdn.jsdelivr.net/npm/';
  var LIBS = {
    pako: CDN + 'pako@1.0.11/dist/pako.min.js',
    upng: CDN + 'upng-js@2.1.0/UPNG.js',
    avif: CDN + '@jsquash/avif@2.1.1/codec/enc/avif_enc.js',
    webpSimd: CDN + '@jsquash/webp@1.5.0/codec/enc/webp_enc_simd.js',
    webp: CDN + '@jsquash/webp@1.5.0/codec/enc/webp_enc.js',
    mozjpeg: CDN + '@jsquash/jpeg@1.6.0/codec/enc/mozjpeg_enc.js',
    oxipng: CDN + '@jsquash/oxipng@2.3.0/codec/pkg/squoosh_oxipng.js'
  };

  /* Option defaults copied from each package's meta.js at the versions above. */
  var AVIF_DEFAULTS = {
    quality: 50, qualityAlpha: -1, denoiseLevel: 0, tileColsLog2: 0, tileRowsLog2: 0,
    speed: 7, subsample: 1, chromaDeltaQ: false, sharpness: 0, tune: 0,
    enableSharpYUV: false, bitDepth: 8, lossless: false
  };
  var WEBP_DEFAULTS = {
    quality: 75, target_size: 0, target_PSNR: 0, method: 4, sns_strength: 50,
    filter_strength: 60, filter_sharpness: 0, filter_type: 1, partitions: 0, segments: 4,
    pass: 1, show_compressed: 0, preprocessing: 0, autofilter: 0, partition_limit: 0,
    alpha_compression: 1, alpha_filtering: 1, alpha_quality: 100, lossless: 0, exact: 0,
    image_hint: 0, emulate_jpeg_size: 0, thread_level: 0, low_memory: 0, near_lossless: 100,
    use_delta_palette: 0, use_sharp_yuv: 0
  };
  var MOZJPEG_DEFAULTS = {
    quality: 75, baseline: false, arithmetic: false, progressive: true, optimize_coding: true,
    smoothing: 0, color_space: 3, quant_table: 3, trellis_multipass: false,
    trellis_opt_zero: false, trellis_opt_table: false, trellis_loops: 1, auto_subsample: true,
    chroma_subsample: 2, separate_chroma_quality: false, chroma_quality: 75
  };

  var IS_WORKER = typeof importScripts === 'function' && typeof document === 'undefined';

  /* ---------- Library loading ---------- */

  function loadClassic(url) {
    if (IS_WORKER) { importScripts(url); return Promise.resolve(); }
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Could not load ' + url)); };
      document.head.appendChild(s);
    });
  }

  var cache = {};
  function once(key, fn) {
    if (!cache[key]) {
      cache[key] = fn();
      cache[key].catch(function () { delete cache[key]; });
    }
    return cache[key];
  }

  /* UPNG reads `window.pako` and writes `window.UPNG` when it loads, so inside a
     worker `window` is pointed at the worker scope just for the load. */
  function getUPNG() {
    if (root.UPNG) return Promise.resolve(root.UPNG);
    return once('upng', function () {
      return (async function () {
        var faked = false;
        if (typeof root.window === 'undefined') { root.window = root; faked = true; }
        try {
          if (!root.pako) await loadClassic(LIBS.pako);
          await loadClassic(LIBS.upng);
        } finally {
          if (faked) { try { delete root.window; } catch (e) { root.window = undefined; } }
        }
        if (!root.UPNG) throw new Error('The PNG colour reducer did not load.');
        return root.UPNG;
      })();
    });
  }

  function emscripten(url) {
    return import(url).then(function (m) { return m.default({ noInitialRun: true }); });
  }

  function getCodec(name) {
    return once(name, function () {
      if (name === 'avif') return emscripten(LIBS.avif);
      if (name === 'mozjpeg') return emscripten(LIBS.mozjpeg);
      if (name === 'webp') {
        return emscripten(LIBS.webpSimd).catch(function () { return emscripten(LIBS.webp); });
      }
      if (name === 'oxipng') {
        return import(LIBS.oxipng).then(function (m) { return m.default().then(function () { return m; }); });
      }
      return Promise.reject(new Error('Unknown codec ' + name));
    });
  }

  /* ---------- Canvas helpers ---------- */

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        var oc = new OffscreenCanvas(w, h);
        if (oc.getContext('2d')) return oc;
      } catch (e) { /* fall through */ }
    }
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function ctx2d(canvas) {
    var ctx = canvas.getContext('2d', { willReadFrequently: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return ctx;
  }

  function canvasBlob(canvas, type, quality) {
    if (canvas.convertToBlob) return canvas.convertToBlob({ type: type, quality: quality });
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('The browser could not save this image.')); }, type, quality);
    });
  }

  function imageData(canvas) {
    if (canvas.__imageData) return canvas.__imageData;
    var d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    canvas.__imageData = d;
    return d;
  }

  async function decode(blob) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob); } catch (e) { if (IS_WORKER) throw e; }
    }
    if (typeof document === 'undefined') throw new Error('decode failed');
    var url = URL.createObjectURL(blob);
    try {
      var img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ---------- Geometry ---------- */

  /* Works out what to draw: the source crop, the scaled size, and the final
     canvas (which differs only for "Square, fit", where the image is padded). */
  function plan(sw, sh, r, extra) {
    var crop = { x: 0, y: 0, w: sw, h: sh };
    var s = 1, cw, ch, dw, dh, dx = 0, dy = 0, square = null;
    if (r && r.on) {
      if (r.by === 'percent') s = Math.min((r.percent || 100) / 100, 1);
      else if (r.by === 'long') s = Math.min((r.long || 1920) / Math.max(sw, sh), 1);
      else if (r.by === 'square') {
        var S = r.square || 1080;
        if (r.fit === 'crop') {
          var side = Math.min(sw, sh);
          crop = { x: Math.round((sw - side) / 2), y: Math.round((sh - side) / 2), w: side, h: side };
          s = Math.min(S / side, 1);
          square = 'crop';
        } else {
          s = Math.min(S / Math.max(sw, sh), 1);
          square = 'fit';
        }
      } else s = Math.min((r.maxW || sw) / sw, (r.maxH || sh) / sh, 1);
    }
    s *= (extra || 1);
    dw = Math.max(1, Math.round(crop.w * s));
    dh = Math.max(1, Math.round(crop.h * s));
    cw = dw; ch = dh;
    if (square === 'fit') {
      cw = ch = Math.max(dw, dh);
      dx = Math.round((cw - dw) / 2);
      dy = Math.round((ch - dh) / 2);
    }
    return { crop: crop, dw: dw, dh: dh, cw: cw, ch: ch, dx: dx, dy: dy };
  }

  /* Big reductions in one drawImage alias badly, so halve in steps first. */
  function drawScaled(src, crop, dw, dh) {
    var cur = src, cx = crop.x, cy = crop.y, cwid = crop.w, chei = crop.h;
    while (cwid / 2 >= dw && chei / 2 >= dh && cwid > 2 && chei > 2) {
      var nw = Math.max(1, Math.round(cwid / 2)), nh = Math.max(1, Math.round(chei / 2));
      var step = makeCanvas(nw, nh);
      ctx2d(step).drawImage(cur, cx, cy, cwid, chei, 0, 0, nw, nh);
      cur = step; cx = 0; cy = 0; cwid = nw; chei = nh;
    }
    var out = makeCanvas(dw, dh);
    ctx2d(out).drawImage(cur, cx, cy, cwid, chei, 0, 0, dw, dh);
    return out;
  }

  function render(bitmap, sw, sh, resize, extra, fillWhite) {
    var p = plan(sw, sh, resize, extra);
    var scaled = drawScaled(bitmap, p.crop, p.dw, p.dh);
    if (!fillWhite && p.cw === p.dw && p.ch === p.dh) return scaled;
    var out = makeCanvas(p.cw, p.ch);
    var ctx = ctx2d(out);
    if (fillWhite) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, p.cw, p.ch); }
    ctx.drawImage(scaled, p.dx, p.dy);
    return out;
  }

  /* ---------- Encoders ---------- */

  function asBlob(buf, mime) {
    return new Blob([buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)], { type: mime });
  }

  /* "Best compression" runs the wasm encoder and the browser's own, and keeps
     whichever file is smaller at the same quality setting, so it never makes a
     file bigger than the normal mode would. */
  async function smaller(wasmBlob, name, canvas, mime, q, state) {
    var plain = await canvasBlob(canvas, mime, q);
    if (plain.type === mime && plain.size < wasmBlob.size) { state.encoder = 'canvas'; return plain; }
    state.encoder = name;
    return wasmBlob;
  }

  /* Encodes one canvas. `state` collects quiet notes (for example when a
     "Best compression" codec failed and the canvas encoder was used). */
  async function encode(canvas, mime, q, o, state) {
    var w = canvas.width, h = canvas.height;
    if (mime === 'image/avif') {
      var avif = await getCodec('avif');
      var aq = Math.max(1, Math.min(100, Math.round(q * 100) - 20));
      var out = avif.encode(new Uint8Array(imageData(canvas).data.buffer), w, h, Object.assign({}, AVIF_DEFAULTS, { quality: aq }));
      if (!out) throw new Error('The AVIF encoder failed.');
      state.encoder = 'avif';
      return asBlob(out, 'image/avif');
    }
    if (mime === 'image/jpeg' && o.best && !state.noBest) {
      try {
        var moz = await getCodec('mozjpeg');
        var r = moz.encode(imageData(canvas).data, w, h, Object.assign({}, MOZJPEG_DEFAULTS, { quality: Math.round(q * 100), chroma_quality: Math.round(q * 100) }));
        return smaller(asBlob(r, 'image/jpeg'), 'mozjpeg', canvas, mime, q, state);
      } catch (e) { state.noBest = true; state.fallback = 'The MozJPEG encoder did not load, so the browser encoder was used.'; }
    }
    if (mime === 'image/webp' && o.best && !state.noBest) {
      try {
        var wp = await getCodec('webp');
        var r2 = wp.encode(imageData(canvas).data, w, h, Object.assign({}, WEBP_DEFAULTS, { quality: Math.round(q * 100), method: 5 }));
        if (!r2) throw new Error('webp failed');
        return smaller(asBlob(r2, 'image/webp'), 'libwebp', canvas, mime, q, state);
      } catch (e) { state.noBest = true; state.fallback = 'The libwebp encoder did not load, so the browser encoder was used.'; }
    }
    if (mime === 'image/png') {
      var png;
      if (o.colours) {
        var UPNG = await getUPNG();
        var px = imageData(canvas).data;
        var copy = new Uint8Array(px.length); copy.set(px);
        png = asBlob(UPNG.encode([copy.buffer], w, h, o.colours), 'image/png');
        state.encoder = 'upng';
        /* Images that already have few colours can come out smaller losslessly. */
        var lossless = await canvasBlob(canvas, 'image/png');
        if (lossless.size <= png.size) { png = lossless; state.encoder = 'canvas'; }
      } else {
        png = await canvasBlob(canvas, 'image/png');
        state.encoder = 'canvas';
      }
      if (o.best && !state.noBest) {
        try {
          var ox = await getCodec('oxipng');
          var bytes = new Uint8Array(await png.arrayBuffer());
          var opt = ox.optimise(bytes, 2, false, false);
          if (opt && opt.byteLength && opt.byteLength < png.size) png = asBlob(opt, 'image/png');
          state.encoder += '+oxipng';
        } catch (e) { state.noBest = true; state.fallback = 'The OxiPNG optimiser did not load, so the PNG was not squeezed further.'; }
      }
      return png;
    }
    var b = await canvasBlob(canvas, mime, q);
    state.encoder = 'canvas';
    return b;
  }

  /* ---------- One job ---------- */

  /* job: { file: Blob, outMime, quality (0-100), mode 'quality'|'target', targetBytes,
            best, colours (0 = off), resize {on, by, maxW, maxH, long, percent, square, fit} }
     progress(text) is called with short status lines. */
  async function run(job, progress) {
    progress = progress || function () {};
    var bitmap;
    try { bitmap = await decode(job.file); }
    catch (e) { throw new Error('This image could not be read. It may be damaged or in a format this browser cannot open.'); }
    var sw = bitmap.width || bitmap.naturalWidth, sh = bitmap.height || bitmap.naturalHeight;
    var mime = job.outMime;
    var state = { attempts: 0 };
    var note = '';

    /* AVIF needs its wasm encoder. If that cannot load, say so and use WebP. */
    if (mime === 'image/avif') {
      progress('Loading the AVIF encoder');
      try { await getCodec('avif'); }
      catch (e) { mime = 'image/webp'; state.fallback = 'The AVIF encoder could not load, so this was saved as WebP.'; }
    }
    var fillWhite = mime === 'image/jpeg';
    var label = { 'image/avif': 'AVIF', 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'image/png': 'PNG' }[mime] || 'image';

    async function attempt(canvas, q, colours) {
      state.attempts++;
      progress('Encoding ' + label + (job.mode === 'target' ? ', attempt ' + state.attempts : ''));
      return encode(canvas, mime, q, { best: job.best, colours: colours }, state);
    }

    var result, canvas, usedQ = null, usedColours = null, reached = true, extra = 1;
    try {
      if (job.mode !== 'target') {
        canvas = render(bitmap, sw, sh, job.resize, 1, fillWhite);
        usedQ = mime === 'image/png' ? null : job.quality;
        usedColours = mime === 'image/png' && job.colours ? job.colours : null;
        result = await attempt(canvas, job.quality / 100, usedColours || 0);
        if (usedColours && String(state.encoder).indexOf('upng') !== 0) usedColours = null;
      } else if (mime === 'image/png') {
        var target = job.targetBytes;
        var levels = [0, 256, 128, 64, 32, 16];
        canvas = render(bitmap, sw, sh, job.resize, 1, false);
        for (var i = 0; i < levels.length; i++) {
          var r = await attempt(canvas, 1, levels[i]);
          var lv = String(state.encoder).indexOf('upng') === 0 ? levels[i] : null;
          if (!result || r.size < result.size) { result = r; usedColours = lv; }
          if (r.size <= target) { result = r; usedColours = lv; break; }
        }
        while (result.size > target && extra > 0.05) {
          extra *= Math.max(0.5, Math.min(0.9, Math.sqrt(target / result.size) * 0.95));
          canvas = render(bitmap, sw, sh, job.resize, extra, false);
          result = await attempt(canvas, 1, 64);
          usedColours = String(state.encoder).indexOf('upng') === 0 ? 64 : null;
        }
        reached = result.size <= target;
      } else {
        var tgt = job.targetBytes, LOW = 0.4, HIGH = 0.92, found = null, smallest = null;
        for (var step = 0; step < 10 && !found; step++) {
          canvas = render(bitmap, sw, sh, job.resize, extra, fillWhite);
          var lo = await attempt(canvas, LOW);
          if (!smallest || lo.size < smallest.blob.size) smallest = { blob: lo, q: LOW, canvas: canvas };
          if (lo.size > tgt) {
            extra *= Math.max(0.5, Math.min(0.9, Math.sqrt(tgt / lo.size) * 0.95));
            if (canvas.width < 16 || canvas.height < 16) break;
            continue;
          }
          found = { blob: lo, q: LOW };
          var hi = await attempt(canvas, HIGH);
          if (hi.size <= tgt) { found = { blob: hi, q: HIGH }; break; }
          var a = LOW, b = HIGH;
          for (var k = 0; k < 5; k++) {
            var m = (a + b) / 2;
            var rm = await attempt(canvas, m);
            if (rm.size <= tgt) { found = { blob: rm, q: m }; a = m; } else b = m;
          }
        }
        if (found) { result = found.blob; usedQ = Math.round(found.q * 100); }
        else { result = smallest.blob; usedQ = Math.round(smallest.q * 100); canvas = smallest.canvas; reached = false; }
      }
    } finally {
      if (bitmap.close) bitmap.close();
    }

    return {
      blob: result,
      mime: result.type || mime,
      width: canvas.width,
      height: canvas.height,
      srcWidth: sw,
      srcHeight: sh,
      quality: usedQ,
      colours: usedColours,
      attempts: state.attempts,
      reached: reached,
      scaled: extra < 1,
      encoder: state.encoder,
      fallback: state.fallback || '',
      note: note
    };
  }

  root.ImageCore = { run: run, plan: plan, LIBS: LIBS, getUPNG: getUPNG, getCodec: getCodec };
})(typeof self !== 'undefined' ? self : this);
