'use strict';

// main/services/ai.js - Luma (Claude Haiku 5.5 through OpenRouter, with the user's own key).

const { app, ipcMain } = require('electron');
const fs = require('fs');
const https = require('https');
const openrouter = require('../../openrouter');
const { state, config } = require('../state');
const { LUMA_KEY_PATH, saveConfig, saveLumaKey, scrubApiKeysFromConfigFiles } = require('../config/config');

function register() {
  openrouter.setDeps({
    config, saveConfig, mainWindow: () => state.mainWindow
  });

  ipcMain.handle('ai:getStatus', () => ({
    hasKey: !!config.openRouterApiKey,
    model: config.lumaModel || openrouter.DEFAULT_MODEL,
    keyPage: openrouter.KEY_PAGE_URL,
    creditsPage: openrouter.CREDITS_URL
  }));

  // Checks the key with OpenRouter, then finds Haiku 5.5 in its catalogue and
  // stores that id. The key is only saved when both checks pass (or when
  // OpenRouter itself can't be reached, which is treated as "unknown").
  ipcMain.handle('ai:setKey', async (_, key) => {
    const k = openrouter.normalizeKey(key);
    if (!openrouter.isPlausibleKey(k)) throw new Error('That doesn’t look like an OpenRouter API key');
    const check = await openrouter.verifyKey(k);
    if (check.ok === false) throw new Error(check.message);
    const ids = await openrouter.listModelIds();
    let model = openrouter.DEFAULT_MODEL;
    if (ids) {
      model = openrouter.resolveLumaModel(ids);
      if (!model) throw new Error('OpenRouter doesn’t offer Claude Haiku 5.5 to this account right now');
    }
    saveLumaKey(k);
    config.openRouterApiKey = k;
    config.lumaModel = model;
    saveConfig();
    scrubApiKeysFromConfigFiles();
    return true;
  });

  ipcMain.handle('ai:clearKey', () => {
    config.openRouterApiKey = '';
    try { if (fs.existsSync(LUMA_KEY_PATH)) fs.unlinkSync(LUMA_KEY_PATH); } catch (err) {
      throw new Error('Could not remove stored API key');
    }
    scrubApiKeysFromConfigFiles();
    return true;
  });

  ipcMain.handle('ai:send', async (_, messages) => {
    const r = await openrouter.chatStream(messages);
    return { ok: r.ok, error: r.ok ? null : r.message, kind: r.ok ? null : (r.kind || 'other') };
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
    openrouter.abortChat();
    return true;
  });
}

module.exports = {
  register,
};
