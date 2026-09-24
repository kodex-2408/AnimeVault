'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

const invokes = [...preload.matchAll(/invoke\(['"]([^'"]+)['"]/g)].map(match => match[1]);
const handlers = new Set([...main.matchAll(/ipcMain\.handle\(['"]([^'"]+)['"]/g)].map(match => match[1]));
const missing = [...new Set(invokes)].filter(channel => !handlers.has(channel));
assert.deepStrictEqual(missing, [], `missing IPC handlers: ${missing.join(', ')}`);

const renderer = require('./renderer-source');

// No inline code anywhere: the CSP forbids it and every handler goes through
// the delegated data-act dispatcher.
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(source => source.trim());
assert.strictEqual(inlineScripts.length, 0, 'index.html must not contain inline scripts');
const inlineHandlerRe = /\son(click|change|input|keydown|keyup|keypress|submit|mouse\w+|contextmenu|focus|blur|load|error|drag\w*|drop|wheel|scroll)\s*=/i;
assert.ok(!inlineHandlerRe.test(html), 'index.html must not use inline on* handlers');
renderer.sources.forEach(({ file, source }) => {
  new vm.Script(source, { filename: file });
  assert.ok(!/\son(click|change|input|keydown|contextmenu|mouse\w+)\s*=\s*\\?["']/i.test(source), file + ' must not generate inline on* handlers');
});
assert.ok(renderer.files.length >= 10, 'renderer scripts must be referenced from index.html');

const csp = (html.match(/Content-Security-Policy"\s+content="([^"]+)"/) || [])[1] || '';
const scriptSrc = (csp.match(/script-src([^;]*)/) || [])[1] || '';
assert.ok(scriptSrc.includes("'self'"), 'CSP must allow self-hosted scripts');
assert.ok(!/unsafe-inline|unsafe-eval/.test(scriptSrc), 'CSP script-src must not allow inline or eval');
assert.ok(/object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp), 'CSP must lock down object-src and base-uri');

// Every file the renderer loads must be packaged.
const buildFiles = (pkg.build && pkg.build.files) || [];
['theme-boot.js', 'renderer/**/*', 'styles/**/*'].forEach(f => assert.ok(buildFiles.includes(f), 'package build.files must include ' + f));

assert.strictEqual(lock.version, pkg.version, 'package-lock top-level version must match package.json');
assert.strictEqual(lock.packages[''].version, pkg.version, 'package-lock root package version must match package.json');
console.log(`contract checks passed: ${new Set(invokes).size} IPC channels, ${renderer.files.length} renderer scripts, no inline code`);
