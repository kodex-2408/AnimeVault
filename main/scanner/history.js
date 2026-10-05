'use strict';

// main/scanner/history.js - watch:* handlers (progress, tags, MAL links).

const { ipcMain } = require('electron');
const fs = require('fs');
const { state, config } = require('../state');
const { getWatchHistoryStore, mergeMalData, safeEpisodeNumber, safeHistoryKey, safeMalId, saveConfig } = require('../config/config');
const { isAllowedFileActionPath, trashOrDelete } = require('../config/security');
const { parseMediaNumber } = require('./parsers');

function register() {
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
        const seriesEntry = state.lastLibraryScan.find(s => s.name === seriesName);
        if (seriesEntry && seriesEntry.episodes) {
          const epFile = seriesEntry.episodes.find(e => parseMediaNumber(e.name) === ep);
          if (epFile && fs.existsSync(epFile.path) && isAllowedFileActionPath(epFile.path)) {
            trashOrDelete(epFile.path)
              .then(how => console.log('[Watch&Delete]', how === 'trash' ? 'Recycled' : 'Deleted', epFile.name))
              .catch(e => console.error('[Watch&Delete] Failed to delete', epFile.path, e.message));
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
}

module.exports = {
  register,
};
