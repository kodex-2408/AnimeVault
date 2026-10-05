'use strict';

// main/services/nyaa.js - Nyaa search, release choice and torrent hand-off.

const { ipcMain } = require('electron');
const crypto = require('crypto');
const autoDownload = require('../../autoDownload');
const { getSearchVariants, buildEpisodeSearchQueries, parseNyaaEpisodeNumber, releaseMatchesUploader, releaseMatchesTrackedSeason, releaseMatchesSeriesTitle, releaseMatchesQuality } = require('../../autoDownload');
const { config } = require('../state');
const { isSafeExternalUrl } = require('../config/security');
const { getWatchHistoryStore, safeHistoryKey, saveConfig } = require('../config/config');

// One Nyaa search for the whole app (autoDownload.js): RSS with a 5-minute
// cache, entity-decoded titles and 429 back-off; the HTML listing is the
// fallback when RSS returns nothing.
async function nyaaSearch(searchQuery) {
  const rss = await autoDownload.nyaaSearchCached(searchQuery);
  if (rss.length) return rss;
  return autoDownload.nyaaSearchHtml(searchQuery);
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
  if (!chosen.id && !(chosen.magnet && isSafeExternalUrl(chosen.magnet))) {
    return { success: false, error: 'Selected release has no safe download link' };
  }
  const handoff = await autoDownload.handOffToClient(chosen);
  if (!handoff.ok) return { success: false, error: handoff.error };
  const method = handoff.method;
  // History is written only after a successful OS handoff.
  pushDownloadHistory({
    timestamp: Date.now(), key: dedupKey, series: meta.seriesTitle, episode: meta.epNum, dlMode: meta.mode,
    chosenTitle: chosen.title, seeders: chosen.seeders || 0, size: chosen.size || '', nyaaId: chosen.id || '',
    preferredUploader: autoDownload.PREFERRED_GROUP, method
  });
  return { success: true, title: chosen.title, seeders: chosen.seeders, chosen };
}

// "Let me pick the release" can be limited to some kinds of manual download:
// 'latest' (latest-episode button), 'episode' (a chosen episode) and 'series'
// (full series / batches). Automatic downloads never ask.
const RELEASE_PICKER_SCOPES = ['latest', 'episode', 'series'];
function releasePickerApplies(scope) {
  if (config.releasePicker !== true) return false;
  const kind = RELEASE_PICKER_SCOPES.includes(scope) ? scope : 'episode';
  const scopes = config.releasePickerScopes;
  if (!scopes || typeof scopes !== 'object') return true;
  return scopes[kind] !== false;
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
    const fitsSeries = (r) => (trackedEntry ? releaseMatchesTrackedSeason(r, trackedEntry, seriesTitle) : releaseMatchesSeriesTitle(r, seriesTitle));
    let matched = isEpisodeRequest
      ? allResults.map(r => ({ ...r, ep: parseNyaaEpisodeNumber(r.title) })).filter(r => r.ep === targetEp && fitsSeries(r) && releaseMatchesQuality(r, q))
      // Full series: the right title and season only - a popular batch of a
      // different series (or season) must never win on seeders.
      : allResults.filter(fitsSeries);
    if (!matched.length) return { success: false, error: isEpisodeRequest ? 'No exact episode match' : 'No series releases found' };

    // Erai-raws first, then the most-seeded release from any group; full-series
    // requests put batches first (autoDownload.rankReleases).
    const ranked = autoDownload.rankReleases(matched, { batch: !isEpisodeRequest });
    if (!ranked.length) return { success: false, error: 'Scoring produced no winner' };
    const meta = { seriesTitle, epNum, mode };
    if (options && options.interactive && releasePickerApplies(options.scope)) {
      const offered = ranked.slice(0, 8);
      return { needsChoice: true, token: rememberReleaseOffer({ list: offered, meta }), candidates: offered.map(autoDownload.describeRelease), seriesTitle, epNum, mode };
    }
    return await handOffRelease(ranked[0], meta);
  } catch (e) {
    console.error('[Nyaa:autoDownload] Error:', e.message);
    return { success: false, error: e.message };
  }
}

// Untracked series still have MAL data (start date, episode count) in the
// watch history; it lets season checks tell S2 releases from S1's.
function seasonEntryFromHistory(seriesTitle) {
  const wd = getWatchHistoryStore()[safeHistoryKey(seriesTitle)];
  const md = wd && wd.malData;
  if (!md || !md.start_date) return null;
  return { seriesName: seriesTitle, malId: wd.malId || null, airingStartDate: md.start_date, totalEps: Number(md.num_episodes) || 0, episodeOffset: 0 };
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
    ) || seasonEntryFromHistory(seriesTitle);
    const scope = mode === 'full' || epNum == null ? 'series' : (options && options.scope === 'latest' ? 'latest' : 'episode');
    return nyaaAutoDownloadForIpc(seriesTitle, quality, preferredUploader, epNum, mode, trackedEntry, { interactive: !!(options && options.interactive), scope });
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
