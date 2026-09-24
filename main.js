const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, protocol, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const net = require('net');
const { execFile } = require('child_process');
const crypto = require('crypto');
const autoDownload = require('./autoDownload');
const openrouter = require('./openrouter');
const {
  runAutoDownloadPoller,
  startAutoDownloadPoller,
  stopAutoDownloadPoller,
  parseNyaaEpisodeNumber,
  parseReleaseSize,
  scoreRelease,
  computeH264Ceiling,
  downloadNyaaTorrentFile,
  releaseMatchesUploader,
  preferUploaderMatches,
  releaseMatchesSeriesTitle,
  releaseMatchesTrackedSeason,
  releaseMatchesQuality,
  buildEpisodeSearchQueries,
  getSearchVariants
} = autoDownload;

// ================================================================
//  GLOBALS & CONFIG
// ================================================================
// cover:// streams cached artwork straight from disk so the renderer never
// holds megabytes of base64 copies. Must be registered before app ready.
// Every renderer runs sandboxed, whatever a future BrowserWindow forgets to set.
// (An explicit --no-sandbox, needed only for root/CI runs, still opts out.)
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();

protocol.registerSchemesAsPrivileged([
  { scheme: 'cover', privileges: { standard: false, secure: true, supportFetchAPI: false } }
]);

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const CONFIG_BACKUP_PATH = CONFIG_PATH + '.bak';
const OPENROUTER_KEY_PATH = path.join(app.getPath('userData'), 'openrouter-key.enc');
const CACHE_DIR = path.join(app.getPath('userData'), 'cover-cache');
const LIBRARY_INDEX_PATH = path.join(app.getPath('userData'), 'library-index.json');

let mainWindow;
let tray = null;
let isQuitting = false;
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
  fullTheme: 'pearl',
  accentColor: '#c0792a',
  themeAccents: {},
  customThemeColors: {},
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
  autoDownloadCriteria: false, // deprecated compatibility key; explicit tracking only
  autoDownloadPollMinutes: 60,
  autoDownloadEnabled: false,
  minimizeToTray: false,
  desktopNotifications: true,
  watcherIgnorePatterns: [],
  searchPresets: [],
  performanceMode: false,
  incrementalScan: true,
  titleAliases: { anime: {}, manga: {} },
  gapRules: { anime: {}, manga: {} },
  animeImportInbox: [],
  mangaImportInbox: [],
  activityLog: [],
  openrouterApiKey: '',
  openrouterModel: 'google/gemini-3.5-flash-lite',
  autoDownloadBatchLimit: 0,
};

// Shared library cache for cross-module access
let lastLibraryScan = [];
let libraryScanReady = false; // true once the first scan has populated the cache
let _saveTimer = null;
let _libraryIndex = null;
let _libraryIndexSaveTimer = null;

function getWatchHistoryStore() {
  const key = config.vaultMode === 'manga' ? 'mangaWatchHistory' : 'watchHistory';
  if (!config[key] || typeof config[key] !== 'object' || Array.isArray(config[key])) config[key] = {};
  return config[key];
}

// Prevent prototype-pollution keys from ever being used as watch-history keys.
function safeHistoryKey(seriesName) {
  const key = String(seriesName || '').trim().slice(0, 300);
  if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') return '_' + key;
  return key;
}

function safeMalId(malId) {
  const n = Number(malId);
  return Number.isInteger(n) && n > 0 && n < 100000000 ? n : null;
}

// Watch-progress values come from the renderer; never persist raw payloads.
function safeEpisodeNumber(n) {
  const num = Number(n);
  return Number.isInteger(num) && num > 0 && num <= 9999 ? num : null;
}

const STATIC_CONFIG_KEYS = new Set([
  'folders', 'mangaFolders', 'vlcPath', 'mpvPath', 'readerPath', 'playerType',
  'subLangPrimary', 'subLangFallback', 'malClientId', 'malClientSecret', 'hasMalClientSecret',
  'malAccessToken', 'malRefreshToken', 'malTokenExpiry', 'malCodeVerifier', 'malSyncLog',
  'watchHistory', 'mangaWatchHistory', 'theme', 'accentColor', 'fontFamily', 'themePreset', 'fullTheme',
  'themeAccents', 'customThemeColors',
  'autoMarkEnabled', 'autoMarkPercent', 'vaultMode', 'mangaUploaders', 'forceHevc', 'avoidOversizedHevc',
  'nyaaUploader', 'nyaaQuality', 'autoDownloadWatchlist', 'autoDownloadCriteria', 'autoDownloadPollMinutes',
  'autoDownloadEnabled', 'autoDownloadNotify', 'autoDownloadBatchLimit', 'minimizeToTray', 'desktopNotifications', 'watchAndDelete',
  'watcherFolder', 'watcherDest', 'watcherIgnorePatterns', 'searchPresets', 'performanceMode', 'incrementalScan',
  'titleAliases', 'gapRules', 'animeImportInbox', 'mangaImportInbox', 'activityLog', 'downloadHistory',
  'animeKnownSeries', 'mangaKnownSeries', 'animeImportReviewDismissed', 'mangaImportReviewDismissed',
  'notificationPrefs', 'syncPaused', 'hideDonghua', 'audioDelay', 'animSpeed', 'backgroundEffects',
  'backgroundType', 'backgroundIntensity', 'maximized', 'setupDone', 'importAutoMatch', 'lumaMascot', 'lumaSparkles', 'lumaSize', 'lumaSpeed',
  'untrackOnDelete', 'mutedDupSeries', 'openrouterApiKey', 'openrouterModel', 'hasOpenrouterApiKey',
  // 5.0 UI preferences
  'glassLevel', 'lastDarkTheme', 'lastLightTheme', 'sidebarCollapsed', 'schedView', 'heroTone'
]);
function isSafeConfigKey(key) {
  if (!key || typeof key !== 'string') return false;
  return STATIC_CONFIG_KEYS.has(key) || /^(anime|manga)(ImportInbox|KnownSeries|ImportReviewDismissed)$/.test(key);
}

function mergeMalData(existingMalData, incomingMalData) {
  const existing = existingMalData && typeof existingMalData === 'object' && !Array.isArray(existingMalData) ? existingMalData : {};
  const incoming = incomingMalData && typeof incomingMalData === 'object' && !Array.isArray(incomingMalData) ? incomingMalData : {};
  const previousListStatus = existing.my_list_status;
  const merged = { ...existing, ...incoming };

  // A PATCH response is authoritative once a local status already exists. For a
  // newly linked series, however, the GET response is the first source of the
  // user's MAL status and must be retained.
  const hasUsablePrevious = previousListStatus && typeof previousListStatus === 'object' &&
    (previousListStatus.status || previousListStatus.score != null ||
     previousListStatus.num_episodes_watched != null || previousListStatus.num_watched_episodes != null ||
     previousListStatus.num_chapters_read != null);
  if (hasUsablePrevious) {
    merged.my_list_status = previousListStatus;
  } else if (!incoming.my_list_status || typeof incoming.my_list_status !== 'object') {
    delete merged.my_list_status;
  }
  return merged;
}

function getModeConfigMap(key) {
  if (!config[key] || typeof config[key] !== 'object' || Array.isArray(config[key])) config[key] = {};
  const mode = config.vaultMode === 'manga' ? 'manga' : 'anime';
  if (!config[key][mode] || typeof config[key][mode] !== 'object' || Array.isArray(config[key][mode])) config[key][mode] = {};
  return config[key][mode];
}

function getTitleAlias(seriesName, provider) {
  const row = getModeConfigMap('titleAliases')[seriesName];
  if (!row || typeof row !== 'object') return seriesName;
  return String(row[provider] || row.canonical || seriesName).trim() || seriesName;
}

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

function loadConfig() {
  try {
    let loaded = false;
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        if (data && typeof data === 'object') {
          // Keep the object identity stable: autoDownload receives this object by
          // reference during module initialization.
          Object.assign(config, data);
          loaded = true;
          console.log('[Config] Loaded from', CONFIG_PATH);
        }
      } catch (parseErr) {
        console.error('[Config] Primary file corrupted:', parseErr.message);
      }
    }
    if (!loaded && fs.existsSync(CONFIG_BACKUP_PATH)) {
      try {
        const data = JSON.parse(fs.readFileSync(CONFIG_BACKUP_PATH, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(config, data);
          loaded = true;
          console.log('[Config] Restored from backup', CONFIG_BACKUP_PATH);
        }
      } catch (backupErr) {
        console.error('[Config] Backup file corrupted:', backupErr.message);
      }
    }
    if (!loaded && fs.existsSync(CONFIG_BACKUP_PATH + '.old')) {
      try {
        const data = JSON.parse(fs.readFileSync(CONFIG_BACKUP_PATH + '.old', 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(config, data);
          loaded = true;
          console.log('[Config] Restored from second-generation backup', CONFIG_BACKUP_PATH + '.old');
        }
      } catch (backupOldErr) {
        console.error('[Config] Second-generation backup corrupted:', backupOldErr.message);
      }
    }
    if (!loaded) {
      try {
        const Store = require('electron-store');
        const store = new Store({ name: 'config' });
        const data = store.store;
        if (data && typeof data === 'object') {
          Object.assign(config, data);
          loaded = true;
          console.log('[Config] Loaded from electron-store');
        }
      } catch (storeErr) {
        if (storeErr.code !== 'MODULE_NOT_FOUND') console.error('[Config] electron-store fallback failed:', storeErr.message);
      }
    }
    if (config.watchHistory === undefined) config.watchHistory = {};
    if (config.mangaWatchHistory === undefined) config.mangaWatchHistory = {};
    if (config.theme === undefined) config.theme = 'dark';
    if (config.fullTheme === undefined) config.fullTheme = 'pearl';
    if (!config.themeAccents || typeof config.themeAccents !== 'object') config.themeAccents = {};
    if (!config.customThemeColors || typeof config.customThemeColors !== 'object') config.customThemeColors = {};
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
    if (config.searchPresets === undefined) config.searchPresets = [];
    if (config.performanceMode === undefined) config.performanceMode = false;
    if (config.incrementalScan === undefined) config.incrementalScan = true;
    if (!config.titleAliases || typeof config.titleAliases !== 'object') config.titleAliases = { anime: {}, manga: {} };
    if (!config.titleAliases.anime) config.titleAliases.anime = {};
    if (!config.titleAliases.manga) config.titleAliases.manga = {};
    if (!config.gapRules || typeof config.gapRules !== 'object') config.gapRules = { anime: {}, manga: {} };
    if (!config.gapRules.anime) config.gapRules.anime = {};
    if (!config.gapRules.manga) config.gapRules.manga = {};
    if (!Array.isArray(config.animeImportInbox)) config.animeImportInbox = [];
    if (!Array.isArray(config.mangaImportInbox)) config.mangaImportInbox = [];
    if (!Array.isArray(config.activityLog)) config.activityLog = [];
  } catch (err) {
    console.error('[Config] Fatal error during load, using defaults:', err.message);
  }
}

