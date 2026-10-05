const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

let _deps = null;
const HANDOFF_GRACE_MS = 24 * 60 * 60 * 1000;

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

// HTML/XML entities in Nyaa titles ("Kaguya-sama: Love Is War &amp; ...",
// "Frieren&#39;s"), named, decimal and hex.
function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Nyaa rate-limits bursts with HTTP 429; back off instead of hammering it.
let _nyaaBackoffUntil = 0;
function noteNyaaStatus(res) {
  if (res.statusCode !== 429) return false;
  const retry = parseInt(res.headers && res.headers['retry-after'], 10);
  _nyaaBackoffUntil = Date.now() + (Number.isFinite(retry) && retry > 0 ? Math.min(retry, 600) : 60) * 1000;
  console.warn('[Nyaa] Rate limited (429); pausing searches until', new Date(_nyaaBackoffUntil).toISOString());
  return true;
}

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
    if (Date.now() < _nyaaBackoffUntil) { resolve([]); return; }
    const req = https.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } }, (res) => {
      if (noteNyaaStatus(res) || res.statusCode !== 200) { res.resume(); resolve([]); return; }
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
              const title = decodeEntities(titleMatch[1].trim());
              if (/\bRAW\b/i.test(title) && !/multi/i.test(title) && !/sub/i.test(title)) continue;
              const linkMatch = item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/) || item.match(/<link>([\s\S]*?)<\/link>/);
              const idMatch = linkMatch ? linkMatch[1].match(/\/view\/(\d+)/) : null;
              const id = idMatch ? idMatch[1] : '';
              const infoHashMatch = item.match(/<nyaa:infoHash>([\s\S]*?)<\/nyaa:infoHash>/);
              let magnet = '';
              if (infoHashMatch) {
                const infoHash = infoHashMatch[1].trim();
                if (!/^[a-fA-F0-9]{40}$/.test(infoHash)) continue;
                magnet = 'magnet:?xt=urn:btih:' + infoHash + '&dn=' + encodeURIComponent(title)
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
              const pubDateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
              const publishedAt = pubDateMatch && !isNaN(Date.parse(pubDateMatch[1].trim()))
                ? new Date(pubDateMatch[1].trim()).toISOString()
                : '';
              results.push({ id, title, magnet, size, seeders, leechers, publishedAt });
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
      if (Date.now() < _nyaaBackoffUntil) { res([]); return; }
      const req = https.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } }, (response) => {
        if (noteNyaaStatus(response) || response.statusCode !== 200) { response.resume(); res([]); return; }
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
                  title: decodeEntities(titleMatch[1]),
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
            res([]);
          }
        });
      });
      req.on('error', (e) => { console.error('[nyaaSearchHtml] Request error:', e.message); res([]); });
      req.on('timeout', () => { req.destroy(); res([]); });
      req.setTimeout(15000);
    });
    (async () => {
      let results = await doSearch(query);
      // FIX #2: If no results, try normalized variants for special character handling
      if (!results || results.length === 0) {
        const variants = getSearchVariants(query);
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
const NYAA_CACHE_MAX = 300;

function nyaaSearchCached(query) {
  const now = Date.now();
  const key = query.toLowerCase().trim();
  const hit = _nyaaCache[key];
  if (hit && (now - hit.ts) < NYAA_CACHE_TTL) {
    return Promise.resolve(hit.results);
  }
  // Prune expired entries and cap the cache so long sessions cannot grow it unbounded.
  const keys = Object.keys(_nyaaCache);
  if (keys.length >= NYAA_CACHE_MAX) {
    keys.forEach(k => { if (now - _nyaaCache[k].ts >= NYAA_CACHE_TTL) delete _nyaaCache[k]; });
    if (Object.keys(_nyaaCache).length >= NYAA_CACHE_MAX) {
      const oldest = keys.sort((a, b) => _nyaaCache[a].ts - _nyaaCache[b].ts).slice(0, 50);
      oldest.forEach(k => delete _nyaaCache[k]);
    }
  }
  return nyaaSearch(query).then((results) => {
    _nyaaCache[key] = { ts: now, results };
    return results;
  }).catch(() => []);
}

function downloadNyaaTorrentFile(nyaaId) {
  return new Promise((resolve, reject) => {
    const id = String(nyaaId || '').trim();
    if (!/^\d{1,10}$/.test(id)) { reject(new Error('Invalid Nyaa id')); return; }
    const url = 'https://nyaa.si/download/' + id + '.torrent';
    const req = https.get(url, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 10 * 1024 * 1024) { req.destroy(new Error('Torrent file too large')); return; } chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('aborted', () => reject(new Error('Torrent download interrupted')));
      res.on('error', (e) => reject(e));
    });
    req.on('error', (e) => reject(e));
    // A stalled server must not hold the poller forever: abort, which rejects.
    req.setTimeout(20000, () => req.destroy(new Error('Torrent download timed out')));
  });
}

// Hands a chosen release to the user's torrent client: the .torrent file
// (opened with whatever app handles .torrent) or, failing that, the magnet
// link. shell.openPath reports failure as a returned string, not a throw.
// Resolves {ok, method} or {ok:false, error}.
async function handOffToClient(chosen) {
  const magnet = chosen && chosen.magnet && /^magnet:\?/i.test(chosen.magnet) ? chosen.magnet : '';
  const viaMagnet = async (why) => {
    if (!magnet) return { ok: false, error: why || 'This release has no download link' };
    try { await d().shell.openExternal(magnet); return { ok: true, method: 'magnet' }; }
    catch (e) { return { ok: false, error: 'No torrent client opened the magnet link' + (why ? ' (' + why + ')' : '') + '. Install one (qBittorrent, for example) and try again.' }; }
  };
  if (chosen && chosen.id) {
    let tmpFile;
    try {
      const torrentData = await downloadNyaaTorrentFile(chosen.id);
      const tmpDir = path.join(d().app.getPath('temp'), 'animevault-torrents');
      fs.mkdirSync(tmpDir, { recursive: true });
      const safeName = String(chosen.title || 'release').replace(/[\\/:*?"<>|]/g, '_').substring(0, 80);
      tmpFile = path.join(tmpDir, safeName + '.torrent');
      fs.writeFileSync(tmpFile, torrentData);
    } catch (e) {
      return viaMagnet('the .torrent download failed: ' + e.message);
    }
    const openErr = await d().shell.openPath(tmpFile);
    if (!openErr) return { ok: true, method: 'external' };
    return viaMagnet('no app opens .torrent files: ' + openErr);
  }
  return viaMagnet('');
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

// ================================================================
//  RELEASE CHOICE (5.1)
//  Erai-raws is the go-to group. When it has no valid release, the most
//  popular (most-seeded) release from any group wins, so matches follow what
//  people actually seed. "Prefer HEVC" puts a healthy HEVC release (3+
//  seeders) ahead of other codecs; newer uploads break ties. Full-series
//  requests rank batch/season packs ahead of single episodes.
// ================================================================
const PREFERRED_GROUP = 'erai';
const HEALTHY_SEEDERS = 3;
function isHevcRelease(r) { return /\b(hevc|x265|h\.?265)\b/i.test(String(r && r.title || '')); }
function isBatchRelease(r) {
  const t = String(r && r.title || '');
  // "Batch"/"Complete", ranges like "01 ~ 12" or "(01-12)", or no episode number at all
  return /\b(?:batch|complete|全集|season\s*pack)\b/i.test(t) || /\b\d{1,3}\s*~\s*\d{1,3}\b/.test(t) ||
    /\(\s*\d{1,3}\s*-\s*\d{1,3}\s*\)/.test(t) || parseNyaaEpisodeNumber(t) === null;
}
function releaseGroup(r) {
  const m = String(r && r.title || '').match(/^\s*\[([^\]]{1,40})\]/);
  return m ? m[1] : '';
}
function rankReleases(results, opts = {}) {
  const preferHevc = opts.preferHevc !== undefined ? !!opts.preferHevc : (d().config.forceHevc !== false);
  const wantBatch = !!opts.batch;
  const list = (results || []).filter(Boolean);
  // "Avoid oversized HEVC": an HEVC file over twice the best H.264 size loses its codec preference.
  const h264Ceiling = d().config.avoidOversizedHevc ? computeH264Ceiling(list) : 0;
  const keyed = list.map(r => ({
    r,
    group: releaseMatchesUploader(r, PREFERRED_GROUP) ? 0 : 1,
    batch: wantBatch ? (isBatchRelease(r) ? 0 : 1) : 0,
    hevc: preferHevc && isHevcRelease(r) && (r.seeders || 0) >= HEALTHY_SEEDERS &&
      !(h264Ceiling && parseReleaseSize(r.size) > h264Ceiling * 2) ? 0 : 1,
    seeders: Number(r.seeders) || 0,
    published: getReleasePublishedMs(r) || 0,
  }));
  keyed.sort((a, b) => a.batch - b.batch || a.group - b.group || a.hevc - b.hevc || b.seeders - a.seeders || b.published - a.published);
  return keyed.map(k => k.r);
}
// Compact, renderer-safe description of a candidate for the release picker.
function describeRelease(r) {
  const t = String(r.title || '');
  const res = (t.match(/\b(480|720|1080|2160)p\b/i) || [])[1];
  return {
    title: t, group: releaseGroup(r), seeders: Number(r.seeders) || 0, size: r.size || '',
    codec: isHevcRelease(r) ? 'HEVC' : (/\b(h\.?264|x264|avc)\b/i.test(t) ? 'H.264' : ''),
    resolution: res ? res + 'p' : '', preferred: releaseMatchesUploader(r, PREFERRED_GROUP),
    published: getReleasePublishedMs(r) || 0,
  };
}

function normalizeUploaderKey(value) {
  const key = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key === 'erai' || key === 'erairaw' || key === 'erairaws') return 'erairaws';
  if (key === 'subsplease') return 'subsplease';
  if (key === 'judas') return 'judas';
  if (key === 'varyg') return 'varyg';
  return key;
}

function releaseMatchesUploader(release, preferredUploader) {
  const wanted = normalizeUploaderKey(preferredUploader);
  if (!wanted || wanted === 'raw') return false;
  const titleKey = String(release && release.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return titleKey.includes(wanted);
}

function preferUploaderMatches(results, preferredUploader) {
  const preferred = (results || []).filter(item => releaseMatchesUploader(item, preferredUploader));
  return preferred.length ? preferred : (results || []);
}

const TITLE_NOISE_WORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'in', 'on', 'to', 'for', 'with',
  'wa', 'no', 'ni', 'ga', 'de', 'desu', 'to', 'wo', 'o', 'kai',
  'season', 'cour', 'part'
]);

function normalizeTitleWords(value) {
  return String(value || '').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^\s*\[[^\]]+\]\s*/, '')
    .replace(/\b([a-z]{3,}?)(sama|san|chan|kun)\b/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().split(/\s+/).filter(Boolean);
}

