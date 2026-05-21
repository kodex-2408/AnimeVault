const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

let _deps = null;

function setDeps(deps) {
  _deps = deps;
}

function d() {
  if (!_deps) throw new Error('autoDownload module not initialized — call setDeps() first');
  return _deps;
}

// ================================================================
//  NYAA SEARCH HELPERS
// ================================================================

function normalizeMagnet(url) {
  if (!url) return url;
  return url
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code));
}

function nyaaSearch(query) {
  return new Promise((resolve) => {
    const cat = d().config.vaultMode === 'manga' ? '3_1' : '1_2';
    const url = 'https://nyaa.si/?page=rss&f=0&c=' + cat + '&q=' + encodeURIComponent(query);
    const req = https.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const results = [];
          const itemRegex = /<item>([\s\S]*?)<\/item>/g;
          let m;
          while ((m = itemRegex.exec(data)) !== null) {
            try {
              const item = m[1];
              const titleMatch = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || item.match(/<title>([\s\S]*?)<\/title>/);
              if (!titleMatch) continue;
              let title = titleMatch[1].trim()
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
                .replace(/&quot;/g, '"');
              if (/\bRAW\b/i.test(title) && !/multi/i.test(title) && !/sub/i.test(title)) continue;
              const linkMatch = item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/) || item.match(/<link>([\s\S]*?)<\/link>/);
              const idMatch = linkMatch ? linkMatch[1].match(/\/view\/(\d+)/) : null;
              const id = idMatch ? idMatch[1] : '';
              const infoHashMatch = item.match(/<nyaa:infoHash>([\s\S]*?)<\/nyaa:infoHash>/);
              let magnet = '';
              if (infoHashMatch) {
                magnet = 'magnet:?xt=urn:btih:' + infoHashMatch[1].trim() + '&dn=' + encodeURIComponent(title)
                  + '&tr=udp://tracker.opentrackr.org:1337/announce&tr=udp://open.stealth.si:80/announce&tr=udp://tracker.openbittorrent.com:6969/announce&tr=udp://explodie.org:6969/announce';
                magnet = normalizeMagnet(magnet);
              }
              if (!magnet) continue;
              const sizeMatch = item.match(/<nyaa:size>([\s\S]*?)<\/nyaa:size>/);
              const size = sizeMatch ? sizeMatch[1].trim() : '';
              const seedMatch = item.match(/<nyaa:seeders>([\s\S]*?)<\/nyaa:seeders>/);
              const leechMatch = item.match(/<nyaa:leechers>([\s\S]*?)<\/nyaa:leechers>/);
              const seeders = seedMatch ? parseInt(seedMatch[1].trim()) || 0 : 0;
              const leechers = leechMatch ? parseInt(leechMatch[1].trim()) || 0 : 0;
              results.push({ id, title, magnet, size, seeders, leechers });
            } catch(e2) {}
          }
          resolve(results);
        } catch (e) {
          console.error('[nyaaSearch] XML parse error:', e.message);
          resolve([]);
        }
      });
    });
    req.on('error', (e) => { console.error('[nyaaSearch] Request error:', e.message); resolve([]); });
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.setTimeout(15000);
  });
}