function loadOpenrouterKey() {
  const plaintextKey = typeof config.openrouterApiKey === 'string' ? config.openrouterApiKey.trim() : '';
  delete config.openrouterApiKey;
  try {
    if (plaintextKey) saveOpenrouterKey(plaintextKey);
    if (fs.existsSync(OPENROUTER_KEY_PATH)) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable');
      config.openrouterApiKey = safeStorage.decryptString(fs.readFileSync(OPENROUTER_KEY_PATH));
    } else {
      config.openrouterApiKey = '';
    }
    if (plaintextKey) scrubOpenrouterKeyFromConfigFiles();
  } catch (err) {
    config.openrouterApiKey = '';
    console.error('[OpenRouter] Could not load encrypted API key:', err.message);
  }
}

function saveOpenrouterKey(key) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure OS key storage is unavailable');
  fs.mkdirSync(path.dirname(OPENROUTER_KEY_PATH), { recursive: true });
  fs.writeFileSync(OPENROUTER_KEY_PATH, safeStorage.encryptString(key), { mode: 0o600 });
}

function scrubOpenrouterKeyFromConfigFiles() {
  const files = [CONFIG_PATH, CONFIG_BACKUP_PATH, CONFIG_BACKUP_PATH + '.old'];
  const backupDir = path.join(path.dirname(CONFIG_PATH), 'backups');
  if (fs.existsSync(backupDir)) {
    for (const name of fs.readdirSync(backupDir)) {
      if (/^config-\d{4}-\d{2}-\d{2}\.json$/.test(name)) files.push(path.join(backupDir, name));
    }
  }
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (!Object.prototype.hasOwnProperty.call(data, 'openrouterApiKey')) continue;
      delete data.openrouterApiKey;
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[OpenRouter] Could not scrub API key from', file, err.message);
    }
  }
}

function saveConfig() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(function() {
    _saveTimer = null;
    try {
      writeConfigSafely();
    } catch (err) {
      console.error('[Config] Save failed:', err.message);
    }
  }, 500);
}

function flushSaveConfig() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    try {
      writeConfigSafely();
    } catch (err) {
      console.error('[Config] Save failed:', err.message);
    }
  }
}

let _lastConfigSnapshotDate = null;
// Disaster-recovery archive, independent of the runtime fallback chain:
// one snapshot per calendar day, last 7 kept. loadConfig never reads these.
function snapshotConfigDaily() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (_lastConfigSnapshotDate === today) return;
    const dir = path.join(path.dirname(CONFIG_PATH), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, 'config-' + today + '.json');
    if (!fs.existsSync(dest)) fs.copyFileSync(CONFIG_PATH, dest);
    const snaps = fs.readdirSync(dir)
      .filter(f => /^config-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    while (snaps.length > 7) {
      try { fs.unlinkSync(path.join(dir, snaps.shift())); } catch (e) { break; }
    }
    _lastConfigSnapshotDate = today;
  } catch (e) { console.error('[Config] Daily snapshot failed:', e.message); }
}

function writeConfigSafely() {
  const { _userDataPath, ...safeConfig } = config;
  delete safeConfig.openrouterApiKey;
  const payload = JSON.stringify(safeConfig, null, 2);
  const tempPath = CONFIG_PATH + '.tmp';
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(tempPath, payload);
  // Catastrophic-shrink guard: when a large valid config is about to be
  // replaced by a near-default one, something upstream went wrong (state
  // wiped, corruption recovery). Archive the old file first so the loss is
  // always reversible instead of being rotated away with the backup.
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const curRaw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      let curValid = false;
      try { JSON.parse(curRaw); curValid = true; } catch (e) {}
      if (curValid && curRaw.length > 8192 && payload.length < curRaw.length * 0.25) {
        const archive = CONFIG_PATH + '.lost-' + new Date().toISOString().replace(/[:.]/g, '-');
        fs.copyFileSync(CONFIG_PATH, archive);
        console.error('[Config] Catastrophic shrink (' + curRaw.length + ' -> ' + payload.length +
          ' bytes). Previous config archived to ' + archive);
      }
    }
  } catch (guardErr) { console.error('[Config] Shrink guard failed:', guardErr.message); }
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      // Never replace a known-good backup with a corrupted primary file, and
      // keep two generations so one bad cycle cannot destroy every copy.
      JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      if (fs.existsSync(CONFIG_BACKUP_PATH)) {
        try { fs.copyFileSync(CONFIG_BACKUP_PATH, CONFIG_BACKUP_PATH + '.old'); } catch (e) {}
      }
      fs.copyFileSync(CONFIG_PATH, CONFIG_BACKUP_PATH);
    }
    catch (backupErr) { console.error('[Config] Backup failed:', backupErr.message); }
  }
  try {
    fs.renameSync(tempPath, CONFIG_PATH);
    snapshotConfigDaily();
  } catch (renameErr) {
    // Windows can reject replacement renames when another process briefly has
    // the destination open. Fall back to copying the complete temp file.
    fs.copyFileSync(tempPath, CONFIG_PATH);
    fs.unlinkSync(tempPath);
    snapshotConfigDaily();
  }
}

function getLocalStorageObj() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'localStorage.json'), 'utf-8'));
  } catch (e) { return {}; }
}

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

// ================================================================
//  IPC: CONFIG
// ================================================================
ipcMain.handle('config:get', () => {
  const safe = { ...config, _userDataPath: app.getPath('userData') };
  // Non-sensitive existence flag so the renderer can say "saved - leave blank
  // to keep" without ever receiving the secret itself. Whitelisted in
  // STATIC_CONFIG_KEYS so cfg round-trips through setAllConfig stay legal.
  safe.hasMalClientSecret = !!safe.malClientSecret;
  safe.hasOpenrouterApiKey = !!safe.openrouterApiKey;
  // Credentials and internal flow state never cross to the renderer.
  // malAuthState must be stripped here specifically: setAllConfig hard-throws
  // on unknown keys, so a leaked key would break every cfg round-trip
  // (theme toggles, disconnect, reset).
  ['malClientSecret', 'malCodeVerifier', 'malAccessToken', 'malRefreshToken', 'malAuthState', 'openrouterApiKey'].forEach(key => { delete safe[key]; });
  return safe;
});

function configValueUnchanged(key, value) {
  try { return JSON.stringify(config[key]) === JSON.stringify(value); } catch (e) { return false; }
}

ipcMain.handle('config:set', (_, key, value) => {
  if (!isSafeConfigKey(key) || key === 'openrouterApiKey' || key === 'hasOpenrouterApiKey' || key === '_userDataPath' || key === '__proto__' || key === 'constructor' || key === 'prototype') {
    throw new Error('Invalid config key');
  }
  if (!configValueUnchanged(key, value)) validateRendererConfigValue(key, value);
  config[key] = value;
  saveConfig();
  return true;
});

