'use strict';

// main/scanner/parsers.js - media file listing and filename parsing
// (series names, episode/chapter numbers, release metadata).

const path = require('path');
const fs = require('fs');
const { config } = require('../state');

const VIDEO_EXTS = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts'];
const MANGA_EXTS = ['.cbz', '.cbr', '.zip', '.pdf', '.epub'];
// Files handed to a player, reader or the OS default handler must be media —
// never scripts or executables that happen to live in a library folder.
function assertPlayableMedia(filePath, exts) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (!(exts || VIDEO_EXTS.concat(MANGA_EXTS)).includes(ext)) throw new Error('Refusing to open ' + (ext || 'this file') + ' — not a video or manga file');
}

function getVideoFiles(folder, recurse = false) {
  if (!fs.existsSync(folder)) return [];
  const results = [];
  try {
    const items = fs.readdirSync(folder, { withFileTypes: true });
    for (const item of items) {
      const fp = path.join(folder, item.name);
      if (item.isFile() && VIDEO_EXTS.includes(path.extname(item.name).toLowerCase())) {
        try {
          if (!fs.existsSync(fp)) continue; // Batch A.5: ghost-file guard
          results.push({ name: item.name, path: fp, size: fs.statSync(fp).size });
        } catch(e){}
      } else if (recurse && item.isDirectory() && !item.name.startsWith('.')) {
        results.push(...getVideoFiles(fp, true));
      }
    }
  } catch(e){}
  return results;
}

function getMangaFiles(folder, recurse = false) {
  if (!fs.existsSync(folder)) return [];
  const results = [];
  try {
    const items = fs.readdirSync(folder, { withFileTypes: true });
    for (const item of items) {
      const fp = path.join(folder, item.name);
      if (item.isFile() && MANGA_EXTS.includes(path.extname(item.name).toLowerCase())) {
        try {
          if (!fs.existsSync(fp)) continue; // Batch A.5: ghost-file guard
          results.push({ name: item.name, path: fp, size: fs.statSync(fp).size });
        } catch(e){}
      } else if (recurse && item.isDirectory() && !item.name.startsWith('.')) {
        results.push(...getMangaFiles(fp, true));
      }
    }
  } catch(e){}
  return results;
}

