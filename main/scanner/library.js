'use strict';

// main/scanner/library.js - library layout (category containers), the
// incremental library scan and its index, and library:* handlers.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { state, config } = require('../state');
const { LIBRARY_INDEX_PATH, getWatchHistoryStore, safeHistoryKey, saveConfig } = require('../config/config');
const { assertPlayableMedia, getMangaFiles, getVideoFiles, parseChapterNumber, parseEpisodeNumber, parseMediaNumber } = require('./parsers');
const { getExistingCoverCachePath } = require('../services/covers');
const { coverFileVersion } = require('../services/anilist');
const { scheduleDuplicateCheck } = require('./duplicates');
const { assertAllowedChildFileActionPath, assertAllowedFileActionPath, isAllowedFileActionPath } = require('../config/security');

let _libraryIndex = null;
let _libraryIndexSaveTimer = null;

function readLibraryIndex() {
  if (_libraryIndex) return _libraryIndex;
  try {
    const parsed = JSON.parse(fs.readFileSync(LIBRARY_INDEX_PATH, 'utf-8'));
    if (parsed && parsed.version === 1) _libraryIndex = parsed;
  } catch (e) {}
  if (!_libraryIndex) _libraryIndex = { version: 1, anime: {}, manga: {} };
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
  _libraryIndex = { version: 1, anime: {}, manga: {} };
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

function getIndexedMediaFiles(seriesPath, scanner, mode, force) {
  const index = readLibraryIndex();
  const bucket = index[mode] || (index[mode] = {});
  const key = path.resolve(seriesPath).toLowerCase();
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(seriesPath).mtimeMs; } catch (e) {}
  const cached = bucket[key];
  if (!force && config.incrementalScan !== false && cached && cached.mtimeMs === mtimeMs && Array.isArray(cached.files)) {
    lastScanStats.cacheHits++;
    return cached.files.map(file => ({ ...file }));
  }
  lastScanStats.cacheMisses++;
  const files = scanner(seriesPath);
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
  for (const folder of (activeFolders || [])) {
    if (!folder || !folder.path || !fs.existsSync(folder.path)) continue;
    try {
      for (const dir of listSeriesDirs(folder)) {
        const seriesPath = dir.path;
        liveIndexKeys.add(path.resolve(seriesPath).toLowerCase());
        // A category container only contributes its own loose files, never its
        // series subfolders a second time.
        const files = (dir.containerOnly ? scanner(seriesPath, false) : getIndexedMediaFiles(seriesPath, scanner, mode, !!force)).map(f => ({...f, episodeNum: parseMediaNumber(f.name)}));
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
  if (migratedHistory) saveConfig();
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
      .map(f => ({ ...f, episodeNum: numParser(f.name) }))
      .sort((a, b) => {
        const an = Number(a.episodeNum);
        const bn = Number(b.episodeNum);
        return (isNaN(an) ? 999 : an) - (isNaN(bn) ? 999 : bn);
      });
  });

  ipcMain.handle('library:deleteSeries', (_, seriesPath) => {
    try {
      assertAllowedChildFileActionPath(seriesPath);
      // Remove the series folder recursively; flat unlink+rmdir failed on any
      // series containing subfolders (extras/, subs/, season packs).
      if (fs.existsSync(seriesPath)) {
        fs.rmSync(seriesPath, { recursive: true, force: true });
      }
      // Untrack first: it reads the MAL id from the watch history entry.
      const dirName = path.basename(seriesPath);
      const untracked = untrackDeletedSeries(dirName, seriesPath);
      const history = getWatchHistoryStore();
      if (history[dirName]) {
        delete history[dirName];
        saveConfig();
      }
      return { success: true, untracked };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('library:batchDeleteSeries', (_, paths) => {
    if (!Array.isArray(paths) || paths.length > 500) return [];
    const results = [];
    for (const p of paths) {
      try {
        assertAllowedChildFileActionPath(p);
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
        const dirName = path.basename(p);
        const untracked = untrackDeletedSeries(dirName, p);
        const history = getWatchHistoryStore();
        if (history[dirName]) delete history[dirName];
        results.push({ path: p, success: true, untracked });
      } catch (e) {
        results.push({ path: p, success: false, error: e.message });
      }
    }
    saveConfig();
    return results;
  });

  ipcMain.handle('library:deleteEpisodeFile', (_, filePath) => {
    try {
      assertAllowedFileActionPath(filePath);
      assertPlayableMedia(filePath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return { success: true };
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