ipcMain.handle('config:setAll', (_, c) => {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('Invalid config payload');
  for (const key of Object.keys(c)) {
    if (!isSafeConfigKey(key) && key !== 'malClientSecret') {
      throw new Error('Invalid config key: ' + key);
    }
  }
  const incoming = { ...c };
  delete incoming._userDataPath;
  delete incoming.openrouterApiKey;
  delete incoming.hasOpenrouterApiKey;
  delete incoming.__proto__;
  delete incoming.constructor;
  delete incoming.prototype;
  // hasMalClientSecret is a read-only flag from config:get, never state.
  delete incoming.hasMalClientSecret;
  for (const key of Object.keys(incoming)) {
    if (!configValueUnchanged(key, incoming[key])) validateRendererConfigValue(key, incoming[key]);
  }
  Object.assign(config, incoming);
  saveConfig();
  return true;
});
ipcMain.handle('config:getUserDataPath', () => app.getPath('userData'));
ipcMain.handle('config:setVaultMode', (_, mode) => {
  if (mode !== 'anime' && mode !== 'manga') throw new Error('Invalid vault mode');
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
// Files handed to a player, reader or the OS default handler must be media —
// never scripts or executables that happen to live in a library folder.
function assertPlayableMedia(filePath, exts) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (!(exts || VIDEO_EXTS.concat(MANGA_EXTS)).includes(ext)) throw new Error('Refusing to open ' + (ext || 'this file') + ' — not a video or manga file');
}

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

function parseEpisodeNumber(filename) {
  const base = path.parse(filename).name;
  // Strip bracket/parenthesis contents first (release metadata)
  let cleaned = base.replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ');
  // Strip season references first so "Season 2 - 1080p" cannot be mistaken
  // for an episode-dash-resolution pattern.
  cleaned = cleaned.replace(/\b(?:Season\s*\d{1,2}|S\d{1,2})\b/gi, ' ');
  // "Series 05 - 1080p": resolve the episode from the dash-resolution shape
  // BEFORE release-metadata stripping deletes the resolution anchor.
  const resDash = cleaned.match(/(?:^|[\s._-])(\d{1,3})(?:v\d)?\s*[-–—]\s*\d{3,4}[pk]\b/i);
  if (resDash) return parseInt(resDash[1]);
  // Strip common release-metadata tokens to avoid false positives
  cleaned = cleaned.replace(RELEASE_META_STRIP, ' ');
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

function resolveTrackedLocalSeries(seriesName, malId, seriesPath) {
  const pathKey = seriesPath ? path.resolve(seriesPath).toLowerCase() : '';
  if (pathKey) {
    const byPath = lastLibraryScan.find(s => s.path && path.resolve(s.path).toLowerCase() === pathKey);
    if (byPath) return byPath;
  }
  const byExactName = lastLibraryScan.find(s => s.name === seriesName);
  if (byExactName) return byExactName;
  const byCaseInsensitiveName = lastLibraryScan.filter(s =>
    String(s.name || '').toLocaleLowerCase() === String(seriesName || '').toLocaleLowerCase()
  );
  if (byCaseInsensitiveName.length === 1) return byCaseInsensitiveName[0];
  if (malId) {
    const byMalId = lastLibraryScan.filter(s =>
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

function getConfiguredAnimeSeriesNames() {
  const names = new Set();
  for (const folder of config.folders || []) {
    if (!folder || !folder.path || !fs.existsSync(folder.path)) continue;
    try {
      fs.readdirSync(folder.path, { withFileTypes: true }).forEach(entry => { if (entry.isDirectory()) names.add(entry.name); });
    } catch (e) {}
  }
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
      const dirs = fs.readdirSync(folder.path, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const dir of dirs) {
        const seriesPath = path.join(folder.path, dir.name);
        liveIndexKeys.add(path.resolve(seriesPath).toLowerCase());
        const files = getIndexedMediaFiles(seriesPath, scanner, mode, !!force).map(f => ({...f, episodeNum: parseMediaNumber(f.name)}));
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
        const category = watchData.category || folder.type || 'custom';
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
          coverCached
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
  lastLibraryScan = library;
  libraryScanReady = true;
  lastScanStats.durationMs = Date.now() - startedAt;
  lastScanStats.series = library.length;
  return library;
}

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
    // Remove from watch history
    const dirName = path.basename(seriesPath);
    const history = getWatchHistoryStore();
    if (history[dirName]) {
      delete history[dirName];
      saveConfig();
    }
    untrackDeletedSeries(dirName, seriesPath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// When a series folder is deleted, drop it from the auto-download watchlist so
// the Nyaa poller never produces new-episode notifications for a removed series.
// Controlled by the "untrackOnDelete" setting (default on).
function untrackDeletedSeries(dirName, seriesPath) {
  if (config.untrackOnDelete === false) return;
  const watchlist = config.autoDownloadWatchlist;
  if (!Array.isArray(watchlist) || !watchlist.length) return;
  const before = watchlist.length;
  config.autoDownloadWatchlist = watchlist.filter(w => {
    if (w && w.seriesName && w.seriesName === dirName) return false;
    if (w && w.seriesPath && seriesPath) {
      try {
        if (path.resolve(w.seriesPath).toLowerCase() === path.resolve(seriesPath).toLowerCase()) return false;
      } catch (e) { /* ignore malformed paths */ }
    }
    return true;
  });
  if (config.autoDownloadWatchlist.length !== before) saveConfig();
}

ipcMain.handle('library:batchDeleteSeries', (_, paths) => {
  if (!Array.isArray(paths) || paths.length > 500) return [];
  const results = [];
  for (const p of paths) {
    try {
      assertAllowedChildFileActionPath(p);
      if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
      const dirName = path.basename(p);
      const history = getWatchHistoryStore();
      if (history[dirName]) delete history[dirName];
      untrackDeletedSeries(dirName, p);
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
    assertAllowedFileActionPath(filePath);
    assertPlayableMedia(filePath);
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
  return getWatchHistoryStore()[safeHistoryKey(seriesName)] || { episodesWatched: [], lastWatched: null, malId: null };
});

ipcMain.handle('watch:markEpisode', (_, seriesName, episodeNum) => {
  const ep = safeEpisodeNumber(episodeNum);
  if (ep === null) throw new Error('Invalid episode number');
  const key = safeHistoryKey(seriesName);
  const history = getWatchHistoryStore();
  if (!history[key]) {
    history[key] = { episodesWatched: [], lastWatched: null, malId: null };
  }
  const h = history[key];
  if (!Array.isArray(h.episodesWatched)) h.episodesWatched = [];
  if (!h.episodesWatched.includes(ep)) {
    h.episodesWatched.push(ep);
  }
  h.lastWatched = new Date().toISOString();
  saveConfig();

  // Auto-delete if enabled (watch & delete mode)
  if (config.watchAndDelete) {
    // Delay to avoid file lock conflicts
    setTimeout(() => {
      const seriesEntry = lastLibraryScan.find(s => s.name === seriesName);
      if (seriesEntry && seriesEntry.episodes) {
        const epFile = seriesEntry.episodes.find(e => parseMediaNumber(e.name) === ep);
        if (epFile && fs.existsSync(epFile.path) && isAllowedFileActionPath(epFile.path)) {
          try { fs.unlinkSync(epFile.path); console.log('[Watch&Delete] Deleted', epFile.name); }
          catch (e) { console.error('[Watch&Delete] Failed to delete', epFile.path, e.message); }
        }
      }
    }, 5000);
  }

  return true;
});

ipcMain.handle('watch:markUpTo', (_, seriesName, epNum, allEpNums) => {
  const key = safeHistoryKey(seriesName);
  if (!Array.isArray(allEpNums) || allEpNums.length > 10000) throw new Error('Invalid episode list');
  const target = safeEpisodeNumber(epNum);
  if (target === null) throw new Error('Invalid episode number');
  const history = getWatchHistoryStore();
  if (!history[key]) history[key] = { episodesWatched: [], lastWatched: null, malId: null };
  const h = history[key];
  if (!Array.isArray(h.episodesWatched)) h.episodesWatched = [];
  for (const n of allEpNums) {
    const num = safeEpisodeNumber(n);
    if (num !== null && num <= target && !h.episodesWatched.includes(num)) h.episodesWatched.push(num);
  }
  h.lastWatched = new Date().toISOString();
  saveConfig();
  return { ...h };
});

ipcMain.handle('watch:unmarkFrom', (_, seriesName, epNum) => {
  const key = safeHistoryKey(seriesName);
  const history = getWatchHistoryStore();
  if (!history[key]) return null;
  const h = history[key];
  if (!Array.isArray(h.episodesWatched)) return null;
  h.episodesWatched = h.episodesWatched.filter(n => Number(n) < Number(epNum));
  saveConfig();
  return { ...h };
});

ipcMain.handle('watch:setEpisodesWatched', (_, seriesName, epList) => {
  const key = safeHistoryKey(seriesName);
  if (!Array.isArray(epList) || epList.length > 10000) throw new Error('Invalid episode list');
  const history = getWatchHistoryStore();
  if (!history[key]) history[key] = { episodesWatched: [], lastWatched: null, malId: null };
  history[key].episodesWatched = [...new Set(epList.map(safeEpisodeNumber).filter(n => n !== null))];
  saveConfig();
  return { ...history[key] };
});

ipcMain.handle('watch:setMalId', (_, seriesName, malId) => {
  const key = safeHistoryKey(seriesName);
  const history = getWatchHistoryStore();
  if (!history[key]) history[key] = { episodesWatched: [], lastWatched: null, malId: null };
  history[key].malId = safeMalId(malId);
  saveConfig();
  return true;
});

ipcMain.handle('watch:setMalData', (_, seriesName, malData) => {
  const key = safeHistoryKey(seriesName);
  const history = getWatchHistoryStore();
  if (!history[key]) history[key] = { episodesWatched: [], lastWatched: null, malId: null };
  history[key].malData = mergeMalData(history[key].malData, malData);
  saveConfig();
  // Return the merged result so callers can patch their local library state
  // without triggering a full rescan.
  return JSON.parse(JSON.stringify(history[key].malData));
});

ipcMain.handle('watch:setTags', (_, seriesName, tags) => {
  const key = safeHistoryKey(seriesName);
  const history = getWatchHistoryStore();
  if (!history[key]) history[key] = { episodesWatched: [], lastWatched: null, malId: null };
  history[key].tags = Array.isArray(tags) ? tags.slice(0, 200) : [];
  saveConfig();
  return true;
});

ipcMain.handle('watch:setCategory', (_, seriesName, category) => {
  const key = safeHistoryKey(seriesName);
  const history = getWatchHistoryStore();
  if (!history[key]) history[key] = { episodesWatched: [], lastWatched: null, malId: null };
  history[key].category = String(category || '').trim().slice(0, 200);
  saveConfig();
  return true;
});

// ================================================================
//  PLAYER
// ================================================================
const { spawn } = require('child_process');

// Detached spawns without an 'error' listener take down the entire main
// process when the executable is missing (ENOENT arrives asynchronously).
// Returns the child so callers can keep their poller/kill lifecycle.
function spawnDetached(exe, args) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok, child, message) => { if (!settled) { settled = true; resolve({ ok, child: child || null, message: message || null }); } };
    try {
      const child = spawn(exe, args, { detached: true });
      child.on('error', (e) => done(false, null, e.message));
      child.once('spawn', () => done(true, child));
      setTimeout(() => done(true, child), 3000);
      try { child.unref(); } catch (e) {}
    } catch (e) { done(false, null, e.message); }
  });
}

function resolveMpvPath() {
  if (config.playerType === 'bundled-mpv') {
    const bundled = path.join(process.resourcesPath, 'bin', 'mpv.exe');
    if (fs.existsSync(bundled)) return bundled;
    const dev = path.join(__dirname, 'bin', 'mpv.exe');
    if (fs.existsSync(dev)) return dev;
  }
  return config.mpvPath || 'mpv';
}

ipcMain.handle('player:play', async (_, filePath, seriesName, episodeNum) => {
  try {
    assertAllowedFileActionPath(filePath);
    assertPlayableMedia(filePath);
    const isManga = config.vaultMode === 'manga';
    const ext = path.extname(filePath).toLowerCase();
    if (isManga || MANGA_EXTS.includes(ext)) {
      // Open with manga reader
      const reader = config.readerPath;
      if (reader && fs.existsSync(reader)) {
        const res = await spawnDetached(reader, [filePath]);
        if (!res.ok) return { error: 'Failed to launch the manga reader: ' + res.message };
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
      const resolvedEpNum = episodeNum ?? parseEpisodeNumber(path.basename(filePath));
      // Kill any previously spawned player to free port 18292
      killExistingPlayer();
      const args = [filePath];
      // Enable HTTP interface for auto-mark polling
      if (config.autoMarkEnabled !== false && resolvedEpNum !== null) {
        args.push(`--extraintf=http`);
        args.push(`--http-port=${VLC_HTTP_PORT}`);
        args.push(`--http-password=${VLC_HTTP_PASSWORD}`);
      }
      if (subPrimary) args.push(`--sub-language=${subPrimary}`);
      if (subFallback) args.push(`--sub-language=${subFallback}`);
      if (audioDelay !== '0') args.push(`--audio-desync=${audioDelay}`);
      args.push('--fullscreen');
      // Resolve VLC: configured path first, then common install locations. A
      // missing executable must degrade to the OS default player, never crash
      // the main process.
      const candidates = [config.vlcPath, 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe', 'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe'].filter(Boolean);
      const exePath = candidates.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
      if (!exePath) {
        console.warn('[Player] VLC not found in configured or default locations; opening with the OS default player');
        const openErr = await shell.openPath(filePath);
        if (openErr) return { error: 'VLC was not found and the system default player failed: ' + openErr };
        return { error: null, warning: 'VLC not found - opened with your default video app. Set your player path in Settings to restore auto-mark.' };
      }
      const res = await spawnDetached(exePath, args);
      if (!res.ok || !res.child) return { error: 'Failed to launch VLC: ' + (res.message || 'unknown error') + '. Check the VLC path in Settings.' };
      _amPlayerProcess = res.child;
      if (config.autoMarkEnabled !== false && resolvedEpNum !== null) {
        // Give VLC a moment to start the HTTP server
        setTimeout(() => startAutoMarkPoller('vlc', seriesName, resolvedEpNum), 2000);
      }
    } else if (playerType === 'mpv' || playerType === 'bundled-mpv') {
      const mpvPath = resolveMpvPath();
      const args = [];
      // Resolve episodeNum from filename if the renderer passed null
      const resolvedEpNum = episodeNum ?? parseEpisodeNumber(path.basename(filePath));
      // Kill any previously spawned player to free the IPC pipe
      killExistingPlayer();
      // Enable IPC for auto-mark polling
      if (config.autoMarkEnabled !== false && resolvedEpNum !== null) {
        args.push(`--input-ipc-server=${MPV_IPC_PIPE}`);
      }
      if (subPrimary) args.push(`--slang=${subPrimary}`);
      if (subFallback) args.push(`--slang=${subFallback}`);
      if (audioDelay !== '0') args.push(`--audio-delay=${audioDelay}`);
      args.push('--fullscreen');
      args.push('--', filePath);
      // Clean up old socket if it exists (non-Windows)
      if (config.autoMarkEnabled !== false && process.platform !== 'win32' && fs.existsSync(MPV_IPC_PIPE)) {
        try { fs.unlinkSync(MPV_IPC_PIPE); } catch (e) {}
      }
      const res = await spawnDetached(mpvPath, args);
      if (!res.ok || !res.child) return { error: 'Failed to launch MPV: ' + (res.message || 'unknown error') + '. Check the MPV path in Settings.' };
      _amPlayerProcess = res.child;
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
// Random per launch so other local processes can't drive the player's web interface.
const VLC_HTTP_PASSWORD = crypto.randomBytes(12).toString('hex');
const MPV_IPC_PIPE = process.platform === 'win32' ? '\\\\.\\pipe\\mpv-animevault' : path.join(app.getPath('temp'), 'mpv-animevault.sock');

let _amPollInterval = null;      // active setInterval handle
let _amCurrentPlayer = null;     // 'vlc' | 'mpv'
let _amSeriesName = null;
let _amEpisodeNum = null;
let _amAlreadyMarked = false;    // guard against duplicate emissions
let _amPlayerProcess = null;      // child process handle of spawned player
let _amConsecutiveFailures = 0;   // consecutive polling failures before giving up

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

// Kill a previously spawned player and its polling — called before launching a new one
function killExistingPlayer() {
  if (_amPollInterval) { clearInterval(_amPollInterval); _amPollInterval = null; }
  if (_amPlayerProcess) {
    try { _amPlayerProcess.kill(); } catch (e) {}
    _amPlayerProcess = null;
  }
  _amCurrentPlayer = null;
  _amConsecutiveFailures = 0;
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
      _amConsecutiveFailures++;
      if (_amConsecutiveFailures >= 6) {
        console.warn('[AutoMark] Player unresponsive for ~30s — stopping poller');
        stopAutoMarkPoller();
      }
      return;
    }

    _amConsecutiveFailures = 0;

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
  _amConsecutiveFailures = 0;
}

// Clean up on quit
app.on('before-quit', () => { stopAutoMarkPoller(); killExistingPlayer(); });

// Thumbnail extraction (F10)
ipcMain.handle('player:extractThumbnail', async (_, filePath, seriesName, episodeNum) => {
  try { assertAllowedFileActionPath(filePath); assertPlayableMedia(filePath, VIDEO_EXTS); }
  catch (e) { return { success: false, error: e.message }; }
  const ep = Number(episodeNum);
  if (!Number.isInteger(ep) || ep < 1 || ep > 99999) return { success: false, error: 'Invalid episode number' };
  // The series name becomes a folder name; "..", "." or an empty name would
  // otherwise land thumbnails outside thumbnails/.
  const folderName = String(seriesName || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 120);
  if (!isSafeFileName(folderName)) return { success: false, error: 'Invalid series name' };
  const thumbDir = path.join(app.getPath('userData'), 'thumbnails', folderName);
  fs.mkdirSync(thumbDir, { recursive: true });
  const outPath = path.join(thumbDir, `ep_${String(ep).padStart(3, '0')}.jpg`);
  if (fs.existsSync(outPath)) return { success: true, path: outPath };
  
  const mpv = resolveMpvPath();
  return new Promise((resolve) => {
    // Options first, then "--" so a file name can never be read as an mpv option.
    execFile(mpv, ['--no-audio', '--no-sub', '--frames=1', '--start=20%', `--o=${outPath}`, '--', filePath], { timeout: 30000 }, (err) => {
      if (err) { console.error('[Thumb] Extraction failed:', err.message); resolve({ success: false, error: err.message }); }
      else { resolve({ success: true, path: outPath }); }
    });
  });
});

// ================================================================
//  SHELL
// ================================================================
ipcMain.handle('shell:openExternal', (_, url) => {
  if (!isSafeExternalUrl(url)) return { success: false, error: 'Blocked unsafe URL' };
  return shell.openExternal(url);
});
ipcMain.handle('shell:openFolder', (_, p) => {
  if (!isAllowedFileActionPath(p, true)) return { success: false, error: 'Path is outside configured AnimeVault folders' };
  // Only ever *reveal* things: a file path is shown in its folder instead of
  // being opened, so this channel can't be used to launch executables.
  try {
    if (fs.existsSync(p) && !fs.statSync(p).isDirectory()) { shell.showItemInFolder(p); return ''; }
  } catch (e) { return { success: false, error: e.message }; }
  return shell.openPath(p);
});

// ================================================================
//  COVER CACHE
// ================================================================
const { URL } = require('url');

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
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('AniList query timed out')); });
      req.write(postData);
    req.end();
  });
}

ipcMain.handle('anilist:userMalIds', async (_, userName) => {
  try {
    const user = String(userName || '').trim();
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(user)) return { error: 'Invalid AniList username' };
    const data = await anilistQuery(`
      query ($user: String) {
        MediaListCollection(userName: $user, type: ANIME) {
          lists { entries { media { idMal } } }
        }
      }
    `, { user });
    const coll = data && data.MediaListCollection;
    if (!coll) return { error: 'User not found or list is private' };
    const ids = new Set();
    (coll.lists || []).forEach(l => (l.entries || []).forEach(e => { const id = e && e.media && e.media.idMal; if (Number.isInteger(id) && id > 0) ids.add(id); }));
    return Array.from(ids).slice(0, 5000);
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('anilist:search', async (_, title, count = 1) => {
  try {
    const isManga = config.vaultMode === 'manga';
    const data = await anilistQuery(`
      query($search: String, $perPage: Int, $type: MediaType) {
        Page(perPage: $perPage) {
          media(search: $search, type: $type) {
            id
            title { romaji english native }
            coverImage { extraLarge large medium }
            episodes
            chapters
            seasonYear
            description
          }
        }
      }
    `, { search: title, perPage: count, type: isManga ? 'MANGA' : 'ANIME' });
    return (data.Page && data.Page.media) || [];
  } catch (e) { return []; }
});

ipcMain.handle('anilist:fetchCover', async (_, seriesName, url, force = false) => {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const cacheFile = getCoverCachePath(seriesName);
    const existing = getExistingCoverCachePath(seriesName);
    if (existing && !force) {
      return existing;
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
  return getExistingCoverCachePath(name);
});

ipcMain.handle('anilist:fetchAllCovers', async (_, seriesList) => {
  const results = [];
  const isManga = config.vaultMode === 'manga';
  for (const series of seriesList) {
    const cacheFile = getCoverCachePath(series.name);
    const existing = getExistingCoverCachePath(series.name);
    if (existing) {
      results.push({ name: series.name, path: existing, status: 'cached' });
      continue;
    }
    try {
      const data = await anilistQuery(`
        query($search: String, $type: MediaType) {
          Page(perPage: 1) {
            media(search: $search, type: $type) {
              id
              title { romaji english native }
              coverImage { large medium }
            }
          }
        }
      `, { search: getTitleAlias(series.name, 'anilist'), type: isManga ? 'MANGA' : 'ANIME' });
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
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('MAL request timed out after 30s: ' + endpoint)); });
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
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('MAL token refresh timed out after 15s')); });
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
  if (typeof clientId !== 'string' || !clientId.trim() || clientId.length > 200) throw new Error('Invalid MAL Client ID');
  config.malClientId = clientId.trim();
  // The stored secret is reused when the renderer no longer has it in memory.
  config.malClientSecret = (typeof clientSecret === 'string' && clientSecret.trim()) ? clientSecret.trim() : (config.malClientSecret || '');
  config.malCodeVerifier = crypto.randomBytes(32).toString('base64url');
  // Per-attempt random state; the loopback callback must echo it back (CSRF).
  config.malAuthState = crypto.randomBytes(16).toString('base64url');
  saveConfig();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.malClientId,
    // MAL's OAuth2 server supports only the "plain" PKCE method (official
    // authorization reference); sending S256 makes the token exchange fail
    // with invalid_grant even after successful user consent.
    code_challenge: config.malCodeVerifier,
    code_challenge_method: 'plain',
    state: config.malAuthState
  });
  appendAuthDebug('authorize-url generated state=' + config.malAuthState.slice(0, 6) +
    '… verifierLen=' + config.malCodeVerifier.length);
  return `https://myanimelist.net/v1/oauth2/authorize?${params.toString()}`;
});

let _malAuthServers = [];
// Diagnostics: packaged builds have no visible console, so the OAuth flow
// writes a compact trail here. Never logs code/state VALUES — only shapes,
// prefixes, and decisions — so sharing this file is safe.
const AUTH_DEBUG_LOG = path.join(app.getPath('userData'), 'auth-debug.log');
function appendAuthDebug(line) {
  try {
    const ts = new Date().toISOString();
    fs.appendFileSync(AUTH_DEBUG_LOG, '[' + ts + '] ' + line + '\n');
    try {
      if (fs.statSync(AUTH_DEBUG_LOG).size > 64 * 1024) {
        const lines = fs.readFileSync(AUTH_DEBUG_LOG, 'utf8').split('\n');
        fs.writeFileSync(AUTH_DEBUG_LOG, lines.slice(-100).join('\n'));
      }
    } catch (e) {}
  } catch (e) { /* diagnostics must never break the flow */ }
}
function closeMalAuthServers() {
  for (const s of _malAuthServers) {
    try { s.close(); } catch (e) {}
    // close() alone leaves keep-alive sockets (the browser holds one) binding
    // the port; the next Connect attempt then fails instantly with EADDRINUSE.
    try { if (typeof s.closeAllConnections === 'function') s.closeAllConnections(); } catch (e) {}
  }
  _malAuthServers = [];
}

ipcMain.handle('mal:startAuthServer', async () => {
  // Tear down any previous listener first so a stuck socket from an earlier
  // attempt can never hold :19876 and make this attempt fail before start.
  closeMalAuthServers();
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const expectedState = config.malAuthState || '';
    let boundStacks = 0;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeMalAuthServers();
      resolve(value);
    };
    const handler = (req, res) => {
      if (settled) { res.writeHead(404); res.end(); return; }
      let parsed;
      try { parsed = new URL(req.url, 'http://localhost:19876'); }
      catch (e) { res.writeHead(400); res.end(); return; }
      if (parsed.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const code = parsed.searchParams.get('code');
      const state = parsed.searchParams.get('state') || '';
      // MAL authorization codes are large: the official reference says they are
      // normally nearly 1,000 bytes. The old 512-char sanity cap rejected every
      // real code before a token exchange could ever run.
      const codeOk = typeof code === 'string' && code.length > 0 && code.length <= 4096;
      appendAuthDebug('inbound ' + parsed.pathname +
        ' codeLen=' + (typeof code === 'string' ? code.length : 0) +
        ' stateEcho=' + (expectedState ? state === expectedState : 'n/a') +
        (state && state !== expectedState ? ' got=' + state.slice(0, 6) + '. expected=' + expectedState.slice(0, 6) + '.' : ''));
      // Exact echo verifies the flow. MAL documents the state echo, so a
      // mismatched state almost always means a stale authorization tab from an
      // earlier Connect attempt (each attempt regenerates the state). A missing
      // state is tolerated as a downgrade: the PKCE verifier still binds the
      // code exchange to this app instance.
      if (codeOk && (!state || state === expectedState)) {
        if (!state) console.warn('[MAL] Callback arrived without state - accepting via PKCE binding only');
        appendAuthDebug('callback accepted (stateEcho=' + (state === expectedState) + ')');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family:sans-serif;background:#12121c;color:#e8e4dc;text-align:center;padding-top:48px"><h1>MAL Auth Successful</h1><p>You can close this window.</p></body></html>');
        finish(code);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        const reason = !codeOk
          ? '<h2>Invalid authorization code</h2><p>MAL returned something unexpected. Press Connect again.</p>'
          : state
            ? '<h2>Stale authorization tab</h2><p>This tab came from an earlier Connect attempt. Close all AnimeVault authorization tabs and press Connect again, then use the newest one.</p>'
            : '<h2>No authorization code</h2><p>Open AnimeVault and press Connect again.</p>';
        appendAuthDebug('callback rejected (' + (!codeOk ? 'bad code length ' + String(code || '').length : state ? 'state mismatch' : 'no code') + ')');
        res.end('<html><body style="font-family:sans-serif;background:#12121c;color:#e8e4dc;text-align:center;padding-top:48px">' + reason + '</body></html>');
      }
    };
    // Bind both loopback stacks: browsers may reach "localhost" via ::1 first.
    for (const host of ['127.0.0.1', '::1']) {
      const server = http.createServer(handler);
      server.on('error', (e) => {
        appendAuthDebug('bind error ' + host + ':19876 ' + (e.code || e.message));
        console.error('[MAL] Auth server', host, 'error:', e.code || e.message);
      });
      server.listen(19876, host, () => {
        boundStacks++;
        appendAuthDebug('listening ' + host + ':19876');
        console.log('[MAL] Auth server listening on', host + ':19876');
      });
      try { server.unref(); } catch (e) {}
      _malAuthServers.push(server);
    }
    // If neither stack could bind (port held by a foreign process), fail fast
    // instead of silently timing out five minutes later.
    setTimeout(() => {
      if (!settled && boundStacks === 0) {
        appendAuthDebug('port 19876 unavailable on any stack - aborting');
        console.error('[MAL] Port 19876 unavailable on any stack');
        finish(null);
      }
    }, 1500);
    timer = setTimeout(() => { appendAuthDebug('auth window timed out (300s)'); finish(null); }, 300000);
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
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Auth token request timed out')); });
      req.write(postData);
      req.end();
    });
    if (response.access_token) {
      config.malAccessToken = response.access_token;
      config.malRefreshToken = response.refresh_token;
      config.malTokenExpiry = Date.now() + (response.expires_in || 3600) * 1000;
      saveConfig();
      appendAuthDebug('token exchange success');
      return { success: true };
    }
    appendAuthDebug('token exchange failed: ' + (response.error || 'unknown') + (response.message ? ' - ' + response.message : ''));
    return { success: false, error: response.error || 'Unknown error' };
  } catch (e) {
    appendAuthDebug('token exchange threw: ' + e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('mal:search', async (_, query) => {
  const isManga = config.vaultMode === 'manga';
  const endpoint = isManga
    ? `/manga?q=${encodeURIComponent(query)}&limit=10&fields=id,title,main_picture,mean,media_type,status,num_chapters`
    : `/anime?q=${encodeURIComponent(query)}&limit=10&fields=id,title,main_picture,mean,media_type,status,num_episodes`;
  const r = await malRequestWithRetry(endpoint);
  return r.data || [];
});

const _MAL_CACHE_TTL = 3600000; // 1 hour
const _malDetailsCache = new Map();
function malDetailsCacheKey(malId) { return (config.vaultMode === 'manga' ? 'manga:' : 'anime:') + String(malId); }

ipcMain.handle('mal:getAnimeDetails', async (_, malId) => {
  const cacheKey = malDetailsCacheKey(malId);
  const cached = _malDetailsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < _MAL_CACHE_TTL) return cached.data;
  const isManga = config.vaultMode === 'manga';
  const fields = isManga
    ? 'id,title,alternative_titles,main_picture,mean,media_type,status,num_chapters,synopsis,genres,start_date,my_list_status'
    : 'id,title,alternative_titles,main_picture,mean,media_type,status,num_episodes,synopsis,genres,start_date,my_list_status';
  const endpoint = isManga ? `/manga/${malId}?fields=${fields}` : `/anime/${malId}?fields=${fields}`;
  const r = await malRequestWithRetry(endpoint);
  const data = r.data || null;
  if (data) _malDetailsCache.set(cacheKey, { data, ts: Date.now() });
  return data;
});

// ================================================================
//  MAL BACKFILL (startup repair for missing list status)
// ================================================================
ipcMain.handle('mal:backfillMissing', async (_, seriesList) => {
  if (!Array.isArray(seriesList) || !seriesList.length || seriesList.length > 500) return { checked: 0, refreshed: 0, skipped: [] };
  if (!config.malAccessToken) return { checked: seriesList.length, refreshed: 0, skipped: seriesList.slice(), error: 'Not authenticated' };
  const history = getWatchHistoryStore();
  const isManga = config.vaultMode === 'manga';
  const skipped = [];
  let refreshed = 0;
  const fields = isManga
    ? 'id,title,alternative_titles,main_picture,mean,media_type,status,num_chapters,synopsis,genres,start_date,my_list_status'
    : 'id,title,alternative_titles,main_picture,mean,media_type,status,num_episodes,synopsis,genres,start_date,my_list_status';
  for (let i = 0; i < seriesList.length; i++) {
    const name = safeHistoryKey(seriesList[i]);
    const wd = history[name];
    if (!wd || !wd.malId) { skipped.push(name); continue; }
    const ls = wd.malData && wd.malData.my_list_status;
    const usable = ls && typeof ls === 'object' &&
      (ls.status || ls.score != null || ls.num_episodes_watched != null ||
       ls.num_watched_episodes != null || ls.num_chapters_read != null);
    if (usable) { skipped.push(name); continue; }
    try {
      const endpoint = isManga ? '/manga/' + wd.malId + '?fields=' + fields : '/anime/' + wd.malId + '?fields=' + fields;
      const r = await malRequestWithRetry(endpoint);
      if (r.status === 200 && r.data) {
        wd.malData = mergeMalData(wd.malData, r.data);
        refreshed++;
      } else {
        skipped.push(name);
      }
    } catch (e) {
      skipped.push(name);
    }
    if (i < seriesList.length - 1) await new Promise(resolve => setTimeout(resolve, 350));
  }
  if (refreshed > 0) saveConfig();
  return { checked: seriesList.length, refreshed, skipped };
});

ipcMain.handle('mal:updateStatus', async (_, malId, numWatched, status) => {
  const id = safeMalId(malId); if (!id) return null;
  const isManga = config.vaultMode === 'manga';
  const endpoint = isManga ? `/manga/${id}/my_list_status` : `/anime/${id}/my_list_status`;
  const body = isManga ? { num_chapters_read: numWatched, status } : { num_watched_episodes: numWatched, status };
  const r = await malRequestWithRetry(endpoint, 'PATCH', body);
  return r.data || null;
});

ipcMain.handle('mal:addOrUpdateListItem', async (_, malId, fields) => {
  const id = safeMalId(malId); if (!id) return null;
  const isManga = config.vaultMode === 'manga';
  const endpoint = isManga ? `/manga/${id}/my_list_status` : `/anime/${id}/my_list_status`;
  const r = await malRequestWithRetry(endpoint, 'PATCH', fields);
  if (r.data) _malDetailsCache.delete(malDetailsCacheKey(id));
  return r.data || null;
});

ipcMain.handle('mal:editStatus', async (_, malId, fields, seriesName) => {
  const id = safeMalId(malId); if (!id) return null;
  const isManga = config.vaultMode === 'manga';
  const endpoint = isManga ? `/manga/${id}/my_list_status` : `/anime/${id}/my_list_status`;

  // Translate anime-status strings to manga equivalents
  let body = fields;
  if (isManga && fields && fields.status) {
    const statusMap = {
      'watching': 'reading',
      'plan_to_watch': 'plan_to_read'
    };
    if (statusMap[fields.status]) {
      body = { ...fields, status: statusMap[fields.status] };
    }
  }

  const r = await malRequestWithRetry(endpoint, 'PATCH', body);
  if (r.data && seriesName) {
    const key = safeHistoryKey(seriesName);
    const history = getWatchHistoryStore();
    if (!history[key]) history[key] = {};
    // Normalize: the API returns flat list-status fields; wrap them under my_list_status
    // so they match the shape from malGetAnimeDetails
    const wrapped = { my_list_status: r.data };
    history[key].malData = { ...history[key].malData, ...wrapped };
    saveConfig();
    _malDetailsCache.delete(malDetailsCacheKey(id));
  }
  return r.data || null;
});

ipcMain.handle('mal:deleteEntry', async (_, malId) => {
  const id = safeMalId(malId); if (!id) return false;
  const isManga = config.vaultMode === 'manga';
  const endpoint = isManga ? `/manga/${id}/my_list_status` : `/anime/${id}/my_list_status`;
  const r = await malRequestWithRetry(endpoint, 'DELETE');
  _malDetailsCache.delete(malDetailsCacheKey(id));
  if (r.status === 200) {
    // The entry is gone from the user's MAL list: drop the locally cached list
    // status so cards no longer show a status MAL no longer has.
    const history = getWatchHistoryStore();
    for (const name of Object.keys(history)) {
      const wd = history[name];
      if (wd && String(wd.malId) === String(id) && wd.malData && wd.malData.my_list_status) {
        const next = { ...wd.malData };
        delete next.my_list_status;
        wd.malData = next;
      }
    }
    saveConfig();
  }
  return r.status === 200;
});

ipcMain.handle('mal:autoSync', async (_, seriesName) => {
  const wd = getWatchHistoryStore()[safeHistoryKey(seriesName)];
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
      _malDetailsCache.delete(malDetailsCacheKey(wd.malId));
      return { synced: true, updated: numWatched };
    }
    return { synced: true, updated: null };
  }
  return { synced: false, error: r.error || 'Request failed' };
});

