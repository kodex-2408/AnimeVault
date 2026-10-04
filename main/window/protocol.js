'use strict';

// main/window/protocol.js - the cover:// protocol that streams cached artwork.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { isAllowedFileActionPath, isInsidePath, isServableUserDataImage, normalizeFsPath } = require('../config/security');

// cover://<encodeURIComponent(absPath)> — same access rules as cover:getDataUrl:
// image extensions only, and inside userData restricted to cover-cache/thumbnails.
function handleCoverRequest(request) {
  try {
    // The renderer appends ?v=<mtime> so a replaced cover gets a fresh URL
    // (Chromium's image cache ignores #fragments). Paths are percent-encoded,
    // so the first raw "?" or "#" always starts the cache-buster.
    const raw = request.url.slice('cover://'.length).split(/[?#]/)[0];
    const fp = normalizeFsPath(decodeURIComponent(raw));
    if (!fp || !fs.existsSync(fp)) return new Response(null, { status: 404 });
    const ext = path.extname(fp).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return new Response(null, { status: 404 });
    const ud = normalizeFsPath(app.getPath('userData'));
    if (ud && isInsidePath(ud, fp)) {
      if (!isServableUserDataImage(fp)) return new Response(null, { status: 404 });
    } else if (!isAllowedFileActionPath(fp)) {
      return new Response(null, { status: 404 });
    }
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return new Response(fs.readFileSync(fp), { headers: { 'Content-Type': mime } });
  } catch (e) {
    return new Response(null, { status: 404 });
  }
}

module.exports = {
  handleCoverRequest,
};
