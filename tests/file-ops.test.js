'use strict';

// file-ops.test.js
//
// Real move and placement code from main/ (extracted, run in a vm sandbox with
// the real fs) against a temp tree. Locks in:
//   - moves across drives (EXDEV) copy then delete, and never clobber
//   - a failed cross-drive copy leaves the source intact and no partial copy
//   - placing a new-series folder moves everything in it (subtitles, extras),
//     and merging into an existing folder never overwrites a file

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('./source-extract');
const mainSrc = require('./main-source').readMainSource();
let checks = 0;
const fn = (name) => { const c = extractFunction(mainSrc, name); assert(c, 'could not extract ' + name); return c; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'av-fileops-'));
const touch = (p, body) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body || path.basename(p)); };

// fs whose rename fails like a move between Windows drives.
let crossDrive = false;
let failCopy = false;
const fakeFs = Object.assign({}, fs, {
  renameSync: (a, b) => { if (crossDrive) { const e = new Error('EXDEV: cross-device link not permitted'); e.code = 'EXDEV'; throw e; } return fs.renameSync(a, b); },
  cpSync: (a, b, o) => { if (failCopy) { fs.writeFileSync(b, 'partial'); throw new Error('ENOSPC: no space left'); } return fs.cpSync(a, b, o); },
});
const handlers = {};
const config = { vaultMode: 'anime', folders: [{ path: path.join(tmp, 'lib') }], watcherDest: '' };
const ctx = vm.createContext({
  require, console, path, fs: fakeFs, config,
  ipcMain: { handle: (n, f) => { handlers[n] = f; } },
  isAllowedFileActionPath: () => true,
  assertPlayableMedia: () => {},
  getVideoFiles: () => [], getMangaFiles: () => [],
});
const placeSrc = (() => { const a = mainSrc.indexOf("ipcMain.handle('watcher:placeNewSeries'"); const b = mainSrc.indexOf('\n  });\n', a); return mainSrc.slice(a, b + 6); })();
vm.runInContext([fn('isSafeFileName'), fn('movePath'), fn('moveNoClobber'), placeSrc].join('\n\n'), ctx, { filename: 'main (extracted)' });

try {
  // ---- cross-drive moves
  touch(path.join(tmp, 'C', 'Show - 01.mkv'), 'ep1');
  crossDrive = true;
  fs.mkdirSync(path.join(tmp, 'D'), { recursive: true });
  ctx.moveNoClobber(path.join(tmp, 'C', 'Show - 01.mkv'), path.join(tmp, 'D', 'Show - 01.mkv'));
  assert.strictEqual(fs.readFileSync(path.join(tmp, 'D', 'Show - 01.mkv'), 'utf8'), 'ep1', 'file copied across drives'); checks++;
  assert(!fs.existsSync(path.join(tmp, 'C', 'Show - 01.mkv')), 'source removed after the copy'); checks++;

  touch(path.join(tmp, 'C', 'Folder', 'a.mkv')); touch(path.join(tmp, 'C', 'Folder', 'Subs', 'a.ass'));
  ctx.moveNoClobber(path.join(tmp, 'C', 'Folder'), path.join(tmp, 'D', 'Folder'));
  assert(fs.existsSync(path.join(tmp, 'D', 'Folder', 'Subs', 'a.ass')) && !fs.existsSync(path.join(tmp, 'C', 'Folder')), 'folders move across drives with their subfolders'); checks++;

  touch(path.join(tmp, 'C', 'b.mkv'), 'mine'); touch(path.join(tmp, 'D', 'b.mkv'), 'theirs');
  assert.throws(() => ctx.moveNoClobber(path.join(tmp, 'C', 'b.mkv'), path.join(tmp, 'D', 'b.mkv')), /overwrite/); checks++;
  assert.strictEqual(fs.readFileSync(path.join(tmp, 'D', 'b.mkv'), 'utf8'), 'theirs', 'destination untouched'); checks++;

  failCopy = true;
  touch(path.join(tmp, 'C', 'c.mkv'), 'keep');
  assert.throws(() => ctx.moveNoClobber(path.join(tmp, 'C', 'c.mkv'), path.join(tmp, 'D', 'c.mkv')), /ENOSPC/); checks++;
  assert(fs.existsSync(path.join(tmp, 'C', 'c.mkv')) && !fs.existsSync(path.join(tmp, 'D', 'c.mkv')), 'failed copy: source kept, partial copy removed'); checks++;
  failCopy = false; crossDrive = false;

  // ---- placing a new-series folder
  const lib = path.join(tmp, 'lib');
  const dl = path.join(tmp, 'downloads', 'Odd Taxi');
  touch(path.join(dl, 'Odd Taxi - 01.mkv')); touch(path.join(dl, 'Odd Taxi - 01.ass')); touch(path.join(dl, 'Extras', 'NCOP.mkv'));
  let r = JSON.parse(JSON.stringify(handlers['watcher:placeNewSeries'](null, { series: 'Odd Taxi', originalPath: dl, isFolder: true }, lib)));
  assert.strictEqual(r.success, true, JSON.stringify(r)); checks++;
  assert(fs.existsSync(path.join(lib, 'Odd Taxi', 'Odd Taxi - 01.ass')) && fs.existsSync(path.join(lib, 'Odd Taxi', 'Extras', 'NCOP.mkv')), 'the whole folder moved, subtitles and extras included'); checks++;
  assert(!fs.existsSync(dl), 'nothing left behind'); checks++;

  // merging into an existing series folder
  const dl2 = path.join(tmp, 'downloads', 'Odd Taxi 2');
  touch(path.join(dl2, 'Odd Taxi - 02.mkv')); touch(path.join(dl2, 'Odd Taxi - 02.ass')); touch(path.join(dl2, 'Odd Taxi - 01.mkv'), 'dupe');
  r = JSON.parse(JSON.stringify(handlers['watcher:placeNewSeries'](null, { series: 'Odd Taxi', originalPath: dl2, isFolder: true }, lib)));
  assert.deepStrictEqual([r.success, r.merged, r.moved, r.skipped], [true, true, 2, ['Odd Taxi - 01.mkv']], 'merge moves new files and skips existing ones'); checks++;
  assert.strictEqual(fs.readFileSync(path.join(lib, 'Odd Taxi', 'Odd Taxi - 01.mkv'), 'utf8'), 'Odd Taxi - 01.mkv', 'existing episode not overwritten'); checks++;
  assert(fs.existsSync(path.join(lib, 'Odd Taxi', 'Odd Taxi - 02.ass')), 'subtitles merged too'); checks++;

  console.log('file-ops checks passed: ' + checks + ' assertions (cross-drive moves, failed copies, folder placement and merge)');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
