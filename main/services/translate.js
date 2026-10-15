'use strict';

// main/services/translate.js - translates manga pages in the built-in reader.
//
// The reader (renderer/typeset.js) finds the speech balloons on a page and
// sends the page with them outlined and numbered. The model, a Claude model
// on OpenRouter with Tsumi's key, answers which balloon says what, and gives
// boxes (0-1000 of the page) only for text outside the numbered balloons.
// The reader then erases the original text and letters the translation in.
// Translation is switched on per chapter, because every new page is a paid
// request. Answers are kept per chapter in userData/translations, so
// reopening a chapter, or reading it again, costs nothing.

const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const openrouter = require('../../openrouter');
const { config } = require('../state');
const reader = require('../players/reader');

const PROMPT_VERSION = 3;          // bump when the prompt or the numbering of text changes
const LANGS = ['English', 'Spanish', 'Portuguese', 'French', 'German', 'Italian', 'Indonesian', 'Vietnamese', 'Thai', 'Russian', 'Polish', 'Turkish', 'Arabic', 'Chinese (Simplified)', 'Korean', 'Japanese'];
const MODELS = { haiku: 'haiku-5.5', sonnet: 'sonnet-5.5' };
const KINDS = ['bubble', 'narration', 'sfx', 'sign'];
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_ITEMS = 80;
const MAX_REGIONS = 80;
const MAX_CACHE_FILES = 400;
const MAX_PARALLEL = 2;

let _deps = {};
function setDeps(deps) { _deps = deps || {}; }
function cacheDir() { return _deps.cacheDir || path.join(app.getPath('userData'), 'translations'); }

function targetLang() { return LANGS.includes(config.translateLang) ? config.translateLang : 'English'; }
function modelChoice() { return config.useLuna === true ? 'luna' : config.translateModel === 'sonnet' ? 'sonnet' : 'haiku'; }

function buildPrompt(lang) {
  return [
    'You translate manga, manhwa and manhua pages into ' + lang + ' for a reader app that letters your translation into the page.',
    'The text the app found is outlined with red dashes and numbered on red tags: usually one box per speech balloon, caption or sign. The outlines and tags are not part of the page.',
    'For every numbered box that holds dialogue, thoughts, narration or a sign, give its number and the translation of the text inside it. Leave out boxes that hold only a sound effect, a page or chapter number, a watermark or credits, or no text.',
    'When one word or sentence is spread over several boxes (shouted a character or two per balloon, or a line continued in the next balloon), split the translation across those boxes in the order the page is read (panels right to left, then top to bottom; this can differ from the box numbers), so that read in that order it says the whole line, for example "LAUN-" / "DRY!!".',
    'Text the app missed (not inside any numbered box): give a box tight around the text itself, on a 0-1000 scale of the page width (x) and height (y) from the top-left corner.',
    'Translate the way an official ' + lang + ' release would: natural, in character, keeping names and honorifics. Use the whole page for context; Japanese reads right to left, top to bottom. Skip anything already in ' + lang + '.',
    'Keep each translation about as long as the original line is in spoken ' + lang + ', since it has to fit the same balloon. No notes or explanations.',
    'Answer with JSON only:',
    '{"items":[{"region":1,"src":"original text","text":"translation"},{"x0":0,"y0":0,"x1":0,"y1":0,"kind":"narration|sign|bubble","src":"original text","text":"translation"}]}',
    'A page with nothing to translate: {"items":[]}.',
  ].join('\n');
}

