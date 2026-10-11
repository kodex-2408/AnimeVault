'use strict';

// main/players/readerTimer.js - marks a manga chapter read once it has been
// open in an external reader (CDisplayEx, SumatraPDF, Honeyview, OpenComic,
// calibre, the system default app...) for a minimum reading time.
//
// None of these readers report a page position, so the app watches window
// titles instead (Windows `tasklist /v`). Most readers put the file name in
// the title; while it is there the chapter counts as open, and switching to
// the next file inside the reader starts timing that chapter. A reader that
// never shows the file name is timed by its process instead: the chapter
// counts as open while the reader program is running.

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { state, config } = require('../state');
const { MANGA_EXTS, escapeRegExp, parseChapterNumber } = require('../scanner/parsers');

const POLL_MS = 5000;
const START_GRACE_MS = 30 * 1000;   // reader never appeared: stop watching
const DEFAULT_SECONDS = 120;

let session = null;
let pollTimer = null;
// Swappable for tests.
let listWindowsImpl = listWindows;

function readingSeconds() {
  const n = Number(config.readerTimerSeconds);
  return Number.isInteger(n) && n >= 15 && n <= 3600 ? n : DEFAULT_SECONDS;
}

// `tasklist /v /fo csv /nh` rows: "Image","PID","Session","#","Mem","Status","User","CPU","Title"
function parseTasklistCsv(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('"')) continue;
    const cols = t.slice(1, -1).split('","');
    if (cols.length < 2) continue;
    rows.push({ image: cols[0], pid: Number(cols[1]) || 0, title: cols.length >= 9 ? cols[cols.length - 1] : '' });
  }
  return rows;
}

function listWindows(imageName) {
  return new Promise((resolve) => {
    const args = ['/v', '/fo', 'csv', '/nh'];
    if (imageName) args.push('/fi', 'IMAGENAME eq ' + imageName);
    execFile('tasklist', args, { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : parseTasklistCsv(stdout));
    });
  });
}

// "001" must not match "Chapter 1001": the name has to stand on its own.
function titleMatcher(fileName) {
  const base = path.parse(String(fileName || '')).name;
  if (!base) return () => false;
  const re = new RegExp('(?<![\\p{L}\\p{N}])' + escapeRegExp(base) + '(?![\\p{L}\\p{N}])', 'iu');
  return (title) => !!title && re.test(title);
}

function sendMark(s) {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send('player:automark', {
      seriesName: s.seriesName, episodeNum: s.chapterNum, source: 'reader', seconds: Math.round(s.openMs / 1000)
    });
  }
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function endReaderSession() {
  stopPolling();
  session = null;
}

// Another chapter of the same series now in the reader's title, if any.
function siblingInTitles(s, rows) {
  let names;
  try {
    names = fs.readdirSync(path.dirname(s.filePath)).filter(n => MANGA_EXTS.includes(path.extname(n).toLowerCase()) && n !== s.fileName);
  } catch (e) { return null; }
  const titles = rows.filter(r => r.title && (!s.image || r.image.toLowerCase() === s.image.toLowerCase())).map(r => r.title);
  for (const n of names) {
    const match = titleMatcher(n);
    if (titles.some(match)) return n;
  }
  return null;
}

async function tick() {
  const s = session;
  if (!s || s.busy) return;
  s.busy = true;
  let rows;
  try { rows = await listWindowsImpl(s.image); } finally { s.busy = false; }
  if (session !== s) return;
  const now = Date.now();
  const dt = Math.min(now - s.lastTick, POLL_MS * 3);
  s.lastTick = now;
  if (!rows) return; // tasklist failed this time; try again next poll

  const hit = rows.find(r => s.matches(r.title));
  if (hit) {
    s.seenTitle = true;
    if (!s.image) s.image = hit.image; // system default app: now we know which one
  }
  const alive = s.image ? rows.some(r => r.image.toLowerCase() === s.image.toLowerCase()) : false;
  if (alive) s.seenProcess = true;
  const open = s.seenTitle ? !!hit : alive;

  if (open) {
    if (s.counting) s.openMs += dt;
    s.counting = true;
    if (!s.marked && s.openMs >= readingSeconds() * 1000) {
      s.marked = true;
      sendMark(s);
    }
    return;
  }

  if (!s.seenTitle && !s.seenProcess) {
    if (now - s.startedAt > START_GRACE_MS) endReaderSession();
    return;
  }
  // Closed, or the reader moved on to another file of this series.
  const next = s.seenTitle ? siblingInTitles(s, rows) : null;
  endReaderSession();
  if (next) {
    startReaderSession({ exePath: s.image, filePath: path.join(path.dirname(s.filePath), next), seriesName: s.seriesName, chapterNum: parseChapterNumber(next), imageOnly: true });
  }
}

// Starts timing a chapter. Returns true when it is being tracked, false when
// the caller should fall back to marking it read straight away.
function startReaderSession({ exePath, filePath, seriesName, chapterNum, imageOnly }) {
  endReaderSession();
  if (process.platform !== 'win32' && !module.exports._forceTracking) return false;
  if (config.readerTimerEnabled === false) return false;
  if (!seriesName || chapterNum == null || isNaN(chapterNum)) return false;
  const now = Date.now();
  session = {
    image: exePath ? (imageOnly ? exePath : path.win32.basename(exePath)) : null,
    filePath, fileName: path.basename(filePath), seriesName, chapterNum,
    matches: titleMatcher(path.basename(filePath)),
    startedAt: now, lastTick: now, openMs: 0, counting: false,
    seenTitle: false, seenProcess: false, marked: false, busy: false,
  };
  pollTimer = setInterval(() => { tick().catch(e => console.warn('[ReaderTimer]', e.message)); }, POLL_MS);
  if (pollTimer.unref) pollTimer.unref();
  return true;
}

module.exports = {
  DEFAULT_SECONDS,
  endReaderSession,
  parseTasklistCsv,
  readingSeconds,
  startReaderSession,
  titleMatcher,
  // test hooks
  _forceTracking: false,
  _setListWindows(fn) { listWindowsImpl = fn || listWindows; },
  _tick: tick,
  _session: () => session,
};
