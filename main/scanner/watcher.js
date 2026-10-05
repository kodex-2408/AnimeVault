'use strict';

// main/scanner/watcher.js - poll-based, torrent-safe file watcher that files
// new episodes into the matching series folder.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { state, config } = require('../state');
const { parseSeasonSuffix } = require('../services/anilist');
const { categoryForName, listSeriesDirs } = require('./library');
const { assertPlayableMedia, extractSeriesName, getMangaFiles, getVideoFiles, parseChapterNumber, parseEpisodeNumber, parseMangaFilename, parseVideoFilename } = require('./parsers');
const { isAllowedFileActionPath, isForbiddenRoot, isSafeFileName, moveNoClobber, normalizeFsPath } = require('../config/security');
const { saveConfig } = require('../config/config');

let watcherInterval = null;
const FILE_IDLE_MS = 30000; // 30 seconds — file must be untouched for this long

function isFileLocked(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r+');
    fs.closeSync(fd);
    return false;
  } catch (e) {
    return true; // Locked by another process
  }
}

function matchesWatcherIgnore(filename) {
  return (config.watcherIgnorePatterns || []).some(pattern => {
    if (typeof pattern !== 'string' || !pattern.trim()) return false;
    try { return new RegExp(pattern, 'i').test(filename); }
    catch (e) {
      const glob = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      try { return new RegExp(glob, 'i').test(filename); } catch (ignored) { return false; }
    }
  });
}

