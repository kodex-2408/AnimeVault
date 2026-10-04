'use strict';

// main/players/vlc.js - VLC HTTP interface status polling.

const http = require('http');
const crypto = require('crypto');

const VLC_HTTP_PORT = 18292; // unlikely to conflict
// Random per launch so other local processes can't drive the player's web interface.
const VLC_HTTP_PASSWORD = crypto.randomBytes(12).toString('hex');

// --- VLC HTTP polling ---
function vlcGetStatus() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${VLC_HTTP_PORT}/requests/status.xml`, {
      auth: `:${VLC_HTTP_PASSWORD}`,
      timeout: 3000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const posMatch = data.match(/<position>([\d.]+)<\/position>/);
          const lenMatch = data.match(/<length>(\d+)<\/length>/);
          const stateMatch = data.match(/<state>(\w+)<\/state>/);
          const position = posMatch ? parseFloat(posMatch[1]) : 0;
          const length = lenMatch ? parseInt(lenMatch[1]) : 0;
          const state = stateMatch ? stateMatch[1] : '';
          // position in status.xml is 0..1 fraction when using old API,
          // but with current VLC it's absolute seconds. Normalize.
          const pct = length > 0 ? (position > 1 ? (position / length) * 100 : position * 100) : 0;
          resolve({ pct: Math.min(pct, 100), playing: state === 'playing' });
        } catch (e) { resolve({ pct: 0, playing: false }); }
      });
    });
    req.on('error', () => resolve({ pct: 0, playing: false }));
    req.on('timeout', () => { req.destroy(); resolve({ pct: 0, playing: false }); });
  });
}

module.exports = {
  VLC_HTTP_PASSWORD,
  VLC_HTTP_PORT,
  vlcGetStatus,
};
