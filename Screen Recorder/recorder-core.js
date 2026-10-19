/* Screen Recorder, core logic.
   Pure functions shared by screen_recorder.html and its tests: which format to
   record in, how many bits to spend, where the camera bubble sits, file names,
   and the byte bookkeeping that lets a finished file be stored in pieces.
   No DOM access here, so the same file also loads in Node for testing. */
(function (root) {
  'use strict';

  /* ---------- Recording format ---------- */

  /* MediaRecorder formats in order of preference. H.264 first, because the file is
     tidied into an MP4 afterwards and H.264 can be copied into it without being
     encoded again. Matroska comes before MP4: Chrome hands Matroska over every
     second, which is what keeps a crash from losing more than a second, while
     its MP4 recorder only hands data over at key frames, often a minute apart. */
  var MIME_CANDIDATES = [
    { mime: 'video/webm;codecs=h264,opus', container: 'mkv', video: 'avc', audio: 'opus' },
    { mime: 'video/mp4;codecs=avc1.640033,mp4a.40.2', container: 'mp4', video: 'avc', audio: 'aac' },
    { mime: 'video/mp4;codecs=avc1,mp4a.40.2', container: 'mp4', video: 'avc', audio: 'aac' },
    { mime: 'video/mp4;codecs=avc1.42E01F,mp4a.40.2', container: 'mp4', video: 'avc', audio: 'aac' },
    { mime: 'video/mp4;codecs=avc1,opus', container: 'mp4', video: 'avc', audio: 'opus' },
    { mime: 'video/webm;codecs=vp9,opus', container: 'webm', video: 'vp9', audio: 'opus' },
    { mime: 'video/webm;codecs=vp8,opus', container: 'webm', video: 'vp8', audio: 'opus' },
    { mime: 'video/webm', container: 'webm', video: 'unknown', audio: 'unknown' },
    { mime: 'video/mp4', container: 'mp4', video: 'unknown', audio: 'unknown' }
  ];

  /* isSupported is MediaRecorder.isTypeSupported. preferWebm moves real WebM
     (VP9 or VP8, which is what WebM allows) first for people who asked for it.
     Returns null when the browser supports none of them, which leaves the
     choice to MediaRecorder itself. */
  function pickMimeType(isSupported, preferWebm) {
    var list = MIME_CANDIDATES.slice();
    if (preferWebm) {
      var real = function (c) { return c.container === 'webm' ? 0 : 1; };
      list.sort(function (a, b) { return real(a) - real(b); });
    }
    for (var i = 0; i < list.length; i++) {
      var ok = false;
      try { ok = !!isSupported(list[i].mime); } catch (e) { ok = false; }
      if (ok) return list[i];
    }
    return null;
  }

  /* What a recorded MIME type (as MediaRecorder reports it) contains. Chrome
     reports H.264 in WebM as video/x-matroska, since WebM itself only allows
     VP8, VP9 and AV1; such a file is an .mkv. */
  function describeMime(mime) {
    var m = String(mime || '').toLowerCase();
    var container = /^video\/mp4|^audio\/mp4/.test(m) ? 'mp4' : (/matroska/.test(m) || (/webm/.test(m) && /avc1|h264/.test(m))) ? 'mkv' : 'webm';
    var video = /avc1|h264/.test(m) ? 'avc' : /vp0?9/.test(m) ? 'vp9' : /vp0?8/.test(m) ? 'vp8' : /av01|av1/.test(m) ? 'av1' : 'unknown';
    var audio = /mp4a/.test(m) ? 'aac' : /opus/.test(m) ? 'opus' : /vorbis/.test(m) ? 'vorbis' : 'unknown';
    return { container: container, video: video, audio: audio };
  }

  /* Bits per second for a video of this size. Screen content is mostly flat
     colour and text, so this is generous for text to stay sharp without being
     wasteful. Capped so 4K at 60 fps does not ask for absurd rates. */
  function videoBitrate(width, height, fps) {
    var w = Math.max(2, width || 1280), h = Math.max(2, height || 720), f = Math.max(1, Math.min(fps || 30, 60));
    var bps = w * h * f * 0.08;
    return Math.round(Math.min(25e6, Math.max(1.5e6, bps)));
  }

  function even(v) { return Math.max(2, Math.round(v / 2) * 2); }

  /* Scales width x height down so the short side is at most maxShort, keeping
     the shape. maxShort of 0 or null keeps the original size. Always even, which
     video encoders need. */
  function fitWithin(width, height, maxShort) {
    var w = Math.max(2, width || 2), h = Math.max(2, height || 2);
    if (maxShort && Math.min(w, h) > maxShort) {
      var s = maxShort / Math.min(w, h);
      w = w * s; h = h * s;
    }
    return { width: even(w), height: even(h) };
  }

  /* ---------- Camera bubble ---------- */

  var BUBBLE_SIZES = { s: 0.2, m: 0.28, l: 0.38 };
  var BUBBLE_MARGIN = 0.03;

  /* The bubble is stored as its centre (0..1 of the frame) and a size name.
     Returns its square box in pixels for a frame, kept fully inside the frame
     with a small margin. */
  function bubbleRect(frameW, frameH, bubble) {
    var b = bubble || {};
    var frac = BUBBLE_SIZES[b.size] || BUBBLE_SIZES.m;
    var side = Math.round(Math.min(frameW, frameH) * frac);
    var margin = Math.round(Math.min(frameW, frameH) * BUBBLE_MARGIN);
    var cx = (typeof b.x === 'number' ? b.x : 1) * frameW;
    var cy = (typeof b.y === 'number' ? b.y : 1) * frameH;
    var x = clamp(Math.round(cx - side / 2), margin, Math.max(margin, frameW - side - margin));
    var y = clamp(Math.round(cy - side / 2), margin, Math.max(margin, frameH - side - margin));
    return { x: x, y: y, w: side, h: side };
  }

  /* Centre positions for the four corners, for a frame of this shape. */
  function bubbleCorner(corner, frameW, frameH, size) {
    var r = bubbleRect(frameW, frameH, { x: 0, y: 0, size: size });
    var half = r.w / 2;
    var margin = Math.round(Math.min(frameW, frameH) * BUBBLE_MARGIN);
    var left = (margin + half) / frameW, right = 1 - left;
    var top = (margin + half) / frameH, bottom = 1 - top;
    switch (corner) {
      case 'tl': return { x: left, y: top };
      case 'tr': return { x: right, y: top };
      case 'bl': return { x: left, y: bottom };
      default: return { x: right, y: bottom };
    }
  }

  /* Where a camera frame of camW x camH is cut from so it fills the square
     bubble without stretching (centre crop). */
  function coverSource(camW, camH) {
    var side = Math.min(camW, camH);
    return { sx: (camW - side) / 2, sy: (camH - side) / 2, sw: side, sh: side };
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ---------- Names and clocks ---------- */

  function pad2(n) { return String(n).padStart(2, '0'); }

  function recordingName(kind, date, ext) {
    var d = date instanceof Date ? date : new Date(date || Date.now());
    var stamp = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + '-' + pad2(d.getMinutes()) + '-' + pad2(d.getSeconds());
    var label = kind === 'camera' ? 'Camera recording' : 'Screen recording';
    return label + ' ' + stamp + '.' + (ext || 'mp4');
  }

  function formatClock(ms) {
    var s = Math.max(0, Math.floor((ms || 0) / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? h + ':' + pad2(m) + ':' + pad2(r) : pad2(m) + ':' + pad2(r);
  }

  /* ---------- Writing a file in pieces ----------
     The tidied file is written by a muxer that mostly appends, but goes back a
     few times to fill in sizes and the duration. Appends become new stored
     pieces; going back becomes a small patch kept with the recording. At the end
     the pieces are joined and the patches laid over them. */

  /* state: { length }. Returns what to do with a write of len bytes at
     position: zero bytes to add first (a gap), the part of the data that
     overwrites what is already there, and the part that extends the file. */
  function planWrite(state, position, len) {
    var plan = { zeroFill: 0, patch: null, append: null };
    if (position > state.length) {
      plan.zeroFill = position - state.length;
      state.length = position;
    }
    var inside = Math.max(0, Math.min(len, state.length - position));
    if (inside > 0) plan.patch = { pos: position, dataStart: 0, dataEnd: inside };
    if (inside < len) {
      plan.append = { dataStart: inside, dataEnd: len };
      state.length += len - inside;
    }
    return plan;
  }

  /* Turns a file of length bytes plus patches [{pos, len}] (later ones win)
     into an ordered list of segments: { base: [start, end] } reads from the
     joined pieces, { patch: index, start, end } reads bytes start..end of that
     patch. The segments cover 0..length exactly once. */
  function assembleSegments(length, patches) {
    // Each byte belongs to the newest patch that covers it, or to the base.
    var cuts = [0, length];
    (patches || []).forEach(function (p) {
      cuts.push(clamp(p.pos, 0, length), clamp(p.pos + p.len, 0, length));
    });
    cuts = cuts.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    var out = [];
    for (var i = 0; i < cuts.length - 1; i++) {
      var s = cuts[i], e = cuts[i + 1];
      if (e <= s) continue;
      var owner = -1;
      for (var j = (patches || []).length - 1; j >= 0; j--) {
        var p = patches[j];
        if (p.pos <= s && p.pos + p.len >= e) { owner = j; break; }
      }
      var seg = owner === -1 ? { base: [s, e] } : { patch: owner, start: s - patches[owner].pos, end: e - patches[owner].pos };
      var last = out[out.length - 1];
      if (last && last.base && seg.base && last.base[1] === s) last.base[1] = e;
      else if (last && seg.patch != null && last.patch === seg.patch && last.end === seg.start) last.end = seg.end;
      else out.push(seg);
    }
    return out;
  }

  var api = {
    MIME_CANDIDATES: MIME_CANDIDATES, BUBBLE_SIZES: BUBBLE_SIZES,
    pickMimeType: pickMimeType, describeMime: describeMime, videoBitrate: videoBitrate, fitWithin: fitWithin,
    bubbleRect: bubbleRect, bubbleCorner: bubbleCorner, coverSource: coverSource,
    recordingName: recordingName, formatClock: formatClock,
    planWrite: planWrite, assembleSegments: assembleSegments
  };
  root.RecorderCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
