'use strict';

// openrouter.js — Electron-free OpenRouter client for Luma.
// Luma sends its chats straight to Claude Haiku 5.5 through OpenRouter, with the
// user's own OpenRouter API key and low reasoning effort. Streaming runs in the
// main process only: the renderer never sees the key or the network.

const https = require('https');
const { StringDecoder } = require('string_decoder');

const API_HOST = 'openrouter.ai';
const API_PATH = '/api/v1';
const KEY_PAGE_URL = 'https://openrouter.ai/keys';
const CREDITS_URL = 'https://openrouter.ai/credits';
const APP_REFERER = 'https://github.com/kodex-2408/AnimeVault';
const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';
const REASONING = { effort: 'low' };
const MAX_TOKENS = 4096;
const REQUEST_TIMEOUT_MS = 60000;

let _deps = null;
let _activeReq = null;

function setDeps(deps) {
  _deps = deps;
}

function d() {
  if (!_deps) throw new Error('openrouter module not initialized - call setDeps() first');
  return _deps;
}

function pushToRenderer(channel, payload) {
  try {
    const mw = d().mainWindow();
    if (mw && !mw.isDestroyed()) mw.webContents.send(channel, payload);
  } catch (e) { /* window gone mid-stream */ }
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 40) return false;
  let total = 0;
  for (const m of messages) {
    if (!m || typeof m !== 'object') return false;
    if (m.role !== 'system' && m.role !== 'user' && m.role !== 'assistant') return false;
    if (typeof m.content !== 'string' || !m.content.trim()) return false;
    total += m.content.length;
    if (total > 200000) return false;
  }
  return true;
}

// OpenRouter keys look like "sk-or-v1-<hex>". Accept any single printable token
// of a sensible length; OpenRouter itself decides whether it works.
function isPlausibleKey(key) {
  return typeof key === 'string' && /^[\x21-\x7e]{20,256}$/.test(key) && !/["'`]/.test(key);
}

// Pasted keys often carry quotes or a "NAME=" prefix from a .env line.
function normalizeKey(raw) {
  let k = String(raw || '').trim();
  k = k.replace(/^(?:export\s+)?[A-Z_]*(?:API_?KEY|KEY)\s*[=:]\s*/i, '');
  k = k.replace(/^["'`]+|["'`]+$/g, '').trim();
  return k;
}

// Model ids are JSON values here, but keep them to OpenRouter's id shape.
function safeModelId(model) {
  const m = String(model || '').trim();
  return /^[a-z0-9][a-z0-9._\-/:]{2,120}$/i.test(m) ? m : DEFAULT_MODEL;
}

// Picks Haiku 5.5 out of OpenRouter's model list. Exact id first, then any
// variant of it (a ":beta" suffix, for example). Returns null when absent.
function resolveLumaModel(ids) {
  const list = (Array.isArray(ids) ? ids : []).map(String);
  if (list.includes(DEFAULT_MODEL)) return DEFAULT_MODEL;
  const variant = list.filter(id => /^anthropic\/claude-haiku-5[.-]5(?::|$)/.test(id)).sort();
  return variant.length ? variant[0] : null;
}

// OpenAI-style messages plus low reasoning effort.
function toOpenRouterRequest(messages, model) {
  return {
    model: safeModelId(model),
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    stream: true,
    reasoning: REASONING,
    max_tokens: MAX_TOKENS,
  };
}

// Text from one streamed chunk. Reasoning deltas are never shown.
function extractText(json) {
  const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
  if (!choice) return '';
  const part = choice.delta || choice.message || {};
  return typeof part.content === 'string' ? part.content : '';
}

// Splits complete "data:" lines out of `buffer`. Returns the unfinished tail,
// whether any text was emitted, and the first error sent inside the stream.
function drainSse(buffer, onText) {
  let gotText = false;
  let error = null;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line.startsWith('data:')) continue; // comments such as ": OPENROUTER PROCESSING"
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let json;
    try { json = JSON.parse(payload); } catch (e) { continue; }
    if (json.error) { error = (json.error && json.error.message) || 'The model stopped early'; continue; }
    const text = extractText(json);
    if (text) { gotText = true; onText(text); }
  }
  return { rest: buffer, gotText, error };
}

// OpenRouter error bodies: {"error":{"message":...,"code":...}}.
// Kinds: key (bad key), quota (no credits / rate limit), busy (provider or
// OpenRouter overloaded), other.
function apiError(status, raw, retryAfter) {
  let apiMessage = '';
  try {
    const j = JSON.parse(raw);
    if (j && j.error && j.error.message) apiMessage = String(j.error.message);
  } catch (e) { /* not JSON */ }
  const detail = apiMessage ? ': ' + apiMessage : '';
  if (status === 401) return { status, kind: 'key', message: 'OpenRouter rejected this API key' + detail };
  if (status === 402) return { status, kind: 'quota', message: 'This OpenRouter account has no credits left' + detail };
  if (status === 429) {
    const wait = parseInt(retryAfter, 10);
    const when = Number.isFinite(wait) && wait > 0 ? ' — try again in about ' + wait + ' seconds' : '';
    return { status, kind: 'quota', message: 'OpenRouter is rate-limiting this key' + detail + when };
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return { status, kind: 'busy', message: 'OpenRouter or the model provider is overloaded right now' + detail };
  }
  return { status, kind: 'other', message: 'HTTP ' + status + detail };
}

function requestStream(apiKey, body, onText) {
  return new Promise((resolve) => {
    const postData = JSON.stringify(body);
    const req = https.request({
      hostname: API_HOST,
      path: API_PATH + '/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Content-Length': Buffer.byteLength(postData),
        'HTTP-Referer': APP_REFERER,
        'X-Title': 'AnimeVault',
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        let raw = '';
        res.on('data', c => { if (raw.length < 4000) raw += c; });
        res.on('end', () => resolve({ ok: false, ...apiError(res.statusCode, raw, res.headers['retry-after']) }));
        res.on('error', (e) => resolve({ ok: false, kind: 'other', message: e.message }));
        return;
      }
      const decoder = new StringDecoder('utf8');
      let buffer = '';
      let gotText = false;
      let streamError = null;
      res.on('data', (chunk) => {
        const r = drainSse(buffer + decoder.write(chunk), onText);
        buffer = r.rest;
        gotText = gotText || r.gotText;
        streamError = streamError || r.error;
      });
      res.on('end', () => {
        if (streamError) resolve({ ok: false, kind: 'other', message: streamError, gotText });
        else resolve({ ok: true, gotText });
      });
      res.on('error', (e) => resolve({ ok: false, kind: 'other', message: e.message, gotText }));
    });
    req.on('error', (e) => resolve({ ok: false, kind: 'other', message: e.message }));
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('OpenRouter did not answer within 60 seconds')));
    _activeReq = req;
    req.write(postData);
    req.end();
  });
}