// The model's answer, checked and clamped. Throws when no JSON is found.
function parseTranslation(text, regions) {
  const byId = new Map((Array.isArray(regions) ? regions : []).map(r => [r.id, r]));
  let s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('The model did not answer with a translation');
  let j;
  try { j = JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new Error('The model sent a translation that could not be read'); }
  const list = Array.isArray(j) ? j : (j && Array.isArray(j.items) ? j.items : null);
  if (!list) throw new Error('The model sent a translation that could not be read');
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1000, n)) : null; };
  const out = [];
  for (const it of list) {
    if (out.length >= MAX_ITEMS) break;
    if (!it || typeof it !== 'object') continue;
    const t0 = String(it.text == null ? '' : it.text).replace(/\s+/g, ' ').trim().slice(0, 1000);
    const src0 = String(it.src == null ? '' : it.src).replace(/\s+/g, ' ').trim().slice(0, 1000);
    const rid = Number(it.region);
    if (it.region != null && Number.isInteger(rid) && byId.has(rid)) {
      if (!t0) continue;
      const r = byId.get(rid);
      out.push({ region: rid, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, kind: 'bubble', src: src0, text: t0 });
      continue;
    }
    const box = Array.isArray(it.box) && it.box.length === 4 ? it.box : [it.x0, it.y0, it.x1, it.y1];
    let [x0, y0, x1, y1] = box.map(num);
    if ([x0, y0, x1, y1].some(v => v === null)) continue;
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (x1 - x0 < 4 || y1 - y0 < 4) continue;
    if (!t0 || it.kind === 'sfx') continue;
    out.push({
      x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1),
      kind: KINDS.includes(it.kind) ? it.kind : 'bubble',
      src: src0,
      text: t0,
    });
  }
  return out;
}

// ---- cache -------------------------------------------------------------------
// One file per chapter. Its name comes from the file's size and first 64 KB,
// so renaming or moving a chapter (auto-rename, File Management, a new folder)
// keeps its translations, while a replaced file starts over. 5.11.1: before
// this, the name came from the full path and the date, and any rename lost
// the cache; such a file is adopted under the new name on first use.
const HEAD_BYTES = 64 * 1024;
const _keyMemo = new Map();
function legacyChapterKey(filePath, st) {
  return crypto.createHash('sha1').update(path.resolve(filePath) + '\0' + st.size + '\0' + Math.round(st.mtimeMs)).digest('hex');
}
function chapterKey(filePath) {
  const st = fs.statSync(filePath);
  const memo = path.resolve(filePath) + '\0' + st.size + '\0' + st.mtimeMs;
  if (_keyMemo.has(memo)) return _keyMemo.get(memo);
  const fd = fs.openSync(filePath, 'r');
  let head;
  try { head = Buffer.alloc(Math.min(HEAD_BYTES, st.size)); fs.readSync(fd, head, 0, head.length, 0); } finally { fs.closeSync(fd); }
  const key = crypto.createHash('sha1').update('v2\0' + st.size + '\0').update(head).digest('hex');
  try {
    const legacy = cachePath(legacyChapterKey(filePath, st));
    if (!fs.existsSync(cachePath(key)) && fs.existsSync(legacy)) fs.renameSync(legacy, cachePath(key));
  } catch (e) { /* best effort */ }
  if (_keyMemo.size > 500) _keyMemo.clear();
  _keyMemo.set(memo, key);
  return key;
}
function cachePath(key) { return path.join(cacheDir(), key + '.json'); }
function readCache(key) {
  try {
    const j = JSON.parse(fs.readFileSync(cachePath(key), 'utf8'));
    if (j && j.v === PROMPT_VERSION && j.pages && typeof j.pages === 'object') return j;
  } catch (e) { /* none yet, or unreadable: start over */ }
  return { v: PROMPT_VERSION, enabled: false, pages: {} };
}
function writeCache(key, data) {
  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = cachePath(key);
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
  pruneCache(dir);
}
function pruneCache(dir) {
  try {
    const files = fs.readdirSync(dir).filter(f => /^[a-f0-9]{40}\.json$/.test(f));
    if (files.length <= MAX_CACHE_FILES) return;
    files.map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => a.t - b.t)
      .slice(0, files.length - MAX_CACHE_FILES)
      .forEach(x => { try { fs.unlinkSync(path.join(dir, x.f)); } catch (e) { /* in use: next time */ } });
  } catch (e) { /* the cache is best effort */ }
}
function pageKey(index, lang, choice) { return index + '|' + lang + '|' + choice; }

