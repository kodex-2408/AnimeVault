'use strict';

// main/scanner/library.js - library layout (category containers), the
// incremental library scan and its index, and library:* handlers.

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { state, config } = require('../state');
const { LIBRARY_INDEX_PATH, getWatchHistoryStore, safeHistoryKey, saveConfig } = require('../config/config');
const { assertPlayableMedia, getMangaFiles, getVideoFiles, mangaChapterFileName, mediaDisplayTitle, parseChapterNumber, parseEpisodeNumber, parseMediaNumber } = require('./parsers');
const { getExistingCoverCachePath } = require('../services/covers');
const { coverFileVersion } = require('../services/anilist');
const { scheduleDuplicateCheck } = require('./duplicates');
const { assertAllowedChildFileActionPath, assertAllowedFileActionPath, isAllowedFileActionPath, trashOrDelete } = require('../config/security');

let _libraryIndex = null;
let _libraryIndexSaveTimer = null;

function readLibraryIndex() {
  if (_libraryIndex) return _libraryIndex;
  try {
    const parsed = JSON.parse(fs.readFileSync(LIBRARY_INDEX_PATH, 'utf-8'));
    if (parsed && parsed.version === 2) _libraryIndex = parsed;
  } catch (e) {}
  if (!_libraryIndex) _libraryIndex = { version: 2, anime: {}, manga: {} };
  return _libraryIndex;
}

function scheduleLibraryIndexSave() {
  if (_libraryIndexSaveTimer) clearTimeout(_libraryIndexSaveTimer);
  _libraryIndexSaveTimer = setTimeout(() => {
    _libraryIndexSaveTimer = null;
    try {
      const tmp = LIBRARY_INDEX_PATH + '.tmp';
      fs.mkdirSync(path.dirname(LIBRARY_INDEX_PATH), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(readLibraryIndex()));
      try { fs.renameSync(tmp, LIBRARY_INDEX_PATH); }
      catch (e) { fs.copyFileSync(tmp, LIBRARY_INDEX_PATH); fs.unlinkSync(tmp); }
    } catch (e) { console.error('[LibraryIndex] Save failed:', e.message); }
  }, 300);
}

function clearLibraryIndex() {
  _libraryIndex = { version: 2, anime: {}, manga: {} };
  if (fs.existsSync(LIBRARY_INDEX_PATH)) {
    try { fs.unlinkSync(LIBRARY_INDEX_PATH); } catch (e) {}
  }
}

function resolveTrackedLocalSeries(seriesName, malId, seriesPath) {
  const pathKey = seriesPath ? path.resolve(seriesPath).toLowerCase() : '';
  if (pathKey) {
    const byPath = state.lastLibraryScan.find(s => s.path && path.resolve(s.path).toLowerCase() === pathKey);
    if (byPath) return byPath;
  }
  const byExactName = state.lastLibraryScan.find(s => s.name === seriesName);
  if (byExactName) return byExactName;
  const byCaseInsensitiveName = state.lastLibraryScan.filter(s =>
    String(s.name || '').toLocaleLowerCase() === String(seriesName || '').toLocaleLowerCase()
  );
  if (byCaseInsensitiveName.length === 1) return byCaseInsensitiveName[0];
  if (malId) {
    const byMalId = state.lastLibraryScan.filter(s =>
      s.watchData && Number(s.watchData.malId) === Number(malId)
    );
    // A MAL fallback is safe only when it resolves exactly one local folder.
    // Multiple folders generally mean distinct seasons or a stale duplicate.
    if (byMalId.length === 1) return byMalId[0];
  }
  return null;
}

function getLocalHighestEpisode(seriesName, malId, seriesPath) {
  const localSeries = resolveTrackedLocalSeries(seriesName, malId, seriesPath);
  const nums = (localSeries ? [localSeries] : [])
    .flatMap(s => s.episodes || [])
    .map(f => parseMediaNumber(f.name))
    .filter(n => n !== null && !isNaN(n));
  if (!nums.length) return 0;
  return Math.max(...nums);
}

