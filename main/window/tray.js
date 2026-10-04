'use strict';

// main/window/tray.js - system tray icon and minimize/close-to-tray.

const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { APP_ROOT, state } = require('../state');

function handleMinimizeToTray(event) {
  event.preventDefault();
  state.mainWindow.hide();
}

function handleCloseToTray(event) {
  if (!state.isQuitting) {
    event.preventDefault();
    state.mainWindow.hide();
  }
}

function applyMinimizeToTray(enabled) {
  if (!state.mainWindow) return;
  state.mainWindow.removeListener('minimize', handleMinimizeToTray);
  state.mainWindow.removeListener('close', handleCloseToTray);
  if (enabled) {
    createTray();
    state.mainWindow.on('minimize', handleMinimizeToTray);
    state.mainWindow.on('close', handleCloseToTray);
  } else {
    destroyTray();
  }
}

function createTray() {
  if (state.tray) return;
  let iconPath;
  try {
    // Try packaged resources first, then dev path
    iconPath = path.join(process.resourcesPath, 'icon.png');
    if (!fs.existsSync(iconPath)) iconPath = path.join(APP_ROOT, 'icon.png');
  } catch (e) { iconPath = path.join(APP_ROOT, 'icon.png'); }

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
  state.tray = new Tray(resized);
  state.tray.setToolTip('AnimeVault');
  updateTrayMenu();

  state.tray.on('click', () => {
    if (state.mainWindow) {
      if (state.mainWindow.isVisible() && state.mainWindow.isFocused()) {
        state.mainWindow.hide();
      } else {
        state.mainWindow.show();
        state.mainWindow.focus();
      }
    }
  });
}

function updateTrayMenu() {
  if (!state.tray) return;
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => { if (state.mainWindow) { state.mainWindow.show(); state.mainWindow.focus(); } } },
    { label: 'Quit', click: () => { state.isQuitting = true; app.quit(); } }
  ]);
  state.tray.setContextMenu(contextMenu);
}

function destroyTray() {
  if (state.tray) {
    state.tray.destroy();
    state.tray = null;
  }
}

module.exports = {
  applyMinimizeToTray,
};