// ---- finished pages ----------------------------------------------------------
// The lettered page itself (a JPEG), so reopening a chapter shows it at once
// instead of running the text detector, erasing and lettering again. One
// folder per chapter; the name carries the page, language, model and the
// renderer's lettering version. Oldest pages go first past MAX_PAGE_BYTES.
const MAX_PAGE_BYTES = 1536 * 1024 * 1024;
const MAX_PAGE_IMAGE = 12 * 1024 * 1024;
function pagesDir(key) { return path.join(cacheDir(), 'pages', key); }
function pageImageName(index, lang, choice, rv) {
  return Number(index) + '-' + crypto.createHash('sha1').update(lang + '|' + choice + '|' + String(rv || '')).digest('hex').slice(0, 12) + '.jpg';
}
function pageImagePath(token, index, rv) {
  const s = reader.getSession(token);
  if (!s || (s.kind !== 'pages' && s.kind !== 'pdf')) return null;
  index = Number(index);
  if (!Number.isInteger(index) || index < 0 || index > 99999) return null;
  return path.join(pagesDir(chapterKey(s.filePath)), pageImageName(index, targetLang(), modelChoice(), rv));
}
function readPageImage(token, index, rv) {
  const file = pageImagePath(token, index, rv);
  if (!file || !fs.existsSync(file)) return null;
  const now = new Date();
  try { fs.utimesSync(file, now, now); } catch (e) { /* only for pruning order */ }
  return fs.readFileSync(file);
}
function savePageImage(token, index, rv, bytes) {
  const file = pageImagePath(token, index, rv);
  if (!file || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_PAGE_IMAGE) return false;
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (reader.sniffImageMime(buf) !== 'image/jpeg') return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
  prunePages();
  return true;
}
let _pruneAt = 0;
function prunePages() {
  if (Date.now() - _pruneAt < 60 * 1000) return;
  _pruneAt = Date.now();
  try {
    const root = path.join(cacheDir(), 'pages');
    const all = [];
    for (const d of fs.readdirSync(root)) {
      const dir = path.join(root, d);
      for (const f of fs.readdirSync(dir)) { const st = fs.statSync(path.join(dir, f)); all.push({ file: path.join(dir, f), size: st.size, t: st.mtimeMs }); }
    }
    let total = all.reduce((n, x) => n + x.size, 0);
    all.sort((a, b) => a.t - b.t);
    for (const x of all) { if (total <= MAX_PAGE_BYTES) break; try { fs.unlinkSync(x.file); total -= x.size; } catch (e) { /* in use */ } }
  } catch (e) { /* best effort */ }
}

// ---- model -------------------------------------------------------------------
// ---- text detector model -------------------------------------------------------
// comic-text-detector (dmMaze, GPL-3.0), as exported to ONNX by
// manga-image-translator. Not shipped with the app: downloaded once, on first
// use, into userData/models and checked against its SHA-256.
const DETECTOR = {
  file: 'comictextdetector.onnx',
  url: 'https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.3/comictextdetector.pt.onnx',
  size: 94669756,
  sha256: '1a86ace74961413cbd650002e7bb4dcec4980ffa21b2f19b86933372071d718f',
};
function detectorPath() { return path.join(_deps.modelDir || path.join(app.getPath('userData'), 'models'), DETECTOR.file); }
let _detectorJob = null;
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}
function download(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const req = (_deps.https || https).get(url, { headers: { 'User-Agent': 'Tsundoku' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, dest, onProgress, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const total = Number(res.headers['content-length']) || DETECTOR.size;
      let got = 0, last = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => {
        got += c.length;
        if (got - last > 2 * 1024 * 1024) { last = got; onProgress(got / total); }
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('The download stalled')));
  });
}
// The model's bytes, downloading it first if needed. onProgress(0..1).
function detectorModel(onProgress = () => {}) {
  const file = detectorPath();
  if (fs.existsSync(file) && fs.statSync(file).size === DETECTOR.size) return Promise.resolve(fs.readFileSync(file));
  if (!_detectorJob) {
    _detectorJob = (async () => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.part';
      try {
        await download(DETECTOR.url, tmp, onProgress);
        const sum = await sha256File(tmp);
        if (sum !== DETECTOR.sha256) throw new Error('The downloaded text detector is damaged');
        fs.renameSync(tmp, file);
      } finally {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) { /* in use: next time */ }
      }
      return fs.readFileSync(file);
    })();
    _detectorJob.catch(() => {}).then(() => { _detectorJob = null; });
  }
  return _detectorJob;
}