function getLocalEpisodes(seriesName, malId, seriesPath) {
  const localSeries = resolveTrackedLocalSeries(seriesName, malId, seriesPath);
  const nums = (localSeries ? [localSeries] : [])
    .flatMap(s => s.episodes || [])
    .map(f => parseMediaNumber(f.name))
    .filter(n => n !== null && !isNaN(n));
  return nums;
}

let lastScanStats = { cacheHits: 0, cacheMisses: 0, durationMs: 0, series: 0 };

// Newest modification time of a folder and its subfolders (a few levels deep):
// adding a file to "Season 2/" doesn't touch the series folder's own mtime.
function folderTreeMtime(dir, depth = 3) {
  let newest = 0;
  try { newest = fs.statSync(dir).mtimeMs; } catch (e) { return 0; }
  if (depth <= 0) return newest;
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory() && !ent.name.startsWith('.')) newest = Math.max(newest, folderTreeMtime(path.join(dir, ent.name), depth - 1));
    }
  } catch (e) {}
  return newest;
}

// A series folder is read with its subfolders ("Season 1/", "Season 2/"), the
// same way the detail view lists episodes, so counts always agree.
function getIndexedMediaFiles(seriesPath, scanner, mode, force) {
  const index = readLibraryIndex();
  const bucket = index[mode] || (index[mode] = {});
  const key = path.resolve(seriesPath).toLowerCase();
  const mtimeMs = folderTreeMtime(seriesPath);
  const cached = bucket[key];
  if (!force && config.incrementalScan !== false && cached && cached.mtimeMs === mtimeMs && Array.isArray(cached.files)) {
    lastScanStats.cacheHits++;
    return cached.files.map(file => ({ ...file }));
  }
  lastScanStats.cacheMisses++;
  const files = scanner(seriesPath, true);
  bucket[key] = { path: seriesPath, mtimeMs, files };
  return files;
}

function isLikelyMangaHistory(watchData) {
  const data = watchData && watchData.malData || {};
  const type = String(data.media_type || '').toLowerCase();
  const list = data.my_list_status || {};
  return /manga|novel|manhwa|manhua|one_shot|doujin/.test(type) ||
    data.num_chapters != null || list.num_chapters_read != null || list.status === 'reading' || list.status === 'plan_to_read';
}

