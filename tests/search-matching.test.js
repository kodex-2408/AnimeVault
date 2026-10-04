'use strict';

const assert = require('assert');
const search = require('../autoDownload');

const cases = [
  {
    metadata: 'Otome Game Sekai wa Mob ni Kibishii Sekai desu 2',
    release: '[Erai-raws] Otomege Sekai wa Mob ni Kibishii Sekai Desu 2 - 03 [1080p CR WEBRip HEVC AAC][MultiSub][E58CFF1F]',
    anchor: 'otome',
    episode: 3
  },
  {
    metadata: 'Clevatess II Majuu no Ou to Itsuwari no Yuusha Denshou',
    release: '[Erai-raws] Clevatess II - 03 [1080p CR WEBRip HEVC AAC][MultiSub][A1E004A4]',
    anchor: 'clevatess',
    episode: 3
  }
];

for (const item of cases) {
  const release = { title: item.release };
  assert.strictEqual(search.getSearchAnchor(item.metadata), item.anchor);
  assert.strictEqual(search.getCompactSearchQuery(item.metadata, 'erai', null, true), `erai hevc ${item.anchor}`);
  assert.strictEqual(search.getCompactSearchQuery(item.metadata, 'erai', item.episode, true), `erai hevc ${item.anchor} 03`);
  assert.strictEqual(search.parseNyaaEpisodeNumber(item.release), item.episode);
  assert.strictEqual(search.releaseMatchesSeriesTitle(release, item.metadata), true);
  assert.strictEqual(search.releaseMatchesQuality(release, '1080p'), true);
}

assert.strictEqual(search.releaseMatchesSeriesTitle({
  title: '[Erai-raws] Otome Game no Hametsu Flag shika Nai Akuyaku Reijou ni Tensei shiteshimatta - 03 [1080p HEVC]'
}, cases[0].metadata), false, 'a shared generic opening must not identify another series');

assert.strictEqual(search.releaseMatchesSeriesTitle({
  title: '[Erai-raws] Clevatess III - 03 [1080p HEVC]'
}, cases[1].metadata), false, 'an explicit conflicting season must be rejected');

assert.strictEqual(search.releaseMatchesQuality({
  title: '[Erai-raws] Clevatess II - 03 [720p HEVC]'
}, '1080p'), false, 'an explicit conflicting resolution must be rejected');

const queries = search.buildEpisodeSearchQueries(cases[0].metadata, '1080p', 'erai', 3, true);
assert.strictEqual(queries[0], 'erai hevc otome 03');
assert.strictEqual(queries[1], 'erai hevc otome');
assert(queries.some(query => query.includes('Otome Game Sekai')), 'long-title fallback must remain available');
assert(queries.includes('hevc otome 03'), 'non-preferred-uploader fallback must remain available');

assert.strictEqual(search.getSearchAnchor('86 2nd Season'), '86', 'numeric-only franchise titles need a usable anchor');
assert.strictEqual(search.releaseMatchesSeriesTitle({ title: '[Erai-raws] 86 2nd Season - 03 [1080p HEVC]' }, '86 2nd Season'), true);

const trackedSeason = {
  seriesName: 'Mushoku Tensei II',
  searchTitle: 'Mushoku Tensei II',
  airingStartDate: '2026-07-01'
};
assert.strictEqual(search.releaseMatchesTrackedSeason({
  title: '[Erai-raws] Mushoku Tensei - 12 [1080p HEVC]',
  publishedAt: '2024-03-01T12:00:00.000Z'
}, trackedSeason, trackedSeason.searchTitle), false, 'a previous-season release predating the MAL entry must be rejected');
assert.strictEqual(search.releaseMatchesTrackedSeason({
  title: '[Erai-raws] Mushoku Tensei II - 03 [1080p HEVC]',
  publishedAt: '2026-07-18T12:00:00.000Z'
}, trackedSeason, trackedSeason.searchTitle), true, 'a release from the tracked season must be accepted');

const hyakkanoLegacy = { seriesName: 'Hyakkano S3', lastDownloadedEp: 0 };
const hyakkanoLedger = search.reconcileTrackingCursor(hyakkanoLegacy, [1, 2], 3);
assert.strictEqual(hyakkanoLedger.nextEpisode, 3, 'legacy tracking must reconcile to local episodes before polling');
assert.strictEqual(hyakkanoLegacy.trackingBaselineEp, 2);

const unresolvedLegacy = { seriesName: 'Gaikotsu Kishi S2', lastDownloadedEp: 0 };
const safeLedger = search.reconcileTrackingCursor(unresolvedLegacy, [], 12);
assert.strictEqual(safeLedger.nextEpisode, 13, 'an unresolved legacy row must not backfill an entire season');
assert.strictEqual(unresolvedLegacy.trackingBaselineEp, 12);

