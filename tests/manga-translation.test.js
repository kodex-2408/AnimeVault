'use strict';

// Manga translation in the built-in reader (main/services/translate.js): the
// model's answer is checked and clamped, pages are sent once and then served
// from the per-chapter cache, translation is switched on per chapter, and a
// missing key or a bad PDF picture never reaches OpenRouter. The main-process
// modules load for real with a stand-in `electron`; OpenRouter is faked.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tsundoku-tr-'));
const userData = path.join(tmp, 'userData');
const lib = path.join(tmp, 'Manga');
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(path.join(lib, 'Yotsuba'), { recursive: true });
const electronStub = {
  app: { getPath: () => userData, isPackaged: false, getVersion: () => '0.0.0', on() {}, whenReady: () => Promise.resolve() },
  ipcMain: { handle() {}, on() {} },
  safeStorage: { isEncryptionAvailable: () => false },
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
  shell: {},
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  return origLoad.call(this, request, ...rest);
};

const { config } = require('../main/state');
const reader = require('../main/players/reader');
const tr = require('../main/services/translate');
const openrouter = require('../openrouter');
let checks = 0;

// A 1x1 PNG, twice, as a two-page chapter.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const AdmZip = require('adm-zip');
const zip = new AdmZip();
zip.addFile('001.png', PNG);
zip.addFile('002.png', PNG);
const chapter = path.join(lib, 'Yotsuba', 'Yotsuba - Ch 001.cbz');
zip.writeZip(chapter);
config.mangaFolders = [{ path: lib }];
config.folders = [];

