'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const html = require('./renderer-source').combined;

assert(main.includes("config.vaultMode === 'manga' ? 'mangaWatchHistory' : 'watchHistory'"),
  'watch history must be selected by vault mode');
assert(!html.includes('selectedMalId=item.malMatches[0].id'),
  'MAL search results must never preselect the first candidate');
assert(!html.includes('function autoSyncOnImport'),
  'the dormant automatic import linker must remain removed');
assert(main.includes("ipcMain.handle('library:getScanStats'"));
assert(main.includes("ipcMain.handle('library:clearScanCache'"));
assert(main.includes("ipcMain.handle('manager:previewParse'"));
assert(preload.includes('getLibraryScanStats'));
assert(preload.includes('managerPreviewParse'));
assert(html.includes('function restoreImportInbox'));
assert(html.includes('function analyzeEpisodeGapsV2'));
assert(html.includes('Possible mismatch'), 'MAL link review must surface suspicious links');
assert(html.includes('function applyPerformanceMode'));
assert(html.includes('function vActivity'));
assert(main.includes('sandbox: true'), 'renderer sandbox must stay enabled');
assert(html.includes('Content-Security-Policy'), 'renderer must keep its local-page CSP');
assert(main.includes("['malAccessToken','malRefreshToken','malClientSecret','malCodeVerifier']"),
  'metadata export must strip MAL secrets');
assert(main.includes("mode === 'manga' ? 'manga--' : 'anime--'"),
  'cover-cache filenames must be scoped by vault mode');
assert(main.includes("'themeAccents'"), 'themeAccents must be in STATIC_CONFIG_KEYS');
assert(html.includes('clearAiConversation'), 'Luma companion must support conversation reset');
assert(html.includes('-webkit-user-drag:none') || html.includes('-webkit-user-drag: none'), 'Cover images must prevent dragging');

// 5.0 design-system regressions.
const renderer = require('./renderer-source');
assert(!/\.pc:hover[^{]*\{[^}]*brightness\(\s*0?\.\d/.test(renderer.css),
  'hovering a poster card must never darken it');
assert(renderer.css.includes(':root.light .hero-scrim'),
  'the collection hero must have separate light and dark contrast treatments');
assert(/function resumeCard[\s\S]*?btn btn-primary/.test(renderer.js),
  'continue-watching cards must use the shared primary button');
assert(/id="themeToggleBtn"[^>]*class="icon-btn"|class="icon-btn" id="themeToggleBtn"/.test(renderer.html),
  'sidebar footer buttons must use the shared icon button');
assert((renderer.css.match(/--shadow-[1-4]\s*:/g) || []).length >= 4, 'elevation must come from the shared shadow scale');
assert(!/\bwindow\.prompt\(|[^.\w]prompt\(/.test(renderer.js), 'window.prompt is unsupported in Electron — use askText');

// Startup network maintenance is delayed and bounded instead of fanning out.
assert(html.includes('Promise.all([api.getConfig(),api.malIsAuthenticated(),api.watcherStatus(),api.autoDownloadGetWatchlist()])'),
  'independent startup IPC reads must run concurrently');
assert(html.includes('_pendingMalQueueRunning=true') && html.includes('await loadPendingMalMatchesForItem'),
  'pending MAL matches must be processed through the serialized queue');
assert(main.includes('scheduleDuplicateCheck(library)') && !main.includes('await checkDuplicatesAfterScan(library)'),
  'duplicate analysis must not block the initial library response');

// 5.0 main-process hardening.
assert(!main.includes("VLC_HTTP_PASSWORD = 'animevault'"), 'VLC web-interface password must be random per launch');
assert(/shell:openFolder[\s\S]{0,600}showItemInFolder/.test(main), 'openFolder must reveal files instead of executing them');
assert(/player:play[\s\S]{0,200}assertPlayableMedia\(filePath\)/.test(main), 'player must only open media files');
assert(/manga:openFile[\s\S]{0,200}assertPlayableMedia\(filePath, MANGA_EXTS\)/.test(main), 'reader must only open manga files');
assert(main.includes("args.push('--', filePath)"), 'mpv file argument must follow the -- separator');
assert(main.includes('function isPrivateHost') && main.includes('if (isPrivateHost(parsed.hostname))'), 'image fetches must refuse private hosts');
assert(main.includes("ipcMain.handle('anilist:userMalIds'") && preload.includes('anilistUserMalIds'), 'AniList import runs in main with GraphQL variables');
['glassLevel', 'lastDarkTheme', 'lastLightTheme', 'sidebarCollapsed', 'schedView'].forEach(k => assert(main.includes("'" + k + "'"), k + ' must be a whitelisted config key'));

console.log('state-integrity regression checks passed');
