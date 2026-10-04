'use strict';

// main/config/backup.js - metadata export, AniList import and backup/restore
// (credentials never leave the machine; restores are validated).

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { state, config } = require('../state');
const { isAllowedFileActionPath, isInsidePath, isSafeFileName, normalizeFsPath } = require('./security');
const { API_KEY_CONFIG_FIELDS, CACHE_DIR, flushSaveConfig, getWatchHistoryStore, isSafeConfigKey, loadConfig, safeHistoryKey, saveConfig, writeConfigSafely } = require('./config');
const { clearLibraryIndex } = require('../scanner/library');

function getLocalStorageObj() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'localStorage.json'), 'utf-8'));
  } catch (e) { return {}; }
}

// Credentials never leave the machine in a backup: the zip often ends up in
// cloud-synced folders. Restoring keeps whatever account is connected now.
const BACKUP_SECRET_KEYS = ['malAccessToken', 'malRefreshToken', 'malTokenExpiry', 'malCodeVerifier', 'malAuthState', 'malClientSecret', 'geminiApiKey', 'openrouterApiKey', '_userDataPath'];

const RESTORE_MAX_ENTRIES = 50000;
const RESTORE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const RESTORE_MAX_CONFIG_BYTES = 64 * 1024 * 1024;

function register() {
  // Batch C F9: Import/Export & Backup
  ipcMain.handle('library:exportMetadata', async () => {
    const safeConfig = { ...config };
    ['malAccessToken','malRefreshToken','malClientSecret','malCodeVerifier'].forEach(key => delete safeConfig[key]);
    return { version: 1, exportedAt: new Date().toISOString(), config: safeConfig, library: state.lastLibraryScan };
  });

  ipcMain.handle('library:exportCSV', async () => {
    const rows = [['Name', 'Category', 'Episodes', 'Watched', 'MAL ID', 'MAL Score', 'Status']];
    for (const s of state.lastLibraryScan) {
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
        if (isSafeConfigKey(key) && !BACKUP_SECRET_KEYS.includes(key) && key !== 'hasMalClientSecret' && key !== 'hasGeminiApiKey') next[key] = restored[key];
      }
      for (const key of BACKUP_SECRET_KEYS) if (key !== '_userDataPath' && !API_KEY_CONFIG_FIELDS.includes(key) && config[key] !== undefined) next[key] = config[key];
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
      const aiKey = config.geminiApiKey;
      for (const key of Object.keys(config)) delete config[key];
      Object.assign(config, next);
      writeConfigSafely();
      loadConfig();
      config.geminiApiKey = aiKey;
      clearLibraryIndex();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = {
  register,
};
