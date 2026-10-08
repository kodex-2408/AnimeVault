'use strict';

// luma-openrouter.test.js
//
// Drives the REAL openrouter.js network code against a stand-in for Node's
// https module that behaves like OpenRouter (status codes, SSE frames split at
// arbitrary byte boundaries, citations). Locks in:
//   - the exact request: host, path, headers, JSON body (model, low reasoning,
//     streaming, web plugin only when asked)
//   - streamed text reaches the renderer, reasoning never does, multi-byte
//     characters survive chunk boundaries
//   - web-search citations become de-duplicated, http(s)-only source links
//   - a rejected web plugin retries once without it and says so
//   - every error class maps to the right kind and message
//   - key and model checks (/key then /auth/key, catalogue lookup)
//   - the key appears nowhere except the Authorization header

const assert = require('assert');
const https = require('https');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const openrouter = require('../openrouter');

let checks = 0;
const KEY = 'sk-or-v1-' + 'f3'.repeat(32);
const calls = [];
let handler = null;

// Minimal ClientRequest + IncomingMessage stand-ins.
https.request = (options, cb) => {
  const req = new EventEmitter();
  const chunks = [];
  req.write = (c) => { chunks.push(Buffer.from(c)); };
  req.setTimeout = () => {};
  req.destroy = (err) => { if (err) setImmediate(() => req.emit('error', err)); };
  req.end = () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    const call = { options, body };
    calls.push(call);
    const reply = handler(call);
    const res = new PassThrough();
    res.statusCode = reply.status;
    res.headers = reply.headers || {};
    setImmediate(() => {
      cb(res);
      for (const part of reply.parts || []) res.write(part);
      res.end();
    });
  };
  return req;
};

const sse = (obj) => 'data: ' + JSON.stringify(obj) + '\n\n';
const delta = (content, extra) => sse({ choices: [{ delta: Object.assign({ content }, extra || {}) }] });
const cite = (url, title) => ({ annotations: [{ type: 'url_citation', url_citation: { url, title } }] });

const events = [];
const cfg = { openRouterApiKey: KEY, lumaModel: 'anthropic/claude-haiku-5.5' };
openrouter.setDeps({ config: cfg, mainWindow: () => ({ isDestroyed: () => false, webContents: { send: (ch, p) => events.push([ch, p]) } }) });
const textOf = () => events.filter(e => e[0] === 'ai:chunk').map(e => e[1].text).join('');
const last = (ch) => events.filter(e => e[0] === ch).pop();
const reset = () => { events.length = 0; calls.length = 0; };
const msgs = [{ role: 'system', content: 'You are Luma' }, { role: 'user', content: 'When does Frieren season 2 air?' }];

