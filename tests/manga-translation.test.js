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
  assert(/into Spanish/.test(tr.buildPrompt('Spanish')) && /0-1000/.test(tr.buildPrompt('Spanish')) && /numbered/.test(tr.buildPrompt('Spanish')), 'the prompt names the language, the numbered balloons and the box scale'); checks++;
  // numbered balloons: the answer names them; their boxes come from the reader
  const regs = [{ id: 1, x0: 600, y0: 50, x1: 900, y1: 300 }, { id: 2, x0: 50, y0: 50, x1: 300, y1: 400 }];
  items = tr.parseTranslation('{"items":[{"region":2,"src":"いいよ","text":"Sure."},{"region":7,"text":"no such balloon"},{"region":1,"text":""},{"x0":100,"y0":800,"x1":400,"y1":900,"kind":"sfx","text":"BAM"},{"x0":100,"y0":800,"x1":400,"y1":900,"kind":"narration","text":"Next day."}]}', regs);
  assert.deepStrictEqual(items.map(x => [x.region, x.text, x.x0]), [[2, 'Sure.', 50], [undefined, 'Next day.', 100]], 'unknown balloons, empty text and sound effects are dropped'); checks++;

  // --------------------------------------------------------- model choice
  assert.strictEqual(openrouter.resolveClaudeModel(['anthropic/claude-sonnet-5.5', 'x'], 'sonnet-5.5'), 'anthropic/claude-sonnet-5.5'); checks++;
  assert.strictEqual(openrouter.resolveClaudeModel(['anthropic/claude-sonnet-5-5:beta'], 'sonnet-5.5'), 'anthropic/claude-sonnet-5-5:beta'); checks++;
  assert.strictEqual(openrouter.resolveClaudeModel(['anthropic/claude-haiku-5.5'], 'sonnet-5.5'), null); checks++;

  // ------------------------------------------------------- translating pages
  const calls = [];
  tr.setDeps({
    cacheDir: path.join(userData, 'translations'),
    listModelIds: async () => ['anthropic/claude-haiku-5.5', 'anthropic/claude-sonnet-5.5', 'openai/gpt-6-luna'],
    request: async (key, body) => {
      calls.push(body);
      await new Promise(r => setTimeout(r, 20));
      return { ok: true, text: '{"items":[{"region":1,"text":"Hello (' + body.model + ')"}]}' };
    },
  });
  const open = await reader.openChapter(chapter);
  const page = { image: new Uint8Array(PNG), regions: [{ id: 1, x0: 100, y0: 100, x1: 400, y1: 300 }, { id: 'x', x0: 1 }, { id: 3, x0: 500, y0: 500, x1: 400, y1: 600 }] };
  assert.strictEqual(open.kind, 'pages'); checks++;

  config.openRouterApiKey = '';
  await assert.rejects(tr.translatePage(open.token, 0, page), /OpenRouter key/, 'no key: nothing is sent'); checks++;
  assert.strictEqual(calls.length, 0); checks++;

  config.openRouterApiKey = 'sk-or-v1-test-test-test-test';
  config.lumaModel = 'anthropic/claude-haiku-5.5';
  let st = tr.chapterState(open.token);
  assert.deepStrictEqual([st.supported, st.enabled, st.lang, st.model, st.hasKey], [true, false, 'English', 'haiku', true]); checks++;

  const [a, b] = await Promise.all([tr.translatePage(open.token, 0, page), tr.translatePage(open.token, 0, page)]);
  assert.strictEqual(calls.length, 1, 'the same page asked twice at once is sent once'); checks++;
  assert.deepStrictEqual(a, b); checks++;
  assert.strictEqual(a.items[0].text, 'Hello (anthropic/claude-haiku-5.5)'); checks++;
  assert.deepStrictEqual([a.items[0].region, a.items[0].x0, a.items[0].x1], [1, 100, 400], 'the balloon keeps the box the reader found'); checks++;
  assert(/Numbered boxes: 1\./.test(calls[0].messages[1].content[0].text), 'malformed boxes are not offered to the model'); checks++;
  const sentBody = calls[0];
  assert.strictEqual(sentBody.messages[1].content[1].image_url.url.slice(0, 22), 'data:image/png;base64,', 'the page picture goes with the request'); checks++;
  assert(/into English/.test(sentBody.messages[0].content)); checks++;

  const again = await tr.translatePage(open.token, 0, null);
  assert.strictEqual(calls.length, 1, 'a translated page is served from the cache'); checks++;
  assert.strictEqual(again.cached, true); checks++;
  await assert.rejects(tr.translatePage(open.token, 2, page), /No such page/); checks++;
  await assert.rejects(tr.translatePage('ffffffffffffffffffffffff', 0, page), /no longer open/); checks++;

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
  const es = await tr.translatePage(reopened.token, 0, page);
  assert.strictEqual(calls.length, 2); checks++;
  assert.strictEqual(es.items[0].text, 'Hello (anthropic/claude-sonnet-5.5)'); checks++;
  assert(/into Spanish/.test(calls[1].messages[0].content)); checks++;
  config.translateLang = 'Klingon';
  assert.strictEqual(tr.chapterState(reopened.token).lang, 'English', 'unknown languages fall back to English'); checks++;
  config.translateLang = 'English';
  config.translateModel = 'haiku';
  // "Use GPT-6 Luna": its own set of pages, medium reasoning, no temperature
  config.useLuna = true;
  st = tr.chapterState(reopened.token);
  assert.deepStrictEqual([st.model, Object.keys(st.pages).length], ['luna', 0], 'Luna has its own pages'); checks++;
  const lu = await tr.translatePage(reopened.token, 0, page);
  const lb = calls[calls.length - 1];
  assert.deepStrictEqual([lb.model, lb.reasoning && lb.reasoning.effort, lb.max_tokens, lb.temperature], ['openai/gpt-6-luna', 'medium', 16000, undefined]); checks++;
  assert(lu.items.length, 'Luna answer parsed'); checks++;
  delete config.useLuna;

  // renamed or moved (auto-rename, File Management): the translations follow the file
  const renamed = path.join(lib, 'Yotsuba', 'Yotsuba - Ch 001 - Renamed.cbz');
  fs.renameSync(chapter, renamed);
  const moved = await reader.openChapter(renamed);
  st = tr.chapterState(moved.token);
  assert.deepStrictEqual([st.enabled, Object.keys(st.pages)], [true, ['0']], 'a renamed chapter keeps its translations'); checks++;
  // finished pages: saved once, served back for the same language and lettering version
  const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xFF, 0xD9]);
  assert.strictEqual(tr.savePageImage(moved.token, 0, 'v1', jpeg), true); checks++;
  assert.deepStrictEqual([...tr.readPageImage(moved.token, 0, 'v1')], [...jpeg], 'a finished page comes back as saved'); checks++;
  assert.strictEqual(tr.readPageImage(moved.token, 0, 'v2'), null, 'another lettering version letters again'); checks++;
  assert.strictEqual(tr.savePageImage(moved.token, 0, 'v1', new Uint8Array([1, 2, 3])), false, 'only JPEGs are saved'); checks++;
  config.translateLang = 'Spanish';
  assert.strictEqual(tr.readPageImage(moved.token, 0, 'v1'), null, 'another language has its own pages'); checks++;
  config.translateLang = 'English';
  fs.renameSync(renamed, chapter);

  // an edited file starts over
  const z2 = new AdmZip(chapter); z2.addFile('extra.txt', Buffer.from('changed')); z2.writeZip(chapter);
  const edited = await reader.openChapter(chapter);
  st = tr.chapterState(edited.token);
  assert.deepStrictEqual([st.enabled, Object.keys(st.pages).length], [false, 0]); checks++;

  // OpenRouter errors come back with their kind and are not cached
  tr.setDeps({ cacheDir: path.join(userData, 'translations'), listModelIds: async () => [], request: async () => ({ ok: false, kind: 'quota', status: 402, message: 'This OpenRouter account has no credits left' }) });
  await assert.rejects(tr.translatePage(edited.token, 1, page), (e) => e.kind === 'quota' && /no credits/.test(e.message)); checks++;
  assert.strictEqual(Object.keys(tr.chapterState(edited.token).pages).length, 0); checks++;

  // the picture: only a JPEG or PNG the reader drew is sent
  const pdf = path.join(lib, 'Yotsuba', 'Yotsuba - Ch 002.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4\n%%EOF\n');
  const p = await reader.openChapter(pdf);
  assert.strictEqual(p.kind, 'pdf'); checks++;
  await assert.rejects(tr.translatePage(p.token, 0, null), /No picture/); checks++;
  await assert.rejects(tr.translatePage(p.token, 0, { image: new Uint8Array([60, 104, 116, 109, 108, 62]) }), /No picture/); checks++;
  tr.setDeps({ cacheDir: path.join(userData, 'translations'), listModelIds: async () => [], request: async (k, body) => { calls.push(body); return { ok: true, text: '{"items":[]}' }; } });
  const pdfRes = await tr.translatePage(p.token, 0, { image: new Uint8Array(PNG), regions: [] });
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

  // ------------------------------------------- lettering (renderer/typeset.js)
  // A drawn page: a panel border, one balloon (an ellipse outline) holding two
  // columns of "text" blobs, one of them touching the outline, and a white
  // area without an outline (a face) that must not count as a balloon.
  const vm = require('vm');
  const tsCtx = vm.createContext({ Math, Array, Uint8Array, Int32Array, Int16Array, Float32Array, Object, String, Number, isFinite, document: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'typeset.js'), 'utf8') + '\nthis.TS = TS;', tsCtx);
  const TS = tsCtx.TS;
  const PW = 400, PH = 560, px = new Uint8ClampedArray(PW * PH * 4).fill(255);
  const put = (x, y, v) => { if (x < 0 || y < 0 || x >= PW || y >= PH) return; const j = (y * PW + x) * 4; px[j] = px[j + 1] = px[j + 2] = v; };
  for (let x = 20; x < 380; x++) for (let t = 0; t < 3; t++) { put(x, 20 + t, 20); put(x, 540 - t, 20); }
  for (let y = 20; y < 540; y++) for (let t = 0; t < 3; t++) { put(20 + t, y, 20); put(380 - t, y, 20); }
  const ecx = 200, ecy = 200, ea = 70, eb = 120;
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const d = Math.sqrt(((x - ecx) / ea) ** 2 + ((y - ecy) / eb) ** 2);
    if (d > 1 && d < 1 + 3 / Math.min(ea, eb)) put(x, y, 15);                    // outline
  }
  const textPx = [];
  for (const col of [215, 185]) for (let k = 0; k < 7; k++) for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    if ((x + y) % 3 === 0 || x === 0 || y === 11) { put(col + x, 120 + k * 18 + y, 25); textPx.push([col + x, 120 + k * 18 + y]); }
  }
  // a character joined to the outline's top by a short stroke
  for (let y = 84; y < 98; y++) for (let x = 194; x < 206; x++) if ((x + y) % 2 || y === 84) { put(x, y, 25); textPx.push([x, y]); }
  for (let y = 78; y < 84; y++) put(200, y, 25);
  for (let y = 390; y < 520; y++) for (let x = 60; x < 340; x++) if ((x * 7 + y * 3) % 11 === 0) put(x, y, 120);   // hatching
  for (let y = 420; y < 480; y++) for (let x = 120; x < 200; x++) put(x, y, 255);                               // a face
  for (const [x, y] of [[140, 440], [170, 440], [150, 460], [155, 460]]) put(x, y, 30);
  const drawnPage = { width: PW, height: PH, data: px };
  const det = TS.planLegacy(drawnPage);
  assert.strictEqual(det.regions.length, 1, 'one balloon found: ' + JSON.stringify(det.regions.map(r => [r.x0, r.y0, r.x1, r.y1]))); checks++;
  assert.strictEqual(det.units.length, 1); checks++;
  const RB = det.regions[0];
  assert(Math.abs(RB.cx - ecx) < 8 && RB.y0 < 90 && RB.y1 > 310, 'the balloon is the ellipse'); checks++;
  assert.strictEqual(Object.keys(TS.regionBoxes(det)[0]).join(), 'id,x0,y0,x1,y1'); checks++;
  // a canvas stand-in: Comic Neue is about 0.55 em per character
  const drawn = [];
  const fakeCtx = { font: '', textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '',
    measureText(t) { const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)[1]); return { width: t.length * size * 0.55 }; },
    fillText(t, x, y) { drawn.push({ t, x, y, size: parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)[1]) }); },
    strokeText() {}, putImageData() {}, beginPath() {}, rect() {}, roundRect() {}, fill() {} };
  const outlineBefore = [];
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) if (px[(y * PW + x) * 4] === 15) outlineBefore.push(y * PW + x);
  TS.render(fakeCtx, drawnPage, det, [{ region: RB.id, text: 'I just want to talk with the dorm head too, so...' }]);
  const left = textPx.filter(([x, y]) => px[(y * PW + x) * 4] <= 240);
  assert(!left.length, JSON.stringify(left.slice(0, 20)) + ' all of the original text is erased, including the character touching the outline'); checks++;
  assert(outlineBefore.every(i => px[i * 4] === 15), 'the outline is untouched'); checks++;
  assert(px[(440 * PW + 140) * 4] === 30, 'nothing outside the balloon is touched'); checks++;
  assert(drawn.length >= 3, 'the translation is lettered over several lines'); checks++;
  assert.strictEqual(drawn.map(d => d.t).join(' '), 'I just want to talk with the dorm head too, so...', 'lines break between whole words, in order'); checks++;
  for (const d of drawn) {
    const half = d.t.length * d.size * 0.55 / 2;
    for (const [lx, ly] of [[d.x - half, d.y], [d.x + half, d.y], [d.x - half, d.y - d.size / 2], [d.x + half, d.y + d.size / 2]]) {
      assert(((lx - ecx) / ea) ** 2 + ((ly - ecy) / eb) ** 2 < 1, 'line "' + d.t + '" stays inside the balloon');
    }
  }
  checks++;
  // ---------------------------- lettering with the text detector (TS.plan)
  // Two balloons run together (two overlapping ellipses), each holding a
  // column of text, found by the detector as ONE block; plus a line of text
  // over hatching. The block must become one unit per balloon, the hatching
  // text an "art" unit, and each translation must land in its own balloon.
  const QW = 420, QH = 560, qx = new Uint8ClampedArray(QW * QH * 4).fill(255), strokes = new Uint8Array(QW * QH);
  const qput = (x, y, v) => { if (x < 0 || y < 0 || x >= QW || y >= QH) return; const j = (y * QW + x) * 4; qx[j] = qx[j + 1] = qx[j + 2] = v; };
  const lobes = [[150, 170, 70, 100], [270, 230, 70, 100]];
  const inLobe = (x, y, [cx, cy, a, b], k = 1) => ((x - cx) / a) ** 2 + ((y - cy) / b) ** 2 < k;
  for (let y = 0; y < QH; y++) for (let x = 0; x < QW; x++) {
    const inside = lobes.some(L => inLobe(x, y, L)), ring = lobes.some(L => inLobe(x, y, L, 1.09));
    if (ring && !inside) qput(x, y, 15);
  }
  const cols = [[144, 120], [264, 180]], textOf = [[], []];
  cols.forEach(([cx0, cy0], li) => { for (let k = 0; k < 6; k++) for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    if ((x + y) % 3 === 0 || x === 0 || y === 11) { const X = cx0 + x, Y = cy0 + k * 16 + y; qput(X, Y, 25); strokes[Y * QW + X] = 255; textOf[li].push([X, Y]); } } });
  for (let y = 380; y < 540; y++) for (let x = 30; x < 400; x++) if ((x * 7 + y * 3) % 9 === 0) qput(x, y, 110);   // hatching
  const artPx = [];
  for (let k = 0; k < 5; k++) for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if ((x + 2 * y) % 4 === 0 || y === 0) {
    const X = 150 + k * 16 + x, Y = 450 + y; qput(X, Y, 20); strokes[Y * QW + X] = 255; artPx.push([X, Y]); }
  const qPage = { width: QW, height: QH, data: qx };
  const td = { boxes: [{ x1: 140, y1: 116, x2: 280, y2: 280, conf: 0.9 }, { x1: 148, y1: 448, x2: 232, y2: 464, conf: 0.8 }], strokes };
  const P2 = TS.plan(qPage, td);
  const kinds = P2.units.map(u => u.kind).sort().join();
  assert.strictEqual(kinds, 'art,balloon,balloon', 'one block over two joined balloons becomes two balloon units, and the hatching text an art unit: ' + kinds); checks++;
  const unitOf = (pts) => P2.units.find(u => u.kind === 'balloon' && pts.every(([x, y]) => x >= u.tb.x1 && x <= u.tb.x2 && y >= u.tb.y1 && y <= u.tb.y2));
  const U1 = unitOf(textOf[0]), U2 = unitOf(textOf[1]), UA = P2.units.find(u => u.kind === 'art');
  assert(U1 && U2 && U1 !== U2, 'each balloon\'s column is its own unit'); checks++;
  assert.strictEqual(TS.regionBoxes(P2).length, 3); checks++;
  const drawn2 = [];
  const ctx2 = Object.assign({}, fakeCtx, { fillText(t, x, y) { drawn2.push({ t, x, y }); } });
  const outline2 = [];
  for (let i = 0; i < QW * QH; i++) if (qx[i * 4] === 15) outline2.push(i);
  TS.render(ctx2, qPage, P2, [{ region: U1.id, text: 'Honestly, I like that.' }, { region: U2.id, text: 'Personally, I mean...' }, { region: UA.id, text: 'Shrine' }]);
  assert(textOf[0].concat(textOf[1]).every(([x, y]) => qx[(y * QW + x) * 4] > 240), 'both balloons\' text is erased'); checks++;
  assert(outline2.every(i => qx[i * 4] === 15), 'the outlines are untouched'); checks++;
  assert(artPx.every(([x, y]) => qx[(y * QW + x) * 4] > 60), 'text over the drawing is painted over'); checks++;
  const lineAt = (txt) => drawn2.filter(d => txt.split(' ').includes(d.t.split(' ')[0]));
  assert(drawn2.filter(d => /Honestly|like/.test(d.t)).every(d => inLobe(d.x, d.y, lobes[0])), 'the first translation sits in the first balloon'); checks++;
  assert(drawn2.filter(d => /Personally|mean/.test(d.t)).every(d => inLobe(d.x, d.y, lobes[1])), 'the second translation sits in the second balloon'); checks++;
  assert(drawn2.some(d => d.t === 'Shrine'), 'text over the drawing is lettered'); checks++;

  // the text size preference (opts.scale) makes the lettering smaller or bigger
  const sizesAt = (scale) => {
    const out = [];
    const c = Object.assign({}, fakeCtx, { fillText(t) { out.push(parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)[1])); } });
    TS.render(c, { width: QW, height: QH, data: new Uint8ClampedArray(qx) }, P2, [{ region: U1.id, text: 'Honestly, I like that.' }], { scale });
    return Math.max(...out);
  };
  assert(sizesAt(0.6) < sizesAt(1) * 0.8, 'a smaller text size letters smaller: ' + sizesAt(0.6) + ' vs ' + sizesAt(1)); checks++;

  // the browser extension (manga-translator/) letters with the same file
  assert.strictEqual(fs.readFileSync(path.join(__dirname, '..', 'manga-translator', 'extension', 'engine', 'typeset.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'renderer', 'typeset.js'), 'utf8'), 'manga-translator/extension/engine/typeset.js is a copy of renderer/typeset.js: keep them identical'); checks++;

  // words: hyphens may break, Japanese breaks between characters
  assert.strictEqual(JSON.stringify(TS.tokens('Kamiina-san!? first-year').map(t => t.t)), '["Kamiina-","san!?","first-","year"]'); checks++;
  assert.strictEqual(TS.tokens('寮長さんと話したい').length, 9); checks++;
  assert.strictEqual(TS.tokens('Wait...!').map(t => t.t).join('|'), 'Wait...!'); checks++;

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('manga-translation checks passed: ' + checks + ' assertions (answers, cache, per-chapter switch, languages, models, errors, PDF, balloon detection, erasing, lettering, text-detector units and joined balloons)');
})().catch(e => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} console.error(e); process.exit(1); });