function romanSeasonNumber(token) {
  const roman = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
  return roman[String(token || '').toLowerCase()] || 0;
}

function meaningfulTitleWords(value) {
  const base = normalizeTitleWords(value).filter(word => !TITLE_NOISE_WORDS.has(word));
  const filtered = base.filter(word =>
    !/^s\d{1,2}$/.test(word) && !/^\d{1,2}(?:st|nd|rd|th)$/.test(word) &&
    !/^\d{1,2}$/.test(word) && !romanSeasonNumber(word)
  );
  // Numeric or Roman-numeral-only titles still need a usable identity/anchor.
  return filtered.length ? filtered : base;
}

function detectTitleSeason(value) {
  const text = String(value || '');
  let m = text.match(/\bS(?:eason)?\s*(\d{1,2})\b/i) ||
    text.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+Season\b/i) ||
    text.match(/\bSeason\s*(\d{1,2})\b/i);
  if (m) return parseInt(m[1], 10) || 0;
  // Some licensors use a bare Roman numeral immediately after the short
  // franchise name while metadata appends a longer subtitle afterwards.
  m = text.replace(/^\s*\[[^\]]+\]\s*/, '').match(/^\S+\s+(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)(?:\s|$)/i);
  if (m) return romanSeasonNumber(m[1]);
  const cleaned = text.replace(/^\s*\[[^\]]+\]\s*/, '')
    .replace(/\s+-\s+\d{1,3}(?:v\d+)?[\s\[].*$/i, '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').trim();
  m = cleaned.match(/(?:^|\s)(\d{1,2})\s*$/);
  if (m) return parseInt(m[1], 10) || 0;
  m = cleaned.match(/(?:^|\s)(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)\s*$/i);
  return m ? romanSeasonNumber(m[1]) : 0;
}

