'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = require('./renderer-source').combined;
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

// 1. Startup backfill must be scheduled through the deferred maintenance pass
// after the initial library scan and render have completed.
assert(/await loadLib\(true\);\}\n  scheduleStartupLibraryMaintenance\(\);/.test(html),
  'startup must defer library maintenance until after loadLib');
assert(/function scheduleStartupLibraryMaintenance\(\)[\s\S]*scheduleMalBackfill\(500\);/.test(html),
  'deferred startup maintenance must include the MAL list-status backfill');

// 2. Backfill must run again after connecting MAL in Settings and in Setup.
assert(/scheduleMalBackfill\(800\);renderSetupStep\(\)/.test(html),
  'setup wizard MAL connect must schedule the backfill');
assert(/queuePendingMalMatches\(\);await loadLib\(true\);render\(\);scheduleMalBackfill\(800\);/.test(html),
  'settings MAL connect must schedule the backfill');

// 3. Backfill candidates: linked series whose my_list_status is missing or unusable.
assert(html.includes('Restore missing MAL list status'), 'backfill activity label must exist');
assert(/!malListStatusUsable\(wd\.malData&&wd\.malData\.my_list_status\)/.test(html),
  'backfill must select linked series with unusable my_list_status');

// 4. Main process must expose the matching IPC handler.
assert(/ipcMain\.handle\('mal:backfillMissing'/.test(main),
  'main process must register mal:backfillMissing');

// 5. The list-status normalizer must never treat a plain MAL anime object as list status.
const start = html.indexOf('function malListStatusUsable(ls){');
const end = html.indexOf('// Common label shortcuts', start);
assert(start >= 0 && end > start, 'list-status helpers must remain defined before the label shortcuts');
const ctx = vm.createContext({});
vm.runInContext(html.slice(start, end) + ';this.malListStatusUsable=malListStatusUsable;this.getMyListStatus=getMyListStatus;', ctx);
const malData = { id: 62546, title: 'Example', status: 'finished_airing', mean: 8.5, num_episodes: 12 };
assert.strictEqual(ctx.getMyListStatus(malData), null,
  'anime-level status/mean must not masquerade as the user\'s MAL list status');
assert.deepStrictEqual({ ...ctx.getMyListStatus({ score: 9, num_episodes_watched: 3 }) },
  { status: undefined, score: 9, num_episodes_watched: 3, num_chapters_read: undefined },
  'legacy flat list-status shape must still normalize');
assert.deepStrictEqual({ ...ctx.getMyListStatus({ my_list_status: { status: 'watching' } }) },
  { status: 'watching' },
  'wrapped my_list_status must be returned as-is');

console.log('MAL backfill behavior checks passed');
