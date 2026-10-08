'use strict';

// AnimeVault main process entry. Startup logging, sandbox and protocol setup
// and the app lifecycle live here; everything else is in main/:
//   main/state.js            settings object + shared runtime handles
//   main/config/             config.json, path security, backup/restore
//   main/scanner/            filename parsing, library scan, watcher, organizer
//   main/players/            MPV / VLC launch and auto-mark polling
//   main/services/           AniList, MAL, Nyaa, auto-download, Luma (OpenRouter)
//   main/window/             window, tray, cover:// protocol
//   main/ipc/registerHandlers.js  registers every module's IPC handlers

const { app, BrowserWindow, dialog, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

// Packaged builds have no console. Anything that stops the app from starting
// is recorded in %APPDATA%\animevault\startup.log so a silent launch failure
// can be diagnosed (and a fatal error is shown instead of vanishing).
function logStartup(line) {
  try {
    const p = path.join(app.getPath('userData'), 'startup.log');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (fs.existsSync(p) && fs.statSync(p).size > 256 * 1024) fs.writeFileSync(p, '');
    fs.appendFileSync(p, '[' + new Date().toISOString() + '] v' + app.getVersion() + ' ' + process.arch + ' ' + line + '\n');
  } catch (e) { /* logging must never break startup */ }
}

process.on('uncaughtException', (err) => {
  logStartup('FATAL ' + (err && err.stack || err));
  try { dialog.showErrorBox('AnimeVault ran into a problem', String(err && err.message || err) + '\n\nDetails were saved to startup.log in %APPDATA%\\animevault.'); } catch (e) {}
});

// One AnimeVault at a time. The lock is taken before any app module loads, so
// a second launch (npm start next to a built copy, a hidden tray window) never
// registers handlers or starts its own watcher and poller - it just hands over.
if (!app.requestSingleInstanceLock()) {
  logStartup('another AnimeVault instance is already running (npm start, a hidden tray window, or another build) - handing over to it');
  app.quit();
} else {
  startApp();
}

function startApp() {
  // Required after the handler above, so a module that fails to load is logged.
  const { startAutoDownloadPoller, stopAutoDownloadPoller } = require('./autoDownload');
  const { state, config } = require('./main/state');
  const { isSafeExternalUrl } = require('./main/config/security');
  const { flushSaveConfig, loadConfig, loadLumaKey, loadMalCredentials } = require('./main/config/config');
  const { appendAuthDebug } = require('./main/services/mal');
  const { startFileWatcher, stopFileWatcher } = require('./main/scanner/watcher');
  const { createWindow } = require('./main/window/window');
  const { handleCoverRequest } = require('./main/window/protocol');
  const { registerHandlers } = require('./main/ipc/registerHandlers');

  // cover:// streams cached artwork straight from disk so the renderer never
  // holds megabytes of base64 copies. Must be registered before app ready.
  // Every renderer runs sandboxed, whatever a future BrowserWindow forgets to set.
  // (An explicit --no-sandbox, needed only for root/CI runs, still opts out.)
  if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();

  protocol.registerSchemesAsPrivileged([
    { scheme: 'cover', privileges: { standard: false, secure: true, supportFetchAPI: false } }
  ]);

  registerHandlers();

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
    logStartup('started from ' + process.execPath);
    protocol.handle('cover', handleCoverRequest);
    appendAuthDebug('boot version=' + app.getVersion() + ' pid=' + process.pid);
    loadConfig();
    loadLumaKey();
    loadMalCredentials();
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
    state.isQuitting = true;
    flushSaveConfig();
    stopFileWatcher();
    stopAutoDownloadPoller();
  });

  // A second launch hands over to the running instance. That instance may be
  // hidden in the tray (minimize/close-to-tray), so show it - focusing a
  // hidden window does nothing and the launch looks like it failed.
  app.on('second-instance', () => {
    if (!state.mainWindow || state.mainWindow.isDestroyed()) { if (app.isReady()) createWindow(); return; }
    if (state.mainWindow.isMinimized()) state.mainWindow.restore();
    if (!state.mainWindow.isVisible()) state.mainWindow.show();
    state.mainWindow.focus();
  });
}
