/* Tools for Everyone, shared behaviour for the landing page and every tool page.
   Loaded with defer, so it runs after each page's own inline script has been
   parsed and before DOMContentLoaded. Everything here is additive: no tool
   function is redefined.

   The shared API lives on window.TFE (see the header of each section):
     setDirty, job                      work tracking and safe updates
     subtool.initial / set / onChange   links to sub-tools
     tools, search, toolForPage         the registry of every tool and sub-tool
     prefs                              remembered settings
     handoff.take / send, continueWith  handing files between tools
     routeFiles, kindOf                 "what can open this file?" sheet
     announce, confirmInline, revealResult, formatBytes, panelSummary
     palette.open / close               the Ctrl+K switcher
     recent, pins                       recently used and pinned tools */

(function () {
  'use strict';

  var MOBILE = '(max-width: 900px)';
  var REPO = 'https://github.com/RehmozAyub/tools-for-everyone';
  var ISSUES = REPO + '/issues/new';
  var LICENSE = REPO + '/blob/main/LICENSE';
  var TFE = window.TFE = window.TFE || {};

  /* The site root, worked out from this script's own address so it is right on
     GitHub Pages (a sub-folder), on localhost and when opened from disk. */
  var ROOT = (function () {
    try {
      var src = document.currentScript && document.currentScript.src;
      if (src) return new URL('../', src).href;
    } catch (e) {}
    return new URL('./', location.href).href;
  })();

  function rootUrl(path) {
    try { return new URL(path, ROOT).href; } catch (e) { return path; }
  }

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function icon(name) {
    var i = document.createElement('i');
    i.className = 'ph ph-' + name;
    i.setAttribute('aria-hidden', 'true');
    return i;
  }

  function lsGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode or full */ }
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function isMac() {
    var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    return /mac|iphone|ipad|ipod/i.test(p);
  }

  function isEditable(node) {
    if (!node || node === document.body) return false;
    if (node.isContentEditable) return true;
    var tag = node.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    var t = (node.type || 'text').toLowerCase();
    return ['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image'].indexOf(t) === -1;
  }

  /* ======================================================================
     Registry: every tool and sub-tool, used by search, the switcher, the
     landing page, "Continue with" and the file sheet.
     Paths are relative to the site root. accepts lists file kinds:
     pdf image audio video office any.
     ====================================================================== */

  var CATEGORIES = [
    { id: 'documents', name: 'Documents' },
    { id: 'media', name: 'Media' },
    { id: 'everyday', name: 'Everyday' }
  ];

  function sub(id, name, iconName, description, keywords, accepts, cta) {
    return { id: id, name: name, icon: iconName, description: description, keywords: keywords || '', accepts: accepts || [], cta: cta || name };
  }

  var TOOLS = [
    {
      id: 'pdf', name: 'PDF Suite', path: 'PDF%20Suite/pdf_suite.html', icon: 'file-pdf', category: 'documents',
      description: 'Merge, split, compress, sign and a dozen more PDF jobs in one page.',
      accepts: ['pdf', 'image'], formats: 'PDF, JPG, PNG',
      keywords: 'pdf document acrobat edit',
      cta: 'Open in PDF Suite',
      subtools: [
        sub('merge', 'Merge PDFs', 'link-simple', 'Combine several PDFs into one, in the order you choose.', 'combine join append concatenate put together', ['pdf'], 'Merge with other PDFs'),
        sub('split', 'Split a PDF', 'scissors', 'Cut a PDF into parts by page range.', 'separate divide break extract pages cut', ['pdf'], 'Split this PDF'),
        sub('organize', 'Organize pages', 'squares-four', 'Reorder, delete and rotate pages on a thumbnail grid.', 'reorder rearrange delete remove move sort pages organise', ['pdf'], 'Reorder its pages'),
        sub('compress', 'Compress a PDF', 'arrows-in-simple', 'Make a PDF smaller so it is easier to send.', 'shrink reduce size smaller optimise optimize email', ['pdf'], 'Compress this PDF'),
        sub('extract_text', 'Extract text', 'text-align-left', 'Pull the text out of a PDF.', 'copy text txt convert to text', ['pdf'], 'Extract its text'),
        sub('pdf_to_images', 'PDF to images', 'image', 'Turn each page into a JPG or PNG.', 'convert jpg png picture export pages', ['pdf'], 'Turn pages into images'),
        sub('images_to_pdf', 'Images to PDF', 'file-arrow-up', 'Put photos or scans into one PDF.', 'jpg png photo scan convert pictures combine', ['image'], 'Make a PDF from it'),
        sub('rotate', 'Rotate pages', 'arrow-clockwise', 'Turn pages the right way up.', 'turn orientation landscape portrait flip', ['pdf'], 'Rotate pages'),
        sub('watermark', 'Add watermark', 'drop', 'Stamp text across every page.', 'stamp draft confidential overlay', ['pdf'], 'Add a watermark'),
        sub('page_numbers', 'Page numbers', 'hash', 'Number the pages in the position and style you pick.', 'numbering paginate footer add page numbers', ['pdf'], 'Add page numbers'),
        sub('metadata', 'Edit metadata', 'tag', 'Change the title, author and other document properties.', 'properties title author subject keywords info', ['pdf'], 'Edit its properties'),
        sub('protect', 'Protect a PDF', 'lock', 'Add a password with AES-256 encryption.', 'password encrypt secure lock', ['pdf'], 'Add a password'),
        sub('unlock', 'Unlock a PDF', 'lock-open', 'Remove a password you know from a PDF.', 'remove password decrypt open', ['pdf'], 'Remove its password'),
        sub('sign', 'Sign a PDF', 'signature', 'Draw, type or place a signature on a page.', 'signature esign fill initials', ['pdf'], 'Sign this PDF'),
        sub('ocr', 'Make a scan searchable', 'scan', 'Recognise the text in a scanned PDF so it can be searched and copied.', 'ocr scan recognise recognize text searchable', ['pdf'], 'Make its text searchable'),
        sub('redact', 'Redact a PDF', 'eraser', 'Black out text or areas for good before you share.', 'black out hide censor remove sensitive', ['pdf'], 'Redact it')
      ]
    },
    {
      id: 'metadata', name: 'Metadata Scrubber', path: 'Metadata%20Scrubber/metadata_scrubber.html', icon: 'shield-check', category: 'documents',
      description: 'See and remove hidden details, such as GPS location, before you share a file.',
      accepts: ['image', 'pdf', 'office'], formats: 'JPG, PNG, WebP, PDF, DOCX, XLSX, PPTX',
      keywords: 'gps location exif metadata remove strip clean scrub privacy camera author hidden',
      cta: 'Remove metadata',
      subtools: []
    },
    {
      id: 'renamer', name: 'Bulk File Renamer', path: 'Bulk%20File%20Renamer/bulk_rename.html', icon: 'folders', category: 'documents',
      description: 'Rename hundreds of files at once with patterns, numbering and regex.',
      accepts: ['any'], formats: 'Any file',
      keywords: 'rename batch bulk files names',
      cta: 'Rename files',
      subtools: [
        sub('find_replace', 'Find and replace', 'magnifying-glass', 'Swap one piece of text for another in every name.', 'replace substitute rename'),
        sub('regex', 'Regex rename', 'brackets-curly', 'Rename with a regular expression.', 'regular expression pattern rename'),
        sub('prefix_suffix', 'Add a prefix or suffix', 'text-indent', 'Put text before or after every name.', 'prefix suffix prepend append rename'),
        sub('numbering', 'Number files', 'list-numbers', 'Give files a running number.', 'sequence sequential numbering counter rename'),
        sub('date_stamp', 'Add a date stamp', 'calendar-blank', 'Add the date to every name.', 'date time stamp rename'),
        sub('case', 'Change case', 'text-aa', 'Make names lower case, upper case or title case.', 'lowercase uppercase title case rename'),
        sub('extension', 'Change extension', 'file-text', 'Change or fix the file extension.', 'extension type suffix rename'),
        sub('trim', 'Trim names', 'scissors', 'Remove characters from the start or end of names.', 'trim cut shorten remove characters rename')
      ]
    },
    {
      id: 'image', name: 'Image Compressor', path: 'Image%20Compressor/image_compressor.html', icon: 'image', category: 'media',
      description: 'Shrink, resize and convert photos, one or hundreds at a time.',
      accepts: ['image'], formats: 'JPG, PNG, WebP, AVIF, GIF',
      keywords: 'compress shrink reduce size resize convert webp jpg png photo picture optimise optimize',
      cta: 'Compress this image',
      subtools: []
    },
    {
      id: 'video', name: 'Video Converter', path: 'Video%20Converter/video_converter.html', icon: 'film-strip', category: 'media',
      description: 'Turn a clip into a GIF, make it smaller, or convert it to another format.',
      accepts: ['video'], formats: 'MP4, MOV, WebM',
      keywords: 'video convert clip movie ffmpeg',
      cta: 'Open in Video Converter',
      subtools: [
        sub('to_gif', 'Video to GIF', 'gif', 'Turn a clip into an animated GIF.', 'gif animated animation clip meme', ['video'], 'Convert to GIF'),
        sub('compress', 'Compress a video', 'arrows-in-simple', 'Make a video smaller to send or upload.', 'shrink reduce size smaller mp4', ['video'], 'Compress this video'),
        sub('convert', 'Convert a video', 'arrows-clockwise', 'Save a video as WebM, or its sound as MP3 or M4A.', 'webm mp3 m4a audio extract sound format change', ['video'], 'Convert to another format')
      ]
    },
    {
      id: 'audio', name: 'Audio Transcriber', path: 'Audio%20Transcriber/audio_transcriber.html', icon: 'microphone', category: 'media',
      description: 'Turn speech into text on your device, from a file or a recording.',
      accepts: ['audio', 'video'], formats: 'MP3, WAV, M4A, FLAC, OGG, MP4',
      keywords: 'transcribe transcription speech to text whisper subtitles captions voice',
      cta: 'Transcribe it',
      subtools: [
        sub('file', 'Transcribe a file', 'file-audio', 'Turn a recording you already have into text.', 'upload audio video file mp3 wav mp4', ['audio', 'video'], 'Transcribe it'),
        sub('record', 'Record and transcribe', 'microphone', 'Record with your microphone and get the text.', 'microphone dictate dictation voice memo live')
      ]
    },
    {
      id: 'chat', name: 'Private AI Chat', path: 'Private%20AI%20Chat/private_ai_chat.html', icon: 'chat-teardrop-text', category: 'everyday',
      description: 'Chat with an AI model that runs on your device: ask, rewrite, summarise, draft.',
      accepts: [], formats: 'Text',
      keywords: 'ai llm chatbot assistant gpt local offline text rewriter',
      subtools: [
        sub('chat', 'Chat', 'chat-circle-dots', 'Ask anything.', 'ask question conversation talk'),
        sub('paraphrase', 'Paraphrase', 'arrows-clockwise', 'Say the same thing in other words.', 'rewrite reword rephrase text rewriter'),
        sub('summarise', 'Summarise', 'list-checks', 'Get the short version of a long text.', 'summary summarize tldr shorten'),
        sub('grammar', 'Fix grammar', 'check-circle', 'Correct spelling and grammar.', 'grammar spelling proofread correct'),
        sub('polite', 'Make it polite', 'handshake', 'Soften the tone of a message.', 'polite tone rude email soften friendly'),
        sub('simplify', 'Simplify jargon', 'book-open-text', 'Explain it in plain words.', 'simplify plain english jargon explain easy')
      ]
    },
    {
      id: 'qr', name: 'QR Code Studio', path: 'QR%20Code%20Studio/qr_code_studio.html', icon: 'qr-code', category: 'everyday',
      description: 'Make QR codes for links, Wi-Fi and contacts, or read one from a picture.',
      accepts: ['image'], formats: 'Text, links, Wi-Fi, vCard, PNG, JPG',
      keywords: 'qr code barcode scan make create generator reader',
      cta: 'Read a QR code in it',
      subtools: [
        sub('generate', 'Make a QR code', 'qr-code', 'Create a QR code and save it as PNG or SVG.', 'create generate make png svg'),
        sub('read', 'Read a QR code', 'scan', 'Decode a QR code from a picture.', 'scan decode reader read', ['image'], 'Read a QR code in it'),
        sub('text', 'QR code for text or a link', 'link-simple', 'Any text or web address.', 'url link website text'),
        sub('wifi', 'Wi-Fi QR code', 'wifi-high', 'Let guests join your network with a scan.', 'wifi wi fi network password guest'),
        sub('vcard', 'Contact QR code', 'user-circle', 'Share a contact card.', 'vcard contact business card'),
        sub('email', 'Email QR code', 'envelope', 'Start an email to you.', 'email mail'),
        sub('phone', 'Phone QR code', 'phone', 'Call a number with a scan.', 'phone call number telephone'),
        sub('sms', 'SMS QR code', 'chat-text', 'Start a text message.', 'sms text message'),
        sub('whatsapp', 'WhatsApp QR code', 'whatsapp-logo', 'Open a WhatsApp chat.', 'whatsapp message'),
        sub('geo', 'Location QR code', 'map-pin', 'Open a place on a map.', 'geo location map place coordinates'),
        sub('event', 'Event QR code', 'calendar-blank', 'Add an event to a calendar.', 'event calendar meeting ical'),
        sub('batch', 'Batch QR codes', 'rows', 'Make many QR codes at once as a ZIP.', 'batch bulk many zip')
      ]
    },
    {
      id: 'cards', name: 'Test Card Generator', path: 'Virtual%20Card%20Manager/virtual_card_manager.html', icon: 'credit-card', category: 'everyday',
      description: 'Official test card numbers for checking payment forms, with decline and 3D Secure scenarios.',
      accepts: [], formats: 'Stripe, Adyen, Braintree',
      keywords: 'test card credit card number stripe adyen braintree payment sandbox checkout developer 3ds 3d secure decline luhn virtual card manager',
      subtools: []
    }
  ];

  /* "Continue with" and the file sheet list targets in this order. */
  var CONTINUE = {
    pdf: ['pdf#compress', 'metadata', 'pdf#page_numbers', 'pdf#merge', 'pdf#split', 'pdf#protect', 'pdf#sign',
          'pdf#watermark', 'pdf#organize', 'pdf#rotate', 'pdf#pdf_to_images', 'pdf#extract_text', 'pdf#ocr',
          'pdf#redact', 'pdf#unlock', 'pdf#metadata'],
    image: ['image', 'metadata', 'pdf#images_to_pdf', 'qr#read'],
    video: ['video#to_gif', 'video#compress', 'video#convert', 'audio#file'],
    audio: ['audio#file'],
    office: ['metadata'],
    any: []
  };
  var ANY_TARGETS = ['renamer'];

  var TOOL_BY_ID = {};
  TOOLS.forEach(function (t) {
    TOOL_BY_ID[t.id] = t;
    t.href = rootUrl(t.path);
    t.subtools.forEach(function (s) { s.tool = t.id; s.href = t.href + '#' + s.id; });
  });

  function categoryName(id) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i].name;
    return '';
  }

  function findSub(tool, id) {
    if (!tool || !id) return null;
    for (var i = 0; i < tool.subtools.length; i++) if (tool.subtools[i].id === id) return tool.subtools[i];
    return null;
  }

  function entryFor(key) {
    var parts = key.split('#');
    var tool = TOOL_BY_ID[parts[0]];
    if (!tool) return null;
    if (parts[1]) {
      var s = findSub(tool, parts[1]);
      return s ? makeEntry(tool, s) : null;
    }
    return makeEntry(tool, null);
  }

  function makeEntry(tool, s) {
    return {
      type: s ? 'subtool' : 'tool',
      key: s ? tool.id + '#' + s.id : tool.id,
      tool: tool,
      sub: s,
      name: s ? s.name : tool.name,
      description: s ? s.description : tool.description,
      icon: s ? s.icon : tool.icon,
      href: s ? s.href : tool.href,
      category: tool.category,
      cta: s ? s.cta : (tool.cta || tool.name),
      accepts: s ? s.accepts : tool.accepts
    };
  }

  function allEntries() {
    var out = [];
    TOOLS.forEach(function (t) {
      out.push(makeEntry(t, null));
      t.subtools.forEach(function (s) { out.push(makeEntry(t, s)); });
    });
    return out;
  }

  function pathOf(href) {
    try { return safeDecode(new URL(href, location.href).pathname).replace(/\/index\.html$/, '/'); } catch (e) { return ''; }
  }

  var CURRENT_TOOL = (function () {
    var here = pathOf(location.href);
    for (var i = 0; i < TOOLS.length; i++) if (pathOf(TOOLS[i].href) === here) return TOOLS[i];
    return null;
  })();

  var IS_LANDING = pathOf(location.href) === pathOf(rootUrl('./'));

  /* ---------- Search, shared by the switcher and the landing page ---------- */

  function normalise(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function prepared(e) {
    if (!e._n) {
      e._n = {
        name: normalise(e.name),
        kw: normalise((e.sub ? e.sub.keywords : e.tool.keywords) || ''),
        parent: e.sub ? normalise(e.tool.name + ' ' + e.tool.keywords) : '',
        formats: normalise(e.tool.formats || ''),
        desc: normalise(e.description)
      };
    }
    return e._n;
  }

  function wordStarts(text, token) {
    if (!text) return false;
    return (' ' + text).indexOf(' ' + token) !== -1;
  }

  /* Every word of the query has to match somewhere. Name matches count far more
     than keyword or description matches. */
  function scoreEntry(e, tokens) {
    var n = prepared(e);
    var total = 0;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var s = 0;
      if (n.name.indexOf(t) === 0) s = 100;
      else if (wordStarts(n.name, t)) s = 70;
      else if (n.name.indexOf(t) !== -1) s = 45;
      else if (wordStarts(n.kw, t)) s = 35;
      else if (n.kw.indexOf(t) !== -1) s = 25;
      else if (wordStarts(n.parent, t)) s = 20;
      else if (wordStarts(n.formats, t)) s = 18;
      else if (wordStarts(n.desc, t)) s = 10;
      if (!s) return 0;
      total += s;
    }
    return total + (e.type === 'tool' ? 3 : 0);
  }

  function search(query, limit) {
    var tokens = normalise(query).split(' ').filter(Boolean);
    if (!tokens.length) return [];
    var scored = [];
    allEntries().forEach(function (e, idx) {
      var s = scoreEntry(e, tokens);
      if (s) scored.push({ e: e, s: s, i: idx });
    });
    scored.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
    var out = scored.map(function (x) { return x.e; });
    return limit ? out.slice(0, limit) : out;
  }

  /* ======================================================================
     Theme
     ====================================================================== */

  var THEME_COLOURS = { light: '#f2f3f5', dark: '#0f1114' };

  function readStoredTheme() {
    try { return localStorage.getItem('theme'); } catch (e) { return null; }
  }

  function storeTheme(value) {
    try { localStorage.setItem('theme', value); } catch (e) { /* private mode */ }
  }

  function currentTheme() {
    var stored = readStoredTheme();
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /* The browser chrome follows the page: an explicit choice overrides both
     media-specific theme-color tags; without one they keep their own values. */
  function syncThemeColor(theme, explicit) {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      var m = metas[i];
      if (m.getAttribute('data-original') === null) m.setAttribute('data-original', m.getAttribute('content') || '');
      m.setAttribute('content', explicit ? THEME_COLOURS[theme] : m.getAttribute('data-original'));
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var stored = readStoredTheme();
    syncThemeColor(theme, stored === 'dark' || stored === 'light');
    updateToggleIcon(theme);
  }

  function updateToggleIcon(theme) {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.innerHTML = theme === 'dark'
      ? '<i class="ph ph-sun" aria-hidden="true"></i>'
      : '<i class="ph ph-moon" aria-hidden="true"></i>';
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }

  function toggleTheme() {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    storeTheme(next);
    applyTheme(next);
  }

  function initTheme() {
    applyTheme(currentTheme());
    var btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', toggleTheme);
  }

  /* ======================================================================
     Live region and toast
     ====================================================================== */

  var liveRegion = null;
  var announceTimer = null;

  function ensureLiveRegion() {
    if (liveRegion && liveRegion.parentNode) return liveRegion;
    liveRegion = document.getElementById('tfe-live');
    if (!liveRegion) {
      liveRegion = el('div', 'sr-only');
      liveRegion.id = 'tfe-live';
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      document.body.appendChild(liveRegion);
    }
    return liveRegion;
  }

  /* One persistent polite region. Clearing it first and writing a moment later
     makes screen readers read the same sentence twice in a row, too. */
  function announce(text) {
    if (!document.body) return;
    var region = ensureLiveRegion();
    clearTimeout(announceTimer);
    region.textContent = '';
    announceTimer = setTimeout(function () { region.textContent = String(text || ''); }, 60);
  }

  var ICONS = {
    success: 'check-circle',
    error: 'warning-circle',
    info: 'info'
  };

  var toastState = { el: null, timer: null, isUpdate: false };
  var update = { pending: false, dismissed: false };

  function dismissToast(replacing) {
    clearTimeout(toastState.timer);
    var wasUpdate = toastState.isUpdate;
    if (toastState.el && toastState.el.parentNode) toastState.el.remove();
    toastState.el = null;
    toastState.isUpdate = false;
    /* A newer toast pushed the update prompt aside; bring it back afterwards. */
    if (!replacing && !wasUpdate && update.pending && !update.dismissed) showUpdateToast();
  }

  function showToast(message, kind, opts) {
    opts = opts || {};
    var type = ICONS[kind] ? kind : 'info';
    dismissToast(true);
    var legacy = document.querySelectorAll('.toast');
    for (var i = 0; i < legacy.length; i++) legacy[i].remove();

    var node = el('div', 'toast toast-' + type);
    node.appendChild(icon(ICONS[type]));
    node.appendChild(el('span', null, message));

    var duration = opts.duration == null ? 4000 : Number(opts.duration) || 0;
    var handle = { el: node, dismiss: function () { if (toastState.el === node) dismissToast(false); } };

    if (opts.action && opts.action.label) {
      node.classList.add('has-action');
      var act = el('button', 'toast-action', opts.action.label);
      act.type = 'button';
      act.addEventListener('click', function () {
        handle.dismiss();
        try { if (opts.action.onClick) opts.action.onClick(); } catch (e) { setTimeout(function () { throw e; }); }
      });
      node.appendChild(act);
    }
    if (duration === 0) {
      node.classList.add('has-action');
      var close = el('button', 'toast-close');
      close.type = 'button';
      close.setAttribute('aria-label', 'Dismiss');
      close.appendChild(icon('x'));
      close.addEventListener('click', function () {
        if (opts._onClose) opts._onClose();
        handle.dismiss();
      });
      node.appendChild(close);
    }

    document.body.appendChild(node);
    toastState.el = node;
    toastState.isUpdate = !!opts._isUpdate;
    announce(message);

    function arm(ms) {
      clearTimeout(toastState.timer);
      if (ms > 0) toastState.timer = setTimeout(handle.dismiss, ms);
    }
    arm(duration);
    if (duration > 0) {
      /* Hovering or tabbing into a toast holds it open. */
      node.addEventListener('mouseenter', function () { clearTimeout(toastState.timer); });
      node.addEventListener('mouseleave', function () { if (toastState.el === node) arm(1500); });
      node.addEventListener('focusin', function () { clearTimeout(toastState.timer); });
      node.addEventListener('focusout', function () { if (toastState.el === node) arm(1500); });
    }
    return handle;
  }

  /* ======================================================================
     Inline errors, busy buttons, progress, share (unchanged contracts)
     ====================================================================== */

  function clearInlineErrors() {
    var nodes = document.querySelectorAll('.inline-error');
    for (var i = 0; i < nodes.length; i++) nodes[i].remove();
  }

  function showInlineError(anchorEl, message) {
    clearInlineErrors();
    if (!anchorEl || !anchorEl.parentNode) {
      showToast(message, 'error');
      return;
    }
    var node = el('div', 'error-msg inline-error');
    node.setAttribute('role', 'alert');
    node.appendChild(icon('warning-circle'));
    node.appendChild(el('span', null, message));
    anchorEl.insertAdjacentElement('afterend', node);
  }

  function setBusy(buttonEl, isBusy, label) {
    if (!buttonEl) return;
    if (isBusy) {
      if (buttonEl.dataset.idleHtml === undefined) buttonEl.dataset.idleHtml = buttonEl.innerHTML;
      buttonEl.disabled = true;
      buttonEl.setAttribute('aria-busy', 'true');
      buttonEl.innerHTML = '<span class="spinner" aria-hidden="true"></span> ';
      buttonEl.appendChild(document.createTextNode(label || 'Working...'));
    } else {
      buttonEl.disabled = false;
      buttonEl.removeAttribute('aria-busy');
      if (buttonEl.dataset.idleHtml !== undefined) {
        buttonEl.innerHTML = buttonEl.dataset.idleHtml;
        delete buttonEl.dataset.idleHtml;
      }
    }
  }

  function setProgress(containerEl, percent, label) {
    if (!containerEl) return;
    var pct = Math.max(0, Math.min(100, Math.round(percent)));
    var bar = containerEl.querySelector('.progress');
    if (!bar) {
      containerEl.innerHTML =
        '<div class="progress">' +
          '<div class="progress-track"><div class="progress-fill"></div></div>' +
          '<div class="progress-label"><span class="text"></span><span class="pct"></span></div>' +
        '</div>';
      bar = containerEl.querySelector('.progress');
    }
    bar.querySelector('.progress-fill').style.width = pct + '%';
    bar.querySelector('.text').textContent = label || '';
    bar.querySelector('.pct').textContent = pct + '%';
  }

  function clearProgress(containerEl) {
    if (containerEl) containerEl.innerHTML = '';
  }

  function sharePage() {
    var data = {
      title: document.title,
      text: 'Free browser tools that never upload your files.',
      url: location.href
    };
    if (navigator.share) {
      navigator.share(data).catch(function () {});
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(location.href).then(function () {
        showToast('Link copied to clipboard', 'success');
      }).catch(function () {
        showToast('Could not copy the link', 'error');
      });
      return;
    }
    showToast('Copy this page address to share it', 'info');
  }

  /* ======================================================================
     Small shared helpers: formatBytes, confirmInline, revealResult
     ====================================================================== */

  function formatBytes(n) {
    n = Number(n);
    if (!isFinite(n) || n < 0) n = 0;
    if (n < 1024) return Math.round(n) + ' B';
    var units = ['KB', 'MB', 'GB', 'TB'];
    var v = n / 1024;
    var u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    var digits = (u === 0 && v >= 100) ? 0 : 1;
    var text = v.toFixed(digits);
    if (digits && /\.0$/.test(text) && v >= 100) text = text.slice(0, -2);
    return text + ' ' + units[u];
  }

  var pendingConfirms = typeof WeakMap === 'function' ? new WeakMap() : null;

  /* Swaps a button for "message [Confirm] [Cancel]" in place. Esc cancels. */
  function confirmInline(buttonEl, options) {
    options = options || {};
    if (!buttonEl || !buttonEl.parentNode) return Promise.resolve(false);
    if (pendingConfirms && pendingConfirms.has(buttonEl)) return pendingConfirms.get(buttonEl);

    var danger = options.danger !== false;
    var promise = new Promise(function (resolve) {
      var strip = el('div', 'inline-confirm' + (danger ? '' : ' is-neutral'));
      strip.setAttribute('role', 'group');
      var msg = el('span', 'inline-confirm-msg', options.message || 'Are you sure?');
      msg.id = 'tfe-confirm-' + Math.random().toString(36).slice(2, 8);
      strip.setAttribute('aria-labelledby', msg.id);
      var yes = el('button', 'btn btn-sm inline-confirm-yes', options.confirmLabel || 'Delete');
      yes.type = 'button';
      var no = el('button', 'btn btn-sm inline-confirm-no', options.cancelLabel || 'Cancel');
      no.type = 'button';
      strip.appendChild(msg);
      strip.appendChild(yes);
      strip.appendChild(no);

      var prevDisplay = buttonEl.style.display;
      buttonEl.style.display = 'none';
      buttonEl.insertAdjacentElement('afterend', strip);
      (danger ? no : yes).focus();

      var finished = false;
      function finish(answer) {
        if (finished) return;
        finished = true;
        strip.removeEventListener('keydown', onKey);
        if (strip.parentNode) strip.remove();
        buttonEl.style.display = prevDisplay;
        if (pendingConfirms) pendingConfirms.delete(buttonEl);
        if (buttonEl.isConnected !== false && document.contains(buttonEl)) {
          try { buttonEl.focus({ preventScroll: true }); } catch (e) { buttonEl.focus(); }
        }
        resolve(answer);
      }
      function onKey(e) {
        if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); e.stopPropagation(); finish(false); }
      }
      strip.addEventListener('keydown', onKey);
      yes.addEventListener('click', function (e) { e.stopPropagation(); finish(true); });
      no.addEventListener('click', function (e) { e.stopPropagation(); finish(false); });
    });
    if (pendingConfirms) pendingConfirms.set(buttonEl, promise);
    return promise;
  }

  function revealResult(target) {
    if (!target) return;
    try {
      target.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } catch (e) { target.scrollIntoView(false); }
    var focusEl = target.querySelector('.btn-download');
    if (!focusEl) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      focusEl = target;
    }
    try { focusEl.focus({ preventScroll: true }); } catch (e) { focusEl.focus(); }
    var heading = target.querySelector('h2, h3, .result-head');
    var text = heading ? heading.textContent.replace(/\s+/g, ' ').trim() : '';
    if (text) announce(text);
  }

  /* ======================================================================
     Work tracking and safe updates (F1)
     ====================================================================== */

  var work = { dirty: false, jobs: {}, seq: 0, count: 0 };

  function onBeforeUnload(e) {
    if (work.count > 0) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  }

  function syncLeaveGuard() {
    /* The listener only exists while a job runs, so it never costs the page
       its back-forward cache the rest of the time. */
    if (work.count > 0) window.addEventListener('beforeunload', onBeforeUnload);
    else window.removeEventListener('beforeunload', onBeforeUnload);
  }

  function setDirty(value) {
    work.dirty = !!value;
  }

  function job(label) {
    var id = ++work.seq;
    work.jobs[id] = label || 'Working';
    work.count++;
    syncLeaveGuard();
    var done = false;
    return function () {
      if (done) return;
      done = true;
      delete work.jobs[id];
      work.count--;
      syncLeaveGuard();
    };
  }

  function isIdle() {
    if (work.dirty || work.count > 0) return false;
    if (document.querySelector('[aria-busy="true"]')) return false;
    var dialogs = document.querySelectorAll('dialog[open]');
    for (var i = 0; i < dialogs.length; i++) {
      if (!dialogs[i].classList.contains('palette')) return false;
    }
    return true;
  }

  function showUpdateToast() {
    return showToast('A new version is ready.', 'info', {
      duration: 0,
      _isUpdate: true,
      _onClose: function () { update.dismissed = true; },
      action: { label: 'Reload', onClick: function () { location.reload(); } }
    });
  }

  /* Called when a newer service worker takes over this page. An idle page just
     reloads; a page holding work keeps it and offers the reload instead. */
  function onNewVersion(options) {
    options = options || {};
    if (isIdle()) {
      if (!options.dryRun) location.reload();
      return 'reload';
    }
    /* A dry run only reports what would happen. */
    if (options.dryRun) return 'toast';
    update.pending = true;
    update.dismissed = false;
    showUpdateToast();
    return 'toast';
  }

  /* ======================================================================
     Sub-tool links (S1) and recently used tools (S14)
     ====================================================================== */

  var RECENT_KEY = 'tfe:recent';
  var PINS_KEY = 'tfe:pins';
  var subtoolListeners = [];
  var LANDED_WITHOUT_HASH = !location.hash;
  var subtoolBaseline = null;
  var subtoolSwitched = false;

  function recentList() {
    var list = lsGet(RECENT_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function recordRecent(tool, hash, title) {
    if (!tool) return;
    var list = recentList().filter(function (r) { return r && r.path !== tool.path; });
    list.unshift({ path: tool.path, hash: hash || '', title: title || tool.name, ts: Date.now() });
    lsSet(RECENT_KEY, list.slice(0, 12));
  }

  function resolveRecent(r) {
    var tool = null;
    for (var i = 0; i < TOOLS.length; i++) if (TOOLS[i].path === r.path) tool = TOOLS[i];
    if (!tool) return null;
    var s = findSub(tool, r.hash);
    var e = makeEntry(tool, s);
    e.ts = r.ts;
    return e;
  }

  function recentEntries(limit) {
    var out = [];
    recentList().forEach(function (r) {
      var e = r && resolveRecent(r);
      if (e) out.push(e);
    });
    return limit ? out.slice(0, limit) : out;
  }

  function pinList() {
    var list = lsGet(PINS_KEY, []);
    return Array.isArray(list) ? list.filter(function (id) { return !!TOOL_BY_ID[id]; }) : [];
  }

  function setPinned(id, pinned) {
    var list = pinList().filter(function (x) { return x !== id; });
    if (pinned) list.push(id);
    lsSet(PINS_KEY, list);
    return list;
  }

  function currentToolName() {
    if (CURRENT_TOOL) return CURRENT_TOOL.name;
    var h1 = document.querySelector('.tool-header h1');
    return h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  var subtool = {
    initial: function (validIds, defaultId) {
      var h = safeDecode(location.hash.slice(1));
      return validIds && validIds.indexOf(h) !== -1 ? h : defaultId;
    },
    set: function (id, label) {
      if (!id) return;
      var s0 = findSub(CURRENT_TOOL, id);
      /* A page opened without a #sub-tool keeps its own title and a clean address
         until the person actually switches, so search engines and shared links see
         the page's real title rather than its first sub-tool's. */
      if (LANDED_WITHOUT_HASH && !subtoolSwitched && (subtoolBaseline === null || subtoolBaseline === id)) {
        subtoolBaseline = id;
        recordRecent(CURRENT_TOOL, id, s0 ? s0.name : (label || id));
        return;
      }
      subtoolSwitched = true;
      try {
        if (location.hash.slice(1) !== id) history.replaceState(history.state, '', '#' + id);
      } catch (e) { /* file: URLs in some browsers */ }
      var s = findSub(CURRENT_TOOL, id);
      var name = label || (s && s.name) || id;
      var toolName = currentToolName();
      document.title = name + (toolName ? ' - ' + toolName : '') + ' | Tools for Everyone';
      recordRecent(CURRENT_TOOL, id, s ? s.name : name);
    },
    onChange: function (fn) {
      if (typeof fn === 'function') subtoolListeners.push(fn);
    }
  };

  function fireSubtoolChange() {
    var id = safeDecode(location.hash.slice(1));
    if (!id) return;
    if (CURRENT_TOOL && CURRENT_TOOL.subtools.length && !findSub(CURRENT_TOOL, id)) return;
    subtoolListeners.forEach(function (fn) {
      try { fn(id); } catch (e) { setTimeout(function () { throw e; }); }
    });
  }

  window.addEventListener('hashchange', fireSubtoolChange);

  function isSamePage(href) {
    try {
      var u = new URL(href, location.href);
      return u.origin === location.origin && pathOf(u.href) === pathOf(location.href);
    } catch (e) { return false; }
  }

  /* Opens a registry entry: same-page sub-tools only change the hash. */
  function goTo(href) {
    if (isSamePage(href)) {
      var hash = new URL(href, location.href).hash;
      if (!hash) return;
      if (location.hash === hash) { fireSubtoolChange(); return; }
      if (subtoolListeners.length) { location.hash = hash; return; }
      /* A page that does not listen for hash changes picks the hash up on load. */
      location.hash = hash;
      if (isIdle()) location.reload();
      return;
    }
    location.href = href;
  }

  /* ======================================================================
     Remembered settings (S9)
     ====================================================================== */

  function prefs(namespace) {
    var key = 'tfe:prefs:' + namespace;

    function readAll() {
      var obj = lsGet(key, {});
      return obj && typeof obj === 'object' ? obj : {};
    }

    function get(k, fallback) {
      var all = readAll();
      return Object.prototype.hasOwnProperty.call(all, k) ? all[k] : fallback;
    }

    function set(k, value) {
      var all = readAll();
      if (value === undefined) delete all[k]; else all[k] = value;
      lsSet(key, all);
    }

    function skip(node, exclude) {
      var t = (node.type || '').toLowerCase();
      if (t === 'password' || t === 'file' || t === 'hidden' || t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return true;
      if (node.hasAttribute('data-no-remember')) return true;
      if (node.closest && node.closest('[data-no-remember]')) return true;
      if (t === 'radio') return !node.name || exclude.indexOf(node.name) !== -1 || (node.id && exclude.indexOf(node.id) !== -1);
      return !node.id || exclude.indexOf(node.id) !== -1;
    }

    function fire(node) {
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function bindForm(rootEl, options) {
      options = options || {};
      if (!rootEl) return;
      var exclude = options.exclude || [];
      var nodes = rootEl.querySelectorAll('input, select, textarea');
      var restored = [];

      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.__tfeBound || skip(node, exclude)) continue;
        node.__tfeBound = true;
        var t = (node.type || '').toLowerCase();
        var fieldKey = t === 'radio' ? '@radio:' + node.name : '@' + node.id;
        var stored = get(fieldKey, undefined);

        if (stored !== undefined) {
          var changed = false;
          if (t === 'checkbox') {
            if (node.checked !== !!stored) { node.checked = !!stored; changed = true; }
          } else if (t === 'radio') {
            if (node.value === stored && !node.checked) { node.checked = true; changed = true; }
          } else if (node.tagName === 'SELECT' && node.multiple && Array.isArray(stored)) {
            for (var o = 0; o < node.options.length; o++) {
              var want = stored.indexOf(node.options[o].value) !== -1;
              if (node.options[o].selected !== want) { node.options[o].selected = want; changed = true; }
            }
          } else if (node.tagName === 'SELECT') {
            var exists = false;
            for (var p = 0; p < node.options.length; p++) if (node.options[p].value === String(stored)) exists = true;
            if (exists && node.value !== String(stored)) { node.value = String(stored); changed = true; }
          } else if (node.value !== String(stored)) {
            node.value = String(stored);
            changed = true;
          }
          if (changed) restored.push(node);
        }

        (function (n, k, type) {
          function save() {
            if (type === 'checkbox') set(k, n.checked);
            else if (type === 'radio') { if (n.checked) set(k, n.value); }
            else if (n.tagName === 'SELECT' && n.multiple) {
              var vals = [];
              for (var q = 0; q < n.options.length; q++) if (n.options[q].selected) vals.push(n.options[q].value);
              set(k, vals);
            } else set(k, n.value);
          }
          n.addEventListener('input', save);
          n.addEventListener('change', save);
        })(node, fieldKey, t);
      }

      restored.forEach(fire);
      if (typeof options.onRestore === 'function') {
        try { options.onRestore(restored); } catch (e) { setTimeout(function () { throw e; }); }
      }
    }

    return { get: get, set: set, bindForm: bindForm };
  }

  /* ======================================================================
     Handing files between tools (S10, S15) through IndexedDB
     ====================================================================== */

  var HANDOFF_DB = 'tfe-handoff';
  var HANDOFF_STORE = 'files';
  var HANDOFF_KEY = 'pending';
  var HANDOFF_MAX_AGE = 60 * 60 * 1000;

  function openHandoffDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB is not available')); return; }
      var req;
      try { req = indexedDB.open(HANDOFF_DB, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(HANDOFF_STORE)) req.result.createObjectStore(HANDOFF_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('blocked')); };
    });
  }

  function idbRun(mode, fn) {
    return openHandoffDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(HANDOFF_STORE, mode);
        var store = tx.objectStore(HANDOFF_STORE);
        var result;
        fn(store, function (r) { result = r; });
        tx.oncomplete = function () { db.close(); resolve(result); };
        tx.onerror = function () { db.close(); reject(tx.error); };
        tx.onabort = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function toFileArray(files) {
    if (!files) return [];
    var list = (typeof files.length === 'number' && !(files instanceof Blob)) ? Array.prototype.slice.call(files) : [files];
    return list.filter(function (f) { return f && typeof f === 'object' && typeof f.size === 'number'; }).map(function (f, i) {
      if (typeof File === 'function' && !(f instanceof File)) {
        try { return new File([f], f.name || ('file-' + (i + 1)), { type: f.type || '' }); } catch (e) { return f; }
      }
      return f;
    });
  }

  function withHandoffParam(href) {
    var u = new URL(href, location.href);
    u.searchParams.set('handoff', '1');
    return u.href;
  }

  var handoff = {
    send: function (files, targetHref) {
      var list = toFileArray(files);
      var dest = targetHref;
      if (!list.length) { location.href = dest; return Promise.resolve(false); }
      return idbRun('readwrite', function (store) {
        store.put({ files: list, ts: Date.now() }, HANDOFF_KEY);
      }).then(function () {
        location.href = withHandoffParam(dest);
        return true;
      }, function () {
        showToast('Could not pass the file on. Add it again on the next page.', 'error');
        setTimeout(function () { location.href = dest; }, 1200);
        return false;
      });
    },
    take: function () {
      var params;
      try { params = new URLSearchParams(location.search); } catch (e) { return Promise.resolve(null); }
      if (params.get('handoff') !== '1') return Promise.resolve(null);
      params.delete('handoff');
      try {
        var qs = params.toString();
        history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
      } catch (e) {}
      return idbRun('readwrite', function (store, setResult) {
        var r = store.get(HANDOFF_KEY);
        r.onsuccess = function () { setResult(r.result); };
        store.delete(HANDOFF_KEY);
      }).then(function (record) {
        if (!record || !record.files || !record.files.length) return null;
        if (record.ts && Date.now() - record.ts > HANDOFF_MAX_AGE) return null;
        return toFileArray(record.files);
      }).catch(function () { return null; });
    }
  };

  /* ---------- What kind of file is this? ---------- */

  function extOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function kindOf(file) {
    var t = ((file && file.type) || '').toLowerCase();
    var ext = extOf(file && file.name);
    if (t === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (/^(docx|xlsx|pptx)$/.test(ext) || t.indexOf('officedocument') !== -1) return 'office';
    if (t.indexOf('image/') === 0 || /^(jpe?g|png|webp|gif|bmp|tiff?|avif|heic|heif)$/.test(ext)) return 'image';
    /* The MIME type wins over the extension: a recording saved as audio/webm is audio. */
    if (t.indexOf('audio/') === 0) return 'audio';
    if (t.indexOf('video/') === 0) return 'video';
    if (/^(mp3|wav|m4a|flac|ogg|oga|opus|aac|wma)$/.test(ext)) return 'audio';
    if (/^(mp4|mov|webm|mkv|avi|m4v|3gp)$/.test(ext)) return 'video';
    return 'any';
  }

  var KIND_PHRASE = { pdf: 'a PDF', image: 'an image', audio: 'an audio file', video: 'a video', office: 'an Office document' };
  var KIND_PLURAL = { pdf: 'PDFs', image: 'images', audio: 'audio files', video: 'videos', office: 'Office documents', any: 'other files' };

  function accepts(entry, kind) {
    var list = entry.accepts || [];
    return list.indexOf(kind) !== -1 || list.indexOf('any') !== -1;
  }

  /* Targets for a set of files, in the CONTINUE order, that take every kind. */
  function targetsFor(files, includeAny) {
    var kinds = [];
    files.forEach(function (f) { var k = kindOf(f); if (kinds.indexOf(k) === -1) kinds.push(k); });
    var keys = [];
    kinds.forEach(function (k) { (CONTINUE[k] || []).forEach(function (key) { if (keys.indexOf(key) === -1) keys.push(key); }); });
    var out = [];
    keys.forEach(function (key) {
      var e = entryFor(key);
      if (!e) return;
      for (var i = 0; i < kinds.length; i++) if (!accepts(e, kinds[i])) return;
      out.push(e);
    });
    if (includeAny) ANY_TARGETS.forEach(function (key) { var e = entryFor(key); if (e) out.push(e); });
    return { kinds: kinds, entries: out };
  }

  function isExcluded(entry, tokens) {
    for (var i = 0; i < tokens.length; i++) {
      var tok = String(tokens[i] || '');
      if (!tok) continue;
      if (tok.indexOf('#') !== -1) {
        var parts = tok.split('#');
        var page = safeDecode(parts[0]).toLowerCase();
        var subId = parts[1];
        var tool = entry.tool;
        var file = safeDecode(tool.path.split('/').pop()).toLowerCase();
        var pageMatches = !page || page === tool.id || page === file || safeDecode(tool.path).toLowerCase() === page;
        if (pageMatches && ((entry.sub && entry.sub.id === subId) || (!entry.sub && !subId))) return true;
      } else if (CURRENT_TOOL && findSub(CURRENT_TOOL, tok)) {
        if (entry.tool === CURRENT_TOOL && entry.sub && entry.sub.id === tok) return true;
      } else if (entry.tool.id === tok || (entry.sub && entry.sub.id === tok && !CURRENT_TOOL)) {
        return true;
      }
    }
    return false;
  }

  function isCurrentEntry(entry) {
    if (!CURRENT_TOOL || entry.tool !== CURRENT_TOOL) return false;
    if (!entry.sub) return !CURRENT_TOOL.subtools.length || !location.hash;
    return location.hash.slice(1) === entry.sub.id;
  }

  function continueWith(containerEl, files, options) {
    options = options || {};
    if (!containerEl) return null;
    var list = toFileArray(files);
    var old = containerEl.querySelector(':scope > .continue-with');
    if (old) old.remove();
    if (!list.length) return null;

    var entries = targetsFor(list, false).entries.filter(function (e) {
      return !isCurrentEntry(e) && !isExcluded(e, options.exclude || []);
    }).slice(0, options.limit || 6);
    if (!entries.length) return null;

    var row = el('div', 'continue-with');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Continue with another tool');
    row.appendChild(el('span', 'continue-with-label', 'Continue with'));
    entries.forEach(function (e) {
      var a = el('a', 'chip');
      a.href = e.href;
      a.appendChild(icon(e.icon));
      a.appendChild(document.createTextNode(list.length > 1 ? e.name : e.cta));
      if (e.sub) a.title = e.tool.name;
      a.addEventListener('click', function (ev) {
        if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        ev.preventDefault();
        a.setAttribute('aria-busy', 'true');
        handoff.send(list, e.href);
      });
      row.appendChild(a);
    });
    containerEl.appendChild(row);
    return row;
  }

  /* ---------- The "what do you want to do?" sheet (S15, share target) ---------- */

  var sheet = null;

  function closeSheet() {
    if (sheet && sheet.open) sheet.close();
  }

  function routeFiles(files) {
    var list = toFileArray(files);
    if (!list.length) return null;
    var found = targetsFor(list, true);

    if (!sheet) {
      sheet = el('dialog', 'sheet');
      sheet.setAttribute('aria-labelledby', 'tfe-sheet-title');
      sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
      sheet.addEventListener('close', function () {
        var back = sheet._returnFocus;
        sheet._returnFocus = null;
        if (back && document.contains(back)) try { back.focus(); } catch (e) {}
      });
      document.body.appendChild(sheet);
    }
    sheet.innerHTML = '';

    var head = el('div', 'sheet-head');
    var title = el('h2');
    title.id = 'tfe-sheet-title';
    var subline = el('p');
    if (list.length === 1) {
      var k = found.kinds[0];
      var phrase = KIND_PHRASE[k] || (extOf(list[0].name) ? 'a ' + extOf(list[0].name).toUpperCase() + ' file' : 'a file');
      title.textContent = list[0].name + ' is ' + phrase + '. What do you want to do?';
      subline.textContent = formatBytes(list[0].size) + '. It stays on this device.';
    } else {
      title.textContent = list.length + ' files. What do you want to do?';
      var kindsText = found.kinds.map(function (x) { return KIND_PLURAL[x]; });
      var total = list.reduce(function (n, f) { return n + (f.size || 0); }, 0);
      subline.textContent = (kindsText.length === 1 ? 'All ' + kindsText[0] : kindsText.slice(0, -1).join(', ') + ' and ' + kindsText[kindsText.length - 1]) +
        ', ' + formatBytes(total) + ' in total. They stay on this device.';
    }
    head.appendChild(title);
    head.appendChild(subline);
    sheet.appendChild(head);

    var body = el('div', 'sheet-list');
    if (found.entries.length === ANY_TARGETS.length) {
      body.appendChild(el('p', 'muted small', list.length === 1
        ? 'No tool here edits this kind of file, but you can rename it.'
        : 'No single tool here edits all of these, but you can rename them together.'));
    }
    found.entries.forEach(function (e) {
      var b = el('button', 'sheet-option');
      b.type = 'button';
      b.appendChild(icon(e.icon));
      var text = el('span', 'pi-text');
      text.appendChild(el('span', 'pi-name', e.cta));
      text.appendChild(el('span', 'pi-desc', e.sub ? e.tool.name + ': ' + e.sub.description : e.description));
      b.appendChild(text);
      b.addEventListener('click', function () {
        b.setAttribute('aria-busy', 'true');
        handoff.send(list, e.href);
      });
      body.appendChild(b);
    });
    sheet.appendChild(body);

    var foot = el('div', 'sheet-foot');
    var cancel = el('button', 'btn', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', closeSheet);
    foot.appendChild(cancel);
    sheet.appendChild(foot);

    sheet._returnFocus = document.activeElement;
    if (typeof sheet.showModal === 'function') {
      if (!sheet.open) sheet.showModal();
    } else sheet.setAttribute('open', '');
    var first = sheet.querySelector('.sheet-option');
    if (first) first.focus();
    return sheet;
  }

  /* ======================================================================
     Panel summaries (S2)
     ====================================================================== */

  function panelSummary(detailsEl, textFn) {
    var noop = { update: function () {} };
    if (!detailsEl || typeof textFn !== 'function') return noop;
    var summary = null;
    for (var i = 0; i < detailsEl.children.length; i++) {
      if (detailsEl.children[i].tagName === 'SUMMARY') { summary = detailsEl.children[i]; break; }
    }
    if (!summary) return noop;
    var span = summary.querySelector('.panel-summary');
    if (!span) {
      span = el('span', 'panel-summary');
      var label = summary.querySelector('span');
      var caret = summary.querySelector('.caret');
      if (label && label.parentNode === summary) label.insertAdjacentElement('afterend', span);
      else if (caret) summary.insertBefore(span, caret);
      else summary.appendChild(span);
    }
    function refresh() {
      var t = '';
      try { t = textFn() || ''; } catch (e) { t = ''; }
      span.textContent = String(t);
    }
    detailsEl.addEventListener('input', refresh);
    detailsEl.addEventListener('change', refresh);
    refresh();
    return { update: refresh };
  }

  /* ======================================================================
     Page chrome: skip link, header additions, footer licence
     ====================================================================== */

  function initSkipLink() {
    var target = document.getElementById('main');
    if (!target) {
      target = document.querySelector('main') || document.querySelector('.tool-main');
      if (target) target.id = 'main';
    }
    if (!target || document.querySelector('.skip-link')) return;
    var a = el('a', 'skip-link', 'Skip to content');
    a.href = '#main';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var t = document.getElementById('main');
      if (!t) return;
      if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
      t.focus();
      try { t.scrollIntoView({ block: 'start' }); } catch (err) {}
    });
    document.body.insertBefore(a, document.body.firstChild);
  }

  function initBackLink() {
    var backs = document.querySelectorAll('.tool-header .back');
    for (var i = 0; i < backs.length; i++) {
      if (!backs[i].getAttribute('aria-label') && !backs[i].textContent.trim()) backs[i].setAttribute('aria-label', 'All tools');
    }
  }

  function initFooter() {
    var footers = document.querySelectorAll('.tool-footer');
    for (var i = 0; i < footers.length; i++) {
      var f = footers[i];
      if (f.querySelector('a[href*="LICENSE"]') || /MIT licence/i.test(f.textContent)) continue;
      var a = el('a', null, 'MIT licence');
      a.href = LICENSE;
      f.appendChild(a);
    }
  }

  /* ---------- Trust indicator (S11) ---------- */

  var trustPills = [];

  function syncOnline() {
    var offline = navigator.onLine === false;
    trustPills.forEach(function (p) {
      p.btn.classList.toggle('is-offline', offline);
      p.btn.querySelector('.ph').className = 'ph ' + (offline ? 'ph-wifi-slash' : 'ph-shield-check');
      p.label.textContent = offline ? 'Offline' : 'On this device';
      p.btn.setAttribute('aria-label', offline ? 'Offline. How your files are handled' : 'On this device. How your files are handled');
      p.offlineNote.hidden = !offline;
    });
  }

  function buildTrust(container) {
    var id = 'tfe-trust-' + trustPills.length;
    var btn = el('button', 'trust-pill');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', id);
    btn.appendChild(icon('shield-check'));
    var label = el('span', 'trust-label', 'On this device');
    btn.appendChild(label);

    var pop = el('div', 'trust-pop');
    pop.id = id;
    pop.hidden = true;
    pop.setAttribute('role', 'region');
    pop.setAttribute('aria-label', 'How your files are handled');
    var h = el('h2');
    h.appendChild(icon('shield-check'));
    h.appendChild(document.createTextNode('Your files stay on this device'));
    pop.appendChild(h);
    var offlineNote = el('p', 'warning-msg', 'You are offline. Tools you have opened before still work.');
    offlineNote.hidden = true;
    pop.appendChild(offlineNote);
    pop.appendChild(el('p', null, 'Your files are processed by this browser and never uploaded. Once a tool has been opened online, it keeps working offline.'));
    pop.appendChild(el('p', 'muted', 'How to check: open your browser\'s network panel while you use a tool.'));
    pop.appendChild(el('p', 'muted', 'The Audio Transcriber\'s optional OpenAI mode is the one exception.'));
    var p = el('p');
    var src = el('a', null, 'Read the source on GitHub');
    src.href = REPO;
    p.appendChild(src);
    pop.appendChild(p);

    function setOpen(open) {
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(pop.hidden);
    });
    document.addEventListener('click', function (e) {
      if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && !pop.hidden) {
        setOpen(false);
        btn.focus();
      }
    });
    pop.addEventListener('focusout', function (e) {
      if (e.relatedTarget && !pop.contains(e.relatedTarget) && e.relatedTarget !== btn) setOpen(false);
    });

    container.insertBefore(pop, container.firstChild);
    container.insertBefore(btn, container.firstChild);
    trustPills.push({ btn: btn, label: label, pop: pop, offlineNote: offlineNote });
    return btn;
  }

  /* ---------- Install (S12) ---------- */

  var install = { prompt: null, buttons: [] };

  function syncInstallButtons() {
    install.buttons.forEach(function (b) { b.classList.toggle('hidden', !install.prompt); });
  }

  function runInstall() {
    if (!install.prompt) return;
    var p = install.prompt;
    p.prompt();
    p.userChoice.then(function () {
      install.prompt = null;
      syncInstallButtons();
    }).catch(function () {});
  }

  /* Browsers keep the install option buried in a menu, so these buttons only
     appear once the browser has said the site qualifies. Safari fires nothing
     and installs through its own share sheet, so they stay hidden there. */
  function initInstall() {
    var legacy = document.getElementById('installApp');
    if (legacy) install.buttons.push(legacy);
    install.buttons.forEach(function (b) { b.addEventListener('click', runInstall); });

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      install.prompt = e;
      syncInstallButtons();
    });
    window.addEventListener('appinstalled', function () {
      install.prompt = null;
      syncInstallButtons();
    });
  }

  function buildInstall(container) {
    var b = el('button', 'icon-btn install-btn hidden');
    b.type = 'button';
    b.setAttribute('aria-label', 'Install app');
    b.title = 'Install app';
    b.appendChild(icon('download-simple'));
    b.addEventListener('click', runInstall);
    install.buttons.push(b);
    var theme = container.querySelector('#themeToggle');
    if (theme && theme.parentNode === container) container.insertBefore(b, theme);
    else container.appendChild(b);
  }

  function buildSearchButton(container, after) {
    var b = el('button', 'btn btn-sm header-search');
    b.type = 'button';
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-keyshortcuts', isMac() ? 'Meta+K' : 'Control+K');
    b.setAttribute('aria-label', 'Search tools');
    b.appendChild(icon('magnifying-glass'));
    b.appendChild(el('span', null, 'Search'));
    var k = el('kbd', 'kbd', isMac() ? '⌘K' : 'Ctrl K');
    k.setAttribute('aria-hidden', 'true');
    b.appendChild(k);
    b.addEventListener('click', function () { openPalette(b); });
    if (after && after.nextSibling) container.insertBefore(b, after.nextSibling);
    else container.appendChild(b);
  }

  function initHeader() {
    var containers = document.querySelectorAll('.header-actions');
    for (var i = 0; i < containers.length; i++) {
      var c = containers[i];
      if (c.getAttribute('data-tfe-ready')) continue;
      c.setAttribute('data-tfe-ready', '1');
      var pill = buildTrust(c);
      /* The trust popover sits right after the pill in the DOM, so the search
         button goes after the popover to keep the pill and its panel together. */
      buildSearchButton(c, pill.nextSibling);
      buildInstall(c);
    }
    syncOnline();
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
  }

  /* ======================================================================
     Ctrl+K switcher (S4)
     ====================================================================== */

  var palette = null;

  function commands() {
    var list = [];
    if (!IS_LANDING) list.push({ type: 'command', name: 'All tools', description: 'Go to the home page', icon: 'house', run: function () { location.href = rootUrl('./'); } });
    list.push({ type: 'command', name: 'Toggle theme', description: currentTheme() === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme', icon: currentTheme() === 'dark' ? 'sun' : 'moon', run: toggleTheme, keywords: 'dark light mode colour color' });
    if (install.prompt) list.push({ type: 'command', name: 'Install app', description: 'Open the tools in their own window, offline too', icon: 'download-simple', run: runInstall, keywords: 'pwa add home screen' });
    list.push({ type: 'command', name: 'Source on GitHub', description: 'Read the code behind these tools', icon: 'github-logo', run: function () { location.href = REPO; }, keywords: 'code repository open source' });
    list.push({ type: 'command', name: 'Report a problem', description: 'Open a new issue on GitHub', icon: 'bug', run: function () { location.href = ISSUES; }, keywords: 'bug issue feedback suggest idea request' });
    return list;
  }

  function filterCommands(query) {
    var tokens = normalise(query).split(' ').filter(Boolean);
    return commands().filter(function (c) {
      var hay = normalise(c.name + ' ' + (c.keywords || '') + ' ' + c.description);
      for (var i = 0; i < tokens.length; i++) if (!wordStarts(hay, tokens[i]) && hay.indexOf(tokens[i]) === -1) return false;
      return true;
    });
  }

  function buildPalette() {
    var dlg = el('dialog', 'palette');
    dlg.setAttribute('aria-label', 'Search tools and commands');
    var bar = el('div', 'palette-search');
    bar.appendChild(icon('magnifying-glass'));
    var input = el('input');
    input.type = 'text';
    input.placeholder = 'Search a tool or a command…';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'tfe-palette-list');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-label', 'Search a tool or a command');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('data-no-remember', '');
    bar.appendChild(input);
    var esc = el('kbd', 'kbd', 'Esc');
    esc.setAttribute('aria-hidden', 'true');
    bar.appendChild(esc);
    dlg.appendChild(bar);

    var listEl = el('div', 'palette-list');
    listEl.id = 'tfe-palette-list';
    listEl.setAttribute('role', 'listbox');
    listEl.setAttribute('aria-label', 'Results');
    dlg.appendChild(listEl);

    var foot = el('div', 'palette-foot');
    foot.innerHTML = '<span><kbd class="kbd">↑</kbd> <kbd class="kbd">↓</kbd> to move</span><span><kbd class="kbd">Enter</kbd> to open</span><span><kbd class="kbd">Esc</kbd> to close</span>';
    foot.setAttribute('aria-hidden', 'true');
    dlg.appendChild(foot);

    document.body.appendChild(dlg);

    var state = { items: [], active: 0, opener: null };

    function optionFor(item, idx) {
      var o = el('div', 'palette-item');
      o.id = 'tfe-opt-' + idx;
      o.setAttribute('role', 'option');
      o.setAttribute('aria-selected', 'false');
      o.appendChild(icon(item.icon));
      var text = el('span', 'pi-text');
      text.appendChild(el('span', 'pi-name', item.name));
      if (item.description) text.appendChild(el('span', 'pi-desc', item.description));
      o.appendChild(text);
      var meta = item.type === 'subtool' ? item.tool.name : item.type === 'command' ? 'Command' : '';
      if (item.recent) meta = item.type === 'subtool' ? item.tool.name : '';
      if (meta) o.appendChild(el('span', 'pi-meta', meta));
      o.addEventListener('mousemove', function () { if (state.active !== idx) setActive(idx, false); });
      o.addEventListener('mousedown', function (e) { e.preventDefault(); });
      o.addEventListener('click', function () { choose(idx); });
      return o;
    }

    function groupEl(label, id) {
      var g = el('div');
      g.setAttribute('role', 'group');
      var h = el('div', 'palette-group', label);
      h.id = id;
      h.setAttribute('role', 'presentation');
      g.setAttribute('aria-labelledby', id);
      g.appendChild(h);
      return g;
    }

    function render() {
      var q = input.value.trim();
      var groups = [];
      if (!q) {
        var recents = recentEntries(5).filter(function (e) { return !(isSamePage(e.href) && (!e.sub || location.hash.slice(1) === e.sub.id)); });
        recents.forEach(function (e) { e.recent = true; });
        if (recents.length) groups.push({ label: 'Recent', items: recents });
        CATEGORIES.forEach(function (c) {
          groups.push({ label: c.name, items: TOOLS.filter(function (t) { return t.category === c.id; }).map(function (t) { return makeEntry(t, null); }) });
        });
        groups.push({ label: 'Commands', items: commands() });
      } else {
        var hits = search(q, 24);
        CATEGORIES.forEach(function (c) {
          var items = hits.filter(function (e) { return e.category === c.id; });
          if (items.length) groups.push({ label: c.name, items: items, best: hits.indexOf(items[0]) });
        });
        /* The group holding the best match comes first. */
        groups.sort(function (a, b) { return a.best - b.best; });
        var cmds = filterCommands(q);
        if (cmds.length) groups.push({ label: 'Commands', items: cmds });
      }

      listEl.innerHTML = '';
      state.items = [];
      groups.forEach(function (g, gi) {
        var ge = groupEl(g.label, 'tfe-grp-' + gi);
        g.items.forEach(function (item) {
          ge.appendChild(optionFor(item, state.items.length));
          state.items.push(item);
        });
        listEl.appendChild(ge);
      });
      if (!state.items.length) {
        var empty = el('div', 'palette-empty');
        empty.appendChild(el('p', null, 'Nothing matches “' + q + '”.'));
        var p = el('p');
        var a = el('a', null, 'Ask for a tool on GitHub');
        a.href = ISSUES;
        p.appendChild(a);
        empty.appendChild(p);
        listEl.appendChild(empty);
        input.removeAttribute('aria-activedescendant');
      }
      setActive(0, true);
    }

    function setActive(idx, scroll) {
      if (!state.items.length) return;
      idx = (idx + state.items.length) % state.items.length;
      var prev = listEl.querySelector('[aria-selected="true"]');
      if (prev) prev.setAttribute('aria-selected', 'false');
      state.active = idx;
      var o = document.getElementById('tfe-opt-' + idx);
      if (!o) return;
      o.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', o.id);
      if (scroll !== false) {
        try { o.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      }
    }

    function choose(idx) {
      var item = state.items[idx];
      if (!item) return;
      close(item.type === 'command' || isSamePage(item.href || ''));
      if (item.type === 'command') { item.run(); return; }
      goTo(item.href);
    }

    function close(restoreFocus) {
      if (dlg.open) {
        state.restore = restoreFocus !== false;
        dlg.close();
      }
    }

    dlg.addEventListener('close', function () {
      var opener = state.opener;
      state.opener = null;
      if (state.restore !== false && opener && document.contains(opener)) {
        try { opener.focus(); } catch (e) {}
      }
      state.restore = true;
    });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(true); });

    input.addEventListener('input', render);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'Down') { e.preventDefault(); setActive(state.active + 1); }
      else if (e.key === 'ArrowUp' || e.key === 'Up') { e.preventDefault(); setActive(state.active - 1); }
      else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); setActive(0); }
      else if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); setActive(state.items.length - 1); }
      else if (e.key === 'PageDown') { e.preventDefault(); setActive(Math.min(state.active + 6, state.items.length - 1)); }
      else if (e.key === 'PageUp') { e.preventDefault(); setActive(Math.max(state.active - 6, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(state.active); }
      else if ((e.key === 'Escape' || e.key === 'Esc') && typeof dlg.showModal !== 'function') { e.preventDefault(); close(true); }
    });

    return {
      el: dlg,
      input: input,
      open: function (opener) {
        state.opener = opener || document.activeElement;
        state.restore = true;
        input.value = '';
        render();
        if (!dlg.open) {
          if (typeof dlg.showModal === 'function') dlg.showModal();
          else dlg.setAttribute('open', '');
        }
        input.focus();
      },
      close: close,
      isOpen: function () { return dlg.open; },
      items: function () { return state.items.slice(); }
    };
  }

  function openPalette(opener) {
    if (!palette) palette = buildPalette();
    if (sheet && sheet.open) closeSheet();
    palette.open(opener);
  }

  function initShortcuts() {
    document.addEventListener('keydown', function (e) {
      var key = e.key ? e.key.toLowerCase() : '';
      if (key === 'k' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (palette && palette.isOpen()) palette.close(true);
        else openPalette(document.activeElement);
        return;
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditable(e.target)) {
        if (document.querySelector('dialog[open]')) return;
        var landingSearch = document.getElementById('toolSearch');
        e.preventDefault();
        if (landingSearch) { landingSearch.focus(); landingSearch.select(); }
        else openPalette(document.activeElement);
      }
    });
  }

  /* ======================================================================
     Drop zones and control panels
     ====================================================================== */

  function initDropZoneKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var zone = e.target.closest ? e.target.closest('.drop-zone') : null;
      if (!zone) return;
      e.preventDefault();
      zone.click();
    });
  }

  function syncPanels() {
    var panels = document.querySelectorAll('details.panel[data-mobile-collapsed]');
    var isMobile = window.matchMedia(MOBILE).matches;
    for (var i = 0; i < panels.length; i++) {
      if (isMobile) panels[i].removeAttribute('open');
      else panels[i].setAttribute('open', '');
    }
  }

  function initPanels() {
    syncPanels();
    var mq = window.matchMedia(MOBILE);
    var handler = function () { syncPanels(); };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  }

  /* Keeps body padding under a pinned action bar (CSS :has covers new browsers). */
  function initStickyBars() {
    var queued = false;
    function check() {
      queued = false;
      var bars = document.querySelectorAll('.action-bar.is-sticky');
      var any = false;
      for (var i = 0; i < bars.length; i++) {
        if (!bars[i].classList.contains('hidden') && bars[i].getClientRects().length) { any = true; break; }
      }
      document.body.classList.toggle('has-sticky-action', any && window.matchMedia(MOBILE).matches);
    }
    function queue() {
      if (queued) return;
      queued = true;
      (window.requestAnimationFrame || setTimeout)(check);
    }
    if (typeof MutationObserver === 'function') {
      new MutationObserver(queue).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    }
    window.addEventListener('resize', queue);
    queue();
  }

  /* ======================================================================
     Service worker
     ====================================================================== */

  /* Installed as an app, a page can sit open for days, so a new version takes
     over as soon as it installs. An idle page reloads into it straight away; a
     page holding work shows "A new version is ready" instead and waits. */
  function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    var path = document.body.dataset.swPath;
    if (!path) return;

    var hadController = !!navigator.serviceWorker.controller;
    var handled = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      /* On the very first visit there was no controller, so this is the worker
         taking charge rather than a new version replacing an old one. */
      if (!hadController) { hadController = true; return; }
      if (handled) return;
      handled = true;
      onNewVersion();
    });

    window.addEventListener('load', function () {
      navigator.serviceWorker.register(path).then(function (reg) {
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) reg.update().catch(function () {});
        });
        setInterval(function () { reg.update().catch(function () {}); }, 60 * 60 * 1000);
      }).catch(function () {});
    });
  }

  /* ======================================================================
     Exports
     ====================================================================== */

  window.showToast = showToast;
  window.showInlineError = showInlineError;
  window.clearInlineErrors = clearInlineErrors;
  window.setBusy = setBusy;
  window.setProgress = setProgress;
  window.clearProgress = clearProgress;
  window.sharePage = sharePage;
  /* Kept so any older inline handler still resolves. */
  window.shareThisTool = sharePage;
  window.shareThisPage = sharePage;

  TFE.version = 1;
  TFE.root = ROOT;
  TFE.setDirty = setDirty;
  TFE.job = job;
  TFE.isIdle = isIdle;
  TFE.subtool = subtool;
  TFE.tools = TOOLS;
  TFE.categories = CATEGORIES;
  TFE.toolById = function (id) { return TOOL_BY_ID[id] || null; };
  TFE.toolForPage = function () { return CURRENT_TOOL; };
  TFE.entries = allEntries;
  TFE.search = search;
  TFE.prefs = prefs;
  TFE.handoff = handoff;
  TFE.continueWith = continueWith;
  TFE.kindOf = kindOf;
  TFE.routeFiles = routeFiles;
  TFE.announce = announce;
  TFE.confirmInline = confirmInline;
  TFE.revealResult = revealResult;
  TFE.formatBytes = formatBytes;
  TFE.panelSummary = panelSummary;
  TFE.toast = showToast;
  TFE.palette = { open: function (opener) { openPalette(opener); }, close: function () { if (palette) palette.close(true); } };
  TFE.recent = { list: recentEntries, clear: function () { lsSet(RECENT_KEY, []); } };
  TFE.pins = { list: pinList, set: setPinned };
  TFE.goTo = goTo;
  /* For tests and the update flow: what a new service worker version would do. */
  TFE._onNewVersion = onNewVersion;

  /* Clearing runs in the capture phase, so an inline error raised by the click
     that follows is not wiped by its own event. */
  document.addEventListener('click', clearInlineErrors, true);

  initTheme();
  ensureLiveRegion();
  initSkipLink();
  initBackLink();
  initInstall();
  initHeader();
  initFooter();
  initShortcuts();
  initDropZoneKeys();
  initPanels();
  initStickyBars();
  initServiceWorker();

  if (CURRENT_TOOL) {
    var startSub = findSub(CURRENT_TOOL, safeDecode(location.hash.slice(1)));
    recordRecent(CURRENT_TOOL, startSub ? startSub.id : '', startSub ? startSub.name : CURRENT_TOOL.name);
  }
})();