function nyaaSearchHtml(query) {
  return new Promise((resolve) => {
    const cat = d().config.vaultMode === 'manga' ? '3_1' : '1_2';
    const doSearch = (q) => new Promise((res) => {
      const url = 'https://nyaa.si/?f=0&c=' + cat + '&q=' + encodeURIComponent(q) + '&s=seeders&o=desc';
      const req = https.get(url, { timeout: 15000 }, (response) => {
        let data = '';
        response.on('data', (chunk) => data += chunk);
        response.on('end', () => {
          try {
            const results = [];
            // Pre-compile regexes outside the loop for performance
            const rowRe = /<tr\s+class="[^"]*">[\s\S]*?<\/tr>/g;
            const titleRe = /<a\s+href="\/view\/\d+"[^>]*title="([^"]*)"[^>]*>[^<]*<\/a>/;
            const linkRe = /<a\s+href="(\/view\/\d+)"[^>]*title="[^"]*"[^>]*>[^<]*<\/a>/;
            const magnetRe = /<a\s+href="(magnet:[^"]*)"[^>]*>/;
            const sizeRe = /<td\s+class="text-center\s+size">([^<]*)<\/td>/;
            const seedersRe = /<td\s+class="text-center\s+(?:success|danger|default)">\s*<span[^>]*>(\d+)<\/span>/;
            const trustedRe = /<span\s+class="text-success"[^>]*>\s*<i\s+class="fas\s+fa-check-circle">/;
            let m;
            while ((m = rowRe.exec(data)) !== null) {
              const row = m[0];
              const titleMatch = row.match(titleRe);
              const linkMatch = row.match(linkRe);
              const magnetMatch = row.match(magnetRe);
              const sizeMatch = row.match(sizeRe);
              const seedersMatch = row.match(seedersRe);
              const isTrusted = trustedRe.test(row);
              if (titleMatch) {
                const link = linkMatch ? 'https://nyaa.si' + linkMatch[1] : '';
                const idMatch = link.match(/\/view\/(\d+)/);
                const id = idMatch ? parseInt(idMatch[1], 10) : null;
                results.push({
                  id,
                  title: titleMatch[1],
                  link,
                  magnet: normalizeMagnet(magnetMatch ? magnetMatch[1] : ''),
                  size: sizeMatch ? sizeMatch[1].trim() : '',
                  seeders: seedersMatch ? parseInt(seedersMatch[1], 10) : 0,
                  isTrusted
                });
              }
            }
            res(results);
          } catch (e) {
            console.error('[nyaaSearchHtml] Parse error:', e.message);
            resolve([]);
          }
        });
      });
      req.on('error', (e) => { console.error('[nyaaSearchHtml] Request error:', e.message); resolve([]); });
      req.on('timeout', () => { req.destroy(); resolve([]); });
      req.setTimeout(15000);
    });
    (async () => {
      let results = await doSearch(query);
      // FIX #2: If no results, try normalized variants for special character handling
      if (!results || results.length === 0) {
        const variants = d().getSearchVariants(query);
        for (const variant of variants) {
          if (variant === query) continue;
          results = await doSearch(variant);
          if (results && results.length > 0) {
            console.log('[Nyaa] Found HTML results using variant "', variant, '" for "', query, '"');
            break;
          }
        }
      }
      resolve(results);
    })();
  });
}

let _nyaaCache = {};
const NYAA_CACHE_TTL = 5 * 60 * 1000;

function nyaaSearchCached(query) {
  const now = Date.now();
  const key = query.toLowerCase().trim();
  if (_nyaaCache[key] && (now - _nyaaCache[key].ts) < NYAA_CACHE_TTL) {
    return Promise.resolve(_nyaaCache[key].results);
  }
  return nyaaSearch(query).then((results) => {
    _nyaaCache[key] = { ts: now, results };
    return results;
  }).catch(() => []);
}