(async () => {
  // ---- plain chat: request shape + streaming
  reset();
  const smile = Buffer.from(delta('Hi ✨ there'), 'utf8');
  const cut = smile.indexOf(0xE2) + 1; // split inside the 3-byte "✨"
  handler = () => ({ status: 200, parts: [Buffer.from(': OPENROUTER PROCESSING\n\n'), delta(null, { reasoning: 'thinking about it' }), smile.subarray(0, cut), smile.subarray(cut), 'data: [DONE]\n\n'] });
  let r = await openrouter.chatStream(msgs, { webSearch: false });
  assert.deepStrictEqual([r.ok, r.sources], [true, 0]); checks++;
  const c = calls[0];
  assert.deepStrictEqual([c.options.hostname, c.options.path, c.options.method], ['openrouter.ai', '/api/v1/chat/completions', 'POST']); checks++;
  assert.strictEqual(c.options.headers.Authorization, 'Bearer ' + KEY); checks++;
  assert.strictEqual(c.options.headers['Content-Type'], 'application/json'); checks++;
  assert.deepStrictEqual([c.body.model, c.body.stream, c.body.reasoning], ['anthropic/claude-haiku-5.5', true, { effort: 'low' }]); checks++;
  assert.strictEqual(c.body.plugins, undefined, 'no web plugin unless asked'); checks++;
  assert.deepStrictEqual(c.body.messages, msgs); checks++;
  assert.strictEqual(textOf(), 'Hi ✨ there', 'multi-byte characters survive chunk boundaries, reasoning stays hidden'); checks++;
  assert(last('ai:done'), 'done event sent'); checks++;
  assert(!JSON.stringify(c.body).includes(KEY) && !JSON.stringify(events).includes(KEY), 'the key is only ever in the Authorization header'); checks++;

  // ---- web search: plugin on, citations -> sources
  reset();
  handler = () => ({ status: 200, parts: [
    delta('Season 2 starts '), delta('in January.'),
    sse({ choices: [{ delta: cite('https://example.com/frieren-s2', 'Frieren S2 date') }] }),
    sse({ choices: [{ delta: Object.assign(cite('https://example.com/frieren-s2', 'dup'), {}) }] }),
    sse({ choices: [{ delta: cite('javascript:alert(1)', 'bad') }] }),
    sse({ choices: [{ delta: cite('https://news.example.org/a', 'News') }] }),
    'data: [DONE]\n\n'] });
  r = await openrouter.chatStream(msgs, { webSearch: true });
  assert.deepStrictEqual(calls[0].body.plugins, [{ id: 'web', max_results: 3 }], 'web plugin with a small result cap'); checks++;
  assert.strictEqual(r.sources, 2, 'duplicates and non-http links are dropped'); checks++;
  assert.deepStrictEqual(last('ai:sources')[1].sources.map(s => s.url), ['https://example.com/frieren-s2', 'https://news.example.org/a']); checks++;
  const order = events.map(e => e[0]);
  assert(order.lastIndexOf('ai:sources') < order.lastIndexOf('ai:done'), 'sources arrive before done'); checks++;

  // ---- rejected web plugin: retry once without it, and say so
  reset();
  handler = (call) => (call.body.plugins
    ? { status: 400, parts: [JSON.stringify({ error: { message: 'plugins not supported' } })] }
    : { status: 200, parts: [delta('Answering from memory.'), 'data: [DONE]\n\n'] });
  r = await openrouter.chatStream(msgs, { webSearch: true });
  assert.deepStrictEqual([r.ok, r.searchSkipped, calls.length], [true, true, 2]); checks++;
  assert.strictEqual(calls[1].body.plugins, undefined); checks++;
  assert(/Web search wasn’t available/.test(textOf()), 'the user is told search was skipped'); checks++;

  // ---- a rejected reasoning setting: step down again (web off, then reasoning off)
  reset();
  handler = (call) => (call.body.reasoning
    ? { status: 400, parts: [JSON.stringify({ error: { message: 'reasoning not supported' } })] }
    : { status: 200, parts: [delta('Fine without it.'), 'data: [DONE]\n\n'] });
  r = await openrouter.chatStream(msgs, { webSearch: true });
  assert.strictEqual(r.ok, true); checks++;
  assert.deepStrictEqual(calls.map(x => [!!x.body.plugins, !!x.body.reasoning]), [[true, true], [false, true], [false, false]], 'drops the plugin first, then the reasoning setting'); checks++;
  assert.strictEqual(r.searchSkipped, true); checks++;

  // a request that is simply bad fails every step and reports the last error
  reset();
  handler = () => ({ status: 400, parts: [JSON.stringify({ error: { message: 'context too long' } })] });
  r = await openrouter.chatStream(msgs, { webSearch: false });
  assert.deepStrictEqual([r.ok, /context too long/.test(r.message), calls.length], [false, true, 2], 'two steps without web search, then the error'); checks++;

  // an error after text started is never retried (it would repeat the answer)
  reset();
  handler = () => ({ status: 200, parts: [delta('Part one. '), sse({ error: { message: 'Provider disconnected' } })] });
  r = await openrouter.chatStream(msgs, { webSearch: true });
  assert.deepStrictEqual([r.ok, calls.length], [false, 1]); checks++;

  // ---- error classes
  const failWith = async (status, body, headers) => {
    reset();
    handler = () => ({ status, headers, parts: [JSON.stringify(body)] });
    return openrouter.chatStream(msgs, { webSearch: false });
  };
  r = await failWith(401, { error: { message: 'No auth credentials found' } });
  assert.deepStrictEqual([r.ok, r.kind], [false, 'key']); checks++;
  assert(/rejected this API key/.test(r.message)); checks++;
  assert.strictEqual(calls.length, 1, 'no retry on a bad key'); checks++;
  r = await failWith(402, { error: { message: 'Insufficient credits' } });
  assert.deepStrictEqual([r.kind, /no credits left/.test(r.message)], ['quota', true]); checks++;
  r = await failWith(429, { error: { message: 'Rate limit' } }, { 'retry-after': '20' });
  assert.deepStrictEqual([r.kind, /about 20 seconds/.test(r.message)], ['quota', true]); checks++;
  r = await failWith(503, { error: { message: 'Provider returned error' } });
  assert.deepStrictEqual([r.kind, /overloaded/.test(r.message)], ['busy', true]); checks++;
  r = await failWith(404, { error: { message: 'No endpoints found for anthropic/claude-haiku-5.5' } });
  assert.deepStrictEqual([r.kind, /No endpoints found/.test(r.message)], ['other', true]); checks++;
  assert.strictEqual(last('ai:error')[1].kind, 'other', 'errors are sent to the UI with their kind'); checks++;

  // error frame inside an otherwise 200 stream
  reset();
  handler = () => ({ status: 200, parts: [delta('Part'), sse({ error: { message: 'Provider disconnected' } })] });
  r = await openrouter.chatStream(msgs, {});
  assert.deepStrictEqual([r.ok, r.message], [false, 'Provider disconnected']); checks++;

  // ---- key and model checks
  reset();
  handler = (call) => (call.options.path === '/api/v1/key' ? { status: 200, parts: ['{"data":{}}'] } : { status: 500, parts: [''] });
  assert.deepStrictEqual(await openrouter.verifyKey(KEY), { ok: true }); checks++;
  assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer ' + KEY); checks++;

  reset();
  handler = (call) => (call.options.path === '/api/v1/key' ? { status: 404, parts: [''] } : { status: 200, parts: ['{}'] });
  assert.strictEqual((await openrouter.verifyKey(KEY)).ok, true, 'falls back to the older /auth/key endpoint'); checks++;
  assert.deepStrictEqual(calls.map(x => x.options.path), ['/api/v1/key', '/api/v1/auth/key']); checks++;

  reset();
  handler = () => ({ status: 401, parts: [JSON.stringify({ error: { message: 'User not found.' } })] });
  const bad = await openrouter.verifyKey('sk-or-v1-wrong');
  assert.deepStrictEqual([bad.ok, /rejected this API key/.test(bad.message)], [false, true]); checks++;

  reset();
  handler = () => ({ status: 200, parts: [JSON.stringify({ data: [{ id: 'openai/gpt-4o' }, { id: 'anthropic/claude-haiku-5.5' }] })] });
  const ids = await openrouter.listModelIds();
  assert.strictEqual(openrouter.resolveLumaModel(ids), 'anthropic/claude-haiku-5.5'); checks++;
  assert.strictEqual(calls[0].options.headers.Authorization, undefined, 'the public model list needs no key'); checks++;
  handler = () => ({ status: 503, parts: [''] });
  assert.strictEqual(await openrouter.listModelIds(), null, 'an unreachable catalogue is reported as unknown'); checks++;

  console.log('luma-openrouter checks passed: ' + checks + ' assertions (request shape, streaming, web search + sources, retries, errors, key checks)');
})().catch((e) => { console.error(e); process.exit(1); });
