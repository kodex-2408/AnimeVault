'use strict';

// main/players/player.js - launching the video player and manga reader,
// auto-mark playback polling and thumbnail extraction.

const { app, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { state, config } = require('../state');
const { assertAllowedFileActionPath, isSafeFileName } = require('../config/security');
const { MANGA_EXTS, VIDEO_EXTS, assertPlayableMedia, parseEpisodeNumber } = require('../scanner/parsers');
const { VLC_HTTP_PASSWORD, VLC_HTTP_PORT, vlcGetStatus } = require('./vlc');
const { MPV_IPC_PIPE, mpvGetPercentPos, resolveMpvPath } = require('./mpv');

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

let _amPollInterval = null;      // active setInterval handle
let _amCurrentPlayer = null;     // 'vlc' | 'mpv'
let _amSeriesName = null;
let _amEpisodeNum = null;
let _amAlreadyMarked = false;    // guard against duplicate emissions
let _amPlayerProcess = null;      // child process handle of spawned player
let _amConsecutiveFailures = 0;   // consecutive polling failures before giving up

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
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('player:automark', {
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

// Subtitle preference -> language codes. Track tags are 2- or 3-letter ISO
// codes depending on the release, so both spellings are passed; 'none' turns
// subtitles off.
const SUB_LANG_CODES = {
  en: ['en', 'eng'], es: ['es', 'spa'], pt: ['pt', 'por'], fr: ['fr', 'fre', 'fra'], de: ['de', 'ger', 'deu'],
  it: ['it', 'ita'], ru: ['ru', 'rus'], ar: ['ar', 'ara'], ja: ['ja', 'jpn'],
};
function subtitleLangList(primary, fallback) {
  const out = [];
  for (const l of [primary, fallback]) for (const c of (SUB_LANG_CODES[l] || [])) if (!out.includes(c)) out.push(c);
  return out;
}

// Bluetooth headphones play audio late, so audio is moved earlier by the
// configured amount (default 300 ms). 0 = off.
function audioAdvanceMs(cfg) {
  if (!cfg.audioDelay) return 0;
  const ms = Math.round(Number(cfg.audioDelayMs));
  if (!Number.isFinite(ms) || ms <= 0) return 300;
  return Math.min(ms, 5000);
}

// Command-line options for the subtitle and audio-delay preferences.
function playerPrefArgs(player, cfg) {
  const args = [];
  const subsOff = cfg.subLangPrimary === 'none';
  const langs = subsOff ? [] : subtitleLangList(cfg.subLangPrimary, cfg.subLangFallback);
  const advance = audioAdvanceMs(cfg);
  if (player === 'vlc') {
    if (subsOff) args.push('--no-spu');
    else if (langs.length) args.push('--sub-language=' + langs.join(','));
    if (advance) args.push('--audio-desync=' + (-advance)); // milliseconds
  } else {
    if (subsOff) args.push('--sid=no');
    else if (langs.length) args.push('--slang=' + langs.join(','));
    if (advance) args.push('--audio-delay=' + (-advance / 1000)); // seconds
  }
  return args;
}

function register() {
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
        args.push(...playerPrefArgs('vlc', config));
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
      } else if (playerType === 'mpv') {
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
        args.push(...playerPrefArgs('mpv', config));
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
}

module.exports = {
  register,
};
