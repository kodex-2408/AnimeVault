'use strict';

// main/scanner/organizer.js - File Management: rename, group/ungroup, batch,
// format and undo (manager:* handlers).

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { config } = require('../state');
const { assertAllowedChildFileActionPath, assertAllowedFileActionPath, isAllowedFileActionPath, isSafeFileName, moveNoClobber } = require('../config/security');
const { cleanFolderName, detectResolution, extractSeriesName, getMangaFiles, getVideoFiles, parseChapterNumber, parseEpisodeNumber, parseMangaFilename, parseVideoFilename } = require('./parsers');
const { getModeConfigMap, getTitleAlias, getWatchHistoryStore, saveConfig } = require('../config/config');
const { getCoverCachePath, getExistingCoverCachePath } = require('../services/covers');
const { _doScanLibrary } = require('./library');

// ---- Organizer undo log: every run that touches disk records its moves so
// "Undo last operation" can reverse exactly that run (newest move first).
const FORMAT_UNDO_PATH = () => path.join(app.getPath('userData'), 'format-undo.json');
function saveOrganizerUndo(label, moves) {
  if (!moves.length) return;
  fs.writeFileSync(FORMAT_UNDO_PATH(), JSON.stringify({ version: 2, label, createdAt: new Date().toISOString(), moves }));
}
function organizerMediaScanner() {
  return config.vaultMode === 'manga' ? getMangaFiles : getVideoFiles;
}
// "Series - 05 (1080p) (HEVC).mkv" / "Series - Ch 05.cbz" for a known series name.
function buildMediaFileName(seriesName, fileName) {
  const ext = path.extname(fileName);
  if (config.vaultMode === 'manga') {
    const ch = parseChapterNumber(fileName);
    if (ch === null || !(ch > 0)) return null;
    return `${seriesName} - Ch ${String(ch).padStart(2, '0')}${ext}`;
  }
  const ep = parseEpisodeNumber(fileName);
  if (ep === null || !(ep > 0)) return null;
  const codec = /\b(?:HEVC|x265|H\.265)\b/i.test(fileName) ? 'HEVC' : 'H.264';
  return `${seriesName} - ${String(ep).padStart(2, '0')} (${detectResolution(fileName)}) (${codec})${ext}`;
}
function parseLooseMedia(fileName, folderName) {
  return config.vaultMode === 'manga' ? parseMangaFilename(fileName, folderName) : parseVideoFilename(fileName, folderName);
}
// Renames every media file directly inside `folder` to "<seriesName> - NN…".
function renameFilesForSeries(folder, seriesName, dryRun, moves, results) {
  for (const file of organizerMediaScanner()(folder, false)) {
    const target = buildMediaFileName(seriesName, file.name);
    if (!target || !isSafeFileName(target)) { results.push({ type: 'File', file: file.name, old: file.name, status: 'no episode number' }); continue; }
    if (target === file.name) { results.push({ type: 'File', file: file.name, old: file.name, status: 'skip' }); continue; }
    const to = path.join(folder, target);
    if (dryRun) { results.push({ type: 'File', file: file.name, old: file.name, new: target, newName: target, status: 'preview' }); continue; }
    try {
      moveNoClobber(file.path, to);
      moves.push({ from: to, to: file.path });
      results.push({ type: 'File', file: file.name, old: file.name, new: target, newName: target, status: 'renamed' });
    } catch (e) { results.push({ type: 'File', file: file.name, old: file.name, status: 'error', error: e.message }); }
  }
}

// Rename inside a folder: files take the (optionally new) folder name.
async function formatSeriesFolder(folderPath, newFolderName) {
  try {
    assertAllowedChildFileActionPath(folderPath);
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) throw new Error('Folder not found');
    const name = String(newFolderName || path.basename(folderPath)).trim();
    if (!isSafeFileName(name)) throw new Error('Invalid folder name');
    const results = [], moves = [];
    renameFilesForSeries(folderPath, name, false, moves, results);
    let newPath = folderPath;
    if (name !== path.basename(folderPath)) {
      const to = path.join(path.dirname(folderPath), name);
      try { moveNoClobber(folderPath, to); moves.push({ from: to, to: folderPath }); newPath = to; results.push({ type: 'Folder', file: path.basename(folderPath), old: path.basename(folderPath), new: name, newName: name, status: 'renamed' }); }
      catch (e) { results.push({ type: 'Folder', file: path.basename(folderPath), status: 'error', error: e.message }); }
    }
    saveOrganizerUndo('Rename inside folder', moves);
    return { success: true, newPath, results };
  } catch (e) { return { success: false, error: e.message }; }
}

