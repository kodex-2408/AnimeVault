'use strict';

// main/players/reader.js - the built-in manga reader's backend. reader:open
// lists the pages inside a .cbz/.zip (adm-zip) or .cbr/.rar (node-unrar-js)
// chapter; the renderer then loads each page from page://<token>/<index>.
// Pages are read from the archive on request, never extracted to disk.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { assertAllowedFileActionPath } = require('../config/security');
const { MANGA_EXTS, assertPlayableMedia } = require('../scanner/parsers');

const IMAGE_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp' };
const ZIP_EXTS = ['.cbz', '.zip'];
const RAR_EXTS = ['.cbr', '.rar'];
const MAX_SESSIONS = 4; // the open chapter plus the ones next to it
const sessions = new Map();

function isPageName(name) {
  const base = path.posix.basename(String(name).replace(/\\/g, '/'));
  if (!base || base.startsWith('.') || /(^|\/)__MACOSX\//i.test(name)) return false;
  return !!IMAGE_MIME[path.extname(base).toLowerCase()];
}
const naturalOrder = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function supportsBuiltInReader(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return ZIP_EXTS.includes(ext) || RAR_EXTS.includes(ext);
}

async function openArchive(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ZIP_EXTS.includes(ext)) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries().filter(e => !e.isDirectory && isPageName(e.entryName));
    entries.sort((a, b) => naturalOrder(a.entryName, b.entryName));
    return { names: entries.map(e => e.entryName), read: (i) => entries[i].getData() };
  }
  if (RAR_EXTS.includes(ext)) {
    const { createExtractorFromData } = require('node-unrar-js');
    const buf = fs.readFileSync(filePath);
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const lister = await createExtractorFromData({ data });
    const names = [...lister.getFileList().fileHeaders].filter(h => !h.flags.directory && isPageName(h.name)).map(h => h.name).sort(naturalOrder);
    return {
      names,
      read: async (i) => {
        const ex = await createExtractorFromData({ data });
        const file = [...ex.extract({ files: [names[i]] }).files][0];
        return file && file.extraction ? Buffer.from(file.extraction) : null;
      },
    };
  }
  return null;
}

async function openChapter(filePath) {
  assertAllowedFileActionPath(filePath);
  assertPlayableMedia(filePath, MANGA_EXTS);
  if (!supportsBuiltInReader(filePath)) return { unsupported: true };
  const archive = await openArchive(filePath);
  if (!archive || !archive.names.length) return { error: 'No pages found in this chapter' };
  const token = crypto.randomBytes(12).toString('hex');
  sessions.set(token, { filePath, ...archive });
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  return { token, count: archive.names.length };
}

// page://<token>/<index>
async function handlePageRequest(request) {
  try {
    const m = /^page:\/\/([a-f0-9]{24})\/(\d{1,5})(?:[?#].*)?$/.exec(request.url);
    const s = m && sessions.get(m[1]);
    const i = m ? Number(m[2]) : -1;
    if (!s || i < 0 || i >= s.names.length) return new Response(null, { status: 404 });
    const data = await s.read(i);
    if (!data) return new Response(null, { status: 404 });
    const mime = IMAGE_MIME[path.extname(s.names[i]).toLowerCase()] || 'application/octet-stream';
    return new Response(data, { headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=600' } });
  } catch (e) {
    return new Response(null, { status: 404 });
  }
}

function register() {
  ipcMain.handle('reader:open', async (_, filePath) => {
    try { return await openChapter(filePath); } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('reader:close', (_, token) => { sessions.delete(String(token || '')); return true; });
}

module.exports = {
  handlePageRequest,
  isPageName,
  openChapter,
  register,
  supportsBuiltInReader,
};
