'use strict';

// security-and-parsers.test.js
//
// Executes REAL function source extracted from main.js / index.html inside a
// vm sandbox (same philosophy as mal-data.test.js), so renaming or changing
// semantics fails loudly instead of letting mirrored copies rot. Also locks in
// packaging contracts and this session's security invariants via source-text
// assertions, following state-integrity.test.js style.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const mainSrc = require('./main-source').readMainSource();
const htmlSrc = require('./renderer-source').combined;
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

let checks = 0;

// Lexer-aware source extractor (shared with filesystem-safety.test.js).
const { extractFunction } = require('./source-extract');

function extractConstLine(src, name) {
  const m = src.match(new RegExp('^const ' + name + ' = .*$', 'm'));
  return m ? m[0] : null;
}

function runInSandbox(code, filename) {
  const ctx = vm.createContext({ path: require('path'), console });
  vm.runInContext(code, ctx, { filename: filename || 'extracted' });
  return ctx;
}

function mustExtract(fnCode, label) {
  assert(fnCode && fnCode.length > 10, 'source extraction failed for ' + label);
  return fnCode;
}

// ---------------------------------------------------------------------------
// Renderer escapers: E() and the A() action attribute, executed from source
// ---------------------------------------------------------------------------

{
  const code = mustExtract(extractFunction(htmlSrc, 'E'), 'E') + '\n'
             + mustExtract(extractFunction(htmlSrc, 'A'), 'A');
  const ctx = runInSandbox(code, 'escapers');

  // E(): text-node / double-quoted-attribute safety
  assert.strictEqual(ctx.E("Conan's Movies"), 'Conan&#39;s Movies'); checks++;
  assert.strictEqual(ctx.E('<b>&"x"</b>'), '&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;'); checks++;

  // A(): arguments travel as JSON inside a data attribute and come back
  // byte-identical after the browser decodes the attribute. Nothing is ever
  // evaluated as code, so there is no JS-string context to break out of.
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"' };
  const dec = a => a.replace(/&(amp|lt|gt|quot|#39);/g, (m, e) => e === '#39' ? "'" : ENT[e]);
  const cases = [
    ["Conan's Movies", 'apostrophe'],
    ['Ojousama no "Quotes"', 'double-quote'],
    ['Back\\slash', 'backslash'],
    ['A & B &#39; x', 'entity-smuggling'],
    ['Line1\nLine2\rCR', 'newlines'],
    ['<img src=x onerror=alert(1)>', 'tag-injection'],
    ["'); alert(1); ('", 'js-breakout'],
    ['" data-act="deleteSeries', 'attribute-breakout'],
    ['日本語 タイトル', 'unicode'],
  ];
  for (const [val, label] of cases) {
    const html = '<button' + ctx.A('openSeries', val, 3) + '></button>';
    const attrs = [...html.matchAll(/\s(data-[a-z]+)="([^"]*)"/g)];
    assert.deepStrictEqual(attrs.map(m => m[1]), ['data-act', 'data-arg'], 'A() must emit exactly two attributes: ' + label); checks++;
    assert.strictEqual(dec(attrs[0][2]), 'openSeries'); checks++;
    assert.deepStrictEqual(JSON.parse(dec(attrs[1][2])), [val, 3], 'A() round-trip failed: ' + label); checks++;
    assert(!/[<>]/.test(html.slice(7, -10)), 'A() output must not contain raw angle brackets: ' + label); checks++;
  }
}

// The dispatcher only runs registered actions — never arbitrary globals.
{
  const core = fs.readFileSync(path.join(root, 'renderer', 'core.js'), 'utf8');
  assert(/var ACT = Object\.create\(null\)/.test(core), 'action registry must be a prototype-free allowlist'); checks++;
  assert(/var fn=ACT\[name\];\s*if\(!fn\)/.test(core), 'dispatcher must refuse unknown actions'); checks++;
  assert(!/\beval\(|new Function\(/.test(require('./renderer-source').js), 'renderer must not evaluate strings as code'); checks++;
}

// ---------------------------------------------------------------------------
// Episode parser (main process; the renderer uses the numbers it returns)
// ---------------------------------------------------------------------------

{
  const stripLine = extractConstLine(mainSrc, 'RELEASE_META_STRIP');
  assert(stripLine, 'RELEASE_META_STRIP not found in main.js');
  const mainCtx = runInSandbox(
    stripLine + '\n' + mustExtract(extractFunction(mainSrc, 'parseEpisodeNumber'), 'main.parseEpisodeNumber'),
    'main-parser'
  );

  const cases = [
    ['Title 05 - 1080p.mkv', 5],
    ['Title 5 - 2160p.mkv', 5],
    ['Show S02E05 - 1080p.mkv', 5],
    ['Monster - 26 [1080p].mkv', 26],
    ['Anime - 12 (1080p).mkv', 12],
    ['[SubsPlease] Show - 07 (1080p) [HEVC].mkv', 7],
    ['Series - 26.mkv', 26],
    ['EP1.mkv', 1],
    ['Episode 05.mkv', 5],
    ['Show 14.mkv', 14],
    ['Season 2 - 1080p.mkv', null],
    ['Some Movie (2019).mkv', null],
    ['Random Film Title.mkv', null],
    ['One Piece - 1100 (1080p).mkv', 1100],
    ['Series - 12.5.mkv', 12.5],
  ];
  for (const [input, expected] of cases) {
    assert.strictEqual(mainCtx.parseEpisodeNumber(input), expected,
      'main parser mismatch on ' + input); checks++;
  }
}

// ---------------------------------------------------------------------------
// Validators from main.js
// ---------------------------------------------------------------------------

{
  const names = ['safeHistoryKey', 'safeMalId', 'safeEpisodeNumber'];
  const code = names.map(n => mustExtract(extractFunction(mainSrc, n), n)).join('\n');
  const ctx = runInSandbox(code, 'validators');

  assert.strictEqual(ctx.safeEpisodeNumber(5), 5); checks++;
  assert.strictEqual(ctx.safeEpisodeNumber('12'), 12); checks++;
  for (const bad of [0, -3, 1.5, 9999 + 1, NaN, null, 'abc', { a: 1 }]) {
    assert.strictEqual(ctx.safeEpisodeNumber(bad), null, 'safeEpisodeNumber accepted ' + JSON.stringify(bad)); checks++;
  }
  assert.strictEqual(ctx.safeEpisodeNumber(9999), 9999); checks++;

  assert.strictEqual(ctx.safeMalId(1), 1); checks++;
  assert.strictEqual(ctx.safeMalId('529'), 529); checks++;
  for (const bad of [0, -1, 1.5, 100000000, 'x', NaN]) {
    assert.strictEqual(ctx.safeMalId(bad), null, 'safeMalId accepted ' + JSON.stringify(bad)); checks++;
  }

  assert.strictEqual(ctx.safeHistoryKey('Monster'), 'Monster'); checks++;
  for (const k of ['__proto__', 'constructor', 'prototype']) {
    assert.strictEqual(ctx.safeHistoryKey(k), '_' + k, 'prototype key not defused: ' + k); checks++;
  }
  assert.strictEqual(ctx.safeHistoryKey('  '), '_', 'blank keys must collapse to the prefixed empty key'); checks++;
  assert.strictEqual(ctx.safeHistoryKey(null), '_', 'nullish keys must collapse to the prefixed empty key'); checks++;
}

// ---------------------------------------------------------------------------
// Mode-aware MAL status options from index.html
// ---------------------------------------------------------------------------

{
  const stubs = 'var MODE="anime";\n'
    + 'function watchingLabel(){return "W";}\n'
    + 'function planLabel(){return "P";}\n'
    + 'function isManga(){return MODE==="manga";}\n';
  const ctx = runInSandbox(stubs + mustExtract(extractFunction(htmlSrc, 'malStatusOptions'), 'malStatusOptions'), 'statuses');
  let opts = ctx.malStatusOptions();
  assert.deepStrictEqual([opts[0][0], opts[4][0]], ['watching', 'plan_to_watch']); checks++;
  ctx.MODE = 'manga';
  opts = ctx.malStatusOptions();
  assert.deepStrictEqual([opts[0][0], opts[4][0]], ['reading', 'plan_to_read']); checks++;
}

// ---------------------------------------------------------------------------
// Packaging contract: literal build.files entries must exist on disk
// ---------------------------------------------------------------------------

{
  for (const f of ['main.js', 'preload.js', 'autoDownload.js', 'openrouter.js', 'index.html', 'theme-boot.js', 'package.json', 'icon.png']) {
    assert(fs.existsSync(path.join(root, f)), 'build.files literal missing from repo: ' + f); checks++;
    assert(pkg.build.files.includes(f), 'build.files must include ' + f); checks++;
  }
  assert(pkg.build.files.includes('luma/**/*'), 'build.files must keep shipping luma assets'); checks++;
  assert(fs.existsSync(path.join(root, 'luma')), 'luma/ is referenced by build.files — do not delete it'); checks++;
  assert.strictEqual(pkg.main, 'main.js'); checks++;
  // The main process is split across main/: every local require must resolve
  // to a file the packaged app ships, or the exe exits before any window.
  assert(pkg.build.files.includes('main/**/*'), 'build.files must ship the main/ modules'); checks++;
  // electron-builder 25 rejects unknown top-level keys (a "zip" block broke the build).
  const BUILDER_KEYS = ['appId', 'productName', 'compression', 'directories', 'files', 'win', 'nsis', 'portable', 'extraResources', 'extraFiles', 'asar', 'asarUnpack', 'artifactName', 'electronVersion', 'electronDist'];
  for (const k of Object.keys(pkg.build)) { assert(BUILDER_KEYS.includes(k), 'unexpected electron-builder key: ' + k); checks++; }
  assert(/--win zip --arm64/.test(pkg.scripts['build-arm64']), 'ARM64 builds the native zip/folder, not the x86-launcher portable'); checks++;
  const { mainFiles } = require('./main-source');
  for (const f of mainFiles()) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of text.matchAll(/require\('(\.{1,2}\/[^']+)'\)/g)) {
      const target = path.relative(root, path.resolve(root, path.dirname(f), m[1])).split(path.sep).join('/') + '.js';
      assert(fs.existsSync(path.join(root, target)), f + ' requires a missing module: ' + m[1]); checks++;
      assert(target.startsWith('main/') || pkg.build.files.includes(target), target + ' (required by ' + f + ') is not in build.files'); checks++;
    }
  }
}

// ---------------------------------------------------------------------------
// Security invariants (state-integrity style)
// ---------------------------------------------------------------------------

{
  assert(mainSrc.includes("'malClientSecret', 'malCodeVerifier', 'malAccessToken', 'malRefreshToken', 'malAuthState'"),
    'config:get must strip credentials AND internal OAuth flow state'); checks++;
  assert(mainSrc.includes('safe.hasMalClientSecret = !!safe.malClientSecret'),
    'secret-existence flag must be derived before stripping'); checks++;
  assert(!/id="malCsec"[^>]*value="\+/.test(htmlSrc),
    'secret input must never render a stored value'); checks++;

  assert(!/code_challenge_method: 'S256'/.test(mainSrc),
    'MAL OAuth must not send S256 (plain-only per official reference)'); checks++;
  assert(mainSrc.includes("code_challenge_method: 'plain'"),
    'MAL OAuth must use plain PKCE'); checks++;

  assert(mainSrc.includes('closeAllConnections'),
    'auth server teardown must force-close keep-alive sockets'); checks++;
  assert(mainSrc.includes("protocol.handle('cover'"),
    'cover:// protocol handler registration missing'); checks++;

  assert(!/code\.length < 512/.test(mainSrc),
    'OAuth callback must not cap codes below real MAL size (~1000 bytes)'); checks++;
  assert(mainSrc.includes('code.length <= 4096'),
    'OAuth callback must accept large MAL authorization codes'); checks++;

  assert(mainSrc.includes('function spawnDetached'),
    'crash-safe detached-spawn helper missing'); checks++;
  assert(mainSrc.includes("child.once('spawn'"),
    'spawn success-signal handler missing'); checks++;

  assert(htmlSrc.includes('data: https: cover:'),
    'CSP img-src must allow the cover: scheme'); checks++;

  assert(mainSrc.includes('{ recursive: true, force: true }'),
    'series deletes must be recursive within allowlists'); checks++;

  assert(mainSrc.includes('Array.isArray(data.delete)'),
    'duplicate resolver must accept array deletion payloads'); checks++;

  assert(mainSrc.includes("CONFIG_PATH + '.lost-'"),
    'catastrophic-shrink archive marker missing'); checks++;
  assert(mainSrc.includes('const AUTH_DEBUG_LOG'),
    'OAuth diagnostic trail (auth-debug.log) missing'); checks++;
  assert(mainSrc.includes('snapshotConfigDaily'),
    'daily config snapshot hook missing'); checks++;

  assert(htmlSrc.includes("'&#39;'") || htmlSrc.includes('&#39;'),
    'E() must escape apostrophes'); checks++;

  // AI assistant: the key stays main-side and all network stays main-side
  assert(mainSrc.includes("'malAuthState', 'openRouterApiKey', 'geminiApiKey'"),
    'config:get must strip the Luma key (and the legacy keys)'); checks++;
  const orSrc = fs.readFileSync(path.join(root, 'openrouter.js'), 'utf8');
  assert(orSrc.includes("API_HOST = 'openrouter.ai'") && orSrc.includes("'Authorization': 'Bearer ' + apiKey"),
    'OpenRouter requests must originate in the main process with the key in a header'); checks++;
  assert(/const REASONING = \{ effort: 'low' \}/.test(orSrc) && orSrc.includes('reasoning: REASONING'),
    'Luma must send low reasoning effort'); checks++;
  assert(!/generativelanguage\.googleapis\.com|openrouter\.ai\/api/.test(htmlSrc),
    'renderer must never construct AI network calls'); checks++;
  assert(htmlSrc.includes('aiSend') && htmlSrc.includes('https://openrouter.ai/keys'),
    'assistant key entry UI with the OpenRouter key link is missing'); checks++;
  assert(!/gemini/i.test(htmlSrc) && !fs.existsSync(path.join(root, 'gemini.js')),
    'the Gemini integration must stay removed'); checks++;
  assert(/for \(const old of \[LEGACY_OPENROUTER_KEY_PATH, LEGACY_GEMINI_KEY_PATH\]\)[\s\S]*?fs\.unlinkSync\(old\)/.test(mainSrc),
    'the stored 5.0 OpenRouter key must be deleted on start'); checks++;
  assert(mainSrc.includes("LUMA_KEY_PATH = path.join(app.getPath('userData'), 'luma-openrouter.enc')") &&
    mainSrc.includes("LEGACY_OPENROUTER_KEY_PATH = path.join(app.getPath('userData'), 'openrouter-key.enc')"),
    'the Luma key must not reuse the 5.0 file name'); checks++;
}

// Behavioral checks against the real Electron-free module
const openrouter = require(path.join(root, 'openrouter.js'));
openrouter.setDeps({ config: {}, mainWindow: () => null });
assert.strictEqual(openrouter.validateMessages([{ role: 'user', content: 'hi' }]), true); checks++;
assert.strictEqual(openrouter.validateMessages([{ role: 'tool', content: 'x' }]), false); checks++;
assert.strictEqual(openrouter.validateMessages([{ role: 'user', content: '' }]), false); checks++;
assert.strictEqual(openrouter.validateMessages('nope'), false); checks++;
assert.strictEqual(openrouter.validateMessages(new Array(50).fill({ role: 'user', content: 'x' })), false); checks++;
assert.strictEqual(openrouter.isPlausibleKey('sk-or-v1-' + 'a1'.repeat(32)), true); checks++;
assert.strictEqual(openrouter.isPlausibleKey('sk or v1 spaces'), false); checks++;
assert.strictEqual(openrouter.isPlausibleKey('short'), false); checks++;
assert.strictEqual(openrouter.isPlausibleKey('sk-or-v1-abc\r\nX-Evil: 1abcdefghijk'), false, 'no header injection'); checks++;
assert.strictEqual(openrouter.normalizeKey('OPENROUTER_API_KEY="sk-or-v1-abcdefghijklmnopqrstuvwxyz"'), 'sk-or-v1-abcdefghijklmnopqrstuvwxyz'); checks++;

// Request body: one model, streamed, low reasoning, validated model id
const body = openrouter.toOpenRouterRequest([{ role: 'system', content: 'be nice' }, { role: 'user', content: 'hi' }], 'anthropic/claude-haiku-5.5');
assert.deepStrictEqual(body.reasoning, { effort: 'low' }); checks++;
assert.strictEqual(body.model, 'anthropic/claude-haiku-5.5'); checks++;
assert.strictEqual(body.stream, true); checks++;
assert.deepStrictEqual(body.messages, [{ role: 'system', content: 'be nice' }, { role: 'user', content: 'hi' }]); checks++;
assert.strictEqual(openrouter.toOpenRouterRequest([{ role: 'user', content: 'x' }], '../../evil').model, openrouter.DEFAULT_MODEL, 'model ids are validated'); checks++;

// Model resolution from OpenRouter's catalogue: never guess
assert.strictEqual(openrouter.resolveLumaModel(['openai/gpt-4o', 'anthropic/claude-haiku-5.5', 'anthropic/claude-haiku-5.5:beta']), 'anthropic/claude-haiku-5.5'); checks++;
assert.strictEqual(openrouter.resolveLumaModel(['anthropic/claude-haiku-5-5:beta']), 'anthropic/claude-haiku-5-5:beta'); checks++;
assert.strictEqual(openrouter.resolveLumaModel(['anthropic/claude-haiku-4.5', 'anthropic/claude-haiku-5.50']), null, 'an absent model is reported, not replaced'); checks++;

// Streaming: text only, reasoning hidden, partial frames kept for the next chunk
{
  let out = '';
  const r1 = openrouter.drainSse(': OPENROUTER PROCESSING\ndata: {"choices":[{"delta":{"content":"Hel"}}]}\ndata: {"choices":[{"delta":{"reasoning":"hmm"}}]}\ndata: {"choices":[{"delta":{"content":"lo"}}]}\ndata: [DONE]\ndata: {"choices":[{"del',
    (t) => { out += t; });
  assert.deepStrictEqual([out, r1.gotText, r1.error], ['Hello', true, null], 'reasoning deltas are never shown'); checks++;
  assert(r1.rest.startsWith('data: {"choices'), 'the unfinished frame is kept'); checks++;
  assert.strictEqual(openrouter.drainSse('data: {"error":{"message":"Provider disconnected"}}\n', () => {}).error, 'Provider disconnected'); checks++;
}

// Errors: what the user sees, and which hint they get
assert.deepStrictEqual([openrouter.apiError(401, JSON.stringify({ error: { message: 'No auth' } })).kind], ['key']); checks++;
assert(/rejected this API key/.test(openrouter.apiError(401, '{}').message)); checks++;
assert.strictEqual(openrouter.apiError(402, '{}').kind, 'quota'); checks++;
assert(/30 seconds/.test(openrouter.apiError(429, '{}', '30').message)); checks++;
assert.strictEqual(openrouter.apiError(503, '').kind, 'busy'); checks++;
assert.strictEqual(openrouter.apiError(404, JSON.stringify({ error: { message: 'No endpoints found' } })).kind, 'other'); checks++;

(async () => {
  const sent = [];
  let script;
  const cfg = { openRouterApiKey: 'sk-or-v1-' + 'a'.repeat(40), lumaModel: 'anthropic/claude-haiku-5.5' };
  openrouter.setDeps({
    config: cfg,
    mainWindow: () => ({ isDestroyed: () => false, webContents: { send: (ch, p) => sent.push([ch, p]) } }),
    request: async (key, reqBody, onText) => { sent.push(['request', key.slice(0, 9), reqBody.model, reqBody.reasoning]); return script(onText); },
  });

  script = (onText) => { onText('Hi'); return { ok: true, gotText: true }; };
  let r = await openrouter.chatStream([{ role: 'user', content: 'hi' }]);
  assert.deepStrictEqual(r, { ok: true }); checks++;
  assert.deepStrictEqual(sent.find(s => s[0] === 'request'), ['request', 'sk-or-v1-', 'anthropic/claude-haiku-5.5', { effort: 'low' }],
    'one request to Haiku 5.5 with low reasoning'); checks++;
  assert.deepStrictEqual(sent.filter(s => s[0] === 'ai:chunk').map(s => s[1].text), ['Hi']); checks++;

  script = () => ({ ok: false, status: 401, kind: 'key', message: 'OpenRouter rejected this API key' });
  r = await openrouter.chatStream([{ role: 'user', content: 'hi' }]);
  assert.deepStrictEqual([r.ok, r.kind], [false, 'key']); checks++;
  assert.strictEqual(sent.filter(s => s[0] === 'request').length, 2, 'a failure is not retried on another model'); checks++;

  script = () => ({ ok: false, kind: 'busy', message: 'overloaded' });
  r = await openrouter.chatStream([{ role: 'user', content: 'hi' }]);
  assert.strictEqual(r.kind, 'busy'); checks++;

  cfg.openRouterApiKey = '';
  r = await openrouter.chatStream([{ role: 'user', content: 'hi' }]);
  assert.deepStrictEqual([r.ok, r.kind], [false, 'key']); checks++;
  assert(/OpenRouter API key/.test(r.message), r.message); checks++;
})().then(() => {
  console.log('security-and-parsers checks passed: ' + checks + ' assertions across extracted-source execution, packaging contract, and security invariants');
}).catch(e => { console.error(e); process.exit(1); });
