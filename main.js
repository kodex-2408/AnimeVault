const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const net = require('net');
const { execFile } = require('child_process');
const crypto = require('crypto');
const autoDownload = require('./autoDownload');
const {
  runAutoDownloadPoller,
  startAutoDownloadPoller,
  stopAutoDownloadPoller,
  syncAutoDownloadCriteria,
  extractSeasonInfo,
  getNextEpisodeNumber,
  parseNyaaEpisodeNumber,
  parseReleaseSize,
  scoreRelease,
  computeH264Ceiling,
  downloadNyaaTorrentFile
} = autoDownload;

// ================================================================
//  GLOBALS & CONFIG
// ================================================================
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const CACHE_DIR = path.join(app.getPath('userData'), 'cover-cache');

let mainWindow;
let tray = null;
let isQuitting = false;
let hasInitialCriteriaSyncRun = false;  // Phase 1.7: criteria sync deferred until first library scan
let config = {
  // Folders: array of { path, label, type:'seasonal'|'movies'|'series'|'custom' }
  folders: [],
  vlcPath: 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
  malClientId: '',
  malClientSecret: '',
  malAccessToken: '',
  malRefreshToken: '',
  malTokenExpiry: 0,
  malCodeVerifier: '',
  watchHistory: {},
  // Theme
  theme: 'dark',
  accentColor: '#e8530e',
  fontFamily: 'Segoe UI',
  themePreset: 'default',
  // Auto-mark
  autoMarkEnabled: true,
  autoMarkPercent: 80,
  // Vault mode: 'anime' or 'manga'
  vaultMode: 'anime',
  // Manga folders (separate from anime folders)
  mangaFolders: [],
  mangaWatchHistory: {},
  // Manga reader path (empty = system default for .cbz/.cbr)
  readerPath: '',
  // Manga preferred uploaders on Nyaa
  mangaUploaders: ['LuCaZ','Danke','Leviatan'],
  forceHevc: true, // Strongly prefer HEVC/x265 over H.264/x264
  // Auto-download watchlist for airing series
  autoDownloadWatchlist: [],
  autoDownloadCriteria: false, // auto-populate from MAL Watching list
  autoDownloadPollMinutes: 60,
  autoDownloadEnabled: false,
  minimizeToTray: false,
  desktopNotifications: true,
  watcherIgnorePatterns: [],
  seriesTags: {},
  smartCollections: [],
  searchPresets: [],
};

// Shared library cache for cross-module access
let lastLibraryScan = [];

function loadConfig() {
  try {
    let loaded = false;
    // Try primary config file first
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        if (data && typeof data === 'object') {
          config = { ...config, ...data };
          loaded = true;
          console.log('[Config] Loaded from', CONFIG_PATH);
        }
      } catch (parseErr) {
        console.error('[Config] Primary file corrupted:', parseErr.message);
      }
    }
    // Try Electron Store fallback if primary failed
    if (!loaded) {
      try {
        const Store = require('electron-store');
        const store = new Store({ name: 'config' });
        const data = store.store;
        if (data && typeof data === 'object') {
          config = { ...config, ...data };
          loaded = true;
          console.log('[Config] Loaded from electron-store');
        }
      } catch (storeErr) {
        console.error('[Config] electron-store fallback failed:', storeErr.message);
      }
    }
    // Set defaults for any missing keys
    if (config.watchHistory === undefined) config.watchHistory = {};
    if (config.theme === undefined) config.theme = 'dark';
    if (config.folders === undefined) config.folders = [];
    if (config.mangaFolders === undefined) config.mangaFolders = [];
    if (config.vaultMode === undefined) config.vaultMode = 'anime';
    if (config.autoMarkEnabled === undefined) config.autoMarkEnabled = true;
    if (config.autoMarkPercent === undefined) config.autoMarkPercent = 80;
    if (config.forceHevc === undefined) config.forceHevc = true;
    if (config.autoDownloadCriteria === undefined) config.autoDownloadCriteria = false;
    if (config.autoDownloadPollMinutes === undefined) config.autoDownloadPollMinutes = 60;
    if (config.autoDownloadEnabled === undefined) config.autoDownloadEnabled = false;
    if (config.desktopNotifications === undefined) config.desktopNotifications = true;
    if (config.watcherIgnorePatterns === undefined) config.watcherIgnorePatterns = [];
    if (config.seriesTags === undefined) config.seriesTags = {};
    if (config.smartCollections === undefined) config.smartCollections = [];
    if (config.searchPresets === undefined) config.searchPresets = [];
  } catch (err) {
    console.error('[Config] Fatal error during load, using defaults:', err.message);
  }
}

function saveConfig() {
  try {
    // Strip runtime-only keys before writing
    const { _userDataPath, ...safeConfig } = config;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(safeConfig, null, 2));
  } catch (err) {
    console.error('[Config] Save failed:', err.message);
  }
}

function getLocalStorageObj() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'localStorage.json'), 'utf-8'));
  } catch (e) { return {}; }
}

function setLocalStorageObj(obj) {
  fs.writeFileSync(path.join(app.getPath('userData'), 'localStorage.json'), JSON.stringify(obj));
}

// ================================================================
//  IPC: CONFIG
// ================================================================
ipcMain.handle('config:get', () => {
  return { ...config, _userDataPath: app.getPath('userData') };
});

ipcMain.handle('config:set', (_, key, value) => {
  config[key] = value;
  saveConfig();
  return true;
});

ipcMain.handle('config:setAll', (_, c) => { delete c._userDataPath; config = { ...config, ...c }; saveConfig(); });
ipcMain.handle('config:getUserDataPath', () => app.getPath('userData'));
ipcMain.handle('config:setVaultMode', (_, mode) => {
  config.vaultMode = mode;
  saveConfig();
  return true;
});

// ================================================================
//  DIALOGS
// ================================================================
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:openFile', async (_, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'All Files', extensions: ['*'] }]
  });
  return result.canceled ? null : result.filePaths[0];
});

// ================================================================
//  LIBRARY SCANNING
// ================================================================
const VIDEO_EXTS = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts'];
const MANGA_EXTS = ['.cbz', '.cbr', '.zip', '.pdf', '.epub'];

function getVideoFiles(folder, recurse = false) {
  if (!fs.existsSync(folder)) return [];
  const results = [];
  try {
    const items = fs.readdirSync(folder, { withFileTypes: true });
    for (const item of items) {
      const fp = path.join(folder, item.name);
      if (item.isFile() && VIDEO_EXTS.includes(path.extname(item.name).toLowerCase())) {
        try {
          if (!fs.existsSync(fp)) continue; // Batch A.5: ghost-file guard
          results.push({ name: item.name, path: fp, size: fs.statSync(fp).size });
        } catch(e){}
      } else if (recurse && item.isDirectory() && !item.name.startsWith('.')) {
        results.push(...getVideoFiles(fp, true));
      }
    }
  } catch(e){}
  return results;
}

function getMangaFiles(folder, recurse = false) {
  if (!fs.existsSync(folder)) return [];
  const results = [];
  try {
    const items = fs.readdirSync(folder, { withFileTypes: true });
    for (const item of items) {
      const fp = path.join(folder, item.name);
      if (item.isFile() && MANGA_EXTS.includes(path.extname(item.name).toLowerCase())) {
        try {
          if (!fs.existsSync(fp)) continue; // Batch A.5: ghost-file guard
          results.push({ name: item.name, path: fp, size: fs.statSync(fp).size });
        } catch(e){}
      } else if (recurse && item.isDirectory() && !item.name.startsWith('.')) {
        results.push(...getMangaFiles(fp, true));
      }
    }
  } catch(e){}
  return results;
}

