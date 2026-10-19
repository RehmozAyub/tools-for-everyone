/* Video Editor, core logic.
   Pure functions shared by video_editor.html and its tests: the timeline model
   and its edits (split, delete, trim, reorder, undo), where a picture lands in
   the output frame after crop, rotation and flips, how big the output is, the
   frames an export draws, fades, and a time stretcher that changes the speed
   of sound without changing its pitch.
   No DOM access here, so the same file also loads in Node for testing. */
(function (root) {
  'use strict';

  var MIN_CLIP = 0.1;         // seconds; shorter pieces are not kept
  var EPS = 1e-6;

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function round3(v) { return Math.round(v * 1000) / 1000; }
  function even(v) { return Math.max(2, Math.round(v / 2) * 2); }

  var seq = 0;
  function uid(prefix) {
    seq++;
    return (prefix || 'id') + seq.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  /* ---------- The project ----------
     project = {
       clips: [ { id, src, kind: 'video'|'image', in, out, dur (images), speed,
                  volume, muted, crop: {x,y,w,h} (0..1 of the turned picture),
                  rotate: 0|90|180|270, flipH, flipV } ],   played one after another
       texts: [ { id, text, start, end, x, y, size, color, style, bold, font } ],
       audio: [ { id, src, start, in, out, volume, fadeIn, fadeOut } ],
       frame: 'auto'|'16:9'|'9:16'|'1:1'|'4:5'|'4:3', fit: 'contain'|'blur'|'cover'
     } */

  function emptyProject() {
    return { clips: [], texts: [], audio: [], frame: 'auto', fit: 'contain' };
  }

  var FULL = { x: 0, y: 0, w: 1, h: 1 };

  function makeClip(src, kind, duration) {
    var c = { id: uid('c'), src: src, kind: kind, in: 0, out: 0, dur: 0, speed: 1, volume: 1, muted: false,
      crop: clone(FULL), rotate: 0, flipH: false, flipV: false };
    if (kind === 'image') c.dur = duration || 3;
    else c.out = duration || 0;
    return c;
  }

  function clipDuration(c) {
    if (c.kind === 'image') return Math.max(MIN_CLIP, c.dur || 0);
    return Math.max(0, (c.out - c.in) / (c.speed || 1));
  }

  /* Each clip with its place on the timeline. */
  function layout(project) {
    var t = 0;
    return project.clips.map(function (c, i) {
      var d = clipDuration(c);
      var e = { clip: c, index: i, start: t, end: t + d };
      t += d;
      return e;
    });
  }

  function totalDuration(project) {
    var t = 0;
    project.clips.forEach(function (c) { t += clipDuration(c); });
    return t;
  }

  /* The clip playing at timeline time t, and the matching time in its source.
     A time exactly on a cut belongs to the clip that starts there. */
  function locate(project, t) {
    var L = layout(project);
    if (!L.length) return null;
    var e = L[L.length - 1];
    for (var i = 0; i < L.length; i++) {
      if (t < L[i].end - EPS) { e = L[i]; break; }
    }
    var local = clamp(t - e.start, 0, e.end - e.start);
    return { index: e.index, clip: e.clip, start: e.start, end: e.end, local: local, sourceTime: sourceTimeAt(e.clip, local) };
  }

  function sourceTimeAt(clip, local) {
    if (clip.kind === 'image') return 0;
    return clamp(clip.in + local * (clip.speed || 1), clip.in, clip.out);
  }

  function findIndex(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }

  /* Cuts the clip under t in two. Returns a new project, or null when t is too
     close to a cut for both halves to be worth keeping. */
  function splitAt(project, t) {
    var loc = locate(project, t);
    if (!loc) return null;
    var c = loc.clip;
    if (loc.local < MIN_CLIP - EPS || (loc.end - loc.start) - loc.local < MIN_CLIP - EPS) return null;
    var p = clone(project);
    var a = p.clips[loc.index];
    var b = clone(a);
    b.id = uid('c');
    if (c.kind === 'image') {
      a.dur = round3(loc.local);
      b.dur = round3(c.dur - loc.local);
    } else {
      var cut = c.in + loc.local * (c.speed || 1);
      a.out = cut;
      b.in = cut;
    }
    p.clips.splice(loc.index + 1, 0, b);
    return { project: p, leftId: a.id, rightId: b.id };
  }

  /* Takes the timeline range t0..t1 out of the overlays after a clip there has
     been deleted: text and sound after it move back, text across it shortens,
     and sound that started inside it starts at the cut instead. */
  function rippleOverlays(p, t0, t1) {
    var d = t1 - t0;
    p.texts = p.texts.filter(function (x) {
      if (x.end <= t0 + EPS) return true;
      if (x.start >= t1 - EPS) { x.start -= d; x.end -= d; return true; }
      var ns = x.start < t0 ? x.start : t0;
      var ne = x.end > t1 ? x.end - d : t0;
      x.start = round3(ns); x.end = round3(ne);
      return x.end - x.start >= MIN_CLIP;
    });
    p.audio = p.audio.filter(function (a) {
      if (a.start >= t1 - EPS) { a.start = round3(a.start - d); return true; }
      if (a.start >= t0 - EPS) {
        a.in = a.in + (t1 - a.start);
        a.start = t0;
        return a.out - a.in >= MIN_CLIP;
      }
      return true;
    });
  }

  function removeClip(project, id) {
    var L = layout(project);
    var i = findIndex(project.clips, id);
    if (i === -1) return project;
    var p = clone(project);
    p.clips.splice(i, 1);
    rippleOverlays(p, L[i].start, L[i].end);
    return p;
  }

  function moveClip(project, id, toIndex) {
    var i = findIndex(project.clips, id);
    if (i === -1) return project;
    var p = clone(project);
    var c = p.clips.splice(i, 1)[0];
    p.clips.splice(clamp(toIndex, 0, p.clips.length), 0, c);
    return p;
  }

  /* Index a dragged clip lands on, from the timeline time under the pointer:
     before the first clip whose middle is to the right of it. */
  function dropIndex(project, id, t) {
    var L = layout(project).filter(function (e) { return e.clip.id !== id; });
    var others = layout({ clips: L.map(function (e) { return e.clip; }) });
    for (var i = 0; i < others.length; i++) {
      if (t < (others[i].start + others[i].end) / 2) return i;
    }
    return others.length;
  }

  /* Moves one edge of a clip to source time `to` (images: changes length). */
  function trimClip(project, id, edge, to, sourceDuration) {
    var i = findIndex(project.clips, id);
    if (i === -1) return project;
    var p = clone(project);
    var c = p.clips[i];
    if (c.kind === 'image') {
      c.dur = round3(Math.max(MIN_CLIP, to));
      return p;
    }
    var maxT = sourceDuration != null ? sourceDuration : Infinity;
    var minLen = MIN_CLIP * (c.speed || 1);
    if (edge === 'in') c.in = clamp(to, 0, c.out - minLen);
    else c.out = clamp(to, c.in + minLen, maxT);
    return p;
  }

  function updateIn(project, listName, id, patch) {
    var p = clone(project);
    var list = p[listName];
    var i = findIndex(list, id);
    if (i !== -1) Object.keys(patch).forEach(function (k) { list[i][k] = patch[k]; });
    return p;
  }

  function removeFrom(project, listName, id) {
    var p = clone(project);
    p[listName] = p[listName].filter(function (x) { return x.id !== id; });
    return p;
  }

  function makeText(start, end, text) {
    return { id: uid('t'), text: text || 'Your text', start: round3(start), end: round3(end),
      x: 0.5, y: 0.85, size: 0.07, color: '#ffffff', style: 'box', bold: true, font: 'sans' };
  }

  function makeAudio(src, start, duration) {
    return { id: uid('a'), src: src, start: round3(start || 0), in: 0, out: duration || 0, volume: 1, fadeIn: 0, fadeOut: 0 };
  }

  function audioEnd(a) { return a.start + Math.max(0, a.out - a.in); }

  /* Volume of a sound item at timeline time t, with its fades. A fade out ends
     where the sound stops being heard: its own end, or the end of the video
     (limit) when that comes first. */
  function gainAt(a, t, limit) {
    var end = Math.min(audioEnd(a), limit == null ? Infinity : limit);
    if (t < a.start || t >= end) return 0;
    var g = a.volume == null ? 1 : a.volume;
    if (a.fadeIn > 0 && t - a.start < a.fadeIn) g *= (t - a.start) / a.fadeIn;
    if (a.fadeOut > 0 && end - t < a.fadeOut) g *= (end - t) / a.fadeOut;
    return Math.max(0, g);
  }

  /* ---------- Crop, rotation and flips ---------- */

  function orientedSize(w, h, rotate) {
    return (rotate === 90 || rotate === 270) ? { w: h, h: w } : { w: w, h: h };
  }

  /* A crop kept across a quarter turn: the same part of the picture stays selected. */
  function rotateCrop(crop, clockwise) {
    var c = crop || FULL;
    return clockwise
      ? { x: round6(1 - c.y - c.h), y: round6(c.x), w: round6(c.h), h: round6(c.w) }
      : { x: round6(c.y), y: round6(1 - c.x - c.w), w: round6(c.h), h: round6(c.w) };
  }
  function flipCrop(crop, horizontal) {
    var c = crop || FULL;
    return horizontal
      ? { x: round6(1 - c.x - c.w), y: c.y, w: c.w, h: c.h }
      : { x: c.x, y: round6(1 - c.y - c.h), w: c.w, h: c.h };
  }
  function round6(v) { return Math.round(v * 1e6) / 1e6; }

  function normaliseCrop(c) {
    var x = clamp(c.x, 0, 1), y = clamp(c.y, 0, 1);
    var w = clamp(c.w, 0.02, 1 - x), h = clamp(c.h, 0.02, 1 - y);
    return { x: x, y: y, w: w, h: h };
  }

  /* Where a source picture of srcW x srcH lands in an outW x outH frame.
     Returns a canvas transform [a, b, c, d, e, f] that draws the untouched
     source at (0, 0, srcW, srcH), and the rectangle to clip drawing to.
     Order: turn and flip the picture, cut the crop out of the turned picture,
     then fit it into the frame ('contain' keeps it whole, 'cover' fills). */
  function drawGeometry(o) {
    var rot = o.rotate || 0;
    var sw = o.srcW, sh = o.srcH;
    var os = orientedSize(sw, sh, rot);
    var crop = o.crop || FULL;
    var cx = crop.x * os.w, cy = crop.y * os.h, cw = Math.max(1, crop.w * os.w), ch = Math.max(1, crop.h * os.h);
    var fit = o.fit === 'cover' ? 'cover' : 'contain';
    var s = fit === 'cover' ? Math.max(o.outW / cw, o.outH / ch) : Math.min(o.outW / cw, o.outH / ch);
    var dw = cw * s, dh = ch * s;
    var dx = (o.outW - dw) / 2, dy = (o.outH - dh) / 2;

    // Source (a, b) to turned picture (u, v).
    var m;
    switch (rot) {
      case 90: m = [0, 1, -1, 0, sh, 0]; break;       // u = sh - b, v = a
      case 180: m = [-1, 0, 0, -1, sw, sh]; break;    // u = sw - a, v = sh - b
      case 270: m = [0, -1, 1, 0, 0, sw]; break;      // u = b, v = sw - a
      default: m = [1, 0, 0, 1, 0, 0];
    }
    if (o.flipH) m = mul([-1, 0, 0, 1, os.w, 0], m);
    if (o.flipV) m = mul([1, 0, 0, -1, 0, os.h], m);
    // Turned picture to output: X = dx + (u - cx) * s.
    m = mul([s, 0, 0, s, dx - cx * s, dy - cy * s], m);
    var clipRect = fit === 'cover' ? [0, 0, o.outW, o.outH] : [dx, dy, dw, dh];
    return { matrix: m, clip: clipRect, dest: [dx, dy, dw, dh] };
  }

  // Composes canvas transforms: the result applies `second` first, then `first`.
  function mul(first, second) {
    var a1 = first[0], b1 = first[1], c1 = first[2], d1 = first[3], e1 = first[4], f1 = first[5];
    var a2 = second[0], b2 = second[1], c2 = second[2], d2 = second[3], e2 = second[4], f2 = second[5];
    return [
      a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
      a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
      a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1
    ];
  }

  function applyMatrix(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

  /* ---------- Output size ---------- */

  var FRAMES = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5, '4:3': 4 / 3 };

  /* The picture's shape and size. 'auto' follows the first picture (after its
     crop and turn) and is never made larger than it; a named shape uses
     shortSide for its short edge. shortSide 0 keeps the first picture's size. */
  function frameSize(frame, baseW, baseH, shortSide) {
    var bw = Math.max(2, baseW || 1920), bh = Math.max(2, baseH || 1080);
    var ratio = FRAMES[frame] || (bw / bh);
    var baseShort = Math.min(bw, bh);
    var short = frame === 'auto' || !FRAMES[frame]
      ? (shortSide ? Math.min(shortSide, baseShort) : baseShort)
      : (shortSide || 1080);
    var w, h;
    if (ratio >= 1) { h = short; w = short * ratio; } else { w = short; h = short / ratio; }
    return { width: even(w), height: even(h) };
  }

  /* The first picture's size after its crop and turn, which 'auto' follows. */
  function baseSize(clip, srcW, srcH) {
    var os = orientedSize(srcW, srcH, clip.rotate || 0);
    var c = clip.crop || FULL;
    return { w: Math.max(2, Math.round(os.w * c.w)), h: Math.max(2, Math.round(os.h * c.h)) };
  }

  /* ---------- Export frames ----------
     Frame n shows timeline time n / fps. A clip covers the frames whose time
     falls inside it. */
  function frameCount(total, fps) { return Math.max(1, Math.round(total * fps)); }

  function framesForEntry(entry, fps, total) {
    var n0 = Math.max(0, Math.ceil(entry.start * fps - EPS));
    var n1 = Math.ceil(entry.end * fps - EPS);
    // The last clip ends on the export's last frame, whichever way the rounding went.
    if (total != null && entry.end >= total - EPS) n1 = frameCount(total, fps);
    return { first: n0, count: Math.max(0, n1 - n0) };
  }

  /* ---------- Undo history ---------- */

  function History(limit) {
    this.limit = limit || 100;
    this.past = [];
    this.future = [];
  }
  History.prototype.push = function (state) {
    this.past.push(JSON.stringify(state));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  };
  History.prototype.undo = function (current) {
    if (!this.past.length) return null;
    this.future.push(JSON.stringify(current));
    return JSON.parse(this.past.pop());
  };
  History.prototype.redo = function (current) {
    if (!this.future.length) return null;
    this.past.push(JSON.stringify(current));
    return JSON.parse(this.future.pop());
  };
  History.prototype.canUndo = function () { return this.past.length > 0; };
  History.prototype.canRedo = function () { return this.future.length > 0; };
  History.prototype.clear = function () { this.past = []; this.future = []; };

  /* ---------- Time stretching (WSOLA) ----------
     Plays sound faster or slower without making voices high or low: short
     overlapping pieces are taken from the input at the new rate, each one
     nudged to where it lines up best with the end of the last, and blended. */

  function createStretcher(opts) {
    var channels = opts.channels || 1;
    var rate = opts.sampleRate || 48000;
    var speed = opts.speed || 1;
    var N = Math.max(64, Math.round(rate * 0.04) & ~1);     // piece length, 40 ms
    var Hs = N / 2;                                            // output step
    var Ha = Hs * speed;                                       // input step
    var tol = Math.round(rate * 0.012);                       // search range, 12 ms
    var win = new Float32Array(N);
    for (var i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);   // sums to 1 at 50% overlap

    var input = [];            // Float32Array per channel, from absolute sample `inBase`
    for (var c = 0; c < channels; c++) input.push(new Float32Array(0));
    var mono = new Float32Array(0);   // the channels mixed, used to line pieces up
    var inBase = 0, inLen = 0;
    var acc = [];              // overlap-add accumulator, from output sample `outBase`
    for (c = 0; c < channels; c++) acc.push(new Float32Array(N));
    var k = 0;                 // pieces written
    var prevPos = -1;          // where the previous piece was taken from
    var ended = false;
    var ready = [];            // finished output blocks
    var readyLen = 0;

    function bestOffset(nominal) {
      if (prevPos < 0) return nominal;
      var target = prevPos + Hs;   // where the previous piece would naturally continue
      var L = Hs;
      var lo = Math.max(inBase, nominal - tol), hi = Math.min(inBase + inLen - N, nominal + tol);
      if (hi < lo) return clamp(nominal, inBase, Math.max(inBase, inBase + inLen - N));
      if (target + L > inBase + inLen || target < inBase) return clamp(nominal, lo, hi);
      var best = nominal, bestScore = -Infinity, step = 4, sub = 4;
      var t0 = target - inBase;
      var pass = function (from, to, st) {
        for (var x = from; x <= to; x += st) {
          var dot = 0, e = 0, x0 = x - inBase;
          for (var q = 0; q < L; q += sub) {
            var a = mono[x0 + q];
            dot += a * mono[t0 + q]; e += a * a;
          }
          var score = e > 0 ? dot / Math.sqrt(e) : dot;
          if (score > bestScore) { bestScore = score; best = x; }
        }
      };
      pass(lo, hi, step);
      var c0 = best;
      pass(Math.max(lo, c0 - step), Math.min(hi, c0 + step), 1);
      return best;
    }

    function process() {
      for (;;) {
        var nominal = Math.round(k * Ha);
        var needEnd = nominal + tol + N;
        if (!ended && inBase + inLen < needEnd) return;
        if (nominal >= inBase + inLen) return;
        var pos = bestOffset(nominal);
        if (pos + N > inBase + inLen) {
          if (!ended) return;
          pos = Math.max(inBase, Math.min(pos, inBase + inLen - 1));
        }
        for (var ch = 0; ch < channels; ch++) {
          var src = input[ch], dst = acc[ch], off = pos - inBase;
          for (var q = 0; q < N; q++) {
            var j = off + q;
            dst[q] += (j < inLen ? src[j] : 0) * win[q];
          }
        }
        // The first half of the accumulator is finished.
        var out = [];
        for (ch = 0; ch < channels; ch++) {
          out.push(acc[ch].slice(0, Hs));
          var next = new Float32Array(N);
          next.set(acc[ch].subarray(Hs));
          acc[ch] = next;
        }
        // The very first piece has nothing before it to blend with; it is used as is.
        if (k === 0) for (ch = 0; ch < channels; ch++) for (q = 0; q < Hs; q++) out[ch][q] = input[ch][pos - inBase + q] || 0;
        ready.push(out); readyLen += Hs;
        prevPos = pos;
        k++;
        // Drop input that can no longer be needed.
        var keepFrom = Math.min(Math.round(k * Ha) - tol, prevPos) - 1;
        if (keepFrom - inBase > rate) {
          var drop = keepFrom - inBase;
          for (ch = 0; ch < channels; ch++) input[ch] = input[ch].slice(drop, inLen);
          mono = mono.slice(drop, inLen);
          inBase += drop; inLen -= drop;
        }
      }
    }

    return {
      speed: speed,
      push: function (chans) {
        var n = chans[0].length;
        if (!n) return;
        var m = new Float32Array(inLen + n);
        m.set(mono.subarray(0, inLen));
        for (var ch = 0; ch < channels; ch++) {
          var src = chans[Math.min(ch, chans.length - 1)];
          var merged = new Float32Array(inLen + n);
          merged.set(input[ch].subarray(0, inLen));
          merged.set(src, inLen);
          input[ch] = merged;
          for (var q = 0; q < n; q++) m[inLen + q] += src[q];
        }
        mono = m;
        inLen += n;
        process();
      },
      end: function () { ended = true; process(); },
      available: function () { return readyLen; },
      /* Takes up to n finished samples per channel. */
      pull: function (n) {
        var want = Math.min(n, readyLen), outArr = [];
        for (var ch = 0; ch < channels; ch++) outArr.push(new Float32Array(want));
        var got = 0;
        while (got < want) {
          var blk = ready[0], take = Math.min(blk[0].length, want - got);
          for (ch = 0; ch < channels; ch++) outArr[ch].set(blk[ch].subarray(0, take), got);
          if (take === blk[0].length) ready.shift();
          else for (ch = 0; ch < channels; ch++) blk[ch] = blk[ch].subarray(take);
          got += take;
        }
        readyLen -= want;
        return outArr;
      }
    };
  }

  /* ---------- Text positions ---------- */

  var TEXT_SPOTS = {
    tl: [0.08, 0.1], tc: [0.5, 0.1], tr: [0.92, 0.1],
    ml: [0.08, 0.5], mc: [0.5, 0.5], mr: [0.92, 0.5],
    bl: [0.08, 0.85], bc: [0.5, 0.85], br: [0.92, 0.85]
  };

  function textsAt(project, t) {
    return project.texts.filter(function (x) { return t >= x.start - EPS && t < x.end - EPS; });
  }

  /* ---------- Times ---------- */

  function formatTime(sec, withTenths) {
    if (sec == null || !isFinite(sec)) sec = 0;
    sec = Math.max(0, sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec - h * 3600 - m * 60;
    var ss = withTenths ? (Math.floor(s * 10) / 10).toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + ss;
  }

  /* "1:02.5", "62.5", "1:02:03" back to seconds; null when it is not a time. */
  function parseTime(text) {
    var s = String(text == null ? '' : text).trim().replace(',', '.');
    if (!s) return null;
    if (!/^\d+(:\d+){0,2}(\.\d+)?$/.test(s)) return null;
    var parts = s.split(':').map(Number);
    var v = 0;
    for (var i = 0; i < parts.length; i++) v = v * 60 + parts[i];
    return v;
  }

  var api = {
    MIN_CLIP: MIN_CLIP, FRAMES: FRAMES, TEXT_SPOTS: TEXT_SPOTS, FULL: FULL,
    uid: uid, clone: clone, emptyProject: emptyProject, makeClip: makeClip, makeText: makeText, makeAudio: makeAudio,
    clipDuration: clipDuration, layout: layout, totalDuration: totalDuration, locate: locate, sourceTimeAt: sourceTimeAt,
    splitAt: splitAt, removeClip: removeClip, moveClip: moveClip, dropIndex: dropIndex, trimClip: trimClip,
    rippleOverlays: rippleOverlays, updateIn: updateIn, removeFrom: removeFrom,
    audioEnd: audioEnd, gainAt: gainAt, textsAt: textsAt,
    orientedSize: orientedSize, rotateCrop: rotateCrop, flipCrop: flipCrop, normaliseCrop: normaliseCrop,
    drawGeometry: drawGeometry, applyMatrix: applyMatrix, frameSize: frameSize, baseSize: baseSize,
    frameCount: frameCount, framesForEntry: framesForEntry,
    History: History, createStretcher: createStretcher,
    formatTime: formatTime, parseTime: parseTime
  };
  root.EditorCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
