'use strict';

// main/scanner/parsers.js - media file listing and filename parsing
// (series names, episode/chapter numbers, release metadata).

const path = require('path');
const fs = require('fs');
const { config } = require('../state');

const VIDEO_EXTS = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts'];
const MANGA_EXTS = ['.cbz', '.cbr', '.zip', '.pdf', '.epub', '.mobi'];
// Files handed to a player, reader or the OS default handler must be media —
// never scripts or executables that happen to live in a library folder.
function assertPlayableMedia(filePath, exts) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (!(exts || VIDEO_EXTS.concat(MANGA_EXTS)).includes(ext)) throw new Error('Refusing to open ' + (ext || 'this file') + ' — not a video or manga file');
}

// Subfolders that hold bonus material, not episodes (creditless OP/ED, menus,
// trailers, samples). Skipped when a series folder is read recursively.
const EXTRAS_DIR_RE = /^(?:extras?|bonus(?:es)?|featurettes?|nc(?:op|ed)?s?|creditless|menus?|trailers?|samples?|previews?|scans|fonts|subs?|subtitles|attachments)$/i;

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
      } else if (recurse && item.isDirectory() && !item.name.startsWith('.') && !EXTRAS_DIR_RE.test(item.name)) {
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
      } else if (recurse && item.isDirectory() && !item.name.startsWith('.') && !EXTRAS_DIR_RE.test(item.name)) {
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
// Audio/subtitle tags only as whole tags ("Dual Audio", "Multi-Subs"), so title
// words like "Dual", "Sub" or "Multi" survive.
const RELEASE_META_STRIP = /\b(?:\d{3,4}p|BluRay|BDRip|WEB[-.]?DL|WEBRip|HDRip|DVDRip|XviD|x26[45]|HEVC|H\.265|H\.264|AVC|AAC|FLAC|DTS|AC3|DDP|TrueHD|Atmos|Dual[-\s]?Audio|Multi[-\s]?(?:Subs?|Audio)|MultiSubs?|MSubs|ESubs?|Dubbed|Subbed|SoftSub|HardSub|REPACK|PROPER|EXTENDED|UNCUT|UNRATED|Director'?s\s*Cut|Kitsune|SubsPlease|Erai-raws|Judas|VARYG|HorribleSubs|Commie|GJM|UTW|Coalgirls|\dx\d{3,4}|10-bit|8-bit|Hi10P|YUV420P10|CRF\s*\d+)\b/gi;
// A release group glued to the last metadata tag ("x265-Group",
// "H.264.MSubs-ToonsHub"). Only that shape is a group: a hyphen inside a title
// ("Maou-sama", "Iruma-kun", "Spider-Man") is part of the name.
const RELEASE_GROUP_TAIL = /((?:\d{3,4}p|BluRay|BDRip|WEB[-.]?DL|WEBRip|HDRip|DVDRip|XviD|x26[45]|HEVC|H\.?26[45]|AVC|AAC[\d.]*|FLAC[\d.]*|DTS|AC3|E?AC-?3|DDP[\d.]*|TrueHD|Atmos|Opus|MSubs|ESubs?|MultiSubs?|REPACK|PROPER|10-?bit|Hi10P|AV1|JPN|ENG))[-_]\s*[A-Za-z0-9][A-Za-z0-9]*\s*$/i;
function stripReleaseMetadata(name) {
  // Remove bracket/parenthesis groups
  let cleaned = name.replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ');
  // Remove a trailing release group, then the metadata tokens themselves
  cleaned = cleaned.replace(RELEASE_GROUP_TAIL, '$1 ');
  cleaned = cleaned.replace(RELEASE_META_STRIP, ' ');
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
  let m = stripped.match(/(?:^|[\s._-])S(\d{1,2})E(\d{1,4})(?:[\s._-]|$)/i) ||
          base.match(/(?:^|[\s._-])S(\d{1,2})E(\d{1,4})(?:[\s._-]|$)/i);
  if (m) {
    const s = parseInt(m[1]), e = parseInt(m[2]);
    const seriesInfo = extractSeriesName(base.split(/S\d{1,2}E\d{1,4}/i)[0]);
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
  m = stripped.match(/^(.*?)(?:\s+(?:(\d)(?:nd|rd|th|st)\s*Season|Season\s*(\d+)|S(\d+)))?\s+-\s+(\d{1,4}(?:\.\d(?!\d))?)(?:\s|$|v\d)/);
  if (m) {
    const s = parseInt(m[2] || m[3] || m[4] || '1');
    const e = parseFloat(m[5]);
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
  m = stripped.match(/^(.*?)\s+-\s+(\d{1,4}(?:\.\d(?!\d))?)\s*$/);
  if (m) {
    const e = parseFloat(m[2]);
    const seriesInfo = extractSeriesName(m[1]);
    if (seriesInfo.title) {
      return {
        newName: `${seriesInfo.title} - ${String(e).padStart(2, '0')} (${res}) (${codec})${ext}`,
        series: seriesInfo.title,
        matched: true
      };
    }
  }

  // Pattern 3: "Series Name 26" (space-separated number at end; 4-digit
  // numbers for long runners like "One Piece 1100", never a year)
  m = stripped.match(/^(.*?)[\s_.-]+(\d{1,4})(?:\s|$)/);
  if (m && !(m[2].length === 4 && +m[2] >= 1900 && +m[2] <= 2099)) {
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
  let m = stripped.match(/(?:^|[\s._-])S(\d{1,2})E(\d{1,4})(?:[\s._-]|$)/i) ||
          base.match(/(?:^|[\s._-])S(\d{1,2})E(\d{1,4})(?:[\s._-]|$)/i);
  if (m) {
    const s = parseInt(m[1]), e = parseInt(m[2]);
    const seriesInfo = extractSeriesName(base.split(/S\d{1,2}E\d{1,4}/i)[0]);
    if (seriesInfo.title) {
      const sf = s > 1 ? ` S${s}` : '';
      return { newName: mangaChapterFileName(filename, seriesInfo.title + sf, e) || `${seriesInfo.title}${sf} - Ch ${String(e).padStart(2, '0')}${ext}`, series: seriesInfo.title + (s > 1 ? ' S' + s : ''), matched: true };
    }
  }
  m = stripped.match(/^(.*?)(?:\s+(?:(\d)(?:nd|rd|th|st)\s*Season|Season\s*(\d+)|S(\d+)))?\s+-\s+(\d{1,4}(?:\.\d(?!\d))?)(?:\s|$|v\d)/);
  if (m) {
    const s = parseInt(m[2] || m[3] || m[4] || '1'), e = parseFloat(m[5]);
    const seriesInfo = extractSeriesName(m[1]);
    if (seriesInfo.title) {
      const sf = s > 1 ? ` S${s}` : '';
      return { newName: mangaChapterFileName(filename, seriesInfo.title + sf, e) || `${seriesInfo.title}${sf} - Ch ${String(e).padStart(2, '0')}${ext}`, series: seriesInfo.title + (s > 1 ? ' S' + s : ''), matched: true };
    }
  }
  m = stripped.match(/^(.*?)\s+-\s+(\d{1,4}(?:\.\d(?!\d))?)\s*$/);
  if (m) {
    const e = parseFloat(m[2]);
    const seriesInfo = extractSeriesName(m[1]);
    if (seriesInfo.title) {
      return { newName: mangaChapterFileName(filename, seriesInfo.title, e) || `${seriesInfo.title} - Ch ${String(e).padStart(2, '0')}${ext}`, series: seriesInfo.title, matched: true };
    }
  }
  m = stripped.match(/^(.*?)[\s_.-]+(\d{1,4})(?:\s|$)/);
  if (m && !(m[2].length === 4 && +m[2] >= 1900 && +m[2] <= 2099)) {
    const e = parseInt(m[2]);
    const seriesInfo = extractSeriesName(m[1]);
    if (seriesInfo.title && seriesInfo.title.length > 1) {
      return { newName: mangaChapterFileName(filename, seriesInfo.title, e) || `${seriesInfo.title} - Ch ${String(e).padStart(2, '0')}${ext}`, series: seriesInfo.title, matched: true };
    }
  }
  if (folderName) {
    const ep = parseChapterNumber(filename);
    if (ep !== null && ep > 0) {
      const seriesInfo = extractSeriesName(folderName);
      const seriesClean = seriesInfo.title || cleanFolderName(folderName);
      return { newName: mangaChapterFileName(filename, seriesClean, ep) || `${seriesClean} - Ch ${String(ep).padStart(2, '0')}${ext}`, series: seriesClean, matched: true };
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
  const resDash = cleaned.match(/(?:^|[\s._-])(\d{1,4})(?:v\d)?\s*[-–—]\s*\d{3,4}[pk]\b/i);
  if (resDash) return parseInt(resDash[1]);
  // Strip common release-metadata tokens to avoid false positives
  cleaned = cleaned.replace(RELEASE_META_STRIP, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Episodes run to 4 digits (One Piece 1100) and recaps are "12.5".
  // Pattern 1: S01E05
  let m = cleaned.match(/S\d{1,2}E(\d{1,4})/i);
  if (m) return parseInt(m[1]);
  // Pattern 2: Episode 05, EP 05
  m = cleaned.match(/Episode\s+(\d{1,4}(?:\.\d(?!\d))?)/i);
  if (m) return parseFloat(m[1]);
  m = cleaned.match(/\bEP?\s*(\d{1,4}(?:\.\d(?!\d))?)\b/i);
  if (m) return parseFloat(m[1]);
  // Pattern 3: " - 05" (dash-separated episode, optional space)
  // This specifically catches the "Series Name - 26 (1080p)" pattern
  m = cleaned.match(/-\s*(\d{1,4}(?:\.\d(?!\d))?)(?:v\d)?(?:\s*(?:\[|\(|\.|$))/);
  if (m) return parseFloat(m[1]);
  // Pattern 3b: " - NN" at end of string (e.g. "Monster - 26")
  m = cleaned.match(/-\s+(\d{1,4}(?:\.\d(?!\d))?)\s*$/);
  if (m) return parseFloat(m[1]);
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
  // An explicit chapter marker wins over volume numbers ("Vol 03 Ch 25").
  let m = base.match(/\b(?:Ch(?:apter)?|Chap)[.\s_-]*(\d{1,4}(?:\.\d(?!\d))?)/i) ||
    base.match(/(?:^|[\s_-])c(\d{1,4}(?:\.\d(?!\d))?)\b/i) ||
    base.match(/#(\d{1,4}(?:\.\d(?!\d))?)/);
  if (m) return parseFloat(m[1]);
  // Otherwise ignore volume numbers, years and bracketed tags.
  const rest = base.replace(/[\[(][^\])]*[\])]/g, ' ').replace(/\b(?:Vol(?:ume)?|v)[.\s_-]*\d{1,4}\b/gi, ' ');
  m = rest.match(/-\s*(\d{1,4}(?:\.\d(?!\d))?)(?=\s|$|\.)/) || rest.match(/(?:^|\s)(\d{1,4}(?:\.\d(?!\d))?)(?=\s|$)/);
  if (m) return parseFloat(m[1]);
  return null;
}

function parseMediaNumber(filename) {
  return config.vaultMode === 'manga' ? parseChapterNumber(filename) : parseEpisodeNumber(filename);
}

// ---- Display titles ------------------------------------------------------------
// What is left of a file name once the extension, release tags, the series name,
// volume markers and the number itself are gone. A real title survives
// ("008 - The Type of Girl.cbz" -> "The Type of Girl"); "Chapter 12.cbz",
// "010.cbz" and "Series - 27.cbz" have none and give "".
const TECH_TOKEN = /^(?:(?:AAC|DDP|E?AC-?3|FLAC|Opus)[\d.]*|DTS|H\.?26[45]|x26[45]|AV1|HEVC|AVC|JPN|ENG|RAW|WEB|DL|CR|AMZN|NF|DSNP|HMAX|ATVP|HIDIVE|ADN|BILI|\d+\.\d+(?:\.\d+)*)$/i;
const GENERIC_TITLE = /^(?:ch(?:apter|ap)?|episode|ep|vol(?:ume)?|part|raw|digital|scan(?:s|lation)?|end|v\d)$/i;

function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// "Kaiju No. 8 (2020)" also matches "Kaiju No 8" and "Kaiju.No.8": words in
// order, any punctuation between them.
function seriesPrefixRegex(name) {
  const words = String(name || '').replace(/\(\d{4}\)/g, ' ').match(/[\p{L}\p{N}]+/gu) || [];
  if (!words.length) return null;
  return new RegExp('^[\\W_]*' + words.map(escapeRegExp).join('[\\W_]+') + '(?=[\\W_]|$)', 'iu');
}

function mediaDisplayTitle(fileName, seriesName, num) {
  let t = path.parse(String(fileName || '')).name;
  t = t.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ');
  // One-word or technical parentheses are tags ("(Digital)", "(2023)", "(1r0n)");
  // "(Part 2)" is part of a title.
  t = t.replace(/\(([^()]*)\)/g, (m, inner) => (/^\s*\S+\s*$/.test(inner) || /\b(?:digital|scans?|c2c|\d{3,4}p)\b/i.test(inner)) ? ' ' : m);
  // Scene names ("Show.S01E05.Title.1080p") use dots for spaces; decimals
  // such as "10.1" keep theirs.
  const scene = !/\s/.test(t.trim());
  t = t.replace(RELEASE_GROUP_TAIL, '$1 ').replace(RELEASE_META_STRIP, ' ');
  if (scene) t = t.replace(/(?<=\D)\.|\.(?=\D)/g, ' ');
  t = t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  const variants = [seriesName];
  const base = String(seriesName || '').replace(/\s+(?:S\d{1,2}|Season\s*\d{1,2}|\d(?:st|nd|rd|th)\s+Season)\s*$/i, '');
  if (base !== seriesName) variants.push(base);
  for (const v of variants) {
    const re = seriesPrefixRegex(v);
    if (re && re.test(t)) { t = t.replace(re, ''); break; }
  }
  const SEP = /^[\s\-–—:,.#~|]+/;
  t = t.replace(SEP, '');
  t = t.replace(/^(?:vol(?:ume)?\.?\s*|v)\d{1,4}\b/i, '').replace(SEP, '');
  t = t.replace(/^(?:S\d{1,2}|Season\s*\d{1,2})\b/i, '').replace(SEP, '');
  // The number itself, with or without a marker: "Ch. 012", "c012", "#12",
  // "E05", "Episode 5", "012v2", plain "012".
  const lead = t.match(/^(?:S\d{1,2})?(?:ch(?:apter|ap)?|episode|ep|e|c|#)?\.?\s*(\d{1,4}(?:\.\d{1,2})?)(?:v\d)?(?![\d.])/i);
  let numberFound = false;
  if (lead && (num == null || isNaN(num) || parseFloat(lead[1]) === Number(num) || /^\D/.test(lead[0]))) {
    t = t.slice(lead[0].length).replace(SEP, '');
    numberFound = true;
  }
  // "Other Title - Chapter 27": the number comes last, so the text before it
  // is another spelling of the series, not a chapter title.
  if (!numberFound) {
    const tail = t.match(/[\s\-–—]*(?:ch(?:apter|ap)?|episode|ep|e|c|#)?\.?\s*(\d{1,4}(?:\.\d{1,2})?)(?:v\d)?\s*$/i);
    if (tail && (num == null || isNaN(num) || parseFloat(tail[1]) === Number(num))) t = '';
  }
  t = t.split(/\s+/).filter(w => w && !TECH_TOKEN.test(w)).join(' ');
  t = t.replace(SEP, '').replace(/[\s\-–—:,~|]+$/, '').trim();
  if (!/\p{L}/u.test(t) || GENERIC_TITLE.test(t)) return '';
  return t;
}

// Library file name for a manga chapter: "Series - Ch 012 - Title.cbz", with
// "Vol 03 - " before the chapter when the original carries a volume. Returns
// null when the chapter number can't be read.
function formatChapterNumber(num) {
  const [i, f] = String(num).split('.');
  return i.padStart(3, '0') + (f ? '.' + f : '');
}
// A file is only renamed when its chapter number can't be misread: an
// explicit "Ch"/"c"/"#" marker, or a single number once the series name,
// tags and volume are gone ("012 - 100 Ways to Die" is left alone).
function chapterNumberIsClear(fileName, seriesName) {
  let base = path.parse(String(fileName || '')).name.replace(/[\[(][^\])]*[\])]/g, ' ');
  if (/\b(?:Ch(?:apter)?|Chap)[.\s_-]*\d|(?:^|[\s_.-])c\d|#\d/i.test(base)) return true;
  const re = seriesPrefixRegex(seriesName);
  if (re) base = base.replace(re, ' ');
  base = base.replace(/\b(?:Vol(?:ume)?|v)[.\s_-]*\d{1,4}\b/gi, ' ');
  return (base.match(/(?<![\d.])\d{1,4}(?:\.\d{1,2})?(?![\d.])/g) || []).length === 1;
}
function mangaChapterFileName(fileName, seriesName, num) {
  const ext = path.extname(String(fileName || ''));
  if (num == null) num = parseChapterNumber(fileName);
  if (num == null || isNaN(num) || num < 0) return null;
  if (!chapterNumberIsClear(fileName, seriesName)) return null;
  const series = String(seriesName || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  if (!series) return null;
  const base = path.parse(String(fileName)).name;
  const vol = base.match(/\bVol(?:ume)?[.\s_-]*(\d{1,3})\b/i) || base.match(/(?:^|[\s_-])v(\d{1,3})(?=[\s_-]*c\d)/i);
  const title = mediaDisplayTitle(fileName, seriesName, num).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  return series + ' - ' + (vol ? 'Vol ' + String(parseInt(vol[1], 10)).padStart(2, '0') + ' - ' : '') +
    'Ch ' + formatChapterNumber(num) + (title ? ' - ' + title : '') + ext;
}

module.exports = {
  MANGA_EXTS,
  VIDEO_EXTS,
  assertPlayableMedia,
  cleanFolderName,
  detectResolution,
  escapeRegExp,
  extractSeriesName,
  getMangaFiles,
  getVideoFiles,
  parseChapterNumber,
  parseEpisodeNumber,
  chapterNumberIsClear,
  formatChapterNumber,
  mangaChapterFileName,
  mediaDisplayTitle,
  parseMangaFilename,
  parseMediaNumber,
  parseVideoFilename,
};
