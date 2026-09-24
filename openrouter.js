'use strict';

// openrouter.js — Electron-free OpenRouter chat client.
// Streaming SSE from main process only: the renderer never touches the
// network or the API key, so the CSP stays untouched.

const https = require('https');

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

// Streams a completion. Emits to the renderer:
//   ai:chunk {text}   ai:done {}   ai:error {message}
// Resolves {ok, message} so callers can surface failures in UI.
function chatStream(messages, model, options = {}) {
  return new Promise((resolve) => {
    try {
      abortChat();
      const cfg = d().config;
      const apiKey = String(cfg.openrouterApiKey || '');
      if (!apiKey) {
        const msg = 'No OpenRouter API key configured';
        pushToRenderer('ai:error', { message: msg });
        resolve({ ok: false, message: msg });
        return;
      }
      if (!validateMessages(messages)) {
        const msg = 'Invalid conversation payload';
        pushToRenderer('ai:error', { message: msg });
        resolve({ ok: false, message: msg });
        return;
      }
      let safeModel = String(model || cfg.openrouterModel || 'google/gemini-3.5-flash-lite').replace(/[^\w.\-/:-]/g, '').slice(0, 120);
      if (!safeModel || safeModel === 'google/gemini-3.7-flash') safeModel = 'google/gemini-3.5-flash-lite';

      const payload = {
        model: safeModel,
        messages,
        stream: true,
        reasoning: { effort: 'high' }
      };

      if (!options || options.webSearch !== false) {
        payload.plugins = [{ id: 'web', max_results: 5 }];
      }

      const postData = JSON.stringify(payload);
      const req = https.request({
        hostname: 'openrouter.ai',
        path: '/api/v1/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        if (res.statusCode !== 200) {
          let body = '';
          res.on('data', c => { if (body.length < 4000) body += c; });
          res.on('end', () => {
            _activeReq = null;
            let msg = 'HTTP ' + res.statusCode;
            try { const j = JSON.parse(body); if (j.error && j.error.message) msg += ': ' + j.error.message; } catch (e) {}
            pushToRenderer('ai:error', { message: msg });
            resolve({ ok: false, message: msg });
          });
          res.on('error', (e) => {
            _activeReq = null;
            pushToRenderer('ai:error', { message: e.message });
            resolve({ ok: false, message: e.message });
          });
          return;
        }
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          let idx;
          while ((idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const json = JSON.parse(data);
              if (json.error && json.error.message) {
                pushToRenderer('ai:error', { message: json.error.message });
                continue;
              }
              const delta = json.choices && json.choices[0] && json.choices[0].delta;
              // Only extract actual response content — filter out internal thinking/reasoning deltas
              const text = delta ? (delta.content || (typeof delta === 'string' ? delta : '')) : (json.choices && json.choices[0] && json.choices[0].text);
              if (typeof text === 'string' && text) pushToRenderer('ai:chunk', { text });
            } catch (e) { /* partial frames and comments are expected */ }
          }
        });
        res.on('end', () => {
          _activeReq = null;
          pushToRenderer('ai:done', {});
          resolve({ ok: true });
        });
        res.on('error', (e) => {
          _activeReq = null;
          pushToRenderer('ai:error', { message: e.message });
          resolve({ ok: false, message: e.message });
        });
      });
      req.on('error', (e) => {
        _activeReq = null;
        pushToRenderer('ai:error', { message: e.message });
        resolve({ ok: false, message: e.message });
      });
      req.setTimeout(35000, () => {
        req.destroy(new Error('OpenRouter request timed out after 35s'));
      });
      _activeReq = req;
      req.write(postData);
      req.end();
    } catch (err) {
      _activeReq = null;
      const msg = err.message || 'Failed to initiate chat request';
      pushToRenderer('ai:error', { message: msg });
      resolve({ ok: false, message: msg });
    }
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
};
