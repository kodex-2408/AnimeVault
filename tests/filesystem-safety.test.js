'use strict';

// filesystem-safety.test.js
//
// Runs the REAL path-safety helpers and File Management handlers from main.js
// (extracted from source, executed in a vm sandbox with real fs) against a
// throwaway folder tree. Locks in:
//   - containment survives symlinks/junctions that point outside a library
//   - system/home/app folders can never become library roots
//   - organizer moves never overwrite, and Ungroup only touches one folder
//   - every organizer run is undoable, and the UI's result contract holds
//   - renderer config writes cannot set credentials or bogus program paths

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('./source-extract');

const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
let checks = 0;

function fn(name) {
  const code = extractFunction(mainSrc, name);
  assert(code, 'could not extract ' + name + ' from main.js');
  return code;
}
function constLine(name) {
  const m = mainSrc.match(new RegExp('^const ' + name + ' = [\\s\\S]*?;$', 'm'));
  assert(m, 'could not extract const ' + name);
  return m[0];
}
function between(startMarker, endMarker) {
  const a = mainSrc.indexOf(startMarker);
  const b = mainSrc.indexOf(endMarker, a);
  assert(a > -1 && b > a, 'could not extract block starting ' + startMarker);
  return mainSrc.slice(a, b);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'av-fs-safety-'));
const userData = path.join(tmp, 'userData');
const lib = path.join(tmp, 'library');
const outside = path.join(tmp, 'outside');
[userData, lib, outside].forEach(d => fs.mkdirSync(d, { recursive: true }));
const touch = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, path.basename(p)); };

const handlers = {};
const config = { vaultMode: 'anime', folders: [{ path: lib }], mangaFolders: [], watcherFolder: '', watcherDest: '' };
const ctx = vm.createContext({
  require, console, path, fs, process, config,
  app: { getPath: (k) => (k === 'userData' ? userData : tmp) },
  ipcMain: { handle: (name, f) => { handlers[name] = f; } },
});

const code = [
  constLine('VIDEO_EXTS'), constLine('MANGA_EXTS'), constLine('RELEASE_META_STRIP'),
  constLine('RENDERER_CLEAR_ONLY_KEYS'),
  ...['normalizeFsPath', 'isInsidePath', 'realpathLoose', 'isForbiddenRoot', 'getAllowedFileRoots',
    'isAllowedFileActionPath', 'assertAllowedFileActionPath', 'assertAllowedChildFileActionPath',
    'isSafeFileName', 'moveNoClobber', 'isServableUserDataImage', 'isValidExecutableSetting',
    'validateRendererConfigValue', 'assertPlayableMedia', 'getVideoFiles', 'getMangaFiles',
    'cleanTitle', 'cleanFolderName', 'detectResolution', 'stripReleaseMetadata', 'extractSeriesName',
    'parseVideoFilename', 'parseMangaFilename', 'parseEpisodeNumber', 'parseChapterNumber'].map(fn),
  between('// ---- Organizer undo log', "ipcMain.handle('manager:hasUndo'"),
].join('\n\n');
vm.runInContext(code, ctx, { filename: 'main.js (extracted)' });
const run = (src) => vm.runInContext(src, ctx);
// Values created inside the vm have another realm's prototypes.
const plain = (v) => JSON.parse(JSON.stringify(v));

