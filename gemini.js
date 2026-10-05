'use strict';

// gemini.js — Electron-free Google Gemini chat client for Luma.
// Uses the user's own free Google AI Studio key. Streaming SSE runs in the
// main process only: the renderer never sees the key or touches the network.

const https = require('https');

const DEFAULT_MODEL = 'gemini-flash-latest';
// Tried in order when a model's free-tier quota is used up (each model has its
// own quota) or the model isn't available to the key.
const FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const KEY_PAGE_URL = 'https://aistudio.google.com/apikey';

let _deps = null;
let _activeReq = null;
// model -> timestamp until which it is skipped after a quota error
const _quotaBlocked = new Map();

function setDeps(deps) {
  _deps = deps;
}

function d() {
  if (!_deps) throw new Error('gemini module not initialized - call setDeps() first');
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

// AI Studio keys come in more than one format: classic "AIza…" keys and
// newer ones with other prefixes and dots (e.g. "AQ.…"). Accept any single
// token of printable ASCII; Google itself decides whether it works.
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

// Model ids are path segments of the API URL: keep them to a strict charset.
function safeModelId(model) {
  const m = String(model || '').trim().replace(/^models\//, '');
  return /^[a-z0-9][a-z0-9.\-]{1,80}$/.test(m) ? m : DEFAULT_MODEL;
}

// OpenAI-style messages -> Gemini request body.
function toGeminiRequest(messages, options = {}) {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  // Turns must alternate; a failed reply leaves two user turns in a row.
  const contents = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += '\n\n' + m.content;
    else contents.push({ role, parts: [{ text: m.content }] });
  }
  const body = { contents, generationConfig: { temperature: 0.7 } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (options.webSearch) body.tools = [{ google_search: {} }];
  return body;
}

// Text from one streamed GenerateContentResponse; "thought" parts are skipped.
function extractText(json) {
  const parts = json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts;
  if (!Array.isArray(parts)) return '';
  return parts.filter(p => p && typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
}

// Google error body -> {message, retryDelay (seconds), quotaIds}. Quota errors
// carry QuotaFailure (which quota) and RetryInfo (how long to wait) details.
function parseApiError(status, raw) {
  let message = 'HTTP ' + status;
  let retryDelay = 0;
  const quotaIds = [];
  try {
    const j = JSON.parse(raw);
    const e = Array.isArray(j) ? j[0] && j[0].error : j.error;
    if (e && e.message) message += ': ' + e.message;
    for (const det of (e && Array.isArray(e.details) ? e.details : [])) {
      const type = String(det && det['@type'] || '');
      if (/RetryInfo$/.test(type)) retryDelay = parseFloat(det.retryDelay) || 0;
      if (/QuotaFailure$/.test(type) && Array.isArray(det.violations)) det.violations.forEach(v => v && v.quotaId && quotaIds.push(String(v.quotaId)));
    }
  } catch (e) {}
  return { message, retryDelay, quotaIds };
}

// 500 / 503 / 504: Google is overloaded or had a hiccup.
function isBusyStatus(status) { return status === 500 || status === 503 || status === 504; }

function quotaIsDaily(r) {
  return (r.quotaIds || []).some(q => /PerDay/i.test(q)) || /limit: 0\b/.test(r.message || '');
}

// What Luma says when every model is out of quota.
function quotaMessage(r) {
  if (quotaIsDaily(r)) return 'Google\u2019s free daily limit for your AI Studio key is used up. It resets at midnight Pacific time \u2014 or enable billing on the key for more.';
  const wait = Math.max(5, Math.ceil(r.retryDelay || 60));
  return 'Google\u2019s free per-minute limit for your AI Studio key is used up. Try again in about ' + (wait >= 90 ? Math.round(wait / 60) + ' minutes' : wait + ' seconds') + '.';
}

function requestStream(apiKey, model, body, onText) {
  return new Promise((resolve) => {
    const postData = JSON.stringify(body);
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        let raw = '';
        res.on('data', c => { if (raw.length < 4000) raw += c; });
        res.on('end', () => resolve(Object.assign({ ok: false, status: res.statusCode }, parseApiError(res.statusCode, raw))));
        res.on('error', (e) => resolve({ ok: false, message: e.message }));
        return;
      }
      let buffer = '';
      let gotText = false;
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          try {
            const json = JSON.parse(line.slice(5).trim());
            if (json.error && json.error.message) { pushToRenderer('ai:error', { message: json.error.message }); continue; }
            const text = extractText(json);
            if (text) { gotText = true; onText(text); }
          } catch (e) { /* partial frames are expected */ }
        }
      });
      res.on('end', () => resolve({ ok: true, gotText }));
      res.on('error', (e) => resolve({ ok: false, message: e.message }));
    });
    req.on('error', (e) => resolve({ ok: false, message: e.message }));
    req.setTimeout(45000, () => req.destroy(new Error('Gemini request timed out after 45s')));
    _activeReq = req;
    req.write(postData);
    req.end();
  });
}

