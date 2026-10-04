'use strict';

// main/ipc/registerHandlers.js - wires every main-process module into IPC.
// Each module keeps its ipcMain.handle(...) calls in a register() function;
// nothing listens to the renderer until registerHandlers() runs (once, from
// main.js, before the window exists).

const MODULES = [
  require('../config/config'),
  require('../config/backup'),
  require('./system'),
  require('../scanner/library'),
  require('../scanner/history'),
  require('../scanner/organizer'),
  require('../scanner/watcher'),
  require('../scanner/duplicates'),
  require('../players/player'),
  require('../services/covers'),
  require('../services/anilist'),
  require('../services/mal'),
  require('../services/nyaa'),
  require('../services/downloads'),
  require('../services/ai'),
  require('../window/window'),
];

let registered = false;
function registerHandlers() {
  if (registered) return;
  registered = true;
  for (const mod of MODULES) mod.register();
}

module.exports = { registerHandlers };