let _catalog = null;
async function modelId(choice) {
  if (choice === 'haiku' && config.lumaModel) return openrouter.safeModelId(config.lumaModel);
  if (!_catalog) _catalog = (_deps.listModelIds || openrouter.listModelIds)().then(ids => { if (!ids) _catalog = null; return ids; });
  const ids = await _catalog;
  if (choice === 'luna') {
    if (ids && !ids.includes(openrouter.LUNA_MODEL)) throw Object.assign(new Error('OpenRouter doesn’t offer GPT-6 Luna to this account right now. Switch it off in Settings → Tsumi'), { kind: 'other' });
    return openrouter.LUNA_MODEL;
  }
  if (!ids) return 'anthropic/claude-' + MODELS[choice];
  const id = openrouter.resolveClaudeModel(ids, MODELS[choice]);
  if (!id) throw Object.assign(new Error('OpenRouter doesn’t offer Claude ' + MODELS[choice].replace('-', ' ') + ' to this account right now'), { kind: 'other' });
  return id;
}

// The numbered balloons the reader found: ids and boxes on the 0-1000 scale.
function cleanRegions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list.slice(0, MAX_REGIONS)) {
    if (!r || typeof r !== 'object') continue;
    const v = [r.id, r.x0, r.y0, r.x1, r.y1].map(Number);
    if (!v.every(Number.isFinite) || !Number.isInteger(v[0]) || v[0] < 1) continue;
    const [id, x0, y0, x1, y1] = [v[0], ...v.slice(1).map(n => Math.max(0, Math.min(1000, Math.round(n))))];
    if (x1 > x0 && y1 > y0) out.push({ id, x0, y0, x1, y1 });
  }
  return out;
}

let _running = 0;
const _waiting = [];
function slot() {
  if (_running < MAX_PARALLEL) { _running++; return Promise.resolve(); }
  return new Promise(res => _waiting.push(res));
}
function release() {
  const next = _waiting.shift();
  if (next) next(); else _running--;
}

const _inflight = new Map();

// Translates one page. page: {image, regions} from the reader: the page as a
// JPEG or PNG with the balloons numbered, and those balloons' boxes.
async function translatePage(token, index, page) {
  const s = reader.getSession(token);
  if (!s || (s.kind !== 'pages' && s.kind !== 'pdf')) throw new Error('This chapter is no longer open');
  index = Number(index);
  if (!Number.isInteger(index) || index < 0 || (s.kind === 'pages' && index >= s.pages.length)) throw new Error('No such page');
  const apiKey = String(config.openRouterApiKey || '');
  if (!apiKey) throw Object.assign(new Error('Add your OpenRouter key in Settings → Companion to translate pages'), { kind: 'key' });
  const lang = targetLang();
  const choice = modelChoice();
  const key = chapterKey(s.filePath);
  const pk = pageKey(index, lang, choice);
  const cached = readCache(key).pages[pk];
  if (cached) return { items: cached.items, cached: true };
  const image = page && page.image;
  if (!(image instanceof Uint8Array) || !image.length || image.length > MAX_IMAGE_BYTES) throw new Error('No picture of this page to translate');
  const buf = Buffer.from(image.buffer, image.byteOffset, image.byteLength);
  const mime = reader.sniffImageMime(buf);
  if (mime !== 'image/jpeg' && mime !== 'image/png') throw new Error('No picture of this page to translate');
  const regions = cleanRegions(page.regions);
  const flight = key + '|' + pk;
  if (_inflight.has(flight)) return _inflight.get(flight);
  const job = (async () => {
    const model = await modelId(choice);
    const ask = 'Page ' + (index + 1) + '. ' + (regions.length
      ? 'Numbered boxes: ' + regions.map(r => r.id).join(', ') + '.'
      : 'No text was found automatically; give boxes for all text.') + ' Translate into ' + lang + '.';
    const luna = choice === 'luna';
    const body = {
      model,
      // GPT-6 Luna reasons at medium effort, and its reasoning counts toward
      // max_tokens; it takes no temperature.
      max_tokens: luna ? openrouter.LUNA_MAX_TOKENS : 4096,
      ...(luna ? { reasoning: { ...openrouter.LUNA_REASONING, exclude: true } } : { temperature: 0.2 }),
      messages: [
        { role: 'system', content: buildPrompt(lang) },
        { role: 'user', content: [
          { type: 'text', text: ask },
          { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + buf.toString('base64') } },
        ] },
      ],
    };
    await slot();
    let r;
    try { r = await (_deps.request || openrouter.requestOnce)(apiKey, body); } finally { release(); }
    if (!r.ok) throw Object.assign(new Error(r.message || 'OpenRouter request failed'), { kind: r.kind || 'other' });
    const items = parseTranslation(r.text, regions);
    const data = readCache(key);
    data.pages[pk] = { items, at: Date.now() };
    data.file = path.basename(s.filePath);
    writeCache(key, data);
    return { items, cached: false };
  })();
  _inflight.set(flight, job);
  try { return await job; } finally { _inflight.delete(flight); }
}