ipcMain.handle('mal:bulkAutoSync', async (_, seriesList) => {
  if (!Array.isArray(seriesList) || seriesList.length > 500) return [];
  const results = [];
  const isManga = config.vaultMode === 'manga';
  const history = getWatchHistoryStore();
  for (const rawName of seriesList) {
    const name = safeHistoryKey(rawName);
    try {
      // Skip if already linked
      const wd = history[name];
      if (wd && wd.malId) {
        results.push({ name, status: 'linked', malId: wd.malId });
        continue;
      }
      // Search MAL for this series
      const searchEndpoint = isManga
        ? `/manga?q=${encodeURIComponent(name)}&limit=10&fields=id,title,alternative_titles,main_picture,mean,media_type,status,num_chapters`
        : `/anime?q=${encodeURIComponent(name)}&limit=10&fields=id,title,alternative_titles,main_picture,mean,media_type,status,num_episodes`;
      const searchR = await malRequestWithRetry(searchEndpoint);
      const searchItems = Array.isArray(searchR.data) ? searchR.data : (searchR.data && Array.isArray(searchR.data.data) ? searchR.data.data : []);
      const items = searchItems.map(x => x.node || x).filter(Boolean);
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
        if (!history[name]) history[name] = { episodesWatched: [], lastWatched: null, malId: null };
        history[name].malId = best.id;
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
  const history = getWatchHistoryStore();
  const key = safeHistoryKey(seriesName);
  if (history[key]) {
    delete history[key].malId;
    delete history[key].malData;
    saveConfig();
  }
  return true;
});

ipcMain.handle('mal:getTopAnime', async (_, limit = 50, offset = 0) => {
  const l = Math.min(100, Math.max(1, Number(limit) || 50));
  const o = Math.max(0, Number(offset) || 0);
  const isManga = config.vaultMode === 'manga';
  const endpoint = isManga
    ? `/manga/ranking?ranking_type=all&limit=${l}&offset=${o}&fields=id,title,main_picture,mean,media_type,status`
    : `/anime/ranking?ranking_type=all&limit=${l}&offset=${o}&fields=id,title,main_picture,mean,media_type,status`;
  const r = await malRequestWithRetry(endpoint);
  return r.data || [];
});

ipcMain.handle('mal:getSeasonal', async (_, year, season) => {
  const y = Number(year);
  const s = String(season || '').toLowerCase();
  if (!/^(winter|spring|summer|fall)$/.test(s)) throw new Error('Invalid season');
  if (!Number.isInteger(y) || y < 1970 || y > 2100) throw new Error('Invalid year');
  const r = await malRequestWithRetry(`/anime/season/${y}/${s}?limit=50&fields=id,title,main_picture,num_episodes,status,mean,media_type,genres,start_date,synopsis`);
  return r.data || [];
});

ipcMain.handle('mal:getUserList', async (_, status = '', limit = 1000, offset = 0) => {
  const l = Math.min(1000, Math.max(1, Number(limit) || 1000));
  const o = Math.max(0, Number(offset) || 0);
  const st = String(status || '');
  if (st && !/^[a-z_]+$/.test(st)) throw new Error('Invalid status');
  const isManga = config.vaultMode === 'manga';
  let url = isManga
    ? `/users/@me/mangalist?limit=${l}&offset=${o}&fields=list_status,status,num_chapters,start_date`
    : `/users/@me/animelist?limit=${l}&offset=${o}&fields=list_status,status,num_episodes,broadcast,start_date`;
  if (st) url += `&status=${st}`;
  const r = await malRequestWithRetry(url);
  return r.data || [];
});

ipcMain.handle('mal:getStatusCounts', async () => {
  const isManga = config.vaultMode === 'manga';
  const endpoint = isManga
    ? '/users/@me/mangalist?limit=1000&fields=list_status'
    : '/users/@me/animelist?limit=1000&fields=list_status';
  const r = await malRequestWithRetry(endpoint);
  const items = r.data && Array.isArray(r.data.data) ? r.data.data : [];
  const counts = {};
  items.forEach(item => {
    const st = item && item.list_status && item.list_status.status;
    if (st) counts[st] = (counts[st] || 0) + 1;
  });
  return { counts, total: items.length, source: items.length ? 'mal' : 'local' };
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
    const category = config.vaultMode === 'manga' ? '3_1' : '1_2';
    const url = `https://nyaa.si/?f=0&c=${category}&q=${encodeURIComponent(searchQuery)}`;
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve([]);
      }
      let html = '';
      res.on('data', chunk => html += chunk);
      res.on('end', () => {
        const results = [];
        try {
          const rows = html.match(/<tr class="[^"]*(?:default|success|danger)[^"]*"[\s\S]*?<\/tr>/g) || [];
          for (const row of rows) {
            try {
              const titleMatch = row.match(/<a[^>]*href="\/view\/\d+"[^>]*title="([^"]+)"/);
              const idMatch = row.match(/<a[^>]*href="\/view\/(\d+)"/);
              const sizeMatch = row.match(/<td[^>]*class="text-center[^"]*"[^>]*>[\s\S]*?<\/td>[\s\S]*?<td[^>]*class="text-center[^"]*"[^>]*>[\s\S]*?<\/td>[\s\S]*?<td[^>]*class="text-center[^"]*"[^>]*>([\s\S]*?)<\/td>/);
              // nyaa.si marks the seeder cell with the "success" class. The old
              // code indexed a /g match array position that never exists, so
              // every fallback result reported 0 seeders and broke scoring.
              let seeders = 0;
              const seedCell = row.match(/<td[^>]*class="text-center[^"]*success[^"]*"[^>]*>([\s\S]*?)<\/td>/);
              if (seedCell) {
                seeders = parseInt(seedCell[1].replace(/<[^>]+>/g, '').trim(), 10) || 0;
              } else {
                const cellRe = /<td[^>]*class="text-center[^"]*"[^>]*>([\s\S]*?)<\/td>/g;
                let cell;
                while ((cell = cellRe.exec(row)) !== null) {
                  const text = cell[1].replace(/<[^>]+>/g, '').trim();
                  if (/^\d+$/.test(text)) { seeders = parseInt(text, 10) || 0; break; }
                }
              }
              const magnetMatch = row.match(/href="(magnet:\?[^"]+)"/);
              if (titleMatch && idMatch) {
                results.push({
                  id: idMatch[1],
                  title: titleMatch[1],
                  size: sizeMatch ? sizeMatch[1].trim() : '',
                  seeders,
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
    const category = config.vaultMode === 'manga' ? '3_1' : '1_2';
    const rssUrl = `https://nyaa.si/?page=rss&q=${encodeURIComponent(searchQuery)}&c=${category}&f=0`;
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
              const pubDateRaw = (item.match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1] || '';
              const publishedAt = pubDateRaw && !isNaN(Date.parse(pubDateRaw))
                ? new Date(pubDateRaw).toISOString()
                : '';
              results.push({ id, title, size, seeders, magnet: nyaaMagnet, publishedAt });
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

async function nyaaAutoDownloadForIpc(seriesTitle, quality, preferredUploader, epNum, mode = 'ep', trackedEntry = null) {
  try {
    const uploader = preferredUploader || config.nyaaUploader || 'erai';
    const q = quality || config.nyaaQuality || '1080p';
    const titleVariants = getSearchVariants(seriesTitle).slice(0, 3);
    const epRaw = epNum != null ? String(parseInt(epNum, 10)) : '';
    const epPadded = epNum != null ? epRaw.padStart(2, '0') : '';
    const preferredQueries = [];
    const broadQueries = [];
    for (const title of titleVariants) {
      if (uploader === 'erai') {
        if (epNum != null) {
          preferredQueries.push(`[Erai-raws] ${title} - ${epPadded} ${q}`);
          preferredQueries.push(`[Erai-raws] ${title} - ${epRaw}`);
        } else preferredQueries.push(`[Erai-raws] ${title} ${q}`);
      } else if (uploader === 'subsplease') {
        preferredQueries.push(`[SubsPlease] ${title}${epNum != null ? ` - ${epPadded}` : ''} (${q})`);
      } else if (uploader === 'judas') {
        preferredQueries.push(`[Judas] ${title}${epNum != null ? ` ${epPadded}` : ''} ${q}`);
      } else if (uploader === 'varyg') {
        preferredQueries.push(`${title}${epNum != null ? ` ${epPadded}` : ''} ${q} VARYG`);
      }
      if (epNum != null) {
        broadQueries.push(`${title} ${epPadded} ${q}`);
        broadQueries.push(`${title} ${epRaw}`);
      } else broadQueries.push(`${title} ${q}`, title);
    }
    const queries = epNum != null
      ? buildEpisodeSearchQueries(seriesTitle, q, uploader, epNum, config.forceHevc !== false)
      : preferredQueries.concat(broadQueries)
        .flatMap(getSearchVariants)
        .filter((query, index, all) => query && all.indexOf(query) === index);

    let allResults = [];
    const seenIds = new Set();
    for (const qText of queries) {
      const r = await nyaaSearch(qText);
      for (const item of r) {
        const resultKey = item.id || item.magnet || item.title;
        if (!seenIds.has(resultKey)) {
          seenIds.add(resultKey);
          allResults.push(item);
        }
      }
      if (epNum != null) {
        if (allResults.some(item =>
          parseNyaaEpisodeNumber(item.title) === parseInt(epNum, 10) &&
          releaseMatchesUploader(item, uploader) &&
          (trackedEntry ? releaseMatchesTrackedSeason(item, trackedEntry, seriesTitle) : releaseMatchesSeriesTitle(item, seriesTitle)) &&
          releaseMatchesQuality(item, q)
        )) break;
      } else if (allResults.some(item =>
        releaseMatchesUploader(item, uploader) && releaseMatchesSeriesTitle(item, seriesTitle)
      )) break;
    }

    if (!allResults.length) return { success: false, error: 'No results found' };

    // Episode requests require an exact match. Full-series requests score the
    // broad result set instead of comparing every result against NaN.
    const isEpisodeRequest = epNum !== null && epNum !== undefined && mode === 'ep';
    const targetEp = isEpisodeRequest ? parseInt(epNum, 10) : null;
    let matched = isEpisodeRequest
      ? allResults.map(r => ({ ...r, ep: parseNyaaEpisodeNumber(r.title) })).filter(r => {
          return r.ep === targetEp &&
            (trackedEntry ? releaseMatchesTrackedSeason(r, trackedEntry, seriesTitle) : releaseMatchesSeriesTitle(r, seriesTitle)) &&
            releaseMatchesQuality(r, q);
        })
      : allResults;
    if (!matched.length) return { success: false, error: isEpisodeRequest ? 'No exact episode match' : 'No series releases found' };

    // A configured uploader is authoritative whenever it supplied a valid
    // candidate. Scoring chooses only within that tier; other uploaders are a
    // fallback for genuine no-match cases.
    matched = preferUploaderMatches(matched, uploader);

    const scoreCtx = { h264Ceiling: computeH264Ceiling(matched) };
    const chosen = matched.reduce((best, r) => {
      const seriesScore = item => {
        let value = scoreRelease(item, uploader, scoreCtx);
        if (!isEpisodeRequest) {
          if (/\b(?:batch|complete|全集|season\s*pack)\b/i.test(item.title)) value += 700;
          if (parseNyaaEpisodeNumber(item.title) !== null) value -= 300;
        }
        return value;
      };
      const s = seriesScore(r);
      const bs = best ? seriesScore(best) : -Infinity;
      return s > bs ? r : best;
    }, null);

    if (!chosen) return { success: false, error: 'Scoring produced no winner' };

    // Hand off to the OS first. History is recorded only on success so a
    // failed fetch/open cannot poison the dedup window and silently block
    // retries for an hour.
    const dedupKey = [seriesTitle, epNum, mode].join('|');
    const nowMs = Date.now();
    let method;
    if (chosen.id) {
      const torrentData = await downloadNyaaTorrentFile(chosen.id);
      const tmpDir = path.join(app.getPath('temp'), 'animevault-torrents');
      fs.mkdirSync(tmpDir, { recursive: true });
      const safeName = chosen.title.replace(/[\\/:*?"<>|]/g, '_').substring(0, 80);
      const tmpFile = path.join(tmpDir, safeName + '.torrent');
      fs.writeFileSync(tmpFile, torrentData);
      await shell.openPath(tmpFile);
      method = 'external';
    } else if (chosen.magnet && isSafeExternalUrl(chosen.magnet)) {
      await shell.openExternal(chosen.magnet);
      method = 'magnet';
    } else {
      return { success: false, error: 'Selected release has no safe download link' };
    }

    pushDownloadHistory({
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
      method
    });

    return { success: true, title: chosen.title, seeders: chosen.seeders, chosen };
  } catch (e) {
    console.error('[Nyaa:autoDownload] Error:', e.message);
    return { success: false, error: e.message };
  }
}

ipcMain.handle('nyaa:autoDownload', (_, seriesTitle, quality, preferredUploader, epNum, mode = 'ep') => {
  const trackedEntry = (config.autoDownloadWatchlist || []).find(entry =>
    entry.seriesName === seriesTitle || entry.searchTitle === seriesTitle
  ) || null;
  return nyaaAutoDownloadForIpc(seriesTitle, quality, preferredUploader, epNum, mode, trackedEntry);
});

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
  getLocalHighestEpisode, getLocalEpisodes, pushDownloadHistory,
  getLibraryScan: () => lastLibraryScan,
  getLibraryScanReady: () => libraryScanReady,
  getWatchDataSync: (name) => {
    // Watch data lives in config.watchHistory, not a separate file
    return config.watchHistory[safeHistoryKey(name)] || null;
  }
});

// ================================================================
//  AI ASSISTANT (OpenRouter)
// ================================================================
openrouter.setDeps({
  config, saveConfig, mainWindow: () => mainWindow
});

ipcMain.handle('ai:getStatus', () => ({
  hasKey: !!config.openrouterApiKey,
  model: config.openrouterModel || ''
}));

ipcMain.handle('ai:setKey', (_, key) => {
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k || k.length > 200 || /\s/.test(k)) throw new Error('Invalid API key');
  saveOpenrouterKey(k);
  config.openrouterApiKey = k;
  scrubOpenrouterKeyFromConfigFiles();
  return true;
});

ipcMain.handle('ai:clearKey', () => {
  config.openrouterApiKey = '';
  try { if (fs.existsSync(OPENROUTER_KEY_PATH)) fs.unlinkSync(OPENROUTER_KEY_PATH); } catch (err) {
    throw new Error('Could not remove stored API key');
  }
  scrubOpenrouterKeyFromConfigFiles();
  return true;
});

ipcMain.handle('ai:setModel', (_, model) => {
  const m = typeof model === 'string' ? model.trim().replace(/[^\w.\-/:-]/g, '').slice(0, 120) : '';
  if (!m) throw new Error('Invalid model id');
  config.openrouterModel = m;
  saveConfig();
  return true;
});

ipcMain.handle('ai:send', async (_, messages, model, options) => {
  const r = await openrouter.chatStream(messages, model, options);
  return { ok: r.ok, error: r.ok ? null : r.message };
});

ipcMain.handle('ai:webSearch', async (_, query) => {
  if (!query || typeof query !== 'string') return { results: [] };
  return new Promise((resolve) => {
    const q = encodeURIComponent(query.trim().slice(0, 200));
    const req = https.get('https://api.duckduckgo.com/?q=' + q + '&format=json&no_html=1&skip_disambig=1', {
      headers: { 'User-Agent': 'AnimeVault/' + app.getVersion() + ' (Desktop App)' }
    }, (res) => {
      let data = '';
      res.on('data', c => { if (data.length < 50000) data += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const results = [];
          if (j.AbstractText) results.push({ title: j.Heading || query, snippet: j.AbstractText, url: j.AbstractURL });
          if (Array.isArray(j.RelatedTopics)) {
            j.RelatedTopics.slice(0, 5).forEach(t => {
              if (t.Text && t.FirstURL) results.push({ title: t.Text.slice(0, 60), snippet: t.Text, url: t.FirstURL });
            });
          }
          resolve({ results });
        } catch (e) { resolve({ results: [] }); }
      });
      res.on('error', () => resolve({ results: [] }));
    });
    req.on('error', () => resolve({ results: [] }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ results: [] }); });
  });
});

ipcMain.handle('ai:stop', () => {
  openrouter.abortChat();
  return true;
});

ipcMain.handle('autoDownload:getWatchlist', () => config.autoDownloadWatchlist || []);
ipcMain.handle('autoDownload:addSeries', (_, entry) => {
  if (!entry || typeof entry !== 'object' || !entry.seriesName || typeof entry.seriesName !== 'string') return false;
  if (!config.autoDownloadWatchlist) config.autoDownloadWatchlist = [];
  const key = Number(entry && entry.malId) || null;
  const existing = config.autoDownloadWatchlist.find(w =>
    (key && Number(w.malId) === key) || w.seriesName === entry.seriesName
  );
  const localSeries = resolveTrackedLocalSeries(entry.seriesName, entry.malId, entry.seriesPath);
  const localEpisodes = getLocalEpisodes(entry.seriesName, entry.malId, entry.seriesPath);
  const localHighest = localEpisodes.length ? Math.max(...localEpisodes) : 0;
  const watchData = localSeries && localSeries.watchData || config.watchHistory[entry.seriesName] || {};
  const malData = watchData.malData || {};
  const seriesPath = entry.seriesPath || (localSeries && localSeries.path) || '';
  const identityKey = String(entry.malId || '') + '|' + String(seriesPath || entry.seriesName || '');
  const clean = {
    ...entry,
    seriesPath,
    airingStartDate: entry.airingStartDate || malData.start_date || '',
    lastLocalEp: localHighest,
    lastDownloadedEp: Math.max(localHighest, Number(entry.lastDownloadedEp) || 0),
    trackingBaselineEp: Math.max(localHighest, Number(entry.trackingBaselineEp) || 0),
    trackingIdentityKey: identityKey,
    source: 'explicit',
    addedAt: (existing && existing.addedAt) || Date.now()
  };
  if (existing) Object.assign(existing, clean);
  else config.autoDownloadWatchlist.push(clean);
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
  if (entry && updates && typeof updates === 'object') {
    const allowed = ['episodeOffset', 'verifiedLatest', 'verifiedAt', 'lastChecked', 'searchTitle', 'preferredUploader', 'preferredQuality', 'totalEps', 'estimatedLatest'];
    for (const k of Object.keys(updates)) {
      if (allowed.includes(k)) entry[k] = updates[k];
    }
    saveConfig();
  }
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
  const m = Number(mins);
  config.autoDownloadPollMinutes = (Number.isFinite(m) && m >= 5 && m <= 1440) ? Math.floor(m) : (config.autoDownloadPollMinutes || 30);
  saveConfig();
  if (config.autoDownloadEnabled) { stopAutoDownloadPoller(); startAutoDownloadPoller(); }
  return true;
});
ipcMain.handle('autoDownload:setCriteria', (_, enabled) => {
  config.autoDownloadCriteria = enabled;
  saveConfig();
  return true;
});
ipcMain.handle('autoDownload:setBatchLimit', (_, limit) => {
  const lim = Number(limit);
  config.autoDownloadBatchLimit = Number.isFinite(lim) && lim >= 0 ? Math.floor(lim) : 0;
  saveConfig();
  return true;
});
ipcMain.handle('autoDownload:pollNow', async (_, force) => {
  // true = bypass enabled check + dedup window + recent-check skip; false = bypass enabled check only
  const results = await runAutoDownloadPoller(!!force);
  return { success: true, results };
});
ipcMain.handle('autoDownload:catchupSeries', async (_, seriesName, malId) => {
  const highest = getLocalHighestEpisode(seriesName, malId);
  const watch = (config.autoDownloadWatchlist || []).find(w =>
    w.seriesName === seriesName || (malId && Number(w.malId) === Number(malId))
  );
  const entry = watch || { seriesName, malId, episodeOffset: 0 };
  const verifiedLatest = await autoDownload.verifyLatestAvailableEpisode(entry);
  if (!verifiedLatest) return { success: false, error: 'No verified episode release found on Nyaa' };
  if (verifiedLatest <= highest) return { success: false, error: `Local library is already at verified episode ${verifiedLatest}` };

  const downloaded = [];
  const uploader = entry.preferredUploader || config.nyaaUploader || 'erai';
  const quality = entry.preferredQuality || config.nyaaQuality || '1080p';

  for (let ep = highest + 1; ep <= verifiedLatest; ep++) {
    const result = await nyaaAutoDownloadForIpc(entry.searchTitle || seriesName, quality, uploader, ep, 'ep', entry);
    if (result && result.success) {
      downloaded.push({ episode: ep, title: result.title || entry.seriesName });
      entry.lastDownloadedEp = ep;
      entry.lastDownloadedAt = Date.now();
      if (watch) saveConfig();
      await new Promise(r => setTimeout(r, 600));
    }
  }

  return { success: downloaded.length > 0, downloaded, verifiedLatest, highest };
});

ipcMain.handle('autoDownload:verifyLatest', async (_, seriesName, malId, offset = 0) => {
  const watch = (config.autoDownloadWatchlist || []).find(w =>
    w.seriesName === seriesName || (malId && Number(w.malId) === Number(malId))
  );
  const entry = watch || { seriesName, malId, totalEps: 0 };
  entry.episodeOffset = Math.max(-12, Math.min(12, Number(offset) || 0));
  const episode = await autoDownload.verifyLatestAvailableEpisode(entry);
  if (watch) saveConfig();
  return { success: episode > 0, episode, verifiedAt: entry.verifiedAt, offset: entry.episodeOffset };
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
  const watch = (config.autoDownloadWatchlist || []).find(w =>
    w.seriesName === seriesName || (malId && Number(w.malId) === Number(malId))
  );
  const entry = watch || { seriesName, malId, episodeOffset: 0 };
  const episode = await autoDownload.verifyLatestAvailableEpisode(entry);
  if (!episode) return { success: false, error: 'No confidently matched episode release was found' };
  if (episode <= highest) return { success: false, error: `Local library is already at verified episode ${episode}` };
  if (watch) saveConfig();
  const result = await nyaaAutoDownloadForIpc(entry.searchTitle || seriesName, config.nyaaQuality, config.nyaaUploader, episode, 'ep', entry);
  return { ...result, episode, highest };
});

ipcMain.handle('manager:renameSeries', async (_, seriesPath, oldName, newName) => {
  try {
    assertAllowedChildFileActionPath(seriesPath);
    const cleanName = String(newName || '').trim();
    if (!cleanName || cleanName === '.' || cleanName === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(cleanName) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(cleanName)) {
      return { success: false, error: 'The new name contains invalid Windows filename characters' };
    }
    if (!fs.existsSync(seriesPath) || !fs.statSync(seriesPath).isDirectory()) {
      return { success: false, error: 'Series folder not found' };
    }
    const currentName = String(oldName || path.basename(seriesPath));
    const destination = path.join(path.dirname(seriesPath), cleanName);
    assertAllowedChildFileActionPath(destination);
    if (destination !== seriesPath && fs.existsSync(destination)) {
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
    for (const entry of config.autoDownloadWatchlist || []) {
      if (entry.seriesName === currentName) entry.seriesName = cleanName;
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

// ================================================================
//  MANGA
// ================================================================
ipcMain.handle('manga:openFile', async (_, filePath) => {
  try {
    assertAllowedFileActionPath(filePath);
    assertPlayableMedia(filePath, MANGA_EXTS);
    const reader = config.readerPath;
    if (reader && fs.existsSync(reader)) {
      const res = await spawnDetached(reader, [filePath]);
      if (!res.ok) return { success: false, error: 'Failed to launch the manga reader: ' + res.message };
    } else {
      await shell.openPath(filePath);
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
  const readers = commonPaths.filter(p => { try { return fs.existsSync(p); } catch (e) { return false; } })
    .map(p => ({ name: path.basename(p, '.exe'), path: p }));
  return { path: readers.length ? readers[0].path : null, readers };
});


// Batch C F9: Import/Export & Backup
ipcMain.handle('library:exportMetadata', async () => {
  const safeConfig = { ...config };
  ['malAccessToken','malRefreshToken','malClientSecret','malCodeVerifier'].forEach(key => delete safeConfig[key]);
  return { version: 1, exportedAt: new Date().toISOString(), config: safeConfig, library: lastLibraryScan };
});

ipcMain.handle('library:exportCSV', async () => {
  const rows = [['Name', 'Category', 'Episodes', 'Watched', 'MAL ID', 'MAL Score', 'Status']];
  for (const s of lastLibraryScan) {
    const w = s.watchData || {};
    const m = w.malData || {};
    const ls = m.my_list_status || {};
    rows.push([s.name, s.category || '', s.episodeCount, w.episodesWatched ? w.episodesWatched.length : 0, w.malId || '', m.mean || '', ls.status || '']);
  }
  return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
});

ipcMain.handle('library:importAniList', async (_, filePath) => {
  try {
    // Legacy channel: the renderer imports AniList data directly over GraphQL.
    // If an explicit file path is ever passed, it must be inside userData and JSON.
    if (!filePath || !isAllowedFileActionPath(filePath, true)) return { success: false, error: 'File is outside AnimeVault folders' };
    if (path.extname(filePath).toLowerCase() !== '.json') return { success: false, error: 'Expected a .json file' };
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (raw.length > 50 * 1024 * 1024) return { success: false, error: 'File too large' };
    const data = JSON.parse(raw);
    let imported = 0;
    for (const entry of (Array.isArray(data.entries) ? data.entries : [])) {
      const title = entry && entry.media ? (entry.media.title?.romaji || entry.media.title?.english) : null;
      if (!title || typeof title !== 'string') continue;
      const key = safeHistoryKey(title);
      const status = entry.status ? String(entry.status).toLowerCase().replace(/_/g, ' ') : '';
      const score = Number(entry.score) || 0;
      const progress = Number(entry.progress) || 0;
      const history = getWatchHistoryStore();
      if (!history[key]) history[key] = {};
      history[key].malData = { ...history[key].malData, mean: score, my_list_status: { status, num_watched_episodes: progress } };
      imported++;
    }
    saveConfig();
    return { success: true, imported };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Credentials never leave the machine in a backup: the zip often ends up in
// cloud-synced folders. Restoring keeps whatever account is connected now.
const BACKUP_SECRET_KEYS = ['malAccessToken', 'malRefreshToken', 'malTokenExpiry', 'malCodeVerifier', 'malAuthState', 'malClientSecret', 'openrouterApiKey', '_userDataPath'];

ipcMain.handle('library:backup', async (_, destPath) => {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    const safeConfig = { ...config };
    BACKUP_SECRET_KEYS.forEach(key => delete safeConfig[key]);
    zip.addFile('config.json', Buffer.from(JSON.stringify(safeConfig, null, 2), 'utf-8'));
    if (fs.existsSync(CACHE_DIR)) zip.addLocalFolder(CACHE_DIR, 'cover-cache');
    let outPath;
    if (destPath && typeof destPath === 'string' && destPath.trim()) {
      outPath = path.resolve(destPath);
      const ud = normalizeFsPath(app.getPath('userData'));
      if (ud && isInsidePath(ud, outPath)) return { success: false, error: 'Backup destination cannot be inside app data' };
      if (path.extname(outPath).toLowerCase() !== '.zip') return { success: false, error: 'Backup must end in .zip' };
      if (fs.existsSync(outPath)) return { success: false, error: 'A file with that name already exists' };
    } else {
      outPath = path.join(app.getPath('downloads'), `AnimeVault-Backup-${new Date().toISOString().slice(0,10)}.zip`);
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    zip.writeZip(outPath);
    return { success: true, path: outPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

const RESTORE_MAX_ENTRIES = 50000;
const RESTORE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const RESTORE_MAX_CONFIG_BYTES = 64 * 1024 * 1024;
ipcMain.handle('library:restore', async (_, zipPath) => {
  try {
    if (!zipPath || typeof zipPath !== 'string' || path.extname(zipPath).toLowerCase() !== '.zip') return { success: false, error: 'Choose a .zip backup file' };
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    if (entries.length > RESTORE_MAX_ENTRIES) return { success: false, error: 'Backup has too many files' };
    let total = 0;
    for (const entry of entries) {
      const name = entry.entryName.replace(/\\/g, '/');
      const parts = name.split('/');
      const okShape = name === 'config.json' || (parts[0] === 'cover-cache' && (entry.isDirectory ? parts.length <= 2 : parts.length === 2 && isSafeFileName(parts[1])));
      if (path.isAbsolute(name) || parts.includes('..') || !okShape) return { success: false, error: 'Backup contains unsafe or unexpected files' };
      total += Number(entry.header && entry.header.size) || 0;
      if (total > RESTORE_MAX_BYTES) return { success: false, error: 'Backup is too large' };
    }
    const cfgEntry = zip.getEntry('config.json');
    if (!cfgEntry || Number(cfgEntry.header.size) > RESTORE_MAX_CONFIG_BYTES) return { success: false, error: 'Backup has no usable config.json' };
    let restored;
    try { restored = JSON.parse(cfgEntry.getData().toString('utf-8')); } catch (e) { return { success: false, error: 'Backup config.json is not valid JSON' }; }
    if (!restored || typeof restored !== 'object' || Array.isArray(restored)) return { success: false, error: 'Backup config.json is not a settings file' };
    // Unknown keys are dropped; credentials always come from the current session.
    const next = {};
    for (const key of Object.keys(restored)) {
      if (isSafeConfigKey(key) && !BACKUP_SECRET_KEYS.includes(key) && key !== 'hasMalClientSecret' && key !== 'hasOpenrouterApiKey') next[key] = restored[key];
    }
    for (const key of BACKUP_SECRET_KEYS) if (key !== '_userDataPath' && key !== 'openrouterApiKey' && config[key] !== undefined) next[key] = config[key];
    // Covers: files only, written straight into cover-cache (never elsewhere).
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    for (const entry of entries) {
      if (entry.isDirectory || !entry.entryName.replace(/\\/g, '/').startsWith('cover-cache/')) continue;
      const base = entry.entryName.replace(/\\/g, '/').split('/')[1];
      const ext = path.extname(base).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;
      fs.writeFileSync(path.join(CACHE_DIR, base), entry.getData());
    }
    // Swap settings in place (other modules hold this object), write through
    // the normal safety chain (.bak rotation, shrink guard), then reload so
    // defaults fill anything an older backup lacks.
    flushSaveConfig();
    const openrouterKey = config.openrouterApiKey;
    for (const key of Object.keys(config)) delete config[key];
    Object.assign(config, next);
    writeConfigSafely();
    loadConfig();
    config.openrouterApiKey = openrouterKey;
    clearLibraryIndex();
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
    fs.mkdirSync(targetDir, { recursive: true });

    // If placing an entire folder, move it into the destination
    if (item.isFolder) {
      // When moving a folder, place it inside the targetDir
      // The folder name should already be the clean series name
      const targetPath = targetDir;
      if (fs.existsSync(targetPath)) {
        // Destination already exists: move files inside individually
        const files = (config.vaultMode === 'manga' ? getMangaFiles : getVideoFiles)(item.originalPath, false);
        let moved = 0;
        for (const f of files) {
          const destFile = path.join(targetPath, path.basename(f.path));
          if (!fs.existsSync(destFile)) {
            moveNoClobber(f.path, destFile);
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
        moveNoClobber(item.originalPath, targetPath);
        return { success: true, path: targetPath };
      }
      return { success: false, error: 'Source folder not found' };
    }

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

// ================================================================
//  DUPLICATE FILE DETECTION
// ================================================================
function fmtBytes(b) {
  if (!b || b === 0) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0) + ' ' + s[i];
}

async function checkDuplicatesAfterScan(library) {
  try {
    const duplicates = [];
    for (const series of library) {
      if (!series.episodes || series.episodes.length < 2) continue;
      const seen = new Map();
      for (const ep of series.episodes) {
        const num = ep.episodeNum != null ? ep.episodeNum : parseMediaNumber(ep.name);
        if (num === null || num === undefined || isNaN(num)) continue;
        const key = `${series.name}_ep${num}`;
        const enriched = {
          ...ep,
          codec: /\b(?:HEVC|x265|H\.265)\b/i.test(ep.name) ? 'HEVC'
               : (/\b(?:H\.264|x264|AVC)\b/i.test(ep.name) ? 'H.264' : 'Unknown'),
          resolution: detectResolution(ep.name),
          sizeFormatted: fmtBytes(ep.size || 0)
        };
        if (seen.has(key)) {
          const existing = duplicates.find(d => d.series === series.name && d.episode === num);
          if (existing) {
            existing.files.push(enriched);
          } else {
            duplicates.push({ series: series.name, episode: num, files: [seen.get(key), enriched] });
          }
        } else {
          seen.set(key, enriched);
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

let duplicateScanTimer = null;
function scheduleDuplicateCheck(library) {
  if (duplicateScanTimer) clearTimeout(duplicateScanTimer);
  duplicateScanTimer = setTimeout(() => {
    duplicateScanTimer = null;
    checkDuplicatesAfterScan(library);
  }, 2500);
}

ipcMain.handle('duplicate:resolve', (_, data) => {
  try {
    if (!data || typeof data !== 'object') return { success: false, error: 'Invalid payload' };
    const { keep } = data;
    // "delete" may be a single path (legacy) or every extra copy at once.
    const deletePaths = Array.isArray(data.delete) ? data.delete : (data.delete ? [data.delete] : []);
    let deleted = 0;
    for (const p of deletePaths) {
      if (!p || typeof p !== 'string' || p === keep) continue;
      assertAllowedFileActionPath(p);
      assertPlayableMedia(p, VIDEO_EXTS.concat(MANGA_EXTS));
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        deleted++;
      }
    }
    if (deleted > 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('duplicate:resolved', data);
    }
    return { success: true, deleted };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ================================================================
//  WINDOW MANAGEMENT
// ================================================================
function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
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
      sandbox: true
    },
    show: false,
    backgroundColor: '#0a0a0f'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  // Deny every renderer permission request by default. The app has no
  // camera/mic/geolocation features; approving nothing shrinks the attack
  // surface and keeps the renderer fully in-process.
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
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
  enabled = enabled === true;
  config.minimizeToTray = enabled;
  saveConfig();
  applyMinimizeToTray(enabled);
  return true;
});

// ================================================================
//  APP LIFECYCLE
// ================================================================
// cover://<encodeURIComponent(absPath)> — same access rules as cover:getDataUrl:
// image extensions only, and inside userData restricted to cover-cache/thumbnails.
function handleCoverRequest(request) {
  try {
    const fp = normalizeFsPath(decodeURIComponent(request.url.slice('cover://'.length)));
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

// Defense in depth for every web contents the app ever creates (not only the
// main window): no <webview>, no pop-up windows, no navigation away.
app.on('web-contents-created', (_, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault();
  });
});

app.whenReady().then(() => {
  protocol.handle('cover', handleCoverRequest);
  appendAuthDebug('boot version=' + app.getVersion() + ' pid=' + process.pid);
  loadConfig();
  loadOpenrouterKey();
  createWindow();

  // Resume file watcher if enabled
  if (config.watcherFolder) {
    startFileWatcher(config.watcherFolder, config.watcherDest);
  }

  // Resume auto-download poller if enabled
  if (config.autoDownloadEnabled && config.autoDownloadWatchlist?.length) {
    startAutoDownloadPoller();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  flushSaveConfig();
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
    // A second launch hands over to the running instance. That instance may be
    // hidden in the tray (minimize/close-to-tray), so show it — focusing a
    // hidden window does nothing and the launch looks like it failed.
    app.on('second-instance', () => {
      if (!mainWindow || mainWindow.isDestroyed()) { if (app.isReady()) createWindow(); return; }
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    });
  }
}
