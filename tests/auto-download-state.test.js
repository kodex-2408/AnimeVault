'use strict';

const assert = require('assert');
const search = require('../autoDownload');

function baseEntry(overrides = {}) {
  return Object.assign({
    seriesName: 'Test Series',
    trackingBaselineEp: 10,
    lastDownloadedEp: 10,
    lastDownloadedAt: Date.now(),
    trackingIdentityKey: '1|C:\\anime\\Test Series',
    currentIdentityKey: '1|C:\\anime\\Test Series'
  }, overrides);
}

// --- handoff trust: the counter is only trusted while the folder backs it up ---

// Files deleted outside the app: the folder is empty and the handoff is old,
// so the stored counter is no longer trustworthy.
{
  const entry = baseEntry({ lastDownloadedEp: 12, lastDownloadedAt: Date.now() - 48 * 60 * 60 * 1000 });
  assert.strictEqual(search.isHandoffTrustworthy(entry, [], Date.now(), true), false);
}

// The handed-off episode exists locally: counter stays trusted even if the
// timestamp is old.
{
  const entry = baseEntry({ lastDownloadedEp: 12, lastDownloadedAt: Date.now() - 40 * 24 * 3600 * 1000 });
  assert.strictEqual(search.isHandoffTrustworthy(entry, [1, 2, 12], Date.now(), true), true);
}

// Short grace period: episode handed off minutes ago but the library scan has
// not picked it up yet — trust the counter.
{
  const entry = baseEntry({ lastDownloadedEp: 12, lastDownloadedAt: Date.now() - 5 * 60 * 1000 });
  assert.strictEqual(search.isHandoffTrustworthy(entry, [1, 2, 11], Date.now(), true), true);
}

// Outside the grace window with no local copy: no longer trusted.
{
  const entry = baseEntry({ lastDownloadedEp: 12, lastDownloadedAt: Date.now() - 30 * 60 * 60 * 1000 });
  assert.strictEqual(search.isHandoffTrustworthy(entry, [1, 2, 11], Date.now(), true), false);
}

// No handoff recorded yet: never trustworthy.
{
  const entry = baseEntry({ lastDownloadedEp: 0, lastDownloadedAt: 0 });
  assert.strictEqual(search.isHandoffTrustworthy(entry, [], Date.now(), true), false);
}

// A library cache that is not populated yet must not look like a deletion.
{
  const entry = baseEntry({ lastDownloadedEp: 12 });
  assert.strictEqual(search.isHandoffTrustworthy(entry, [], Date.now(), false), true);
}

// --- cursor reconciliation ---

// Deleted handoff files above the baseline: cursor collapses to the local folder.
{
  const entry = baseEntry({ trackingBaselineEp: 3, lastDownloadedEp: 12, lastDownloadedAt: Date.now() - 48 * 60 * 60 * 1000 });
  const ledger = search.reconcileTrackingCursor(entry, [1, 2, 3], 15);
  assert.strictEqual(ledger.nextEpisode, 4);
  assert.strictEqual(entry.lastDownloadedEp, 3);
}

// Same identity mismatch (moved library folder): the handoff counter is
// ignored, but the explicit baseline still protects the cursor.
{
  const entry = baseEntry({
    lastDownloadedEp: 12,
    trackingIdentityKey: '1|C:\\anime\\Old Folder'
  });
  const ledger = search.reconcileTrackingCursor(entry, [1, 2], 15);
  assert.strictEqual(ledger.nextEpisode, 11);
}

// Healthy folder: handoff counter keeps the cursor where it was.
{
  const entry = baseEntry({ lastDownloadedEp: 12, lastDownloadedAt: Date.now() });
  const ledger = search.reconcileTrackingCursor(entry, [1, 2, 12], 15);
  assert.strictEqual(ledger.nextEpisode, 13);
}

// Legacy rows without an integer baseline migrate instead of falling back.
{
  const entry = baseEntry({ trackingBaselineEp: undefined, lastDownloadedEp: undefined, lastDownloadedAt: undefined });
  const ledger = search.reconcileTrackingCursor(entry, [1, 2, 3], 15);
  assert.strictEqual(ledger.legacyMigrated, true);
  assert.strictEqual(entry.trackingBaselineEp, 3);
  assert.strictEqual(ledger.nextEpisode, 4);
}

console.log('auto-download state regression checks passed');
