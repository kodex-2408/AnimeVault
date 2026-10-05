'use strict';

// main/services/ai.js - Luma (Google Gemini with the user's own AI Studio key).

const { app, ipcMain } = require('electron');
const fs = require('fs');
const https = require('https');
const gemini = require('../../gemini');
const { state, config } = require('../state');
const { GEMINI_KEY_PATH, saveConfig, saveGeminiKey, scrubApiKeysFromConfigFiles } = require('../config/config');

function register() {
  gemini.setDeps({
    config, saveConfig, mainWindow: () => state.mainWindow
  });

  ipcMain.handle('ai:getStatus', () => ({
    hasKey: !!config.geminiApiKey,
    model: config.geminiModel || gemini.DEFAULT_MODEL,
    keyPage: gemini.KEY_PAGE_URL
  }));

  ipcMain.handle('ai:setKey', async (_, key) => {
    const k = gemini.normalizeKey(key);
    if (!gemini.isPlausibleKey(k)) throw new Error('That doesn’t look like a Google AI Studio key');
    const check = await gemini.verifyKey(k, config.geminiModel);
    if (check.ok === false) throw new Error('Google rejected this key: ' + check.message);
    saveGeminiKey(k);
    config.geminiApiKey = k;
    scrubApiKeysFromConfigFiles();
    return true;
  });

  ipcMain.handle('ai:clearKey', () => {
    config.geminiApiKey = '';
    try { if (fs.existsSync(GEMINI_KEY_PATH)) fs.unlinkSync(GEMINI_KEY_PATH); } catch (err) {
      throw new Error('Could not remove stored API key');
    }
    scrubApiKeysFromConfigFiles();
    return true;
  });

  ipcMain.handle('ai:setModel', (_, model) => {
    config.geminiModel = gemini.safeModelId(model);
    saveConfig();
    return true;
  });

  ipcMain.handle('ai:send', async (_, messages, model, options) => {
    const r = await gemini.chatStream(messages, model, options);
    return { ok: r.ok, error: r.ok ? null : r.message };
  });

  ipcMain.handle('ai:webSearch', async (_, query) => {
    if (!query || typeof query !== 'string') return { results: [] };
    return new Promise((resolve) => {
      const q = encodeURIComponent(query.trim().slice(0, 200));
      const req = https.get('https://api.duckduckgo.com/?q=' + q + '&format=json&no_html=1&skip_disambig=1', {
        headers: { 'User-Agent': 'AnimeVault/' + app.getVersion() + ' (Desktop App)' }
      }, (res) => {
        let data = '';
        res.on('data', c => { if (data.length < 50000) data += c; });
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            const results = [];
            if (j.AbstractText) results.push({ title: j.Heading || query, snippet: j.AbstractText, url: j.AbstractURL });
            if (Array.isArray(j.RelatedTopics)) {
              j.RelatedTopics.slice(0, 5).forEach(t => {
                if (t.Text && t.FirstURL) results.push({ title: t.Text.slice(0, 60), snippet: t.Text, url: t.FirstURL });
              });
            }
            resolve({ results });
          } catch (e) { resolve({ results: [] }); }
        });
        res.on('error', () => resolve({ results: [] }));
      });
      req.on('error', () => resolve({ results: [] }));
      req.setTimeout(8000, () => { req.destroy(); resolve({ results: [] }); });
    });
  });

  ipcMain.handle('ai:stop', () => {
    gemini.abortChat();
    return true;
  });
}

module.exports = {
  register,
};