// Streams a reply. Emits to the renderer:
//   ai:chunk {text}   ai:done {}   ai:error {message, kind}
// Resolves {ok, message, kind} so callers can surface failures in the UI.
async function chatStream(messages) {
  abortChat();
  const fail = (message, kind = 'other') => { pushToRenderer('ai:error', { message, kind }); return { ok: false, message, kind }; };
  try {
    const cfg = d().config;
    const apiKey = String(cfg.openRouterApiKey || '');
    if (!apiKey) return fail('No OpenRouter API key configured', 'key');
    if (!validateMessages(messages)) return fail('Invalid conversation payload');
    const onText = (text) => pushToRenderer('ai:chunk', { text });
    const send = d().request || requestStream;
    const r = await send(apiKey, toOpenRouterRequest(messages, cfg.lumaModel), onText);
    _activeReq = null;
    if (!r.ok) return fail(r.message || 'OpenRouter request failed', r.kind || 'other');
    pushToRenderer('ai:done', {});
    return { ok: true };
  } catch (err) {
    _activeReq = null;
    return fail(err.message || 'Failed to start the OpenRouter request');
  }
}

// Model ids of OpenRouter's public catalogue, or null when it can't be reached.
function listModelIds() {
  return new Promise((resolve) => {
    const req = https.request({ hostname: API_HOST, path: API_PATH + '/models', method: 'GET', headers: { 'Accept': 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      let raw = '';
      res.on('data', c => { if (raw.length < 4000000) raw += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(raw);
          resolve(Array.isArray(j.data) ? j.data.map(m => m && m.id).filter(Boolean) : null);
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// Asks OpenRouter whether the key works (key info only, no tokens used).
// Resolves {ok:true}, {ok:false,message} for a rejected key, or {ok:null} when
// OpenRouter can't be reached (the caller then saves the key anyway).
function verifyKey(apiKey) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: API_HOST,
      path: API_PATH + '/auth/key',
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + apiKey },
    }, (res) => {
      let raw = '';
      res.on('data', c => { if (raw.length < 4000) raw += c; });
      res.on('end', () => {
        if (res.statusCode === 200) return resolve({ ok: true });
        const err = apiError(res.statusCode, raw);
        resolve(res.statusCode === 401 || res.statusCode === 403 ? { ok: false, message: err.message } : { ok: null, message: err.message });
      });
    });
    req.on('error', (e) => resolve({ ok: null, message: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: null, message: 'timeout' }); });
    req.end();
  });
}

function abortChat() {
  if (_activeReq) {
    try { _activeReq.destroy(); } catch (e) {}
    _activeReq = null;
  }
}

module.exports = {
  setDeps,
  chatStream,
  abortChat,
  validateMessages,
  isPlausibleKey,
  normalizeKey,
  verifyKey,
  listModelIds,
  resolveLumaModel,
  safeModelId,
  toOpenRouterRequest,
  extractText,
  drainSse,
  apiError,
  DEFAULT_MODEL,
  KEY_PAGE_URL,
  CREDITS_URL,
};