// ---- Library layout ----------------------------------------------------------
// A library folder's category comes from its type; a folder left as "custom"
// (or added before types existed) is named after its contents more often than
// not, so its label or folder name decides ("Movies", "Seasonal", "Series").
// Inside a library folder, a subfolder named like a category ("movies",
// "seasonal", "series"…) that holds series folders is a container: its
// subfolders are the series, filed under that category.
const CATEGORY_DIR_NAMES = {
  movies: 'movies', movie: 'movies', films: 'movies',
  seasonal: 'seasonal', airing: 'seasonal', simulcast: 'seasonal',
  series: 'series', shows: 'series', 'tv shows': 'series', 'tv series': 'series',
  ova: 'ova', ovas: 'ova', specials: 'ova',
};
function categoryForName(name) {
  return CATEGORY_DIR_NAMES[String(name || '').toLowerCase().replace(/[_.-]+/g, ' ').trim()] || null;
}
function inferFolderType(folder) {
  if (!folder) return 'custom';
  const t = String(folder.type || '').toLowerCase();
  if (t && t !== 'custom') return t;
  return categoryForName(folder.label) || categoryForName(path.basename(String(folder.path || ''))) || 'custom';
}
function hasSubdirectories(dirPath) {
  try { return fs.readdirSync(dirPath, { withFileTypes: true }).some(d => d.isDirectory() && !d.name.startsWith('.')); }
  catch (e) { return false; }
}
// Every series folder under a configured library folder, with its category.
function listSeriesDirs(folder) {
  const out = [];
  if (!folder || !folder.path || !fs.existsSync(folder.path)) return out;
  const folderCategory = inferFolderType(folder);
  let dirs = [];
  try { dirs = fs.readdirSync(folder.path, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')); }
  catch (e) { return out; }
  for (const dir of dirs) {
    const dirPath = path.join(folder.path, dir.name);
    const containerCategory = categoryForName(dir.name);
    if (containerCategory && hasSubdirectories(dirPath)) {
      try {
        for (const child of fs.readdirSync(dirPath, { withFileTypes: true })) {
          if (child.isDirectory() && !child.name.startsWith('.')) out.push({ name: child.name, path: path.join(dirPath, child.name), category: containerCategory });
        }
      } catch (e) { /* unreadable container */ }
      // Loose media directly in the container (e.g. movie files) still shows as one entry.
      out.push({ name: dir.name, path: dirPath, category: containerCategory, containerOnly: true });
      continue;
    }
    out.push({ name: dir.name, path: dirPath, category: folderCategory });
  }
  return out;
}

function getConfiguredAnimeSeriesNames() {
  const names = new Set();
  for (const folder of config.folders || []) listSeriesDirs(folder).forEach(d => names.add(d.name));
  return names;
}

// ---- Auto-rename for new manga series ----------------------------------------
// The first time a manga series folder shows up in the library its chapter
// files are renamed to "Series - Ch 012 - Title.cbz". Folders the library
// already knew are never touched, and the very first scan after this feature
// arrives (or the first scan of a newly added library folder) only records
// what is there. A folder whose files are still being
// copied is retried on the next scan. Renames go to the organizer's undo log.
const MANGA_RENAME_IDLE_MS = 60 * 1000;
function autoRenameMangaFolder(seriesPath, seriesName, moves) {
  let pending = false;
  const taken = new Set();
  let files;
  try { files = getMangaFiles(seriesPath, false); } catch (e) { return { done: false }; }
  for (const f of files) taken.add(f.name.toLowerCase());
  for (const f of files) {
    const target = mangaChapterFileName(f.name, seriesName);
    if (!target || target === f.name || target.length > 240) continue;
    if (target.toLowerCase() === f.name.toLowerCase()) continue;
    if (taken.has(target.toLowerCase())) continue;
    try {
      if (Date.now() - fs.statSync(f.path).mtimeMs < MANGA_RENAME_IDLE_MS) { pending = true; continue; }
      const to = path.join(seriesPath, target);
      if (fs.existsSync(to)) continue;
      fs.renameSync(f.path, to);
      taken.delete(f.name.toLowerCase());
      taken.add(target.toLowerCase());
      moves.push({ from: to, to: f.path });
    } catch (e) {
      pending = true; // locked or still copying: try again next scan
      console.warn('[AutoRename]', f.name, e.message);
    }
  }
  return { done: !pending };
}
function recordAutoRenames(moves) {
  if (!moves.length) return;
  console.log('[AutoRename] Renamed', moves.length, 'chapter file(s)');
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'format-undo.json'),
      JSON.stringify({ version: 2, label: 'Auto-rename new manga chapters', createdAt: new Date().toISOString(), moves }));
  } catch (e) { console.warn('[AutoRename] Undo log not written:', e.message); }
}

