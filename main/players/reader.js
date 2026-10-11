'use strict';

// main/players/reader.js - the built-in reader's backend. reader:open looks
// inside a chapter or book and tells the renderer how to show it:
//   kind 'pages' - images in reading order (.cbz/.zip, .cbr/.rar, image-only
//                  EPUB and MOBI comics), loaded from page://<token>/<n>
//   kind 'html'  - text books (EPUB, MOBI) as HTML sections; their pictures
//                  load from page://<token>/r/<n>. The renderer sanitizes it.
//   kind 'pdf'   - the renderer draws the pages with pdf.js from the bytes
//                  that reader:fileData hands over.
// Nothing is extracted to disk: pages and pictures are read on request.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { assertAllowedFileActionPath } = require('../config/security');
const { MANGA_EXTS, assertPlayableMedia } = require('../scanner/parsers');

const IMAGE_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' };
const ZIP_EXTS = ['.cbz', '.zip'];
const RAR_EXTS = ['.cbr', '.rar'];
const BUILT_IN_EXTS = [...ZIP_EXTS, ...RAR_EXTS, '.epub', '.pdf', '.mobi'];
const MAX_SESSIONS = 4; // the open chapter plus the ones next to it
const MAX_PDF_BYTES = 1024 * 1024 * 1024;
const sessions = new Map();

function isPageName(name) {
  const base = path.posix.basename(String(name).replace(/\\/g, '/'));
  if (!base || base.startsWith('.') || /(^|\/)__MACOSX\//i.test(name)) return false;
  const ext = path.extname(base).toLowerCase();
  return !!IMAGE_MIME[ext] && ext !== '.svg';
}
const naturalOrder = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function supportsBuiltInReader(filePath) {
  return BUILT_IN_EXTS.includes(path.extname(String(filePath || '')).toLowerCase());
}

// Image type from the bytes themselves (MOBI records have no names).
function sniffImageMime(buf, name) {
  if (buf && buf.length > 4) {
    if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
    if (buf[0] === 0x42 && buf[1] === 0x4D) return 'image/bmp';
    if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  }
  return IMAGE_MIME[path.extname(String(name || '')).toLowerCase()] || null;
}

// ---- comic archives ----------------------------------------------------------
async function openComicArchive(filePath, ext) {
  if (ZIP_EXTS.includes(ext)) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries().filter(e => !e.isDirectory && isPageName(e.entryName));
    entries.sort((a, b) => naturalOrder(a.entryName, b.entryName));
    return { kind: 'pages', pages: entries.map(e => ({ name: e.entryName, read: () => e.getData() })) };
  }
  const { createExtractorFromData } = require('node-unrar-js');
  const buf = fs.readFileSync(filePath);
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const lister = await createExtractorFromData({ data });
  const names = [...lister.getFileList().fileHeaders].filter(h => !h.flags.directory && isPageName(h.name)).map(h => h.name).sort(naturalOrder);
  return {
    kind: 'pages',
    pages: names.map(name => ({
      name,
      read: async () => {
        const ex = await createExtractorFromData({ data });
        const file = [...ex.extract({ files: [name] }).files][0];
        return file && file.extraction ? Buffer.from(file.extraction) : null;
      },
    })),
  };
}