function cleanTitle(t) {
  return t
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[_.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanFolderName(name) {
  return cleanTitle(name);
}

function detectResolution(filename) {
  if (/2160p|4K|UHD/.test(filename)) return '2160p';
  if (/1080p/.test(filename)) return '1080p';
  if (/720p/.test(filename)) return '720p';
  if (/480p/.test(filename)) return '480p';
  return '1080p';
}

// Common release-metadata tokens that should be stripped before parsing
const RELEASE_META_STRIP = /\b(?:\d{3,4}p|BluRay|BDRip|WEB[-.]?DL|WEBRip|HDRip|DVDRip|XviD|x26[45]|HEVC|H\.265|H\.264|AVC|AAC|FLAC|DTS|AC3|DDP|TrueHD|Atmos|Dual|DUB|SUB|Multi|SoftSub|HardSub|REPACK|PROPER|EXTENDED|UNCUT|UNRATED|Director'?s\s*Cut|Kitsune|SubsPlease|Erai-raws|Judas|VARYG|HorribleSubs|Commie|GJM|UTW|Coalgirls|\dx\d{3,4}|10-bit|8-bit|Hi10P|YUV420P10|CRF\s*\d+)\b/gi;
function stripReleaseMetadata(name) {
  // Remove bracket/parenthesis groups
  let cleaned = name.replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ');
  // Remove common release metadata tokens
  cleaned = cleaned.replace(RELEASE_META_STRIP, ' ');
  // Remove release group at end (e.g. "-Kitsune", "_Kitsune")
  cleaned = cleaned.replace(/[-_]\s*[A-Za-z][A-Za-z0-9]{1,}\s*$/g, ' ');
  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

function extractSeriesName(name, defaultSeason) {
  // Scene-style names use dots/underscores instead of spaces
  // ("Even.the.Student.Council.Has.Its.Holes."): turn them into words first.
  if (!/\s/.test(String(name || '').trim())) name = String(name || '').replace(/[._]+/g, ' ');
  // Strip all release metadata
  let cleaned = stripReleaseMetadata(name);
  // Strip season info
  cleaned = cleaned.replace(/\b(?:Season\s*\d{1,2}|S\d{1,2})\b/gi, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  // Try to extract "Title (Year)" pattern
  let m = cleaned.match(/^(.+?)\s*[\(\[]\s*(\d{4})\s*[\)\]]/);
  if (m) {
    const title = cleanTitle(m[1]);
    const year = m[2];
    if (title.length > 1) return { title: `${title} (${year})`, year: parseInt(year) };
  }
  // Try to extract "Title 2004" pattern (year at end or middle)
  m = cleaned.match(/^(.+?)\s+(\d{4})(?:\s|$)/);
  if (m) {
    const year = parseInt(m[2]);
    if (year >= 1920 && year <= 2099) {
      const title = cleanTitle(m[1]);
      if (title.length > 1) return { title: `${title} (${year})`, year };
    }
  }
  // Simple title extraction
  const title = cleanTitle(cleaned);
  if (title.length > 1) return { title, year: null };
  return { title: null, year: null };
}

function parseVideoFilename(filename, folderName) {
  const ext = path.extname(filename), base = path.parse(filename).name;
  const codec = /\b(?:HEVC|x265|H\.265)\b/.test(filename) ? 'HEVC' : 'H.264';
  const res = detectResolution(filename);

  // Create a metadata-stripped version for parsing
  const stripped = stripReleaseMetadata(base);

  // Pattern 1: S01E05 (in stripped or original)
  let m = stripped.match(/(?:^|[\s._-])S(\d{1,2})E(\d{1,3})(?:[\s._-]|$)/i) ||
          base.match(/(?:^|[\s._-])S(\d{1,2})E(\d{1,3})(?:[\s._-]|$)/i);
  if (m) {
    const s = parseInt(m[1]), e = parseInt(m[2]);
    const seriesInfo = extractSeriesName(base.split(/S\d{1,2}E\d{1,3}/i)[0]);
    if (seriesInfo.title) {
      const sf = s > 1 ? ` S${s}` : '';
      return {
        newName: `${seriesInfo.title}${sf} - ${String(e).padStart(2, '0')} (${res}) (${codec})${ext}`,
        series: seriesInfo.title + (s > 1 ? ' S' + s : ''),
        matched: true
      };
    }
  }

  // Pattern 2: "Series Name - 26" or "Series Name - 26 (1080p)"
  m = stripped.match(/^(.*?)(?:\s+(?:(\d)(?:nd|rd|th|st)\s*Season|Season\s*(\d+)|S(\d+)))?\s+-\s+(\d{1,3})(?:\s|$|v\d)/);
  if (m) {
    const s = parseInt(m[2] || m[3] || m[4] || '1');
    const e = parseInt(m[5]);
    const seriesInfo = extractSeriesName(m[1]);
    if (seriesInfo.title) {
      const sf = s > 1 ? ` S${s}` : '';
      return {
        newName: `${seriesInfo.title}${sf} - ${String(e).padStart(2, '0')} (${res}) (${codec})${ext}`,
        series: seriesInfo.title + (s > 1 ? ' S' + s : ''),
        matched: true
      };
    }
  }

  // Pattern 2b: "Series Name - NN" at end of stripped string
  m = stripped.match(/^(.*?)\s+-\s+(\d{1,3})\s*$/);
  if (m) {
    const e = parseInt(m[2]);
    const seriesInfo = extractSeriesName(m[1]);
    if (seriesInfo.title) {
      return {
        newName: `${seriesInfo.title} - ${String(e).padStart(2, '0')} (${res}) (${codec})${ext}`,
        series: seriesInfo.title,
        matched: true
      };
    }
  }

  // Pattern 3: "Series Name 26" (space-separated number at end)
  m = stripped.match(/^(.*?)[\s_.-]+(\d{1,3})(?:\s|$)/);
  if (m) {
    const e = parseInt(m[2]);
    const seriesInfo = extractSeriesName(m[1]);
    if (seriesInfo.title && seriesInfo.title.length > 1) {
      return {
        newName: `${seriesInfo.title} - ${String(e).padStart(2, '0')} (${res}) (${codec})${ext}`,
        series: seriesInfo.title,
        matched: true
      };
    }
  }

  // NEW: folder-name fallback for bare numbered files (e.g. EP1.mkv inside "Demon Slayer" folder)
  if (folderName) {
    const ep = parseEpisodeNumber(filename);
    if (ep !== null && ep > 0) {
      const seriesInfo = extractSeriesName(folderName);
      const seriesClean = seriesInfo.title || cleanFolderName(folderName);
      return {
        newName: `${seriesClean} - ${String(ep).padStart(2, '0')} (${res}) (${codec})${ext}`,
        series: seriesClean,
        matched: true
      };
    }
  }

  return { newName: cleanTitle(base) + ext, series: null, matched: false };
}

function parseMangaFilename(filename, folderName) {
  const ext = path.extname(filename), base = path.parse(filename).name;
  const stripped = stripReleaseMetadata(base);
  let m = stripped.match(/(?:^|[\s._-])S(\d{1,2})E(\d{1,3})(?:[\s._-]|$)/i) ||
          base.match(/(?:^|[\s._-])S(\d{1,2})E(\d{1,3})(?:[\s._-]|$)/i);
  if (m) {
    const s = parseInt(m[1]), e = parseInt(m[2]);
    const seriesInfo = extractSeriesName(base.split(/S\d{1,2}E\d{1,3}/i)[0]);
    if (seriesInfo.title) {
      const sf = s > 1 ? ` S${s}` : '';
      return { newName: `${seriesInfo.title}${sf} - Ch ${String(e).padStart(2, '0')}${ext}`, series: seriesInfo.title + (s > 1 ? ' S' + s : ''), matched: true };
    }
  }
  m = stripped.match(/^(.*?)(?:\s+(?:(\d)(?:nd|rd|th|st)\s*Season|Season\s*(\d+)|S(\d+)))?\s+-\s+(\d{1,3})(?:\s|$|v\d)/);
  if (m) {
    const s = parseInt(m[2] || m[3] || m[4] || '1'), e = parseInt(m[5]);
    const seriesInfo = extractSeriesName(m[1]);
    if (seriesInfo.title) {
      const sf = s > 1 ? ` S${s}` : '';
      return { newName: `${seriesInfo.title}${sf} - Ch ${String(e).padStart(2, '0')}${ext}`, series: seriesInfo.title + (s > 1 ? ' S' + s : ''), matched: true };
    }
  }
  m = stripped.match(/^(.*?)\s+-\s+(\d{1,3})\s*$/);
  if (m) {
    const e = parseInt(m[2]);
    const seriesInfo = extractSeriesName(m[1]);
    if (seriesInfo.title) {
      return { newName: `${seriesInfo.title} - Ch ${String(e).padStart(2, '0')}${ext}`, series: seriesInfo.title, matched: true };
    }
  }
  m = stripped.match(/^(.*?)[\s_.-]+(\d{1,3})(?:\s|$)/);
  if (m) {
    const e = parseInt(m[2]);
    const seriesInfo = extractSeriesName(m[1]);
    if (seriesInfo.title && seriesInfo.title.length > 1) {
      return { newName: `${seriesInfo.title} - Ch ${String(e).padStart(2, '0')}${ext}`, series: seriesInfo.title, matched: true };
    }
  }
  if (folderName) {
    const ep = parseChapterNumber(filename);
    if (ep !== null && ep > 0) {
      const seriesInfo = extractSeriesName(folderName);
      const seriesClean = seriesInfo.title || cleanFolderName(folderName);
      return { newName: `${seriesClean} - Ch ${String(ep).padStart(2, '0')}${ext}`, series: seriesClean, matched: true };
    }
  }
  return { newName: cleanTitle(base) + ext, series: null, matched: false };
}

function parseEpisodeNumber(filename) {
  const base = path.parse(filename).name;
  // Strip bracket/parenthesis contents first (release metadata)
  let cleaned = base.replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ');
  // Strip season references first so "Season 2 - 1080p" cannot be mistaken
  // for an episode-dash-resolution pattern.
  cleaned = cleaned.replace(/\b(?:Season\s*\d{1,2}|S\d{1,2})\b/gi, ' ');
  // "Series 05 - 1080p": resolve the episode from the dash-resolution shape
  // BEFORE release-metadata stripping deletes the resolution anchor.
  const resDash = cleaned.match(/(?:^|[\s._-])(\d{1,3})(?:v\d)?\s*[-–—]\s*\d{3,4}[pk]\b/i);
  if (resDash) return parseInt(resDash[1]);
  // Strip common release-metadata tokens to avoid false positives
  cleaned = cleaned.replace(RELEASE_META_STRIP, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Pattern 1: S01E05
  let m = cleaned.match(/S\d{1,2}E(\d{1,3})/i);
  if (m) return parseInt(m[1]);
  // Pattern 2: Episode 05, EP 05
  m = cleaned.match(/Episode\s+(\d{1,3})/i);
  if (m) return parseInt(m[1]);
  m = cleaned.match(/\bEP?\s*(\d{1,3})\b/i);
  if (m) return parseInt(m[1]);
  // Pattern 3: " - 05" (dash-separated episode, optional space)
  // This specifically catches the "Series Name - 26 (1080p)" pattern
  m = cleaned.match(/-\s*(\d{1,3})(?:v\d)?(?:\s*(?:\[|\(|\.|$))/);
  if (m) return parseInt(m[1]);
  // Pattern 3b: " - NN" at end of string (e.g. "Monster - 26")
  m = cleaned.match(/-\s+(\d{1,3})\s*$/);
  if (m) return parseInt(m[1]);
  // Pattern 4: rightmost standalone number not preceded by year and not followed by dash
  // Filter out 4-digit years (19xx, 20xx)
  const candidates = [];
  const p4regex = /\s+(\d{1,4})(?:v\d)?(?=\s|$|\[|\(|\.)/g;
  let p4m;
  while ((p4m = p4regex.exec(cleaned)) !== null) {
    const num = parseInt(p4m[1]);
    // Skip 4-digit years
    if (num >= 1900 && num <= 2099) continue;
    // Skip if it's part of a "xNNN" pattern (e.g. "2 0" from "FLAC 2 0")
    const before = cleaned.slice(Math.max(0, p4m.index - 3), p4m.index);
    if (/\b\d\s+x?\s*$/i.test(before) && num >= 100 && num <= 9999) continue;
    const rest = cleaned.slice(p4regex.lastIndex);
    if (!/^\s*[-\u2013\u2014]/.test(rest)) candidates.push(num);
  }
  if (candidates.length) return candidates[candidates.length - 1];
  // Fallback: number at end (last resort)
  m = cleaned.match(/\b(\d{1,3})\s*$/);
  if (m) {
    const num = parseInt(m[1]);
    // Sanity: don't return year-like numbers
    if (num < 1900 || num > 2099) return num;
  }
  return null;
}

function parseChapterNumber(filename) {
  const base = path.parse(filename).name;
  let m = base.match(/(?:Ch(?:apter)?[.\s]*(\d{1,4})|Ch\s*(\d{1,4})|C\s*(\d{1,4})|#(\d{1,4})|-\s*(\d{1,4})(?:v\d)?\s*[\[\(\.\s]|\s+(\d{1,4})(?:v\d)?\s*[\[\(\.\s])/i);
  if (m) return parseInt(m[1] || m[2] || m[3] || m[4] || m[5] || m[6]);
  m = base.match(/\b(\d{1,4})\s*$/);
  if (m) return parseInt(m[1]);
  return null;
}

function parseMediaNumber(filename) {
  return config.vaultMode === 'manga' ? parseChapterNumber(filename) : parseEpisodeNumber(filename);
}

module.exports = {
  MANGA_EXTS,
  VIDEO_EXTS,
  assertPlayableMedia,
  cleanFolderName,
  detectResolution,
  extractSeriesName,
  getMangaFiles,
  getVideoFiles,
  parseChapterNumber,
  parseEpisodeNumber,
  parseMangaFilename,
  parseMediaNumber,
  parseVideoFilename,
};
