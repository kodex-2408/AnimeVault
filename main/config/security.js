'use strict';

// main/config/security.js - path containment and validation rules shared by
// every handler that touches disk, launches a program or opens a URL.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
const { config } = require('../state');

function normalizeFsPath(p) {
  if (!p || typeof p !== 'string') return null;
  try { return path.resolve(p); } catch (e) { return null; }
}

function isInsidePath(parent, child) {
  const root = normalizeFsPath(parent);
  const target = normalizeFsPath(child);
  if (!root || !target) return false;
  const rel = path.relative(root, target);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

// Resolves symlinks/junctions so containment checks compare where a path
// really points. A path that does not exist yet resolves through its nearest
// existing ancestor (e.g. the destination of a move).
function realpathLoose(p) {
  const abs = normalizeFsPath(p);
  if (!abs) return null;
  const tail = [];
  let cur = abs;
  for (let i = 0; i < 64; i++) {
    try { return path.join(fs.realpathSync.native(cur), ...tail.reverse()); }
    catch (e) {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
  return abs;
}

// Folders that must never become a library/watch root, because every file
// action (delete, rename, move) is allowed anywhere beneath a root. A drive
// root that is not the system drive (e.g. a dedicated D:\ anime disk) stays
// allowed.
function isForbiddenRoot(p) {
  const target = normalizeFsPath(p);
  if (!target) return true;
  const sensitive = [
    app.getPath('userData'),
    path.dirname(process.execPath),
    require('os').homedir(),
    process.env.SystemRoot || process.env.windir,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
  ].filter(Boolean);
  // A root equal to, or an ancestor of, a sensitive folder would expose it.
  return sensitive.some(s => isInsidePath(target, s)) ||
    // ...and a root inside the app's own install or data folders is never media.
    [app.getPath('userData'), path.dirname(process.execPath)].some(s => isInsidePath(s, target));
}

function getAllowedFileRoots(includeUserData = false) {
  const roots = [];
  const add = p => { if (p && typeof p === 'string' && path.isAbsolute(p) && !isForbiddenRoot(p)) roots.push(p); };
  (config.folders || []).forEach(f => add(f && f.path));
  (config.mangaFolders || []).forEach(f => add(f && f.path));
  add(config.watcherFolder);
  add(config.watcherDest);
  if (includeUserData) roots.push(app.getPath('userData'));
  return roots;
}

// Lexical AND resolved containment: a junction inside a library folder that
// points at C:\Windows passes the first check but fails the second.
function isAllowedFileActionPath(p, includeUserData = false) {
  const target = normalizeFsPath(p);
  if (!target) return false;
  const realTarget = realpathLoose(target);
  return getAllowedFileRoots(includeUserData).some(root =>
    isInsidePath(root, target) && isInsidePath(realpathLoose(root), realTarget));
}

// One rule for every name the app creates on disk: a single path segment that
// Windows accepts as a file or folder name.
function isSafeFileName(name) {
  if (typeof name !== 'string') return false;
  if (!name || name.length > 240 || name === '.' || name === '..') return false;
  if (path.basename(name) !== name) return false;
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) return false;
  return !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(name);
}

// Moves a file or folder without ever overwriting something else (Windows
// renameSync silently replaces files). A case-only rename is still allowed.
function moveNoClobber(from, to) {
  if (from === to) return false;
  if (fs.existsSync(to) && from.toLowerCase() !== to.toLowerCase()) {
    throw new Error('Refusing to overwrite existing ' + path.basename(to));
  }
  fs.renameSync(from, to);
  return true;
}

function assertAllowedFileActionPath(p, includeUserData = false) {
  if (!isAllowedFileActionPath(p, includeUserData)) {
    throw new Error('Path is outside configured AnimeVault folders');
  }
}

function assertAllowedChildFileActionPath(p) {
  const target = normalizeFsPath(p);
  const realTarget = realpathLoose(target);
  const ok = getAllowedFileRoots(false).some(root => {
    const resolvedRoot = normalizeFsPath(root);
    const realRoot = realpathLoose(resolvedRoot);
    return resolvedRoot && target && target !== resolvedRoot && isInsidePath(resolvedRoot, target) &&
      realTarget !== realRoot && isInsidePath(realRoot, realTarget);
  });
  if (!ok) throw new Error('Path is outside configured AnimeVault folders');
}

// Only cached artwork and thumbnails inside userData are servable as images;
// config, tokens and indexes never are, even though they share the folder.
function isServableUserDataImage(fp) {
  const ud = normalizeFsPath(app.getPath('userData'));
  if (!ud || !isInsidePath(ud, fp)) return false;
  const first = path.relative(ud, fp).split(/[\\/]/)[0].toLowerCase();
  return first === 'cover-cache' || first === 'thumbnails';
}

// Executables the app launches (player, reader). Empty means "use the default".
function isValidExecutableSetting(v) {
  if (v === '' || v == null) return true;
  if (typeof v !== 'string' || v.length > 1024 || !path.isAbsolute(v)) return false;
  return process.platform !== 'win32' || path.extname(v).toLowerCase() === '.exe';
}

// Renderer-supplied config values. Credentials may only be cleared from the
// renderer (disconnect / reset) — tokens are written by the main process alone.
const RENDERER_CLEAR_ONLY_KEYS = new Set(['malAccessToken', 'malRefreshToken', 'malCodeVerifier', 'malTokenExpiry']);
function validateRendererConfigValue(key, value) {
  if (RENDERER_CLEAR_ONLY_KEYS.has(key)) {
    if (value !== '' && value !== 0 && value !== null && value !== undefined) throw new Error('Credentials cannot be set from the UI: ' + key);
    return;
  }
  if (key === 'vlcPath' || key === 'mpvPath' || key === 'readerPath') {
    if (!isValidExecutableSetting(value)) throw new Error('Invalid program path for ' + key);
    return;
  }
  if (key === 'folders' || key === 'mangaFolders') {
    if (!Array.isArray(value) || value.length > 200) throw new Error('Invalid folder list');
    for (const f of value) {
      if (!f || typeof f !== 'object' || typeof f.path !== 'string' || !path.isAbsolute(f.path)) throw new Error('Library folders need an absolute path');
      if (isForbiddenRoot(f.path)) throw new Error('That folder can’t be a library folder: ' + f.path);
    }
    return;
  }
  if (key === 'playerType') {
    if (value != null && value !== '' && !['vlc', 'mpv', 'system-default'].includes(value)) throw new Error('Unknown player: ' + value);
    return;
  }
  if (key === 'releasePickerScopes') {
    if (value == null) return;
    if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['latest', 'episode', 'series'].includes(k) || typeof value[k] !== 'boolean')) throw new Error('Invalid release picker scopes');
    return;
  }
  if (key === 'audioDelayMs') {
    if (value != null && (!Number.isInteger(value) || value < 0 || value > 5000)) throw new Error('Audio delay must be 0-5000 ms');
    return;
  }
  if (key === 'watcherFolder' || key === 'watcherDest') {
    if (value && (typeof value !== 'string' || !path.isAbsolute(value) || isForbiddenRoot(value))) throw new Error('That folder can’t be watched: ' + value);
  }
}

function isSafeExternalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const u = new URL(rawUrl);
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'magnet:';
  } catch (e) {
    return false;
  }
}

module.exports = {
  assertAllowedChildFileActionPath,
  assertAllowedFileActionPath,
  isAllowedFileActionPath,
  isForbiddenRoot,
  isInsidePath,
  isSafeExternalUrl,
  isSafeFileName,
  isServableUserDataImage,
  moveNoClobber,
  normalizeFsPath,
  validateRendererConfigValue,
};