// ---- EPUB --------------------------------------------------------------------
function xmlAttrs(tag) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[3] != null ? m[3] : m[4];
  return out;
}
function decodeHref(h) { try { return decodeURIComponent(h); } catch (e) { return h; } }
function resolveIn(dir, href) {
  const clean = decodeHref(String(href || '').split('#')[0].split('?')[0]);
  if (!clean || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return null; // external or data: URLs
  return path.posix.normalize(path.posix.join(dir, clean)).replace(/^\/+/, '');
}
const visibleText = (html) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[#\w]+;/g, ' ').replace(/\s+/g, '').length;

// <img src>, SVG <image xlink:href|href>: the picture references in a page.
const IMG_REF_RE = /<(img|image)\b[^>]*?\b(?:src|xlink:href|href)\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi;

function openEpub(filePath, token) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(filePath);
  const byName = new Map(zip.getEntries().filter(e => !e.isDirectory).map(e => [e.entryName.replace(/^\/+/, ''), e]));
  const text = (name) => { const e = byName.get(name); return e ? e.getData().toString('utf8') : null; };
  const container = text('META-INF/container.xml');
  const rootMatch = container && /<rootfile\b[^>]*>/i.exec(container);
  const opfPath = rootMatch && decodeHref(xmlAttrs(rootMatch[0])['full-path'] || '');
  const opf = opfPath && text(opfPath);
  if (!opf) throw new Error('This EPUB has no readable table of contents');
  const opfDir = path.posix.dirname(opfPath) === '.' ? '' : path.posix.dirname(opfPath);
  const manifest = new Map();
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
    const a = xmlAttrs(m[0]);
    if (a.id && a.href) manifest.set(a.id, { href: resolveIn(opfDir, a.href), type: a['media-type'] || '' });
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*>/gi)].map(m => manifest.get(xmlAttrs(m[0]).idref)).filter(it => it && it.href && byName.has(it.href));
  if (!spine.length) throw new Error('This EPUB has no pages');

  const resources = [];
  const resourceIndex = new Map();
  const resourceUrl = (name) => {
    if (!byName.has(name)) return null;
    if (!resourceIndex.has(name)) { resourceIndex.set(name, resources.length); resources.push({ name, read: () => byName.get(name).getData() }); }
    return 'page://' + token + '/r/' + resourceIndex.get(name);
  };

  const docs = spine.map(it => {
    const html = text(it.href) || '';
    const body = (/<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html) || [null, html])[1];
    const dir = path.posix.dirname(it.href) === '.' ? '' : path.posix.dirname(it.href);
    const images = [...body.matchAll(IMG_REF_RE)].map(m => resolveIn(dir, m[3] != null ? m[3] : m[4])).filter(n => n && byName.has(n));
    return { body, dir, images, textLength: visibleText(body) };
  });

  // Comic EPUBs are one picture per page and (almost) no text: show them as pages.
  const imagePages = docs.filter(d => d.images.length === 1 && d.textLength < 40);
  if (docs.length >= 2 && imagePages.length >= docs.length * 0.9) {
    const names = [];
    for (const d of docs) for (const n of d.images) if (names[names.length - 1] !== n) names.push(n);
    return { kind: 'pages', pages: names.map(n => ({ name: n, read: () => byName.get(n).getData() })) };
  }
  const sections = docs.map(d => d.body.replace(IMG_REF_RE, (tag, _t, _q, dq, sq) => {
    const url = resourceUrl(resolveIn(d.dir, dq != null ? dq : sq));
    const alt = (/\balt\s*=\s*"([^"]*)"/i.exec(tag) || [])[1] || '';
    return url ? '<img src="' + url + '" alt="' + alt.replace(/"/g, '&quot;') + '">' : '';
  }));
  return { kind: 'html', sections, resources };
}

// ---- MOBI (MOBI 6 / PalmDOC) ---------------------------------------------------
// Kindle Comic Converter-style comics are image records with next to no text:
// those become pages. Text books with PalmDOC or no compression become HTML.
// HUFF/CDIC-compressed text (and KF8-only files) is left to the reader app.
function palmDocDecompress(src) {
  const out = [];
  for (let i = 0; i < src.length;) {
    const c = src[i++];
    if (c === 0 || (c >= 0x09 && c <= 0x7F)) out.push(c);
    else if (c <= 0x08) { for (let k = 0; k < c && i < src.length; k++) out.push(src[i++]); }
    else if (c >= 0xC0) { out.push(0x20, c ^ 0x80); }
    else {
      if (i >= src.length) break;
      const x = ((c << 8) | src[i++]) & 0x3FFF;
      const dist = x >> 3, len = (x & 7) + 3;
      for (let k = 0; k < len; k++) out.push(dist > 0 && out.length >= dist ? out[out.length - dist] : 0x20);
    }
  }
  return Buffer.from(out);
}
// Bytes appended to each text record that are not part of the text.
function trailingSize(rec, flags) {
  let size = rec.length, num = 0;
  const entry = (end) => {
    let result = 0, bitpos = 0, n = end;
    while (n > 0) {
      const v = rec[n - 1];
      result |= (v & 0x7F) << bitpos;
      bitpos += 7; n--;
      if ((v & 0x80) || bitpos >= 28 || n === 0) break;
    }
    return result;
  };
  for (let f = flags >> 1; f; f >>= 1) if (f & 1) num += entry(size - num);
  if (flags & 1) num += (rec[size - num - 1] & 0x3) + 1;
  return num;
}