function cleanTitle(t) {
  return t
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[_.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanFolderName(name) {
  return cleanTitle(name);
}

function detectResolution(filename) {
  if (/2160p|4K|UHD/.test(filename)) return '2160p';
  if (/1080p/.test(filename)) return '1080p';
  if (/720p/.test(filename)) return '720p';
  if (/480p/.test(filename)) return '480p';
  return '1080p';
}

// Common release-metadata tokens that should be stripped before parsing
const RELEASE_META_STRIP = /\b(?:\d{3,4}p|BluRay|BDRip|WEB[-.]?DL|WEBRip|HDRip|DVDRip|XviD|x26[45]|HEVC|H\.265|H\.264|AVC|AAC|FLAC|DTS|AC3|DDP|TrueHD|Atmos|Dual|DUB|SUB|Multi|SoftSub|HardSub|REPACK|PROPER|EXTENDED|UNCUT|UNRATED|Director'?s\s*Cut|Kitsune|SubsPlease|Erai-raws|Judas|VARYG|HorribleSubs|Commie|GJM|UTW|Coalgirls|\dx\d{3,4}|10-bit|8-bit|Hi10P|YUV420P10|CRF\s*\d+)\b/gi;
function parseEpisodeNumber(filename) {
  const base = path.parse(filename).name;
  // Strip bracket/parenthesis contents first (release metadata)
  let cleaned = base.replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ');
  // Strip common release-metadata tokens to avoid false positives
  cleaned = cleaned.replace(RELEASE_META_STRIP, ' ');
  // Now strip season references
  cleaned = cleaned.replace(/\b(?:Season\s*\d{1,2}|S\d{1,2})\b/gi, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Pattern 1: S01E05
  let m = cleaned.match(/S\d{1,2}E(\d{1,3})/i);
  if (m) return parseInt(m[1]);
  // Pattern 2: Episode 05, EP 05
  m = cleaned.match(/Episode\s+(\d{1,3})/i);
  if (m) return parseInt(m[1]);
  m = cleaned.match(/\bEP?\s*(\d{1,3})\b/i);
  if (m) return parseInt(m[1]);
  // Pattern 3: " - 05" (dash-separated episode, optional space)
  // This specifically catches the "Series Name - 26 (1080p)" pattern
  m = cleaned.match(/-\s*(\d{1,3})(?:v\d)?(?:\s*(?:\[|\(|\.|$))/);
  if (m) return parseInt(m[1]);
  // Pattern 3b: " - NN" at end of string (e.g. "Monster - 26")
  m = cleaned.match(/-\s+(\d{1,3})\s*$/);
  if (m) return parseInt(m[1]);
  // Pattern 4: rightmost standalone number not preceded by year and not followed by dash
  // Filter out 4-digit years (19xx, 20xx)
  const candidates = [];
  const p4regex = /\s+(\d{1,4})(?:v\d)?(?=\s|$|\[|\(|\.)/g;
  let p4m;
  while ((p4m = p4regex.exec(cleaned)) !== null) {
    const num = parseInt(p4m[1]);
    // Skip 4-digit years
    if (num >= 1900 && num <= 2099) continue;
    // Skip if it's part of a "xNNN" pattern (e.g. "2 0" from "FLAC 2 0")
    const before = cleaned.slice(Math.max(0, p4m.index - 3), p4m.index);
    if (/\b\d\s+x?\s*$/i.test(before) && num >= 100 && num <= 9999) continue;
    const rest = cleaned.slice(p4regex.lastIndex);
    if (!/^\s*[-\u2013\u2014]/.test(rest)) candidates.push(num);
  }
  if (candidates.length) return candidates[candidates.length - 1];
  // Fallback: number at end (last resort)
  m = cleaned.match(/\b(\d{1,3})\s*$/);
  if (m) {
    const num = parseInt(m[1]);
    // Sanity: don't return year-like numbers
    if (num < 1900 || num > 2099) return num;
  }
  return null;
}

function parseChapterNumber(filename) {
  const base = path.parse(filename).name;
  let m = base.match(/(?:Ch(?:apter)?[.\s]*(\d{1,4})|Ch\s*(\d{1,4})|C\s*(\d{1,4})|#(\d{1,4})|-\s*(\d{1,4})(?:v\d)?\s*[\[\(\.\s]|\s+(\d{1,4})(?:v\d)?\s*[\[\(\.\s])/i);
  if (m) return parseInt(m[1] || m[2] || m[3] || m[4] || m[5] || m[6]);
  m = base.match(/\b(\d{1,4})\s*$/);
  if (m) return parseInt(m[1]);
  return null;
}

function parseMediaNumber(filename) {
  return config.vaultMode === 'manga' ? parseChapterNumber(filename) : parseEpisodeNumber(filename);
}

function stripReleaseMetadata(name) {
  // Remove bracket/parenthesis groups
  let cleaned = name.replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ');
  // Remove common release metadata tokens
  cleaned = cleaned.replace(RELEASE_META_STRIP, ' ');
  // Remove release group at end (e.g. "-Kitsune", "_Kitsune")
  cleaned = cleaned.replace(/[-_]\s*[A-Za-z][A-Za-z0-9]{1,}\s*$/g, ' ');
  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

function extractSeriesName(name, defaultSeason) {
  // Strip all release metadata
  let cleaned = stripReleaseMetadata(name);
  // Strip season info
  cleaned = cleaned.replace(/\b(?:Season\s*\d{1,2}|S\d{1,2})\b/gi, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  // Try to extract "Title (Year)" pattern
  let m = cleaned.match(/^(.+?)\s*[\(\[]\s*(\d{4})\s*[\)\]]/);
  if (m) {
    const title = cleanTitle(m[1]);
    const year = m[2];
    if (title.length > 1) return { title: `${title} (${year})`, year: parseInt(year) };
  }
  // Try to extract "Title 2004" pattern (year at end or middle)
  m = cleaned.match(/^(.+?)\s+(\d{4})(?:\s|$)/);
  if (m) {
    const year = parseInt(m[2]);
    if (year >= 1920 && year <= 2099) {
      const title = cleanTitle(m[1]);
      if (title.length > 1) return { title: `${title} (${year})`, year };
    }
  }
  // Simple title extraction
  const title = cleanTitle(cleaned);
  if (title.length > 1) return { title, year: null };
  return { title: null, year: null };
}

function parseVideoFilename(filename, folderName) {
  const ext = path.extname(filename), base = path.parse(filename).name;
  const codec = /\b(?:HEVC|x265|H\.265)\b/.test(filename) ? 'HEVC' : 'H.264';
  const res = detectResolution(filename);

  // Create a metadata-stripped version for parsing
  const stripped = stripReleaseMetadata(base);

  // Pattern 1: S01E05 (in stripped or original)
  let m = stripped.match(/(?:^[\s._-])S(\d{1,2})E(\d{1,3})(?:[\s._-]|$)/i) ||
          base.match(/(?:^[\s._-])S(\d{1,2})E(\d{1,3})(?:[\s._-]|$)/i);
  if (m) {
    const s = parseInt(m[1]), e = parseInt(m[2]);
    const seriesInfo = extractSeriesName(base.split(/S\d{1,2}E\d{1,3}/i)[0]);
    if (seriesInfo.title) {
      const sf = s > 1 ? ` S${s}` : '';
      return {
        newName: `${seriesInfo.title}${sf} - ${String(e).padStart(2, '0')} (${res}) (${codec})${ext}`,
        series: seriesInfo.title + (s > 1 ? ' S' + s : ''),
        matched: true
      };
    }
  }

  // Pattern 2: "Series Name - 26" or "Series Name - 26 (1080p)"
  m = stripped.match(/^(.*?)(?:\s+(?:(\d)(?:nd|rd|th|st)\s*Season|Season\s*(\d+)|S(\d+)))?\s+-\s+(\d{1,3})(?:\s|$|v\d)/);
  if (m) {
    const s = parseInt(m[2] || m[3] || m[4] || '1');
    const e = parseInt(m[5]);
    const seriesInfo = extractSeriesName(m[1]);
    if (seriesInfo.title) {
      const sf = s > 1 ? ` S${s}` : '';
      return {
        newName: `${seriesInfo.title}${sf} - ${String(e).padStart(2, '0')} (${res}) (${codec})${ext}`,
        series: seriesInfo.title + (s > 1 ? ' S' + s : ''),
        matched: true
      };
    }
  }

  // Pattern 2b: "Series Name - NN" at end of stripped string
  m = stripped.match(/^(.*?)\s+-\s+(\d{1,3})\s*$/);
  if (m) {
    const e = parseInt(m[2]);
    const seriesInfo = extractSeriesName(m[1]);
    if (seriesInfo.title) {
      return {
        newName: `${seriesInfo.title} - ${String(e).padStart(2, '0')} (${res}) (${codec})${ext}`,
        series: seriesInfo.title,
        matched: true
      };
    }
  }

  // Pattern 3: "Series Name 26" (space-separated number at end)
  m = stripped.match(/^(.*?)[\s_.-]+(\d{1,3})(?:\s|$)/);
  if (m) {
    const e = parseInt(m[2]);
    const seriesInfo = extractSeriesName(m[1]);
    if (seriesInfo.title && seriesInfo.title.length > 1) {
      return {
        newName: `${seriesInfo.title} - ${String(e).padStart(2, '0')} (${res}) (${codec})${ext}`,
        series: seriesInfo.title,
        matched: true
      };
    }
  }

  // NEW: folder-name fallback for bare numbered files (e.g. EP1.mkv inside "Demon Slayer" folder)
  if (folderName) {
    const ep = parseEpisodeNumber(filename);
    if (ep !== null && ep > 0) {
      const seriesInfo = extractSeriesName(folderName);
      const seriesClean = seriesInfo.title || cleanFolderName(folderName);
      return {
        newName: `${seriesClean} - ${String(ep).padStart(2, '0')} (${res}) (${codec})${ext}`,
        series: seriesClean,
        matched: true
      };
    }
  }

  return { newName: cleanTitle(base) + ext, series: null, matched: false };
}

function parseMangaFilename(filename, folderName) {
  const ext = path.extname(filename), base = path.parse(filename).name;
  const stripped = stripReleaseMetadata(base);
  let m = stripped.match(/(?:^[\s._-])S(\d{1,2})E(\d{1,3})(?:[\s._-]|$)/i) ||
          base.match(/(?:^[\s._-])S(\d{1,2})E(\d{1,3})(?:[\s._-]|$)/i);
  if (m) {
    const s = parseInt(m[1]), e = parseInt(m[2]);
    const seriesInfo = extractSeriesName(base.split(/S\d{1,2}E\d{1,3}/i)[0]);
    if (seriesInfo.title) {
      const sf = s > 1 ? ` S${s}` : '';
      return { newName: `${seriesInfo.title}${sf} - Ch ${String(e).padStart(2, '0')}${ext}`, series: seriesInfo.title + (s > 1 ? ' S' + s : ''), matched: true };
    }
  }
  m = stripped.match(/^(.*?)(?:\s+(?:(\d)(?:nd|rd|th|st)\s*Season|Season\s*(\d+)|S(\d+)))?\s+-\s+(\d{1,3})(?:\s|$|v\d)/);
  if (m) {
    const s = parseInt(m[2] || m[3] || m[4] || '1'), e = parseInt(m[5]);
    const seriesInfo = extractSeriesName(m[1]);
    if (seriesInfo.title) {
      const sf = s > 1 ? ` S${s}` : '';
      return { newName: `${seriesInfo.title}${sf} - Ch ${String(e).padStart(2, '0')}${ext}`, series: seriesInfo.title + (s > 1 ? ' S' + s : ''), matched: true };
    }
  }
  m = stripped.match(/^(.*?)\s+-\s+(\d{1,3})\s*$/);
  if (m) {
    const e = parseInt(m[2]);
    const seriesInfo = extractSeriesName(m[1]);
    if (seriesInfo.title) {
      return { newName: `${seriesInfo.title} - Ch ${String(e).padStart(2, '0')}${ext}`, series: seriesInfo.title, matched: true };
    }
  }
  m = stripped.match(/^(.*?)[\s_.-]+(\d{1,3})(?:\s|$)/);
  if (m) {
    const e = parseInt(m[2]);
    const seriesInfo = extractSeriesName(m[1]);
    if (seriesInfo.title && seriesInfo.title.length > 1) {
      return { newName: `${seriesInfo.title} - Ch ${String(e).padStart(2, '0')}${ext}`, series: seriesInfo.title, matched: true };
    }
  }
  if (folderName) {
    const ep = parseChapterNumber(filename);
    if (ep !== null && ep > 0) {
      const seriesInfo = extractSeriesName(folderName);
      const seriesClean = seriesInfo.title || cleanFolderName(folderName);
      return { newName: `${seriesClean} - Ch ${String(ep).padStart(2, '0')}${ext}`, series: seriesClean, matched: true };
    }
  }
  return { newName: cleanTitle(base) + ext, series: null, matched: false };
}

// Parse video filename using folder name as series name fallback
function parseVideoWithFolder(filename, folderName) {
  // Delegate to the enhanced parseVideoFilename which now has better metadata stripping
  return parseVideoFilename(filename, folderName);
}

function parseEpisodeNumber(filename) {
  const base = path.parse(filename).name;
  // Strip bracket/parenthesis contents first (release metadata)
  let cleaned = base.replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ');
  // Strip common release-metadata tokens to avoid false positives
  cleaned = cleaned.replace(RELEASE_META_STRIP, ' ');
  // Now strip season references
  cleaned = cleaned.replace(/\b(?:Season\s*\d{1,2}|S\d{1,2})\b/gi, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Pattern 1: S01E05
  let m = cleaned.match(/S\d{1,2}E(\d{1,3})/i);
  if (m) return parseInt(m[1]);
  // Pattern 2: Episode 05, EP 05
  m = cleaned.match(/Episode\s+(\d{1,3})/i);
  if (m) return parseInt(m[1]);
  m = cleaned.match(/\bEP?\s*(\d{1,3})\b/i);
  if (m) return parseInt(m[1]);
  // Pattern 3: " - 05" (dash-separated episode, optional space)
  // This specifically catches the "Series Name - 26 (1080p)" pattern
  m = cleaned.match(/-\s*(\d{1,3})(?:v\d)?(?:\s*(?:\[|\(|\.|$))/);
  if (m) return parseInt(m[1]);
  // Pattern 3b: " - NN" at end of string (e.g. "Monster - 26")
  m = cleaned.match(/-\s+(\d{1,3})\s*$/);
  if (m) return parseInt(m[1]);
  // Pattern 4: rightmost standalone number not preceded by year and not followed by dash
  // Filter out 4-digit years (19xx, 20xx)
  const candidates = [];
  const p4regex = /\s+(\d{1,4})(?:v\d)?(?=\s|$|\[|\(|\.)/g;
  let p4m;
  while ((p4m = p4regex.exec(cleaned)) !== null) {
    const num = parseInt(p4m[1]);
    // Skip 4-digit years
    if (num >= 1900 && num <= 2099) continue;
    // Skip if it's part of a "xNNN" pattern (e.g. "2 0" from "FLAC 2 0")
    const before = cleaned.slice(Math.max(0, p4m.index - 3), p4m.index);
    if (/\b\d\s+x?\s*$/i.test(before) && num >= 100 && num <= 9999) continue;
    const rest = cleaned.slice(p4regex.lastIndex);
    if (!/^\s*[-\u2013\u2014]/.test(rest)) candidates.push(num);
  }
  if (candidates.length) return candidates[candidates.length - 1];
  // Fallback: number at end (last resort)
  m = cleaned.match(/\b(\d{1,3})\s*$/);
  if (m) {
    const num = parseInt(m[1]);
    // Sanity: don't return year-like numbers
    if (num < 1900 || num > 2099) return num;
  }
  return null;
}

function parseChapterNumber(filename) {
  const base = path.parse(filename).name;
  let m = base.match(/(?:Ch(?:apter)?[.\s]*(\d{1,4})|Ch\s*(\d{1,4})|C\s*(\d{1,4})|#(\d{1,4})|-\s*(\d{1,4})(?:v\d)?\s*[\[\(\.\s]|\s+(\d{1,4})(?:v\d)?\s*[\[\(\.\s])/i);
  if (m) return parseInt(m[1] || m[2] || m[3] || m[4] || m[5] || m[6]);
  m = base.match(/\b(\d{1,4})\s*$/);
  if (m) return parseInt(m[1]);
  return null;
}

function parseMediaNumber(filename) {
  return config.vaultMode === 'manga' ? parseChapterNumber(filename) : parseEpisodeNumber(filename);
}

function getLocalHighestEpisode(seriesName, malId) {
  // Find highest episode we have locally
  const nums = lastLibraryScan
    .filter(s => s.name === seriesName)
    .flatMap(s => s.episodes || [])
    .map(f => parseMediaNumber(f.name))
    .filter(n => n !== null && !isNaN(n));
  if (!nums.length) return 0;
  return Math.max(...nums);
}

function getLocalEpisodes(seriesName, malId) {
  // Return all local episode numbers
  const nums = lastLibraryScan
    .filter(s => s.name === seriesName)
    .flatMap(s => s.episodes || [])
    .map(f => parseMediaNumber(f.name))
    .filter(n => n !== null && !isNaN(n));
  return nums;
}

function _doScanLibrary() {
  const isManga = config.vaultMode === 'manga';
  const activeFolders = isManga ? config.mangaFolders : config.folders;
  const scanner = isManga ? getMangaFiles : getVideoFiles;

  const library = [];
  for (const folder of (activeFolders || [])) {
    if (!folder || !folder.path || !fs.existsSync(folder.path)) continue;
    try {
      const dirs = fs.readdirSync(folder.path, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const dir of dirs) {
        const seriesPath = path.join(folder.path, dir.name);
        const files = scanner(seriesPath).map(f => ({...f, episodeNum: parseMediaNumber(f.name)}));
        if (files.length === 0) continue;

        // Parse all episode numbers
        const episodeNumbers = files
          .map(f => f.episodeNum)
          .filter(n => n !== null && !isNaN(n));

        const episodeCount = episodeNumbers.length;
        const maxEpisode = episodeNumbers.length ? Math.max(...episodeNumbers) : 0;

        // Read watch data
        const watchData = config.watchHistory[dir.name] || {};
        const episodesWatched = Array.isArray(watchData.episodesWatched) ? watchData.episodesWatched : [];
        const lastWatched = watchData.lastWatched || '';
        const malId = watchData.malId || null;
        const malData = watchData.malData || null;
        const category = folder.type || 'custom';

        library.push({
          name: dir.name,
          path: seriesPath,
          episodes: files,
          episodeCount,
          maxEpisode,
          folder: folder.path,
          watchData: { episodesWatched, lastWatched, malId, malData },
          category
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

  lastLibraryScan = library;
  return library;
}

ipcMain.handle('library:scan', async () => {
  const library = _doScanLibrary();
  // Check for duplicate files after scan completes
  await checkDuplicatesAfterScan(library);
  // Phase 1.7: run criteria sync once after first successful cold-start scan
  if (!hasInitialCriteriaSyncRun && config.autoDownloadCriteria) {
    hasInitialCriteriaSyncRun = true;
    setTimeout(() => syncAutoDownloadCriteria(), 3000);
  }
  return library;
});

ipcMain.handle('library:getEpisodes', (_, seriesPath) => {
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
    // Delete all files inside the series folder
    if (fs.existsSync(seriesPath)) {
      const files = fs.readdirSync(seriesPath);
      for (const f of files) {
        fs.unlinkSync(path.join(seriesPath, f));
      }
      fs.rmdirSync(seriesPath);
    }
    // Remove from watch history
    const dirName = path.basename(seriesPath);
    if (config.watchHistory[dirName]) {
      delete config.watchHistory[dirName];
      saveConfig();
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('library:batchDeleteSeries', (_, paths) => {
  const results = [];
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const files = fs.readdirSync(p);
        for (const f of files) fs.unlinkSync(path.join(p, f));
        fs.rmdirSync(p);
      }
      const dirName = path.basename(p);
      if (config.watchHistory[dirName]) delete config.watchHistory[dirName];
      results.push({ path: p, success: true });
    } catch (e) {
      results.push({ path: p, success: false, error: e.message });
    }
  }
  saveConfig();
  return results;
});

ipcMain.handle('library:deleteEpisodeFile', (_, filePath) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ================================================================
//  WATCH HISTORY
// ================================================================
ipcMain.handle('watch:getHistory', (_, seriesName) => {
  return config.watchHistory[seriesName] || { episodesWatched: [], lastWatched: null, malId: null };
});

ipcMain.handle('watch:markEpisode', (_, seriesName, episodeNum) => {
  if (!config.watchHistory[seriesName]) {
    config.watchHistory[seriesName] = { episodesWatched: [], lastWatched: null, malId: null };
  }
  const h = config.watchHistory[seriesName];
  if (!Array.isArray(h.episodesWatched)) h.episodesWatched = [];
  if (!h.episodesWatched.includes(episodeNum)) {
    h.episodesWatched.push(episodeNum);
  }
  h.lastWatched = new Date().toISOString();
  saveConfig();

  // Auto-delete if enabled (watch & delete mode)
  if (config.watchAndDelete) {
    // Delay to avoid file lock conflicts
    setTimeout(() => {
      const seriesEntry = lastLibraryScan.find(s => s.name === seriesName);
      if (seriesEntry && seriesEntry.episodes) {
        const ep = seriesEntry.episodes.find(e => parseMediaNumber(e.name) === episodeNum);
        if (ep && fs.existsSync(ep.path)) {
          try { fs.unlinkSync(ep.path); console.log('[Watch&Delete] Deleted', ep.name); }
          catch (e) { console.error('[Watch&Delete] Failed to delete', ep.path, e.message); }
        }
      }
    }, 5000);
  }

  return true;
});

ipcMain.handle('watch:markUpTo', (_, seriesName, epNum, allEpNums) => {
  if (!config.watchHistory[seriesName]) config.watchHistory[seriesName] = { episodesWatched: [], lastWatched: null, malId: null };
  const h = config.watchHistory[seriesName];
  if (!Array.isArray(h.episodesWatched)) h.episodesWatched = [];
  for (const n of allEpNums) {
    if (n <= epNum && !h.episodesWatched.includes(n)) h.episodesWatched.push(n);
  }
  h.lastWatched = new Date().toISOString();
  saveConfig();
  return true;
});

ipcMain.handle('watch:unmarkFrom', (_, seriesName, epNum) => {
  if (!config.watchHistory[seriesName]) return true;
  const h = config.watchHistory[seriesName];
  if (!Array.isArray(h.episodesWatched)) return true;
  h.episodesWatched = h.episodesWatched.filter(n => n < epNum);
  saveConfig();
  return true;
});

ipcMain.handle('watch:setEpisodesWatched', (_, seriesName, epList) => {
  if (!config.watchHistory[seriesName]) config.watchHistory[seriesName] = { episodesWatched: [], lastWatched: null, malId: null };
  config.watchHistory[seriesName].episodesWatched = [...epList];
  saveConfig();
  return true;
});

ipcMain.handle('watch:setMalId', (_, seriesName, malId) => {
  if (!config.watchHistory[seriesName]) config.watchHistory[seriesName] = { episodesWatched: [], lastWatched: null, malId: null };
  config.watchHistory[seriesName].malId = malId;
  saveConfig();
  return true;
});

ipcMain.handle('watch:setMalData', (_, seriesName, malData) => {
  if (!config.watchHistory[seriesName]) config.watchHistory[seriesName] = { episodesWatched: [], lastWatched: null, malId: null };
  // Merge instead of replace to preserve my_list_status if the API response omits it
  config.watchHistory[seriesName].malData = { ...config.watchHistory[seriesName].malData, ...malData };
  saveConfig();
  return true;
});

// ================================================================
//  PLAYER
// ================================================================
const { spawn } = require('child_process');

function resolveMpvPath() {
  if (config.playerType === 'bundled-mpv') {
    const bundled = path.join(process.resourcesPath, 'mpv', 'mpv.exe');
    if (fs.existsSync(bundled)) return bundled;
    const dev = path.join(__dirname, 'mpv', 'mpv.exe');
    if (fs.existsSync(dev)) return dev;
  }
  return config.mpvPath || 'mpv';
}

ipcMain.handle('player:play', async (_, filePath, seriesName, episodeNum) => {
  try {
    const isManga = config.vaultMode === 'manga';
    const ext = path.extname(filePath).toLowerCase();
    if (isManga || MANGA_EXTS.includes(ext)) {
      // Open with manga reader
      const reader = config.readerPath;
      if (reader && fs.existsSync(reader)) {
        spawn(reader, [filePath], { detached: true });
      } else {
        await shell.openPath(filePath);
      }
      return { error: null };
    }

    const playerType = config.playerType || 'vlc';
    const subPrimary = config.subLangPrimary || '';
    const subFallback = config.subLangFallback || '';
    const audioDelay = config.audioDelay ? '-300' : '0';

    if (playerType === 'vlc') {
      const vlcPath = config.vlcPath || 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe';
      const args = [filePath];
      // Resolve episodeNum from filename if the renderer passed null
      const resolvedEpNum = episodeNum ?? parseEpisodeNumber(path.basename(filePath));
      // Enable HTTP interface for auto-mark polling
      if (config.autoMarkEnabled !== false && resolvedEpNum !== null) {
        args.push(`--extraintf=http`);
        args.push(`--http-port=${VLC_HTTP_PORT}`);
        args.push(`--http-password=${VLC_HTTP_PASSWORD}`);
      }
      if (subPrimary) args.push(`--sub-language=${subPrimary}`);
      if (subFallback) args.push(`--sub-language=${subFallback}`);
      if (audioDelay !== '0') args.push(`--audio-desync=${audioDelay}`);
      spawn(vlcPath, args, { detached: true });
      if (config.autoMarkEnabled !== false && resolvedEpNum !== null) {
        // Give VLC a moment to start the HTTP server
        setTimeout(() => startAutoMarkPoller('vlc', seriesName, resolvedEpNum), 2000);
      }
    } else if (playerType === 'mpv' || playerType === 'bundled-mpv') {
      const mpvPath = resolveMpvPath();
      const args = [filePath];
      // Resolve episodeNum from filename if the renderer passed null
      const resolvedEpNum = episodeNum ?? parseEpisodeNumber(path.basename(filePath));
      // Enable IPC for auto-mark polling
      if (config.autoMarkEnabled !== false && resolvedEpNum !== null) {
        args.push(`--input-ipc-server=${MPV_IPC_PIPE}`);
      }
      if (subPrimary) args.push(`--slang=${subPrimary}`);
      if (subFallback) args.push(`--slang=${subFallback}`);
      if (audioDelay !== '0') args.push(`--audio-delay=${audioDelay}`);
      // Clean up old socket if it exists (non-Windows)
      if (config.autoMarkEnabled !== false && process.platform !== 'win32' && fs.existsSync(MPV_IPC_PIPE)) {
        try { fs.unlinkSync(MPV_IPC_PIPE); } catch (e) {}
      }
      spawn(mpvPath, args, { detached: true });
      if (config.autoMarkEnabled !== false && resolvedEpNum !== null) {
        setTimeout(() => startAutoMarkPoller('mpv', seriesName, resolvedEpNum), 2000);
      }
    } else {
      await shell.openPath(filePath);
    }

    return { error: null };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('player:getBundledInfo', () => ({ bundledMpvPath: resolveMpvPath() }));

// ================================================================
//  AUTO-MARK PLAYBACK POLLING (VLC HTTP + MPV IPC)
// ================================================================
const VLC_HTTP_PORT = 18292; // unlikely to conflict
const VLC_HTTP_PASSWORD = 'animevault';
const MPV_IPC_PIPE = process.platform === 'win32' ? '\\\\.\\pipe\\mpv-animevault' : path.join(app.getPath('temp'), 'mpv-animevault.sock');

let _amPollInterval = null;      // active setInterval handle
let _amCurrentPlayer = null;     // 'vlc' | 'mpv'
let _amSeriesName = null;
let _amEpisodeNum = null;
let _amAlreadyMarked = false;    // guard against duplicate emissions

// --- VLC HTTP polling ---
function vlcGetStatus() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${VLC_HTTP_PORT}/requests/status.xml`, {
      auth: `:${VLC_HTTP_PASSWORD}`,
      timeout: 3000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const posMatch = data.match(/<position>([\d.]+)<\/position>/);
          const lenMatch = data.match(/<length>(\d+)<\/length>/);
          const stateMatch = data.match(/<state>(\w+)<\/state>/);
          const position = posMatch ? parseFloat(posMatch[1]) : 0;
          const length = lenMatch ? parseInt(lenMatch[1]) : 0;
          const state = stateMatch ? stateMatch[1] : '';
          // position in status.xml is 0..1 fraction when using old API,
          // but with current VLC it's absolute seconds. Normalize.
          const pct = length > 0 ? (position > 1 ? (position / length) * 100 : position * 100) : 0;
          resolve({ pct: Math.min(pct, 100), playing: state === 'playing' });
        } catch (e) { resolve({ pct: 0, playing: false }); }
      });
    });
    req.on('error', () => resolve({ pct: 0, playing: false }));
    req.on('timeout', () => { req.destroy(); resolve({ pct: 0, playing: false }); });
  });
}

// --- MPV IPC polling ---
function mpvGetPercentPos() {
  return new Promise((resolve) => {
    const client = net.createConnection(MPV_IPC_PIPE);
    let buffer = '';
    let resolved = false;
    client.on('connect', () => {
      client.write(JSON.stringify({ command: ['get_property', 'percent-pos'] }) + '\n');
    });
    client.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const resp = JSON.parse(line);
          if (resp.data !== undefined && !resolved) {
            resolved = true;
            client.end();
            resolve({ pct: parseFloat(resp.data) || 0, playing: true });
          }
        } catch (e) {}
      }
    });
    client.on('error', () => { if (!resolved) { resolved = true; resolve({ pct: 0, playing: false }); } });
    client.on('close', () => { if (!resolved) { resolved = true; resolve({ pct: 0, playing: false }); } });
    setTimeout(() => { if (!resolved) { resolved = true; client.destroy(); resolve({ pct: 0, playing: false }); } }, 3000);
  });
}

// --- Shared polling loop ---
function startAutoMarkPoller(playerType, seriesName, episodeNum) {
  stopAutoMarkPoller();
  _amCurrentPlayer = playerType;
  _amSeriesName = seriesName;
  _amEpisodeNum = episodeNum;
  _amAlreadyMarked = false;

  if (!config.autoMarkEnabled) return;
  const threshold = config.autoMarkPercent || 80;

  _amPollInterval = setInterval(async () => {
    if (_amAlreadyMarked) { stopAutoMarkPoller(); return; }

    let result;
    if (_amCurrentPlayer === 'vlc') {
      result = await vlcGetStatus();
    } else if (_amCurrentPlayer === 'mpv') {
      result = await mpvGetPercentPos();
    } else {
      stopAutoMarkPoller(); return;
    }

    if (!result.playing && result.pct === 0) {
      // Process likely exited or nothing playing — keep polling a few more times
      return;
    }

    if (result.pct >= threshold) {
      _amAlreadyMarked = true;
      if (_amEpisodeNum === null || _amEpisodeNum === undefined || isNaN(_amEpisodeNum)) {
        console.warn('[AutoMark] episodeNum is null — skipping mark for', _amSeriesName);
        stopAutoMarkPoller();
        return;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('player:automark', {
          seriesName: _amSeriesName,
          episodeNum: _amEpisodeNum,
          percent: Math.round(result.pct)
        });
      }
      stopAutoMarkPoller();
    }
  }, 5000); // poll every 5 seconds
}

function stopAutoMarkPoller() {
  if (_amPollInterval) { clearInterval(_amPollInterval); _amPollInterval = null; }
  _amCurrentPlayer = null;
}

// Clean up on quit
app.on('before-quit', stopAutoMarkPoller);

// Thumbnail extraction (F10)
ipcMain.handle('player:extractThumbnail', async (_, filePath, seriesName, episodeNum) => {
  const thumbDir = path.join(app.getPath('userData'), 'thumbnails', seriesName.replace(/[\\/:*?"<>|]/g, '_'));
  fs.mkdirSync(thumbDir, { recursive: true });
  const outPath = path.join(thumbDir, `ep_${String(episodeNum).padStart(3, '0')}.jpg`);
  if (fs.existsSync(outPath)) return { success: true, path: outPath };
  
  const mpv = resolveMpvPath();
  return new Promise((resolve) => {
    execFile(mpv, [filePath, '--no-audio', '--no-sub', '--frames=1', '--start=20%', `--o=${outPath}`], { timeout: 30000 }, (err) => {
      if (err) { console.error('[Thumb] Extraction failed:', err.message); resolve({ success: false, error: err.message }); }
      else { resolve({ success: true, path: outPath }); }
    });
  });
});

// ================================================================
//  SHELL
// ================================================================
ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url));
ipcMain.handle('shell:openFolder', (_, p) => shell.openPath(p));

// ================================================================
//  COVER CACHE
// ================================================================
const { URL } = require('url');

function getCachePath(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex');
  return path.join(CACHE_DIR, `${hash}.jpg`);
}

async function fetchImage(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchImage(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

ipcMain.handle('cover:getDataUrl', async (_, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const buf = fs.readFileSync(filePath);
      return 'data:image/jpeg;base64,' + buf.toString('base64');
    }
    return null;
  } catch (e) { return null; }
});

// ================================================================
//  ANILIST
// ================================================================
function anilistQuery(query, variables) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'graphql.anilist.co',
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.data || {});
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

ipcMain.handle('anilist:search', async (_, title, count = 1) => {
  try {
    const data = await anilistQuery(`
      query($search: String, $perPage: Int) {
        Page(perPage: $perPage) {
          media(search: $search, type: ANIME) {
            id
            title { romaji english native }
            coverImage { large }
            description
          }
        }
      }
    `, { search: title, perPage: count });
    return (data.Page && data.Page.media) || [];
  } catch (e) { return []; }
});

ipcMain.handle('anilist:fetchCover', async (_, seriesName, url) => {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const cacheFile = path.join(CACHE_DIR, encodeURIComponent(seriesName) + '.jpg');
    if (fs.existsSync(cacheFile)) {
      return cacheFile;
    }
    const buf = await fetchImage(url);
    fs.writeFileSync(cacheFile, buf);
    return cacheFile;
  } catch (e) {
    console.error('[AniList] Cover fetch failed:', e.message);
    return null;
  }
});

ipcMain.handle('anilist:getCachedCover', (_, name) => {
  const cacheFile = path.join(CACHE_DIR, encodeURIComponent(name) + '.jpg');
  if (fs.existsSync(cacheFile)) {
    return cacheFile;
  }
  return null;
});

ipcMain.handle('anilist:fetchAllCovers', async (_, seriesList) => {
  const results = [];
  for (const series of seriesList) {
    const cacheFile = path.join(CACHE_DIR, encodeURIComponent(series.name) + '.jpg');
    if (fs.existsSync(cacheFile)) {
      results.push({ name: series.name, path: cacheFile, status: 'cached' });
      continue;
    }
    try {
      const data = await anilistQuery(`
        query($search: String) {
          Page(perPage: 1) {
            media(search: $search, type: ANIME) {
              id
              title { romaji english native }
              coverImage { large medium }
            }
          }
        }
      `, { search: series.name });
      const media = data.Page && data.Page.media && data.Page.media[0];
      if (media && media.coverImage && media.coverImage.large) {
        const buf = await fetchImage(media.coverImage.large);
        fs.writeFileSync(cacheFile, buf);
        results.push({ name: series.name, path: cacheFile, status: 'fetched' });
      } else {
        results.push({ name: series.name, path: null, status: 'no_image' });
      }
    } catch (e) {
      console.error('[AniList] fetchAllCovers error for', series.name, e.message);
      results.push({ name: series.name, path: null, status: 'error' });
    }
  }
  return results;
});

// ================================================================
//  MAL AUTHENTICATION & API
// ================================================================
function malRequest(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    if (!config.malAccessToken) return reject(new Error('Not authenticated'));
    // MAL API v2 requires x-www-form-urlencoded for PATCH/POST, JSON is for GET
    const isForm = body && (method === 'PATCH' || method === 'POST');
    const postData = isForm
      ? new URLSearchParams(body).toString()
      : (body ? JSON.stringify(body) : '');
    const req = https.request({
      hostname: 'api.myanimelist.net',
      path: '/v2' + endpoint,
      method,
      headers: {
        'Authorization': 'Bearer ' + config.malAccessToken,
        'Content-Type': isForm ? 'application/x-www-form-urlencoded' : 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function malRefreshAccessToken() {
  try {
    const response = await new Promise((resolve, reject) => {
      const postData = new URLSearchParams({
        client_id: config.malClientId,
        client_secret: config.malClientSecret,
        grant_type: 'refresh_token',
        refresh_token: config.malRefreshToken
      }).toString();
      const req = https.request({
        hostname: 'myanimelist.net',
        path: '/v1/oauth2/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
    if (response.access_token) {
      config.malAccessToken = response.access_token;
      config.malRefreshToken = response.refresh_token;
      config.malTokenExpiry = Date.now() + (response.expires_in || 3600) * 1000;
      saveConfig();
      console.log('[MAL] Token refreshed');
      return true;
    }
    return false;
  } catch (e) {
    console.error('[MAL] Token refresh failed:', e.message);
    return false;
  }
}

async function malRequestWithRetry(endpoint, method = 'GET', body = null) {
  let r;
  try {
    r = await malRequest(endpoint, method, body);
  } catch (e) {
    console.error('[MAL] Initial request failed:', e.message);
    return { status: 0, data: null, error: e.message };
  }
  // If 401, try refreshing token and retry once
  if (r.status === 401 && config.malRefreshToken) {
    const refreshed = await malRefreshAccessToken();
    if (refreshed) {
      try { r = await malRequest(endpoint, method, body); }
      catch (e) { return { status: 0, data: null, error: e.message }; }
    }
  }
  return r;
}

function fuzzyTitleMatch(a, b) {
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  // Simple edit-distance-ish score
  let common = 0;
  const sa = new Set(na), sb = new Set(nb);
  for (const c of sa) if (sb.has(c)) common++;
  return common / Math.max(sa.size, sb.size);
}

ipcMain.handle('mal:isAuthenticated', () => {
  return !!config.malAccessToken && Date.now() < config.malTokenExpiry;
});

ipcMain.handle('mal:getAuthUrl', (_, clientId, clientSecret) => {
  config.malClientId = clientId;
  config.malClientSecret = clientSecret;
  config.malCodeVerifier = crypto.randomBytes(32).toString('base64url');
  saveConfig();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    code_challenge: crypto.createHash('sha256').update(config.malCodeVerifier).digest('base64url'),
    code_challenge_method: 'S256'
  });
  return `https://myanimelist.net/v1/oauth2/authorize?${params.toString()}`;
});

ipcMain.handle('mal:startAuthServer', async () => {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost:8080');
      const code = url.searchParams.get('code');
      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>MAL Auth Successful</h1><p>You can close this window.</p></body></html>');
        server.close();
        resolve(code);
      } else {
        res.writeHead(400);
        res.end('No code');
      }
    });
    server.listen(8080, () => console.log('[MAL] Auth server listening on 8080'));
    server.on('error', () => resolve(null));
    setTimeout(() => { server.close(); resolve(null); }, 300000);
  });
});

ipcMain.handle('mal:exchangeToken', async (_, code) => {
  try {
    const response = await new Promise((resolve, reject) => {
      const postData = new URLSearchParams({
        client_id: config.malClientId,
        client_secret: config.malClientSecret,
        code,
        code_verifier: config.malCodeVerifier,
        grant_type: 'authorization_code'
      }).toString();
      const req = https.request({
        hostname: 'myanimelist.net',
        path: '/v1/oauth2/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
    if (response.access_token) {
      config.malAccessToken = response.access_token;
      config.malRefreshToken = response.refresh_token;
      config.malTokenExpiry = Date.now() + (response.expires_in || 3600) * 1000;
      saveConfig();
      return { success: true };
    }
    return { success: false, error: response.error || 'Unknown error' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('mal:search', async (_, query) => {
  const isManga = config.vaultMode === 'manga';
  const endpoint = isManga
    ? `/manga?q=${encodeURIComponent(query)}&limit=10&fields=id,title,main_picture,mean,media_type,status`
    : `/anime?q=${encodeURIComponent(query)}&limit=10&fields=id,title,main_picture,mean,media_type,status`;
  const r = await malRequestWithRetry(endpoint);
  return r.data || [];
});

ipcMain.handle('mal:getAnimeDetails', async (_, malId) => {
  const isManga = config.vaultMode === 'manga';
  const fields = isManga
    ? 'id,title,main_picture,mean,media_type,status,num_chapters,synopsis,genres,start_date,my_list_status'
    : 'id,title,main_picture,mean,media_type,status,num_episodes,synopsis,genres,start_date,my_list_status';
  const endpoint = isManga ? `/manga/${malId}?fields=${fields}` : `/anime/${malId}?fields=${fields}`;
  const r = await malRequestWithRetry(endpoint);
  return r.data || null;
});

ipcMain.handle('mal:updateStatus', async (_, malId, numWatched, status) => {
  const isManga = config.vaultMode === 'manga';
  const endpoint = isManga ? `/manga/${malId}/my_list_status` : `/anime/${malId}/my_list_status`;
  const body = isManga ? { num_chapters_read: numWatched, status } : { num_watched_episodes: numWatched, status };
  const r = await malRequestWithRetry(endpoint, 'PATCH', body);
  return r.data || null;
});

ipcMain.handle('mal:addOrUpdateListItem', async (_, malId, fields) => {
  const isManga = config.vaultMode === 'manga';
  const endpoint = isManga ? `/manga/${malId}/my_list_status` : `/anime/${malId}/my_list_status`;
  const r = await malRequestWithRetry(endpoint, 'PATCH', fields);
  return r.data || null;
});

ipcMain.handle('mal:editStatus', async (_, malId, fields, seriesName) => {
  const isManga = config.vaultMode === 'manga';
  const endpoint = isManga ? `/manga/${malId}/my_list_status` : `/anime/${malId}/my_list_status`;
  const r = await malRequestWithRetry(endpoint, 'PATCH', fields);
  if (r.data && seriesName) {
    if (!config.watchHistory[seriesName]) config.watchHistory[seriesName] = {};
    // Normalize: the API returns flat list-status fields; wrap them under my_list_status
    // so they match the shape from malGetAnimeDetails
    const wrapped = { my_list_status: r.data };
    config.watchHistory[seriesName].malData = { ...config.watchHistory[seriesName].malData, ...wrapped };
    saveConfig();
  }
  return r.data || null;
});

ipcMain.handle('mal:deleteEntry', async (_, malId) => {
  const isManga = config.vaultMode === 'manga';
  const endpoint = isManga ? `/manga/${malId}/my_list_status` : `/anime/${malId}/my_list_status`;
  const r = await malRequestWithRetry(endpoint, 'DELETE');
  return r.status === 200;
});

ipcMain.handle('mal:autoSync', async (_, seriesName) => {
  const wd = config.watchHistory[seriesName];
  if (!wd || !wd.malId) return { synced: false, error: 'No MAL link' };
  const numWatched = (wd.episodesWatched || []).length;
  const isManga = config.vaultMode === 'manga';
  const endpoint = isManga ? `/manga/${wd.malId}/my_list_status` : `/anime/${wd.malId}/my_list_status`;
  const r = await malRequestWithRetry(endpoint, 'GET');
  if (r.status === 200 && r.data) {
    const current = isManga ? (r.data.num_chapters_read || 0) : (r.data.num_watched_episodes || 0);
    if (numWatched > current) {
      const patchBody = isManga ? { num_chapters_read: numWatched } : { num_watched_episodes: numWatched };
      await malRequestWithRetry(endpoint, 'PATCH', patchBody);
      return { synced: true, updated: numWatched };
    }
    return { synced: true, updated: null };
  }
  return { synced: false, error: r.error || 'Request failed' };
});

ipcMain.handle('mal:bulkAutoSync', async (_, seriesList) => {
  const results = [];
  const isManga = config.vaultMode === 'manga';
  for (const name of seriesList) {
    try {
      // Skip if already linked
      const wd = config.watchHistory[name];
      if (wd && wd.malId) {
        results.push({ name, status: 'linked', malId: wd.malId });
        continue;
      }
      // Search MAL for this series
      const searchEndpoint = isManga
        ? `/manga?q=${encodeURIComponent(name)}&limit=10&fields=id,title,main_picture,mean,media_type,status,num_chapters`
        : `/anime?q=${encodeURIComponent(name)}&limit=10&fields=id,title,main_picture,mean,media_type,status,num_episodes`;
      const searchR = await malRequestWithRetry(searchEndpoint);
      const items = (searchR.data || []).map(x => x.node || x).filter(Boolean);
      if (!items.length) {
        results.push({ name, status: 'needs_review', reason: 'No MAL results' });
        continue;
      }
      // Score each result with fuzzy title matching
      let best = null, bestScore = 0;
      for (const item of items) {
        const titles = [item.title, item.alternative_titles?.en, item.alternative_titles?.ja].filter(Boolean);
        for (const t of titles) {
          const score = fuzzyTitleMatch(name, t);
          if (score > bestScore) {
            bestScore = score;
            best = item;
          }
        }
      }
      // Threshold: 0.6 for auto-link, below that needs manual review
      const AUTO_LINK_THRESHOLD = 0.6;
      if (best && bestScore >= AUTO_LINK_THRESHOLD) {
        // Auto-link this series
        if (!config.watchHistory[name]) config.watchHistory[name] = { episodesWatched: [], lastWatched: null, malId: null };
        config.watchHistory[name].malId = best.id;
        saveConfig();
        results.push({ name, status: 'linked', malId: best.id, title: best.title, score: bestScore });
      } else {
        results.push({ name, status: 'needs_review', reason: 'No confident match', bestMatch: best?.title || null, bestScore: bestScore || 0 });
      }
    } catch (e) {
      results.push({ name, status: 'needs_review', reason: 'Search error: ' + (e.message || e) });
    }
  }
  saveConfig();
  return results;
});

ipcMain.handle('mal:unlinkSeries', (_, seriesName) => {
  if (config.watchHistory[seriesName]) {
    delete config.watchHistory[seriesName].malId;
    delete config.watchHistory[seriesName].malData;
    saveConfig();
  }
  return true;
});

ipcMain.handle('mal:getTopAnime', async (_, limit = 50, offset = 0) => {
  const isManga = config.vaultMode === 'manga';
  const endpoint = isManga
    ? `/manga/ranking?ranking_type=all&limit=${limit}&offset=${offset}&fields=id,title,main_picture,mean,media_type,status`
    : `/anime/ranking?ranking_type=all&limit=${limit}&offset=${offset}&fields=id,title,main_picture,mean,media_type,status`;
  const r = await malRequestWithRetry(endpoint);
  return r.data || [];
});

ipcMain.handle('mal:getSeasonal', async (_, year, season) => {
  const r = await malRequestWithRetry(`/anime/season/${year}/${season}?limit=50&fields=id,title,main_picture,num_episodes,status,mean,media_type,genres,start_date,synopsis`);
  return r.data || [];
});

ipcMain.handle('mal:getUserList', async (_, status = '', limit = 1000, offset = 0) => {
  const isManga = config.vaultMode === 'manga';
  let url = isManga
    ? `/users/@me/mangalist?limit=${limit}&offset=${offset}&fields=list_status,status,num_chapters,start_date`
    : `/users/@me/animelist?limit=${limit}&offset=${offset}&fields=list_status,status,num_episodes,broadcast,start_date`;
  if (status) url += `&status=${status}`;
  const r = await malRequestWithRetry(url);
  return r.data || [];
});

ipcMain.handle('mal:getSyncLog', () => {
  return (config.malSyncLog || []).slice(-100);
});

ipcMain.handle('mal:clearSyncLog', () => {
  config.malSyncLog = [];
  saveConfig();
  return true;
});

// ================================================================
//  NYAA SEARCH
// ================================================================
function nyaaSearchHtml(searchQuery) {
  return new Promise((resolve) => {
    const url = `https://nyaa.si/?f=0&c=0_0&q=${encodeURIComponent(searchQuery)}`;
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve([]);
      }
      let html = '';
      res.on('data', chunk => html += chunk);
      res.on('end', () => {
        const results = [];
        try {
          const rows = html.match(/<tr class="[^"]*default[^"]*"[\s\S]*?<\/tr>/g) || [];
          for (const row of rows) {
            try {
              const titleMatch = row.match(/<a[^>]*href="\/view\/\d+"[^>]*title="([^"]+)"/);
              const idMatch = row.match(/<a[^>]*href="\/view\/(\d+)"/);
              const sizeMatch = row.match(/<td[^>]*class="text-center[^"]*"[^>]*>[\s\S]*?<\/td>[\s\S]*?<td[^>]*class="text-center[^"]*"[^>]*>[\s\S]*?<\/td>[\s\S]*?<td[^>]*class="text-center[^"]*"[^>]*>([\s\S]*?)<\/td>/);
              const seedersMatch = row.match(/<td[^>]*class="text-center[^"]*"[^>]*>(\d+)<\/td>/g);
              const magnetMatch = row.match(/href="(magnet:\?[^"]+)"/);
              if (titleMatch && idMatch) {
                results.push({
                  id: idMatch[1],
                  title: titleMatch[1],
                  size: sizeMatch ? sizeMatch[1].trim() : '',
                  seeders: seedersMatch && seedersMatch[2] ? parseInt(seedersMatch[2].replace(/<[^>]+>/g, '')) || 0 : 0,
                  magnet: magnetMatch ? magnetMatch[1] : ''
                });
              }
            } catch(e2) { console.error('[Nyaa] HTML parse row error:', e2.message); }
          }
        } catch(e) { console.error('[Nyaa] HTML parse error:', e.message); }
        resolve(results);
      });
    });
    req.on('error', (e) => { console.error('[Nyaa] HTML request error:', e.message); resolve([]); });
    req.setTimeout(15000, () => { req.destroy(); resolve([]); });
  });
}

function nyaaSearch(searchQuery) {
  return new Promise((resolve) => {
    const rssUrl = `https://nyaa.si/?page=rss&q=${encodeURIComponent(searchQuery)}&c=0_0&f=0`;
    const req = https.get(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve([]);
      }
      let xml = '';
      res.on('data', chunk => xml += chunk);
      res.on('end', () => {
        const results = [];
        try {
          const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
          for (const item of items) {
            try {
              const title = (item.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
              const link = (item.match(/<link>([^<]+)<\/link>/) || [])[1] || '';
              const id = link.match(/\/view\/(\d+)/) ? link.match(/\/view\/(\d+)/)[1] : '';
              const size = (item.match(/<nyaa:size>([^<]+)<\/nyaa:size>/) || [])[1] || '';
              const seeders = parseInt((item.match(/<nyaa:seeders>([^<]+)<\/nyaa:seeders>/) || [])[1] || '0');
              const magnet = (item.match(/<nyaa:infoHash>([^<]+)<\/nyaa:infoHash>/) || [])[1] || '';
              const nyaaMagnet = magnet ? `magnet:?xt=urn:btih:${magnet}&dn=${encodeURIComponent(title)}` : '';
              results.push({ id, title, size, seeders, magnet: nyaaMagnet });
            } catch(e2) { console.error('[Nyaa] RSS parse row error:', e2.message); }
          }
        } catch(e) { console.error('[Nyaa] RSS parse error:', e.message); }
        if (results.length === 0) {
          // Fall back to HTML scraping with original query
          nyaaSearchHtml(searchQuery).then(resolve).catch((e) => { console.error('[Nyaa] HTML fallback error:', e.message); resolve([]); });
        } else {
          resolve(results);
        }
      });
    });
    req.on('error', (e) => { console.error('[Nyaa] RSS request error:', e.message); nyaaSearchHtml(searchQuery).then(resolve).catch((e2) => { console.error('[Nyaa] HTML fallback error:', e2.message); resolve([]); }); });
    req.setTimeout(15000, () => { req.destroy(); resolve([]); });
  });
}

ipcMain.handle('nyaa:search', async (_, query) => {
  return nyaaSearch(query);
});

ipcMain.handle('nyaa:autoDownload', async (_, seriesTitle, quality, preferredUploader, epNum, mode = 'ep') => {
  try {
    const uploader = preferredUploader || config.nyaaUploader || 'erai';
    const q = quality || config.nyaaQuality || '1080p';
    const queries = [];
    if (uploader === 'erai') {
      queries.push(`[Erai-raws] ${seriesTitle} ${epNum} ${q}`);
      queries.push(`[Erai-raws] ${seriesTitle} ${epNum}`);
    } else if (uploader === 'subsplease') {
      queries.push(`[SubsPlease] ${seriesTitle} (${q}) ${epNum}`);
    } else {
      queries.push(`${seriesTitle} ${epNum} ${q}`);
    }
    queries.push(`${seriesTitle} ${epNum}`);

    let allResults = [];
    const seenIds = new Set();
    for (const qText of queries) {
      const r = await nyaaSearch(qText);
      for (const item of r) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          allResults.push(item);
        }
      }
      if (allResults.length > 0) break;
    }

    if (!allResults.length) return { success: false, error: 'No results found' };

    // Score and pick best
    const targetEp = parseInt(epNum, 10);
    const matched = allResults.map(r => ({ ...r, ep: parseNyaaEpisodeNumber(r.title) }))
      .filter(r => r.ep === targetEp);
    if (!matched.length) return { success: false, error: 'No exact episode match' };

    const chosen = matched.reduce((best, r) => {
      const s = scoreRelease(r, uploader);
      const bs = best ? scoreRelease(best, uploader) : -Infinity;
      return s > bs ? r : best;
    }, null);

    if (!chosen) return { success: false, error: 'Scoring produced no winner' };

    // Download
    const dedupKey = [seriesTitle, epNum, mode].join('|');
    const nowMs = Date.now();
    const logEntry = {
      timestamp: nowMs,
      key: dedupKey,
      series: seriesTitle,
      episode: epNum,
      dlMode: mode,
      chosenTitle: chosen.title,
      seeders: chosen.seeders || 0,
      size: chosen.size || '',
      nyaaId: chosen.id || '',
      preferredUploader: uploader,
      method: 'external'
    };
    pushDownloadHistory(logEntry);

    if (chosen.id) {
      const torrentData = await downloadNyaaTorrentFile(chosen.id);
      const tmpDir = path.join(app.getPath('temp'), 'animevault-torrents');
      fs.mkdirSync(tmpDir, { recursive: true });
      const safeName = chosen.title.replace(/[\\/:*?"<>|]/g, '_').substring(0, 80);
      const tmpFile = path.join(tmpDir, safeName + '.torrent');
      fs.writeFileSync(tmpFile, torrentData);
      await shell.openPath(tmpFile);
    } else {
      await shell.openExternal(chosen.magnet);
    }

    return { success: true, title: chosen.title, seeders: chosen.seeders };
  } catch (e) {
    console.error('[Nyaa:autoDownload] Error:', e.message);
    return { success: false, error: e.message };
  }
});

function normalizeMagnet(magnet) {
  if (!magnet || !magnet.startsWith('magnet:')) return '';
  try {
    const hash = magnet.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
    if (hash) return hash[1].toLowerCase();
  } catch (e) {}
  return '';
}

function pushDownloadHistory(entry) {
  if (!Array.isArray(config.downloadHistory)) config.downloadHistory = [];
  config.downloadHistory.push(entry);
  // Keep last 500
  if (config.downloadHistory.length > 500) config.downloadHistory = config.downloadHistory.slice(-500);
  saveConfig();
}

// ================================================================
//  AUTO-DOWNLOAD MODULE INTEGRATION
// ================================================================
autoDownload.setDeps({
  config, saveConfig, mainWindow: () => mainWindow, shell, app,
  getLocalHighestEpisode, getLocalEpisodes, pushDownloadHistory, malRequestWithRetry, fuzzyTitleMatch,
  nyaaSearch, normalizeMagnet,
  getLibraryScan: () => lastLibraryScan,
  getWatchDataSync: (name) => {
    // Watch data lives in config.watchHistory, not a separate file
    return config.watchHistory[name] || null;
  }
});

ipcMain.handle('autoDownload:getWatchlist', () => config.autoDownloadWatchlist || []);
ipcMain.handle('autoDownload:addSeries', (_, entry) => {
  if (!config.autoDownloadWatchlist) config.autoDownloadWatchlist = [];
  config.autoDownloadWatchlist.push(entry);
  saveConfig();
  return true;
});
ipcMain.handle('autoDownload:removeSeries', (_, seriesName) => {
  config.autoDownloadWatchlist = (config.autoDownloadWatchlist || []).filter(w => w.seriesName !== seriesName);
  saveConfig();
  return true;
});
ipcMain.handle('autoDownload:updateSeries', (_, seriesName, updates) => {
  const entry = (config.autoDownloadWatchlist || []).find(w => w.seriesName === seriesName);
  if (entry) { Object.assign(entry, updates); saveConfig(); }
  return true;
});
ipcMain.handle('autoDownload:toggle', (_, enabled) => {
  config.autoDownloadEnabled = enabled;
  saveConfig();
  if (enabled) startAutoDownloadPoller();
  else stopAutoDownloadPoller();
  return true;
});
ipcMain.handle('autoDownload:getStatus', () => ({
  enabled: config.autoDownloadEnabled,
  watchlistCount: (config.autoDownloadWatchlist || []).length
}));
ipcMain.handle('autoDownload:setPollMinutes', (_, mins) => {
  config.autoDownloadPollMinutes = mins;
  saveConfig();
  if (config.autoDownloadEnabled) { stopAutoDownloadPoller(); startAutoDownloadPoller(); }
  return true;
});
ipcMain.handle('autoDownload:setCriteria', (_, enabled) => {
  config.autoDownloadCriteria = enabled;
  saveConfig();
  return true;
});
ipcMain.handle('autoDownload:pollNow', async (_, force) => {
  const results = await runAutoDownloadPoller(!!force); // true = bypass dedup too; false = bypass enabled check only
  return { success: true, results };
});

ipcMain.handle('downloads:getHistory', () => {
  return Array.isArray(config.downloadHistory) ? config.downloadHistory.slice().reverse() : [];
});
ipcMain.handle('downloads:clearHistory', () => {
  config.downloadHistory = [];
  saveConfig();
  return true;
});
ipcMain.handle('downloads:checkRecent', (_, seriesTitle, epNum, dlMode) => {
  if (!Array.isArray(config.downloadHistory)) return false;
  const key = [seriesTitle, epNum, dlMode].join('|');
  const nowMs = Date.now();
  return config.downloadHistory.some(h => h && h.key === key && (nowMs - (h.timestamp || 0)) < 60 * 60 * 1000);
});

ipcMain.handle('autoDownload:latestEpisode', async (_, seriesName, malId) => {
  const highest = getLocalHighestEpisode(seriesName, malId);
  const nextEp = highest + 1;
  return { highest, nextEp };
});

// ================================================================
//  FILE MANAGER
// ================================================================
ipcMain.handle('manager:rename', async (_, rootFolder, dryRun = true) => {
  if (!fs.existsSync(rootFolder)) return { error: 'Folder not found' };
  const results = [];
  try {
    const dirs = fs.readdirSync(rootFolder, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of dirs) {
      const dirPath = path.join(rootFolder, dir.name);
      const files = getVideoFiles(dirPath);
      for (const file of files) {
        const parsed = parseVideoFilename(file.name, dir.name);
        if (parsed.matched) {
          const newPath = path.join(dirPath, parsed.newName);
          if (!dryRun) fs.renameSync(file.path, newPath);
          results.push({ old: file.name, new: parsed.newName, series: parsed.series });
        }
      }
    }
  } catch (e) { return { error: e.message }; }
  return { results };
});

ipcMain.handle('manager:group', async (_, rootFolder, seasonalFolder, dryRun = true) => {
  if (!fs.existsSync(rootFolder)) return { error: 'Folder not found' };
  const results = [];
  try {
    const files = getVideoFiles(rootFolder);
    for (const file of files) {
      const parsed = parseVideoFilename(file.name);
      if (parsed.matched && parsed.series) {
        const seriesDir = path.join(seasonalFolder || rootFolder, parsed.series);
        if (!dryRun) fs.mkdirSync(seriesDir, { recursive: true });
        const newPath = path.join(seriesDir, parsed.newName);
        if (!dryRun) fs.renameSync(file.path, newPath);
        results.push({ file: file.name, series: parsed.series, newName: parsed.newName });
      }
    }
  } catch (e) { return { error: e.message }; }
  return { results };
});

ipcMain.handle('manager:ungroup', async (_, rootFolder, seasonalFolder, dryRun = true) => {
  if (!fs.existsSync(rootFolder)) return { error: 'Folder not found' };
  const results = [];
  try {
    const dirs = fs.readdirSync(rootFolder, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of dirs) {
      const dirPath = path.join(rootFolder, dir.name);
      const files = getVideoFiles(dirPath);
      for (const file of files) {
        const newPath = path.join(seasonalFolder || rootFolder, file.name);
        if (!dryRun) fs.renameSync(file.path, newPath);
        results.push({ file: file.name, from: dir.name });
      }
    }
  } catch (e) { return { error: e.message }; }
  return { results };
});

ipcMain.handle('manager:batch', async (_, batchFolder, dryRun = true) => {
  if (!fs.existsSync(batchFolder)) return { error: 'Folder not found' };
  const results = [];
  try {
    const files = getVideoFiles(batchFolder);
    const groups = {};
    for (const file of files) {
      const parsed = parseVideoFilename(file.name);
      if (parsed.matched && parsed.series) {
        if (!groups[parsed.series]) groups[parsed.series] = [];
        groups[parsed.series].push(file);
      }
    }
    for (const series in groups) {
      const seriesDir = path.join(batchFolder, series);
      if (!dryRun) fs.mkdirSync(seriesDir, { recursive: true });
      for (const file of groups[series]) {
        const newPath = path.join(seriesDir, file.name);
        if (!dryRun) fs.renameSync(file.path, newPath);
        results.push({ file: file.name, series });
      }
    }
  } catch (e) { return { error: e.message }; }
  return { results };
});

ipcMain.handle('manager:format', async (_, sourceFolder, destFolder) => {
  if (!fs.existsSync(sourceFolder)) return { error: 'Source folder not found' };
  const results = [];
  const undo = [];
  try {
    const items = fs.readdirSync(sourceFolder, { withFileTypes: true });
    for (const item of items) {
      if (!item.isDirectory() || item.name.startsWith('.')) continue;
      const seriesPath = path.join(sourceFolder, item.name);
      const files = getVideoFiles(seriesPath);
      for (const file of files) {
        const parsed = parseVideoFilename(file.name, item.name);
        if (parsed.matched) {
          const newPath = path.join(seriesPath, parsed.newName);
          fs.renameSync(file.path, newPath);
          undo.push({ old: newPath, new: file.path });
          results.push({ old: file.name, new: parsed.newName });
        }
      }
    }
    fs.writeFileSync(path.join(app.getPath('userData'), 'format-undo.json'), JSON.stringify(undo));
  } catch (e) { return { error: e.message }; }
  return { results };
});

ipcMain.handle('manager:formatFolder', async (_, folderPath, newFolderName) => {
  try {
    const newPath = path.join(path.dirname(folderPath), newFolderName);
    fs.renameSync(folderPath, newPath);
    return { success: true, newPath };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('manager:formatManga', async (_, folderPath, newFolderName) => {
  try {
    const newPath = path.join(path.dirname(folderPath), newFolderName);
    fs.renameSync(folderPath, newPath);
    return { success: true, newPath };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('manager:undoFormat', async () => {
  try {
    const undoPath = path.join(app.getPath('userData'), 'format-undo.json');
    if (!fs.existsSync(undoPath)) return { error: 'No undo available' };
    const undo = JSON.parse(fs.readFileSync(undoPath, 'utf-8'));
    for (const op of undo) {
      if (fs.existsSync(op.old)) fs.renameSync(op.old, op.new);
    }
    fs.unlinkSync(undoPath);
    return { success: true };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('manager:hasUndo', () => {
  return fs.existsSync(path.join(app.getPath('userData'), 'format-undo.json'));
});

// ================================================================
//  MANGA
// ================================================================
ipcMain.handle('manga:openFile', (_, filePath) => {
  try {
    const reader = config.readerPath;
    if (reader && fs.existsSync(reader)) {
      spawn(reader, [filePath], { detached: true });
    } else {
      shell.openPath(filePath);
    }
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('manga:detectReaders', async () => {
  const commonPaths = [
    'C:\\Program Files\\OpenComic\\OpenComic.exe',
    'C:\\Program Files (x86)\\OpenComic\\OpenComic.exe',
    'C:\\Program Files\\CDisplayEx\\CDisplayEx.exe',
    'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
    'C:\\Program Files\\Honeyview\\Honeyview.exe'
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return { path: p };
  }
  return { path: null };
});


// Batch C F9: Import/Export & Backup
ipcMain.handle('library:exportMetadata', async () => {
  return { version: 1, exportedAt: new Date().toISOString(), config, library: lastLibraryScan };
});

ipcMain.handle('library:exportCSV', async () => {
  const rows = [['Name', 'Category', 'Episodes', 'Watched', 'MAL ID', 'MAL Score', 'Status']];
  for (const s of lastLibraryScan) {
    const w = s.watchData || {};
    const m = w.malData || {};
    const ls = m.my_list_status || {};
    rows.push([s.name, s.category || '', s.episodeCount, w.episodesWatched ? w.episodesWatched.length : 0, w.malId || '', m.mean || '', ls.status || '']);
  }
  return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '\"')}"`).join(',')).join('\n');
});

ipcMain.handle('library:importAniList', async (_, filePath) => {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    let imported = 0;
    for (const entry of (data.entries || [])) {
      const title = entry.media?.title?.romaji || entry.media?.title?.english;
      if (!title) continue;
      const status = entry.status?.toLowerCase().replace(/_/g, ' ');
      const score = entry.score || 0;
      const progress = entry.progress || 0;
      if (!config.watchHistory[title]) config.watchHistory[title] = {};
      config.watchHistory[title].malData = { ...config.watchHistory[title].malData, mean: score, my_list_status: { status, num_watched_episodes: progress } };
      imported++;
    }
    saveConfig();
    return { success: true, imported };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('library:backup', async (_, destPath) => {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addLocalFile(CONFIG_PATH, '', 'config.json');
    zip.addLocalFolder(CACHE_DIR, 'cover-cache');
    const outPath = destPath || path.join(app.getPath('downloads'), `AnimeVault-Backup-${new Date().toISOString().slice(0,10)}.zip`);
    zip.writeZip(outPath);
    return { success: true, path: outPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('library:restore', async (_, zipPath) => {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    zip.extractEntryTo('config.json', path.dirname(CONFIG_PATH), false, true);
    zip.extractEntryTo('cover-cache/', app.getPath('userData'), false, true);
    loadConfig();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ================================================================
//  FILE WATCHER - poll-based, torrent-safe, smart destination
// ================================================================
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

// Find existing series folder across all library folders
function findExistingSeriesFolder(seriesName) {
  const safe = seriesName.replace(/[\\/:*?"<>|]/g, '_').toLowerCase().trim();
  const isManga = config.vaultMode === 'manga';
  const folders = isManga ? (config.mangaFolders || []) : (config.folders || []);
  for (const folder of folders) {
    if (!fs.existsSync(folder.path)) continue;
    try {
      const dirs = fs.readdirSync(folder.path, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const dir of dirs) {
        const dirClean = dir.name.replace(/[\\/:*?"<>|]/g, '_').toLowerCase().trim();
        if (dirClean === safe) {
          return path.join(folder.path, dir.name);
        }
        // Smarter prefix check: require significant token overlap OR
        // one is a true word-boundary prefix of the other
        const safeWords = new Set(safe.split(/\s+/).filter(w => w.length > 2));
        const dirWords = new Set(dirClean.split(/\s+/).filter(w => w.length > 2));
        let common = 0;
        for (const w of safeWords) if (dirWords.has(w)) common++;
        const tokenScore = safeWords.size && dirWords.size ? common / Math.max(safeWords.size, dirWords.size) : 0;
        const isWordPrefix = dirClean.startsWith(safe) && (safe.length >= 6 || dirClean.length === safe.length);
        const isWordSuffix = safe.startsWith(dirClean) && (dirClean.length >= 6 || dirClean.length === safe.length);
        if (tokenScore >= 0.8 || isWordPrefix || isWordSuffix) {
          return path.join(folder.path, dir.name);
        }
      }
    } catch (e) {}
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
      const shouldIgnore = (config.watcherIgnorePatterns || []).some(p =>
        new RegExp(p.replace(/\*/g, '.*'), 'i').test(f.name)
      );
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
        fs.renameSync(f.path, newPath);
        formatResult.push({ file: f.name, newName: p.newName, series: path.basename(seriesDir) });
        console.log('[Watcher] Moved loose:', f.name, '->', seriesDir);
      } catch (e) {
        console.error('[Watcher] Move error:', f.name, e.message);
      }
    }

    // ── Phase 1.5: Root-level folders that are potential new series ──
    // Folders like "Monster 2004 S01 1080p BluRay..." should be renamed and
    // either merged into existing series or moved whole as a new series.
    const rootDirs = fs.readdirSync(watchFolder, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'animevault-torrents');
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
            fs.renameSync(dirPath, newDirPath);
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
                fs.renameSync(f.path, newFilePath);
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
        const shouldIgnore = (config.watcherIgnorePatterns || []).some(p =>
          new RegExp(p.replace(/\*/g, '.*'), 'i').test(f.name)
        );
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
          fs.renameSync(f.path, newPath);
          formatResult.push({ file: f.name, newName: p.newName, series: path.basename(seriesDir) });
          movedCount++;
        } catch (e) {
          console.error('[Watcher] Move error:', f.name, e.message);
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
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('watcher:newFiles', formatResult);
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
  // First poll after 5s, then every 30s
  setTimeout(() => watcherPoll(), 5000);
  watcherInterval = setInterval(() => watcherPoll(), 30000);
}

function stopFileWatcher() {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }
}

ipcMain.handle('watcher:start', (_, watchFolder, destFolder) => {
  config.watcherFolder = watchFolder;
  config.watcherDest = destFolder;
  saveConfig();
  startFileWatcher(watchFolder, destFolder);
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
    const targetDir = path.join(destFolder || config.watcherDest || config.folders[0]?.path || '', item.series);
    fs.mkdirSync(targetDir, { recursive: true });

    // If placing an entire folder, move it into the destination
    if (item.isFolder) {
      // When moving a folder, place it inside the targetDir
      // The folder name should already be the clean series name
      const targetPath = path.join(targetDir, item.series);
      if (fs.existsSync(targetPath)) {
        // Destination already exists: move files inside individually
        const files = (config.vaultMode === 'manga' ? getMangaFiles : getVideoFiles)(item.originalPath, false);
        let moved = 0;
        for (const f of files) {
          const destFile = path.join(targetPath, path.basename(f.path));
          if (!fs.existsSync(destFile)) {
            fs.renameSync(f.path, destFile);
            moved++;
          }
        }
        // Clean up source if empty
        try {
          const remaining = fs.readdirSync(item.originalPath);
          if (!remaining.length) fs.rmdirSync(item.originalPath);
        } catch (e) {}
        return { success: true, moved, path: targetPath, merged: true };
      }
      if (fs.existsSync(item.originalPath)) {
        fs.renameSync(item.originalPath, targetPath);
        return { success: true, path: targetPath };
      }
      return { success: false, error: 'Source folder not found' };
    }

    // Placing a single file
    const targetPath = path.join(targetDir, item.newName);
    if (fs.existsSync(item.originalPath)) {
      fs.renameSync(item.originalPath, targetPath);
      return { success: true, path: targetPath };
    }
    return { success: false, error: 'Source file not found' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ================================================================
//  DUPLICATE FILE DETECTION
// ================================================================
async function checkDuplicatesAfterScan(library) {
  try {
    const duplicates = [];
    for (const series of library) {
      if (!series.episodes || series.episodes.length < 2) continue;
      const seen = new Map();
      for (const ep of series.episodes) {
        const num = parseEpisodeNumber(ep.name);
        if (num === null) continue;
        const key = `${series.name}_ep${num}`;
        if (seen.has(key)) {
          duplicates.push({
            series: series.name,
            episode: num,
            files: [seen.get(key), ep]
          });
        } else {
          seen.set(key, ep);
        }
      }
    }
    if (duplicates.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('duplicate:showModal', duplicates);
    }
  } catch (e) {
    console.error('[Duplicates] Check failed:', e.message);
  }
}

ipcMain.handle('duplicate:resolve', (_, data) => {
  try {
    const { keep, delete: deletePath } = data;
    if (deletePath && fs.existsSync(deletePath)) {
      fs.unlinkSync(deletePath);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('duplicate:resolved', data);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ================================================================
//  WINDOW MANAGEMENT
// ================================================================
let protocolRegistered = false;

function createWindow() {
  if (mainWindow) {
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hidden',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false,
    backgroundColor: '#0a0a0f'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (config.maximized) mainWindow.maximize();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('maximize', () => { config.maximized = true; saveConfig(); });
  mainWindow.on('unmaximize', () => { config.maximized = false; saveConfig(); });

  // Apply minimize-to-tray if enabled
  if (config.minimizeToTray) {
    applyMinimizeToTray(true);
  }

  if (!protocolRegistered) {
    protocolRegistered = true;
  }
}

function handleMinimizeToTray(event) {
  event.preventDefault();
  mainWindow.hide();
}

function handleCloseToTray(event) {
  if (!isQuitting) {
    event.preventDefault();
    mainWindow.hide();
  }
}

function applyMinimizeToTray(enabled) {
  if (!mainWindow) return;
  mainWindow.removeListener('minimize', handleMinimizeToTray);
  mainWindow.removeListener('close', handleCloseToTray);
  if (enabled) {
    createTray();
    mainWindow.on('minimize', handleMinimizeToTray);
    mainWindow.on('close', handleCloseToTray);
  } else {
    destroyTray();
  }
}

function showNotification(title, body, onClick) {
  if (!config.desktopNotifications) return;
  try {
    const notif = new Notification({ title, body, silent: false });
    if (onClick) notif.on('click', onClick);
    notif.show();
  } catch (e) { console.error('[Notification] Failed:', e.message); }
}

function createTray() {
  if (tray) return;
  let iconPath;
  try {
    // Try packaged resources first, then dev path
    iconPath = path.join(process.resourcesPath, 'icon.png');
    if (!fs.existsSync(iconPath)) iconPath = path.join(__dirname, 'icon.png');
  } catch (e) { iconPath = path.join(__dirname, 'icon.png'); }

  // Batch A.6: guard against missing icon → crash on Linux / multi-monitor DPI
  if (!fs.existsSync(iconPath)) {
    console.error('[Tray] No icon found at', iconPath, '— skipping tray creation');
    return;
  }
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      console.error('[Tray] Icon image is empty — skipping tray creation');
      return;
    }
  } catch (e) {
    console.error('[Tray] Failed to load icon:', e.message);
    return;
  }
  let resized;
  try {
    resized = icon.resize({ width: 16, height: 16 });
  } catch (e) {
    console.error('[Tray] Resize failed:', e.message, '— using original size');
    resized = icon;
  }
  tray = new Tray(resized);
  tray.setToolTip('AnimeVault');
  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

// ================================================================
//  IPC: WINDOW CONTROLS
// ================================================================
ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.handle('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});
ipcMain.handle('window:close', () => {
  if (mainWindow) {
    if (config.minimizeToTray) {
      mainWindow.hide();
    } else {
      isQuitting = true;
      mainWindow.close();
    }
  }
});
ipcMain.handle('window:setMinimizeToTray', (_, enabled) => {
  config.minimizeToTray = enabled;
  saveConfig();
  applyMinimizeToTray(enabled);
  return true;
});

// ================================================================
//  APP LIFECYCLE
// ================================================================
app.whenReady().then(() => {
  loadConfig();
  createWindow();

  // Resume file watcher if enabled
  if (config.watcherFolder) {
    startFileWatcher(config.watcherFolder, config.watcherDest);
  }

  // Resume auto-download poller if enabled
  if (config.autoDownloadEnabled && config.autoDownloadWatchlist?.length) {
    startAutoDownloadPoller();
  }
  // Criteria sync deferred until first library scan completes (Phase 1.7)
  // hasInitialCriteriaSyncRun is declared at module scope

  // Update auto-download state from module
  const d = autoDownload.d ? autoDownload.d() : {};
  d.wasPolling = false;

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopFileWatcher();
  stopAutoDownloadPoller();
});

// ================================================================
//  DEEP LINK PROTOCOL (Windows)
// ================================================================
if (process.platform === 'win32') {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  } else {
    app.on('second-instance', (event, commandLine) => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }
}