(async () => {
  // ------------------------------------------------------------ containment
  touch(path.join(lib, 'Show', 'Show - 01.mkv'));
  touch(path.join(outside, 'secret.mkv'));
  let linked = true;
  try { fs.symlinkSync(outside, path.join(lib, 'Escape'), 'junction'); } catch (e) { linked = false; }
  ctx.probe = path.join(lib, 'Show', 'Show - 01.mkv');
  assert.strictEqual(run('isAllowedFileActionPath(probe)'), true); checks++;
  ctx.probe = path.join(outside, 'secret.mkv');
  assert.strictEqual(run('isAllowedFileActionPath(probe)'), false); checks++;
  ctx.probe = path.join(lib, '..', 'outside', 'secret.mkv');
  assert.strictEqual(run('isAllowedFileActionPath(probe)'), false, '.. traversal must not escape'); checks++;
  if (linked) {
    ctx.probe = path.join(lib, 'Escape', 'secret.mkv');
    assert.strictEqual(run('isAllowedFileActionPath(probe)'), false, 'a junction out of the library must not count as inside'); checks++;
    ctx.probe = path.join(lib, 'Escape');
    assert.throws(() => run('assertAllowedChildFileActionPath(probe)'), /outside/); checks++;
  }
  ctx.probe = lib;
  assert.throws(() => run('assertAllowedChildFileActionPath(probe)'), /outside/, 'the root itself is never a deletable child'); checks++;
  ctx.probe = path.join(lib, 'Show');
  run('assertAllowedChildFileActionPath(probe)'); checks++;

  // ------------------------------------------------------- forbidden roots
  for (const p of [os.homedir(), path.parse(os.homedir()).root, userData, path.join(userData, 'x'), path.dirname(process.execPath)]) {
    ctx.probe = p;
    assert.strictEqual(run('isForbiddenRoot(probe)'), true, 'must be forbidden: ' + p); checks++;
  }
  ctx.probe = lib;
  assert.strictEqual(run('isForbiddenRoot(probe)'), false); checks++;
  config.folders.push({ path: os.homedir() });
  ctx.probe = path.join(os.homedir(), 'anything.mkv');
  assert.strictEqual(run('isAllowedFileActionPath(probe)'), false, 'a home-folder root must be ignored even if stored'); checks++;
  config.folders.pop();

  // -------------------------------------------------------------- names
  const names = { 'Frieren': true, 'Show S2': true, '..': false, '.': false, '': false, 'a/b': false, 'a\\b': false,
    'CON': false, 'nul.txt': false, 'trailing.': false, 'trailing ': false, 'a:b': false, ['x'.repeat(241)]: false };
  for (const [name, ok] of Object.entries(names)) {
    ctx.probe = name;
    assert.strictEqual(run('isSafeFileName(probe)'), ok, 'isSafeFileName(' + JSON.stringify(name.slice(0, 20)) + ')'); checks++;
  }

  // ---------------------------------------------------- userData images
  for (const [rel, ok] of [['cover-cache/a.jpg', true], ['thumbnails/s/ep_001.jpg', true], ['config.json', false], ['cover-cache-evil/a.jpg', false], ['cover-cache.jpg', false]]) {
    ctx.probe = path.join(userData, rel);
    assert.strictEqual(run('isServableUserDataImage(probe)'), ok, 'servable ' + rel); checks++;
  }

  // ------------------------------------------------ renderer config writes
  assert.throws(() => run("validateRendererConfigValue('malAccessToken', 'stolen')"), /Credentials/); checks++;
  assert.throws(() => run("validateRendererConfigValue('malRefreshToken', 'x')"), /Credentials/); checks++;
  run("validateRendererConfigValue('malAccessToken', '')"); checks++;
  run("validateRendererConfigValue('malTokenExpiry', 0)"); checks++;
  assert.throws(() => run("validateRendererConfigValue('vlcPath', 'vlc.exe')"), /program path/); checks++;
  run("validateRendererConfigValue('vlcPath', '')"); checks++;
  ctx.probe = [{ path: os.homedir() }];
  assert.throws(() => run("validateRendererConfigValue('folders', probe)"), /library folder/); checks++;
  ctx.probe = [{ path: 'relative/dir' }];
  assert.throws(() => run("validateRendererConfigValue('folders', probe)"), /absolute/); checks++;
  ctx.probe = [{ path: lib }];
  run("validateRendererConfigValue('folders', probe)"); checks++;

  // ------------------------------------------------------ moveNoClobber
  touch(path.join(lib, 'a.mkv')); touch(path.join(lib, 'b.mkv'));
  ctx.from = path.join(lib, 'a.mkv'); ctx.to = path.join(lib, 'b.mkv');
  assert.throws(() => run('moveNoClobber(from, to)'), /overwrite/); checks++;
  assert.strictEqual(fs.readFileSync(path.join(lib, 'b.mkv'), 'utf8'), 'b.mkv', 'destination must be untouched'); checks++;
  fs.unlinkSync(path.join(lib, 'a.mkv')); fs.unlinkSync(path.join(lib, 'b.mkv'));

  // ------------------------------------- Ungroup touches only its folder
  touch(path.join(lib, 'Group', 'Alpha - 01.mkv'));
  touch(path.join(lib, 'Group', 'Alpha - 02.mkv'));
  touch(path.join(lib, 'Sibling', 'Beta - 01.mkv'));
  touch(path.join(lib, 'Alpha - 02.mkv')); // collision in the parent
  let r = await handlers['manager:ungroup'](null, lib, path.join(lib, 'Group'), false);
  assert(!r.error, r.error); checks++;
  assert.deepStrictEqual(plain(r.results.map(x => x.status)).sort(), ['already exists in parent', 'moved']); checks++;
  assert(fs.existsSync(path.join(lib, 'Alpha - 01.mkv'))); checks++;
  assert(fs.existsSync(path.join(lib, 'Sibling', 'Beta - 01.mkv')), 'sibling folders must never be flattened'); checks++;
  assert(fs.existsSync(path.join(lib, 'Group', 'Alpha - 02.mkv')), 'colliding file stays put'); checks++;
  r = await handlers['manager:ungroup'](null, path.join(lib, 'Sibling'), path.join(lib, 'Group'), false);
  assert(/Parent folder/.test(r.error || ''), 'a mismatched parent is rejected'); checks++;

  // -------------------------------- Undo reverses exactly the last run
  r = await handlers['manager:undoFormat']();
  assert(!r.error, r.error); checks++;
  assert.deepStrictEqual(plain(r.results.map(x => x.status)), ['restored']); checks++;
  assert(fs.existsSync(path.join(lib, 'Group', 'Alpha - 01.mkv')) && !fs.existsSync(path.join(lib, 'Alpha - 01.mkv'))); checks++;

  // --------------------------------------------- Format loose files
  const loose = path.join(lib, 'Downloads');
  touch(path.join(loose, '[SubsPlease] Dandadan - 05 (1080p) [ABCD1234].mkv'));
  touch(path.join(loose, 'random notes.mkv'));
  r = await handlers['manager:format'](null, loose, loose);
  assert(!r.error, r.error); checks++;
  const formatted = r.results.find(x => x.status === 'formatted');
  assert(formatted && formatted.series === 'Dandadan' && /^Dandadan - 05 \(1080p\)/.test(formatted.newName), JSON.stringify(r.results)); checks++;
  assert(fs.existsSync(path.join(loose, 'Dandadan', formatted.newName))); checks++;
  assert(r.results.some(x => x.file === 'random notes.mkv' && x.status !== 'formatted')); checks++;
  r = await handlers['manager:undoFormat']();
  assert(fs.existsSync(path.join(loose, '[SubsPlease] Dandadan - 05 (1080p) [ABCD1234].mkv')), 'undo restores the original name'); checks++;

  // --------------------------------- Rename inside a folder (+ folder)
  const messy = path.join(lib, '[Group] Mushishi [BD 1080p]');
  touch(path.join(messy, 'Mushishi - 01 [1080p].mkv'));
  touch(path.join(messy, 'Mushishi - 02 [1080p].mkv'));
  r = await handlers['manager:formatFolder'](null, messy, 'Mushishi');
  assert(r.success, r.error); checks++;
  assert.strictEqual(r.results.filter(x => x.status === 'renamed').length, 3, JSON.stringify(r.results)); checks++;
  assert(fs.existsSync(path.join(lib, 'Mushishi', 'Mushishi - 01 (1080p) (H.264).mkv'))); checks++;
  r = await handlers['manager:formatFolder'](null, path.join(lib, 'Mushishi'), '..');
  assert(!r.success && /Invalid folder name/.test(r.error)); checks++;
  r = await handlers['manager:undoFormat']();
  assert(fs.existsSync(path.join(messy, 'Mushishi - 01 [1080p].mkv')), 'undo restores files and the folder name'); checks++;

  // -------------------------------------------------- Batch (dry run)
  r = await handlers['manager:batch'](null, lib, true);
  assert(!r.error, r.error); checks++;
  assert(r.results.every(x => x.status === 'preview' || x.status === 'no episode number'), 'dry run only previews: ' + JSON.stringify(r.results)); checks++;
  assert(fs.existsSync(path.join(messy, 'Mushishi - 01 [1080p].mkv')), 'dry run must not touch disk'); checks++;

  // ------------------------------------------- outside roots rejected
  r = await handlers['manager:format'](null, outside, outside);
  assert(/outside/.test(r.error || '')); checks++;
  r = await handlers['manager:formatFolder'](null, outside, 'x');
  assert(!r.success && /outside/.test(r.error)); checks++;

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('filesystem-safety checks passed: ' + checks + ' assertions (containment, roots, names, organizer, undo)');
})().catch(e => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} console.error(e); process.exit(1); });