// Streams a completion. Emits to the renderer:
//   ai:chunk {text}   ai:done {}   ai:error {message}
// Resolves {ok, message} so callers can surface failures in UI.
async function chatStream(messages, model, options = {}) {
  abortChat();
  const fail = (msg, kind = 'other') => { pushToRenderer('ai:error', { message: msg, kind }); return { ok: false, message: msg, kind }; };
  try {
    const cfg = d().config;
    const apiKey = String(cfg.geminiApiKey || '');
    if (!apiKey) return fail('No Google AI Studio key configured', 'key');
    if (!validateMessages(messages)) return fail('Invalid conversation payload');
    const safeModel = safeModelId(model || cfg.geminiModel);
    let webSearch = !options || options.webSearch !== false;
    const onText = (text) => pushToRenderer('ai:chunk', { text });
    const send = d().request || requestStream;
    const now = Date.now();
    const all = [safeModel].concat(FALLBACK_MODELS.filter(m => m !== safeModel));
    const ready = all.filter(m => !(_quotaBlocked.get(m) > now));
    let r = null;
    let lastQuota = null;
    let lastBusy = null;
    for (const m of (ready.length ? ready : all)) {
      r = await send(apiKey, m, toGeminiRequest(messages, { webSearch }), onText);
      // Google Search grounding has its own (often zero) free quota and isn't on
      // every key/tier: answer without it.
      if (!r.ok && !r.gotText && webSearch && (r.status === 429 || (r.status === 400 && /search|tool|ground/i.test(r.message || '')))) {
        webSearch = false;
        r = await send(apiKey, m, toGeminiRequest(messages, { webSearch }), onText);
      }
      if (r.ok || r.gotText) break;
      if (r.status === 429) {
        lastQuota = r;
        _quotaBlocked.set(m, Date.now() + (quotaIsDaily(r) ? 3600000 : Math.max(30, r.retryDelay || 60) * 1000));
        continue;
      }
      if (isBusyStatus(r.status)) {
        // "This model is currently experiencing high demand": Google-side
        // overload, usually brief and per model - try the next one.
        lastBusy = r;
        _quotaBlocked.set(m, Date.now() + 120000);
        continue;
      }
      if (r.status === 404) continue; // model retired or not offered to this key
      break;
    }
    if (r && !r.ok && r.status === 404 && (lastQuota || lastBusy)) r = lastQuota || lastBusy;
    if (r && !r.ok && r.status === 429) r = { ok: false, kind: 'quota', message: quotaMessage(r) };
    else if (r && !r.ok && isBusyStatus(r.status)) {
      r = lastQuota ? { ok: false, kind: 'quota', message: quotaMessage(lastQuota) }
        : { ok: false, kind: 'busy', message: 'Google\u2019s Gemini servers are overloaded right now (HTTP ' + r.status + '). This isn\u2019t a problem with your key \u2014 try again in a minute.' };
    }
    _activeReq = null;
    if (!r.ok) return fail(r.message || 'Gemini request failed', r.kind || (r.status === 400 || r.status === 401 || r.status === 403 ? 'key' : 'other'));
    pushToRenderer('ai:done', {});
    return { ok: true };
  } catch (err) {
    _activeReq = null;
    return fail(err.message || 'Failed to start the Gemini request');
  }
}

// Asks Google whether the key works (model metadata only — no tokens used).
// Resolves {ok:true}, {ok:false,message} for a rejected key, or {ok:null} when
// Google can't be reached (the caller then saves the key anyway).
function verifyKey(apiKey, model) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${encodeURIComponent(safeModelId(model))}`,
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey },
    }, (res) => {
      let raw = '';
      res.on('data', c => { if (raw.length < 4000) raw += c; });
      res.on('end', () => {
        if (res.statusCode === 200) return resolve({ ok: true });
        let msg = 'HTTP ' + res.statusCode;
        try { const j = JSON.parse(raw); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
        resolve(res.statusCode === 400 || res.statusCode === 401 || res.statusCode === 403 ? { ok: false, message: msg } : { ok: null, message: msg });
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
  parseApiError,
  quotaMessage,
  FALLBACK_MODELS,
  _resetQuota: () => _quotaBlocked.clear(),
  verifyKey,
  safeModelId,
  toGeminiRequest,
  extractText,
  DEFAULT_MODEL,
  KEY_PAGE_URL,
};
