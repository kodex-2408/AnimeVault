'use strict';

// main/players/mpv.js - MPV discovery and its JSON IPC.

const { app } = require('electron');
const path = require('path');
const net = require('net');
const { config } = require('../state');

// The configured mpv.exe, else "mpv" from PATH. (The bundled MPV build was
// dropped in 5.x; old "bundled-mpv" settings are migrated in loadConfig.)
function resolveMpvPath() {
  return config.mpvPath || 'mpv';
}

const MPV_IPC_PIPE = process.platform === 'win32' ? '\\\\.\\pipe\\mpv-animevault' : path.join(app.getPath('temp'), 'mpv-animevault.sock');

// --- MPV IPC polling ---
function mpvGetPercentPos() {
  return new Promise((resolve) => {
    const client = net.createConnection(MPV_IPC_PIPE);
    let buffer = '';
    let resolved = false;
    client.on('connect', () => {
      client.write(JSON.stringify({ command: ['get_property', 'percent-pos'] }) + '\n');
    });
    client.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const resp = JSON.parse(line);
          if (resp.data !== undefined && !resolved) {
            resolved = true;
            client.end();
            resolve({ pct: parseFloat(resp.data) || 0, playing: true });
          }
        } catch (e) {}
      }
    });
    client.on('error', () => { if (!resolved) { resolved = true; resolve({ pct: 0, playing: false }); } });
    client.on('close', () => { if (!resolved) { resolved = true; resolve({ pct: 0, playing: false }); } });
    setTimeout(() => { if (!resolved) { resolved = true; client.destroy(); resolve({ pct: 0, playing: false }); } }, 3000);
  });
}

module.exports = {
  MPV_IPC_PIPE,
  mpvGetPercentPos,
  resolveMpvPath,
};
