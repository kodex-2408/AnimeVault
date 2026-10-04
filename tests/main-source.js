'use strict';

// The main process is main.js plus the modules under main/. Tests that read
// or extract main-process source use this concatenation, so they keep working
// whichever module a function lives in.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function mainFiles() {
  const out = ['main.js'];
  const walk = (rel) => {
    for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel + '/' + ent.name;
      if (ent.isDirectory()) walk(r);
      else if (ent.name.endsWith('.js')) out.push(r);
    }
  };
  walk('main');
  return out;
}

function readMainSource() {
  return mainFiles().map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
}

module.exports = { mainFiles, readMainSource };
