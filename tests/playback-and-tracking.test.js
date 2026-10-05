'use strict';

// playback-and-tracking.test.js
//
// Runs the real player-option and untrack-on-delete code from main/ in a vm
// sandbox. Locks in:
//   - subtitle preference -> one language list per player (a second flag used
//     to replace the first), "Off" disables subtitles
//   - Bluetooth audio delay in ms (default 300) with the right units per player
//     (MPV takes seconds - "-300" meant five minutes)
//   - deleting a series untracks it by name, MAL id or path
//   - the renderer can't write back the main-owned watchlist

const assert = require('assert');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('./source-extract');
const mainSrc = require('./main-source').readMainSource();
let checks = 0;
const fn = (name) => { const c = extractFunction(mainSrc, name); assert(c, 'could not extract ' + name); return c; };
const constBlock = (name) => { const m = mainSrc.match(new RegExp('^const ' + name + ' = [\\s\\S]*?;$', 'm')); assert(m, 'could not extract const ' + name); return m[0]; };

// ---- player options ---------------------------------------------------------
const pctx = vm.createContext({});
vm.runInContext([constBlock('SUB_LANG_CODES'), fn('subtitleLangList'), fn('audioAdvanceMs'), fn('playerPrefArgs')].join('\n'), pctx);
const args = (player, cfg) => JSON.parse(JSON.stringify(pctx.playerPrefArgs(player, cfg)));
assert.deepStrictEqual(args('mpv', { subLangPrimary: 'en', subLangFallback: 'es' }), ['--slang=en,eng,es,spa'], 'one --slang with primary then fallback'); checks++;
assert.deepStrictEqual(args('vlc', { subLangPrimary: 'en', subLangFallback: 'es' }), ['--sub-language=en,eng,es,spa']); checks++;
assert.deepStrictEqual(args('mpv', { subLangPrimary: 'none', subLangFallback: 'es' }), ['--sid=no'], 'Off disables subtitles'); checks++;
assert.deepStrictEqual(args('vlc', { subLangPrimary: 'none' }), ['--no-spu']); checks++;
assert.deepStrictEqual(args('mpv', {}), [], 'player default adds nothing'); checks++;
assert.deepStrictEqual(args('mpv', { audioDelay: true }), ['--audio-delay=-0.3'], 'MPV takes seconds; default 300 ms'); checks++;
assert.deepStrictEqual(args('vlc', { audioDelay: true }), ['--audio-desync=-300'], 'VLC takes milliseconds'); checks++;
assert.deepStrictEqual(args('mpv', { audioDelay: true, audioDelayMs: 450 }), ['--audio-delay=-0.45']); checks++;
assert.deepStrictEqual(args('vlc', { audioDelay: false, audioDelayMs: 450 }), [], 'switch off = no delay'); checks++;
assert.deepStrictEqual(args('vlc', { audioDelay: true, audioDelayMs: 99999 }), ['--audio-desync=-5000'], 'capped at 5 s'); checks++;

// ---- untrack on delete ------------------------------------------------------
const config = { vaultMode: 'anime', watchHistory: {}, autoDownloadWatchlist: [] };
let saved = 0;
const uctx = vm.createContext({ path, config, saveConfig: () => { saved++; } });
vm.runInContext([fn('getWatchHistoryStore'), fn('safeHistoryKey'), fn('untrackDeletedSeries')].join('\n'), uctx);
const lib = path.resolve('/lib/Seasonal');
config.watchHistory['Koori no Jouheki S2'] = { malId: 61001, malData: { title: 'Koori no Jouheki 2nd Season' } };
config.autoDownloadWatchlist = [
  { seriesName: 'Koori no Jouheki 2nd Season', malId: 61001 },          // stored under the MAL title
  { seriesName: 'Dandadan', seriesPath: path.join(lib, 'Dandadan') },
  { seriesName: 'Frieren', malId: 52991 },
];
assert.strictEqual(uctx.untrackDeletedSeries('Koori no Jouheki S2', path.join(lib, 'Koori no Jouheki S2')), 1, 'matched by MAL id'); checks++;
assert.strictEqual(uctx.untrackDeletedSeries('dandadan!', path.join(lib, 'Dandadan')), 1, 'matched by path'); checks++;
assert.deepStrictEqual(config.autoDownloadWatchlist.map(w => w.seriesName), ['Frieren'], 'other series stay tracked'); checks++;
config.untrackOnDelete = false;
assert.strictEqual(uctx.untrackDeletedSeries('Frieren', ''), 0, 'setting off keeps tracking'); checks++;
assert(saved >= 2); checks++;

// ---- main-owned keys --------------------------------------------------------
assert(/MAIN_OWNED_KEYS = new Set\(\['autoDownloadWatchlist', 'downloadHistory'\]\)/.test(mainSrc), 'watchlist is main-owned'); checks++;
assert(/for \(const key of MAIN_OWNED_KEYS\) delete incoming\[key\]/.test(mainSrc), 'config:setAll drops main-owned keys'); checks++;
assert(/if \(MAIN_OWNED_KEYS\.has\(key\)\) return true;/.test(mainSrc), 'config:set ignores main-owned keys'); checks++;
assert(!/bundled-mpv'\]/.test(mainSrc) && /config\.playerType === 'bundled-mpv'\) config\.playerType = config\.mpvPath \? 'mpv' : 'vlc'/.test(mainSrc), 'bundled MPV is migrated away'); checks++;

console.log('playback-and-tracking checks passed: ' + checks + ' assertions (subtitles, audio delay, untrack on delete, main-owned keys)');