function parseMobi(buf) {
  if (buf.length < 78 + 8 || buf.toString('latin1', 60, 68) !== 'BOOKMOBI') throw new Error('Not a MOBI book');
  const count = buf.readUInt16BE(76);
  const offsets = [];
  for (let i = 0; i < count; i++) offsets.push(buf.readUInt32BE(78 + i * 8));
  const record = (i) => buf.subarray(offsets[i], i + 1 < count ? offsets[i + 1] : buf.length);
  const r0 = record(0);
  const compression = r0.readUInt16BE(0), textRecords = r0.readUInt16BE(8);
  if (r0.toString('latin1', 16, 20) !== 'MOBI') throw new Error('Not a MOBI book');
  const headerLen = r0.readUInt32BE(20);
  const encoding = r0.readUInt32BE(28);
  const firstImage = r0.length >= 0x70 ? r0.readUInt32BE(0x6C) : 0xFFFFFFFF;
  const exthFlags = r0.length >= 0x84 ? r0.readUInt32BE(0x80) : 0;
  const extraFlags = headerLen >= 0xE4 && r0.length >= 0xF4 ? r0.readUInt16BE(0xF2) : 0;
  let coverIdx = -1, thumbIdx = -1;
  if (exthFlags & 0x40) {
    let p = 16 + headerLen;
    if (r0.toString('latin1', p, p + 4) === 'EXTH') {
      const n = r0.readUInt32BE(p + 8);
      p += 12;
      for (let k = 0; k < n && p + 8 <= r0.length; k++) {
        const type = r0.readUInt32BE(p), len = r0.readUInt32BE(p + 4);
        if (len < 8) break;
        if (type === 201 && len >= 12) coverIdx = r0.readUInt32BE(p + 8);
        if (type === 202 && len >= 12) thumbIdx = r0.readUInt32BE(p + 8);
        p += len;
      }
    }
  }
  const images = []; // { idx (recindex - 1), read }
  if (firstImage !== 0xFFFFFFFF && firstImage < count) {
    for (let i = firstImage; i < count; i++) {
      const rec = record(i);
      const tag = rec.toString('latin1', 0, 4);
      if (['FLIS', 'FCIS', 'SRCS', 'DATP', 'RESC', 'BOUN', 'FDST', 'AUDI', 'VIDE'].includes(tag) || (rec.length === 4 && rec.readUInt32BE(0) === 0xE98E0D0A)) continue;
      if (sniffImageMime(rec)) images.push({ idx: i - firstImage, read: () => Buffer.from(rec) });
    }
  }
  let html = null;
  if (compression === 1 || compression === 2) {
    const parts = [];
    for (let i = 1; i <= textRecords && i < count; i++) {
      const rec = record(i);
      const body = rec.subarray(0, rec.length - trailingSize(rec, extraFlags));
      parts.push(compression === 2 ? palmDocDecompress(body) : body);
    }
    const raw = Buffer.concat(parts);
    html = new TextDecoder(encoding === 65001 ? 'utf-8' : 'windows-1252').decode(raw);
  }
  return { html, images, coverIdx, thumbIdx, compression };
}

