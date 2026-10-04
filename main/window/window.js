'use strict';

// main/window/window.js - main window creation and window:* controls.

const { BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { APP_ROOT, state, config } = require('../state');
const { isSafeExternalUrl } = require('../config/security');
const { saveConfig } = require('../config/config');
const { applyMinimizeToTray } = require('./tray');

function createWindow() {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.focus();
    return;
  }
  state.mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hidden',
    frame: false,
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    show: false,
    backgroundColor: '#0a0a0f'
  });

  state.mainWindow.loadFile(path.join(APP_ROOT, 'index.html'));
  state.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  state.mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== state.mainWindow.webContents.getURL()) event.preventDefault();
  });
  // Deny every renderer permission request by default. The app has no
  // camera/mic/geolocation features; approving nothing shrinks the attack
  // surface and keeps the renderer fully in-process.
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  state.mainWindow.once('ready-to-show', () => {
    state.mainWindow.show();
    if (config.maximized) state.mainWindow.maximize();
  });

  state.mainWindow.on('closed', () => {
    state.mainWindow = null;
  });

  state.mainWindow.on('maximize', () => { config.maximized = true; saveConfig(); });
  state.mainWindow.on('unmaximize', () => { config.maximized = false; saveConfig(); });

  // Apply minimize-to-tray if enabled
  if (config.minimizeToTray) {
    applyMinimizeToTray(true);
  }
}

function register() {
  ipcMain.handle('window:minimize', () => {
    if (state.mainWindow) state.mainWindow.minimize();
  });
  ipcMain.handle('window:maximize', () => {
    if (state.mainWindow) {
      if (state.mainWindow.isMaximized()) state.mainWindow.unmaximize();
      else state.mainWindow.maximize();
    }
  });
  ipcMain.handle('window:close', () => {
    if (state.mainWindow) {
      if (config.minimizeToTray) {
        state.mainWindow.hide();
      } else {
        state.isQuitting = true;
        state.mainWindow.close();
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
}

module.exports = {
  createWindow,
  register,
};
