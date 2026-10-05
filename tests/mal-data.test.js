'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const main = require('./main-source').readMainSource();
const start = main.indexOf('function mergeMalData');
const end = main.indexOf('\n}\n\nfunction getModeConfigMap', start);
assert(start >= 0 && end > start, 'mergeMalData helper must remain defined near the config helpers');

const context = {};
vm.runInNewContext(main.slice(start, end + 2) + ';this.mergeMalData=mergeMalData;', context);

const importedStatus = {
  status: 'completed',
  score: 8,
  num_episodes_watched: 12
};
const firstFetch = context.mergeMalData({ mean: 8.42 }, { title: 'Example', my_list_status: importedStatus });
assert.deepStrictEqual(firstFetch.my_list_status, importedStatus,
  'a first MAL fetch must retain the account status for a newly linked series');

const authoritativeStatus = { status: 'watching', score: 9, num_episodes_watched: 4 };
const refreshed = context.mergeMalData(
  { mean: 8.42, my_list_status: authoritativeStatus },
  { title: 'Example', my_list_status: { status: 'plan_to_watch', score: 0, num_episodes_watched: 0 } }
);
assert.deepStrictEqual(refreshed.my_list_status, authoritativeStatus,
  'a later GET must not overwrite an authoritative locally stored PATCH status');

// Regression: an empty placeholder object must not be treated as an authoritative
// status and silently suppress the first real MAL list status.
const placeholder = context.mergeMalData(
  { title: 'Example', my_list_status: {} },
  { title: 'Example', my_list_status: importedStatus }
);
assert.deepStrictEqual(placeholder.my_list_status, importedStatus,
  'an empty my_list_status placeholder must not block the first real MAL status');

// Regression: a GET response without my_list_status must not resurrect a stale
// empty placeholder over a stored authoritative status.
const kept = context.mergeMalData(
  { title: 'Example', my_list_status: authoritativeStatus },
  { title: 'Example' }
);
assert.deepStrictEqual(kept.my_list_status, authoritativeStatus,
  'a metadata-only GET must not replace a stored authoritative status');

// Empty placeholder + metadata-only GET: nothing usable arrived, so no status exists.
const none = context.mergeMalData(
  { title: 'Example', my_list_status: {} },
  { title: 'Example' }
);
assert.deepStrictEqual(none.my_list_status, undefined,
  'a metadata-only GET must not turn an empty placeholder into a phantom status');

// 5.1: a status changed on MAL itself (newer updated_at) reaches the app...
const localEdit = { status: 'watching', score: 0, num_episodes_watched: 3, updated_at: '2026-09-01T10:00:00+00:00' };
const droppedOnMal = { status: 'dropped', score: 0, num_episodes_watched: 3, updated_at: '2026-09-20T10:00:00+00:00' };
assert.deepStrictEqual(context.mergeMalData({ my_list_status: localEdit }, { my_list_status: droppedOnMal }).my_list_status, droppedOnMal,
  'a newer MAL status (e.g. dropped on the website) must replace the stored one');
// ...while an older GET never undoes a newer local PATCH.
const stale = { status: 'plan_to_watch', score: 0, num_episodes_watched: 0, updated_at: '2026-08-01T10:00:00+00:00' };
assert.deepStrictEqual(context.mergeMalData({ my_list_status: localEdit }, { my_list_status: stale }).my_list_status, localEdit,
  'an older MAL status must not overwrite a newer local one');

// The list pull uses the same rule (executed from main.js source).
const pullStart = main.indexOf('function shouldAdoptRemoteListStatus');
const pullEnd = main.indexOf('\n}\n', pullStart);
vm.runInNewContext(main.slice(pullStart, pullEnd + 2) + ';this.shouldAdopt=shouldAdoptRemoteListStatus;', context);
assert.strictEqual(context.shouldAdopt(localEdit, droppedOnMal), true);
assert.strictEqual(context.shouldAdopt(localEdit, stale), false);
assert.strictEqual(context.shouldAdopt(null, droppedOnMal), true);
assert.strictEqual(context.shouldAdopt({ status: 'watching' }, droppedOnMal), true, 'an untimestamped local status defers to MAL');
assert.strictEqual(context.shouldAdopt(localEdit, { score: 3 }), false, 'a remote entry without a status is ignored');

// Auto-linking: word-level, season-aware title confidence (threshold 0.88).
{
  const { extractFunction } = require('./source-extract');
  const ctx = vm.createContext({ autoDownload: require('../autoDownload') });
  vm.runInContext(extractFunction(main, 'fuzzyTitleMatch'), ctx);
  const m = (a, b) => ctx.fuzzyTitleMatch(a, b);
  assert.strictEqual(m('Monster', 'Monster'), 1);
  assert(m('Monster', 'Monster Musume no Iru Nichijou') < 0.88, 'Monster must not auto-link to Monster Musume');
  assert.strictEqual(m('Overlord', 'Overlord II'), 0, 'a different season is never a match');
  assert.strictEqual(m('Overlord II', 'Overlord II'), 1);
  assert(m('Frieren Beyond Journeys End', "Frieren: Beyond Journey's End") >= 0.88, 'punctuation differences still link');
  assert(/AUTO_LINK_THRESHOLD = 0\.88/.test(main));
}

// Cover file names stay inside Windows' 255-character limit.
{
  const { extractFunction } = require('./source-extract');
  const ctx = vm.createContext({ crypto: require('crypto') });
  vm.runInContext(extractFunction(main, 'coverFileStem'), ctx);
  const long = 'シャングリラ・フロンティア〜クソゲーハンター、神ゲーに挑まんとす〜 2nd Season 特別編集版';
  const stem = ctx.coverFileStem(long);
  assert(('anime--' + stem + '.jpg').length < 200, 'long Japanese names are shortened: ' + stem.length);
  assert.notStrictEqual(ctx.coverFileStem(long + 'x'), stem, 'shortened names stay unique');
  assert.strictEqual(ctx.coverFileStem('Frieren'), 'Frieren', 'short names keep the existing scheme');
}

console.log('MAL data merge regression checks passed');