function register() {
  ipcMain.handle('manager:renameSeries', async (_, seriesPath, oldName, newName) => {
    try {
      assertAllowedChildFileActionPath(seriesPath);
      const cleanName = String(newName || '').trim();
      if (!isSafeFileName(cleanName)) {
        return { success: false, error: 'That isn’t a valid Windows folder name (no \\ / : * ? " < > |, and it can’t end with a dot or space)' };
      }
      if (!fs.existsSync(seriesPath) || !fs.statSync(seriesPath).isDirectory()) {
        return { success: false, error: 'Series folder not found' };
      }
      const currentName = String(oldName || path.basename(seriesPath));
      const destination = path.join(path.dirname(seriesPath), cleanName);
      assertAllowedChildFileActionPath(destination);
      // A case-only rename ("one piece" -> "One Piece") targets the same folder.
      if (destination.toLowerCase() !== seriesPath.toLowerCase() && fs.existsSync(destination)) {
        return { success: false, error: 'A folder with that name already exists' };
      }

      const scanner = config.vaultMode === 'manga' ? getMangaFiles : getVideoFiles;
      const parser = config.vaultMode === 'manga' ? parseChapterNumber : parseEpisodeNumber;
      const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const changes = scanner(seriesPath).map(file => {
        const ext = path.extname(file.name);
        const base = path.parse(file.name).name;
        let renamed = base.replace(new RegExp('^' + escapeRe(currentName), 'i'), cleanName);
        if (renamed === base) {
          const ep = parser(file.name);
          const suffix = base.match(/(\s+(?:S\d{1,2}E\d{1,3}|-\s*(?:Ep\s*|Ch\s*)?\d{1,4}).*)$/i);
          renamed = suffix ? cleanName + suffix[1] : (ep ? `${cleanName} - ${String(ep).padStart(2, '0')}` : base);
        }
        return { from: file.path, to: path.join(seriesPath, renamed + ext), old: file.name, name: renamed + ext };
      }).filter(change => change.from !== change.to);

      const targets = new Set();
      for (const change of changes) {
        const key = change.to.toLowerCase();
        if (targets.has(key) || (fs.existsSync(change.to) && change.from.toLowerCase() !== key)) {
          return { success: false, error: `Rename collision: ${path.basename(change.to)}` };
        }
        targets.add(key);
      }
      const completed = [];
      try {
        for (const change of changes) {
          fs.renameSync(change.from, change.to);
          completed.push(change);
        }
        if (destination !== seriesPath) fs.renameSync(seriesPath, destination);
      } catch (renameError) {
        for (const change of completed.reverse()) {
          try { if (fs.existsSync(change.to)) fs.renameSync(change.to, change.from); } catch (_) {}
        }
        return { success: false, error: `Rename rolled back: ${renameError.message}` };
      }

      const history = getWatchHistoryStore();
      if (history[currentName]) {
        history[cleanName] = history[currentName];
        delete history[currentName];
      }
      for (const key of ['titleAliases','gapRules']) {
        const modeMap = getModeConfigMap(key);
        if (modeMap[currentName]) {
          modeMap[cleanName] = modeMap[currentName];
          delete modeMap[currentName];
        }
      }
      const samePath = (a, b) => { try { return !!a && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase(); } catch (e) { return false; } };
      for (const entry of config.autoDownloadWatchlist || []) {
        if (entry.seriesName === currentName) entry.seriesName = cleanName;
        if (samePath(entry.seriesPath, seriesPath)) entry.seriesPath = destination;
      }
      // Name lists the UI keeps (muted duplicate warnings, known series, import
      // review choices) follow the new name too.
      const mode = config.vaultMode === 'manga' ? 'manga' : 'anime';
      for (const key of ['mutedDupSeries', mode + 'KnownSeries', mode + 'ImportReviewDismissed']) {
        if (Array.isArray(config[key])) config[key] = config[key].map(n => (n === currentName ? cleanName : n)).filter((n, i, all) => all.indexOf(n) === i);
      }
      const oldCover = getExistingCoverCachePath(currentName);
      const newCover = getCoverCachePath(cleanName);
      if (oldCover && !fs.existsSync(newCover)) fs.copyFileSync(oldCover, newCover);
      saveConfig();
      _doScanLibrary();
      return { success: true, oldName: currentName, newName: cleanName, path: destination, filesRenamed: changes.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ================================================================
  //  FILE MANAGER
  // ================================================================
  ipcMain.handle('manager:previewParse', (_, filename, folderName = '') => {
    if (typeof filename !== 'string' || !filename.trim() || filename.length > 500) {
      return { error: 'Enter a valid filename' };
    }
    if (typeof folderName !== 'string' || folderName.length > 260) return { error: 'Invalid folder name' };
    const parsed = config.vaultMode === 'manga'
      ? parseMangaFilename(path.basename(filename), folderName)
      : parseVideoFilename(path.basename(filename), folderName);
    return {
      ...parsed,
      mediaNumber: config.vaultMode === 'manga' ? parseChapterNumber(filename) : parseEpisodeNumber(filename),
      searchTitles: parsed.series ? {
        mal: getTitleAlias(parsed.series, 'mal'),
        anilist: getTitleAlias(parsed.series, 'anilist'),
        nyaa: getTitleAlias(parsed.series, 'nyaa')
      } : null
    };
  });

  // Legacy: rename files inside each series subfolder of a root (not used by the 5.x UI).
  ipcMain.handle('manager:rename', async (_, rootFolder, dryRun = true) => {
    if (!isAllowedFileActionPath(rootFolder)) return { error: 'Folder is outside configured AnimeVault folders' };
    if (!fs.existsSync(rootFolder)) return { error: 'Folder not found' };
    const results = [], moves = [];
    try {
      const dirs = fs.readdirSync(rootFolder, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const dir of dirs) {
        const dirPath = path.join(rootFolder, dir.name);
        for (const file of getVideoFiles(dirPath)) {
          const parsed = parseVideoFilename(file.name, dir.name);
          if (!parsed.matched || !isSafeFileName(parsed.newName) || parsed.newName === file.name) continue;
          const newPath = path.join(dirPath, parsed.newName);
          try {
            if (!dryRun) { moveNoClobber(file.path, newPath); moves.push({ from: newPath, to: file.path }); }
            results.push({ old: file.name, new: parsed.newName, series: parsed.series, status: dryRun ? 'preview' : 'renamed' });
          } catch (e) { results.push({ old: file.name, status: 'error', error: e.message }); }
        }
      }
    } catch (e) { return { error: e.message }; }
    if (!dryRun) saveOrganizerUndo('Rename', moves);
    return { results };
  });

  // Legacy: group loose files of a folder into per-series folders (not used by the 5.x UI).
  ipcMain.handle('manager:group', async (_, rootFolder, seasonalFolder, dryRun = true) => {
    if (!isAllowedFileActionPath(rootFolder) || (seasonalFolder && !isAllowedFileActionPath(seasonalFolder))) return { error: 'Folder is outside configured AnimeVault folders' };
    if (!fs.existsSync(rootFolder)) return { error: 'Folder not found' };
    const results = [], moves = [];
    try {
      for (const file of getVideoFiles(rootFolder)) {
        const parsed = parseVideoFilename(file.name);
        if (!parsed.matched || !isSafeFileName(parsed.series) || !isSafeFileName(parsed.newName)) continue;
        const seriesDir = path.join(seasonalFolder || rootFolder, parsed.series);
        const newPath = path.join(seriesDir, parsed.newName);
        try {
          if (!dryRun) { fs.mkdirSync(seriesDir, { recursive: true }); moveNoClobber(file.path, newPath); moves.push({ from: newPath, to: file.path }); }
          results.push({ file: file.name, series: parsed.series, newName: parsed.newName, status: dryRun ? 'preview' : 'moved' });
        } catch (e) { results.push({ file: file.name, status: 'error', error: e.message }); }
      }
    } catch (e) { return { error: e.message }; }
    if (!dryRun) saveOrganizerUndo('Group', moves);
    return { results };
  });

  // Ungroup: move the media files of `folder` up into its parent, then remove
  // the folder when nothing is left in it. Only ever touches that one folder.
  ipcMain.handle('manager:ungroup', async (_, parentFolder, folder, dryRun = true) => {
    try {
      assertAllowedChildFileActionPath(folder);
      const parent = path.dirname(path.resolve(folder));
      if (parentFolder && path.resolve(parentFolder) !== parent) return { error: 'Parent folder does not match' };
      assertAllowedFileActionPath(parent);
      if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return { error: 'Folder not found' };
      const results = [], moves = [];
      for (const file of organizerMediaScanner()(folder, false)) {
        const to = path.join(parent, file.name);
        if (dryRun) { results.push({ file: file.name, status: 'preview' }); continue; }
        try {
          moveNoClobber(file.path, to);
          moves.push({ from: to, to: file.path });
          results.push({ file: file.name, status: 'moved' });
        } catch (e) { results.push({ file: file.name, status: fs.existsSync(to) ? 'already exists in parent' : 'error', error: e.message }); }
      }
      if (!dryRun) {
        saveOrganizerUndo('Ungroup', moves);
        try { if (!fs.readdirSync(folder).length) fs.rmdirSync(folder); } catch (e) { /* keep non-empty folder */ }
      }
      return { results };
    } catch (e) { return { error: e.message }; }
  });

  // Batch: for every series subfolder of `batchFolder`, clean the folder name
  // and rename the media files inside to match it.
  ipcMain.handle('manager:batch', async (_, batchFolder, dryRun = true) => {
    if (!isAllowedFileActionPath(batchFolder)) return { error: 'Folder is outside configured AnimeVault folders' };
    if (!fs.existsSync(batchFolder)) return { error: 'Folder not found' };
    const results = [], moves = [];
    try {
      const dirs = fs.readdirSync(batchFolder, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.'));
      for (const dir of dirs) {
        let dirPath = path.join(batchFolder, dir.name);
        if (!organizerMediaScanner()(dirPath, false).length) continue;
        const info = extractSeriesName(dir.name);
        const clean = String(info.title || cleanFolderName(dir.name)).trim();
        if (clean && clean !== dir.name) {
          if (!isSafeFileName(clean)) { results.push({ type: 'Folder', old: dir.name, status: 'error', error: 'Invalid folder name' }); continue; }
          const to = path.join(batchFolder, clean);
          if (dryRun) results.push({ type: 'Folder', old: dir.name, new: clean, status: 'preview' });
          else {
            try { moveNoClobber(dirPath, to); moves.push({ from: to, to: dirPath }); results.push({ type: 'Folder', old: dir.name, new: clean, status: 'renamed' }); dirPath = to; }
            catch (e) { results.push({ type: 'Folder', old: dir.name, status: 'error', error: e.message }); continue; }
          }
        }
        renameFilesForSeries(dirPath, clean || dir.name, dryRun, moves, results);
      }
    } catch (e) { return { error: e.message }; }
    if (!dryRun) saveOrganizerUndo('Batch process', moves);
    return { results: results.filter(r => r.status !== 'skip') };
  });

  // Format loose files: every media file directly inside `sourceFolder` moves to
  // <destFolder>/<Series>/<clean name>.
  ipcMain.handle('manager:format', async (_, sourceFolder, destFolder) => {
    const dest = destFolder || sourceFolder;
    if (!isAllowedFileActionPath(sourceFolder) || !isAllowedFileActionPath(dest)) return { error: 'Folder is outside configured AnimeVault folders' };
    if (!fs.existsSync(sourceFolder)) return { error: 'Source folder not found' };
    const results = [], moves = [];
    try {
      for (const file of organizerMediaScanner()(sourceFolder, false)) {
        const parsed = parseLooseMedia(file.name);
        if (!parsed.matched || !parsed.series) { results.push({ file: file.name, status: 'no match' }); continue; }
        if (!isSafeFileName(parsed.series) || !isSafeFileName(parsed.newName)) { results.push({ file: file.name, status: 'unsafe name' }); continue; }
        const seriesDir = path.join(dest, parsed.series);
        const to = path.join(seriesDir, parsed.newName);
        try {
          fs.mkdirSync(seriesDir, { recursive: true });
          moveNoClobber(file.path, to);
          moves.push({ from: to, to: file.path });
          results.push({ file: file.name, series: parsed.series, newName: parsed.newName, status: 'formatted' });
        } catch (e) { results.push({ file: file.name, status: fs.existsSync(to) ? 'already exists' : 'error', error: e.message }); }
      }
    } catch (e) { return { error: e.message }; }
    saveOrganizerUndo('Format loose files', moves);
    return { results };
  });

  ipcMain.handle('manager:formatFolder', (_, folderPath, newFolderName) => formatSeriesFolder(folderPath, newFolderName));
  ipcMain.handle('manager:formatManga', (_, folderPath, newFolderName) => formatSeriesFolder(folderPath, newFolderName));

  ipcMain.handle('manager:undoFormat', async () => {
    try {
      const undoPath = FORMAT_UNDO_PATH();
      if (!fs.existsSync(undoPath)) return { error: 'Nothing to undo' };
      const data = JSON.parse(fs.readFileSync(undoPath, 'utf-8'));
      // v2: { moves: [{ from: current, to: original }] }; v1 (≤5.0): [{ old: current, new: original }]
      const moves = Array.isArray(data) ? data.map(op => ({ from: op && op.old, to: op && op.new })) : (data && Array.isArray(data.moves) ? data.moves : null);
      if (!moves) throw new Error('Invalid undo data format');
      const results = [];
      for (const op of moves.slice().reverse()) {
        if (!op || typeof op.from !== 'string' || typeof op.to !== 'string') continue;
        const label = path.basename(op.from);
        try {
          assertAllowedFileActionPath(op.from);
          assertAllowedFileActionPath(op.to);
          if (!fs.existsSync(op.from)) { results.push({ file: label, status: 'missing' }); continue; }
          fs.mkdirSync(path.dirname(op.to), { recursive: true });
          moveNoClobber(op.from, op.to);
          results.push({ file: label, restored: path.basename(op.to), status: 'restored' });
        } catch (e) { results.push({ file: label, status: 'error', error: e.message }); }
      }
      fs.unlinkSync(undoPath);
      return { success: true, results };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('manager:hasUndo', () => fs.existsSync(FORMAT_UNDO_PATH()));
}

module.exports = {
  register,
};