function _doScanLibrary(force = false) {
  const startedAt = Date.now();
  const isManga = config.vaultMode === 'manga';
  const mode = isManga ? 'manga' : 'anime';
  const activeFolders = isManga ? config.mangaFolders : config.folders;
  const scanner = isManga ? getMangaFiles : getVideoFiles;
  const history = getWatchHistoryStore();
  const animeNames = isManga ? getConfiguredAnimeSeriesNames() : new Set();
  let migratedHistory = false;
  const liveIndexKeys = new Set();
  lastScanStats = { cacheHits: 0, cacheMisses: 0, durationMs: 0, series: 0 };

  const library = [];
  // Manga series folders seen before; null on the first scan with this feature.
  const firstRenamePass = isManga && (!config.mangaSeenSeries || typeof config.mangaSeenSeries !== 'object');
  const seenSeries = isManga ? (firstRenamePass ? {} : config.mangaSeenSeries) : null;
  let seenChanged = firstRenamePass;
  const renameMoves = [];
  for (const folder of (activeFolders || [])) {
    if (!folder || !folder.path || !fs.existsSync(folder.path)) continue;
    // A library folder added later (an existing collection) is recorded, not
    // renamed, the same as the very first scan.
    const rootKey = 'root:' + path.resolve(folder.path).toLowerCase();
    const seedOnly = firstRenamePass || (seenSeries && !seenSeries[rootKey]);
    if (seenSeries && !seenSeries[rootKey]) { seenSeries[rootKey] = 1; seenChanged = true; }
    try {
      for (const dir of listSeriesDirs(folder)) {
        const seriesPath = dir.path;
        const seriesKey = path.resolve(seriesPath).toLowerCase();
        liveIndexKeys.add(seriesKey);
        let renamedHere = false;
        if (seenSeries && !dir.containerOnly && !seenSeries[seriesKey]) {
          let done = true;
          if (!seedOnly && config.mangaAutoRename !== false) {
            const before = renameMoves.length;
            done = autoRenameMangaFolder(seriesPath, dir.name, renameMoves).done;
            renamedHere = renameMoves.length > before;
          }
          if (done) { seenSeries[seriesKey] = 1; seenChanged = true; }
        }
        // A category container only contributes its own loose files, never its
        // series subfolders a second time.
        const files = (dir.containerOnly ? scanner(seriesPath, false) : getIndexedMediaFiles(seriesPath, scanner, mode, !!force || renamedHere)).map(f => { const episodeNum = parseMediaNumber(f.name); return { ...f, episodeNum, title: mediaDisplayTitle(f.name, dir.name, episodeNum) }; });
        if (files.length === 0) continue;

        // Parse all episode numbers
        const episodeNumbers = files
          .map(f => f.episodeNum)
          .filter(n => n !== null && !isNaN(n));

        const episodeCount = episodeNumbers.length;
        const maxEpisode = episodeNumbers.length ? Math.max(...episodeNumbers) : 0;

        // Read watch data
        if (isManga && !history[dir.name] && config.watchHistory[dir.name] &&
            (isLikelyMangaHistory(config.watchHistory[dir.name]) || !animeNames.has(dir.name))) {
          history[dir.name] = JSON.parse(JSON.stringify(config.watchHistory[dir.name]));
          migratedHistory = true;
        }
        const watchData = history[dir.name] || {};
        const episodesWatched = Array.isArray(watchData.episodesWatched) ? watchData.episodesWatched : [];
        const lastWatched = watchData.lastWatched || '';
        const malId = watchData.malId || null;
        const malData = watchData.malData || null;
        const tags = Array.isArray(watchData.tags) ? watchData.tags : [];
        // A per-series category the user picked wins; "custom" is the old default, not a choice.
        const category = (watchData.category && watchData.category !== 'custom' ? watchData.category : '') || dir.category || 'custom';
        const coverCached = getExistingCoverCachePath(dir.name);

        library.push({
          name: dir.name,
          path: seriesPath,
          episodes: files,
          episodeCount,
          maxEpisode,
          folder: folder.path,
          watchData: { episodesWatched, lastWatched, malId, malData, tags },
          category,
          coverCached,
          coverVersion: coverFileVersion(coverCached)
        });
      }
    } catch (e) {
      console.error('[Scan] Error scanning', folder.path, e.message);
    }
  }

  // Sort: featured first (highest episode count), then alphabetical
  library.sort((a, b) => {
    if (b.episodeCount !== a.episodeCount) return b.episodeCount - a.episodeCount;
    return a.name.localeCompare(b.name);
  });

  const bucket = readLibraryIndex()[mode] || {};
  Object.keys(bucket).forEach(key => { if (!liveIndexKeys.has(key)) delete bucket[key]; });
  scheduleLibraryIndexSave();
  recordAutoRenames(renameMoves);
  if (seenChanged) config.mangaSeenSeries = seenSeries;
  if (migratedHistory || seenChanged) saveConfig();
  state.lastLibraryScan = library;
  state.libraryScanReady = true;
  lastScanStats.durationMs = Date.now() - startedAt;
  lastScanStats.series = library.length;
  return library;
}

