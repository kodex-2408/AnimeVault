'use strict';

// main/services/downloads.js - auto-download watchlist, poller wiring and
// download history handlers.

const { app, ipcMain, shell } = require('electron');
const autoDownload = require('../../autoDownload');
const { startAutoDownloadPoller, stopAutoDownloadPoller, runAutoDownloadPoller } = require('../../autoDownload');
const { state, config } = require('../state');
const { safeHistoryKey, saveConfig } = require('../config/config');
const { getLocalEpisodes, getLocalHighestEpisode, resolveTrackedLocalSeries } = require('../scanner/library');
const { nyaaAutoDownloadForIpc, pushDownloadHistory } = require('./nyaa');

function register() {
  autoDownload.setDeps({
    config, saveConfig, mainWindow: () => state.mainWindow, shell, app,
    getLocalHighestEpisode, getLocalEpisodes, pushDownloadHistory,
    getLibraryScan: () => state.lastLibraryScan,
    getLibraryScanReady: () => state.libraryScanReady,
    getWatchDataSync: (name) => {
      // Watch data lives in config.watchHistory, not a separate file
      return config.watchHistory[safeHistoryKey(name)] || null;
    }
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
    const uploader = autoDownload.PREFERRED_GROUP;
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
    // A user-pressed button: the release picker may apply ('latest' scope).
    const result = await nyaaAutoDownloadForIpc(entry.searchTitle || seriesName, config.nyaaQuality, null, episode, 'ep', entry, { interactive: true, scope: 'latest' });
    return { ...result, episode, highest };
  });
}

module.exports = {
  register,
};