function openMobi(filePath, token) {
  const book = parseMobi(fs.readFileSync(filePath));
  const byIdx = new Map(book.images.map(im => [im.idx, im]));
  const textLen = book.html == null ? 0 : visibleText(book.html.replace(/<mbp:pagebreak[^>]*>/gi, ''));
  const imageOnly = book.images.length >= 2 && (book.html == null || textLen < book.images.length * 40);
  if (imageOnly) {
    // Pages in the order the text places them; otherwise record order. The
    // cover and thumbnail copies the Kindle format appends are left out.
    let order = book.html ? [...book.html.matchAll(/recindex\s*=\s*["']?(\d+)/gi)].map(m => Number(m[1]) - 1).filter(i => byIdx.has(i)) : [];
    order = order.filter((v, i, a) => a.indexOf(v) === i);
    if (!order.length) order = book.images.map(im => im.idx).filter(i => i !== book.thumbIdx && !(i === book.coverIdx && i === book.images[book.images.length - 1].idx));
    return { kind: 'pages', pages: order.map(i => ({ name: 'image-' + (i + 1), read: byIdx.get(i).read })) };
  }
  if (book.html == null) return { unsupported: true }; // HUFF/CDIC text: the reader app handles it
  const resources = [];
  const sections = book.html
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
    .replace(/<img\b[^>]*?recindex\s*=\s*["']?(\d+)["']?[^>]*>/gi, (tag, n) => {
      const im = byIdx.get(Number(n) - 1);
      if (!im) return '';
      resources.push({ name: 'image-' + n, read: im.read });
      return '<img src="page://' + token + '/r/' + (resources.length - 1) + '" alt="">';
    })
    .split(/<mbp:pagebreak[^>]*>/i)
    .filter(s => s.trim());
  return { kind: 'html', sections, resources };
}

// ---- sessions ----------------------------------------------------------------
async function openChapter(filePath) {
  assertAllowedFileActionPath(filePath);
  assertPlayableMedia(filePath, MANGA_EXTS);
  if (!supportsBuiltInReader(filePath)) return { unsupported: true };
  const ext = path.extname(filePath).toLowerCase();
  const token = crypto.randomBytes(12).toString('hex');
  let book;
  if (ext === '.pdf') {
    if (fs.statSync(filePath).size > MAX_PDF_BYTES) return { unsupported: true };
    book = { kind: 'pdf' };
  } else if (ext === '.epub') book = openEpub(filePath, token);
  else if (ext === '.mobi') book = openMobi(filePath, token);
  else book = await openComicArchive(filePath, ext);
  if (book.unsupported) return { unsupported: true };
  if (book.kind === 'pages' && !book.pages.length) return { error: 'No pages found in this chapter' };
  if (book.kind === 'html' && !book.sections.length) return { error: 'This book has no readable text' };
  sessions.set(token, { filePath, pages: [], resources: [], ...book });
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  const res = { token, kind: book.kind };
  if (book.kind === 'pages') res.count = book.pages.length;
  if (book.kind === 'html') res.sections = book.sections;
  return res;
}

// page://<token>/<n> (a page) and page://<token>/r/<n> (a picture inside a book)
async function handlePageRequest(request) {
  try {
    const m = /^page:\/\/([a-f0-9]{24})\/(r\/)?(\d{1,5})(?:[?#].*)?$/.exec(request.url);
    const s = m && sessions.get(m[1]);
    const list = s ? (m[2] ? s.resources : s.pages) : null;
    const item = list && list[Number(m[3])];
    if (!item) return new Response(null, { status: 404 });
    const data = await item.read();
    const mime = data && sniffImageMime(data, item.name);
    if (!mime) return new Response(null, { status: 404 });
    return new Response(data, { headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' } });
  } catch (e) {
    return new Response(null, { status: 404 });
  }
}

function register() {
  ipcMain.handle('reader:open', async (_, filePath) => {
    try { return await openChapter(filePath); } catch (e) { return { error: e.message }; }
  });
  // PDF bytes for pdf.js, only for a PDF the reader has opened.
  ipcMain.handle('reader:fileData', (_, token) => {
    const s = sessions.get(String(token || ''));
    if (!s || s.kind !== 'pdf') return null;
    return fs.readFileSync(s.filePath);
  });
  ipcMain.handle('reader:close', (_, token) => { sessions.delete(String(token || '')); return true; });
}

module.exports = {
  BUILT_IN_EXTS,
  handlePageRequest,
  isPageName,
  openChapter,
  palmDocDecompress,
  parseMobi,
  register,
  sniffImageMime,
  supportsBuiltInReader,
};
