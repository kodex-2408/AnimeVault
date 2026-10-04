'use strict';

// main/services/nyaa.js - Nyaa search, release choice and torrent hand-off.

const { app, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const autoDownload = require('../../autoDownload');
const { downloadNyaaTorrentFile, getSearchVariants, buildEpisodeSearchQueries, parseNyaaEpisodeNumber, releaseMatchesUploader, releaseMatchesTrackedSeason, releaseMatchesSeriesTitle, releaseMatchesQuality } = require('../../autoDownload');
const { config } = require('../state');
const { isSafeExternalUrl } = require('../config/security');
const { saveConfig } = require('../config/config');

function nyaaSearchHtml(searchQuery) {
  return new Promise((resolve) => {
    const category = config.vaultMode === 'manga' ? '3_1' : '1_2';
    const url = `https://nyaa.si/?f=0&c=${category}&q=${encodeURIComponent(searchQuery)}`;
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve([]);
      }
      let html = '';
      res.on('data', chunk => html += chunk);
      res.on('end', () => {
        const results = [];
        try {
          const rows = html.match(/<tr class="[^"]*(?:default|success|danger)[^"]*"[\s\S]*?<\/tr>/g) || [];
          for (const row of rows) {
            try {
              const titleMatch = row.match(/<a[^>]*href="\/view\/\d+"[^>]*title="([^"]+)"/);
              const idMatch = row.match(/<a[^>]*href="\/view\/(\d+)"/);
              const sizeMatch = row.match(/<td[^>]*class="text-center[^"]*"[^>]*>[\s\S]*?<\/td>[\s\S]*?<td[^>]*class="text-center[^"]*"[^>]*>[\s\S]*?<\/td>[\s\S]*?<td[^>]*class="text-center[^"]*"[^>]*>([\s\S]*?)<\/td>/);
              // nyaa.si marks the seeder cell with the "success" class. The old
              // code indexed a /g match array position that never exists, so
              // every fallback result reported 0 seeders and broke scoring.
              let seeders = 0;
              const seedCell = row.match(/<td[^>]*class="text-center[^"]*success[^"]*"[^>]*>([\s\S]*?)<\/td>/);
              if (seedCell) {
                seeders = parseInt(seedCell[1].replace(/<[^>]+>/g, '').trim(), 10) || 0;
              } else {
                const cellRe = /<td[^>]*class="text-center[^"]*"[^>]*>([\s\S]*?)<\/td>/g;
                let cell;
                while ((cell = cellRe.exec(row)) !== null) {
                  const text = cell[1].replace(/<[^>]+>/g, '').trim();
                  if (/^\d+$/.test(text)) { seeders = parseInt(text, 10) || 0; break; }
                }
              }
              const magnetMatch = row.match(/href="(magnet:\?[^"]+)"/);
              if (titleMatch && idMatch) {
                results.push({
                  id: idMatch[1],
                  title: titleMatch[1],
                  size: sizeMatch ? sizeMatch[1].trim() : '',
                  seeders,
                  magnet: magnetMatch ? magnetMatch[1] : ''
                });
              }
            } catch(e2) { console.error('[Nyaa] HTML parse row error:', e2.message); }
          }
        } catch(e) { console.error('[Nyaa] HTML parse error:', e.message); }
        resolve(results);
      });
    });
    req.on('error', (e) => { console.error('[Nyaa] HTML request error:', e.message); resolve([]); });
    req.setTimeout(15000, () => { req.destroy(); resolve([]); });
  });
}

