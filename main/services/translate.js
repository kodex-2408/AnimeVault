'use strict';

// main/services/translate.js - translates manga pages in the built-in reader.
//
// The page image goes to a Claude model on OpenRouter with Luma's key. The
// model finds the text on the page and answers with boxes (0-1000 of the page
// width and height) and their translations; the reader draws those boxes over
// the page. Translation is switched on per chapter, because every new page is
// a paid request. Results are kept per chapter in userData/translations, so
// reopening a chapter, or reading it again, costs nothing.

const { app, ipcMain, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const openrouter = require('../../openrouter');
const { config } = require('../state');
const reader = require('../players/reader');

const PROMPT_VERSION = 1;
const LANGS = ['English', 'Spanish', 'Portuguese', 'French', 'German', 'Italian', 'Indonesian', 'Vietnamese', 'Thai', 'Russian', 'Polish', 'Turkish', 'Arabic', 'Chinese (Simplified)', 'Korean', 'Japanese'];
const MODELS = { haiku: 'haiku-5.5', sonnet: 'sonnet-5.5' };
const KINDS = ['bubble', 'narration', 'sfx', 'sign'];
const MAX_EDGE = 1600;              // longest side sent to the model, in pixels
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_ITEMS = 80;
const MAX_CACHE_FILES = 400;
const MAX_PARALLEL = 2;

let _deps = {};
function setDeps(deps) { _deps = deps || {}; }
function cacheDir() { return _deps.cacheDir || path.join(app.getPath('userData'), 'translations'); }

function targetLang() { return LANGS.includes(config.translateLang) ? config.translateLang : 'English'; }
function modelChoice() { return config.translateModel === 'sonnet' ? 'sonnet' : 'haiku'; }

function buildPrompt(lang) {
  return [
    'You translate manga, manhwa and manhua pages into ' + lang + '.',
    'Find every piece of text on the page: speech bubbles, thought bubbles, narration boxes, signs and notes, and sound effects.',
    'For each one give its box on the page, measured from the top-left corner on a 0-1000 scale of the page width (x) and height (y), tight around the text or the bubble that holds it.',
    'Translate naturally, the way an official ' + lang + ' release would, keeping names, honorifics and tone. Read Japanese pages right to left, top to bottom; use the whole page as context.',
    'Skip text that is already in ' + lang + ', page numbers, and watermarks or scanlation credits.',
    'Answer with JSON only, no other text:',
    '{"items":[{"x0":0,"y0":0,"x1":0,"y1":0,"kind":"bubble|narration|sfx|sign","src":"original text","text":"translation"}]}',
    'in reading order. A page with no text: {"items":[]}.',
  ].join('\n');
}

// The model's answer, checked and clamped. Throws when no JSON is found.
function parseTranslation(text) {
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
    const box = Array.isArray(it.box) && it.box.length === 4 ? it.box : [it.x0, it.y0, it.x1, it.y1];
    let [x0, y0, x1, y1] = box.map(num);
    if ([x0, y0, x1, y1].some(v => v === null)) continue;
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (x1 - x0 < 4 || y1 - y0 < 4) continue;
    const t = String(it.text == null ? '' : it.text).replace(/\s+/g, ' ').trim().slice(0, 1000);
    if (!t) continue;
    out.push({
      x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1),
      kind: KINDS.includes(it.kind) ? it.kind : 'bubble',
      src: String(it.src == null ? '' : it.src).replace(/\s+/g, ' ').trim().slice(0, 1000),
      text: t,
    });
  }
  return out;
}

// ---- cache -------------------------------------------------------------------
// One file per chapter, named after the file's path, size and date, so an
// edited or replaced file starts over.
function chapterKey(filePath) {
  const st = fs.statSync(filePath);
  return crypto.createHash('sha1').update(path.resolve(filePath) + '\0' + st.size + '\0' + Math.round(st.mtimeMs)).digest('hex');
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

// ---- model -------------------------------------------------------------------
let _catalog = null;
async function modelId(choice) {
  if (choice === 'haiku' && config.lumaModel) return openrouter.safeModelId(config.lumaModel);
  if (!_catalog) _catalog = (_deps.listModelIds || openrouter.listModelIds)().then(ids => { if (!ids) _catalog = null; return ids; });
  const ids = await _catalog;
  if (!ids) return 'anthropic/claude-' + MODELS[choice];
  const id = openrouter.resolveClaudeModel(ids, MODELS[choice]);
  if (!id) throw Object.assign(new Error('OpenRouter doesn’t offer Claude ' + MODELS[choice].replace('-', ' ') + ' to this account right now'), { kind: 'other' });
  return id;
}

// A page as JPEG, at most MAX_EDGE on its longest side. Formats Electron
// can't decode (WebP, for one) go as they are when the model accepts them.
function prepareImage(buf) {
  const img = (_deps.nativeImage || nativeImage).createFromBuffer(buf);
  if (img && !img.isEmpty()) {
    const { width, height } = img.getSize();
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const out = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' }) : img;
    return { mime: 'image/jpeg', data: out.toJPEG(85) };
  }
  const mime = reader.sniffImageMime(buf);
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime) && buf.length <= 5 * 1024 * 1024) return { mime, data: buf };
  throw new Error('This page’s picture format can’t be translated');
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

// Translates one page. pdfImage: the page as the renderer drew it (PDF only).
async function translatePage(token, index, pdfImage) {
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
  const flight = key + '|' + pk;
  if (_inflight.has(flight)) return _inflight.get(flight);
  const job = (async () => {
    let buf;
    if (s.kind === 'pages') buf = await s.pages[index].read();
    else {
      if (!pdfImage || !(pdfImage instanceof Uint8Array) || pdfImage.length > MAX_IMAGE_BYTES) throw new Error('No picture of this page to translate');
      buf = Buffer.from(pdfImage.buffer, pdfImage.byteOffset, pdfImage.byteLength);
      if (!['image/jpeg', 'image/png'].includes(reader.sniffImageMime(buf))) throw new Error('No picture of this page to translate');
    }
    const image = prepareImage(buf);
    const model = await modelId(choice);
    const body = {
      model,
      max_tokens: 4096,
      temperature: 0.2,
      messages: [
        { role: 'system', content: buildPrompt(lang) },
        { role: 'user', content: [
          { type: 'text', text: 'Page ' + (index + 1) + '. Translate it into ' + lang + '.' },
          { type: 'image_url', image_url: { url: 'data:' + image.mime + ';base64,' + Buffer.from(image.data).toString('base64') } },
        ] },
      ],
    };
    await slot();
    let r;
    try { r = await (_deps.request || openrouter.requestOnce)(apiKey, body); } finally { release(); }
    if (!r.ok) throw Object.assign(new Error(r.message || 'OpenRouter request failed'), { kind: r.kind || 'other' });
    const items = parseTranslation(r.text);
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
  ipcMain.handle('translate:setEnabled', (_, token, on) => {
    try { return setEnabled(String(token || ''), on === true); } catch (e) { return false; }
  });
  ipcMain.handle('translate:page', async (_, token, index, pdfImage) => {
    try { return await translatePage(String(token || ''), index, pdfImage || null); } catch (e) { return { error: e.message, kind: e.kind || 'other' }; }
  });
}

module.exports = {
  LANGS,
  buildPrompt,
  chapterState,
  parseTranslation,
  register,
  setDeps,
  setEnabled,
  translatePage,
};