// When a series folder is deleted, drop it from the auto-download watchlist so
// the Nyaa poller never produces new-episode notifications for a removed series.
// Controlled by the "untrackOnDelete" setting (default on).
function untrackDeletedSeries(dirName, seriesPath) {
  if (config.untrackOnDelete === false) return 0;
  const watchlist = config.autoDownloadWatchlist;
  if (!Array.isArray(watchlist) || !watchlist.length) return 0;
  // A tracked entry may be stored under its MAL title rather than the folder
  // name, so match by MAL id and by loosely compared names as well as path.
  const watchData = getWatchHistoryStore()[safeHistoryKey(dirName)] || {};
  const malId = Number(watchData.malId) || 0;
  const loose = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const names = new Set([loose(dirName), loose(watchData.malData && watchData.malData.title)].filter(Boolean));
  let target = '';
  try { target = seriesPath ? path.resolve(seriesPath).toLowerCase() : ''; } catch (e) {}
  const before = watchlist.length;
  config.autoDownloadWatchlist = watchlist.filter(w => {
    if (!w) return false;
    if (malId && Number(w.malId) === malId) return false;
    if (names.has(loose(w.seriesName))) return false;
    if (target && w.seriesPath) {
      try { if (path.resolve(w.seriesPath).toLowerCase() === target) return false; } catch (e) { /* malformed path */ }
    }
    return true;
  });
  const removed = before - config.autoDownloadWatchlist.length;
  if (removed) saveConfig();
  return removed;
}

function register() {
  ipcMain.handle('library:scan', async (_, force = false) => {
    const library = _doScanLibrary(!!force);
    // Duplicate analysis is useful but should not hold the initial library IPC.
    scheduleDuplicateCheck(library);
    // The scheduled auto-download poller starts after the startup window has
    // settled; avoid launching a second network-heavy series pass here.
    return library;
  });
  ipcMain.handle('library:getScanStats', () => ({ ...lastScanStats }));
  ipcMain.handle('library:clearScanCache', () => { clearLibraryIndex(); return true; });

  ipcMain.handle('library:getEpisodes', (_, seriesPath) => {
    if (!isAllowedFileActionPath(seriesPath)) return [];
    if (!fs.existsSync(seriesPath)) return [];
    const isManga = config.vaultMode === 'manga';
    const fileScanner = isManga ? getMangaFiles : getVideoFiles;
    const numParser = isManga ? parseChapterNumber : parseEpisodeNumber;
    return fileScanner(seriesPath, true)
      .map(f => { const episodeNum = numParser(f.name); return { ...f, episodeNum, title: mediaDisplayTitle(f.name, path.basename(seriesPath), episodeNum) }; })
      .sort((a, b) => {
        const an = Number(a.episodeNum);
        const bn = Number(b.episodeNum);
        return (isNaN(an) ? 999 : an) - (isNaN(bn) ? 999 : bn);
      });
  });

  ipcMain.handle('library:deleteSeries', async (_, seriesPath) => {
    try {
      assertAllowedChildFileActionPath(seriesPath);
      // The whole folder (subfolders included) goes to the Recycle Bin.
      const how = await trashOrDelete(seriesPath);
      // Untrack first: it reads the MAL id from the watch history entry.
      const dirName = path.basename(seriesPath);
      const untracked = untrackDeletedSeries(dirName, seriesPath);
      const history = getWatchHistoryStore();
      if (history[dirName]) {
        delete history[dirName];
        saveConfig();
      }
      return { success: true, untracked, recycled: how === 'trash' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('library:batchDeleteSeries', async (_, paths) => {
    if (!Array.isArray(paths) || paths.length > 500) return [];
    const results = [];
    for (const p of paths) {
      try {
        assertAllowedChildFileActionPath(p);
        const how = await trashOrDelete(p);
        const dirName = path.basename(p);
        const untracked = untrackDeletedSeries(dirName, p);
        const history = getWatchHistoryStore();
        if (history[dirName]) delete history[dirName];
        results.push({ path: p, success: true, untracked, recycled: how === 'trash' });
      } catch (e) {
        results.push({ path: p, success: false, error: e.message });
      }
    }
    saveConfig();
    return results;
  });

  ipcMain.handle('library:deleteEpisodeFile', async (_, filePath) => {
    try {
      assertAllowedFileActionPath(filePath);
      assertPlayableMedia(filePath);
      const how = await trashOrDelete(filePath);
      return { success: true, recycled: how === 'trash' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = {
  _doScanLibrary,
  categoryForName,
  clearLibraryIndex,
  getLocalEpisodes,
  getLocalHighestEpisode,
  listSeriesDirs,
  resolveTrackedLocalSeries,
  register,
};