function nyaaSearch(searchQuery) {
  return new Promise((resolve) => {
    const category = config.vaultMode === 'manga' ? '3_1' : '1_2';
    const rssUrl = `https://nyaa.si/?page=rss&q=${encodeURIComponent(searchQuery)}&c=${category}&f=0`;
    const req = https.get(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve([]);
      }
      let xml = '';
      res.on('data', chunk => xml += chunk);
      res.on('end', () => {
        const results = [];
        try {
          const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
          for (const item of items) {
            try {
              const title = (item.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
              const link = (item.match(/<link>([^<]+)<\/link>/) || [])[1] || '';
              const id = link.match(/\/view\/(\d+)/) ? link.match(/\/view\/(\d+)/)[1] : '';
              const size = (item.match(/<nyaa:size>([^<]+)<\/nyaa:size>/) || [])[1] || '';
              const seeders = parseInt((item.match(/<nyaa:seeders>([^<]+)<\/nyaa:seeders>/) || [])[1] || '0');
              const magnet = (item.match(/<nyaa:infoHash>([^<]+)<\/nyaa:infoHash>/) || [])[1] || '';
              const nyaaMagnet = magnet ? `magnet:?xt=urn:btih:${magnet}&dn=${encodeURIComponent(title)}` : '';
              const pubDateRaw = (item.match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1] || '';
              const publishedAt = pubDateRaw && !isNaN(Date.parse(pubDateRaw))
                ? new Date(pubDateRaw).toISOString()
                : '';
              results.push({ id, title, size, seeders, magnet: nyaaMagnet, publishedAt });
            } catch(e2) { console.error('[Nyaa] RSS parse row error:', e2.message); }
          }
        } catch(e) { console.error('[Nyaa] RSS parse error:', e.message); }
        if (results.length === 0) {
          // Fall back to HTML scraping with original query
          nyaaSearchHtml(searchQuery).then(resolve).catch((e) => { console.error('[Nyaa] HTML fallback error:', e.message); resolve([]); });
        } else {
          resolve(results);
        }
      });
    });
    req.on('error', (e) => { console.error('[Nyaa] RSS request error:', e.message); nyaaSearchHtml(searchQuery).then(resolve).catch((e2) => { console.error('[Nyaa] HTML fallback error:', e2.message); resolve([]); }); });
    req.setTimeout(15000, () => { req.destroy(); resolve([]); });
  });
}