// Find existing series folder across all library folders
// Folder names compared without punctuation or case ("Appeared!" = "appeared").
function seriesMatchKey(name) {
  return String(name || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function findExistingSeriesFolder(seriesName) {
  const wanted = parseSeasonSuffix(seriesName);
  const safe = seriesMatchKey(wanted.base);
  if (!safe) return null;
  const isManga = config.vaultMode === 'manga';
  const folders = isManga ? (config.mangaFolders || []) : (config.folders || []);
  for (const folder of folders) {
    for (const dir of listSeriesDirs(folder)) {
      if (dir.containerOnly) continue;
      const have = parseSeasonSuffix(dir.name);
      // Season 2 never lands in the season 1 folder, and vice versa.
      if (have.season !== wanted.season) continue;
      const dirClean = seriesMatchKey(have.base);
      if (!dirClean) continue;
      if (dirClean === safe) return dir.path;
      // Significant token overlap, or one name is a word-boundary prefix of the other.
      const safeWords = new Set(safe.split(/\s+/).filter(w => w.length > 2));
      const dirWords = new Set(dirClean.split(/\s+/).filter(w => w.length > 2));
      let common = 0;
      for (const w of safeWords) if (dirWords.has(w)) common++;
      const tokenScore = safeWords.size && dirWords.size ? common / Math.max(safeWords.size, dirWords.size) : 0;
      const isWordPrefix = (dirClean + ' ').startsWith(safe + ' ') && safe.length >= 6;
      const isWordSuffix = (safe + ' ').startsWith(dirClean + ' ') && dirClean.length >= 6;
      if (tokenScore >= 0.8 || isWordPrefix || isWordSuffix) return dir.path;
    }
  }
  return null;
}

function watcherPoll() {
  const isManga = config.vaultMode === 'manga';
  const fileScanner = isManga ? getMangaFiles : getVideoFiles;
  const numParser = isManga ? parseChapterNumber : parseEpisodeNumber;
  const mediaParser = isManga ? parseMangaFilename : parseVideoFilename;
  const watchFolder = config.watcherFolder;
  const defaultDest = config.watcherDest || watchFolder;
  if (!watchFolder || !fs.existsSync(watchFolder)) return;

  console.log('[Watcher] Polling', watchFolder);
  try {
    const now = Date.now();
    const formatResult = [];

    // ── Phase 1: Loose files directly in watch folder ──
    const looseFiles = fileScanner(watchFolder);
    console.log('[Watcher] Loose files:', looseFiles.length);
    for (const f of looseFiles) {
      const shouldIgnore = matchesWatcherIgnore(f.name);
      if (shouldIgnore) {
        console.log('[Watcher] Ignored by pattern:', f.name);
        continue;
      }
      try {
        const stat = fs.statSync(f.path);
        if (now - stat.mtimeMs < FILE_IDLE_MS) {
          console.log('[Watcher] Skip (too recent):', f.name);
          continue;
        }
      } catch (e) { continue; }
      if (isFileLocked(f.path)) {
        console.log('[Watcher] Skip (locked):', f.name);
        continue;
      }
      const p = mediaParser(f.name);
      if (!p.matched || !p.series) {
        console.log('[Watcher] Skip (no match):', f.name);
        continue;
      }
      let seriesDir = findExistingSeriesFolder(p.series);
      if (!seriesDir) {
        formatResult.push({
          file: f.name, newName: p.newName, series: p.series,
          originalPath: f.path, isNewSeries: true
        });
        console.log('[Watcher] New series (loose file):', p.series);
        continue;
      }
      fs.mkdirSync(seriesDir, { recursive: true });
      const newPath = path.join(seriesDir, p.newName);
      if (fs.existsSync(newPath)) {
        console.log('[Watcher] Skip (exists):', p.newName);
        continue;
      }
      try {
        moveNoClobber(f.path, newPath);
        formatResult.push({ file: f.name, newName: p.newName, series: path.basename(seriesDir) });
        console.log('[Watcher] Moved loose:', f.name, '->', seriesDir);
      } catch (e) {
        console.error('[Watcher] Move error:', f.name, e.message);
        formatResult.push({ file: f.name, series: path.basename(seriesDir), error: e.message });
      }
    }

    // ── Phase 1.5: Root-level folders that are potential new series ──
    // Folders like "Monster 2004 S01 1080p BluRay..." should be renamed and
    // either merged into existing series or moved whole as a new series.
    // Category folders ("movies", "series"…) and configured library folders
    // that live inside the watch folder are the library itself, never new
    // downloads to rename or move.
    const libraryRoots = new Set([].concat(config.folders || [], config.mangaFolders || []).map(f => f && f.path && normalizeFsPath(f.path)).filter(Boolean).map(p => p.toLowerCase()));
    if (config.watcherDest) libraryRoots.add(normalizeFsPath(config.watcherDest).toLowerCase());
    const rootDirs = fs.readdirSync(watchFolder, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'animevault-torrents')
      .filter(d => !categoryForName(d.name) && !libraryRoots.has(normalizeFsPath(path.join(watchFolder, d.name)).toLowerCase()));
    console.log('[Watcher] Subdirectories to scan:', rootDirs.length);

    for (const dir of rootDirs) {
      let dirPath = path.join(watchFolder, dir.name);
      let dirFiles = fileScanner(dirPath, false); // non-recursive within subdir

      // Bug D Fix: clean up empty directories
      if (!dirFiles.length) {
        try {
          const remaining = fs.readdirSync(dirPath);
          if (!remaining.length) {
            fs.rmdirSync(dirPath);
            console.log('[Watcher] Removed empty subdir:', dir.name);
          }
        } catch (e) {}
        continue;
      }

      // ── Phase 1.5a: Rename folder if its name contains release metadata ──
      let folderName = dir.name;
      const seriesInfo = extractSeriesName(folderName);
      let cleanFolderName = seriesInfo.title;
      // If we extracted a clean name and it's different, rename the folder
      if (cleanFolderName && cleanFolderName !== folderName) {
        const safeName = cleanFolderName.replace(/[\\/:*?"<>|]/g, '_');
        const newDirPath = path.join(watchFolder, safeName);
        if (!fs.existsSync(newDirPath)) {
          try {
            moveNoClobber(dirPath, newDirPath);
            console.log('[Watcher] Renamed folder:', folderName, '->', safeName);
            folderName = safeName;
            dirPath = newDirPath;
            // Re-scan files after rename
            dirFiles = fileScanner(dirPath, false);
          } catch (e) {
            console.error('[Watcher] Folder rename error:', e.message);
          }
        }
      }

      // ── Phase 1.5b: If all files belong to same series, check if we should
      // move the ENTIRE folder to a destination (new series placement)
      // rather than extracting files individually.
      const seriesMap = new Map();
      for (const f of dirFiles) {
        try {
          const stat = fs.statSync(f.path);
          if (now - stat.mtimeMs < FILE_IDLE_MS) continue;
        } catch (e) { continue; }
        if (isFileLocked(f.path)) continue;
        const p = mediaParser(f.name, folderName);
        if (p.matched && p.series) {
          if (!seriesMap.has(p.series)) seriesMap.set(p.series, []);
          seriesMap.get(p.series).push({ file: f, parsed: p });
        }
      }

      // If the folder contains only one series and no existing folder is found,
      // treat the entire folder as a new series unit to be placed.
      if (seriesMap.size === 1) {
        const [seriesName, fileList] = [...seriesMap.entries()][0];
        const existingDir = findExistingSeriesFolder(seriesName);
        if (!existingDir) {
          // Entire folder is a new series: rename each file, then queue folder for placement
          let allRenamed = true;
          for (const { file: f, parsed: p } of fileList) {
            const newFilePath = path.join(dirPath, p.newName);
            if (f.path !== newFilePath && !fs.existsSync(newFilePath)) {
              try {
                moveNoClobber(f.path, newFilePath);
              } catch (e) {
                console.error('[Watcher] File rename error in folder:', e.message);
                allRenamed = false;
              }
            }
          }
          // Queue the entire folder for placement
          formatResult.push({
            file: folderName + ' (' + fileList.length + ' files)',
            newName: seriesName,
            series: seriesName,
            originalPath: dirPath,
            isNewSeries: true,
            isFolder: true,
            sourceFolder: folderName,
            fileCount: fileList.length
          });
          console.log('[Watcher] New series folder queued:', seriesName, '(' + fileList.length + ' files)');
          continue; // Skip Phase 2 individual file processing for this folder
        }
      }

      // ── Phase 2: Individual file processing (original behavior, folder rename applied) ──
      console.log('[Watcher] Subdir', folderName, 'has', dirFiles.length, 'files');
      let movedCount = 0;
      for (const f of dirFiles) {
        const shouldIgnore = matchesWatcherIgnore(f.name);
        if (shouldIgnore) {
          console.log('[Watcher] Ignored by pattern:', f.name);
          continue;
        }
        try {
          const stat = fs.statSync(f.path);
          if (now - stat.mtimeMs < FILE_IDLE_MS) continue;
        } catch (e) { continue; }
        if (isFileLocked(f.path)) continue;

        // Try parsing with folder name fallback
        const p = mediaParser(f.name, folderName);
        if (!p.matched || !p.series) {
          console.log('[Watcher] Subdir skip (no match):', f.name, 'in', folderName);
          continue;
        }
        let seriesDir = findExistingSeriesFolder(p.series);
        if (!seriesDir) {
          // New series detected from subfolder
          formatResult.push({
            file: f.name, newName: p.newName, series: p.series,
            originalPath: f.path, isNewSeries: true,
            sourceFolder: folderName // hint for the renderer
          });
          console.log('[Watcher] New series (subfolder):', p.series, 'from', folderName);
          continue;
        }
        fs.mkdirSync(seriesDir, { recursive: true });
        const newPath = path.join(seriesDir, p.newName);
        if (fs.existsSync(newPath)) {
          console.log('[Watcher] Skip (exists):', p.newName);
          continue;
        }
        try {
          moveNoClobber(f.path, newPath);
          formatResult.push({ file: f.name, newName: p.newName, series: path.basename(seriesDir) });
          movedCount++;
        } catch (e) {
          console.error('[Watcher] Move error:', f.name, e.message);
          formatResult.push({ file: f.name, series: path.basename(seriesDir), error: e.message });
        }
      }
      // Clean up empty subdir after moving files out
      if (movedCount > 0) {
        try {
          const remaining = fs.readdirSync(dirPath);
          if (!remaining.length) {
            fs.rmdirSync(dirPath);
            console.log('[Watcher] Removed empty subdir:', dir.name);
          }
        } catch (e) {}
      }
    }

    if (formatResult.length > 0) {
      console.log('[Watcher] Processed', formatResult.length, 'items');
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('watcher:newFiles', formatResult);
      }
    }
  } catch (e) {
    console.error('[Watcher] Poll error:', e.message);
  }
}

function startFileWatcher(watchFolder, destFolder) {
  stopFileWatcher();
  if (!watchFolder || !fs.existsSync(watchFolder)) {
    console.log('[Watcher] Invalid folder, not starting');
    return;
  }
  console.log('[Watcher] Starting file watcher for', watchFolder);
  // Let the initial library render settle before the first background disk pass.
  setTimeout(() => watcherPoll(), 20000);
  watcherInterval = setInterval(() => watcherPoll(), 30000);
}

function stopFileWatcher() {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }
}

function register() {
  ipcMain.handle('watcher:start', (_, watchFolder, destFolder) => {
    const wf = typeof watchFolder === 'string' ? watchFolder.trim() : '';
    const df = typeof destFolder === 'string' ? destFolder.trim() : wf;
    if (!wf || !path.isAbsolute(wf) || !fs.existsSync(wf)) return { error: 'Watch folder does not exist' };
    if (isForbiddenRoot(wf) || (df && isForbiddenRoot(df))) return { error: 'That folder can’t be watched — pick a downloads or library folder' };
    if (df !== wf && !isAllowedFileActionPath(df)) return { error: 'Destination folder is outside configured AnimeVault folders' };
    config.watcherFolder = wf;
    config.watcherDest = df;
    saveConfig();
    startFileWatcher(wf, df);
    return true;
  });

  ipcMain.handle('watcher:stop', () => {
    stopFileWatcher();
    return true;
  });

  ipcMain.handle('watcher:status', () => {
    return { enabled: !!watcherInterval, running: !!watcherInterval, folder: config.watcherFolder };
  });

  ipcMain.handle('watcher:pollNow', () => {
    watcherPoll();
    return true;
  });

  ipcMain.handle('watcher:placeNewSeries', (_, item, destFolder) => {
    try {
      if (!item || typeof item !== 'object' || !item.series || !item.originalPath) throw new Error('Invalid placement item');
      const baseDest = destFolder || config.watcherDest || config.folders[0]?.path || '';
      if (!baseDest || !isAllowedFileActionPath(baseDest)) throw new Error('Destination is outside configured AnimeVault folders');
      if (!isAllowedFileActionPath(item.originalPath)) throw new Error('Source is outside configured AnimeVault folders');
      if (!isSafeFileName(item.series)) throw new Error('Invalid series name');
      if (!item.isFolder && !isSafeFileName(item.newName)) throw new Error('Invalid file name');
      const targetDir = path.join(baseDest, item.series);

      // A whole folder: moved as is, or merged into an existing series folder
      // with everything in it (subtitles, extras), never overwriting a file.
      if (item.isFolder) {
        if (!fs.existsSync(item.originalPath)) return { success: false, error: 'Source folder not found' };
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(baseDest, { recursive: true });
          moveNoClobber(item.originalPath, targetDir);
          return { success: true, path: targetDir };
        }
        let moved = 0;
        const skipped = [];
        for (const name of fs.readdirSync(item.originalPath)) {
          const from = path.join(item.originalPath, name);
          const to = path.join(targetDir, name);
          if (fs.existsSync(to)) { skipped.push(name); continue; }
          moveNoClobber(from, to);
          moved++;
        }
        try { if (!fs.readdirSync(item.originalPath).length) fs.rmdirSync(item.originalPath); } catch (e) {}
        return { success: true, moved, skipped, path: targetDir, merged: true };
      }

      fs.mkdirSync(targetDir, { recursive: true });
      // Placing a single file
      const targetPath = path.join(targetDir, item.newName);
      if (fs.existsSync(item.originalPath)) {
        assertPlayableMedia(item.originalPath);
        moveNoClobber(item.originalPath, targetPath);
        return { success: true, path: targetPath };
      }
      return { success: false, error: 'Source file not found' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = {
  startFileWatcher,
  stopFileWatcher,
  register,
};
