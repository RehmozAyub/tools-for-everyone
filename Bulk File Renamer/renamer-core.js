/* Bulk File Renamer, core logic.
   Pure functions shared by bulk_rename.html and its tests: the renaming steps,
   name checks, the in-place rename planner and the rename script writers.
   No DOM access here, so the same file also loads in Node for testing. */
(function (root) {
  'use strict';

  /* ---------- Rules ---------- */

  var RULE_IDS = ['find_replace', 'regex', 'prefix_suffix', 'numbering', 'date_stamp', 'case', 'extension', 'trim'];
  var FIX_IDS = ['fix_illegal', 'fix_dupes'];

  var DATE_FORMATS = ['YYYY-MM-DD', 'YYYYMMDD', 'DD-MM-YYYY', 'MM-DD-YYYY', 'YYYY-MM-DD_HH-mm-ss', 'YYYYMMDD_HHmmss'];

  function pad2(n) { return String(n).padStart(2, '0'); }

  /* Local date helpers. new Date('2024-03-01') is UTC midnight, which is the previous
     evening west of UTC, so dates are always built from their parts. */
  function localDateString(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function localTimeString(d) {
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function parseLocalDate(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }
  function withTime(date, timeStr) {
    var r = new Date(date.getTime());
    var m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(timeStr || ''));
    if (m) r.setHours(+m[1], +m[2], +(m[3] || 0), 0);
    else r.setHours(0, 0, 0, 0);
    return r;
  }
  function formatStamp(d, fmt) {
    var Y = d.getFullYear(), M = pad2(d.getMonth() + 1), D = pad2(d.getDate());
    var h = pad2(d.getHours()), m = pad2(d.getMinutes()), s = pad2(d.getSeconds());
    switch (fmt) {
      case 'YYYYMMDD': return '' + Y + M + D;
      case 'DD-MM-YYYY': return D + '-' + M + '-' + Y;
      case 'MM-DD-YYYY': return M + '-' + D + '-' + Y;
      case 'YYYY-MM-DD_HH-mm-ss': return Y + '-' + M + '-' + D + '_' + h + '-' + m + '-' + s;
      case 'YYYYMMDD_HHmmss': return '' + Y + M + D + '_' + h + m + s;
      default: return Y + '-' + M + '-' + D;
    }
  }
  function formatHasTime(fmt) { return /HH/.test(fmt || ''); }

  /* The date a date stamp step uses for one file. */
  function stampDate(opts, file, now) {
    var src = opts.source || 'today';
    if (src === 'file' && file && isFinite(file.lastModified)) return new Date(file.lastModified);
    if (src === 'custom') {
      var d = parseLocalDate(opts.date) || new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return withTime(d, opts.time);
    }
    return new Date(now.getTime());
  }

  function splitName(name) {
    var lastDot = name.lastIndexOf('.');
    if (lastDot <= 0) return [name, ''];
    return [name.slice(0, lastDot), name.slice(lastDot)];
  }

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function toInt(v, def) {
    var n = parseInt(v, 10);
    return isFinite(n) ? n : def;
  }

  /* Split a name into words at spaces, underscores, hyphens, camelCase and
     PascalCase humps, and letter/digit boundaries, before any case change. */
  function splitWords(stem) {
    return stem
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
      .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
      .replace(/(\p{L})(\p{N})/gu, '$1 $2')
      .replace(/(\p{N})(\p{L})/gu, '$1 $2')
      .split(/[\s_\-]+/)
      .filter(Boolean);
  }
  function capitalise(w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }

  function convertCase(stem, mode) {
    var words;
    switch (mode) {
      case 'lowercase': return stem.toLowerCase();
      case 'UPPERCASE': return stem.toUpperCase();
      case 'Title Case': return stem.replace(/[\p{L}\p{N}]\S*/gu, capitalise);
      case 'snake_case':
        words = splitWords(stem);
        return words.length ? words.map(function (w) { return w.toLowerCase(); }).join('_') : stem;
      case 'kebab-case':
        words = splitWords(stem);
        return words.length ? words.map(function (w) { return w.toLowerCase(); }).join('-') : stem;
      case 'camelCase':
        words = splitWords(stem);
        if (!words.length) return stem;
        return words[0].toLowerCase() + words.slice(1).map(capitalise).join('');
      default: return stem;
    }
  }

  var ILLEGAL_RE = /[\\/:*?"<>|\u0000-\u001f]/;
  var ILLEGAL_RE_G = /[\\/:*?"<>|\u0000-\u001f]/g;
  var RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  function utf8Length(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  function ci(s) { return String(s).normalize('NFC').toLowerCase(); }
  function dirKey(dir, name) { return ci(dir || '') + '\u0000' + ci(name); }

  function reservedBase(name) {
    var base = name.split('.')[0].replace(/[ ]+$/, '');
    return RESERVED_RE.test(base) ? base : null;
  }

  function isEmptyName(name, original) {
    if (name === '') return true;
    return name.charAt(0) === '.' && String(original || '').charAt(0) !== '.' && splitName(name)[1] === '';
  }

  /* Make one name safe for Windows, macOS and Linux. */
  function makeSafe(name, original) {
    var n = name.replace(ILLEGAL_RE_G, '_').replace(/[. ]+$/, '');
    if (isEmptyName(n, original)) n = 'unnamed' + n;
    var base = reservedBase(n);
    if (base) n = base + '_' + n.slice(base.length);
    if (utf8Length(n) > 255) {
      var parts = splitName(n), stem = Array.from(parts[0]), ext = parts[1];
      if (utf8Length(ext) > 60) { ext = ''; stem = Array.from(n); }
      while (stem.length && utf8Length(stem.join('') + ext) > 255) stem.pop();
      n = stem.join('').replace(/[. ]+$/, '') + ext;
    }
    return n;
  }

  /* Give the second and later copies of a name " (2)", " (3)" and so on. */
  function numberDuplicates(names, dirs) {
    var taken = new Set(), seen = new Map();
    names.forEach(function (n, i) { taken.add(dirKey(dirs && dirs[i], n)); });
    return names.map(function (n, i) {
      var d = dirs && dirs[i], k = dirKey(d, n);
      if (!seen.has(k)) { seen.set(k, 1); return n; }
      var c = seen.get(k), parts = splitName(n), cand;
      do { c++; cand = parts[0] + ' (' + c + ')' + parts[1]; } while (taken.has(dirKey(d, cand)));
      seen.set(k, c);
      taken.add(dirKey(d, cand));
      return cand;
    });
  }

  var RULES = {
    find_replace: {
      label: 'Find and replace', icon: 'magnifying-glass',
      desc: 'Swap one piece of text for another in every filename.',
      defaults: function () { return { find: '', replace: '', matchCase: true }; }
    },
    regex: {
      label: 'Regex pattern', icon: 'brackets-curly',
      desc: 'Apply a regular expression to the part of the name before the extension.',
      defaults: function () { return { pattern: '', replacement: '', ignoreCase: false }; }
    },
    prefix_suffix: {
      label: 'Prefix or suffix', icon: 'text-indent',
      desc: 'Add text before or after the name, leaving the extension alone.',
      defaults: function () { return { prefix: '', suffix: '' }; }
    },
    numbering: {
      label: 'Numbering', icon: 'list-numbers',
      desc: 'Number the files in the order they are listed.',
      defaults: function () { return { start: '1', step: '1', pad: '3', position: 'Prefix', sep: '_', replaceAll: false }; }
    },
    date_stamp: {
      label: 'Date stamp', icon: 'calendar-blank',
      desc: 'Add a date or a timestamp to every filename.',
      defaults: function () { return { format: 'YYYY-MM-DD', source: 'today', position: 'Prefix', sep: '_', date: '', time: '' }; }
    },
    'case': {
      label: 'Letter case', icon: 'text-aa',
      desc: 'Change how the letters in each filename are capitalised.',
      defaults: function () { return { mode: 'lowercase' }; }
    },
    extension: {
      label: 'Extension', icon: 'wrench',
      desc: 'Change, remove, or add a file extension.',
      defaults: function () { return { mode: 'change', ext: '' }; }
    },
    trim: {
      label: 'Trim and clean', icon: 'scissors',
      desc: 'Cut characters, replace spaces, and tidy up messy filenames.',
      defaults: function () { return { start: '0', end: '0', spaces: '', stripSpecial: false }; }
    },
    fix_illegal: {
      label: 'Make names safe', icon: 'shield-check', fix: true,
      desc: 'Replaces characters that Windows or macOS do not allow with _, and fixes reserved, empty and overlong names.',
      defaults: function () { return {}; }
    },
    fix_dupes: {
      label: 'Number duplicates', icon: 'copy', fix: true,
      desc: 'Adds (2), (3) and so on to names that would otherwise clash.',
      defaults: function () { return {}; }
    }
  };

  function q(s) { return '“' + s + '”'; }

  /* One line describing a step's settings, for its collapsed card and the panel summary. */
  function describeStep(step) {
    var o = step.opts || {};
    switch (step.type) {
      case 'find_replace': return o.find ? q(o.find) + ' → ' + q(o.replace || '') : 'Nothing to find yet';
      case 'regex': return o.pattern ? '/' + o.pattern + '/ → ' + q(o.replacement || '') : 'No pattern yet';
      case 'prefix_suffix':
        if (!o.prefix && !o.suffix) return 'Nothing to add yet';
        return [o.prefix ? 'before ' + q(o.prefix) : '', o.suffix ? 'after ' + q(o.suffix) : ''].filter(Boolean).join(', ');
      case 'numbering': {
        var pad = Math.max(0, toInt(o.pad, 3)), first = String(toInt(o.start, 1));
        var shown = pad ? first.padStart(pad, '0') : first;
        return (o.replaceAll ? 'Name becomes ' : (o.position === 'Suffix' ? 'After name, ' : 'Before name, ')) + shown + ', ' + String(toInt(o.start, 1) + Math.max(1, toInt(o.step, 1))).padStart(pad, '0') + '…';
      }
      case 'date_stamp':
        return o.format + ', ' + (o.source === 'file' ? 'file date' : o.source === 'custom' ? (o.date || 'today') : 'today');
      case 'case': return o.mode;
      case 'extension':
        if (o.mode === 'remove') return 'Remove the extension';
        if (!o.ext) return 'No extension yet';
        return (o.mode === 'add' ? 'Add ' : 'Change to ') + (o.ext.charAt(0) === '.' ? o.ext : '.' + o.ext);
      case 'trim': {
        var bits = [];
        if (toInt(o.start, 0) > 0) bits.push('first ' + toInt(o.start, 0));
        if (toInt(o.end, 0) > 0) bits.push('last ' + toInt(o.end, 0));
        if (o.spaces) bits.push(o.spaces === 'remove' ? 'remove spaces' : 'spaces to ' + o.spaces);
        if (o.stripSpecial) bits.push('strip special');
        return bits.length ? bits.join(', ') : 'Nothing to trim yet';
      }
      case 'fix_illegal': return 'Replace illegal characters with _';
      case 'fix_dupes': return 'Add (2), (3) to duplicates';
      default: return '';
    }
  }

  /* Apply one step to a list of names. ctx: { files: [{lastModified}], now: Date,
     originals: [name], dirs: [dir] }. Returns { names, info }. */
  function applyStep(step, names, ctx) {
    var o = step.opts || {}, info = {};
    ctx = ctx || {};
    var now = ctx.now || new Date();
    switch (step.type) {
      case 'find_replace': {
        if (!o.find) return { names: names.slice(), info: info };
        var reFind = new RegExp(escapeRegExp(o.find), o.matchCase ? 'g' : 'gi');
        var hits = 0;
        var out = names.map(function (name) {
          var p = splitName(name);
          reFind.lastIndex = 0;
          if (reFind.test(p[0])) hits++;
          reFind.lastIndex = 0;
          return p[0].replace(reFind, function () { return o.replace || ''; }) + p[1];
        });
        info.matches = hits; info.total = names.length;
        return { names: out, info: info };
      }
      case 'regex': {
        if (!o.pattern) return { names: names.slice(), info: info };
        var re;
        try { re = new RegExp(o.pattern, 'g' + (o.ignoreCase ? 'i' : '')); }
        catch (e) {
          var msg = String(e && e.message || e);
          info.error = msg.slice(msg.lastIndexOf(': ') + 2) || msg;
          return { names: names.slice(), info: info };
        }
        var count = 0;
        var res = names.map(function (name) {
          var p = splitName(name);
          re.lastIndex = 0;
          if (re.test(p[0])) count++;
          re.lastIndex = 0;
          return p[0].replace(re, o.replacement || '') + p[1];
        });
        info.matches = count; info.total = names.length;
        return { names: res, info: info };
      }
      case 'prefix_suffix':
        return { names: names.map(function (name) {
          var p = splitName(name);
          return (o.prefix || '') + p[0] + (o.suffix || '') + p[1];
        }), info: info };
      case 'numbering': {
        var start = toInt(o.start, 1), stepBy = toInt(o.step, 1), pad = Math.min(20, Math.max(0, toInt(o.pad, 3)));
        if (stepBy === 0) stepBy = 1;
        var sep = o.sep == null ? '_' : o.sep;
        return { names: names.map(function (name, idx) {
          var p = splitName(name), v = start + idx * stepBy;
          var num = (v < 0 ? '-' : '') + String(Math.abs(v)).padStart(pad, '0');
          if (o.replaceAll) return num + p[1];
          if (o.position === 'Suffix') return p[0] + sep + num + p[1];
          return num + sep + p[0] + p[1];
        }), info: info };
      }
      case 'date_stamp': {
        var dsep = o.sep == null ? '_' : o.sep;
        return { names: names.map(function (name, idx) {
          var p = splitName(name);
          var stamp = formatStamp(stampDate(o, ctx.files && ctx.files[idx], now), o.format);
          if (o.position === 'Suffix') return p[0] + dsep + stamp + p[1];
          return stamp + dsep + p[0] + p[1];
        }), info: info };
      }
      case 'case':
        return { names: names.map(function (name) {
          var p = splitName(name);
          return convertCase(p[0], o.mode) + p[1];
        }), info: info };
      case 'extension': {
        var ext = o.ext || '';
        var dotExt = ext ? (ext.charAt(0) === '.' ? ext : '.' + ext) : '';
        return { names: names.map(function (name) {
          var p = splitName(name);
          if (o.mode === 'remove') return p[0];
          if (!dotExt) return name;
          if (o.mode === 'add') return p[0] + p[1] + dotExt;
          return p[0] + dotExt;
        }), info: info };
      }
      case 'trim': {
        var ts = Math.max(0, toInt(o.start, 0)), te = Math.max(0, toInt(o.end, 0));
        return { names: names.map(function (name) {
          var p = splitName(name), stem = p[0];
          if (ts > 0) stem = stem.slice(ts);
          if (te > 0 && te < stem.length) stem = stem.slice(0, -te);
          if (o.spaces === 'remove') stem = stem.replace(/ /g, '');
          else if (o.spaces) stem = stem.replace(/ /g, o.spaces);
          if (o.stripSpecial) stem = stem.replace(/[^\w\-.]/g, '');
          return stem + p[1];
        }), info: info };
      }
      case 'fix_illegal':
        return { names: names.map(function (name, i) {
          return makeSafe(name, ctx.originals ? ctx.originals[i] : name);
        }), info: info };
      case 'fix_dupes':
        return { names: numberDuplicates(names, ctx.dirs), info: info };
      default:
        return { names: names.slice(), info: info };
    }
  }

  /* Run every enabled step in order. Returns { names, infos: { stepId: info } }. */
  function runSteps(steps, names, ctx) {
    var cur = names.slice(), infos = {};
    ctx = Object.assign({ originals: names }, ctx || {});
    (steps || []).forEach(function (s) {
      if (!s.enabled) return;
      var r = applyStep(s, cur, ctx);
      cur = r.names;
      infos[s.id] = r.info;
    });
    return { names: cur, infos: infos };
  }

  /* ---------- Checks ---------- */

  var PROBLEM_LABELS = {
    dup: ['name clashes with another', 'names clash with another'],
    illegal: ['has a character that is not allowed', 'have characters that are not allowed'],
    empty: ['name is empty', 'names are empty'],
    trailing: ['ends with a full stop or space', 'end with a full stop or space'],
    reserved: ['is a name Windows reserves', 'are names Windows reserves'],
    long: ['is longer than 255 bytes', 'are longer than 255 bytes']
  };

  function describeChars(name) {
    var found = [];
    var chars = name.match(ILLEGAL_RE_G) || [];
    chars.forEach(function (c) {
      var label = c.charCodeAt(0) < 32 ? 'a control character' : c;
      if (found.indexOf(label) < 0) found.push(label);
    });
    return found;
  }

  /* Check the final names. Returns { rows: [[{code, text}]], badRows, byCode }. */
  function checkNames(newNames, originals, dirs) {
    var rows = newNames.map(function () { return []; });
    var groups = new Map();
    newNames.forEach(function (n, i) {
      var k = dirKey(dirs && dirs[i], n);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    groups.forEach(function (idxs) {
      if (idxs.length < 2) return;
      idxs.forEach(function (i) {
        var other = idxs[0] === i ? idxs[1] : idxs[0];
        var sameCase = newNames[other] === newNames[i];
        rows[i].push({ code: 'dup', other: other, text: 'Same name as row ' + (other + 1) + (sameCase ? '' : ', apart from letter case') });
      });
    });
    newNames.forEach(function (n, i) {
      var orig = originals ? originals[i] : n;
      if (isEmptyName(n, orig)) {
        rows[i].push({ code: 'empty', text: n === '' ? 'Name is empty' : 'Nothing is left before the extension' });
      }
      var chars = describeChars(n);
      if (chars.length) {
        var shown = chars.join(' ');
        rows[i].push({ code: 'illegal', text: 'Contains ' + shown + ', which ' + (chars.indexOf('/') >= 0 && chars.length === 1 ? 'would make a folder' : 'Windows or macOS do not allow') });
      }
      if (n !== '' && /[. ]$/.test(n)) rows[i].push({ code: 'trailing', text: 'Ends with a ' + (/\.$/.test(n) ? 'full stop' : 'space') + ', which Windows removes' });
      var base = n ? reservedBase(n) : null;
      if (base) rows[i].push({ code: 'reserved', text: base.toUpperCase() + ' is a reserved name on Windows' });
      var bytes = utf8Length(n);
      if (bytes > 255) rows[i].push({ code: 'long', text: 'Too long: ' + bytes + ' bytes, the limit is 255' });
    });
    var byCode = {}, badRows = 0;
    rows.forEach(function (r) {
      if (r.length) badRows++;
      var seen = {};
      r.forEach(function (p) { if (!seen[p.code]) { seen[p.code] = 1; byCode[p.code] = (byCode[p.code] || 0) + 1; } });
    });
    return { rows: rows, badRows: badRows, byCode: byCode };
  }

  function summariseProblems(check) {
    var parts = [];
    Object.keys(PROBLEM_LABELS).forEach(function (code) {
      var n = check.byCode[code];
      if (!n) return;
      parts.push(n + ' ' + PROBLEM_LABELS[code][n === 1 ? 0 : 1]);
    });
    return parts.join(', ');
  }

  /* Common prefix and suffix of two names, for highlighting what changed. */
  function diffParts(a, b) {
    var p = 0, max = Math.min(a.length, b.length);
    while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
    var s = 0;
    while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
    return {
      prefix: a.slice(0, p),
      removed: a.slice(p, a.length - s),
      added: b.slice(p, b.length - s),
      suffix: a.slice(a.length - s)
    };
  }

  /* ---------- In-place renaming (File System Access API) ---------- */

  function makeToken() {
    var s = '';
    for (var i = 0; i < 6; i++) s += 'abcdefghijkmnpqrstuvwxyz23456789'.charAt(Math.floor(Math.random() * 32));
    return s;
  }
  function tempName(token, i) { return '.tfe-' + token + '-' + (i + 1) + '.tmp'; }

  async function listDir(dir) {
    var exact = new Set(), lower = new Map();
    for await (var name of dir.keys()) { exact.add(name); lower.set(ci(name), name); }
    return { exact: exact, lower: lower };
  }

  async function entryExists(dir, name) {
    try { await dir.getFileHandle(name); return true; }
    catch (e) { if (e && e.name === 'TypeMismatchError') return true; }
    try { await dir.getDirectoryHandle(name); return true; }
    catch (e) { if (e && e.name === 'TypeMismatchError') return true; }
    return false;
  }

  /* Rename files where they are, in two phases: every file first moves to a unique
     temporary name, then each takes its new name. That makes swaps (A to B, B to A)
     and chains safe. A file is never renamed over another file; if its new name is
     taken, it is skipped, and anything that depended on its old name being freed is
     skipped too.
     jobs: [{ handle, dir, dirKey, from, to }]  (handle.move(name) renames in dir)
     Returns { done: [job], notes: [text], state: [...] } */
  async function renameInPlace(jobs, options) {
    options = options || {};
    var token = options.token || makeToken();
    var onProgress = options.onProgress || function () {};
    var n = jobs.length, state = new Array(n).fill(null), notes = [], done = [];
    var listings = new Map();
    for (var a = 0; a < n; a++) {
      var dk = jobs[a].dirKey || '';
      if (!listings.has(dk)) listings.set(dk, await listDir(jobs[a].dir));
    }
    var srcExact = new Map(), dstLower = new Map();
    jobs.forEach(function (j, i) {
      srcExact.set((j.dirKey || '') + '\u0000' + j.from, i);
      dstLower.set((j.dirKey || '') + '\u0000' + ci(j.to), i);
    });

    jobs.forEach(function (j, i) {
      var dk = j.dirKey || '', L = listings.get(dk);
      var present = L.exact.has(j.from) ? j.from : (L.lower.get(ci(j.from)) || null);
      if (!present) { state[i] = 'missing'; notes.push('Skipped ' + j.from + ': it is no longer in the folder.'); return; }
      var occupant = L.exact.has(j.to) ? j.to : (L.lower.get(ci(j.to)) || null);
      if (occupant !== null && !srcExact.has(dk + '\u0000' + occupant)) {
        state[i] = 'blocked';
        notes.push('Skipped ' + j.from + ': ' + occupant + ' already exists.');
      }
    });
    var changed = true;
    while (changed) {
      changed = false;
      for (var b = 0; b < n; b++) {
        if (state[b] !== 'blocked') continue;
        var dep = dstLower.get((jobs[b].dirKey || '') + '\u0000' + ci(jobs[b].from));
        if (dep !== undefined && dep !== b && state[dep] === null) {
          state[dep] = 'blocked';
          notes.push('Skipped ' + jobs[dep].from + ': ' + jobs[dep].to + ' is still taken by a file that was not renamed.');
          changed = true;
        }
      }
    }

    var tmp = new Array(n), steps = 0, totalSteps = 0;
    state.forEach(function (s) { if (s === null) totalSteps += 2; });
    for (var i = 0; i < n; i++) {
      if (state[i] !== null) continue;
      tmp[i] = tempName(token, i);
      try { await jobs[i].handle.move(tmp[i]); state[i] = 'moved'; }
      catch (e) { state[i] = 'failed'; notes.push('Could not rename ' + jobs[i].from + ': ' + (e && e.message || e)); }
      onProgress(++steps, totalSteps);
    }
    for (var k = 0; k < n; k++) {
      if (state[k] !== 'moved') continue;
      var j = jobs[k];
      var clash = await entryExists(j.dir, j.to);
      var err = null;
      if (!clash) {
        try { await j.handle.move(j.to); state[k] = 'done'; done.push(j); }
        catch (e) { err = e; }
      }
      if (clash || err) {
        notes.push('Skipped ' + j.from + ': ' + (clash ? j.to + ' already exists.' : String(err && err.message || err)));
        state[k] = 'blocked';
        try { await j.handle.move(j.from); }
        catch (e2) { notes.push('  ' + j.from + ' is now called ' + tmp[k] + '.'); }
      }
      onProgress(++steps, totalSteps);
    }
    return { done: done, notes: notes, state: state };
  }

  /* ---------- Rename scripts ---------- */

  /* pairs: [{ from, to }] as relative paths with "/" between folders. */
  function analysePairs(pairs) {
    var srcExact = new Map(), srcLower = new Map(), dstLower = new Map();
    pairs.forEach(function (p, i) {
      srcExact.set(p.from, i);
      if (!srcLower.has(ci(p.from))) srcLower.set(ci(p.from), i);
      dstLower.set(ci(p.to), i);
    });
    return pairs.map(function (p, i) {
      var planned = srcExact.has(p.to) ? srcExact.get(p.to) : (srcLower.has(ci(p.to)) ? srcLower.get(ci(p.to)) : -1);
      var dep = dstLower.has(ci(p.from)) ? dstLower.get(ci(p.from)) : -1;
      if (dep === i) dep = -1;
      return { from: p.from, to: p.to, planned: planned, dep: dep };
    });
  }
  function reversePairs(pairs) { return pairs.map(function (p) { return { from: p.to, to: p.from }; }); }
  function dirOf(rel) { var k = rel.lastIndexOf('/'); return k < 0 ? '' : rel.slice(0, k + 1); }
  function leafOf(rel) { return rel.slice(rel.lastIndexOf('/') + 1); }
  function winPath(rel) { return rel.replace(/\//g, '\\'); }

  function stamp(d) { return localDateString(d) + ' ' + localTimeString(d).slice(0, 5); }

  function psQuote(s) { return "'" + s.replace(/['‘’‚‛]/g, function (m) { return m + m; }) + "'"; }
  function batQuote(s) { return '"' + s.replace(/%/g, '%%') + '"'; }
  function shQuote(s) { return "'" + s.replace(/'/g, "'\\''") + "'"; }

  /* Names a script flavour cannot represent safely. */
  function scriptBlockers(pairs, kind) {
    var bad = [];
    pairs.forEach(function (p) {
      [p.from, p.to].forEach(function (n) {
        if (kind === 'bat' && /["\r\n\u0000-\u001f]/.test(n)) bad.push(n);
        if (kind === 'ps1' && /[\u0000]/.test(n)) bad.push(n);
        if (kind === 'sh' && /[\u0000]/.test(n)) bad.push(n);
      });
    });
    return bad;
  }

  function header(lines, comment) {
    return lines.map(function (l) { return l ? comment + ' ' + l : comment; });
  }

  function commonHeader(kind, count, isUndo, fileName, otherName, now) {
    var run = {
      ps1: ['Right-click this file and choose "Run with PowerShell", or open PowerShell in', 'that folder and run:  powershell -ExecutionPolicy Bypass -File .\\' + fileName],
      bat: ['Double-click this file, or open Command Prompt in that folder and run:', '  ' + fileName],
      sh: ['Open a terminal in that folder and run:  sh ./' + fileName]
    }[kind];
    var flag = { ps1: '-Undo', bat: 'undo', sh: '--undo' }[kind];
    var lines = [
      (isUndo ? 'Undo script' : 'Rename script') + ' made by Bulk File Renamer (Tools for Everyone), ' + stamp(now) + '.',
      '',
      isUndo
        ? 'Puts back the original names of ' + count + ' file' + (count === 1 ? '' : 's') + ' renamed by ' + otherName + '.'
        : 'Renames ' + count + ' file' + (count === 1 ? '' : 's') + '. Nothing is copied, moved to another folder, or deleted.',
      '',
      'How to run it: save this file in the folder that holds the files, then run it there.',
      'It works on the folder the script is saved in.'
    ].concat(run).concat([
      '',
      'Safety: a missing file is skipped with a message, and a file is never renamed over',
      'another file. Files first get a temporary name, so names that swap or chain work.',
      isUndo
        ? 'To rename them again, run ' + otherName + '.'
        : 'To undo, run ' + otherName + ' (or run this script with ' + flag + ').'
    ]);
    if (kind === 'ps1') lines.push('If Windows says running scripts is disabled, use the -ExecutionPolicy Bypass command above.');
    return lines;
  }

  function buildPowerShell(pairs, o) {
    var P = pairs.map(function (p) { return { from: winPath(p.from), to: winPath(p.to) }; });
    var L = header(commonHeader('ps1', pairs.length, o.undo, o.fileName, o.otherName, o.now), '#');
    L.push('');
    L.push('param([switch]$Undo)');
    L.push("$ErrorActionPreference = 'Stop'");
    L.push('$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).ProviderPath }');
    L.push("$token = '" + o.token + "'");
    L.push('$from = [string[]]@(');
    P.forEach(function (p) { L.push('  ' + psQuote(p.from)); });
    L.push(')');
    L.push('$to = [string[]]@(');
    P.forEach(function (p) { L.push('  ' + psQuote(p.to)); });
    L.push(')');
    L.push('$reverse = ' + (o.undo ? '-not $Undo' : '[bool]$Undo'));
    L.push('if ($reverse) { $swap = $from; $from = $to; $to = $swap }');
    L.push(String.raw`$n = $from.Length
$cmp = [System.StringComparer]::OrdinalIgnoreCase
function Get-Full([string]$rel) { [System.IO.Path]::Combine($root, $rel) }
function Test-Entry([string]$rel) { $p = Get-Full $rel; [System.IO.File]::Exists($p) -or [System.IO.Directory]::Exists($p) }
$sources = New-Object 'System.Collections.Generic.HashSet[string]' ($cmp)
$targets = New-Object 'System.Collections.Generic.Dictionary[string,int]' ($cmp)
for ($i = 0; $i -lt $n; $i++) { [void]$sources.Add($from[$i]); $targets[$to[$i]] = $i }
$state = New-Object 'string[]' $n
$temp = New-Object 'string[]' $n
$renamed = 0; $skipped = 0

for ($i = 0; $i -lt $n; $i++) {
  if (-not (Test-Entry $from[$i])) { $state[$i] = 'missing'; $skipped++; Write-Host "Skipped, not found: $($from[$i])"; continue }
  if ((Test-Entry $to[$i]) -and -not $sources.Contains($to[$i])) { $state[$i] = 'blocked'; $skipped++; Write-Host "Skipped, $($to[$i]) already exists: $($from[$i])" }
}
do {
  $changed = $false
  for ($i = 0; $i -lt $n; $i++) {
    if ($state[$i] -ne 'blocked') { continue }
    $j = -1
    if ($targets.TryGetValue($from[$i], [ref]$j) -and $j -ne $i -and $null -eq $state[$j]) {
      $state[$j] = 'blocked'; $skipped++; $changed = $true
      Write-Host "Skipped, $($to[$j]) is still taken by a file that was not renamed: $($from[$j])"
    }
  }
} while ($changed)

for ($i = 0; $i -lt $n; $i++) {
  if ($null -ne $state[$i]) { continue }
  $dir = [System.IO.Path]::GetDirectoryName($from[$i])
  $temp[$i] = [System.IO.Path]::Combine($dir, ".tfe-$token-$($i + 1).tmp")
  try { [System.IO.File]::Move((Get-Full $from[$i]), (Get-Full $temp[$i])); $state[$i] = 'moved' }
  catch { $state[$i] = 'failed'; $skipped++; Write-Host "Could not rename $($from[$i]): $($_.Exception.Message)" }
}
for ($i = 0; $i -lt $n; $i++) {
  if ($state[$i] -ne 'moved') { continue }
  $ok = $false
  if (Test-Entry $to[$i]) { Write-Host "Skipped, $($to[$i]) already exists: $($from[$i])" }
  else {
    try { [System.IO.File]::Move((Get-Full $temp[$i]), (Get-Full $to[$i])); $ok = $true; $renamed++ }
    catch { Write-Host "Could not rename $($from[$i]): $($_.Exception.Message)" }
  }
  if (-not $ok) {
    $skipped++
    try { [System.IO.File]::Move((Get-Full $temp[$i]), (Get-Full $from[$i])) }
    catch { Write-Host "  $($from[$i]) is now called $($temp[$i])" }
  }
}
Write-Host ""
Write-Host "Renamed $renamed of $n files. Skipped $skipped."
if ($renamed -ne $n) { exit 1 }`);
    return '﻿' + L.join('\r\n') + '\r\n';
  }

  function batSection(pairs, pre) {
    var A = analysePairs(pairs), L = [];
    var W = A.map(function (p) {
      return { from: winPath(p.from), to: winPath(p.to), dir: winPath(dirOf(p.from)), toLeaf: leafOf(p.to), fromLeaf: leafOf(p.from) };
    });
    A.forEach(function (p, i) {
      var w = W[i], v = pre + (i + 1);
      L.push('if not exist ' + batQuote(w.from) + ' (set "M' + v + '=1" & set /a TFE_SKIP+=1 & echo Skipped, not found: ' + batQuote(w.from) + ')');
      if (p.planned === -1) {
        L.push('if not defined M' + v + ' if exist ' + batQuote(w.to) + ' (set "B' + v + '=1" & set /a TFE_SKIP+=1 & echo Skipped, ' + batQuote(w.to) + ' already exists: ' + batQuote(w.from) + ')');
      }
    });
    var edges = [];
    A.forEach(function (p, i) { if (p.dep >= 0) edges.push([i, p.dep]); });
    if (edges.length) {
      L.push(':tfe_prop_' + pre);
      L.push('set "TFE_CH="');
      edges.forEach(function (e) {
        var a = pre + (e[0] + 1), b = pre + (e[1] + 1), w = W[e[1]];
        L.push('if defined B' + a + ' if not defined B' + b + ' if not defined M' + b + ' (set "B' + b + '=1" & set "TFE_CH=1" & set /a TFE_SKIP+=1 & echo Skipped, ' + batQuote(w.to) + ' is still taken by a file that was not renamed: ' + batQuote(w.from) + ')');
      });
      L.push('if defined TFE_CH goto tfe_prop_' + pre);
    }
    A.forEach(function (p, i) {
      var w = W[i], v = pre + (i + 1), tmpLeaf = '.tfe-%TFE_TOKEN%-' + (i + 1) + '.tmp';
      var tmpFull = '"' + w.dir.replace(/%/g, '%%') + tmpLeaf + '"';
      L.push('if not defined M' + v + ' if not defined B' + v + ' (');
      L.push('  ren ' + batQuote(w.from) + ' "' + tmpLeaf + '" >nul 2>&1');
      L.push('  if exist ' + tmpFull + ' (set "T' + v + '=1") else (set /a TFE_SKIP+=1 & echo Could not rename ' + batQuote(w.from) + ')');
      L.push(')');
    });
    A.forEach(function (p, i) {
      var w = W[i], v = pre + (i + 1), tmpLeaf = '.tfe-%TFE_TOKEN%-' + (i + 1) + '.tmp';
      var tmpFull = '"' + w.dir.replace(/%/g, '%%') + tmpLeaf + '"';
      L.push('if defined T' + v + ' (');
      L.push('  if exist ' + batQuote(w.to) + ' (');
      L.push('    set /a TFE_SKIP+=1');
      L.push('    echo Skipped, ' + batQuote(w.to) + ' already exists: ' + batQuote(w.from));
      L.push('    if exist ' + batQuote(w.from) + ' (echo   ' + batQuote(w.from) + ' is now called ' + tmpFull + ') else (ren ' + tmpFull + ' ' + batQuote(w.fromLeaf) + ' >nul 2>&1)');
      L.push('  ) else (');
      L.push('    ren ' + tmpFull + ' ' + batQuote(w.toLeaf) + ' >nul 2>&1');
      L.push('    if exist ' + tmpFull + ' (set /a TFE_SKIP+=1 & echo Could not rename ' + batQuote(w.from) + ') else (set /a TFE_DONE+=1)');
      L.push('  )');
      L.push(')');
    });
    return L;
  }

  function buildBatch(pairs, o) {
    var L = header(commonHeader('bat', pairs.length, o.undo, o.fileName, o.otherName, o.now), 'rem');
    L.unshift('@echo off');
    L.push('setlocal EnableExtensions DisableDelayedExpansion');
    L.push('for /f "tokens=2 delims=:." %%c in (\'chcp\') do set "TFE_CP=%%c"');
    L.push('chcp 65001 >nul');
    L.push('cd /d "%~dp0"');
    L.push('set "TFE_TOKEN=' + o.token + '"');
    L.push('set /a TFE_DONE=0');
    L.push('set /a TFE_SKIP=0');
    L.push('set "TFE_REV=' + (o.undo ? '1' : '') + '"');
    L.push('if /i "%~1"=="undo" (if defined TFE_REV (set "TFE_REV=") else (set "TFE_REV=1"))');
    L.push('if defined TFE_REV goto tfe_reverse');
    L = L.concat(batSection(pairs, 'F'));
    L.push('goto tfe_end');
    L.push(':tfe_reverse');
    L = L.concat(batSection(reversePairs(pairs), 'U'));
    L.push(':tfe_end');
    L.push('echo.');
    L.push('echo Renamed %TFE_DONE% of ' + pairs.length + ' files. Skipped %TFE_SKIP%.');
    L.push('set "TFE_RC=0"');
    L.push('if not "%TFE_DONE%"=="' + pairs.length + '" set "TFE_RC=1"');
    L.push('if defined TFE_CP chcp %TFE_CP% >nul');
    L.push('if not defined TFE_NOPAUSE pause');
    L.push('endlocal & exit /b %TFE_RC%');
    return L.join('\r\n') + '\r\n';
  }

  function shSection(pairs, fn, token) {
    var A = analysePairs(pairs), L = [fn + '() {'];
    A.forEach(function (p, i) {
      var v = i + 1, f = shQuote(p.from), t = shQuote(p.to);
      L.push('  if ! tfe_exists ' + f + '; then m' + v + '=1; skip_n=$((skip_n+1)); printf \'Skipped, not found: %s\\n\' ' + f + '; fi');
      var block = '  if [ -z "$m' + v + '" ] && tfe_exists ' + t;
      if (p.planned !== -1) block += ' && ! [ ' + t + ' -ef ' + shQuote(A[p.planned].from) + ' ]';
      L.push(block + '; then b' + v + '=1; skip_n=$((skip_n+1)); printf \'Skipped, %s already exists: %s\\n\' ' + t + ' ' + f + '; fi');
    });
    var edges = [];
    A.forEach(function (p, i) { if (p.dep >= 0) edges.push([i, p.dep]); });
    if (edges.length) {
      L.push('  ch=1');
      L.push('  while [ "$ch" = 1 ]; do');
      L.push('    ch=0');
      edges.forEach(function (e) {
        var a = e[0] + 1, b = e[1] + 1, p = A[e[1]];
        L.push('    if [ -n "$b' + a + '" ] && [ -z "$b' + b + '" ] && [ -z "$m' + b + '" ]; then b' + b + '=1; ch=1; skip_n=$((skip_n+1)); printf \'Skipped, %s is still taken by a file that was not renamed: %s\\n\' ' + shQuote(p.to) + ' ' + shQuote(p.from) + '; fi');
      });
      L.push('  done');
    }
    A.forEach(function (p, i) {
      var v = i + 1, f = shQuote(p.from), tmp = shQuote(dirOf(p.from) + '.tfe-' + '__TOKEN__' + '-' + v + '.tmp');
      L.push('  if [ -z "$m' + v + '$b' + v + '" ]; then');
      L.push('    if ! tfe_exists ' + tmp + ' && mv -- ' + f + ' ' + tmp + '; then t' + v + '=1; else skip_n=$((skip_n+1)); printf \'Could not rename %s\\n\' ' + f + '; fi');
      L.push('  fi');
    });
    A.forEach(function (p, i) {
      var v = i + 1, f = shQuote(p.from), t = shQuote(p.to), tmp = shQuote(dirOf(p.from) + '.tfe-' + '__TOKEN__' + '-' + v + '.tmp');
      L.push('  if [ -n "$t' + v + '" ]; then');
      L.push('    if ! tfe_exists ' + t + ' && mv -- ' + tmp + ' ' + t + '; then done_n=$((done_n+1))');
      L.push('    else');
      L.push('      skip_n=$((skip_n+1))');
      L.push('      if tfe_exists ' + t + '; then printf \'Skipped, %s already exists: %s\\n\' ' + t + ' ' + f + '; else printf \'Could not rename %s\\n\' ' + f + '; fi');
      L.push('      if tfe_exists ' + f + ' || ! mv -- ' + tmp + ' ' + f + '; then printf \'  %s is now called %s\\n\' ' + f + ' ' + tmp + '; fi');
      L.push('    fi');
      L.push('  fi');
    });
    L.push('}');
    return L.map(function (l) { return l.split('__TOKEN__').join(token); });
  }

  function buildShell(pairs, o) {
    var L = ['#!/bin/sh'].concat(header(commonHeader('sh', pairs.length, o.undo, o.fileName, o.otherName, o.now), '#'));
    L.push('');
    L.push('cd -- "$(dirname -- "$0")" || { echo "Could not open the folder that holds this script."; exit 1; }');
    L.push('done_n=0');
    L.push('skip_n=0');
    L.push('tfe_exists() { [ -e "$1" ] || [ -L "$1" ]; }');
    L = L.concat(shSection(pairs, 'tfe_forward', o.token));
    L = L.concat(shSection(reversePairs(pairs), 'tfe_reverse', o.token));
    L.push('rev=' + (o.undo ? '1' : '0'));
    L.push('if [ "$1" = "--undo" ]; then rev=$((1 - rev)); fi');
    L.push('if [ "$rev" = 1 ]; then tfe_reverse; else tfe_forward; fi');
    L.push('echo');
    L.push('printf \'Renamed %s of %s files. Skipped %s.\\n\' "$done_n" ' + pairs.length + ' "$skip_n"');
    L.push('[ "$done_n" = ' + pairs.length + ' ]');
    return L.join('\n') + '\n';
  }

  var SCRIPT_KINDS = {
    ps1: { label: 'Windows PowerShell (.ps1)', ext: 'ps1', mime: 'text/plain', build: buildPowerShell },
    bat: { label: 'Windows Command Prompt (.bat)', ext: 'bat', mime: 'text/plain', build: buildBatch },
    sh: { label: 'macOS and Linux (.sh)', ext: 'sh', mime: 'text/x-sh', build: buildShell }
  };

  /* Returns { rename: {name, text}, undo: {name, text} } */
  function buildScripts(pairs, kind, opts) {
    opts = opts || {};
    var K = SCRIPT_KINDS[kind];
    var token = opts.token || makeToken();
    var now = opts.now || new Date();
    var main = 'rename-files.' + K.ext, undo = 'undo-rename-files.' + K.ext;
    return {
      rename: { name: main, text: K.build(pairs, { undo: false, token: token, now: now, fileName: main, otherName: undo }) },
      undo: { name: undo, text: K.build(pairs, { undo: true, token: token, now: now, fileName: undo, otherName: main }) }
    };
  }

  var api = {
    RULE_IDS: RULE_IDS, FIX_IDS: FIX_IDS, RULES: RULES, DATE_FORMATS: DATE_FORMATS,
    splitName: splitName, splitWords: splitWords, convertCase: convertCase,
    parseLocalDate: parseLocalDate, localDateString: localDateString, localTimeString: localTimeString,
    withTime: withTime, formatStamp: formatStamp, formatHasTime: formatHasTime, stampDate: stampDate,
    applyStep: applyStep, runSteps: runSteps, describeStep: describeStep,
    checkNames: checkNames, summariseProblems: summariseProblems, makeSafe: makeSafe,
    numberDuplicates: numberDuplicates, utf8Length: utf8Length, diffParts: diffParts, ci: ci, dirKey: dirKey,
    renameInPlace: renameInPlace, entryExists: entryExists, makeToken: makeToken,
    analysePairs: analysePairs, reversePairs: reversePairs, buildScripts: buildScripts, scriptBlockers: scriptBlockers,
    SCRIPT_KINDS: SCRIPT_KINDS, psQuote: psQuote, batQuote: batQuote, shQuote: shQuote
  };
  root.RenamerCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
