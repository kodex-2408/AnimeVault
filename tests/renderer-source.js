'use strict';
// Loads the renderer the way Electron does: index.html plus every classic
// <script src> it references, in order. `combined` keeps the old single-file
// shape (HTML with the code inside one <script> block) for source-level checks.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const files = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
const sources = files.map(f => ({ file: f, source: fs.readFileSync(path.join(root, f), 'utf8') }));
const js = sources.map(s => s.source).join('\n');
const styleFiles = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map(m => m[1]);
const css = styleFiles.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const combined = html
  .replace('</head>', '<style>\n' + css + '\n</style>\n</head>')
  .replace('</body>', '<script>\n' + js + '\n</script>\n</body>');

module.exports = { root, html, files, sources, js, styleFiles, css, combined };