function getReleaseSeriesTitle(releaseTitle) {
  return String(releaseTitle || '')
    .replace(/^\s*\[[^\]]+\]\s*/, '')
    .replace(/\s+-\s+(?:EP(?:isode)?\s*)?\d{1,3}(?:v\d+)?(?:\s|\[|\(|$)[\s\S]*$/i, '')
    .replace(/\s+S\d{1,2}E\d{1,3}[\s\S]*$/i, '')
    .replace(/\[[^\]]*(?:p|hevc|x26[45]|av1|aac|flac|multisub|webrip)[^\]]*\]/gi, ' ')
    .trim();
}

function titleTokenMatch(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function seriesTitleMatchConfidence(seriesTitle, releaseOrTitle) {
  const candidateTitle = typeof releaseOrTitle === 'string'
    ? getReleaseSeriesTitle(releaseOrTitle)
    : getReleaseSeriesTitle(releaseOrTitle && releaseOrTitle.title);
  const wantedSeason = detectTitleSeason(seriesTitle);
  const candidateSeason = detectTitleSeason(candidateTitle);
  if (wantedSeason && candidateSeason && wantedSeason !== candidateSeason) return 0;

  const wanted = meaningfulTitleWords(seriesTitle);
  const candidate = meaningfulTitleWords(candidateTitle);
  if (!wanted.length || !candidate.length) return 0;

  const compactWanted = wanted.join('');
  const compactCandidate = candidate.join('');
  if (compactWanted === compactCandidate) return 1;
  if (Math.min(compactWanted.length, compactCandidate.length) >= 8 &&
      (compactWanted.includes(compactCandidate) || compactCandidate.includes(compactWanted))) return 0.96;

  let wantedMatches = 0;
  for (const token of wanted) {
    if (candidate.some(other => titleTokenMatch(token, other))) wantedMatches++;
  }
  let candidateMatches = 0;
  for (const token of candidate) {
    if (wanted.some(other => titleTokenMatch(token, other))) candidateMatches++;
  }
  const wantedCoverage = wantedMatches / wanted.length;
  const candidateCoverage = candidateMatches / candidate.length;
  const firstAnchorMatches = titleTokenMatch(wanted[0], candidate[0]);

  // Release groups frequently shorten a long licensor title to its distinctive
  // first word (for example, "Clevatess II"). Only allow that shortcut when
  // the release title contains no competing descriptive title tokens.
  if (firstAnchorMatches && wanted[0].length >= 7 && candidate.length === 1) return 0.88;
  if (firstAnchorMatches && wantedCoverage >= 0.62 && candidateCoverage >= 0.72) {
    return Math.min(0.95, (wantedCoverage + candidateCoverage) / 2);
  }
  return 0;
}

// How a release's season tag fits the wanted season:
//   'yes'      same season (or both season 1 / untagged)
//   'no'       a different season
//   'unmarked' a sequel is wanted but the release has no season tag; season 1
//              releases look exactly like this, so it needs more proof (date)
function releaseSeasonFit(release, seriesTitle, entry) {
  const wanted = detectTitleSeason(seriesTitle) || detectTitleSeason(entry && entry.seriesName) || 0;
  const candidate = detectTitleSeason(getReleaseSeriesTitle(release && release.title));
  if (wanted >= 2) return candidate === wanted ? 'yes' : (candidate ? 'no' : 'unmarked');
  return candidate >= 2 ? 'no' : 'yes';
}

// Without tracking data there is no season start date, so an untagged release
// never stands in for a sequel ("Koori no Jouheki - 01" is season 1).
function releaseMatchesSeriesTitle(release, seriesTitle) {
  return seriesTitleMatchConfidence(seriesTitle, release) >= 0.72 && releaseSeasonFit(release, seriesTitle, null) === 'yes';
}

function releaseMatchesQuality(release, quality) {
  const wanted = String(quality || '').toLowerCase().match(/(480|720|1080|2160)/);
  if (!wanted) return true;
  const found = String(release && release.title || '').toLowerCase().match(/\b(480|720|1080|2160)p?\b/);
  return !found || found[1] === wanted[1];
}

function getSearchAnchor(seriesTitle) {
  const words = meaningfulTitleWords(seriesTitle);
  if (!words.length) return '';
  if (/^\d+$/.test(words[0])) return words[0];
  if (words[0].length >= 5) return words[0];
  return words.slice(0, 2).join(' ');
}

function getCompactSearchQuery(seriesTitle, preferredUploader, epNum, forceHevc = true) {
  const anchor = getSearchAnchor(seriesTitle);
  if (!anchor) return '';
  const uploader = normalizeUploaderKey(preferredUploader);
  const uploaderTerm = uploader === 'erairaws' ? 'erai' : uploader === 'raw' ? '' : uploader;
  const codecTerm = forceHevc ? 'hevc' : '';
  const episodeTerm = epNum == null ? '' : String(parseInt(epNum, 10)).padStart(2, '0');
  return [uploaderTerm, codecTerm, anchor, episodeTerm].filter(Boolean).join(' ');
}

function buildEpisodeSearchQueries(seriesTitle, quality, preferredUploader, epNum, forceHevc = true) {
  const epRaw = String(parseInt(epNum, 10));
  const epPadded = epRaw.padStart(2, '0');
  const compactWithEpisode = getCompactSearchQuery(seriesTitle, preferredUploader, epNum, forceHevc);
  const compactByDate = getCompactSearchQuery(seriesTitle, preferredUploader, null, forceHevc);
  const anchor = getSearchAnchor(seriesTitle);
  const fullVariants = getSearchVariants(seriesTitle).slice(0, 4);
  const uploader = normalizeUploaderKey(preferredUploader);
  const full = [];
  const broad = [];
  for (const title of fullVariants) {
    if (uploader === 'erairaws') {
      full.push(`[Erai-raws] ${title} - ${epPadded} ${quality}`);
      full.push(`[Erai-raws] ${title} - ${epRaw}`);
    } else if (uploader === 'subsplease') {
      full.push(`[SubsPlease] ${title} - ${epPadded} (${quality})`);
    } else if (uploader === 'judas') {
      full.push(`[Judas] ${title} ${epPadded} ${quality}`);
    } else {
      full.push(`${title} ${epPadded} ${quality}`, `${title} ${epRaw}`);
    }
    broad.push(`${title} ${epPadded} ${quality}`, `${title} ${epRaw}`);
  }
  const broadAnchor = [
    forceHevc && anchor ? `hevc ${anchor} ${epPadded}` : '',
    forceHevc && anchor ? `hevc ${anchor}` : '',
    anchor ? `${anchor} ${epPadded}` : ''
  ];
  return [compactWithEpisode, compactByDate].concat(full, broadAnchor, broad)
    .flatMap(getSearchVariants)
    .filter((query, index, all) => query && all.indexOf(query) === index);
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

function getReleasePublishedMs(release) {
  const raw = release && (release.publishedAt || release.pubDate || release.date);
  const parsed = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function getEntrySeasonStartMs(entry) {
  const raw = entry && (entry.airingStartDate || entry.startDate);
  const parsed = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function releaseMatchesTrackedSeason(release, entry, seriesTitle) {
  if (seriesTitleMatchConfidence(seriesTitle, release) < 0.72) return false;
  const fit = releaseSeasonFit(release, seriesTitle, entry);
  if (fit === 'no') return false;

  // MAL season entries have distinct IDs and start dates even when a release
  // group reuses the same short franchise title. Reject releases published
  // before this entry's season began so an S2/S3 folder cannot inherit S1's
  // episodes (back-to-back cours made a 3-week grace let S1's finale through).
  // An untagged release for a sequel is only accepted with that date proof.
  const seasonStart = getEntrySeasonStartMs(entry);
  const published = getReleasePublishedMs(release);
  if (fit === 'unmarked' && !(seasonStart && published)) return false;
  if (seasonStart && published) {
    const graceMs = (fit === 'unmarked' ? 2 : 7) * 24 * 60 * 60 * 1000;
    if (published < seasonStart - graceMs) return false;
  }
  return true;
}

function normalizeEpisodeList(values) {
  return [...new Set((values || [])
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0 && n <= 9999))]
    .sort((a, b) => a - b);
}

function handoffAgeMs(entry, nowMs) {
  const at = Number(entry.lastDownloadedAt) || 0;
  return at > 0 ? Math.max(0, nowMs - at) : Infinity;
}

function isHandoffTrustworthy(entry, localEpisodes, nowMs, scanReady = true) {
  // The counter from the last handoff is only trusted if the local folder
  // actually contains that episode. Otherwise the files were deleted or moved
  // (or the client never saved them) and the cursor must fall back to reality.
  if (!scanReady) return true; // a not-yet-populated library cache is not a deletion
  const handedOff = Math.max(0, Number(entry.lastDownloadedEp) || 0);
  if (!handedOff) return false;
  const local = normalizeEpisodeList(localEpisodes);

  if (local.includes(handedOff)) return true;

  // Grace window: the episode may still be in flight between the client and
  // the library folder. Beyond it, only the local folder is truth. Each new
  // handoff refreshes the timestamp, so a slow but healthy client keeps the
  // counter trusted while a cancelled/deleted download stops suppressing.
  return handoffAgeMs(entry, nowMs) <= HANDOFF_GRACE_MS;
}

function reconcileTrackingCursor(entry, localEpisodes, verifiedLatest) {
  const local = normalizeEpisodeList(localEpisodes);
  const localHighest = local.length ? local[local.length - 1] : 0;
  const verified = Math.max(0, Number(verifiedLatest) || 0);
  const rawBaseline = entry.trackingBaselineEp;
  const isLegacy = rawBaseline === undefined || rawBaseline === null || rawBaseline === '' ||
    !Number.isInteger(Number(rawBaseline));

  if (isLegacy) {
    // Old watchlist rows may contain counters inferred by pre-4.10.5 builds or
    // counters copied from another season. Prefer the actual local folder. If
    // it cannot be resolved, establish a safe "track from now" baseline rather
    // than opening a whole historical season.
    entry.trackingBaselineEp = localHighest || verified || 0;
    entry.lastDownloadedEp = entry.trackingBaselineEp;
    entry.ledgerMigratedAt = Date.now();
  }

  const baseline = Math.max(0, Number(entry.trackingBaselineEp) || 0);
  if (verified && entry.lastDownloadedEp > verified) {
    entry.lastDownloadedEp = Math.max(baseline, localHighest);
  }
  const handedOff = Math.max(0, Number(entry.lastDownloadedEp) || 0);
  const sameIdentity = entry.trackingIdentityKey && entry.trackingIdentityKey === entry.currentIdentityKey;
  const scanReady = _deps && _deps.getLibraryScanReady ? _deps.getLibraryScanReady() : true;
  const trustworthy = sameIdentity && isHandoffTrustworthy(entry, localEpisodes, Date.now(), scanReady);
  const trustedHandoff = trustworthy ? handedOff : 0;
  const floor = Math.max(baseline, localHighest, trustedHandoff);

  if (handedOff && !trustedHandoff && !isLegacy) {
    // The stored counter points past what the local folder actually contains.
    // Treat the folder as truth so deleted/undownloaded episodes are offered
    // again instead of being skipped silently.
    entry.lastDownloadedEp = localHighest;
    console.log('[AutoDL] Cursor fell back to local folder:', entry.seriesName,
      'stored', handedOff, '->', localHighest);
  }

  entry.lastLocalEp = localHighest;
  return { local, localHighest, floor, nextEpisode: floor + 1, legacyMigrated: isLegacy };
}

function parseNyaaEpisodeNumber(title) {
  if (!title) return null;
  const t = title.replace(/_/g, ' ');

  // Helper: reject 4-digit numbers (years) and validate range
  const validate = (n) => {
    const num = parseInt(n, 10);
    // Long runners reach 4 digits (One Piece 1100); 4-digit years are not episodes.
    if (isNaN(num) || num < 1 || num > 9999) return null;
    if (String(n).length === 4 && num >= 1900 && num <= 2099) return null;
    return num;
  };

  // Pattern 1: "Series - 12 (" or "Series - 12 [" or "Series - 12v2 ("
  let m = t.match(/\s-\s(\d{1,4})(?:v\d+)?\s*[\[(]/);
  if (m) return validate(m[1]);

  // Pattern 1b: "Series - 12 " (space after, no paren/bracket)
  m = t.match(/\s-\s(\d{1,4})(?:v\d+)?\s+(?!\d{4}p?\b)/);
  if (m) return validate(m[1]);

  // Pattern 2: "Series 12 (1080p)" with no dash — require quality paren immediately after
  m = t.match(/\s(\d{1,4})(?:v\d+)?\s*\(\d{3,4}p\)/);
  if (m) return validate(m[1]);

  // Pattern 3: "Series 12 [1080p]" — bracket instead of paren
  m = t.match(/\s(\d{1,4})(?:v\d+)?\s*\[\d{3,4}p\]/);
  if (m) return validate(m[1]);

  // Pattern 4: standalone " - 12 " surrounded by spaces
  m = t.match(/\s-(\d{1,4})(?:v\d+)?\s/);
  if (m) return validate(m[1]);

  // Pattern 5: S01E12
  m = t.match(/S\d{1,2}E(\d{1,4})/i);
  if (m) return validate(m[1]);

  // Pattern 6: loose " 12 " before quality marker without parens/brackets
  // Must be followed by known codec/audio markers, not just any word
  m = t.match(/\s(\d{1,4})(?:v\d+)?\s+(?:\d{3,4}p|HEVC|x265|x264|AV1|AAC|FLAC|MP3|MKV|MP4|AVI)\b/i);
  if (m) return validate(m[1]);

  // Pattern 7: episode number at end of base title before extension
  m = t.match(/\s(\d{1,4})(?:v\d+)?\s*(?:\.mkv|\.mp4|\.avi|\.m4v|\.webm|\.ts|$)/i);
  if (m) return validate(m[1]);

  // Pattern 8: "EP12" or "Episode 12"
  m = t.match(/\bEP(?:isode)?\s*(\d{1,4})\b/i);
  if (m) return validate(m[1]);

  // Pattern 9: "12 - " at start of filename base (after series name removed)
  // e.g. "Series 12 - 1080p.mkv"
  m = t.match(/\s(\d{1,4})(?:v\d+)?\s*[-–—]\s*\d{3,4}p/i);
  if (m) return validate(m[1]);

  return null;
}

// ================================================================
//  AUTO-DOWNLOAD POLLER
// ================================================================

let autoDownloadInterval = null;
let autoDownloadInitialTimeout = null;
let autoDownloadPollInFlight = false;

// After a handoff, the stored episode counter stays trusted only for a short
// window (unless the episode is actually present in the local folder). If the
// local library no longer reflects the handoff after that window (user deleted
// the files, cancelled in the client, etc.), the cursor falls back to the
// actual local library instead of silently skipping episodes forever.

async function verifyLatestAvailableEpisode(entry) {
  const title = String(entry.searchTitle || entry.seriesName || '').trim();
  if (!title) return 0;
  if (!entry.airingStartDate && d().getWatchDataSync) {
    const watchData = d().getWatchDataSync(entry.seriesName) || {};
    if (watchData.malData && watchData.malData.start_date) {
      entry.airingStartDate = watchData.malData.start_date;
    }
  }
  if (!entry.totalEps && d().getWatchDataSync) {
    const md = (d().getWatchDataSync(entry.seriesName) || {}).malData || {};
    if (Number(md.num_episodes) > 0) entry.totalEps = Number(md.num_episodes);
  }
  const quality = entry.preferredQuality || entry.quality || d().config.nyaaQuality || '1080p';
  const uploader = PREFERRED_GROUP;
  const compact = getCompactSearchQuery(title, uploader, null, d().config.forceHevc !== false);
  const queries = [compact, title + ' ' + quality, title].filter((q, i, all) => q && all.indexOf(q) === i);
  const seen = new Map();
  for (const query of queries) {
    const found = await nyaaSearchCached(query);
    for (const release of found || []) {
      if (!release || !release.title || /\b(batch|complete|season\s*pack)\b/i.test(release.title)) continue;
      const episode = parseNyaaEpisodeNumber(release.title);
      if (!episode || episode < 1) continue;
      if (!releaseMatchesTrackedSeason(release, entry, title) || !releaseMatchesQuality(release, quality)) continue;
      // An episode past this season's length belongs to another season.
      if (Number(entry.totalEps) > 0 && episode + (Number(entry.episodeOffset) || 0) > Number(entry.totalEps)) continue;
      const old = seen.get(episode);
      if (!old || (release.seeders || 0) > (old.seeders || 0)) seen.set(episode, release);
    }
  }
  let verified = seen.size ? Math.max(...seen.keys()) : 0;
  const total = Number(entry.totalEps) || 0;
  if (total) verified = Math.min(verified, total);
  const offset = Math.max(-12, Math.min(12, Number(entry.episodeOffset) || 0));
  if (verified) verified = Math.max(1, verified + offset);
  entry.verifiedLatest = verified;
  entry.verifiedAt = Date.now();
  return verified;
}

async function runAutoDownloadPoller(force = false) {
  if (autoDownloadPollInFlight) {
    return { downloaded: [], no_results: [], no_exact_match: [], dedup: [], error: [], skipped_local: [], polled: false, disabled: false, alreadyRunning: true };
  }
  autoDownloadPollInFlight = true;
  try {
  const cfg = d().config;
  const results = { downloaded: [], no_results: [], no_exact_match: [], dedup: [], error: [], skipped_local: [], polled: false, disabled: false };
  if (!cfg.autoDownloadEnabled && !force) { results.disabled = true; return results; }
  // Tracking is explicit-only. Polling never infers watchlist membership from
  // MAL or local folder names; it only processes entries the user selected.
  const watchlist = cfg.autoDownloadWatchlist || [];
  if (!watchlist.length) return results;
  results.polled = true;

  for (const entry of watchlist) {
    // Toasts below report only this series' results, not earlier series'.
    const downloadedFrom = results.downloaded.length;
    const dedupFrom = results.dedup.length;
    try {
      if (!entry.seriesName) continue;
      const uploader = PREFERRED_GROUP;
      const quality = entry.preferredQuality || cfg.nyaaQuality || '1080p';
      const nowMs = Date.now();
      const pollInterval = (cfg.autoDownloadPollMinutes || 30) * 60 * 1000;

      // Skip if not enough time since last check
      if (!force && entry.lastChecked && (nowMs - entry.lastChecked) < Math.max(pollInterval * 0.8, 5 * 60 * 1000)) {
        console.log('[AutoDL] Skip recent check:', entry.seriesName);
        continue;
      }

      // Rebuild the episode ledger from the exact local series on every poll.
      // Stored counters are hints only; legacy counters are never allowed to
      // manufacture a historical download window.
      let batchCount = 0;
      // Allow configurable catch-up limit (0 or unset = all pending episodes)
      const batchLimitSetting = Number(cfg.autoDownloadBatchLimit !== undefined ? cfg.autoDownloadBatchLimit : 0);
      const maxBatch = (batchLimitSetting > 0) ? batchLimitSetting : Infinity;
      const estimatedLatest = Number(entry.estimatedLatest || entry.latestAired) || 0;
      const verifiedLatest = await verifyLatestAvailableEpisode(entry);
      const localEps = d().getLocalEpisodes
        ? d().getLocalEpisodes(entry.seriesName, entry.malId || null, entry.seriesPath || '')
        : [];
      entry.currentIdentityKey = String(entry.malId || '') + '|' + String(entry.seriesPath || entry.seriesName || '');
      const ledger = reconcileTrackingCursor(entry, localEps, verifiedLatest);
      if (!entry.trackingIdentityKey) entry.trackingIdentityKey = entry.currentIdentityKey;
      let cursorEp = ledger.nextEpisode;
      entry.estimatedLatest = estimatedLatest;
      d().saveConfig();
      if (!verifiedLatest) {
        results.no_results.push({ series: entry.seriesName, episode: cursorEp, estimatedLatest, verifiedLatest: 0 });
        continue;
      }
      if (verifiedLatest < cursorEp) {
        results.skipped_local.push({ series: entry.seriesName, episode: verifiedLatest, localHighest: cursorEp - 1, verifiedLatest });
        continue;
      }
      const maxEp = verifiedLatest;

      while (batchCount < maxBatch && cursorEp <= maxEp) {
        console.log('[AutoDL] Target episode:', cursorEp, '| uploader:', uploader, '| quality:', quality);

        if (batchCount > 0) {
          await new Promise(r => setTimeout(r, 600));
        }

        // Skip if already in local library
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

        // Search broadly using a short release anchor, then validate candidates
        // separately. This survives official-title shortening and romanization
        // drift without weakening exact episode/uploader/quality checks.
        const searchName = entry.searchTitle || entry.seriesName;
        const seasonInfo = extractSeasonInfo(searchName);
        const baseName = seasonInfo.cleanName || searchName;
        const season = seasonInfo.season;
        const expandedQueries = buildEpisodeSearchQueries(
          searchName, quality, uploader, cursorEp, cfg.forceHevc !== false
        );
        console.log('[AutoDL] Queries:', expandedQueries);
        console.log('[AutoDL] Season info:', seasonInfo);

        let allResults = [];
        const seenIds = new Set();
        let queryIndex = 0;
        for (const q of expandedQueries) {
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
          // Do not let an unrelated uploader returned by a specific query stop
          // the fallback chain. Exhaust variants until the preferred uploader
          // has a valid exact-episode candidate.
          if (allResults.some(item =>
            parseNyaaEpisodeNumber(item.title) === cursorEp &&
            releaseMatchesUploader(item, uploader) &&
            releaseMatchesTrackedSeason(item, entry, searchName) &&
            releaseMatchesQuality(item, quality)
          )) break;
          queryIndex++;
        }

        if (!allResults.length) {
          console.log('[AutoDL] No results for', entry.seriesName, 'ep', cursorEp);
          results.no_results.push({ series: entry.seriesName, episode: cursorEp, queries: expandedQueries });
          break;
        }

        let matched = allResults.map(r => ({ ...r, ep: parseNyaaEpisodeNumber(r.title) }))
          .filter(r => {
            if (r.ep !== cursorEp) return false;
            return releaseMatchesTrackedSeason(r, entry, searchName) && releaseMatchesQuality(r, quality);
          });
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

        // Erai-raws first; otherwise the most-seeded release from any group.
        const chosen = rankReleases(matched)[0] || null;

        if (!chosen) {
          console.log('[AutoDL] Scoring produced no winner for', entry.seriesName);
          results.no_exact_match.push({ series: entry.seriesName, episode: cursorEp, reason: 'scoring produced no winner' });
          break;
        }
        console.log('[AutoDL] Chosen release:', chosen.title, '| seeds:', chosen.seeders, '| size:', chosen.size);

        // Download trigger. A failed hand-off (no torrent client) is an error:
        // no history entry, no cursor advance, nothing blocking a retry.
        const handoff = await handOffToClient(chosen);
        if (!handoff.ok) {
          console.warn('[AutoDL] Hand-off failed for', chosen.title, '-', handoff.error);
          results.error.push({ series: entry.seriesName, episode: cursorEp, error: handoff.error });
          break;
        }
        const method = handoff.method;

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
        entry.lastDownloadedAt = nowMs;
        entry.trackingIdentityKey = entry.currentIdentityKey;
        entry.lastChecked = nowMs;
        d().saveConfig();

        console.log('[AutoDL] SUCCESS:', entry.seriesName, 'ep', cursorEp, 'via', method);
        results.downloaded.push({ series: entry.seriesName, episode: cursorEp, title: chosen.title, seeders: chosen.seeders });

        cursorEp++;
        batchCount++;
      }

      if (cursorEp > maxEp && verifiedLatest > 0) {
        entry.lastChecked = nowMs;
        d().saveConfig();
      }
      // Per-download toast for this series
      const mineDownloaded = results.downloaded.slice(downloadedFrom);
      const mineDedup = results.dedup.slice(dedupFrom);
      if (mineDownloaded.length > 0) {
        const latest = mineDownloaded[mineDownloaded.length - 1];
        if (d().mainWindow && !d().mainWindow().isDestroyed()) {
          d().mainWindow().webContents.send('autoDownload:toast', {
            series: entry.seriesName,
            episode: latest.episode,
            title: latest.title
          });
        }
      }
      if (mineDedup.length > 0 && !mineDownloaded.length) {
        const lastDedup = mineDedup[mineDedup.length - 1];
        if (d().mainWindow && !d().mainWindow().isDestroyed()) {
          d().mainWindow().webContents.send('autoDownload:toast', {
            series: entry.seriesName,
            episode: lastDedup.episode,
            title: 'torrent handed off ' + lastDedup.minutesAgo + ' min ago'
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
  } finally {
    autoDownloadPollInFlight = false;
  }
}

function startAutoDownloadPoller(ms) {
  stopAutoDownloadPoller();
  if (!ms || ms < 60000) {
    const mins = Math.max(1, Number(d().config.autoDownloadPollMinutes) || 30);
    ms = mins * 60 * 1000;
  }
  console.log('[AutoDL] Starting poller: interval =', Math.round(ms / 60000), 'min');
  autoDownloadInitialTimeout = setTimeout(() => {
    autoDownloadInitialTimeout = null;
    runAutoDownloadPoller().catch(e => console.error('[AutoDL] Initial poll failed:', e.message));
  }, 15000);
  autoDownloadInterval = setInterval(() => runAutoDownloadPoller(), ms);
}

function stopAutoDownloadPoller() {
  if (autoDownloadInitialTimeout) {
    clearTimeout(autoDownloadInitialTimeout);
    autoDownloadInitialTimeout = null;
  }
  if (autoDownloadInterval) {
    clearInterval(autoDownloadInterval);
    autoDownloadInterval = null;
  }
}

async function syncAutoDownloadCriteria() {
  // Kept as a compatibility no-op for older configs and callers. Tracking is
  // explicit-only as of 4.10.5.
  console.log('[AutoDL] Automatic criteria sync ignored (explicit tracking policy)');
  return;
}


// Search variant generator for special-character handling
function getSearchVariants(query) {
  const original = String(query || '').normalize('NFKC').trim();
  const splitHonorifics = value => value.replace(/\b([a-z]{3,}?)(sama|san|chan|kun)\b/gi, '$1 $2');
  const variants = [original];
  // Nyaa tokenizes punctuation inconsistently. Treat title punctuation and
  // hyphenation as word separators while retaining uploader brackets first.
  variants.push(original.replace(/[\u2010-\u2015:!?;~._'"()/\\]+/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim());
  variants.push(original.replace(/[^a-zA-Z0-9\s-]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim());
  variants.push(original.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim());
  // Romanized metadata may concatenate Japanese honorifics while a release
  // title hyphenates them (Ojousama vs Ojou-sama). Search both tokenizations.
  variants.push(splitHonorifics(original).replace(/[\u2010-\u2015:!?;~._'"()/\\-]+/g, ' ').replace(/\s+/g, ' ').trim());
  return variants.filter((v, i, a) => v && a.indexOf(v) === i);
}

module.exports = {
  setDeps,
  normalizeMagnet,
  nyaaSearch,
  nyaaSearchHtml,
  nyaaSearchCached,
  handOffToClient,
  decodeEntities,
  downloadNyaaTorrentFile,
  parseReleaseSize,
  scoreRelease,
  normalizeUploaderKey,
  releaseMatchesUploader,
  preferUploaderMatches,
  rankReleases,
  describeRelease,
  isHevcRelease,
  isBatchRelease,
  PREFERRED_GROUP,
  releaseMatchesSeriesTitle,
  releaseMatchesQuality,
  normalizeTitleWords,
  meaningfulTitleWords,
  detectTitleSeason,
  getReleaseSeriesTitle,
  seriesTitleMatchConfidence,
  getSearchAnchor,
  getCompactSearchQuery,
  buildEpisodeSearchQueries,
  computeH264Ceiling,
  extractSeasonInfo,
  getReleasePublishedMs,
  getEntrySeasonStartMs,
  releaseMatchesTrackedSeason,
  releaseSeasonFit,
  normalizeEpisodeList,
  handoffAgeMs,
  isHandoffTrustworthy,
  reconcileTrackingCursor,
  parseNyaaEpisodeNumber,
  verifyLatestAvailableEpisode,
  runAutoDownloadPoller,
  startAutoDownloadPoller,
  stopAutoDownloadPoller,
  syncAutoDownloadCriteria,
  getSearchVariants,
};
