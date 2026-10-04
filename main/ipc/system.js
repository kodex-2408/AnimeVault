'use strict';

// main/ipc/system.js - native dialogs and shell (external URL, folder) handlers.

const { ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const { state } = require('../state');
const { isAllowedFileActionPath, isSafeExternalUrl } = require('../config/security');

function register() {
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(state.mainWindow, {
      properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:openFile', async (_, filters) => {
    const result = await dialog.showOpenDialog(state.mainWindow, {
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }]
    });
    return result.canceled ? null : result.filePaths[0];
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
}

module.exports = {
  register,
};