// Release picker: candidates offered to the UI are remembered here, and a
// choice is only ever accepted by token + index — the renderer never hands a
// URL or torrent id back to the main process.
const _releaseOffers = new Map();
function rememberReleaseOffer(offer) {
  const token = crypto.randomBytes(12).toString('hex');
  _releaseOffers.set(token, { ...offer, at: Date.now() });
  for (const [k, v] of _releaseOffers) if (Date.now() - v.at > 30 * 60 * 1000) _releaseOffers.delete(k);
  return token;
}
async function handOffRelease(chosen, meta) {
  const dedupKey = [meta.seriesTitle, meta.epNum, meta.mode].join('|');
  let method;
  if (chosen.id) {
    const torrentData = await downloadNyaaTorrentFile(chosen.id);
    const tmpDir = path.join(app.getPath('temp'), 'animevault-torrents');
    fs.mkdirSync(tmpDir, { recursive: true });
    const safeName = chosen.title.replace(/[\\/:*?"<>|]/g, '_').substring(0, 80);
    const tmpFile = path.join(tmpDir, safeName + '.torrent');
    fs.writeFileSync(tmpFile, torrentData);
    await shell.openPath(tmpFile);
    method = 'external';
  } else if (chosen.magnet && isSafeExternalUrl(chosen.magnet)) {
    await shell.openExternal(chosen.magnet);
    method = 'magnet';
  } else {
    return { success: false, error: 'Selected release has no safe download link' };
  }
  // History is written only after a successful OS handoff.
  pushDownloadHistory({
    timestamp: Date.now(), key: dedupKey, series: meta.seriesTitle, episode: meta.epNum, dlMode: meta.mode,
    chosenTitle: chosen.title, seeders: chosen.seeders || 0, size: chosen.size || '', nyaaId: chosen.id || '',
    preferredUploader: autoDownload.PREFERRED_GROUP, method
  });
  return { success: true, title: chosen.title, seeders: chosen.seeders, chosen };
}

async function nyaaAutoDownloadForIpc(seriesTitle, quality, preferredUploader, epNum, mode = 'ep', trackedEntry = null, options = {}) {
  try {
    // 5.1: Erai-raws is the only preferred group; everything else competes on seeders.
    const uploader = autoDownload.PREFERRED_GROUP;
    const q = quality || config.nyaaQuality || '1080p';
    const titleVariants = getSearchVariants(seriesTitle).slice(0, 3);
    const epRaw = epNum != null ? String(parseInt(epNum, 10)) : '';
    const epPadded = epNum != null ? epRaw.padStart(2, '0') : '';
    const preferredQueries = [];
    const broadQueries = [];
    for (const title of titleVariants) {
      if (epNum != null) {
        preferredQueries.push(`[Erai-raws] ${title} - ${epPadded} ${q}`);
        preferredQueries.push(`[Erai-raws] ${title} - ${epRaw}`);
      } else preferredQueries.push(`[Erai-raws] ${title} ${q}`);
      if (epNum != null) {
        broadQueries.push(`${title} ${epPadded} ${q}`);
        broadQueries.push(`${title} ${epRaw}`);
      } else broadQueries.push(`${title} ${q}`, title);
    }
    const queries = epNum != null
      ? buildEpisodeSearchQueries(seriesTitle, q, uploader, epNum, config.forceHevc !== false)
      : preferredQueries.concat(broadQueries)
        .flatMap(getSearchVariants)
        .filter((query, index, all) => query && all.indexOf(query) === index);

    let allResults = [];
    const seenIds = new Set();
    for (const qText of queries) {
      const r = await nyaaSearch(qText);
      for (const item of r) {
        const resultKey = item.id || item.magnet || item.title;
        if (!seenIds.has(resultKey)) {
          seenIds.add(resultKey);
          allResults.push(item);
        }
      }
      if (epNum != null) {
        if (allResults.some(item =>
          parseNyaaEpisodeNumber(item.title) === parseInt(epNum, 10) &&
          releaseMatchesUploader(item, uploader) &&
          (trackedEntry ? releaseMatchesTrackedSeason(item, trackedEntry, seriesTitle) : releaseMatchesSeriesTitle(item, seriesTitle)) &&
          releaseMatchesQuality(item, q)
        )) break;
      } else if (allResults.some(item =>
        releaseMatchesUploader(item, uploader) && releaseMatchesSeriesTitle(item, seriesTitle)
      )) break;
    }

    if (!allResults.length) return { success: false, error: 'No results found' };

    // Episode requests require an exact match. Full-series requests score the
    // broad result set instead of comparing every result against NaN.
    const isEpisodeRequest = epNum !== null && epNum !== undefined && mode === 'ep';
    const targetEp = isEpisodeRequest ? parseInt(epNum, 10) : null;
    let matched = isEpisodeRequest
      ? allResults.map(r => ({ ...r, ep: parseNyaaEpisodeNumber(r.title) })).filter(r => {
          return r.ep === targetEp &&
            (trackedEntry ? releaseMatchesTrackedSeason(r, trackedEntry, seriesTitle) : releaseMatchesSeriesTitle(r, seriesTitle)) &&
            releaseMatchesQuality(r, q);
        })
      : allResults;
    if (!matched.length) return { success: false, error: isEpisodeRequest ? 'No exact episode match' : 'No series releases found' };

    // Erai-raws first, then the most-seeded release from any group; full-series
    // requests put batches first (autoDownload.rankReleases).
    const ranked = autoDownload.rankReleases(matched, { batch: !isEpisodeRequest });
    if (!ranked.length) return { success: false, error: 'Scoring produced no winner' };
    const meta = { seriesTitle, epNum, mode };
    if (options && options.interactive && config.releasePicker === true) {
      const offered = ranked.slice(0, 8);
      return { needsChoice: true, token: rememberReleaseOffer({ list: offered, meta }), candidates: offered.map(autoDownload.describeRelease), seriesTitle, epNum, mode };
    }
    return await handOffRelease(ranked[0], meta);
  } catch (e) {
    console.error('[Nyaa:autoDownload] Error:', e.message);
    return { success: false, error: e.message };
  }
}

function pushDownloadHistory(entry) {
  if (!Array.isArray(config.downloadHistory)) config.downloadHistory = [];
  config.downloadHistory.push(entry);
  // Keep last 500
  if (config.downloadHistory.length > 500) config.downloadHistory = config.downloadHistory.slice(-500);
  saveConfig();
}

function register() {
  ipcMain.handle('nyaa:search', async (_, query) => {
    return nyaaSearch(query);
  });

  ipcMain.handle('nyaa:autoDownload', (_, seriesTitle, quality, preferredUploader, epNum, mode = 'ep', options = {}) => {
    const trackedEntry = (config.autoDownloadWatchlist || []).find(entry =>
      entry.seriesName === seriesTitle || entry.searchTitle === seriesTitle
    ) || null;
    return nyaaAutoDownloadForIpc(seriesTitle, quality, preferredUploader, epNum, mode, trackedEntry, { interactive: !!(options && options.interactive) });
  });

  ipcMain.handle('nyaa:downloadChoice', async (_, token, index) => {
    const offer = typeof token === 'string' ? _releaseOffers.get(token) : null;
    const i = Number(index);
    if (!offer || !Number.isInteger(i) || i < 0 || i >= offer.list.length) return { success: false, error: 'That choice has expired — search again' };
    _releaseOffers.delete(token);
    try { return await handOffRelease(offer.list[i], offer.meta); }
    catch (e) { return { success: false, error: e.message }; }
  });
}

module.exports = {
  nyaaAutoDownloadForIpc,
  pushDownloadHistory,
  register,
};
