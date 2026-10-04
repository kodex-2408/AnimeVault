'use strict';

// main/services/mal.js - MyAnimeList OAuth (PKCE loopback), API calls, list
// sync and status reconciliation.

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { config } = require('../state');
const { getWatchHistoryStore, mergeMalData, safeHistoryKey, safeMalId, saveConfig } = require('../config/config');

function malRequest(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    if (!config.malAccessToken) return reject(new Error('Not authenticated'));
    // MAL API v2 requires x-www-form-urlencoded for PATCH/POST, JSON is for GET
    const isForm = body && (method === 'PATCH' || method === 'POST');
    const postData = isForm
      ? new URLSearchParams(body).toString()
      : (body ? JSON.stringify(body) : '');
    const req = https.request({
      hostname: 'api.myanimelist.net',
      path: '/v2' + endpoint,
      method,
      headers: {
        'Authorization': 'Bearer ' + config.malAccessToken,
        'Content-Type': isForm ? 'application/x-www-form-urlencoded' : 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('MAL request timed out after 30s: ' + endpoint)); });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function malRefreshAccessToken() {
  try {
    const response = await new Promise((resolve, reject) => {
      const postData = new URLSearchParams({
        client_id: config.malClientId,
        client_secret: config.malClientSecret,
        grant_type: 'refresh_token',
        refresh_token: config.malRefreshToken
      }).toString();
      const req = https.request({
        hostname: 'myanimelist.net',
        path: '/v1/oauth2/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('MAL token refresh timed out after 15s')); });
      req.write(postData);
      req.end();
    });
    if (response.access_token) {
      config.malAccessToken = response.access_token;
      config.malRefreshToken = response.refresh_token;
      config.malTokenExpiry = Date.now() + (response.expires_in || 3600) * 1000;
      saveConfig();
      console.log('[MAL] Token refreshed');
      return true;
    }
    return false;
  } catch (e) {
    console.error('[MAL] Token refresh failed:', e.message);
    return false;
  }
}

async function malRequestWithRetry(endpoint, method = 'GET', body = null) {
  let r;
  try {
    r = await malRequest(endpoint, method, body);
  } catch (e) {
    console.error('[MAL] Initial request failed:', e.message);
    return { status: 0, data: null, error: e.message };
  }
  // If 401, try refreshing token and retry once
  if (r.status === 401 && config.malRefreshToken) {
    const refreshed = await malRefreshAccessToken();
    if (refreshed) {
      try { r = await malRequest(endpoint, method, body); }
      catch (e) { return { status: 0, data: null, error: e.message }; }
    }
  }
  return r;
}

function fuzzyTitleMatch(a, b) {
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  // Simple edit-distance-ish score
  let common = 0;
  const sa = new Set(na), sb = new Set(nb);
  for (const c of sa) if (sb.has(c)) common++;
  return common / Math.max(sa.size, sb.size);
}

let _malAuthServers = [];
// Diagnostics: packaged builds have no visible console, so the OAuth flow
// writes a compact trail here. Never logs code/state VALUES — only shapes,
// prefixes, and decisions — so sharing this file is safe.
const AUTH_DEBUG_LOG = path.join(app.getPath('userData'), 'auth-debug.log');
function appendAuthDebug(line) {
  try {
    const ts = new Date().toISOString();
    fs.appendFileSync(AUTH_DEBUG_LOG, '[' + ts + '] ' + line + '\n');
    try {
      if (fs.statSync(AUTH_DEBUG_LOG).size > 64 * 1024) {
        const lines = fs.readFileSync(AUTH_DEBUG_LOG, 'utf8').split('\n');
        fs.writeFileSync(AUTH_DEBUG_LOG, lines.slice(-100).join('\n'));
      }
    } catch (e) {}
  } catch (e) { /* diagnostics must never break the flow */ }
}
function closeMalAuthServers() {
  for (const s of _malAuthServers) {
    try { s.close(); } catch (e) {}
    // close() alone leaves keep-alive sockets (the browser holds one) binding
    // the port; the next Connect attempt then fails instantly with EADDRINUSE.
    try { if (typeof s.closeAllConnections === 'function') s.closeAllConnections(); } catch (e) {}
  }
  _malAuthServers = [];
}

const _MAL_CACHE_TTL = 3600000; // 1 hour
const _malDetailsCache = new Map();
function malDetailsCacheKey(malId) { return (config.vaultMode === 'manga' ? 'manga:' : 'anime:') + String(malId); }

// Should a list status fetched from MAL replace the stored one?
// - nothing usable stored → yes
// - both timestamped → only if MAL's is newer
// - stored one has no timestamp → yes (MAL is the source of truth; every app
//   edit is a PATCH whose response carries updated_at)
function shouldAdoptRemoteListStatus(local, remote) {
  if (!remote || typeof remote !== 'object' || !remote.status) return false;
  const usable = local && typeof local === 'object' && (local.status || local.score != null ||
    local.num_episodes_watched != null || local.num_watched_episodes != null || local.num_chapters_read != null);
  if (!usable) return true;
  const tl = Date.parse(local.updated_at), tr = Date.parse(remote.updated_at);
  if (tl && tr) return tr > tl;
  return !tl;
}

// Pulls the whole MAL list and brings every linked series' status in line
// with changes made on MAL itself (website, phone app, another device).
let _malPullRunning = false;

function register() {
  ipcMain.handle('mal:isAuthenticated', () => {
    return !!config.malAccessToken && Date.now() < config.malTokenExpiry;
  });

  ipcMain.handle('mal:getAuthUrl', (_, clientId, clientSecret) => {
    if (typeof clientId !== 'string' || !clientId.trim() || clientId.length > 200) throw new Error('Invalid MAL Client ID');
    config.malClientId = clientId.trim();
    // The stored secret is reused when the renderer no longer has it in memory.
    config.malClientSecret = (typeof clientSecret === 'string' && clientSecret.trim()) ? clientSecret.trim() : (config.malClientSecret || '');
    config.malCodeVerifier = crypto.randomBytes(32).toString('base64url');
    // Per-attempt random state; the loopback callback must echo it back (CSRF).
    config.malAuthState = crypto.randomBytes(16).toString('base64url');
    saveConfig();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.malClientId,
      // MAL's OAuth2 server supports only the "plain" PKCE method (official
      // authorization reference); sending S256 makes the token exchange fail
      // with invalid_grant even after successful user consent.
      code_challenge: config.malCodeVerifier,
      code_challenge_method: 'plain',
      state: config.malAuthState
    });
    appendAuthDebug('authorize-url generated state=' + config.malAuthState.slice(0, 6) +
      '… verifierLen=' + config.malCodeVerifier.length);
    return `https://myanimelist.net/v1/oauth2/authorize?${params.toString()}`;
  });

  ipcMain.handle('mal:startAuthServer', async () => {
    // Tear down any previous listener first so a stuck socket from an earlier
    // attempt can never hold :19876 and make this attempt fail before start.
    closeMalAuthServers();
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const expectedState = config.malAuthState || '';
      let boundStacks = 0;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        closeMalAuthServers();
        resolve(value);
      };
      const handler = (req, res) => {
        if (settled) { res.writeHead(404); res.end(); return; }
        let parsed;
        try { parsed = new URL(req.url, 'http://localhost:19876'); }
        catch (e) { res.writeHead(400); res.end(); return; }
        if (parsed.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
        const code = parsed.searchParams.get('code');
        const state = parsed.searchParams.get('state') || '';
        // MAL authorization codes are large: the official reference says they are
        // normally nearly 1,000 bytes. The old 512-char sanity cap rejected every
        // real code before a token exchange could ever run.
        const codeOk = typeof code === 'string' && code.length > 0 && code.length <= 4096;
        appendAuthDebug('inbound ' + parsed.pathname +
          ' codeLen=' + (typeof code === 'string' ? code.length : 0) +
          ' stateEcho=' + (expectedState ? state === expectedState : 'n/a') +
          (state && state !== expectedState ? ' got=' + state.slice(0, 6) + '. expected=' + expectedState.slice(0, 6) + '.' : ''));
        // Exact echo verifies the flow. MAL documents the state echo, so a
        // mismatched state almost always means a stale authorization tab from an
        // earlier Connect attempt (each attempt regenerates the state). A missing
        // state is tolerated as a downgrade: the PKCE verifier still binds the
        // code exchange to this app instance.
        if (codeOk && (!state || state === expectedState)) {
          if (!state) console.warn('[MAL] Callback arrived without state - accepting via PKCE binding only');
          appendAuthDebug('callback accepted (stateEcho=' + (state === expectedState) + ')');
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body style="font-family:sans-serif;background:#12121c;color:#e8e4dc;text-align:center;padding-top:48px"><h1>MAL Auth Successful</h1><p>You can close this window.</p></body></html>');
          finish(code);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          const reason = !codeOk
            ? '<h2>Invalid authorization code</h2><p>MAL returned something unexpected. Press Connect again.</p>'
            : state
              ? '<h2>Stale authorization tab</h2><p>This tab came from an earlier Connect attempt. Close all AnimeVault authorization tabs and press Connect again, then use the newest one.</p>'
              : '<h2>No authorization code</h2><p>Open AnimeVault and press Connect again.</p>';
          appendAuthDebug('callback rejected (' + (!codeOk ? 'bad code length ' + String(code || '').length : state ? 'state mismatch' : 'no code') + ')');
          res.end('<html><body style="font-family:sans-serif;background:#12121c;color:#e8e4dc;text-align:center;padding-top:48px">' + reason + '</body></html>');
        }
      };
      // Bind both loopback stacks: browsers may reach "localhost" via ::1 first.
      for (const host of ['127.0.0.1', '::1']) {
        const server = http.createServer(handler);
        server.on('error', (e) => {
          appendAuthDebug('bind error ' + host + ':19876 ' + (e.code || e.message));
          console.error('[MAL] Auth server', host, 'error:', e.code || e.message);
        });
        server.listen(19876, host, () => {
          boundStacks++;
          appendAuthDebug('listening ' + host + ':19876');
          console.log('[MAL] Auth server listening on', host + ':19876');
        });
        try { server.unref(); } catch (e) {}
        _malAuthServers.push(server);
      }
      // If neither stack could bind (port held by a foreign process), fail fast
      // instead of silently timing out five minutes later.
      setTimeout(() => {
        if (!settled && boundStacks === 0) {
          appendAuthDebug('port 19876 unavailable on any stack - aborting');
          console.error('[MAL] Port 19876 unavailable on any stack');
          finish(null);
        }
      }, 1500);
      timer = setTimeout(() => { appendAuthDebug('auth window timed out (300s)'); finish(null); }, 300000);
    });
  });

  ipcMain.handle('mal:exchangeToken', async (_, code) => {
    try {
      const response = await new Promise((resolve, reject) => {
        const postData = new URLSearchParams({
          client_id: config.malClientId,
          client_secret: config.malClientSecret,
          code,
          code_verifier: config.malCodeVerifier,
          grant_type: 'authorization_code'
        }).toString();
        const req = https.request({
          hostname: 'myanimelist.net',
          path: '/v1/oauth2/token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Auth token request timed out')); });
        req.write(postData);
        req.end();
      });
      if (response.access_token) {
        config.malAccessToken = response.access_token;
        config.malRefreshToken = response.refresh_token;
        config.malTokenExpiry = Date.now() + (response.expires_in || 3600) * 1000;
        saveConfig();
        appendAuthDebug('token exchange success');
        return { success: true };
      }
      appendAuthDebug('token exchange failed: ' + (response.error || 'unknown') + (response.message ? ' - ' + response.message : ''));
      return { success: false, error: response.error || 'Unknown error' };
    } catch (e) {
      appendAuthDebug('token exchange threw: ' + e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('mal:search', async (_, query) => {
    const isManga = config.vaultMode === 'manga';
    const endpoint = isManga
      ? `/manga?q=${encodeURIComponent(query)}&limit=10&fields=id,title,main_picture,mean,media_type,status,num_chapters`
      : `/anime?q=${encodeURIComponent(query)}&limit=10&fields=id,title,main_picture,mean,media_type,status,num_episodes`;
    const r = await malRequestWithRetry(endpoint);
    return r.data || [];
  });

  ipcMain.handle('mal:getAnimeDetails', async (_, malId) => {
    const cacheKey = malDetailsCacheKey(malId);
    const cached = _malDetailsCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < _MAL_CACHE_TTL) return cached.data;
    const isManga = config.vaultMode === 'manga';
    const fields = isManga
      ? 'id,title,alternative_titles,main_picture,mean,media_type,status,num_chapters,synopsis,genres,start_date,my_list_status'
      : 'id,title,alternative_titles,main_picture,mean,media_type,status,num_episodes,synopsis,genres,start_date,my_list_status';
    const endpoint = isManga ? `/manga/${malId}?fields=${fields}` : `/anime/${malId}?fields=${fields}`;
    const r = await malRequestWithRetry(endpoint);
    const data = r.data || null;
    if (data) _malDetailsCache.set(cacheKey, { data, ts: Date.now() });
    return data;
  });

  // ================================================================
  //  MAL BACKFILL (startup repair for missing list status)
  // ================================================================
  ipcMain.handle('mal:backfillMissing', async (_, seriesList) => {
    if (!Array.isArray(seriesList) || !seriesList.length || seriesList.length > 500) return { checked: 0, refreshed: 0, skipped: [] };
    if (!config.malAccessToken) return { checked: seriesList.length, refreshed: 0, skipped: seriesList.slice(), error: 'Not authenticated' };
    const history = getWatchHistoryStore();
    const isManga = config.vaultMode === 'manga';
    const skipped = [];
    let refreshed = 0;
    const fields = isManga
      ? 'id,title,alternative_titles,main_picture,mean,media_type,status,num_chapters,synopsis,genres,start_date,my_list_status'
      : 'id,title,alternative_titles,main_picture,mean,media_type,status,num_episodes,synopsis,genres,start_date,my_list_status';
    for (let i = 0; i < seriesList.length; i++) {
      const name = safeHistoryKey(seriesList[i]);
      const wd = history[name];
      if (!wd || !wd.malId) { skipped.push(name); continue; }
      const ls = wd.malData && wd.malData.my_list_status;
      const usable = ls && typeof ls === 'object' &&
        (ls.status || ls.score != null || ls.num_episodes_watched != null ||
         ls.num_watched_episodes != null || ls.num_chapters_read != null);
      if (usable) { skipped.push(name); continue; }
      try {
        const endpoint = isManga ? '/manga/' + wd.malId + '?fields=' + fields : '/anime/' + wd.malId + '?fields=' + fields;
        const r = await malRequestWithRetry(endpoint);
        if (r.status === 200 && r.data) {
          wd.malData = mergeMalData(wd.malData, r.data);
          refreshed++;
        } else {
          skipped.push(name);
        }
      } catch (e) {
        skipped.push(name);
      }
      if (i < seriesList.length - 1) await new Promise(resolve => setTimeout(resolve, 350));
    }
    if (refreshed > 0) saveConfig();
    return { checked: seriesList.length, refreshed, skipped };
  });

  ipcMain.handle('mal:updateStatus', async (_, malId, numWatched, status) => {
    const id = safeMalId(malId); if (!id) return null;
    const isManga = config.vaultMode === 'manga';
    const endpoint = isManga ? `/manga/${id}/my_list_status` : `/anime/${id}/my_list_status`;
    const body = isManga ? { num_chapters_read: numWatched, status } : { num_watched_episodes: numWatched, status };
    const r = await malRequestWithRetry(endpoint, 'PATCH', body);
    return r.data || null;
  });

  ipcMain.handle('mal:addOrUpdateListItem', async (_, malId, fields) => {
    const id = safeMalId(malId); if (!id) return null;
    const isManga = config.vaultMode === 'manga';
    const endpoint = isManga ? `/manga/${id}/my_list_status` : `/anime/${id}/my_list_status`;
    const r = await malRequestWithRetry(endpoint, 'PATCH', fields);
    if (r.data) _malDetailsCache.delete(malDetailsCacheKey(id));
    return r.data || null;
  });

  ipcMain.handle('mal:editStatus', async (_, malId, fields, seriesName) => {
    const id = safeMalId(malId); if (!id) return null;
    const isManga = config.vaultMode === 'manga';
    const endpoint = isManga ? `/manga/${id}/my_list_status` : `/anime/${id}/my_list_status`;

    // Translate anime-status strings to manga equivalents
    let body = fields;
    if (isManga && fields && fields.status) {
      const statusMap = {
        'watching': 'reading',
        'plan_to_watch': 'plan_to_read'
      };
      if (statusMap[fields.status]) {
        body = { ...fields, status: statusMap[fields.status] };
      }
    }

    const r = await malRequestWithRetry(endpoint, 'PATCH', body);
    if (r.data && seriesName) {
      const key = safeHistoryKey(seriesName);
      const history = getWatchHistoryStore();
      if (!history[key]) history[key] = {};
      // Normalize: the API returns flat list-status fields; wrap them under my_list_status
      // so they match the shape from malGetAnimeDetails
      const wrapped = { my_list_status: r.data };
      history[key].malData = { ...history[key].malData, ...wrapped };
      saveConfig();
      _malDetailsCache.delete(malDetailsCacheKey(id));
    }
    return r.data || null;
  });

  ipcMain.handle('mal:deleteEntry', async (_, malId) => {
    const id = safeMalId(malId); if (!id) return false;
    const isManga = config.vaultMode === 'manga';
    const endpoint = isManga ? `/manga/${id}/my_list_status` : `/anime/${id}/my_list_status`;
    const r = await malRequestWithRetry(endpoint, 'DELETE');
    _malDetailsCache.delete(malDetailsCacheKey(id));
    if (r.status === 200) {
      // The entry is gone from the user's MAL list: drop the locally cached list
      // status so cards no longer show a status MAL no longer has.
      const history = getWatchHistoryStore();
      for (const name of Object.keys(history)) {
        const wd = history[name];
        if (wd && String(wd.malId) === String(id) && wd.malData && wd.malData.my_list_status) {
          const next = { ...wd.malData };
          delete next.my_list_status;
          wd.malData = next;
        }
      }
      saveConfig();
    }
    return r.status === 200;
  });

  ipcMain.handle('mal:autoSync', async (_, seriesName) => {
    const wd = getWatchHistoryStore()[safeHistoryKey(seriesName)];
    if (!wd || !wd.malId) return { synced: false, error: 'No MAL link' };
    const numWatched = (wd.episodesWatched || []).length;
    const isManga = config.vaultMode === 'manga';
    const endpoint = isManga ? `/manga/${wd.malId}/my_list_status` : `/anime/${wd.malId}/my_list_status`;
    const r = await malRequestWithRetry(endpoint, 'GET');
    if (r.status === 200 && r.data) {
      const current = isManga ? (r.data.num_chapters_read || 0) : (r.data.num_watched_episodes || 0);
      if (numWatched > current) {
        const patchBody = isManga ? { num_chapters_read: numWatched } : { num_watched_episodes: numWatched };
        await malRequestWithRetry(endpoint, 'PATCH', patchBody);
        _malDetailsCache.delete(malDetailsCacheKey(wd.malId));
        return { synced: true, updated: numWatched };
      }
      return { synced: true, updated: null };
    }
    return { synced: false, error: r.error || 'Request failed' };
  });

  ipcMain.handle('mal:bulkAutoSync', async (_, seriesList) => {
    if (!Array.isArray(seriesList) || seriesList.length > 500) return [];
    const results = [];
    const isManga = config.vaultMode === 'manga';
    const history = getWatchHistoryStore();
    for (const rawName of seriesList) {
      const name = safeHistoryKey(rawName);
      try {
        // Skip if already linked
        const wd = history[name];
        if (wd && wd.malId) {
          results.push({ name, status: 'linked', malId: wd.malId });
          continue;
        }
        // Search MAL for this series
        const searchEndpoint = isManga
          ? `/manga?q=${encodeURIComponent(name)}&limit=10&fields=id,title,alternative_titles,main_picture,mean,media_type,status,num_chapters`
          : `/anime?q=${encodeURIComponent(name)}&limit=10&fields=id,title,alternative_titles,main_picture,mean,media_type,status,num_episodes`;
        const searchR = await malRequestWithRetry(searchEndpoint);
        const searchItems = Array.isArray(searchR.data) ? searchR.data : (searchR.data && Array.isArray(searchR.data.data) ? searchR.data.data : []);
        const items = searchItems.map(x => x.node || x).filter(Boolean);
        if (!items.length) {
          results.push({ name, status: 'needs_review', reason: 'No MAL results' });
          continue;
        }
        // Score each result with fuzzy title matching
        let best = null, bestScore = 0;
        for (const item of items) {
          const titles = [item.title, item.alternative_titles?.en, item.alternative_titles?.ja].filter(Boolean);
          for (const t of titles) {
            const score = fuzzyTitleMatch(name, t);
            if (score > bestScore) {
              bestScore = score;
              best = item;
            }
          }
        }
        // Threshold: 0.6 for auto-link, below that needs manual review
        const AUTO_LINK_THRESHOLD = 0.6;
        if (best && bestScore >= AUTO_LINK_THRESHOLD) {
          // Auto-link this series
          if (!history[name]) history[name] = { episodesWatched: [], lastWatched: null, malId: null };
          history[name].malId = best.id;
          saveConfig();
          results.push({ name, status: 'linked', malId: best.id, title: best.title, score: bestScore });
        } else {
          results.push({ name, status: 'needs_review', reason: 'No confident match', bestMatch: best?.title || null, bestScore: bestScore || 0 });
        }
      } catch (e) {
        results.push({ name, status: 'needs_review', reason: 'Search error: ' + (e.message || e) });
      }
    }
    saveConfig();
    return results;
  });

  ipcMain.handle('mal:unlinkSeries', (_, seriesName) => {
    const history = getWatchHistoryStore();
    const key = safeHistoryKey(seriesName);
    if (history[key]) {
      delete history[key].malId;
      delete history[key].malData;
      saveConfig();
    }
    return true;
  });

  ipcMain.handle('mal:getTopAnime', async (_, limit = 50, offset = 0) => {
    const l = Math.min(100, Math.max(1, Number(limit) || 50));
    const o = Math.max(0, Number(offset) || 0);
    const isManga = config.vaultMode === 'manga';
    const endpoint = isManga
      ? `/manga/ranking?ranking_type=all&limit=${l}&offset=${o}&fields=id,title,main_picture,mean,media_type,status`
      : `/anime/ranking?ranking_type=all&limit=${l}&offset=${o}&fields=id,title,main_picture,mean,media_type,status`;
    const r = await malRequestWithRetry(endpoint);
    return r.data || [];
  });

  ipcMain.handle('mal:getSeasonal', async (_, year, season) => {
    const y = Number(year);
    const s = String(season || '').toLowerCase();
    if (!/^(winter|spring|summer|fall)$/.test(s)) throw new Error('Invalid season');
    if (!Number.isInteger(y) || y < 1970 || y > 2100) throw new Error('Invalid year');
    const r = await malRequestWithRetry(`/anime/season/${y}/${s}?limit=50&fields=id,title,main_picture,num_episodes,status,mean,media_type,genres,start_date,synopsis`);
    return r.data || [];
  });

  ipcMain.handle('mal:getUserList', async (_, status = '', limit = 1000, offset = 0) => {
    const l = Math.min(1000, Math.max(1, Number(limit) || 1000));
    const o = Math.max(0, Number(offset) || 0);
    const st = String(status || '');
    if (st && !/^[a-z_]+$/.test(st)) throw new Error('Invalid status');
    const isManga = config.vaultMode === 'manga';
    let url = isManga
      ? `/users/@me/mangalist?limit=${l}&offset=${o}&fields=list_status,status,num_chapters,start_date`
      : `/users/@me/animelist?limit=${l}&offset=${o}&fields=list_status,status,num_episodes,broadcast,start_date`;
    if (st) url += `&status=${st}`;
    const r = await malRequestWithRetry(url);
    return r.data || [];
  });

  ipcMain.handle('mal:getStatusCounts', async () => {
    const isManga = config.vaultMode === 'manga';
    const endpoint = isManga
      ? '/users/@me/mangalist?limit=1000&fields=list_status'
      : '/users/@me/animelist?limit=1000&fields=list_status';
    const r = await malRequestWithRetry(endpoint);
    const items = r.data && Array.isArray(r.data.data) ? r.data.data : [];
    const counts = {};
    items.forEach(item => {
      const st = item && item.list_status && item.list_status.status;
      if (st) counts[st] = (counts[st] || 0) + 1;
    });
    return { counts, total: items.length, source: items.length ? 'mal' : 'local' };
  });

  ipcMain.handle('mal:pullListStatuses', async () => {
    if (_malPullRunning) return { skipped: true, updated: [] };
    if (!config.malAccessToken) return { skipped: true, updated: [] };
    _malPullRunning = true;
    try {
      const isManga = config.vaultMode === 'manga';
      const remote = new Map();
      let complete = false;
      for (let page = 0, offset = 0; page < 20; page++) {
        const endpoint = (isManga ? '/users/@me/mangalist' : '/users/@me/animelist') + `?limit=1000&offset=${offset}&fields=list_status&nsfw=true`;
        const r = await malRequestWithRetry(endpoint);
        const items = r.data && Array.isArray(r.data.data) ? r.data.data : null;
        if (!items) break;
        items.forEach(it => { if (it && it.node && it.node.id && it.list_status) remote.set(Number(it.node.id), it.list_status); });
        if (!(r.data.paging && r.data.paging.next) || items.length < 1000) { complete = true; break; }
        offset += 1000;
      }
      const history = getWatchHistoryStore();
      const updated = [];
      for (const name of Object.keys(history)) {
        const entry = history[name];
        const id = entry && Number(entry.malId);
        if (!id) continue;
        const local = entry.malData && entry.malData.my_list_status;
        const rs = remote.get(id);
        if (rs) {
          if (shouldAdoptRemoteListStatus(local, rs)) {
            entry.malData = { ...(entry.malData || {}), my_list_status: rs };
            if (!local || local.status !== rs.status || local.score !== rs.score) updated.push({ name, from: local && local.status || null, to: rs.status, listStatus: rs });
          }
        } else if (complete && local && local.status) {
          // Removed from the MAL list entirely: the series keeps its link, not a status.
          const { my_list_status, ...rest } = entry.malData;
          entry.malData = rest;
          updated.push({ name, from: local.status, to: null, listStatus: null });
        }
      }
      if (updated.length) saveConfig();
      return { updated, checked: remote.size, complete };
    } catch (e) {
      return { error: e.message, updated: [] };
    } finally { _malPullRunning = false; }
  });

  ipcMain.handle('mal:getSyncLog', () => {
    return (config.malSyncLog || []).slice(-100);
  });

  ipcMain.handle('mal:clearSyncLog', () => {
    config.malSyncLog = [];
    saveConfig();
    return true;
  });
}

module.exports = {
  appendAuthDebug,
  register,
};
