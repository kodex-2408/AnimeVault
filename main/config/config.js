'use strict';

// main/config/config.js - loading and saving config.json (shrink guard, .bak
// rotation, daily snapshots), the encrypted Gemini key, watch-history
// helpers and the config:* IPC handlers.

const { app, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { config } = require('../state');
const { validateRendererConfigValue } = require('./security');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const CONFIG_BACKUP_PATH = CONFIG_PATH + '.bak';
const GEMINI_KEY_PATH = path.join(app.getPath('userData'), 'gemini-key.enc');
// 5.0 stored an OpenRouter key here; 5.1 removes it on first start.
const LEGACY_OPENROUTER_KEY_PATH = path.join(app.getPath('userData'), 'openrouter-key.enc');
const CACHE_DIR = path.join(app.getPath('userData'), 'cover-cache');
const LIBRARY_INDEX_PATH = path.join(app.getPath('userData'), 'library-index.json');

let _saveTimer = null;

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
  'nyaaUploader', 'nyaaQuality', 'releasePicker', 'autoDownloadWatchlist', 'autoDownloadCriteria', 'autoDownloadPollMinutes',
  'autoDownloadEnabled', 'autoDownloadNotify', 'autoDownloadBatchLimit', 'minimizeToTray', 'desktopNotifications', 'watchAndDelete',
  'watcherFolder', 'watcherDest', 'watcherIgnorePatterns', 'searchPresets', 'performanceMode', 'incrementalScan',
  'titleAliases', 'gapRules', 'animeImportInbox', 'mangaImportInbox', 'activityLog', 'downloadHistory',
  'animeKnownSeries', 'mangaKnownSeries', 'animeImportReviewDismissed', 'mangaImportReviewDismissed',
  'notificationPrefs', 'syncPaused', 'hideDonghua', 'audioDelay', 'animSpeed', 'backgroundEffects',
  'backgroundType', 'backgroundIntensity', 'maximized', 'setupDone', 'importAutoMatch', 'lumaMascot', 'lumaSparkles', 'lumaSize', 'lumaSpeed',
  'untrackOnDelete', 'mutedDupSeries', 'geminiApiKey', 'geminiModel', 'hasGeminiApiKey',
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
  // MAL timestamps every list entry. When both sides carry updated_at, the
  // newer one wins — so a status changed on MAL itself (dropped, completed)
  // reaches the app, while a fresh local PATCH is never undone by a stale GET.
  // Without timestamps the stored status stays authoritative (pre-5.1 rule).
  const incomingStatus = incoming.my_list_status;
  const tsPrev = previousListStatus && Date.parse(previousListStatus.updated_at);
  const tsIn = incomingStatus && typeof incomingStatus === 'object' && Date.parse(incomingStatus.updated_at);
  if (hasUsablePrevious && tsPrev && tsIn && tsIn > tsPrev) {
    merged.my_list_status = incomingStatus;
  } else if (hasUsablePrevious) {
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

// Keys that live only in encrypted files / memory, never in config.json.
const API_KEY_CONFIG_FIELDS = ['geminiApiKey', 'openrouterApiKey'];

// Loads the user's Google AI Studio key (encrypted with the OS account) and
// removes everything left from the 5.0 OpenRouter integration.
function loadGeminiKey() {
  const plaintextKey = typeof config.geminiApiKey === 'string' ? config.geminiApiKey.trim() : '';
  const hadLegacy = 'openrouterApiKey' in config || 'openrouterModel' in config || fs.existsSync(LEGACY_OPENROUTER_KEY_PATH);
  delete config.geminiApiKey;
  delete config.openrouterApiKey;
  delete config.openrouterModel;
  try { if (fs.existsSync(LEGACY_OPENROUTER_KEY_PATH)) fs.unlinkSync(LEGACY_OPENROUTER_KEY_PATH); } catch (e) { console.error('[AI] Could not remove the old OpenRouter key:', e.message); }
  try {
    if (plaintextKey) saveGeminiKey(plaintextKey);
    if (fs.existsSync(GEMINI_KEY_PATH)) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable');
      config.geminiApiKey = safeStorage.decryptString(fs.readFileSync(GEMINI_KEY_PATH));
    } else {
      config.geminiApiKey = '';
    }
  } catch (err) {
    config.geminiApiKey = '';
    console.error('[AI] Could not load the encrypted Google AI Studio key:', err.message);
  }
  if (plaintextKey || hadLegacy) { scrubApiKeysFromConfigFiles(); saveConfig(); }
}

function saveGeminiKey(key) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure OS key storage is unavailable');
  fs.mkdirSync(path.dirname(GEMINI_KEY_PATH), { recursive: true });
  fs.writeFileSync(GEMINI_KEY_PATH, safeStorage.encryptString(key), { mode: 0o600 });
}

// Removes API keys (current and legacy) from config.json, its backups and the
// daily snapshots.
function scrubApiKeysFromConfigFiles() {
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
      const keys = API_KEY_CONFIG_FIELDS.concat('openrouterModel').filter(k => Object.prototype.hasOwnProperty.call(data, k));
      if (!keys.length) continue;
      keys.forEach(k => delete data[k]);
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[AI] Could not scrub API keys from', file, err.message);
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
  API_KEY_CONFIG_FIELDS.forEach(k => delete safeConfig[k]);
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

function configValueUnchanged(key, value) {
  try { return JSON.stringify(config[key]) === JSON.stringify(value); } catch (e) { return false; }
}

function register() {
  ipcMain.handle('config:get', () => {
    const safe = { ...config, _userDataPath: app.getPath('userData') };
    // Non-sensitive existence flag so the renderer can say "saved - leave blank
    // to keep" without ever receiving the secret itself. Whitelisted in
    // STATIC_CONFIG_KEYS so cfg round-trips through setAllConfig stay legal.
    safe.hasMalClientSecret = !!safe.malClientSecret;
    safe.hasGeminiApiKey = !!safe.geminiApiKey;
    // Credentials and internal flow state never cross to the renderer.
    // malAuthState must be stripped here specifically: setAllConfig hard-throws
    // on unknown keys, so a leaked key would break every cfg round-trip
    // (theme toggles, disconnect, reset).
    ['malClientSecret', 'malCodeVerifier', 'malAccessToken', 'malRefreshToken', 'malAuthState', 'geminiApiKey', 'openrouterApiKey', 'openrouterModel'].forEach(key => { delete safe[key]; });
    return safe;
  });

  ipcMain.handle('config:set', (_, key, value) => {
    if (!isSafeConfigKey(key) || key === 'geminiApiKey' || key === 'hasGeminiApiKey' || key === '_userDataPath' || key === '__proto__' || key === 'constructor' || key === 'prototype') {
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
    delete incoming.geminiApiKey;
    delete incoming.hasGeminiApiKey;
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
}

module.exports = {
  API_KEY_CONFIG_FIELDS,
  CACHE_DIR,
  GEMINI_KEY_PATH,
  LIBRARY_INDEX_PATH,
  flushSaveConfig,
  getModeConfigMap,
  getTitleAlias,
  getWatchHistoryStore,
  isSafeConfigKey,
  loadConfig,
  loadGeminiKey,
  mergeMalData,
  safeEpisodeNumber,
  safeHistoryKey,
  safeMalId,
  saveConfig,
  saveGeminiKey,
  scrubApiKeysFromConfigFiles,
  writeConfigSafely,
  register,
};
