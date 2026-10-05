'use strict';

// gemini.js — Electron-free Google Gemini chat client for Luma.
// Uses the user's own free Google AI Studio key. Streaming SSE runs in the
// main process only: the renderer never sees the key or touches the network.

const https = require('https');

const DEFAULT_MODEL = 'gemini-flash-latest';
const KEY_PAGE_URL = 'https://aistudio.google.com/apikey';

let _deps = null;
let _activeReq = null;

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
  const contents = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
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
        res.on('end', () => {
          let msg = 'HTTP ' + res.statusCode;
          try { const j = JSON.parse(raw); const e = Array.isArray(j) ? j[0] && j[0].error : j.error; if (e && e.message) msg += ': ' + e.message; } catch (e) {}
          resolve({ ok: false, status: res.statusCode, message: msg });
        });
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
  const fail = (msg) => { pushToRenderer('ai:error', { message: msg }); return { ok: false, message: msg }; };
  try {
    const cfg = d().config;
    const apiKey = String(cfg.geminiApiKey || '');
    if (!apiKey) return fail('No Google AI Studio key configured');
    if (!validateMessages(messages)) return fail('Invalid conversation payload');
    const safeModel = safeModelId(model || cfg.geminiModel);
    const webSearch = !options || options.webSearch !== false;
    const onText = (text) => pushToRenderer('ai:chunk', { text });
    let r = await requestStream(apiKey, safeModel, toGeminiRequest(messages, { webSearch }), onText);
    // Google Search grounding isn't available on every key/tier: answer without it.
    if (!r.ok && webSearch && r.status === 400 && /search|tool|ground/i.test(r.message || '')) {
      r = await requestStream(apiKey, safeModel, toGeminiRequest(messages, { webSearch: false }), onText);
    }
    _activeReq = null;
    if (!r.ok) return fail(r.message || 'Gemini request failed');
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
  verifyKey,
  safeModelId,
  toGeminiRequest,
  extractText,
  DEFAULT_MODEL,
  KEY_PAGE_URL,
};
