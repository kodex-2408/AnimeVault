'use strict';

// Chapter display titles, auto-rename of new manga folders, the external
// reader timer and MyAnimeList progress -> checkmarks (with the sync-paused
// lock). Main-process modules are loaded for real with a stand-in `electron`;
// renderer functions are extracted from the shipped source.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const { extractFunction } = require('./source-extract');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'av-manga-'));
const userData = path.join(tmp, 'userData');
fs.mkdirSync(userData, { recursive: true });
const sent = [];
const electronStub = {
  app: { getPath: () => userData, isPackaged: false, getVersion: () => '0.0.0', on() {}, whenReady: () => Promise.resolve() },
  ipcMain: { handle() {}, on() {} },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openPath: async () => '' },
  BrowserWindow: function () {},
  net: {},
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  return origLoad.call(this, request, ...rest);
};

const { config, state } = require('../main/state');
const parsers = require('../main/scanner/parsers');
const timer = require('../main/players/readerTimer');
let checks = 0;

try {
  // ------------------------------------------------------------ display titles
  const title = (file, series) => parsers.mediaDisplayTitle(file, series, parsers.parseChapterNumber(file));
  const cases = [
    ['Chapter 1.cbz', 'Some Series', ''],
    ['001.cbz', 'Gyaru', ''],
    ['000 - Rhythm A.cbz', 'Gyaru', 'Rhythm A'],
    ['008 - The Type of Girl Who Makes You Fall.cbz', 'Gyaru', 'The Type of Girl Who Makes You Fall'],
    ['010.1 - The Two of Them After School.cbz', 'Gyaru', 'The Two of Them After School'],
    ['Smoking Behind the Supermarket with You - Chapter 27.cbz', 'Smoking Behind the Supermarket with You', ''],
    ['Smoking Behind the Supermarket with You - 27.5.cbz', 'Smoking Behind the Supermarket with You (2023)', ''],
    ['Super no Ura de Yani Suu Futari - Ch. 31.cbz', 'Smoking Behind the Supermarket with You', ''],
    ['Kaiju No. 8 v03 c012 - Defense Force.cbz', 'Kaiju No 8', 'Defense Force'],
    ['[Group] Chainsaw Man - 100 (Digital) (1r0n).cbz', 'Chainsaw Man', ''],
    ['016 - The Voice of Her Crush (Part 2).cbz', 'X', 'The Voice of Her Crush (Part 2)'],
  ];
  for (const [file, series, want] of cases) {
    assert.strictEqual(title(file, series), want, file); checks++;
  }
  const ep = (file, series) => parsers.mediaDisplayTitle(file, series, parsers.parseEpisodeNumber(file));
  assert.strictEqual(ep('[SubsPlease] Frieren - 05 (1080p) [ABCD1234].mkv', 'Frieren'), '', 'anime: tags and number only'); checks++;
  assert.strictEqual(ep('Frieren - S01E05 - Phantoms of the Dead.mkv', 'Frieren'), 'Phantoms of the Dead', 'anime: episode title kept'); checks++;
  assert.strictEqual(ep('A.Wild.Last.Boss.Appeared.S02E01.Mobile.Capital.Blutgang.1080p.CR.WEB-DL.JPN.AAC2.0.H.264.MSubs-ToonsHub.mkv', 'A Wild Last Boss Appeared S2'),
    'Mobile Capital Blutgang', 'scene name: release tags dropped, title kept'); checks++;

  // ------------------------------------------------------------ rename targets
  assert.strictEqual(parsers.mangaChapterFileName('008 - The Type of Girl.cbz', 'Gyaru'), 'Gyaru - Ch 008 - The Type of Girl.cbz'); checks++;
  assert.strictEqual(parsers.mangaChapterFileName('Chapter 1.cbz', 'Some Series'), 'Some Series - Ch 001.cbz'); checks++;
  assert.strictEqual(parsers.mangaChapterFileName('010.1 - Extra.cbz', 'Gyaru'), 'Gyaru - Ch 010.1 - Extra.cbz', 'decimal chapters'); checks++;
  assert.strictEqual(parsers.mangaChapterFileName('Kaiju.No.8.Vol.03.Ch.012.cbz', 'Kaiju No. 8'), 'Kaiju No. 8 - Vol 03 - Ch 012.cbz', 'volume kept'); checks++;
  assert.strictEqual(parsers.mangaChapterFileName('Chainsaw Man 012 - 100 Ways to Die.cbz', 'Chainsaw Man'), null, 'two candidate numbers: left alone'); checks++;
  assert.strictEqual(parsers.mangaChapterFileName('Oneshot.cbz', 'Oneshot'), null, 'no number: left alone'); checks++;
  for (const f of ['008 - The Type of Girl.cbz', '010.1 - Extra.cbz', 'Kaiju.No.8.Vol.03.Ch.012.cbz', 'Smoking Behind the Supermarket with You - 27.5.cbz']) {
    const out = parsers.mangaChapterFileName(f, 'Kaiju No. 8');
    assert.strictEqual(parsers.parseChapterNumber(out), parsers.parseChapterNumber(f), 'renamed file keeps its chapter number: ' + out); checks++;
    assert.strictEqual(parsers.mangaChapterFileName(out, 'Kaiju No. 8'), out, 'renaming is stable: ' + out); checks++;
  }
  // the watcher's import names keep titles too
  assert.strictEqual(parsers.parseMangaFilename('008 - The Type of Girl.cbz', 'Gyaru').newName, 'Gyaru - Ch 008 - The Type of Girl.cbz', 'watcher import keeps the title'); checks++;

  // ------------------------------------------------- auto-rename on first sight
  const lib = path.join(tmp, 'Manga');
  const oldSeries = path.join(lib, 'Old Series');
  fs.mkdirSync(oldSeries, { recursive: true });
  const past = new Date(Date.now() - 10 * 60 * 1000);
  const put = (p) => { fs.writeFileSync(p, 'x'); fs.utimesSync(p, past, past); };
  put(path.join(oldSeries, 'Chapter 1.cbz'));
  Object.assign(config, { vaultMode: 'manga', mangaFolders: [{ path: lib, type: 'series' }], folders: [], incrementalScan: false });
  delete config.mangaSeenSeries;
  const library = require('../main/scanner/library');
  const scan = () => library._doScanLibrary(true);
  let res = scan();
  assert(fs.existsSync(path.join(oldSeries, 'Chapter 1.cbz')), 'first scan only records the library'); checks++;
  assert(config.mangaSeenSeries && Object.keys(config.mangaSeenSeries).length === 2, 'one root and one series recorded'); checks++;
  assert.strictEqual(res[0].episodes[0].title, '', 'scan gives untitled chapters an empty title'); checks++;

  const newSeries = path.join(lib, 'Gyaru');
  fs.mkdirSync(newSeries);
  put(path.join(newSeries, '001.cbz'));
  put(path.join(newSeries, '008 - The Type of Girl.cbz'));
  fs.writeFileSync(path.join(newSeries, '009.cbz'), 'x'); // still being copied
  res = scan();
  const names = fs.readdirSync(newSeries).sort();
  assert.deepStrictEqual(names, ['009.cbz', 'Gyaru - Ch 001.cbz', 'Gyaru - Ch 008 - The Type of Girl.cbz'], 'new series renamed, busy file waits'); checks++;
  assert(fs.existsSync(path.join(oldSeries, 'Chapter 1.cbz')), 'known series untouched'); checks++;
  const g = res.find(s => s.name === 'Gyaru');
  assert.deepStrictEqual(g.episodes.map(e => e.title).sort(), ['', '', 'The Type of Girl']); checks++;
  const undo = JSON.parse(fs.readFileSync(path.join(userData, 'format-undo.json'), 'utf8'));
  assert.strictEqual(undo.moves.length, 2, 'renames recorded for Undo'); checks++;
  fs.utimesSync(path.join(newSeries, '009.cbz'), past, past);
  scan();
  assert(fs.existsSync(path.join(newSeries, 'Gyaru - Ch 009.cbz')), 'retried once the copy finished'); checks++;
  put(path.join(newSeries, '010.cbz'));
  scan();
  assert(fs.existsSync(path.join(newSeries, '010.cbz')), 'later chapters of a known series are left as they are'); checks++;
  // a whole existing collection added as a new library folder: recorded, not renamed
  const lib2 = path.join(tmp, 'Collection');
  fs.mkdirSync(path.join(lib2, 'Big Series'), { recursive: true });
  put(path.join(lib2, 'Big Series', '001.cbz'));
  config.mangaFolders.push({ path: lib2, type: 'series' });
  scan();
  assert(fs.existsSync(path.join(lib2, 'Big Series', '001.cbz')), 'newly added library folder is not renamed'); checks++;
  fs.mkdirSync(path.join(lib2, 'Next Series'));
  put(path.join(lib2, 'Next Series', '001.cbz'));
  scan();
  assert(fs.existsSync(path.join(lib2, 'Next Series', 'Next Series - Ch 001.cbz')), 'series arriving in it afterwards are'); checks++;
  config.mangaAutoRename = false;
  const third = path.join(lib, 'Third');
  fs.mkdirSync(third);
  put(path.join(third, '001.cbz'));
  scan();
  assert(fs.existsSync(path.join(third, '001.cbz')), 'setting off: nothing renamed'); checks++;
  delete config.mangaAutoRename;

  // ------------------------------------------------------------ reader timer
  const rows = timer.parseTasklistCsv('"CDisplayEx.exe","4120","Console","1","80,000 K","Running","PC\\\\me","0:00:03","008 - The Type of Girl.cbz - CDisplayEx"\r\nINFO: nothing\r\n');
  assert.deepStrictEqual(rows.map(r => [r.image, r.pid, r.title]), [['CDisplayEx.exe', 4120, '008 - The Type of Girl.cbz - CDisplayEx']]); checks++;
  const m = timer.titleMatcher('001.cbz');
  assert(m('001.cbz - SumatraPDF') && m('CDisplayEx - 001')); checks++;
  assert(!m('Chapter 1001 - SumatraPDF'), '"001" is not part of "1001"'); checks++;

  let now = 1e9;
  const realNow = Date.now;
  Date.now = () => now;
  timer._forceTracking = true;
  config.readerTimerSeconds = 60;
  const windows = [];
  timer._setListWindows(async () => windows.slice());
  state.mainWindow = { isDestroyed: () => false, webContents: { send: (ch, d) => sent.push([ch, d]) } };
  const chapterDir = path.join(tmp, 'Reader');
  fs.mkdirSync(chapterDir);
  for (const n of ['Gyaru - Ch 001.cbz', 'Gyaru - Ch 002.cbz']) fs.writeFileSync(path.join(chapterDir, n), 'x');
  const step = async (ms) => { now += ms; await timer._tick(); };
  (async () => {
    assert.strictEqual(timer.startReaderSession({ exePath: 'C:\\Program Files\\CDisplayEx\\CDisplayEx.exe', filePath: path.join(chapterDir, 'Gyaru - Ch 001.cbz'), seriesName: 'Gyaru', chapterNum: 1 }), true); checks++;
    windows.push({ image: 'CDisplayEx.exe', pid: 1, title: 'Gyaru - Ch 001.cbz - CDisplayEx' });
    for (let i = 0; i < 6; i++) await step(5000);
    assert.strictEqual(sent.length, 0, 'not marked before the reading time'); checks++;
    for (let i = 0; i < 8; i++) await step(5000);
    assert.deepStrictEqual(sent.map(s => [s[0], s[1].episodeNum, s[1].source]), [['player:automark', 1, 'reader']], 'marked after 60 s open'); checks++;
    // the reader moves on to chapter 2 by itself
    windows[0].title = 'Gyaru - Ch 002.cbz - CDisplayEx';
    await step(5000);
    assert.strictEqual(timer._session() && timer._session().chapterNum, 2, 'next file in the reader is timed too'); checks++;
    await step(5000); await step(5000);
    windows.length = 0; // closed after 10 s
    await step(5000);
    assert.strictEqual(timer._session(), null, 'closing ends the session'); checks++;
    assert.strictEqual(sent.length, 1, 'a 10 s peek is not a read'); checks++;
    // a reader that never shows the file name: timed by its process
    timer.startReaderSession({ exePath: 'C:\\calibre\\ebook-viewer.exe', filePath: path.join(chapterDir, 'Gyaru - Ch 002.cbz'), seriesName: 'Gyaru', chapterNum: 2 });
    windows.push({ image: 'ebook-viewer.exe', pid: 2, title: 'Gyaru' });
    for (let i = 0; i < 14; i++) await step(5000);
    assert.strictEqual(sent.length, 2, 'process-timed reader marks too'); checks++;
    timer.endReaderSession();
    config.readerTimerEnabled = false;
    assert.strictEqual(timer.startReaderSession({ exePath: null, filePath: path.join(chapterDir, 'Gyaru - Ch 001.cbz'), seriesName: 'Gyaru', chapterNum: 1 }), false, 'timer off: caller marks on open'); checks++;
    Date.now = realNow;

    // ---------------------------------------- MAL progress -> checkmarks (renderer)
    const dataSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'data.js'), 'utf8');
    const rctx = vm.createContext({ console, Set, Array, Math });
    vm.runInContext(['checkmarksLocked', 'localNumsUpTo', 'malEpisodeOffset'].map(n => extractFunction(dataSrc, n))
      .concat(['adoptMalProgress', 'tw'].map(n => 'async ' + extractFunction(dataSrc, n))).join('\n'), rctx);
    const calls = [];
    const series = (name, nums, watched, listStatus, total) => ({
      name, episodes: nums.map(n => ({ episodeNum: n })),
      watchData: { malId: 1, episodesWatched: watched, malData: { num_chapters: total || 0, my_list_status: listStatus } },
    });
    Object.assign(rctx, {
      S: { mal: true, cfg: { syncPaused: false }, lib: [
        series('Gyaru', [1, 2, 3, 4, 5], [1], { num_chapters_read: 3 }),
        series('Sequel', [13, 14, 15, 16], [], { num_chapters_read: 2 }, 12),
        series('Ahead', [1, 2, 3], [1, 2, 3], { num_chapters_read: 1 }),
      ], view: 'x' },
      getMyListStatus: (md) => md.my_list_status,
      epWatchedField: (ls) => ls.num_chapters_read || 0,
      totalField: (md) => md.num_chapters || 0,
      api: { setEpisodesWatched: async (name, list) => { calls.push([name, list.slice().sort((a, b) => a - b)]); return { episodesWatched: list }; } },
      _patchLibWatchData: (name, wd) => { rctx.S.lib.find(s => s.name === name).watchData.episodesWatched = wd.episodesWatched; },
      odtl() {}, render() {}, toast: (msg) => calls.push(['toast', msg]), toggleSync() {},
      lockedToast: () => calls.push(['locked']), autoSyncSeries: async () => {},
    });
    let n = await vm.runInContext('adoptMalProgress()', rctx);
    assert.strictEqual(n, 2); checks++;
    assert.deepStrictEqual(calls.slice(0, 2), [['Gyaru', [1, 2, 3]], ['Sequel', [13, 14]]], 'ticks up to MAL, sequel numbering shifted, never removes'); checks++;
    calls.length = 0;
    rctx.S.cfg.syncPaused = true;
    rctx.S.lib[0].watchData.malData.my_list_status = { num_chapters_read: 5 };
    n = await vm.runInContext('adoptMalProgress()', rctx);
    assert.strictEqual(n, 0, 'paused: MAL does not move checkmarks'); checks++;
    await vm.runInContext('tw("Gyaru", 4, false)', rctx);
    assert.deepStrictEqual(calls, [['locked']], 'paused: clicks are refused'); checks++;

    console.log('manga-reading checks passed: ' + checks + ' assertions (titles, renames, reading timer, MAL checkmarks)');
  })().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
    timer.endReaderSession();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
} catch (e) {
  fs.rmSync(tmp, { recursive: true, force: true });
  throw e;
}