(async () => {
  // ------------------------------------------------------ the model's answer
  let items = tr.parseTranslation('```json\n{"items":[{"x0":900,"y0":50,"x1":700,"y1":300,"kind":"bubble","src":"おはよう","text":"Good  morning!"}]}\n```');
  assert.deepStrictEqual(items, [{ x0: 700, y0: 50, x1: 900, y1: 300, kind: 'bubble', src: 'おはよう', text: 'Good morning!' }]); checks++;
  items = tr.parseTranslation('Sure! {"items":[{"box":[-20,10,1200,90],"kind":"shout","text":"HEY"},{"x0":1,"y0":1,"x1":2,"y1":2,"text":"tiny"},{"x0":0,"y0":0,"x1":100,"y1":100,"text":"  "},{"x0":"a","y0":0,"x1":100,"y1":100,"text":"nan"}]}');
  assert.strictEqual(items.length, 1, 'tiny, empty and malformed boxes are dropped'); checks++;
  assert.deepStrictEqual([items[0].x0, items[0].x1, items[0].kind], [0, 1000, 'bubble'], 'boxes clamp to the page; unknown kinds become bubbles'); checks++;
  assert.deepStrictEqual(tr.parseTranslation('{"items":[]}'), []); checks++;
  assert.throws(() => tr.parseTranslation('I cannot read this page.'), /did not answer/); checks++;
  assert.throws(() => tr.parseTranslation('{"items": [oops]}'), /could not be read/); checks++;
  const many = { items: Array.from({ length: 200 }, (_, i) => ({ x0: 0, y0: 0, x1: 100, y1: 100, text: 't' + i })) };
  assert.strictEqual(tr.parseTranslation(JSON.stringify(many)).length, 80, 'at most 80 boxes per page'); checks++;
  assert(/into Spanish/.test(tr.buildPrompt('Spanish')) && /0-1000/.test(tr.buildPrompt('Spanish')), 'the prompt names the language and the box scale'); checks++;

  // --------------------------------------------------------- model choice
  assert.strictEqual(openrouter.resolveClaudeModel(['anthropic/claude-sonnet-5.5', 'x'], 'sonnet-5.5'), 'anthropic/claude-sonnet-5.5'); checks++;
  assert.strictEqual(openrouter.resolveClaudeModel(['anthropic/claude-sonnet-5-5:beta'], 'sonnet-5.5'), 'anthropic/claude-sonnet-5-5:beta'); checks++;
  assert.strictEqual(openrouter.resolveClaudeModel(['anthropic/claude-haiku-5.5'], 'sonnet-5.5'), null); checks++;

  // ------------------------------------------------------- translating pages
  const calls = [];
  tr.setDeps({
    cacheDir: path.join(userData, 'translations'),
    listModelIds: async () => ['anthropic/claude-haiku-5.5', 'anthropic/claude-sonnet-5.5'],
    request: async (key, body) => {
      calls.push(body);
      await new Promise(r => setTimeout(r, 20));
      return { ok: true, text: '{"items":[{"x0":100,"y0":100,"x1":400,"y1":300,"kind":"bubble","text":"Hello (' + body.model + ')"}]}' };
    },
  });
  const open = await reader.openChapter(chapter);
  assert.strictEqual(open.kind, 'pages'); checks++;

  config.openRouterApiKey = '';
  await assert.rejects(tr.translatePage(open.token, 0), /OpenRouter key/, 'no key: nothing is sent'); checks++;
  assert.strictEqual(calls.length, 0); checks++;

  config.openRouterApiKey = 'sk-or-v1-test-test-test-test';
  config.lumaModel = 'anthropic/claude-haiku-5.5';
  let st = tr.chapterState(open.token);
  assert.deepStrictEqual([st.supported, st.enabled, st.lang, st.model, st.hasKey], [true, false, 'English', 'haiku', true]); checks++;

  const [a, b] = await Promise.all([tr.translatePage(open.token, 0), tr.translatePage(open.token, 0)]);
  assert.strictEqual(calls.length, 1, 'the same page asked twice at once is sent once'); checks++;
  assert.deepStrictEqual(a, b); checks++;
  assert.strictEqual(a.items[0].text, 'Hello (anthropic/claude-haiku-5.5)'); checks++;
  const sentBody = calls[0];
  assert.strictEqual(sentBody.messages[1].content[1].image_url.url.slice(0, 22), 'data:image/png;base64,', 'the page picture goes with the request'); checks++;
  assert(/into English/.test(sentBody.messages[0].content)); checks++;

  const again = await tr.translatePage(open.token, 0);
  assert.strictEqual(calls.length, 1, 'a translated page is served from the cache'); checks++;
  assert.strictEqual(again.cached, true); checks++;
  await assert.rejects(tr.translatePage(open.token, 2), /No such page/); checks++;
  await assert.rejects(tr.translatePage('ffffffffffffffffffffffff', 0), /no longer open/); checks++;

  // switched on per chapter, and remembered
  assert.strictEqual(tr.setEnabled(open.token, true), true); checks++;
  const reopened = await reader.openChapter(chapter);
  st = tr.chapterState(reopened.token);
  assert.strictEqual(st.enabled, true, 'translation stays on for this chapter'); checks++;
  assert.deepStrictEqual(Object.keys(st.pages), ['0'], 'the translated page comes back with the chapter'); checks++;

  // another language or model is its own set of pages
  config.translateLang = 'Spanish';
  config.translateModel = 'sonnet';
  st = tr.chapterState(reopened.token);
  assert.deepStrictEqual([st.lang, st.model, Object.keys(st.pages).length], ['Spanish', 'sonnet', 0]); checks++;
  const es = await tr.translatePage(reopened.token, 0);
  assert.strictEqual(calls.length, 2); checks++;
  assert.strictEqual(es.items[0].text, 'Hello (anthropic/claude-sonnet-5.5)'); checks++;
  assert(/into Spanish/.test(calls[1].messages[0].content)); checks++;
  config.translateLang = 'Klingon';
  assert.strictEqual(tr.chapterState(reopened.token).lang, 'English', 'unknown languages fall back to English'); checks++;
  config.translateLang = 'English';
  config.translateModel = 'haiku';

  // an edited file starts over
  const later = new Date(Date.now() + 60000);
  fs.utimesSync(chapter, later, later);
  const edited = await reader.openChapter(chapter);
  st = tr.chapterState(edited.token);
  assert.deepStrictEqual([st.enabled, Object.keys(st.pages).length], [false, 0]); checks++;

  // OpenRouter errors come back with their kind and are not cached
  tr.setDeps({ cacheDir: path.join(userData, 'translations'), listModelIds: async () => [], request: async () => ({ ok: false, kind: 'quota', status: 402, message: 'This OpenRouter account has no credits left' }) });
  await assert.rejects(tr.translatePage(edited.token, 1), (e) => e.kind === 'quota' && /no credits/.test(e.message)); checks++;
  assert.strictEqual(Object.keys(tr.chapterState(edited.token).pages).length, 0); checks++;

  // PDF: the renderer sends the drawn page; anything but a JPEG or PNG is refused
  const pdf = path.join(lib, 'Yotsuba', 'Yotsuba - Ch 002.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4\n%%EOF\n');
  const p = await reader.openChapter(pdf);
  assert.strictEqual(p.kind, 'pdf'); checks++;
  await assert.rejects(tr.translatePage(p.token, 0, null), /No picture/); checks++;
  await assert.rejects(tr.translatePage(p.token, 0, new Uint8Array([60, 104, 116, 109, 108, 62])), /No picture/); checks++;
  tr.setDeps({ cacheDir: path.join(userData, 'translations'), listModelIds: async () => [], request: async (k, body) => { calls.push(body); return { ok: true, text: '{"items":[]}' }; } });
  const pdfRes = await tr.translatePage(p.token, 0, new Uint8Array(PNG));
  assert.deepStrictEqual(pdfRes.items, []); checks++;

  // config: only known languages and models are accepted from the renderer
  const { validateRendererConfigValue } = require('../main/config/security');
  assert.throws(() => validateRendererConfigValue('translateLang', 'Klingon')); checks++;
  assert.throws(() => validateRendererConfigValue('translateModel', 'gpt')); checks++;
  validateRendererConfigValue('translateLang', 'Spanish'); validateRendererConfigValue('translateModel', 'sonnet'); checks++;
  // the renderer's language list matches the main process's
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'reader.js'), 'utf8');
  const m = /var RD_TR_LANGS=(\[[^\]]*\]);/.exec(src);
  assert(m, 'RD_TR_LANGS in renderer/reader.js'); checks++;
  assert.deepStrictEqual(JSON.parse(m[1].replace(/'/g, '"')), tr.LANGS); checks++;

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('manga-translation checks passed: ' + checks + ' assertions (answers, cache, per-chapter switch, languages, models, errors, PDF)');
})().catch(e => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} console.error(e); process.exit(1); });
