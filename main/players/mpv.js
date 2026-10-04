'use strict';

// main/players/mpv.js - bundled/installed MPV discovery and its JSON IPC.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { APP_ROOT, config } = require('../state');

function resolveMpvPath() {
  if (config.playerType === 'bundled-mpv') {
    const bundled = path.join(process.resourcesPath, 'bin', 'mpv.exe');
    if (fs.existsSync(bundled)) return bundled;
    const dev = path.join(APP_ROOT, 'bin', 'mpv.exe');
    if (fs.existsSync(dev)) return dev;
  }
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
