'use strict';

// main/scanner/duplicates.js - duplicate episode detection after a scan.

const { ipcMain } = require('electron');
const fs = require('fs');
const { state } = require('../state');
const { MANGA_EXTS, VIDEO_EXTS, assertPlayableMedia, detectResolution, parseMediaNumber } = require('./parsers');
const { assertAllowedFileActionPath, trashOrDelete } = require('../config/security');

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
    if (duplicates.length > 0 && state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('duplicate:showModal', duplicates);
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

function register() {
  ipcMain.handle('duplicate:resolve', async (_, data) => {
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
          await trashOrDelete(p);
          deleted++;
        }
      }
      if (deleted > 0 && state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('duplicate:resolved', data);
      }
      return { success: true, deleted };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = {
  scheduleDuplicateCheck,
  register,
};
