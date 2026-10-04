'use strict';

// main/services/covers.js - cover cache paths and the guarded image fetcher.

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { config } = require('../state');
const { CACHE_DIR } = require('../config/config');
const { assertAllowedFileActionPath, isInsidePath, isServableUserDataImage, normalizeFsPath } = require('../config/security');

function getCoverCachePath(seriesName, mode = config.vaultMode) {
  const prefix = mode === 'manga' ? 'manga--' : 'anime--';
  return path.join(CACHE_DIR, prefix + encodeURIComponent(seriesName) + '.jpg');
}

function getExistingCoverCachePath(seriesName) {
  const scoped = getCoverCachePath(seriesName);
  if (fs.existsSync(scoped)) return scoped;
  const legacy = path.join(CACHE_DIR, encodeURIComponent(seriesName) + '.jpg');
  return fs.existsSync(legacy) ? legacy : null;
}

function getCachePath(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex');
  return path.join(CACHE_DIR, `${hash}.jpg`);
}

function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h) || /^::ffff:/.test(h)) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return true;
  }
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/.test(h)) return true; // integer / hex IP forms
  return false;
}

async function fetchImage(url, redirects = 0) {
  if (redirects > 5) throw new Error('Too many redirects');
  let parsed;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Unsafe image URL');
    if (isPrivateHost(parsed.hostname)) throw new Error('Blocked internal image URL');
  } catch (e) { throw new Error('Invalid image URL: ' + e.message); }
  return new Promise((resolve, reject) => {
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(parsed, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let nextUrl = res.headers.location;
        try { nextUrl = new URL(res.headers.location, parsed).toString(); } catch (e) {}
        return fetchImage(nextUrl, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let size = 0;
      const chunks = [];
      res.on('data', c => {
        size += c.length;
        if (size > 15 * 1024 * 1024) { req.destroy(); reject(new Error('Image too large')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function register() {
  ipcMain.handle('cover:getDataUrl', async (_, filePath) => {
    try {
      assertAllowedFileActionPath(filePath, true);
      const ext = path.extname(filePath).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return null;
      // Never serve app data files as images (config, tokens, index).
      const ud = normalizeFsPath(app.getPath('userData'));
      const fp = normalizeFsPath(filePath);
      if (ud && fp && isInsidePath(ud, fp) && !isServableUserDataImage(fp)) return null;
      if (fs.existsSync(filePath)) {
        const buf = fs.readFileSync(filePath);
        return 'data:image/' + (ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : 'jpeg') + ';base64,' + buf.toString('base64');
      }
      return null;
    } catch (e) { return null; }
  });
}

module.exports = {
  fetchImage,
  getCoverCachePath,
  getExistingCoverCachePath,
  register,
};