function downloadNyaaTorrentFile(nyaaId) {
  return new Promise((resolve, reject) => {
    const url = 'https://nyaa.si/download/' + nyaaId + '.torrent';
    https.get(url, { timeout: 20000 }, (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', (e) => reject(e)).setTimeout(20000);
  });
}

// ================================================================
//  RELEASE SCORING
// ================================================================

function parseReleaseSize(sizeStr) {
  if (!sizeStr) return 0;
  const parts = sizeStr.trim().split(' ');
  if (parts.length < 2) return 0;
  const num = parseFloat(parts[0]);
  const unit = parts[1].toLowerCase();
  const multipliers = { 'b': 1, 'ki': 1024, 'mi': 1024 ** 2, 'gi': 1024 ** 3, 'ti': 1024 ** 4 };
  const prefix = unit.substring(0, 2);
  return Math.floor(num * (multipliers[prefix] || 1));
}

function scoreRelease(r, preferredUploader, ctx) {
  let score = r.seeders || 0;
  const t = r.title.toLowerCase();
  const cfg = d().config;
  const isHevc = /\b(hevc|x265|h\.?265|h265)\b/.test(t);
  const isH264 = /\b(h\.?264|x264|avc)\b/.test(t);
  const is10bit = /\b(10.?bit|hi10p|10b)\b/.test(t);
  const isFlac = /\bflac\b/.test(t);
  if (cfg.forceHevc !== false) {
    if (isHevc) {
      let bonus = 1000;
      if (cfg.avoidOversizedHevc && ctx && ctx.h264Ceiling) {
        const hevcBytes = parseReleaseSize(r.size);
        if (hevcBytes > ctx.h264Ceiling * 2) bonus = 300;
      }
      score += bonus;
    }
    if (isH264) score -= 500;
  }
  if (is10bit) score += 50;
  if (isFlac) score += 30;
  const resMatch = t.match(/\b(480|720|1080|2160)p?\b/);
  if (resMatch) {
    const res = parseInt(resMatch[1], 10);
    if (res === 480) score -= 200;
    else if (res === 720) score -= 100;
    else if (res === 1080) score += 50;
    else if (res === 2160) score += 80;
  }
  if (preferredUploader && preferredUploader !== 'raw') {
    const normUploader = preferredUploader.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normTitle = t.replace(/[^a-z0-9]/g, '');
    if (normTitle.includes(normUploader)) score += 150;
  }
  if (r.isTrusted) score += 100;
  return score;
}

function computeH264Ceiling(results) {
  let best = 0;
  for (const r of results) {
    if (/\b(h\.?264|x264|avc)\b/.test(r.title.toLowerCase())) {
      const b = parseReleaseSize(r.size);
      if (b > best) best = b;
    }
  }
  return best || 0;
}

// ================================================================
//  SEASON / EPISODE HELPERS
// ================================================================

function extractSeasonInfo(seriesName) {
  const m = seriesName.match(/\b(S(?:eason)?\s*(\d{1,2})|(\d{1,2})(?:nd|rd|th|st)\s*Season)\b/i);
  if (!m) return { season: 1, cleanName: seriesName, suffix: '' };
  const season = parseInt(m[2] || m[3], 10);
  const clean = seriesName.replace(m[0], '').replace(/\s{2,}/g, ' ').trim();
  const suffix = season > 1 ? ' S' + season : '';
  return { season, cleanName: clean, suffix };
}

function getNextEpisodeNumber(seriesName, allEpisodes) {
  const localHighest = d().getLocalHighestEpisode(seriesName, null);
  return localHighest + 1;
}

function parseNyaaEpisodeNumber(title) {
  if (!title) return null;
  const t = title.replace(/_/g, ' ');

  // Helper: reject 4-digit numbers (years) and validate range
  const validate = (n) => {
    const num = parseInt(n, 10);
    if (isNaN(num) || num < 1 || num > 999) return null;
    return num;
  };

  // Pattern 1: "Series - 12 (" or "Series - 12 [" or "Series - 12v2 ("
  let m = t.match(/\s-\s(\d{1,3})(?:v\d+)?\s*[\[(]/);
  if (m) return validate(m[1]);

  // Pattern 1b: "Series - 12 " (space after, no paren/bracket)
  m = t.match(/\s-\s(\d{1,3})(?:v\d+)?\s+(?!\d{4}p?)/);
  if (m) return validate(m[1]);

  // Pattern 2: "Series 12 (1080p)" with no dash — require quality paren immediately after
  m = t.match(/\s(\d{1,3})(?:v\d+)?\s*\(\d{3,4}p\)/);
  if (m) return validate(m[1]);

  // Pattern 3: "Series 12 [1080p]" — bracket instead of paren
  m = t.match(/\s(\d{1,3})(?:v\d+)?\s*\[\d{3,4}p\]/);
  if (m) return validate(m[1]);

  // Pattern 4: standalone " - 12 " surrounded by spaces
  m = t.match(/\s-(\d{1,3})(?:v\d+)?\s/);
  if (m) return validate(m[1]);

  // Pattern 5: S01E12
  m = t.match(/S\d{1,2}E(\d{1,3})/i);
  if (m) return validate(m[1]);

  // Pattern 6: loose " 12 " before quality marker without parens/brackets
  // Must be followed by known codec/audio markers, not just any word
  m = t.match(/\s(\d{1,3})(?:v\d+)?\s+(?:\d{3,4}p|HEVC|x265|x264|AV1|AAC|FLAC|MP3|MKV|MP4|AVI)/i);
  if (m) return validate(m[1]);

  // Pattern 7: episode number at end of base title before extension
  m = t.match(/\s(\d{1,3})(?:v\d+)?\s*(?:\.mkv|\.mp4|\.avi|\.m4v|\.webm|\.ts|$)/i);
  if (m) return validate(m[1]);

  // Pattern 8: "EP12" or "Episode 12"
  m = t.match(/EP(?:isode)?\s*(\d{1,3})/i);
  if (m) return validate(m[1]);

  // Pattern 9: "12 - " at start of filename base (after series name removed)
  // e.g. "Series 12 - 1080p.mkv"
  m = t.match(/\s(\d{1,3})(?:v\d+)?\s*[-–—]\s*\d{3,4}p/i);
  if (m) return validate(m[1]);

  return null;
}

function getNextEpisodeNumber(seriesName, allEpisodes) {
  const localHighest = d().getLocalHighestEpisode(seriesName, null);
  return localHighest + 1;
}

function parseNyaaEpisodeNumber(title) {
  if (!title) return null;
  const t = title.replace(/_/g, ' ');
  // Pattern 1: "Series - 12 (" or "Series - 12 [" — most common
  let m = t.match(/\s-\s(\d{1,3})(?:v\d)?\s*[\[(]/);
  if (m) return parseInt(m[1]);
  // Pattern 2: "Series 12 (1080p)" with no dash
  m = t.match(/\s(\d{1,3})(?:v\d)?\s*\(\d{3,4}p\)/);
  if (m) return parseInt(m[1]);
  // Pattern 3: "Series 12 [1080p]" — bracket instead of paren
  m = t.match(/\s(\d{1,3})(?:v\d)?\s*\[\d{3,4}p\]/);
  if (m) return parseInt(m[1]);
  // Pattern 4: standalone " - 12 " surrounded by spaces
  m = t.match(/\s-(\d{1,3})(?:v\d)?\s/);
  if (m) return parseInt(m[1]);
  // Pattern 5: S01E12
  m = t.match(/S\d{1,2}E(\d{1,3})/i);
  if (m) return parseInt(m[1]);
  // Pattern 6: loose " 12 " before quality marker without parens/brackets
  m = t.match(/\s(\d{1,3})(?:v\d)?\s+(?:\d{3,4}p|HEVC|x265|x264|AV1|AAC|FLAC)/);
  if (m) return parseInt(m[1]);
  // Pattern 7: episode number at end of base title before extension
  m = t.match(/\s(\d{1,3})(?:v\d)?\s*(?:\.mkv|\.mp4|\.avi|$)/);
  if (m) return parseInt(m[1]);
  return null;
}

// ================================================================
//  AUTO-DOWNLOAD POLLER
// ================================================================

let autoDownloadInterval = null;

async function runAutoDownloadPoller(force = false) {
  const cfg = d().config;
  const results = { downloaded: [], no_results: [], no_exact_match: [], dedup: [], error: [], skipped_local: [], polled: false, disabled: false };
  if (!cfg.autoDownloadEnabled && !force) { results.disabled = true; return results; }
  // Sync MAL airing series to watchlist before polling
  if (d().config.malAccessToken) {
    try { await syncAutoDownloadCriteria(); } catch(e) { console.error('[AutoDL] Pre-poll sync failed:', e.message); }
  }
  // Fallback: scan local library for MAL-linked airing series with missing episodes
  const libraryScan = d().getLibraryScan ? d().getLibraryScan() : [];
  let localAdded = 0;
  if (libraryScan && libraryScan.length) {
    for (const series of libraryScan) {
      const wd = d().getWatchDataSync ? d().getWatchDataSync(series.name) : null;
      if (!wd || !wd.malData) continue;
      const md = wd.malData;
      if (md.status !== 'currently_airing') continue;
      const localEps = d().getLocalEpisodes ? d().getLocalEpisodes(series.name, wd.malId || null) : [];
      const localSet = new Set(localEps);
      const totalEps = md.num_episodes || 0;
      const startDate = md.start_date || '';
      let latestAired = totalEps;
      if (startDate) {
        const start = new Date(startDate);
        const now = new Date();
        const weeks = Math.floor((now - start) / (7 * 24 * 3600000)) + 1;
        latestAired = totalEps ? Math.min(weeks, totalEps) : weeks;
      }
      let hasMissing = false;
      for (let ep = 1; ep <= latestAired; ep++) {
        if (!localSet.has(ep)) { hasMissing = true; break; }
      }
      if (!hasMissing) continue;
      const exists = cfg.autoDownloadWatchlist.find(w => w.malId === wd.malId || d().fuzzyTitleMatch(w.seriesName, series.name) > 0.8);
      if (exists) {
        if (!exists.latestAired && latestAired > 0) {
          exists.latestAired = latestAired;
          exists.totalEps = totalEps;
          d().saveConfig();
        }
        continue;
      }
      const localHighest = localEps.length ? Math.max(...localEps) : 0;
      cfg.autoDownloadWatchlist.push({
        seriesName: series.name,
        malId: wd.malId,
        lastLocalEp: localHighest,
        lastDownloadedEp: localHighest,
        latestAired: latestAired,
        totalEps: totalEps,
        preferredUploader: cfg.nyaaUploader || 'erai',
        quality: cfg.nyaaQuality || '1080p',
        source: 'local',
        addedAt: Date.now()
      });
      localAdded++;
      console.log('[AutoDL] Local scan added:', series.name, 'missing up to ep', latestAired);
    }
    if (localAdded) {
      d().saveConfig();
      console.log('[AutoDL] Local scan complete: added', localAdded, 'series from library');
    }
  }
  const watchlist = cfg.autoDownloadWatchlist || [];
  if (!watchlist.length) return results;
  results.polled = true;

  for (const entry of watchlist) {
    try {
      if (!entry.seriesName) continue;
      const uploader = entry.preferredUploader || cfg.nyaaUploader || 'erai';
      const quality = entry.preferredQuality || cfg.nyaaQuality || '1080p';
      const nowMs = Date.now();
      const pollInterval = (cfg.autoDownloadPollMinutes || 30) * 60 * 1000;

      // Skip if not enough time since last check
      if (!force && entry.lastChecked && (nowMs - entry.lastChecked) < Math.max(pollInterval * 0.8, 5 * 60 * 1000)) {
        console.log('[AutoDL] Skip recent check:', entry.seriesName);
        continue;
      }

      // ── Batch download loop: download consecutive missing episodes using cursor ──
      let batchCount = 0;
      const maxBatch = 6;
      let cursorEp = entry.lastDownloadedEp + 1;
      const latestAired = entry.latestAired || entry.totalEps || 0;
      const maxEp = latestAired > 0 ? latestAired : cursorEp + 12;

      while (batchCount < maxBatch && cursorEp <= maxEp) {
        console.log('[AutoDL] Target episode:', cursorEp, '| uploader:', uploader, '| quality:', quality);

        // Skip if already in local library
        const localEps = d().getLocalEpisodes ? d().getLocalEpisodes(entry.seriesName, entry.malId || null) : [];
        if (localEps.includes(cursorEp)) {
          console.log('[AutoDL] Already have local copy:', entry.seriesName, 'ep', cursorEp);
          entry.lastDownloadedEp = cursorEp;
          cursorEp++;
          continue;
        }

        // 1hr soft dedup check — skip to next rather than break
        const dedupKey = [entry.seriesName, cursorEp, 'ep'].join('|');
        if (!force) {
          const history = Array.isArray(cfg.downloadHistory) ? cfg.downloadHistory : [];
          const recent = history.find(h => h && h.key === dedupKey && (nowMs - (h.timestamp || 0)) < 60 * 60 * 1000);
          if (recent) {
            const minsAgo = Math.floor((nowMs - recent.timestamp) / 60000);
            console.log('[AutoDL] Skip dedup:', entry.seriesName, 'ep', cursorEp, '— downloaded', minsAgo, 'min ago');
            results.dedup.push({ series: entry.seriesName, episode: cursorEp, minutesAgo: minsAgo });
            cursorEp++;
            continue;
          }
        } else {
          console.log('[AutoDL] Force mode — bypassing dedup window');
        }

        // Season-aware multi-query search (both padded & unpadded)
        const seasonInfo = extractSeasonInfo(entry.seriesName);
        const baseName = seasonInfo.cleanName || entry.seriesName;
        const season = seasonInfo.season;
        const seasonSuffix = seasonInfo.suffix || '';
        const epPadded = String(cursorEp).padStart(2, '0');
        const epRaw = String(cursorEp);
        const queries = [];

        if (uploader === 'erai') {
          queries.push('[Erai-raws] ' + baseName + seasonSuffix + ' - ' + epPadded);
          queries.push('[Erai-raws] ' + baseName + seasonSuffix + ' - ' + epRaw);
          queries.push('[Erai-raws] ' + baseName + seasonSuffix + ' ' + epPadded + ' ' + quality);
          queries.push('[Erai-raws] ' + baseName + seasonSuffix + ' ' + epRaw + ' ' + quality);
        } else if (uploader === 'subsplease') {
          queries.push('[SubsPlease] ' + baseName + seasonSuffix + ' (' + quality + ') ' + epPadded);
          queries.push('[SubsPlease] ' + baseName + seasonSuffix + ' (' + quality + ') ' + epRaw);
          queries.push('[SubsPlease] ' + baseName + seasonSuffix + ' ' + epPadded);
        } else if (uploader === 'judas') {
          queries.push('[Judas] ' + baseName + seasonSuffix + ' ' + epPadded + ' ' + quality);
          queries.push('[Judas] ' + baseName + seasonSuffix + ' ' + epRaw + ' ' + quality);
          queries.push('[Judas] ' + baseName + seasonSuffix + ' ' + epPadded);
        } else {
          queries.push(baseName + seasonSuffix + ' ' + epPadded + ' ' + quality);
          queries.push(baseName + seasonSuffix + ' ' + epRaw + ' ' + quality);
          queries.push(baseName + seasonSuffix + ' ' + epPadded);
          queries.push(baseName + seasonSuffix + ' ' + epRaw);
        }
        queries.push(baseName + seasonSuffix + ' ' + epPadded);
        queries.push(baseName + seasonSuffix + ' ' + epRaw);
        queries.push(baseName + ' ' + epPadded);
        queries.push(baseName + ' ' + epRaw);
        if (season > 1) {
          const ord = ['','1st','2nd','3rd','4th','5th','6th','7th','8th','9th','10th','11th','12th'];
          queries.push(baseName + ' ' + (ord[season] || season + 'th') + ' Season ' + epPadded);
          queries.push(baseName + ' ' + (ord[season] || season + 'th') + ' Season ' + epRaw);
        }
        console.log('[AutoDL] Queries:', queries);
        console.log('[AutoDL] Season info:', seasonInfo);

        let allResults = [];
        const seenIds = new Set();
        let queryIndex = 0;
        for (const q of queries) {
          if (queryIndex > 0) await new Promise(r => setTimeout(r, 200));
          console.log('[AutoDL] Searching:', q);
          const r = await nyaaSearch(q);
          console.log('[AutoDL] Query returned', r.length, 'results');
          for (const item of r) {
            if (!seenIds.has(item.id)) {
              seenIds.add(item.id);
              allResults.push(item);
            }
          }
          if (allResults.length > 0) break;
          queryIndex++;
        }

        if (!allResults.length) {
          console.log('[AutoDL] No results for', entry.seriesName, 'ep', cursorEp);
          results.no_results.push({ series: entry.seriesName, episode: cursorEp, queries });
          break;
        }

        let matched = allResults.map(r => ({ ...r, ep: parseNyaaEpisodeNumber(r.title) }))
          .filter(r => r.ep === cursorEp);
        console.log('[AutoDL] Exact episode matches:', matched.length, 'of', allResults.length, 'scanned');

        // Season guard
        if (season > 1 && matched.length > 1) {
          const beforeFilter = matched.length;
          matched = matched.filter(r => {
            const t = r.title.toLowerCase();
            const wrongSeason = new RegExp('\\b(?:s(?!' + season + '\\b)\\d{1,2}|(?!' + season + '\\b)\\d{1,2}(?:nd|rd|th|st)\\s*season|season\\s*(?!' + season + '\\b)\\d{1,2})\\b', 'i');
            if (wrongSeason.test(t)) {
              console.log('[AutoDL] Season filter rejected (wrong season):', r.title.substring(0, 60));
              return false;
            }
            return true;
          });
          if (matched.length < beforeFilter) {
            console.log('[AutoDL] Season filter removed', beforeFilter - matched.length, 'wrong-season releases');
          }
        }

        if (!matched.length) {
          console.log('[AutoDL] No exact episode match for', entry.seriesName, 'ep', cursorEp, '(season', season, ')');
          results.no_exact_match.push({ series: entry.seriesName, episode: cursorEp, season, candidates: allResults.slice(0, 3).map(r => r.title) });
          break;
        }

        const scoreCtx = { h264Ceiling: computeH264Ceiling(matched) };
        const chosen = matched.reduce((best, r) => {
          const s = scoreRelease(r, uploader, scoreCtx);
          const bs = best ? scoreRelease(best, uploader, scoreCtx) : -Infinity;
          return s > bs ? r : best;
        }, null);

        if (!chosen) {
          console.log('[AutoDL] Scoring produced no winner for', entry.seriesName);
          results.no_exact_match.push({ series: entry.seriesName, episode: cursorEp, reason: 'scoring produced no winner' });
          break;
        }
        console.log('[AutoDL] Chosen release:', chosen.title, '| seeds:', chosen.seeders, '| size:', chosen.size);

        // Download trigger
        let method = 'magnet';
        if (chosen.id) {
          console.log('[AutoDL] Downloading .torrent for Nyaa id', chosen.id);
          const torrentData = await downloadNyaaTorrentFile(chosen.id);
          const tmpDir = path.join(d().app.getPath('temp'), 'animevault-torrents');
          fs.mkdirSync(tmpDir, { recursive: true });
          const safeName = chosen.title.replace(/[\/:*?"<>|]/g, '_').substring(0, 80);
          const tmpFile = path.join(tmpDir, safeName + '.torrent');
          fs.writeFileSync(tmpFile, torrentData);
          await d().shell.openPath(tmpFile);
          method = 'external';
        } else {
          console.log('[AutoDL] Opening magnet link');
          await d().shell.openExternal(chosen.magnet);
        }

        // Log to history
        const logEntry = {
          timestamp: nowMs,
          key: dedupKey,
          series: entry.seriesName,
          episode: cursorEp,
          dlMode: 'ep',
          chosenTitle: chosen.title,
          seeders: chosen.seeders || 0,
          size: chosen.size || '',
          nyaaId: chosen.id || '',
          preferredUploader: uploader,
          method
        };
        d().pushDownloadHistory(logEntry);

        entry.lastDownloadedEp = cursorEp;
        entry.lastChecked = nowMs;
        d().saveConfig();

        console.log('[AutoDL] SUCCESS:', entry.seriesName, 'ep', cursorEp, 'via', method);
        results.downloaded.push({ series: entry.seriesName, episode: cursorEp, title: chosen.title, seeders: chosen.seeders });

        cursorEp++;
        batchCount++;
      }

      if (cursorEp > maxEp && latestAired > 0) {
        entry.lastChecked = nowMs;
        d().saveConfig();
      }
// Legacy per-download toast
      if (results.downloaded.length > 0) {
        const latest = results.downloaded[results.downloaded.length - 1];
        if (d().mainWindow && !d().mainWindow().isDestroyed()) {
          d().mainWindow().webContents.send('autoDownload:toast', {
            series: entry.seriesName,
            episode: latest.episode,
            title: latest.title
          });
        }
      }
      if (results.dedup.length > 0 && !results.downloaded.length) {
        const lastDedup = results.dedup[results.dedup.length - 1];
        if (d().mainWindow && !d().mainWindow().isDestroyed()) {
          d().mainWindow().webContents.send('autoDownload:toast', {
            series: entry.seriesName,
            episode: lastDedup.episode,
            title: 'downloaded ' + lastDedup.minutesAgo + ' min ago'
          });
        }
      }
    } catch (err) {
      console.error('[AutoDL] Error processing', entry.seriesName, ':', err.message);
      results.error.push({ series: entry.seriesName, error: err.message });
    }
  }

  if (d().mainWindow && !d().mainWindow().isDestroyed()) {
    d().mainWindow().webContents.send('autoDownload:pollComplete', results);
  }
  return results;
}

function startAutoDownloadPoller(ms) {
  if (!ms || ms < 60000) ms = 30 * 60 * 1000;
  console.log('[AutoDL] Starting poller: interval =', Math.round(ms / 60000), 'min');
  setTimeout(() => runAutoDownloadPoller(), 10000);
  autoDownloadInterval = setInterval(() => runAutoDownloadPoller(), ms);
}

function stopAutoDownloadPoller() {
  if (autoDownloadInterval) {
    clearInterval(autoDownloadInterval);
    autoDownloadInterval = null;
  }
}

async function syncAutoDownloadCriteria() {
  console.log('[AutoDL] Criteria sync starting... criteria=', d().config.autoDownloadCriteria, 'malAuth=', !!d().config.malAccessToken);
  if (!d().config.malAccessToken) {
    console.log('[AutoDL] Criteria sync abort: MAL not connected');
    return;
  }
  if (d().config.vaultMode === 'manga') {
    console.log('[AutoDL] Criteria sync abort: manga mode');
    return;
  }
  try {
    // FIX: Use animelist with fields=list_status so we get status from list_status, not node.status
    const r = await d().malRequestWithRetry(`/users/@me/animelist?status=watching&limit=100&fields=list_status,status,num_episodes,broadcast,start_date`);
    const items = (r.data && r.data.data) || [];
    console.log('[AutoDL] Criteria sync: fetched', items.length, 'MAL watching entries');
    let added = 0;
    let skipped = 0;
    for (const item of items) {
      const node = item.node;
      // FIX: Use list_status.status for the user's list status, node.status for the anime's broadcast status
      const listStatus = item.list_status ? item.list_status.status : '';
      const broadcastStatus = node.status || '';
      console.log('[AutoDL] Criteria checking:', node.title, '| broadcast=', broadcastStatus, '| airing=', broadcastStatus === 'currently_airing');
      if (broadcastStatus !== 'currently_airing') {
        console.log('[AutoDL] Criteria skip (not airing):', node.title);
        continue;
      }
      const exists = d().config.autoDownloadWatchlist.find(w => w.malId === node.id || d().fuzzyTitleMatch(w.seriesName, node.title) > 0.8);
      const localHighest = d().getLocalHighestEpisode(node.title, node.id);
      const totalEps = node.num_episodes || 0;
      const startDate = node.start_date || '';
      let latestAired = totalEps;
      if (broadcastStatus === 'currently_airing' && startDate) {
        const start = new Date(startDate);
        const now = new Date();
        const weeks = Math.floor((now - start) / (7 * 24 * 3600000)) + 1;
        latestAired = totalEps ? Math.min(weeks, totalEps) : weeks;
      }
      if (exists) {
        if (!exists.latestAired && latestAired > 0) {
          exists.latestAired = latestAired;
          exists.totalEps = totalEps;
          d().saveConfig();
          console.log('[AutoDL] Updated existing entry latestAired to', latestAired, 'for', node.title);
        }
        console.log('[AutoDL] Criteria skip (already tracked):', node.title);
        continue;
      }
      console.log('[AutoDL] Criteria localHighest=', localHighest, 'latestAired=', latestAired, 'for', node.title);
      if (localHighest >= latestAired && localHighest > 0) {
        console.log('[AutoDL] Criteria skip (local up-to-date):', node.title);
        skipped++;
        continue;
      }
      d().config.autoDownloadWatchlist.push({
        seriesName: node.title,
        malId: node.id,
        lastLocalEp: localHighest,
        lastDownloadedEp: localHighest,
        latestAired: latestAired,
        totalEps: totalEps,
        preferredUploader: d().config.nyaaUploader || 'erai',
        quality: d().config.nyaaQuality || '1080p',
        source: 'criteria',
        addedAt: Date.now()
      });
      added++;
      console.log('[AutoDL] Criteria added:', node.title);
    }
    if (added || skipped) {
      d().saveConfig();
      console.log('[AutoDL] Criteria sync complete: added', added, 'skipped', skipped);
      if (d().mainWindow && !d().mainWindow().isDestroyed()) {
        d().mainWindow().webContents.send('autoDownload:toast', {
          message: `Auto-tracked ${added} airing series from MAL (${skipped} skipped, already up-to-date)`
        });
      }
    } else {
      console.log('[AutoDL] Criteria sync complete: nothing changed');
    }
  } catch (e) {
    console.error('[AutoDL] Criteria sync failed:', e.message, e.stack);
  }
}


// Search variant generator for special-character handling
function getSearchVariants(query) {
  const variants = [query];
  // Replace special chars with spaces
  variants.push(query.replace(/[:!?;~]/g, ' ').replace(/\s+/g, ' ').trim());
  // Remove special chars entirely
  variants.push(query.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim());
  // Replace with empty string
  variants.push(query.replace(/[:!?;~]/g, '').replace(/\s+/g, ' ').trim());
  return variants.filter((v, i, a) => v && a.indexOf(v) === i);
}

module.exports = {
  setDeps,
  normalizeMagnet,
  nyaaSearch,
  nyaaSearchHtml,
  nyaaSearchCached,
  downloadNyaaTorrentFile,
  parseReleaseSize,
  scoreRelease,
  computeH264Ceiling,
  extractSeasonInfo,
  getNextEpisodeNumber,
  parseNyaaEpisodeNumber,
  runAutoDownloadPoller,
  startAutoDownloadPoller,
  stopAutoDownloadPoller,
  syncAutoDownloadCriteria,
};