const explicitCurrent = {
  seriesName: 'Clevatess II',
  trackingBaselineEp: 2,
  lastDownloadedEp: 2,
  trackingIdentityKey: '55|C:/Anime/Clevatess II',
  currentIdentityKey: '55|C:/Anime/Clevatess II'
};
assert.strictEqual(search.reconcileTrackingCursor(explicitCurrent, [1, 2], 3).nextEpisode, 3);

const staleSameIdentity = {
  trackingBaselineEp: 2,
  lastDownloadedEp: 24,
  trackingIdentityKey: '55|C:/Anime/Clevatess II',
  currentIdentityKey: '55|C:/Anime/Clevatess II'
};
assert.strictEqual(search.reconcileTrackingCursor(staleSameIdentity, [1, 2], 3).nextEpisode, 3,
  'a stale same-identity counter above the verified ceiling must be clamped immediately');

// ---- 5.1 release choice: Erai-raws first, otherwise the most-seeded release ----
const rel = (title, seeders, size) => ({ title, seeders, size: size || '350 MiB', pubDate: '2026-10-01T00:00:00Z' });
const pool = [
  rel('[SubsPlease] Dandadan - 05 (1080p) [AB12CD34].mkv', 900),
  rel('[ToonsHub] Dandadan S01E05 1080p WEB-DL AAC2.0 H.264.mkv', 1500),
  rel('[Erai-raws] Dandadan - 05 [1080p][HEVC][Multiple Subtitle].mkv', 40),
  rel('[Judas] Dandadan - 05 (1080p) [HEVC x265 10bit].mkv', 300),
];
const withCfg = (cfg, fn) => { search.setDeps({ config: cfg }); return fn(); };
assert(/^\[Erai-raws\]/.test(withCfg({ forceHevc: true }, () => search.rankReleases(pool)[0].title)), 'Erai-raws always wins when it has a valid release');
assert(/^\[ToonsHub\]/.test(withCfg({ forceHevc: false }, () => search.rankReleases(pool.filter(r => !/Erai/.test(r.title)))[0].title)), 'without Erai-raws, the most-seeded release from any group wins');
assert(/^\[Judas\]/.test(withCfg({ forceHevc: true }, () => search.rankReleases(pool.filter(r => !/Erai/.test(r.title)))[0].title)), '"Prefer HEVC" puts a healthy HEVC release first');
assert(/^\[ToonsHub\]/.test(withCfg({ forceHevc: true }, () => search.rankReleases([rel('[Judas] Dandadan - 05 [HEVC]', 1), pool[1]])[0].title)), 'an HEVC release with fewer than 3 seeders gets no preference');
const bigHevc = [rel('[Judas] Dandadan - 05 [HEVC]', 150, '2.1 GiB'), rel('[ToonsHub] Dandadan S01E05 1080p H.264', 200, '700 MiB')];
assert(/^\[Judas\]/.test(withCfg({ forceHevc: true }, () => search.rankReleases(bigHevc)[0].title)), 'HEVC preference applies regardless of size by default');
assert(/^\[ToonsHub\]/.test(withCfg({ forceHevc: true, avoidOversizedHevc: true }, () => search.rankReleases(bigHevc)[0].title)), 'an oversized HEVC loses its codec preference, so seeders decide');
const batches = [rel('[Erai-raws] Frieren - 28 [1080p][HEVC]', 50), rel('[Judas] Frieren (Season 1) [1080p][HEVC x265][Batch]', 800), rel('[SubsPlease] Frieren (01-28) (1080p) [Batch]', 400)];
assert(/Batch/.test(withCfg({ forceHevc: false }, () => search.rankReleases(batches, { batch: true })[0].title)), 'full-series downloads rank batches ahead of single episodes');
assert.strictEqual(withCfg({ forceHevc: false }, () => search.rankReleases(batches, { batch: true })[0].title), batches[1].title, 'among batches, the most seeded wins when Erai-raws has none');
assert.strictEqual(search.isBatchRelease(rel('[SubsPlease] Show S2 - 05 (1080p)')), false, '"S2 - 05" is an episode, not a range');
assert.strictEqual(search.isBatchRelease(rel('[Erai-raws] Show - 01 ~ 12 [1080p]')), true);
const desc = withCfg({}, () => search.describeRelease(pool[2]));
assert.deepStrictEqual([desc.group, desc.codec, desc.resolution, desc.preferred], ['Erai-raws', 'HEVC', '1080p', true]);

console.log('search-matching regression tests passed');
