'use strict';

// main/services/anilist.js - AniList GraphQL lookups, sequel-aware matching
// and cover downloads.

const { ipcMain } = require('electron');
const fs = require('fs');
const https = require('https');
const { config } = require('../state');
const { CACHE_DIR, getTitleAlias, getWatchHistoryStore, safeHistoryKey } = require('../config/config');
const { fetchImage, getCoverCachePath, getExistingCoverCachePath } = require('./covers');

function anilistQuery(query, variables) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'graphql.anilist.co',
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.data || {});
        } catch (e) { reject(e); }
      });
    });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('AniList query timed out')); });
      req.write(postData);
    req.end();
  });
}

// ---- Sequel-aware AniList lookups --------------------------------------------
// Library folders name sequels "Title S2" / "Title Season 2"; AniList titles them
// "Title 2nd Season", "Title II" or "Title Season 2". Search those spellings
// and prefer a result that carries the same season number.
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
function ordinalSuffix(n) { const t = n % 100; if (t >= 11 && t <= 13) return n + 'th'; return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th'); }
function parseSeasonSuffix(title) {
  const t = String(title || '').trim();
  const pats = [
    /^(.*?)[\s._-]+S(?:eason)?[\s._-]*(\d{1,2})$/i,
    /^(.*?)[\s._-]+(\d{1,2})(?:st|nd|rd|th)[\s._-]+Season$/i,
    /^(.*?)[\s._-]+Season[\s._-]+(\d{1,2})$/i,
    /^(.*?)[\s._-]+(II|III|IV|V|VI)$/,
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (m && m[1].trim().length > 1) {
      const n = /^\d+$/.test(m[2]) ? parseInt(m[2], 10) : ROMAN.indexOf(m[2].toUpperCase());
      if (n >= 1 && n <= 20) return { base: m[1].trim(), season: n };
    }
  }
  return { base: t, season: 1 };
}
function anilistTitleVariants(title) {
  const t = String(title || '').trim();
  const { base, season } = parseSeasonSuffix(t);
  const noYear = s => s.replace(/\s*[([]?(19|20)\d{2}[)\]]?$/, '').trim();
  const out = [];
  if (season > 1) {
    out.push(`${base} ${ordinalSuffix(season)} Season`, `${base} Season ${season}`);
    if (ROMAN[season]) out.push(`${base} ${ROMAN[season]}`);
    out.push(t, `${base} ${season}`);
  } else {
    out.push(t, noYear(t), base);
  }
  return out.filter((v, i, a) => v && a.indexOf(v) === i);
}
function mediaSeasonNumber(media) {
  const titles = [media && media.title && media.title.romaji, media && media.title && media.title.english].filter(Boolean);
  for (const title of titles) {
    const p = parseSeasonSuffix(title.replace(/[:\-–]\s*(Part|Cour)\s*\d+$/i, '').trim());
    if (p.season > 1) return p.season;
    const m = title.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+Season\b|\bSeason\s+(\d{1,2})\b/i);
    if (m) return parseInt(m[1] || m[2], 10);
    const r = title.match(/\s(II|III|IV|V|VI)(?:\s*[:\-–]|$)/);
    if (r) return ROMAN.indexOf(r[1]);
  }
  return 1;
}
// Best media for a library title: same season number first, then AniList's order.
function pickSeasonMatch(mediaList, season) {
  const list = (mediaList || []).filter(m => m && m.coverImage);
  if (!list.length) return null;
  if (season > 1) return list.find(m => mediaSeasonNumber(m) === season) || null;
  return list.find(m => mediaSeasonNumber(m) === 1) || list[0];
}
const ANILIST_MEDIA_FIELDS = 'id idMal title { romaji english native } coverImage { extraLarge large medium } episodes chapters seasonYear description';
async function anilistSearchMedia(title, perPage, type) {
  const data = await anilistQuery(`query($search: String, $perPage: Int, $type: MediaType) { Page(perPage: $perPage) { media(search: $search, type: $type) { ${ANILIST_MEDIA_FIELDS} } } }`, { search: title, perPage, type });
  return (data.Page && data.Page.media) || [];
}
async function anilistByMalId(malId, type) {
  const id = Number(malId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const data = await anilistQuery(`query($id: Int, $type: MediaType) { Media(idMal: $id, type: $type) { ${ANILIST_MEDIA_FIELDS} } }`, { id, type });
  return data && data.Media ? data.Media : null;
}
// Resolves the AniList entry for a library series: exact MAL id first, then
// sequel-aware title search.
async function resolveAnilistMedia(name, malId) {
  const type = config.vaultMode === 'manga' ? 'MANGA' : 'ANIME';
  try { const byId = await anilistByMalId(malId, type); if (byId && byId.coverImage) return byId; } catch (e) { /* fall back to search */ }
  const title = getTitleAlias(name, 'anilist');
  const { season } = parseSeasonSuffix(title);
  for (const variant of anilistTitleVariants(title)) {
    const media = pickSeasonMatch(await anilistSearchMedia(variant, 5, type), season);
    if (media) return media;
  }
  return null;
}

function coverFileVersion(p) {
  try { return p ? Math.round(fs.statSync(p).mtimeMs) : 0; } catch (e) { return 0; }
}

function register() {
  // A user's AniList list (anime or manga, following the vault mode) with the
  // MAL id, list status, progress and 0-10 score of every entry.
  ipcMain.handle('anilist:userList', async (_, userName) => {
    try {
      const user = String(userName || '').trim();
      if (!/^[A-Za-z0-9_-]{2,40}$/.test(user)) return { error: 'Invalid AniList username' };
      const type = config.vaultMode === 'manga' ? 'MANGA' : 'ANIME';
      const data = await anilistQuery(`
      query ($user: String, $type: MediaType) {
        MediaListCollection(userName: $user, type: $type) {
          lists { entries { status progress score(format: POINT_10) media { idMal title { romaji english } } } }
        }
      }
    `, { user, type });
      const coll = data && data.MediaListCollection;
      if (!coll) return { error: 'User not found or list is private' };
      const byId = new Map();
      (coll.lists || []).forEach(l => (l.entries || []).forEach(e => {
        const id = e && e.media && e.media.idMal;
        if (!Number.isInteger(id) || id <= 0 || byId.has(id)) return;
        byId.set(id, {
          idMal: id,
          status: String(e.status || ''),
          progress: Math.max(0, Number(e.progress) || 0),
          score: Math.min(10, Math.max(0, Math.round(Number(e.score) || 0))),
          title: (e.media.title && (e.media.title.english || e.media.title.romaji)) || '',
        });
      }));
      return { type, entries: Array.from(byId.values()).slice(0, 5000) };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('anilist:search', async (_, title, count = 1) => {
    try {
      const type = config.vaultMode === 'manga' ? 'MANGA' : 'ANIME';
      const n = Math.max(1, Math.min(25, Number(count) || 1));
      const first = await anilistSearchMedia(title, Math.max(n, 5), type);
      const { season } = parseSeasonSuffix(title);
      // A sequel title that found nothing (or only other seasons) retries with
      // AniList's spellings; the season match is moved to the front.
      let list = first;
      if (season > 1 && !pickSeasonMatch(first, season)) {
        for (const variant of anilistTitleVariants(title).slice(0, 3)) {
          const more = await anilistSearchMedia(variant, Math.max(n, 5), type);
          if (pickSeasonMatch(more, season)) { list = more; break; }
        }
      }
      const best = pickSeasonMatch(list, season);
      if (best) list = [best].concat(list.filter(m => m !== best));
      return list.slice(0, n);
    } catch (e) { return []; }
  });

  ipcMain.handle('anilist:fetchCover', async (_, seriesName, url, force = false) => {
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const cacheFile = getCoverCachePath(seriesName);
      const existing = getExistingCoverCachePath(seriesName);
      if (existing && !force) {
        return existing;
      }
      const buf = await fetchImage(url);
      fs.writeFileSync(cacheFile, buf);
      return cacheFile;
    } catch (e) {
      console.error('[AniList] Cover fetch failed:', e.message);
      return null;
    }
  });

  ipcMain.handle('anilist:getCachedCover', (_, name) => {
    return getExistingCoverCachePath(name);
  });

  ipcMain.handle('anilist:fetchAllCovers', async (_, seriesList) => {
    const results = [];
    if (!Array.isArray(seriesList)) return results;
    for (const series of seriesList.slice(0, 2000)) {
      if (!series || typeof series.name !== 'string') continue;
      const cacheFile = getCoverCachePath(series.name);
      const existing = getExistingCoverCachePath(series.name);
      if (existing) {
        results.push({ name: series.name, path: existing, version: coverFileVersion(existing), status: 'cached' });
        continue;
      }
      // Linked series: the MAL id from the library wins over whatever the caller sent.
      const history = getWatchHistoryStore()[safeHistoryKey(series.name)] || {};
      const malId = history.malId || series.malId || null;
      const malPicture = history.malData && history.malData.main_picture && (history.malData.main_picture.large || history.malData.main_picture.medium);
      try {
        const media = await resolveAnilistMedia(series.name, malId);
        const url = (media && media.coverImage && (media.coverImage.extraLarge || media.coverImage.large)) || malPicture || null;
        if (url) {
          const buf = await fetchImage(url);
          fs.writeFileSync(cacheFile, buf);
          results.push({ name: series.name, path: cacheFile, version: coverFileVersion(cacheFile), status: 'fetched' });
        } else {
          results.push({ name: series.name, path: null, status: 'no_image' });
        }
      } catch (e) {
        console.error('[AniList] fetchAllCovers error for', series.name, e.message);
        results.push({ name: series.name, path: null, status: 'error' });
      }
    }
    return results;
  });
}

module.exports = {
  coverFileVersion,
  parseSeasonSuffix,
  register,
};
