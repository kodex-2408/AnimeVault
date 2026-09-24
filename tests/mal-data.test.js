'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
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

console.log('MAL data merge regression checks passed');