// What the reader needs when a chapter opens: whether translation is on for
// it, and the pages already translated into the current language and model.
function chapterState(token) {
  const s = reader.getSession(token);
  const lang = targetLang();
  const choice = modelChoice();
  const res = { enabled: false, pages: {}, lang, model: choice, hasKey: !!config.openRouterApiKey, supported: !!s && (s.kind === 'pages' || s.kind === 'pdf') };
  if (!res.supported) return res;
  const data = readCache(chapterKey(s.filePath));
  res.enabled = !!data.enabled;
  const suffix = '|' + lang + '|' + choice;
  for (const k of Object.keys(data.pages)) {
    if (k.endsWith(suffix)) res.pages[k.slice(0, -suffix.length)] = data.pages[k].items;
  }
  return res;
}

function setEnabled(token, on) {
  const s = reader.getSession(token);
  if (!s || (s.kind !== 'pages' && s.kind !== 'pdf')) return false;
  const key = chapterKey(s.filePath);
  const data = readCache(key);
  data.enabled = !!on;
  data.file = path.basename(s.filePath);
  writeCache(key, data);
  return true;
}

function register() {
  ipcMain.handle('translate:state', (_, token) => {
    try { return chapterState(String(token || '')); } catch (e) { return { enabled: false, pages: {}, supported: false, error: e.message }; }
  });
  ipcMain.handle('translate:pageImage', (_, token, index, rv) => {
    try { return readPageImage(String(token || ''), index, String(rv || '')); } catch (e) { return null; }
  });
  ipcMain.handle('translate:savePageImage', (_, token, index, rv, bytes) => {
    try { return savePageImage(String(token || ''), index, String(rv || ''), bytes); } catch (e) { return false; }
  });
  ipcMain.handle('translate:setEnabled', (_, token, on) => {
    try { return setEnabled(String(token || ''), on === true); } catch (e) { return false; }
  });
  // The text detector's model (bytes), downloaded on first use; progress goes
  // to the window as translate:modelProgress (0..1).
  ipcMain.handle('translate:detectorModel', async (e) => {
    try {
      return await detectorModel((f) => { try { e.sender.send('translate:modelProgress', f); } catch (err) { /* window closed */ } });
    } catch (err) {
      return { error: 'The text detector could not be downloaded (' + (err.message || err) + ')' };
    }
  });
  ipcMain.handle('translate:page', async (_, token, index, page) => {
    try { return await translatePage(String(token || ''), index, page && typeof page === 'object' ? page : null); } catch (e) { return { error: e.message, kind: e.kind || 'other' }; }
  });
}

module.exports = {
  DETECTOR,
  LANGS,
  detectorModel,
  buildPrompt,
  chapterKey,
  chapterState,
  readPageImage,
  savePageImage,
  parseTranslation,
  register,
  setDeps,
  setEnabled,
  translatePage,
};
