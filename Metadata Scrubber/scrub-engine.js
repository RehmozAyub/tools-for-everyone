/* Metadata Scrubber engine.

   Reads and removes metadata from photos (JPEG, PNG, WebP, and TIFF/HEIC for reading)
   and documents (PDF, DOCX, XLSX, PPTX). Photos are cleaned without re-encoding: the
   container is rewritten and the compressed picture data is copied byte for byte.

   Every inspector returns a list of "fields":
     { id, name, value, cat, source, keepable, fixed? }
   ids are stable between an input file and its cleaned output, so the same inspector
   run on the output proves what was removed and what remains.

   Categories (cat): location, device, serial, software, time, people, rights,
   camera, content, tech, other.

   Exposed as window.ScrubEngine. Needs PDFLib (pdf-lib) for PDFs and JSZip for Office
   files; both are loaded by the page. */
(function () {
  'use strict';

  const TE = new TextEncoder();
  const UTF8 = new TextDecoder('utf-8');
  const LATIN1 = new TextDecoder('latin1');

  /* ---------- small helpers ---------- */

  function concat(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  function startsWith(b, off, str) {
    if (off + str.length > b.length) return false;
    for (let i = 0; i < str.length; i++) if (b[off + i] !== str.charCodeAt(i)) return false;
    return true;
  }
  function ascii(b, off, len) {
    let s = '';
    for (let i = 0; i < len && off + i < b.length; i++) s += String.fromCharCode(b[off + i]);
    return s;
  }
  function hex(n, w) { return '0x' + n.toString(16).toUpperCase().padStart(w || 4, '0'); }
  function cleanStr(s) { return String(s).replace(/\u0000+$/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').trim(); }
  function isPrintable(b) {
    let n = 0;
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      if (c === 0 && i >= b.length - 1) continue;
      if (c < 9 || (c > 13 && c < 32) || c > 126) n++;
    }
    return b.length > 0 && n === 0;
  }
  function decodeText(b) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return LATIN1.decode(b); }
  }
  function bytesLabel(n) {
    if (n < 1024) return n + ' bytes';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('no DecompressionStream');
    const ds = new DecompressionStream('deflate');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }

  function loadScript(src, globalName) {
    if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
    loadScript.cache = loadScript.cache || {};
    if (!loadScript.cache[src]) {
      loadScript.cache[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve(globalName ? window[globalName] : true);
        s.onerror = () => { delete loadScript.cache[src]; reject(new Error('Could not load ' + src)); };
        document.head.appendChild(s);
      });
    }
    return loadScript.cache[src];
  }

  /* ---------- categories ---------- */

  const GROUPS = {
    location: 'Location', device: 'Device', serial: 'Device', software: 'Device',
    time: 'Time taken', people: 'People', rights: 'People',
    camera: 'Other', content: 'Other', tech: 'Other', other: 'Other'
  };
  const RISK_CATS = new Set(['location', 'device', 'serial', 'software', 'time', 'people', 'rights']);

  function guessCat(name) {
    const n = String(name).toLowerCase();
    if (/gps|latitude|longitude|altitude|location|city|country|sublocation|province|state\b/.test(n)) return 'location';
    if (/serial|uniqueid|unique id|documentid|instanceid/.test(n)) return 'serial';
    if (/date|time|modified|created/.test(n)) return 'time';
    if (/author|creator|owner|artist|by-line|byline|writer|person|user|name/.test(n)) return 'people';
    if (/copyright|rights|credit/.test(n)) return 'rights';
    if (/make|model|lens|camera|device/.test(n)) return 'device';
    if (/software|tool|producer|application|firmware/.test(n)) return 'software';
    if (/title|description|comment|keyword|subject|caption|headline/.test(n)) return 'content';
    return 'other';
  }

  /* ---------- EXIF / TIFF ---------- */

  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

  // [name, category]
  const TAGS = {
    ifd0: {
      0x010E: ['Image description', 'content'], 0x010F: ['Make', 'device'], 0x0110: ['Model', 'device'],
      0x0112: ['Orientation', 'tech'], 0x011A: ['X resolution', 'tech'], 0x011B: ['Y resolution', 'tech'],
      0x0128: ['Resolution unit', 'tech'], 0x0131: ['Software', 'software'], 0x0132: ['Date modified', 'time'],
      0x013B: ['Artist', 'rights'], 0x013C: ['Host computer', 'device'], 0x013E: ['White point', 'tech'],
      0x013F: ['Primary chromaticities', 'tech'], 0x0211: ['YCbCr coefficients', 'tech'],
      0x0213: ['YCbCr positioning', 'tech'], 0x0214: ['Reference black and white', 'tech'],
      0x02BC: ['XMP data', 'other'], 0x4746: ['Rating', 'other'], 0x4749: ['Rating percent', 'other'],
      0x8298: ['Copyright', 'rights'], 0x83BB: ['IPTC data', 'other'], 0x8773: ['Colour profile', 'tech'],
      0x9C9B: ['Windows title', 'content'], 0x9C9C: ['Windows comment', 'content'], 0x9C9D: ['Windows author', 'rights'],
      0x9C9E: ['Windows keywords', 'content'], 0x9C9F: ['Windows subject', 'content'],
      0xC4A5: ['Print settings (PrintIM)', 'other'], 0xC614: ['Unique camera model', 'device'],
      0xC62F: ['Camera serial number', 'serial'], 0xA420: ['Image unique ID', 'serial'],
      0xA431: ['Body serial number', 'serial'], 0xA430: ['Camera owner name', 'people']
    },
    exif: {
      0x829A: ['Exposure time', 'camera'], 0x829D: ['F-number', 'camera'], 0x8822: ['Exposure program', 'camera'],
      0x8824: ['Spectral sensitivity', 'camera'], 0x8827: ['ISO', 'camera'], 0x8830: ['Sensitivity type', 'camera'],
      0x8831: ['Standard output sensitivity', 'camera'], 0x8832: ['Recommended exposure index', 'camera'],
      0x9000: ['EXIF version', 'tech'], 0x9003: ['Date taken', 'time'], 0x9004: ['Date digitised', 'time'],
      0x9010: ['Time zone', 'time'], 0x9011: ['Time zone (taken)', 'time'], 0x9012: ['Time zone (digitised)', 'time'],
      0x9101: ['Components configuration', 'tech'], 0x9102: ['Compressed bits per pixel', 'tech'],
      0x9201: ['Shutter speed', 'camera'], 0x9202: ['Aperture', 'camera'], 0x9203: ['Brightness', 'camera'],
      0x9204: ['Exposure compensation', 'camera'], 0x9205: ['Max aperture', 'camera'], 0x9206: ['Subject distance', 'camera'],
      0x9207: ['Metering mode', 'camera'], 0x9208: ['Light source', 'camera'], 0x9209: ['Flash', 'camera'],
      0x920A: ['Focal length', 'camera'], 0x9214: ['Subject area', 'camera'], 0x927C: ['Maker notes', 'device'],
      0x9286: ['User comment', 'content'], 0x9290: ['Subsecond time', 'time'], 0x9291: ['Subsecond time (taken)', 'time'],
      0x9292: ['Subsecond time (digitised)', 'time'], 0x9400: ['Temperature', 'other'], 0x9401: ['Humidity', 'other'],
      0x9402: ['Pressure', 'other'], 0x9403: ['Water depth', 'location'], 0x9404: ['Acceleration', 'other'],
      0x9405: ['Camera elevation angle', 'other'], 0xA000: ['FlashPix version', 'tech'], 0xA001: ['Colour space', 'tech'],
      0xA002: ['Image width', 'tech'], 0xA003: ['Image height', 'tech'], 0xA004: ['Related sound file', 'other'],
      0xA20B: ['Flash energy', 'camera'], 0xA20E: ['Focal plane X resolution', 'camera'],
      0xA20F: ['Focal plane Y resolution', 'camera'], 0xA210: ['Focal plane resolution unit', 'camera'],
      0xA214: ['Subject location', 'camera'], 0xA215: ['Exposure index', 'camera'], 0xA217: ['Sensing method', 'camera'],
      0xA300: ['File source', 'tech'], 0xA301: ['Scene type', 'camera'], 0xA302: ['CFA pattern', 'camera'],
      0xA401: ['Custom rendered', 'camera'], 0xA402: ['Exposure mode', 'camera'], 0xA403: ['White balance', 'camera'],
      0xA404: ['Digital zoom ratio', 'camera'], 0xA405: ['Focal length (35 mm)', 'camera'], 0xA406: ['Scene capture type', 'camera'],
      0xA407: ['Gain control', 'camera'], 0xA408: ['Contrast', 'camera'], 0xA409: ['Saturation', 'camera'],
      0xA40A: ['Sharpness', 'camera'], 0xA40C: ['Subject distance range', 'camera'], 0xA420: ['Image unique ID', 'serial'],
      0xA430: ['Camera owner name', 'people'], 0xA431: ['Body serial number', 'serial'], 0xA432: ['Lens specification', 'device'],
      0xA433: ['Lens make', 'device'], 0xA434: ['Lens model', 'device'], 0xA435: ['Lens serial number', 'serial'],
      0xA460: ['Composite image', 'camera'], 0xA500: ['Gamma', 'tech']
    },
    gps: {
      0x00: ['GPS version', 'location'], 0x01: ['Latitude reference', 'location'], 0x02: ['Latitude', 'location'],
      0x03: ['Longitude reference', 'location'], 0x04: ['Longitude', 'location'], 0x05: ['Altitude reference', 'location'],
      0x06: ['Altitude', 'location'], 0x07: ['GPS time', 'location'], 0x08: ['GPS satellites', 'location'],
      0x09: ['GPS status', 'location'], 0x0A: ['GPS measure mode', 'location'], 0x0B: ['GPS precision (DOP)', 'location'],
      0x0C: ['Speed unit', 'location'], 0x0D: ['Speed', 'location'], 0x0E: ['Direction of movement reference', 'location'],
      0x0F: ['Direction of movement', 'location'], 0x10: ['Image direction reference', 'location'],
      0x11: ['Image direction', 'location'], 0x12: ['Map datum', 'location'], 0x13: ['Destination latitude reference', 'location'],
      0x14: ['Destination latitude', 'location'], 0x15: ['Destination longitude reference', 'location'],
      0x16: ['Destination longitude', 'location'], 0x17: ['Destination bearing reference', 'location'],
      0x18: ['Destination bearing', 'location'], 0x19: ['Destination distance reference', 'location'],
      0x1A: ['Destination distance', 'location'], 0x1B: ['GPS processing method', 'location'],
      0x1C: ['GPS area information', 'location'], 0x1D: ['GPS date', 'location'], 0x1E: ['GPS differential', 'location'],
      0x1F: ['GPS horizontal error', 'location']
    }
  };
  const POINTER_TAGS = new Set([0x8769, 0x8825, 0xA005]);
  // Never written back: they hold offsets or large private blobs, or are handled elsewhere.
  const NOT_KEEPABLE = new Set([0x927C, 0x0201, 0x0202, 0x02BC, 0x83BB, 0x8773, 0xEA1C, 0xEA1D, 0x014A, 0xC4A5]);
  // TIFF image structure, not metadata.
  const STRUCT_TAGS = new Set([0x00FE, 0x00FF, 0x0100, 0x0101, 0x0102, 0x0103, 0x0106, 0x0107, 0x0108, 0x0109, 0x010A,
    0x010D, 0x0111, 0x0115, 0x0116, 0x0117, 0x0118, 0x0119, 0x011C, 0x0122, 0x0123, 0x0124, 0x0125, 0x0129,
    0x013D, 0x0140, 0x0141, 0x0142, 0x0143, 0x0144, 0x0145, 0x014A, 0x0152, 0x0153, 0x0154, 0x0155, 0x015B,
    0x0200, 0x0203, 0x0205, 0x0206, 0x0207, 0x0208, 0x0209, 0x0212, 0x0201, 0x0202]);
  const NAME_CAT = {};
  for (const ifd of Object.keys(TAGS)) for (const k of Object.keys(TAGS[ifd])) NAME_CAT[TAGS[ifd][k][0].toLowerCase()] = TAGS[ifd][k][1];

  function parseTiff(b) {
    if (b.length < 8) throw new Error('EXIF block is too short');
    const le = b[0] === 0x49 && b[1] === 0x49;
    if (!le && !(b[0] === 0x4D && b[1] === 0x4D)) throw new Error('EXIF block has no byte order mark');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const r16 = o => dv.getUint16(o, le);
    const r32 = o => dv.getUint32(o, le);
    if (r16(2) !== 42) throw new Error('EXIF block is not TIFF');
    const out = { le, ifd0: [], exif: [], gps: [], interop: [], ifd1: [], thumbLen: 0 };
    const seen = new Set();
    function readIfd(off, name) {
      if (!off || off + 2 > b.length || seen.has(off)) return 0;
      seen.add(off);
      const n = r16(off);
      if (n > 2000) return 0;
      for (let i = 0; i < n; i++) {
        const e = off + 2 + i * 12;
        if (e + 12 > b.length) break;
        const tag = r16(e), type = r16(e + 2), count = r32(e + 4);
        const size = TYPE_SIZE[type];
        if (!size) continue;
        const len = size * count;
        if (len > b.length) continue;
        const voff = len <= 4 ? e + 8 : r32(e + 8);
        if (voff + len > b.length) continue;
        out[name].push({ tag, type, count, raw: b.slice(voff, voff + len) });
      }
      const nx = off + 2 + n * 12;
      return nx + 4 <= b.length ? r32(nx) : 0;
    }
    const next = readIfd(r32(4), 'ifd0');
    const ptr = (list, tag) => { const e = list.find(x => x.tag === tag); return e && e.raw.length >= 4 ? new DataView(e.raw.buffer).getUint32(0, le) : 0; };
    readIfd(ptr(out.ifd0, 0x8769), 'exif');
    readIfd(ptr(out.ifd0, 0x8825), 'gps');
    readIfd(ptr(out.exif, 0xA005), 'interop');
    if (next) readIfd(next, 'ifd1');
    const tl = out.ifd1.find(x => x.tag === 0x0202);
    if (tl && tl.raw.length >= 4) out.thumbLen = new DataView(tl.raw.buffer).getUint32(0, le);
    return out;
  }

  function entryNumbers(e, le) {
    const dv = new DataView(e.raw.buffer, e.raw.byteOffset, e.raw.byteLength);
    const out = [];
    const sz = TYPE_SIZE[e.type];
    for (let i = 0; i < e.count && (i + 1) * sz <= e.raw.length; i++) {
      const o = i * sz;
      switch (e.type) {
        case 1: case 7: out.push(dv.getUint8(o)); break;
        case 6: out.push(dv.getInt8(o)); break;
        case 3: out.push(dv.getUint16(o, le)); break;
        case 8: out.push(dv.getInt16(o, le)); break;
        case 4: case 13: out.push(dv.getUint32(o, le)); break;
        case 9: out.push(dv.getInt32(o, le)); break;
        case 5: { const d = dv.getUint32(o + 4, le); out.push(d ? dv.getUint32(o, le) / d : 0); break; }
        case 10: { const d = dv.getInt32(o + 4, le); out.push(d ? dv.getInt32(o, le) / d : 0); break; }
        case 11: out.push(dv.getFloat32(o, le)); break;
        case 12: out.push(dv.getFloat64(o, le)); break;
      }
      if (out.length > 64) break;
    }
    return out;
  }
  function round(n) { return Math.abs(n) >= 100 ? +n.toFixed(2) : +n.toFixed(4); }
  const ORIENT = { 1: 'Normal', 2: 'Mirrored', 3: 'Rotated 180°', 4: 'Mirrored, upside down', 5: 'Mirrored, rotated 90° clockwise', 6: 'Rotated 90° clockwise', 7: 'Mirrored, rotated 90° anticlockwise', 8: 'Rotated 90° anticlockwise' };

  function formatEntry(ifd, e, le) {
    const t = e.tag;
    if (e.type === 2) return cleanStr(decodeText(e.raw));
    if (ifd === 'ifd0' && t >= 0x9C9B && t <= 0x9C9F) {
      try { return cleanStr(new TextDecoder('utf-16le').decode(e.raw)); } catch (x) { /* fall through */ }
    }
    if (ifd === 'exif' && t === 0x9286 && e.raw.length >= 8) {
      const code = ascii(e.raw, 0, 8);
      const body = e.raw.subarray(8);
      if (code.startsWith('UNICODE')) { try { return cleanStr(new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(body)); } catch (x) { /* */ } }
      return cleanStr(decodeText(body)) || '(empty)';
    }
    if (t === 0x927C && ifd === 'exif') return bytesLabel(e.raw.length) + ' of private camera data';
    if (e.type === 7) {
      if (isPrintable(e.raw)) return cleanStr(LATIN1.decode(e.raw));
      if (e.raw.length <= 4) return Array.from(e.raw).join(' ');
      return bytesLabel(e.raw.length);
    }
    const nums = entryNumbers(e, le);
    if (ifd === 'ifd0' && t === 0x0112) return (ORIENT[nums[0]] || String(nums[0])) + ' (' + nums[0] + ')';
    if (ifd === 'exif' && t === 0x829A && nums[0] > 0 && nums[0] < 1) return '1/' + Math.round(1 / nums[0]) + ' s';
    if (ifd === 'exif' && t === 0x829D) return 'f/' + round(nums[0]);
    if (ifd === 'exif' && t === 0x920A) return round(nums[0]) + ' mm';
    if (ifd === 'gps' && (t === 0x02 || t === 0x04 || t === 0x14 || t === 0x16) && nums.length >= 3) {
      return Math.floor(nums[0]) + '° ' + Math.floor(nums[1]) + '′ ' + round(nums[2]) + '″';
    }
    if (ifd === 'gps' && t === 0x07 && nums.length >= 3) return nums.map(n => String(Math.floor(n)).padStart(2, '0')).join(':') + ' UTC';
    if (ifd === 'gps' && t === 0x06) return round(nums[0]) + ' m';
    if (ifd === 'gps' && t === 0x00) return nums.join('.');
    const shown = nums.slice(0, 16).map(round).join(', ');
    return e.count > 16 ? shown + ' … (' + e.count + ' values)' : shown;
  }

  function gpsFromTiff(t) {
    const get = tag => t.gps.find(e => e.tag === tag);
    const lat = get(0x02), lon = get(0x04);
    if (!lat || !lon) return null;
    const a = entryNumbers(lat, t.le), o = entryNumbers(lon, t.le);
    if (a.length < 3 || o.length < 3) return null;
    let la = a[0] + a[1] / 60 + a[2] / 3600, lo = o[0] + o[1] / 60 + o[2] / 3600;
    const lr = get(0x01), lor = get(0x03);
    if (lr && String.fromCharCode(lr.raw[0]) === 'S') la = -la;
    if (lor && String.fromCharCode(lor.raw[0]) === 'W') lo = -lo;
    if (!isFinite(la) || !isFinite(lo) || (la === 0 && lo === 0) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
    return { lat: la, lon: lo };
  }

  function orientationFromTiff(t) {
    const e = t.ifd0.find(x => x.tag === 0x0112);
    if (!e) return 1;
    return entryNumbers(e, t.le)[0] || 1;
  }

  function tiffFields(t, source, opts) {
    opts = opts || {};
    const out = [];
    for (const ifd of ['ifd0', 'exif', 'gps']) {
      for (const e of t[ifd]) {
        if (ifd !== 'gps' && POINTER_TAGS.has(e.tag)) continue;
        if (ifd === 'ifd0' && opts.imageFile && STRUCT_TAGS.has(e.tag)) continue;
        if (ifd === 'ifd0' && (e.tag === 0x0201 || e.tag === 0x0202)) continue;
        const def = TAGS[ifd][e.tag];
        const name = def ? def[0] : (ifd === 'gps' ? 'GPS tag ' : 'Tag ') + hex(e.tag);
        const cat = def ? def[1] : (ifd === 'gps' ? 'location' : guessCat(name));
        let value;
        try { value = formatEntry(ifd, e, t.le); } catch (x) { value = bytesLabel(e.raw.length); }
        out.push({
          id: 'exif:' + ifd + ':' + e.tag, name, value, cat, source,
          keepable: !!opts.keepable && !NOT_KEEPABLE.has(e.tag),
          exif: { ifd, entry: e }
        });
      }
    }
    if (t.ifd1.length) {
      out.push({ id: 'exif:ifd1', name: 'Embedded preview image', value: t.thumbLen ? 'A small copy of the picture (' + bytesLabel(t.thumbLen) + '). It can show the photo before it was cropped.' : 'Preview image data', cat: 'other', source, keepable: false });
    }
    if (t.interop.length) out.push({ id: 'exif:interop', name: 'Interoperability info', value: t.interop.length + ' entries', cat: 'tech', source, keepable: false });
    return out;
  }

  function buildTiff(le, groups) {
    const e0 = (groups.ifd0 || []).filter(e => !POINTER_TAGS.has(e.tag)).map(e => ({ ...e }));
    const eE = (groups.exif || []).filter(e => !POINTER_TAGS.has(e.tag)).map(e => ({ ...e }));
    const eG = (groups.gps || []).map(e => ({ ...e }));
    if (eE.length) e0.push({ tag: 0x8769, type: 4, count: 1, raw: new Uint8Array(4), ptr: 'exif' });
    if (eG.length) e0.push({ tag: 0x8825, type: 4, count: 1, raw: new Uint8Array(4), ptr: 'gps' });
    if (!e0.length) return null;
    for (const l of [e0, eE, eG]) l.sort((a, b) => a.tag - b.tag);
    const sizeIfd = list => {
      let data = 0;
      for (const e of list) if (e.raw.length > 4) data += e.raw.length + (e.raw.length & 1);
      return 2 + 12 * list.length + 4 + data;
    };
    const off0 = 8, offE = off0 + sizeIfd(e0), offG = offE + (eE.length ? sizeIfd(eE) : 0);
    const total = offG + (eG.length ? sizeIfd(eG) : 0);
    const buf = new Uint8Array(total);
    const dv = new DataView(buf.buffer);
    buf[0] = buf[1] = le ? 0x49 : 0x4D;
    dv.setUint16(2, 42, le);
    dv.setUint32(4, 8, le);
    const ptrs = { exif: offE, gps: offG };
    function writeIfd(list, off) {
      dv.setUint16(off, list.length, le);
      let dataPos = off + 2 + 12 * list.length + 4;
      list.forEach((e, i) => {
        const p = off + 2 + i * 12;
        dv.setUint16(p, e.tag, le);
        dv.setUint16(p + 2, e.type, le);
        dv.setUint32(p + 4, e.count, le);
        if (e.ptr) dv.setUint32(p + 8, ptrs[e.ptr], le);
        else if (e.raw.length <= 4) buf.set(e.raw, p + 8);
        else {
          dv.setUint32(p + 8, dataPos, le);
          buf.set(e.raw, dataPos);
          dataPos += e.raw.length + (e.raw.length & 1);
        }
      });
      dv.setUint32(off + 2 + 12 * list.length, 0, le);
    }
    writeIfd(e0, off0);
    if (eE.length) writeIfd(eE, offE);
    if (eG.length) writeIfd(eG, offG);
    return buf;
  }

  function orientationEntry(le, value) {
    const raw = new Uint8Array(2);
    new DataView(raw.buffer).setUint16(0, value, le);
    return { tag: 0x0112, type: 3, count: 1, raw };
  }

  // Given the fields of one EXIF block and the keep decision, returns new TIFF bytes or null.
  function rebuildExif(t, fields, keptIds) {
    if (!t) return null;
    const groups = { ifd0: [], exif: [], gps: [] };
    for (const f of fields) {
      if (!f.exif || !keptIds.has(f.id)) continue;
      groups[f.exif.ifd].push(f.exif.entry);
    }
    return buildTiff(t.le, groups);
  }

  /* ---------- XMP ---------- */

  const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
  const NS_PREFIX = {
    'http://purl.org/dc/elements/1.1/': 'dc', 'http://ns.adobe.com/xap/1.0/': 'xmp', 'http://ns.adobe.com/pdf/1.3/': 'pdf',
    'http://ns.adobe.com/xap/1.0/mm/': 'xmpMM', 'http://ns.adobe.com/xap/1.0/rights/': 'xmpRights',
    'http://ns.adobe.com/exif/1.0/': 'exif', 'http://ns.adobe.com/tiff/1.0/': 'tiff', 'http://ns.adobe.com/exif/1.0/aux/': 'aux',
    'http://ns.adobe.com/photoshop/1.0/': 'photoshop', 'http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/': 'Iptc4xmpCore',
    'http://iptc.org/std/Iptc4xmpExt/2008-02-29/': 'Iptc4xmpExt', 'http://cipa.jp/exif/1.0/': 'exifEX',
    'http://ns.adobe.com/camera-raw-settings/1.0/': 'crs', 'http://ns.adobe.com/xap/1.0/sType/ResourceEvent#': 'stEvt',
    'http://ns.adobe.com/xap/1.0/sType/ResourceRef#': 'stRef', 'http://ns.adobe.com/lightroom/1.0/': 'lr',
    'http://ns.google.com/photos/1.0/camera/': 'GCamera', 'http://ns.apple.com/adjustment-settings/1.0/': 'AdjustmentSettings',
    'http://ns.adobe.com/pdfx/1.3/': 'pdfx', 'http://www.aiim.org/pdfa/ns/id/': 'pdfaid'
  };
  const XMP_CAT = {
    'dc:creator': 'rights', 'dc:rights': 'rights', 'dc:title': 'content', 'dc:description': 'content', 'dc:subject': 'content',
    'dc:format': 'tech', 'xmp:CreatorTool': 'software', 'xmp:CreateDate': 'time', 'xmp:ModifyDate': 'time',
    'xmp:MetadataDate': 'time', 'pdf:Producer': 'software', 'pdf:Keywords': 'content', 'pdf:PDFVersion': 'tech',
    'xmpMM:DocumentID': 'serial', 'xmpMM:InstanceID': 'serial', 'xmpMM:OriginalDocumentID': 'serial',
    'xmpMM:History': 'software', 'xmpMM:DerivedFrom': 'other', 'tiff:Make': 'device', 'tiff:Model': 'device',
    'tiff:Orientation': 'tech', 'tiff:Artist': 'rights', 'tiff:Copyright': 'rights', 'aux:SerialNumber': 'serial',
    'aux:LensSerialNumber': 'serial', 'aux:Lens': 'device', 'aux:LensInfo': 'device', 'aux:OwnerName': 'people',
    'exifEX:BodySerialNumber': 'serial', 'exifEX:LensSerialNumber': 'serial', 'exifEX:CameraOwnerName': 'people',
    'exifEX:LensModel': 'device', 'exifEX:LensMake': 'device', 'exif:DateTimeOriginal': 'time', 'exif:DateTimeDigitized': 'time',
    'photoshop:City': 'location', 'photoshop:State': 'location', 'photoshop:Country': 'location', 'photoshop:DateCreated': 'time',
    'photoshop:AuthorsPosition': 'people', 'photoshop:CaptionWriter': 'people', 'photoshop:Credit': 'rights',
    'photoshop:Source': 'rights', 'photoshop:Headline': 'content', 'Iptc4xmpCore:Location': 'location',
    'Iptc4xmpCore:CountryCode': 'location', 'Iptc4xmpCore:CreatorContactInfo': 'people', 'pdfaid:part': 'tech', 'pdfaid:conformance': 'tech'
  };
  const XMP_NAME = {
    'dc:creator': 'Creator', 'dc:rights': 'Rights', 'dc:title': 'Title', 'dc:description': 'Description', 'dc:subject': 'Keywords',
    'xmp:CreatorTool': 'Created with', 'xmp:CreateDate': 'Created', 'xmp:ModifyDate': 'Modified', 'xmp:MetadataDate': 'Metadata date',
    'pdf:Producer': 'Produced by', 'pdf:Keywords': 'Keywords', 'xmpMM:DocumentID': 'Document ID', 'xmpMM:InstanceID': 'Instance ID',
    'xmpMM:OriginalDocumentID': 'Original document ID', 'xmpMM:History': 'Edit history', 'photoshop:City': 'City',
    'photoshop:State': 'State or province', 'photoshop:Country': 'Country', 'photoshop:DateCreated': 'Date created',
    'photoshop:Credit': 'Credit', 'aux:SerialNumber': 'Serial number', 'aux:Lens': 'Lens', 'aux:OwnerName': 'Owner name',
    'tiff:Make': 'Make', 'tiff:Model': 'Model', 'exif:DateTimeOriginal': 'Date taken', 'exif:GPSLatitude': 'Latitude', 'exif:GPSLongitude': 'Longitude'
  };
  function xmpCat(prefix, local) {
    const key = prefix + ':' + local;
    if (XMP_CAT[key]) return XMP_CAT[key];
    if (/^xmpRights:/.test(key)) return 'rights';
    if (/^exif:GPS/.test(key)) return 'location';
    if (/^(crs|lr|AdjustmentSettings):/.test(key)) return 'other';
    if (/^exif:|^exifEX:/.test(key)) {
      const c = NAME_CAT[local.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()];
      if (c) return c;
      if (/Exposure|FNumber|ISO|Focal|Flash|Aperture|Shutter|Metering|WhiteBalance|Light|Scene|Contrast|Saturation|Sharpness/.test(local)) return 'camera';
    }
    return guessCat(local);
  }

  function flattenXmp(xml, source, idPrefix) {
    idPrefix = idPrefix || 'xmp';
    const fields = [];
    const text = String(xml).replace(/^[\s\S]*?(<x:xmpmeta|<rdf:RDF|<x:xapmeta)/, '$1').replace(/<\?xpacket[\s\S]*?\?>/g, '').replace(/\u0000/g, '').trim();
    let doc;
    try { doc = new DOMParser().parseFromString(text, 'application/xml'); } catch (e) { doc = null; }
    if (!doc || doc.getElementsByTagName('parsererror').length) {
      return [{ id: idPrefix + ':packet', name: 'XMP packet', value: 'Unreadable XMP data (' + text.length + ' characters)', cat: 'other', source, keepable: false }];
    }
    const seen = {};
    const add = (ns, local, prefixGuess, values, container, complex) => {
      const prefix = NS_PREFIX[ns] || prefixGuess || 'ns';
      let id = idPrefix + ':' + ns + '|' + local;
      if (seen[id]) { seen[id]++; id += '#' + seen[id]; } else seen[id] = 1;
      const value = values.filter(v => v !== '').join(', ') || '(empty)';
      fields.push({
        id, name: XMP_NAME[prefix + ':' + local] || prefix + ':' + local, value, cat: xmpCat(prefix, local), source, keepable: !complex,
        xmp: complex ? null : { ns, prefix, local, values, container }
      });
    };
    const descs = Array.from(doc.getElementsByTagNameNS(RDF, 'Description'));
    for (const d of descs) {
      if (!d.parentNode || d.parentNode.namespaceURI !== RDF || d.parentNode.localName !== 'RDF') continue;
      for (const a of Array.from(d.attributes)) {
        if (a.name.startsWith('xmlns') || a.namespaceURI === RDF || a.namespaceURI === 'http://www.w3.org/XML/1998/namespace') continue;
        add(a.namespaceURI || '', a.localName, a.prefix, [a.value], null, false);
      }
      for (const el of Array.from(d.children)) {
        const first = el.firstElementChild;
        if (first && first.namespaceURI === RDF && ['Seq', 'Bag', 'Alt'].includes(first.localName)) {
          const lis = Array.from(first.children).filter(li => li.localName === 'li');
          const complex = lis.some(li => li.firstElementChild || Array.from(li.attributes).some(a => !a.name.startsWith('xml') && a.namespaceURI !== RDF));
          const values = lis.map(li => complex ? flatText(li) : li.textContent.trim());
          add(el.namespaceURI || '', el.localName, el.prefix, values, first.localName, complex);
        } else if (first || Array.from(el.attributes).some(a => !a.name.startsWith('xml') && a.namespaceURI !== RDF)) {
          add(el.namespaceURI || '', el.localName, el.prefix, [flatText(el)], null, true);
        } else if (el.getAttributeNS(RDF, 'resource')) {
          add(el.namespaceURI || '', el.localName, el.prefix, [el.getAttributeNS(RDF, 'resource')], null, true);
        } else {
          add(el.namespaceURI || '', el.localName, el.prefix, [el.textContent.trim()], null, false);
        }
      }
    }
    return fields;
  }
  function flatText(el) {
    const parts = [];
    for (const a of Array.from(el.attributes || [])) if (!a.name.startsWith('xmlns') && a.namespaceURI !== RDF) parts.push(a.localName + '=' + a.value);
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 3 && c.textContent.trim()) parts.push(c.textContent.trim());
      else if (c.nodeType === 1) { const t = flatText(c); if (t) parts.push(c.namespaceURI === RDF ? t : c.localName + ': ' + t); }
    }
    return parts.join('; ');
  }
  function escXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function buildXmp(fields) {
    const kept = fields.filter(f => f.xmp);
    if (!kept.length) return null;
    const prefixes = {};
    let n = 0;
    for (const f of kept) {
      if (!prefixes[f.xmp.ns]) {
        let p = NS_PREFIX[f.xmp.ns] || f.xmp.prefix || 'ns' + (++n);
        if (Object.values(prefixes).includes(p) || p === 'rdf' || p === 'x') p = 'ns' + (++n);
        prefixes[f.xmp.ns] = p;
      }
    }
    const nsAttrs = Object.entries(prefixes).map(([ns, p]) => ' xmlns:' + p + '="' + escXml(ns) + '"').join('');
    const props = kept.map(f => {
      const tag = prefixes[f.xmp.ns] + ':' + f.xmp.local;
      if (f.xmp.container) {
        const lis = f.xmp.values.map(v => '<rdf:li' + (f.xmp.container === 'Alt' ? ' xml:lang="x-default"' : '') + '>' + escXml(v) + '</rdf:li>').join('');
        return '<' + tag + '><rdf:' + f.xmp.container + '>' + lis + '</rdf:' + f.xmp.container + '></' + tag + '>';
      }
      return '<' + tag + '>' + escXml(f.xmp.values[0] || '') + '</' + tag + '>';
    }).join('');
    return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="' + RDF +
      '"><rdf:Description rdf:about=""' + nsAttrs + '>' + props + '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  }

  /* ---------- IPTC (Photoshop APP13) ---------- */

  const IPTC_NAMES = {
    5: ['Object name', 'content'], 7: ['Edit status', 'other'], 10: ['Urgency', 'other'], 15: ['Category', 'content'],
    20: ['Supplemental categories', 'content'], 25: ['Keywords', 'content'], 40: ['Special instructions', 'content'],
    55: ['Date created', 'time'], 60: ['Time created', 'time'], 62: ['Digital creation date', 'time'],
    63: ['Digital creation time', 'time'], 65: ['Originating program', 'software'], 70: ['Program version', 'software'],
    80: ['By-line (author)', 'rights'], 85: ['By-line title', 'people'], 90: ['City', 'location'], 92: ['Sub-location', 'location'],
    95: ['Province or state', 'location'], 100: ['Country code', 'location'], 101: ['Country', 'location'],
    103: ['Transmission reference', 'other'], 105: ['Headline', 'content'], 110: ['Credit', 'rights'], 115: ['Source', 'rights'],
    116: ['Copyright notice', 'rights'], 118: ['Contact', 'people'], 120: ['Caption', 'content'], 122: ['Caption writer', 'people']
  };
  function parsePhotoshop(data, source) {
    // data starts after "Photoshop 3.0\0"
    const fields = [];
    let p = 0, resources = 0;
    while (p + 12 <= data.length && startsWith(data, p, '8BIM')) {
      const id = (data[p + 4] << 8) | data[p + 5];
      let q = p + 6;
      const nameLen = data[q];
      q += 1 + nameLen;
      if ((1 + nameLen) & 1) q++;
      if (q + 4 > data.length) break;
      const size = ((data[q] << 24) | (data[q + 1] << 16) | (data[q + 2] << 8) | data[q + 3]) >>> 0;
      q += 4;
      const body = data.subarray(q, Math.min(data.length, q + size));
      resources++;
      if (id === 0x0404) fields.push(...parseIptc(body, source));
      else if (id === 0x040C || id === 0x0409) fields.push({ id: 'iptc:thumb', name: 'Photoshop preview image', value: bytesLabel(size), cat: 'other', source, keepable: false });
      p = q + size + (size & 1);
    }
    if (!fields.length) fields.push({ id: 'iptc:ps', name: 'Photoshop data', value: resources + ' blocks', cat: 'other', source, keepable: false });
    return fields;
  }
  function parseIptc(b, source) {
    const fields = [];
    const seen = {};
    let p = 0;
    while (p + 5 <= b.length) {
      if (b[p] !== 0x1C) { p++; continue; }
      const rec = b[p + 1], ds = b[p + 2];
      let len = (b[p + 3] << 8) | b[p + 4];
      p += 5;
      if (len & 0x8000) break;
      const v = b.subarray(p, p + len);
      p += len;
      if (rec !== 2 || ds === 0) continue;
      const def = IPTC_NAMES[ds] || ['IPTC 2:' + ds, 'other'];
      let id = 'iptc:2:' + ds;
      if (seen[id]) { seen[id]++; id += '#' + seen[id]; } else seen[id] = 1;
      fields.push({ id, name: def[0], value: cleanStr(decodeText(v)), cat: def[1], source, keepable: false });
    }
    return fields;
  }

  /* ---------- JPEG ---------- */

  const XMP_HDR = 'http://ns.adobe.com/xap/1.0/\u0000';
  const XMP_EXT_HDR = 'http://ns.adobe.com/xmp/extension/\u0000';

  function parseJpeg(b) {
    if (b[0] !== 0xFF || b[1] !== 0xD8) throw new Error('This is not a JPEG file');
    const segs = [];
    let p = 2, eoi = -1;
    while (p < b.length) {
      if (b[p] !== 0xFF) throw new Error('The JPEG structure is damaged');
      while (p < b.length && b[p] === 0xFF) p++;
      if (p >= b.length) break;
      const m = b[p];
      const start = p - 1;
      p++;
      if (m === 0xD9) { eoi = p; break; }
      if ((m >= 0xD0 && m <= 0xD7) || m === 0x01) { segs.push({ marker: m, start, end: p, dataStart: p }); continue; }
      if (p + 2 > b.length) throw new Error('The JPEG ends early');
      const len = (b[p] << 8) | b[p + 1];
      if (len < 2 || p + len > b.length) throw new Error('The JPEG structure is damaged');
      const seg = { marker: m, start, end: p + len, dataStart: p + 2 };
      segs.push(seg);
      p += len;
      if (m === 0xDA) {
        while (p < b.length) {
          if (b[p] === 0xFF && p + 1 < b.length) {
            const n = b[p + 1];
            if (n === 0x00 || (n >= 0xD0 && n <= 0xD7)) { p += 2; continue; }
            if (n === 0xFF) { p++; continue; }
            break;
          }
          p++;
        }
        seg.end = p;
      }
    }
    for (const s of segs) classifyJpegSeg(b, s);
    return { segs, eoi, trailer: eoi >= 0 ? b.length - eoi : 0, truncated: eoi < 0 };
  }
  function classifyJpegSeg(b, s) {
    const d = s.dataStart, m = s.marker;
    s.kind = 'image';
    s.keep = true;
    if (m === 0xE0) { s.kind = startsWith(b, d, 'JFIF\u0000') ? 'jfif' : startsWith(b, d, 'JFXX\u0000') ? 'jfxx' : 'app'; s.keep = s.kind === 'jfif'; }
    else if (m === 0xE1) {
      s.kind = startsWith(b, d, 'Exif\u0000') ? 'exif' : startsWith(b, d, XMP_HDR) ? 'xmp' : startsWith(b, d, XMP_EXT_HDR) ? 'xmpext' : 'app';
      s.keep = false;
    } else if (m === 0xE2) { s.kind = startsWith(b, d, 'ICC_PROFILE\u0000') ? 'icc' : startsWith(b, d, 'MPF\u0000') ? 'mpf' : 'app'; s.keep = s.kind === 'icc'; }
    else if (m === 0xED) { s.kind = startsWith(b, d, 'Photoshop 3.0\u0000') ? 'photoshop' : 'app'; s.keep = false; }
    else if (m === 0xEE) { s.kind = startsWith(b, d, 'Adobe') ? 'adobe' : 'app'; s.keep = s.kind === 'adobe'; }
    else if (m >= 0xE3 && m <= 0xEF) { s.kind = 'app'; s.keep = false; }
    else if (m === 0xFE) { s.kind = 'com'; s.keep = false; }
  }
  const APP_NAMES = { 'Ducky': 'Photoshop "Save for web" data', 'Meta': 'Camera data', 'FPXR': 'FlashPix data' };

  async function inspectJpeg(b, source) {
    source = source || 'EXIF';
    const j = parseJpeg(b);
    const fields = [];
    let tiff = null, gps = null, orientation = 1, iccCount = 0, appN = 0, comN = 0;
    const notes = [];
    for (const s of j.segs) {
      const data = b.subarray(s.dataStart, s.end);
      if (s.kind === 'exif') {
        if (tiff) { fields.push({ id: 'jpeg:exif2:' + (++appN), name: 'Additional EXIF block', value: bytesLabel(data.length), cat: 'other', source: 'EXIF', keepable: false }); continue; }
        try {
          tiff = parseTiff(data.subarray(6));
          fields.push(...tiffFields(tiff, 'EXIF', { keepable: true }));
          gps = gpsFromTiff(tiff);
          orientation = orientationFromTiff(tiff);
        } catch (e) {
          fields.push({ id: 'jpeg:exifbad', name: 'EXIF block', value: 'Unreadable EXIF data (' + bytesLabel(data.length) + ')', cat: 'other', source: 'EXIF', keepable: false });
        }
      } else if (s.kind === 'xmp') {
        fields.push(...flattenXmp(UTF8.decode(data.subarray(XMP_HDR.length)), 'XMP'));
      } else if (s.kind === 'xmpext') {
        fields.push({ id: 'jpeg:xmpext:' + (++appN), name: 'Extended XMP data', value: bytesLabel(data.length), cat: 'other', source: 'XMP', keepable: false });
      } else if (s.kind === 'photoshop') {
        fields.push(...parsePhotoshop(data.subarray(14), 'IPTC'));
      } else if (s.kind === 'icc') {
        iccCount++;
      } else if (s.kind === 'com') {
        comN++;
        fields.push({ id: 'jpeg:com:' + comN, name: 'Comment', value: cleanStr(decodeText(data)) || '(empty)', cat: 'content', source: 'JPEG comment', keepable: false });
      } else if (s.kind === 'mpf') {
        fields.push({ id: 'jpeg:mpf', name: 'Multi-picture index', value: 'Points to extra pictures stored after the main one', cat: 'other', source: 'JPEG', keepable: false });
      } else if (s.kind === 'jfxx') {
        fields.push({ id: 'jpeg:jfxx', name: 'JFIF preview image', value: bytesLabel(data.length), cat: 'other', source: 'JPEG', keepable: false });
      } else if (s.kind === 'app') {
        appN++;
        const idStr = ascii(data, 0, 12).replace(/[^\x20-\x7E].*$/, '');
        fields.push({ id: 'jpeg:app:' + s.marker + ':' + appN, name: 'APP' + (s.marker - 0xE0) + ' block' + (idStr ? ' (' + idStr + ')' : ''), value: (APP_NAMES[idStr] || 'Application data') + ', ' + bytesLabel(data.length), cat: 'other', source: 'JPEG', keepable: false });
      } else if (s.kind === 'jfif' && data.length >= 14 && (data[12] || data[13])) {
        fields.push({ id: 'jpeg:jfifthumb', name: 'JFIF preview image', value: data[12] + ' × ' + data[13] + ' pixels', cat: 'other', source: 'JPEG', keepable: false });
      }
    }
    if (iccCount) fields.push({ id: 'icc', name: 'Colour profile', value: 'ICC profile, kept so colours look right', cat: 'tech', source: 'ICC', keepable: false, fixed: true });
    if (j.trailer > 0) fields.push({ id: 'jpeg:trailer', name: 'Extra data after the picture', value: bytesLabel(j.trailer) + '. Often a motion-photo video, a depth map or a second copy of the picture.', cat: 'other', source: 'JPEG', keepable: false });
    if (j.truncated) notes.push('This JPEG seems to be cut short. It was cleaned as it is.');
    return { format: 'jpeg', fields, gps, orientation, tiff, notes, _jpeg: j };
  }

  function app1(payload) {
    if (payload.length + 2 > 0xFFFF) throw new Error('The kept details are too large to write back');
    const h = new Uint8Array(4);
    h[0] = 0xFF; h[1] = 0xE1; h[2] = (payload.length + 2) >> 8; h[3] = (payload.length + 2) & 0xFF;
    return concat([h, payload]);
  }

  async function cleanJpeg(b, decide, opts) {
    const rep = await inspectJpeg(b);
    const keptIds = decideKeep(rep, decide, opts);
    const tiffOut = rebuildExif(rep.tiff, rep.fields, keptIds, rep, opts);
    const xmpOut = buildXmp(rep.fields.filter(f => keptIds.has(f.id)));
    const j = rep._jpeg;
    const parts = [new Uint8Array([0xFF, 0xD8])];
    let inserted = false;
    const insert = () => {
      if (inserted) return;
      inserted = true;
      if (tiffOut) parts.push(app1(concat([TE.encode('Exif\u0000\u0000'), tiffOut])));
      if (xmpOut) parts.push(app1(concat([TE.encode(XMP_HDR), TE.encode(xmpOut)])));
    };
    for (const s of j.segs) {
      if (s.kind === 'jfif') {
        const data = b.subarray(s.dataStart, s.end);
        if (data.length > 14 || data[12] || data[13]) {
          const nd = data.slice(0, 14);
          nd[12] = 0; nd[13] = 0;
          parts.push(new Uint8Array([0xFF, 0xE0, 0, 16]), nd);
        } else parts.push(b.subarray(s.start, s.end));
        insert();
        continue;
      }
      insert();
      if (s.keep) parts.push(b.subarray(s.start, s.end));
    }
    insert();
    if (j.eoi >= 0) parts.push(new Uint8Array([0xFF, 0xD9]));
    return { bytes: concat(parts), keptIds };
  }

  // The keep decision for photos: the caller's choice, plus rotation and the colour profile.
  function decideKeep(rep, decide, opts) {
    const kept = new Set();
    for (const f of rep.fields) {
      if (f.fixed) { kept.add(f.id); continue; }
      if (f.keepable && decide(f)) kept.add(f.id);
    }
    if (opts && opts.keepRotation && rep.orientation && rep.orientation !== 1) kept.add('exif:ifd0:274');
    return kept;
  }

  /* ---------- PNG ---------- */

  const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'mDCV', 'mDCv', 'cLLI', 'cLLi', 'bKGD', 'hIST', 'pHYs', 'sPLT', 'acTL', 'fcTL', 'fdAT']);
  const PNG_TEXT = new Set(['tEXt', 'zTXt', 'iTXt']);
  const PNG_KW_CAT = { title: 'content', author: 'rights', description: 'content', copyright: 'rights', 'creation time': 'time', software: 'software', disclaimer: 'other', warning: 'other', source: 'device', comment: 'content' };

  function parsePng(b) {
    for (let i = 0; i < 8; i++) if (b[i] !== PNG_SIG[i]) throw new Error('This is not a PNG file');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const chunks = [];
    let p = 8, end = -1;
    while (p + 12 <= b.length) {
      const len = dv.getUint32(p);
      const type = ascii(b, p + 4, 4);
      if (p + 12 + len > b.length) throw new Error('The PNG structure is damaged');
      chunks.push({ type, start: p, end: p + 12 + len, data: b.subarray(p + 8, p + 8 + len) });
      p += 12 + len;
      if (type === 'IEND') { end = p; break; }
    }
    if (end < 0) throw new Error('The PNG ends early');
    return { chunks, trailer: b.length - end };
  }

  async function pngTextChunk(c) {
    const d = c.data;
    const z = d.indexOf(0);
    const keyword = LATIN1.decode(d.subarray(0, z < 0 ? d.length : z));
    let text = '';
    try {
      if (c.type === 'tEXt') text = LATIN1.decode(d.subarray(z + 1));
      else if (c.type === 'zTXt') text = LATIN1.decode(await inflate(d.subarray(z + 2)));
      else {
        const flag = d[z + 1];
        let q = z + 3;
        const l1 = d.indexOf(0, q); q = l1 + 1;
        const l2 = d.indexOf(0, q); q = l2 + 1;
        const body = d.subarray(q);
        text = UTF8.decode(flag ? await inflate(body) : body);
      }
    } catch (e) { text = '(compressed text that could not be read)'; }
    return { keyword, text };
  }

  async function inspectPng(b) {
    const png = parsePng(b);
    const fields = [];
    let tiff = null, gps = null, orientation = 1;
    const kwCount = {};
    for (const c of png.chunks) {
      if (PNG_TEXT.has(c.type)) {
        const { keyword, text } = await pngTextChunk(c);
        c.keyword = keyword;
        if (keyword === 'XML:com.adobe.xmp') { c.xmp = true; fields.push(...flattenXmp(text, 'XMP')); continue; }
        const k = c.type + ':' + keyword;
        kwCount[k] = (kwCount[k] || 0) + 1;
        const id = 'png:text:' + k + '#' + kwCount[k];
        c.fieldId = id;
        const raw = /^Raw profile type/i.test(keyword);
        fields.push({
          id, name: keyword || '(no name)', value: raw ? 'Metadata stored as text (' + bytesLabel(text.length) + '). It can include location and camera details.' : cleanStr(text) || '(empty)',
          cat: raw ? 'other' : (PNG_KW_CAT[keyword.toLowerCase()] || guessCat(keyword)), source: 'PNG text', keepable: !raw
        });
      } else if (c.type === 'eXIf') {
        try {
          tiff = parseTiff(c.data);
          fields.push(...tiffFields(tiff, 'EXIF', { keepable: true }));
          gps = gpsFromTiff(tiff);
          orientation = orientationFromTiff(tiff);
        } catch (e) {
          fields.push({ id: 'png:exifbad', name: 'EXIF block', value: 'Unreadable EXIF data', cat: 'other', source: 'EXIF', keepable: false });
        }
      } else if (c.type === 'tIME') {
        const d = c.data;
        const v = d.length >= 7 ? ((d[0] << 8) | d[1]) + '-' + String(d[2]).padStart(2, '0') + '-' + String(d[3]).padStart(2, '0') + ' ' + [d[4], d[5], d[6]].map(n => String(n).padStart(2, '0')).join(':') : '';
        fields.push({ id: 'png:tIME', name: 'Last modified', value: v, cat: 'time', source: 'PNG', keepable: false });
      } else if (c.type === 'iCCP') {
        fields.push({ id: 'icc', name: 'Colour profile', value: 'ICC profile, kept so colours look right', cat: 'tech', source: 'ICC', keepable: false, fixed: true });
      } else if (!PNG_KEEP.has(c.type)) {
        fields.push({ id: 'png:chunk:' + c.type, name: 'Private block "' + c.type + '"', value: bytesLabel(c.data.length) + ' of application data', cat: 'other', source: 'PNG', keepable: false });
      }
    }
    if (png.trailer > 0) fields.push({ id: 'png:trailer', name: 'Extra data after the picture', value: bytesLabel(png.trailer), cat: 'other', source: 'PNG', keepable: false });
    return { format: 'png', fields, gps, orientation, tiff, notes: [], _png: png };
  }

  function pngChunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  async function cleanPng(b, decide, opts) {
    const rep = await inspectPng(b);
    const keptIds = decideKeep(rep, decide, opts);
    const tiffOut = rebuildExif(rep.tiff, rep.fields, keptIds);
    const xmpOut = buildXmp(rep.fields.filter(f => keptIds.has(f.id)));
    const parts = [new Uint8Array(PNG_SIG)];
    let exifDone = false;
    for (const c of rep._png.chunks) {
      if (c.type === 'IDAT' && !exifDone) {
        exifDone = true;
        if (tiffOut) parts.push(pngChunk('eXIf', tiffOut));
        if (xmpOut) parts.push(pngChunk('iTXt', concat([TE.encode('XML:com.adobe.xmp'), new Uint8Array([0, 0, 0, 0, 0]), TE.encode(xmpOut)])));
      }
      if (PNG_KEEP.has(c.type)) { parts.push(b.subarray(c.start, c.end)); continue; }
      if (PNG_TEXT.has(c.type) && !c.xmp && keptIds.has(c.fieldId)) parts.push(b.subarray(c.start, c.end));
    }
    return { bytes: concat(parts), keptIds };
  }

  /* ---------- WebP ---------- */

  function parseWebp(b) {
    if (!startsWith(b, 0, 'RIFF') || !startsWith(b, 8, 'WEBP')) throw new Error('This is not a WebP file');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const riffEnd = Math.min(b.length, 8 + dv.getUint32(4, true));
    const chunks = [];
    let p = 12;
    while (p + 8 <= riffEnd) {
      const type = ascii(b, p, 4);
      const len = dv.getUint32(p + 4, true);
      const end = p + 8 + len + (len & 1);
      if (p + 8 + len > b.length) throw new Error('The WebP structure is damaged');
      chunks.push({ type, start: p, end: Math.min(end, b.length), data: b.subarray(p + 8, p + 8 + len) });
      p = end;
    }
    return { chunks, trailer: b.length - riffEnd };
  }
  const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ICCP', 'ANIM', 'ANMF', 'ALPH']);

  async function inspectWebp(b) {
    const w = parseWebp(b);
    const fields = [];
    let tiff = null, gps = null, orientation = 1;
    for (const c of w.chunks) {
      if (c.type === 'EXIF') {
        try {
          const d = startsWith(c.data, 0, 'Exif\u0000\u0000') ? c.data.subarray(6) : c.data;
          tiff = parseTiff(d);
          fields.push(...tiffFields(tiff, 'EXIF', { keepable: true }));
          gps = gpsFromTiff(tiff);
          orientation = orientationFromTiff(tiff);
        } catch (e) {
          fields.push({ id: 'webp:exifbad', name: 'EXIF block', value: 'Unreadable EXIF data', cat: 'other', source: 'EXIF', keepable: false });
        }
      } else if (c.type === 'XMP ') {
        fields.push(...flattenXmp(UTF8.decode(c.data), 'XMP'));
      } else if (c.type === 'ICCP') {
        fields.push({ id: 'icc', name: 'Colour profile', value: 'ICC profile, kept so colours look right', cat: 'tech', source: 'ICC', keepable: false, fixed: true });
      } else if (!WEBP_KEEP.has(c.type)) {
        fields.push({ id: 'webp:chunk:' + c.type.trim(), name: 'Private block "' + c.type.trim() + '"', value: bytesLabel(c.data.length), cat: 'other', source: 'WebP', keepable: false });
      }
    }
    if (w.trailer > 0) fields.push({ id: 'webp:trailer', name: 'Extra data after the picture', value: bytesLabel(w.trailer), cat: 'other', source: 'WebP', keepable: false });
    return { format: 'webp', fields, gps, orientation, tiff, notes: [], _webp: w };
  }

  function riffChunk(type, data) {
    const out = new Uint8Array(8 + data.length + (data.length & 1));
    for (let i = 0; i < 4; i++) out[i] = type.charCodeAt(i);
    new DataView(out.buffer).setUint32(4, data.length, true);
    out.set(data, 8);
    return out;
  }

  async function cleanWebp(b, decide, opts) {
    const rep = await inspectWebp(b);
    const keptIds = decideKeep(rep, decide, opts);
    const tiffOut = rebuildExif(rep.tiff, rep.fields, keptIds);
    const xmpOut = buildXmp(rep.fields.filter(f => keptIds.has(f.id)));
    const parts = [];
    let hasVp8x = false;
    for (const c of rep._webp.chunks) {
      if (!WEBP_KEEP.has(c.type)) continue;
      if (c.type === 'VP8X') {
        hasVp8x = true;
        const d = c.data.slice();
        d[0] &= ~(0x08 | 0x04);
        if (tiffOut) d[0] |= 0x08;
        if (xmpOut) d[0] |= 0x04;
        parts.push(riffChunk('VP8X', d));
        continue;
      }
      parts.push(b.subarray(c.start, c.end));
    }
    if ((tiffOut || xmpOut) && hasVp8x) {
      if (tiffOut) parts.push(riffChunk('EXIF', tiffOut));
      if (xmpOut) parts.push(riffChunk('XMP ', TE.encode(xmpOut)));
    } else if ((tiffOut || xmpOut) && !hasVp8x) {
      // A simple WebP has no VP8X header to announce EXIF, so kept fields cannot be written.
      for (const id of Array.from(keptIds)) if (id.startsWith('exif:') || id.startsWith('xmp:')) keptIds.delete(id);
      rep.notes.push('This WebP is a simple one that cannot carry kept details, so they were removed too.');
    }
    const body = concat(parts);
    const head = new Uint8Array(12);
    head.set(TE.encode('RIFF'), 0);
    new DataView(head.buffer).setUint32(4, body.length + 4, true);
    head.set(TE.encode('WEBP'), 8);
    return { bytes: concat([head, body]), keptIds, notes: rep.notes };
  }

  /* ---------- TIFF, BMP, HEIC (read only) ---------- */

  async function inspectTiffFile(b) {
    const t = parseTiff(b);
    const fields = tiffFields(t, 'EXIF', { keepable: false, imageFile: true });
    // XMP, IPTC and ICC stored as TIFF tags replace their raw entries.
    const drop = id => { const i = fields.findIndex(f => f.id === id); if (i >= 0) fields.splice(i, 1); };
    for (const e of t.ifd0) {
      if (e.tag === 0x02BC) { drop('exif:ifd0:700'); fields.push(...flattenXmp(UTF8.decode(e.raw), 'XMP').map(f => ({ ...f, keepable: false }))); }
      if (e.tag === 0x83BB) { drop('exif:ifd0:33723'); fields.push(...parseIptc(e.raw, 'IPTC')); }
      if (e.tag === 0x8773) { drop('exif:ifd0:34675'); fields.push({ id: 'icc', name: 'Colour profile', value: 'ICC profile', cat: 'tech', source: 'ICC', keepable: false }); }
    }
    return { format: 'tiff', fields, gps: gpsFromTiff(t), orientation: orientationFromTiff(t), tiff: t, notes: [] };
  }

  const EXIFR_URL = 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.js';

  // Walks the top-level ISOBMFF boxes. A HEIC photo must have a sane layout and a meta box.
  function heicLooksValid(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let p = 0, meta = false, n = 0;
    while (p + 8 <= b.length && n++ < 1000) {
      let size = dv.getUint32(p);
      const type = ascii(b, p + 4, 4);
      if (size === 1) {
        if (p + 16 > b.length) return false;
        size = dv.getUint32(p + 8) * 4294967296 + dv.getUint32(p + 12);
      } else if (size === 0) size = b.length - p;
      if (size < 8 || p + size > b.length) return false;
      if (type === 'meta') meta = true;
      p += size;
    }
    return meta;
  }

  // exifr runs in a worker so a damaged file cannot freeze the page.
  function exifrInWorker(bytes, timeoutMs) {
    return new Promise((resolve, reject) => {
      const src = 'importScripts(' + JSON.stringify(EXIFR_URL) + ');' +
        'onmessage=async function(e){try{var d=await exifr.parse(e.data,{tiff:true,ifd0:true,exif:true,gps:true,xmp:true,iptc:true,icc:false,mergeOutput:true});postMessage({ok:true,d:d||null});}catch(err){postMessage({ok:false,m:String(err&&err.message||err)});}};';
      let w;
      try { w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))); } catch (e) { reject(e); return; }
      const timer = setTimeout(() => { w.terminate(); reject(new Error('Reading this HEIC photo took too long')); }, timeoutMs || 15000);
      w.onmessage = ev => { clearTimeout(timer); w.terminate(); ev.data.ok ? resolve(ev.data.d) : reject(new Error(ev.data.m)); };
      w.onerror = ev => { clearTimeout(timer); w.terminate(); reject(new Error(ev.message || 'HEIC reader failed')); };
      w.postMessage(bytes.slice());
    });
  }

  async function inspectHeic(b) {
    const fields = [];
    let gps = null;
    if (!heicLooksValid(b)) return { format: 'heic', fields, gps, orientation: 1, notes: ['This file does not look like a complete HEIC photo, so its details could not be read.'], invalid: true };
    try {
      const data = await exifrInWorker(b, 15000);
      if (data) {
        for (const [k, v] of Object.entries(data)) {
          if (v === undefined || v === null || k === 'latitude' || k === 'longitude') continue;
          const value = v instanceof Date ? v.toISOString() : (typeof v === 'object' ? JSON.stringify(v) : String(v));
          const cat = NAME_CAT[k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()] || (/^GPS/.test(k) ? 'location' : guessCat(k));
          fields.push({ id: 'heic:' + k, name: k, value: value.slice(0, 2000), cat, source: 'EXIF', keepable: false });
        }
        if (typeof data.latitude === 'number' && typeof data.longitude === 'number') gps = { lat: data.latitude, lon: data.longitude };
      }
    } catch (e) {
      return { format: 'heic', fields, gps, orientation: 1, notes: ['The details inside this HEIC photo could not be read.'] };
    }
    return { format: 'heic', fields, gps, orientation: 1, notes: [] };
  }

  /* ---------- PDF ---------- */

  const PDF_INFO_CAT = { Title: 'content', Author: 'rights', Subject: 'content', Keywords: 'content', Creator: 'software', Producer: 'software', CreationDate: 'time', ModDate: 'time', Trapped: 'tech' };
  const PDF_INFO_NAME = { Title: 'Title', Author: 'Author', Subject: 'Subject', Keywords: 'Keywords', Creator: 'Created with', Producer: 'Produced by', CreationDate: 'Created', ModDate: 'Modified', Trapped: 'Trapped' };
  const MARKUP_ANNOTS = new Set(['Text', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'FileAttachment', 'Sound', 'Redact']);

  function pdfVal(v) {
    const L = window.PDFLib;
    if (!v) return '';
    if (v instanceof L.PDFString || v instanceof L.PDFHexString) { try { return v.decodeText(); } catch (e) { return v.asString ? v.asString() : String(v); } }
    if (v instanceof L.PDFName) return v.decodeText();
    return String(v);
  }
  function pdfDate(s) {
    const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(.*)$/.exec(s);
    if (!m) return s;
    return m[1] + '-' + (m[2] || '01') + '-' + (m[3] || '01') + (m[4] ? ' ' + m[4] + ':' + (m[5] || '00') + (m[6] ? ':' + m[6] : '') : '') + (m[7] ? ' ' + m[7].replace(/'/g, '').replace(/^Z.*$/, 'UTC') : '');
  }
  function pdfName(n) { return window.PDFLib.PDFName.of(n); }
  function dictOf(obj) {
    const L = window.PDFLib;
    if (obj instanceof L.PDFDict) return obj;
    if (obj instanceof L.PDFStream) return obj.dict;
    return null;
  }
  function nameIs(v, n) { return v instanceof window.PDFLib.PDFName && v.decodeText() === n; }
  function isDctStream(obj) {
    const L = window.PDFLib;
    if (!(obj instanceof L.PDFRawStream)) return false;
    const f = obj.dict.get(pdfName('Filter'));
    if (nameIs(f, 'DCTDecode')) return true;
    if (f instanceof L.PDFArray && f.size() === 1 && nameIs(f.get(0), 'DCTDecode')) return true;
    return false;
  }

  async function inspectPdf(b, opts) {
    opts = opts || {};
    const L = window.PDFLib;
    if (!L) throw new Error('The PDF reader did not load. Check your connection and reload.');
    const doc = await L.PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    const ctx = doc.context;
    const fields = [];
    const notes = [];
    const encrypted = doc.isEncrypted;
    const info = ctx.trailerInfo.Info ? ctx.lookup(ctx.trailerInfo.Info) : null;
    if (info instanceof L.PDFDict) {
      for (const [k, v] of info.entries()) {
        const key = k.decodeText();
        let value = pdfVal(ctx.lookup(v) || v);
        if (/Date$/.test(key)) value = pdfDate(value);
        if (!value) value = '(empty)';
        fields.push({ id: 'pdfinfo:' + key, name: PDF_INFO_NAME[key] || key, value, cat: PDF_INFO_CAT[key] || guessCat(key), source: 'Document info', keepable: true, pdfKey: key });
      }
    }
    const catalogMeta = doc.catalog.get(pdfName('Metadata'));
    const catalogMetaRef = catalogMeta instanceof L.PDFRef ? catalogMeta.toString() : null;
    const metaRefs = new Set();
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      const d = dictOf(obj);
      const m = d && d.get(pdfName('Metadata'));
      if (m instanceof L.PDFRef) metaRefs.add(m.toString());
    }
    let annotAuthors = new Set(), annotDates = 0, pieceInfo = 0, extraXmp = 0, embeddedFiles = 0, signed = false, imgN = 0;
    const seenXmp = new Set();
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      const d = dictOf(obj);
      if (!d) continue;
      const type = d.get(pdfName('Type'));
      if ((nameIs(type, 'Metadata') || metaRefs.has(ref.toString())) && obj instanceof L.PDFStream) {
        const isCatalog = ref.toString() === catalogMetaRef;
        let xml = '';
        try { xml = UTF8.decode(L.decodePDFRawStream(obj).decode()); } catch (e) { xml = ''; }
        const src = isCatalog ? 'XMP' : 'XMP (page or image)';
        const pref = isCatalog ? 'xmp' : 'xmpobj';
        if (!isCatalog) extraXmp++;
        for (const f of flattenXmp(xml, src, pref)) {
          const key = f.name + '=' + f.value;
          if (!isCatalog && seenXmp.has(key)) continue;
          seenXmp.add(key);
          if (!isCatalog) f.id = 'xmpobj:' + f.name + ':' + f.value.slice(0, 60);
          f.keepable = false;
          fields.push(f);
        }
      }
      if (d.get(pdfName('PieceInfo'))) pieceInfo++;
      if (nameIs(type, 'Sig') || nameIs(d.get(pdfName('FT')), 'Sig')) signed = true;
      if (nameIs(type, 'Filespec') && d.get(pdfName('EF'))) embeddedFiles++;
      const sub = d.get(pdfName('Subtype'));
      if (sub instanceof L.PDFName && MARKUP_ANNOTS.has(sub.decodeText()) && (nameIs(type, 'Annot') || d.get(pdfName('Rect')))) {
        const t = d.get(pdfName('T'));
        const name = t ? pdfVal(ctx.lookup(t) || t).trim() : '';
        if (name && name !== 'Author') annotAuthors.add(name);
        if (d.get(pdfName('M')) || d.get(pdfName('CreationDate'))) annotDates++;
      }
      if (isDctStream(obj)) {
        imgN++;
        try {
          const r = await inspectJpeg(obj.getContents());
          for (const f of r.fields) {
            if (f.id === 'icc') continue;
            fields.push({ ...f, id: 'pdfimg:' + imgN + ':' + f.id, name: 'Picture ' + imgN + ': ' + f.name, keepable: false, exif: undefined, xmp: undefined });
          }
        } catch (e) { /* not a readable JPEG, nothing to report */ }
      }
    }
    for (const a of annotAuthors) fields.push({ id: 'annot:author:' + a, name: 'Comment author', value: a, cat: 'people', source: 'Comments', keepable: false, author: true });
    if (annotDates) fields.push({ id: 'annot:dates', name: 'Comment dates', value: annotDates === 1 ? '1 comment carries a date' : annotDates + ' comments carry a date', cat: 'time', source: 'Comments', keepable: false, author: true });
    if (pieceInfo) fields.push({ id: 'pdf:pieceinfo', name: 'Private app data', value: 'Left by the app that made the file, on ' + pieceInfo + (pieceInfo === 1 ? ' object' : ' objects'), cat: 'software', source: 'PDF', keepable: false });
    if (embeddedFiles) notes.push('This PDF has ' + embeddedFiles + (embeddedFiles === 1 ? ' attached file' : ' attached files') + '. Attached files are kept as they are and are not cleaned.');
    if (signed) notes.push('This PDF is digitally signed. Cleaning it changes the file, so the signature will no longer be valid.');
    if (encrypted) notes.push('This PDF is password-protected. Unlock it first, then clean it.');
    return { format: 'pdf', fields, gps: null, notes, encrypted, pages: doc.getPageCount() };
  }

  async function cleanPdf(b, decide, opts) {
    const L = window.PDFLib;
    const rep = await inspectPdf(b);
    if (rep.encrypted) throw new Error('This PDF is password-protected. Unlock it first (PDF Suite, Unlock), then clean it.');
    const doc = await L.PDFDocument.load(b, { updateMetadata: false, throwOnInvalidObject: false });
    const ctx = doc.context;
    const keptIds = new Set();
    // Document info: keep only what was chosen.
    const infoRef = ctx.trailerInfo.Info;
    const info = infoRef ? ctx.lookup(infoRef) : null;
    if (info instanceof L.PDFDict) {
      for (const [k] of info.entries()) {
        const f = rep.fields.find(x => x.id === 'pdfinfo:' + k.decodeText());
        if (f && decide(f)) keptIds.add(f.id);
        else info.delete(k);
      }
      if (!info.entries().length) {
        if (infoRef instanceof L.PDFRef) ctx.delete(infoRef);
        ctx.trailerInfo.Info = undefined;
      }
    } else ctx.trailerInfo.Info = undefined;
    doc.catalog.delete(pdfName('Metadata'));
    doc.catalog.delete(pdfName('PieceInfo'));
    const anonymise = !opts || opts.anonymise !== false;
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      const d = dictOf(obj);
      if (!d) continue;
      if (nameIs(d.get(pdfName('Type')), 'Metadata') && obj instanceof L.PDFStream) { ctx.delete(ref); continue; }
      d.delete(pdfName('Metadata'));
      d.delete(pdfName('PieceInfo'));
      d.delete(pdfName('LastModified'));
      const sub = d.get(pdfName('Subtype'));
      if (anonymise && sub instanceof L.PDFName && MARKUP_ANNOTS.has(sub.decodeText()) && (nameIs(d.get(pdfName('Type')), 'Annot') || d.get(pdfName('Rect')))) {
        if (d.get(pdfName('T'))) d.set(pdfName('T'), L.PDFString.of('Author'));
        d.delete(pdfName('M'));
        d.delete(pdfName('CreationDate'));
      }
      if (isDctStream(obj)) {
        try {
          const src = obj.getContents();
          const r = await cleanJpeg(src, () => false, { keepRotation: false });
          if (r.bytes.length !== src.length) {
            obj.dict.set(pdfName('Length'), L.PDFNumber.of(r.bytes.length));
            ctx.assign(ref, L.PDFRawStream.of(obj.dict, r.bytes));
          }
        } catch (e) { /* left as it is; verification below will catch leftovers */ }
      }
    }
    if (!anonymise) for (const f of rep.fields) if (f.author) keptIds.add(f.id);
    // Drop objects nothing points to (old revisions, orphaned metadata).
    const reachable = new Set();
    const walk = (o) => {
      const stack = [o];
      while (stack.length) {
        const x = stack.pop();
        if (!x) continue;
        if (x instanceof L.PDFRef) {
          const k = x.toString();
          if (reachable.has(k)) continue;
          reachable.add(k);
          stack.push(ctx.lookup(x));
        } else if (x instanceof L.PDFDict) { for (const [, v] of x.entries()) stack.push(v); }
        else if (x instanceof L.PDFArray) { for (const v of x.asArray()) stack.push(v); }
        else if (x instanceof L.PDFStream) stack.push(x.dict);
      }
    };
    walk(ctx.trailerInfo.Root);
    if (ctx.trailerInfo.Info) walk(ctx.trailerInfo.Info);
    for (const [ref] of ctx.enumerateIndirectObjects()) if (!reachable.has(ref.toString())) ctx.delete(ref);
    const out = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
    return { bytes: new Uint8Array(out), keptIds, notes: rep.notes.filter(n => !/password/.test(n)) };
  }

  /* ---------- Office (DOCX, XLSX, PPTX) ---------- */

  const CORE_NAMES = {
    'dc:title': ['Title', 'content'], 'dc:subject': ['Subject', 'content'], 'dc:creator': ['Author', 'rights'],
    'cp:keywords': ['Keywords', 'content'], 'dc:description': ['Comments', 'content'], 'cp:lastModifiedBy': ['Last modified by', 'people'],
    'cp:revision': ['Revision number', 'other'], 'dcterms:created': ['Created', 'time'], 'dcterms:modified': ['Modified', 'time'],
    'cp:lastPrinted': ['Last printed', 'time'], 'cp:category': ['Category', 'content'], 'cp:contentStatus': ['Status', 'content'],
    'dc:identifier': ['Identifier', 'content'], 'dc:language': ['Language', 'content'], 'cp:version': ['Version', 'content'],
    'cp:contentType': ['Content type', 'content']
  };
  const APP_FIELDS = {
    Company: ['Company', 'people'], Manager: ['Manager', 'people'], Template: ['Template', 'other'],
    HyperlinkBase: ['Hyperlink base', 'other'], TotalTime: ['Total editing time (minutes)', 'time'],
    Application: ['Application', 'software'], AppVersion: ['Application version', 'software']
  };
  const MEDIA_RE = /^(word|ppt|xl)\/media\/[^/]+\.(jpe?g|png|webp)$/i;
  const AUTHOR_PART_RE = /^(word\/[^/]+\.xml|ppt\/commentAuthors\.xml|ppt\/authors\.xml|ppt\/comments\/[^/]+\.xml|xl\/comments[^/]*\.xml|xl\/persons\/[^/]+\.xml|xl\/threadedComments\/[^/]+\.xml)$/;
  const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

  function parseXml(s) {
    const d = new DOMParser().parseFromString(s, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('An XML part of this file is damaged');
    return d;
  }
  function unesc(s) { return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }

  function findAuthors(path, xml, acc) {
    let m;
    const re1 = /\b(?:w:author|w15:author)="([^"]*)"/g;
    while ((m = re1.exec(xml))) acc.names.add(unesc(m[1]));
    if (/\bw:date="/.test(xml) || /w16cex:dateUtc="/.test(xml) || (/^ppt\/comments\//.test(path) && /<p:cm\b[^>]*\sdt="/.test(xml))) acc.dates++;
    const reUid = /\b(?:w15:userId|userId)="([^"]+)"/g;
    while ((m = reUid.exec(xml))) acc.ids.add(unesc(m[1]));
    if (/^ppt\//.test(path)) {
      const re = /<(?:p:cmAuthor|p188:author)\b[^>]*\bname="([^"]*)"/g;
      while ((m = re.exec(xml))) acc.names.add(unesc(m[1]));
    }
    if (/^xl\/comments/.test(path)) {
      const re = /<author>([^<]*)<\/author>/g;
      while ((m = re.exec(xml))) acc.names.add(unesc(m[1]));
    }
    if (/^xl\/persons\//.test(path)) {
      const re = /\bdisplayName="([^"]*)"/g;
      while ((m = re.exec(xml))) acc.names.add(unesc(m[1]));
    }
  }

  async function inspectOffice(b, ext) {
    const JSZip = window.JSZip;
    if (!JSZip) throw new Error('The Office reader did not load. Check your connection and reload.');
    const zip = await JSZip.loadAsync(b);
    if (!zip.file('[Content_Types].xml')) throw new Error('This is not a valid ' + ext.toUpperCase() + ' file');
    const fields = [];
    const notes = [];
    let gps = null;
    const core = zip.file('docProps/core.xml');
    if (core) {
      const doc = parseXml(await core.async('string'));
      for (const el of Array.from(doc.documentElement.children)) {
        const tag = el.tagName;
        const def = CORE_NAMES[tag] || [tag, guessCat(tag)];
        const v = el.textContent.trim();
        if (!v) continue;
        fields.push({ id: 'core:' + tag, name: def[0], value: v, cat: def[1], source: 'Document properties', keepable: true, office: { part: 'core', tag } });
      }
    }
    const app = zip.file('docProps/app.xml');
    if (app) {
      const doc = parseXml(await app.async('string'));
      for (const el of Array.from(doc.documentElement.children)) {
        const def = APP_FIELDS[el.localName];
        const v = el.textContent.trim();
        if (!def || !v || (el.localName === 'TotalTime' && v === '0')) continue;
        fields.push({ id: 'app:' + el.localName, name: def[0], value: v, cat: def[1], source: 'Document properties', keepable: true, office: { part: 'app', tag: el.localName } });
      }
    }
    const custom = zip.file('docProps/custom.xml');
    if (custom) {
      const doc = parseXml(await custom.async('string'));
      const props = Array.from(doc.getElementsByTagName('*')).filter(e => e.localName === 'property');
      for (const p of props) {
        const name = p.getAttribute('name') || '(no name)';
        fields.push({ id: 'custom:' + name, name: 'Custom property: ' + name, value: p.textContent.trim() || '(empty)', cat: guessCat(name) === 'other' ? 'other' : guessCat(name), source: 'Custom properties', keepable: false });
      }
      if (!props.length) fields.push({ id: 'custom:file', name: 'Custom properties', value: 'Empty list', cat: 'other', source: 'Custom properties', keepable: false });
    }
    const thumb = await findThumbnail(zip);
    if (thumb) fields.push({ id: 'thumb', name: 'Preview picture', value: 'A picture of the first page (' + thumb + ')', cat: 'other', source: 'Document', keepable: false });
    const acc = { names: new Set(), ids: new Set(), dates: 0 };
    for (const path of Object.keys(zip.files)) {
      if (!AUTHOR_PART_RE.test(path)) continue;
      findAuthors(path, await zip.file(path).async('string'), acc);
    }
    for (const n of acc.names) if (n && n !== 'Author') fields.push({ id: 'author:' + n, name: 'Comment or revision author', value: n, cat: 'people', source: 'Comments and changes', keepable: false, author: true });
    for (const n of acc.ids) if (n && n !== 'Author') fields.push({ id: 'author:uid:' + n, name: 'Account of a comment author', value: n, cat: 'people', source: 'Comments and changes', keepable: false, author: true });
    if (acc.dates) fields.push({ id: 'author:dates', name: 'Comment and revision dates', value: 'Dates on comments or tracked changes in ' + acc.dates + (acc.dates === 1 ? ' part' : ' parts'), cat: 'time', source: 'Comments and changes', keepable: false, author: true });
    for (const path of Object.keys(zip.files)) {
      if (!MEDIA_RE.test(path)) continue;
      try {
        const r = await inspectImage(await zip.file(path).async('uint8array'));
        const short = path.split('/').pop();
        for (const f of r.fields) fields.push({ ...f, id: 'media:' + path + ':' + f.id, name: short + ': ' + f.name, keepable: false, exif: undefined, xmp: undefined, embedded: true });
        if (!gps && r.gps) gps = r.gps;
      } catch (e) { /* not an image we can read */ }
    }
    return { format: ext, fields, gps, notes, _zip: zip };
  }

  async function findThumbnail(zip) {
    const rels = zip.file('_rels/.rels');
    if (!rels) return null;
    const xml = await rels.async('string');
    const m = /<Relationship\b[^>]*Type="[^"]*\/thumbnail"[^>]*>/.exec(xml);
    if (!m) return null;
    const t = /Target="([^"]*)"/.exec(m[0]);
    return t ? t[1].replace(/^\//, '') : null;
  }

  function removeRel(xml, targetPath) {
    return xml.replace(/<Relationship\b[^>]*\/>/g, tag => {
      const t = /Target="([^"]*)"/.exec(tag);
      return t && t[1].replace(/^\//, '') === targetPath ? '' : tag;
    });
  }
  function removeOverride(xml, partPath) {
    return xml.replace(/<Override\b[^>]*\/>/g, tag => {
      const t = /PartName="([^"]*)"/.exec(tag);
      return t && t[1].replace(/^\//, '') === partPath ? '' : tag;
    });
  }

  function anonymiseXml(path, xml, names) {
    let out = xml
      .replace(/\b(w:author|w15:author)="[^"]*"/g, '$1="Author"')
      .replace(/\s(?:w:initials)="[^"]*"/g, '')
      .replace(/\sw:date="[^"]*"/g, '')
      .replace(/\sw16cex:dateUtc="[^"]*"/g, '')
      .replace(/<w15:presenceInfo\b[^>]*\/>/g, '');
    if (/^ppt\//.test(path)) {
      out = out.replace(/(<(?:p:cmAuthor|p188:author)\b[^>]*?\bname=")[^"]*"/g, '$1Author"')
        .replace(/(<(?:p:cmAuthor|p188:author)\b[^>]*?\binitials=")[^"]*"/g, '$1"')
        .replace(/(<p188:author\b[^>]*?\buserId=")[^"]*"/g, '$1Author"')
        .replace(/(<p:cm\b[^>]*?)\sdt="[^"]*"/g, '$1');
    }
    if (/^xl\/comments/.test(path)) {
      out = out.replace(/<author>[^<]*<\/author>/g, '<author>Author</author>');
      for (const n of names) {
        const e = escXml(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp('>' + e + ':', 'g'), '>Author:');
      }
    }
    if (/^xl\/persons\//.test(path)) {
      out = out.replace(/\bdisplayName="[^"]*"/g, 'displayName="Author"').replace(/\buserId="[^"]*"/g, 'userId=""');
    }
    return out;
  }

  async function cleanOffice(b, ext, decide, opts) {
    const JSZip = window.JSZip;
    const rep = await inspectOffice(b, ext);
    const zip = rep._zip;
    const keptIds = new Set();
    const changed = new Set();
    const core = zip.file('docProps/core.xml');
    if (core) {
      const doc = parseXml(await core.async('string'));
      for (const el of Array.from(doc.documentElement.children)) {
        const f = rep.fields.find(x => x.id === 'core:' + el.tagName);
        if (f && decide(f)) keptIds.add(f.id);
        else el.parentNode.removeChild(el);
      }
      zip.file('docProps/core.xml', XML_DECL + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, ''));
      changed.add('docProps/core.xml');
    }
    const app = zip.file('docProps/app.xml');
    if (app) {
      const doc = parseXml(await app.async('string'));
      for (const el of Array.from(doc.documentElement.children)) {
        if (!APP_FIELDS[el.localName]) continue;
        const f = rep.fields.find(x => x.id === 'app:' + el.localName);
        if (f && decide(f)) keptIds.add(f.id);
        else el.parentNode.removeChild(el);
      }
      zip.file('docProps/app.xml', XML_DECL + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, ''));
      changed.add('docProps/app.xml');
    }
    let rels = zip.file('_rels/.rels') ? await zip.file('_rels/.rels').async('string') : null;
    let types = await zip.file('[Content_Types].xml').async('string');
    const drop = [];
    if (zip.file('docProps/custom.xml')) drop.push('docProps/custom.xml');
    const thumb = await findThumbnail(zip);
    if (thumb) drop.push(thumb);
    for (const p of drop) {
      zip.remove(p);
      if (rels) rels = removeRel(rels, p);
      types = removeOverride(types, p);
    }
    if (rels !== null) { zip.file('_rels/.rels', rels); changed.add('_rels/.rels'); }
    zip.file('[Content_Types].xml', types);
    changed.add('[Content_Types].xml');
    const anonymise = !opts || opts.anonymise !== false;
    const names = rep.fields.filter(f => f.author && f.id.startsWith('author:') && !f.id.startsWith('author:uid:') && f.id !== 'author:dates').map(f => f.value);
    if (anonymise) {
      for (const path of Object.keys(zip.files)) {
        if (!AUTHOR_PART_RE.test(path)) continue;
        const xml = await zip.file(path).async('string');
        const out = anonymiseXml(path, xml, names);
        if (out !== xml) { zip.file(path, out); changed.add(path); }
      }
    } else {
      for (const f of rep.fields) if (f.author) keptIds.add(f.id);
    }
    const mediaNotes = [];
    for (const path of Object.keys(zip.files)) {
      if (!MEDIA_RE.test(path)) continue;
      const src = await zip.file(path).async('uint8array');
      let r;
      try { r = await cleanImage(src, sniff(src), decide, opts); } catch (e) { throw new Error('A picture inside the file (' + path.split('/').pop() + ') could not be cleaned: ' + e.message); }
      zip.file(path, r.bytes);
      for (const id of r.keptIds) keptIds.add('media:' + path + ':' + id);
      if (r.bytes.length !== src.length) mediaNotes.push(path);
    }
    const mime = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }[ext];
    const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: mime });
    // Check the result still opens: the package parts it lists must exist.
    const before = await danglingRefs(await JSZip.loadAsync(b));
    const check = await JSZip.loadAsync(out);
    const after = await danglingRefs(check);
    const added = after.filter(x => !before.includes(x));
    if (added.length) throw new Error('The cleaned file would have broken links (' + added.slice(0, 3).join(', ') + '), so it was not saved.');
    for (const p of changed) if (/\.xml$|\.rels$/.test(p) && check.file(p)) parseXml(await check.file(p).async('string'));
    const notes = rep.notes.slice();
    if (mediaNotes.length) notes.push(mediaNotes.length === 1 ? '1 picture inside the file was cleaned without changing how it looks.' : mediaNotes.length + ' pictures inside the file were cleaned without changing how they look.');
    return { bytes: out, keptIds, notes };
  }

  async function danglingRefs(zip) {
    const missing = [];
    const types = zip.file('[Content_Types].xml');
    if (!types) return ['[Content_Types].xml'];
    const txml = await types.async('string');
    const re = /<Override\b[^>]*PartName="([^"]*)"/g;
    let m;
    while ((m = re.exec(txml))) { let p = m[1]; try { p = decodeURI(p); } catch (e) { /* as written */ } p = p.replace(/^\//, ''); if (!zip.file(p)) missing.push('type:' + p); }
    for (const path of Object.keys(zip.files)) {
      if (!/\.rels$/.test(path) || zip.files[path].dir) continue;
      const xml = await zip.file(path).async('string');
      const base = path.replace(/_rels\/[^/]*\.rels$/, '');
      const rr = /<Relationship\b[^>]*>/g;
      let r;
      while ((r = rr.exec(xml))) {
        const tag = r[0];
        if (/TargetMode="External"/i.test(tag)) continue;
        const t = /Target="([^"]*)"/.exec(tag);
        if (!t) continue;
        let target = unesc(t[1]);
        try { target = decodeURI(target); } catch (e) { /* keep as written */ }
        target = target.split('#')[0];
        if (!target) continue;
        let full = target.startsWith('/') ? target.slice(1) : base + target;
        const segs = [];
        for (const s of full.split('/')) { if (s === '..') segs.pop(); else if (s !== '.' && s !== '') segs.push(s); }
        full = segs.join('/');
        if (!zip.file(full)) missing.push(path + '→' + full);
      }
    }
    return missing;
  }

  /* ---------- dispatch ---------- */

  function sniff(b) {
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
    if (b[0] === 0x89 && startsWith(b, 1, 'PNG')) return 'png';
    if (startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WEBP')) return 'webp';
    if ((startsWith(b, 0, 'II') && b[2] === 42 && b[3] === 0) || (startsWith(b, 0, 'MM') && b[2] === 0 && b[3] === 42)) return 'tiff';
    if (startsWith(b, 0, 'BM')) return 'bmp';
    if (startsWith(b, 0, '%PDF') || (b.length > 1024 && LATIN1.decode(b.subarray(0, 1024)).includes('%PDF-'))) return 'pdf';
    if (startsWith(b, 0, 'GIF8')) return 'gif';
    if (startsWith(b, 4, 'ftyp')) {
      const brand = ascii(b, 8, 4);
      if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|heif)$/.test(brand)) return 'heic';
      if (/^avi[fs]$/.test(brand)) return 'avif';
      return 'video';
    }
    if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 3 && b[3] === 4) return 'zip';
    if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return 'ole';
    return 'unknown';
  }

  async function inspectImage(b) {
    const f = sniff(b);
    if (f === 'jpeg') return inspectJpeg(b);
    if (f === 'png') return inspectPng(b);
    if (f === 'webp') return inspectWebp(b);
    if (f === 'tiff') return inspectTiffFile(b);
    throw new Error('Not a supported picture');
  }
  async function cleanImage(b, fmt, decide, opts) {
    if (fmt === 'jpeg') return cleanJpeg(b, decide, opts);
    if (fmt === 'png') return cleanPng(b, decide, opts);
    if (fmt === 'webp') return cleanWebp(b, decide, opts);
    throw new Error('This kind of picture cannot be cleaned without converting it');
  }

  async function inspect(b, fmt) {
    switch (fmt) {
      case 'jpeg': return inspectJpeg(b);
      case 'png': return inspectPng(b);
      case 'webp': return inspectWebp(b);
      case 'tiff': return inspectTiffFile(b);
      case 'heic': return inspectHeic(b);
      case 'bmp': return { format: 'bmp', fields: [], gps: null, orientation: 1, notes: [] };
      case 'pdf': return inspectPdf(b);
      case 'docx': case 'xlsx': case 'pptx': return inspectOffice(b, fmt);
    }
    throw new Error('Unsupported format');
  }
  async function clean(b, fmt, decide, opts) {
    switch (fmt) {
      case 'jpeg': case 'png': case 'webp': return cleanImage(b, fmt, decide, opts);
      case 'pdf': return cleanPdf(b, decide, opts);
      case 'docx': case 'xlsx': case 'pptx': return cleanOffice(b, fmt, decide, opts);
    }
    throw new Error('This format cannot be cleaned here');
  }

  // Convert a picture the browser can open (TIFF in Safari, HEIC after heic2any) to PNG or JPEG.
  async function convertRaster(blob, mime) {
    let bmp;
    try { bmp = await createImageBitmap(blob); } catch (e) { throw new Error('This browser cannot open this kind of picture'); }
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    if (bmp.close) bmp.close();
    const out = await new Promise(r => c.toBlob(r, mime, 0.92));
    if (!out) throw new Error('The picture could not be converted');
    return new Uint8Array(await out.arrayBuffer());
  }

  // Compares an input report with the report of the cleaned output.
  function compare(inRep, outRep, keptIds) {
    const outIds = new Set(outRep.fields.map(f => f.id));
    const removed = inRep.fields.filter(f => !outIds.has(f.id));
    const kept = outRep.fields.filter(f => keptIds.has(f.id));
    const unexpected = outRep.fields.filter(f => !keptIds.has(f.id));
    return { removed, kept, unexpected };
  }

  window.ScrubEngine = {
    sniff, inspect, clean, compare, convertRaster, loadScript, crc32, parseJpeg, parseTiff, buildTiff, flattenXmp,
    danglingRefs, GROUPS, RISK_CATS, bytesLabel,
    _internal: { inspectJpeg, inspectPng, inspectWebp, cleanJpeg, cleanPng, cleanWebp, orientationEntry }
  };
})();
