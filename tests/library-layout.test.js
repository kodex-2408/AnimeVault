'use strict';

// library-layout.test.js
//
// Executes the REAL library-layout, filename and cover-matching helpers from
// main.js (extracted from source, run in a vm sandbox with real fs) against a
// throwaway folder tree. Locks in the 5.1 fixes:
//   - folder categories are inferred from names; category subfolders
//     ("movies", "seasonal", "series") inside a library root are containers
//   - scene-style names (Title.S01E01.1080p…) are recognised
//   - the watcher never files season 2 into the season 1 folder
//   - sequel titles search AniList with its spellings (2nd Season / II)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('./source-extract');

const mainSrc = require('./main-source').readMainSource();
let checks = 0;
const fn = (name) => { const c = extractFunction(mainSrc, name); assert(c, 'could not extract ' + name); return c; };
const constBlock = (name) => { const m = mainSrc.match(new RegExp('^const ' + name + ' = [\\s\\S]*?;$', 'm')); assert(m, 'could not extract const ' + name); return m[0]; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'av-layout-'));
const touch = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); };
const config = { vaultMode: 'anime', folders: [], mangaFolders: [] };
const ctx = vm.createContext({ require, console, path, fs, config });
vm.runInContext([
  constBlock('CATEGORY_DIR_NAMES'), constBlock('ROMAN'), constBlock('RELEASE_META_STRIP'), constBlock('RELEASE_GROUP_TAIL'),
  ...['categoryForName', 'inferFolderType', 'hasSubdirectories', 'listSeriesDirs', 'seriesMatchKey',
    'ordinalSuffix', 'parseSeasonSuffix', 'findExistingSeriesFolder', 'anilistTitleVariants', 'mediaSeasonNumber',
    'pickSeasonMatch', 'cleanTitle', 'cleanFolderName', 'detectResolution', 'stripReleaseMetadata',
    'extractSeriesName', 'parseVideoFilename', 'parseMangaFilename', 'parseEpisodeNumber', 'parseChapterNumber'].map(fn),
].join('\n\n'), ctx, { filename: 'main.js (extracted)' });
const run = (src) => vm.runInContext(src, ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));

try {
  // ------------------------------------------------------------ categories
  ctx.f = { path: path.join(tmp, 'Movies'), label: 'Movies', type: 'custom' };
  assert.strictEqual(run('inferFolderType(f)'), 'movies', 'a "custom" folder labelled Movies is a movies folder'); checks++;
  ctx.f = { path: path.join(tmp, 'seasonal'), label: '', type: '' };
  assert.strictEqual(run('inferFolderType(f)'), 'seasonal'); checks++;
  ctx.f = { path: path.join(tmp, 'My stuff'), label: 'Anime', type: 'custom' };
  assert.strictEqual(run('inferFolderType(f)'), 'custom', 'unknown names stay custom'); checks++;
  ctx.f = { path: path.join(tmp, 'Movies'), label: 'Movies', type: 'series' };
  assert.strictEqual(run('inferFolderType(f)'), 'series', 'an explicit type always wins'); checks++;

  // ------------------------------------- category containers in a library root
  const root = path.join(tmp, 'Anime');
  touch(path.join(root, 'series', 'Mushishi', 'Mushishi - 01.mkv'));
  touch(path.join(root, 'seasonal', 'Dandadan S2', 'Dandadan S2 - 01.mkv'));
  touch(path.join(root, 'movies', 'Your Name', 'Your Name.mkv'));
  touch(path.join(root, 'movies', 'Perfect Blue (1997).mkv'));
  touch(path.join(root, 'Odd Taxi', 'Odd Taxi - 01.mkv'));
  touch(path.join(root, 'Anime', 'Season 1', 'Ep 01.mkv'));
  ctx.f = { path: root, label: 'Anime', type: 'custom' };
  const dirs = plain(run('listSeriesDirs(f)')).map(d => [d.name, d.category, !!d.containerOnly]).sort();
  assert.deepStrictEqual(dirs, [
    ['Anime', 'custom', false],
    ['Dandadan S2', 'seasonal', false],
    ['Mushishi', 'series', false],
    ['Odd Taxi', 'custom', false],
    ['Your Name', 'movies', false],
    ['movies', 'movies', true],
    ['series', 'series', true],
    ['seasonal', 'seasonal', true],
  ].sort(), 'category subfolders expand into their series; other folders stay series'); checks++;

  // ----------------------------------------------- watcher folder matching
  config.folders = [{ path: root, label: 'Anime', type: 'custom' }];
  ctx.n = 'Mushishi';
  assert.strictEqual(run('findExistingSeriesFolder(n)'), path.join(root, 'series', 'Mushishi'), 'series inside a container are found'); checks++;
  ctx.n = 'Dandadan';
  assert.strictEqual(run('findExistingSeriesFolder(n)'), null, 'season 1 never matches the season 2 folder'); checks++;
  ctx.n = 'Dandadan S2';
  assert.strictEqual(run('findExistingSeriesFolder(n)'), path.join(root, 'seasonal', 'Dandadan S2')); checks++;
  touch(path.join(root, 'series', 'A Wild Last Boss Appeared!', 'A Wild Last Boss Appeared! - 01.mkv'));
  ctx.n = 'A Wild Last Boss Appeared S2';
  assert.strictEqual(run('findExistingSeriesFolder(n)'), null, 'an S2 episode is not filed into the season 1 folder'); checks++;
  ctx.n = 'A Wild Last Boss Appeared';
  assert.strictEqual(run('findExistingSeriesFolder(n)'), path.join(root, 'series', 'A Wild Last Boss Appeared!'), 'punctuation does not block a match'); checks++;

  // -------------------------------------------- scene-style file names
  const parse = (n) => plain(run('parseVideoFilename(' + JSON.stringify(n) + ')'));
  let p = parse('Even.the.Student.Council.Has.Its.Holes.S01E01.1080p.UNCENSORED.ADN.WEB-DL.JPN.AAC2.0.H.264.MSubs-ToonsHub.mkv');
  assert.deepStrictEqual([p.matched, p.series, p.newName], [true, 'Even the Student Council Has Its Holes', 'Even the Student Council Has Its Holes - 01 (1080p) (H.264).mkv']); checks++;
  p = parse('A.Wild.Last.Boss.Appeared.S02E01.Mobile.Capital.Blutgang.Has.Appeared.1080p.CR.WEB-DL.JPN.AAC2.0.H.264.MSubs-ToonsHub.mkv');
  assert.deepStrictEqual([p.series, p.newName], ['A Wild Last Boss Appeared S2', 'A Wild Last Boss Appeared S2 - 01 (1080p) (H.264).mkv']); checks++;
  p = parse('Show Name S01E07 [1080p].mkv');
  assert.deepStrictEqual([p.series, p.newName], ['Show Name', 'Show Name - 07 (1080p) (H.264).mkv']); checks++;
  p = parse('[SubsPlease] Dandadan - 05 (1080p) [ABCD1234].mkv');
  assert.strictEqual(p.series, 'Dandadan', 'bracket-style names keep working'); checks++;
  p = plain(run('parseMangaFilename("Chainsaw.Man.S01E12.cbz")'));
  assert.deepStrictEqual([p.matched, p.series], [true, 'Chainsaw Man'], 'the manga parser had the same SxxEyy bug'); checks++;

  // ------------------------------------- long runners, hyphens, recaps, chapters
  assert.deepStrictEqual([parse('One Piece - 1100.mkv').series, parse('One Piece - 1100.mkv').newName], ['One Piece', 'One Piece - 1100 (1080p) (H.264).mkv'], '4-digit episodes'); checks++;
  assert.strictEqual(parse('[SubsPlease] Detective Conan - 1150 (1080p) [ABCD1234].mkv').series, 'Detective Conan'); checks++;
  for (const t of ['Hataraku Maou-sama', 'Mairimashita! Iruma-kun', 'Jibaku Shounen Hanako-kun', 'Spider-Man', 'Dual Blade Sub Multi Story']) {
    assert.strictEqual(run('extractSeriesName(' + JSON.stringify(t) + ').title'), t, 'title kept intact: ' + t); checks++;
  }
  assert.strictEqual(run('extractSeriesName("Monster.2004.S01.1080p.BluRay.x265-Group").title'), 'Monster (2004)', 'a real release group is still removed'); checks++;
  assert.strictEqual(run('parseEpisodeNumber("Series - 12.5.mkv")'), 12.5, 'recap episodes keep their .5'); checks++;
  assert.strictEqual(run('parseEpisodeNumber("Title - 05.720p.mkv")'), 5); checks++;
  assert.strictEqual(run('parseChapterNumber("Berserk Vol 03 Ch 25.cbz")'), 25, 'chapter, not volume'); checks++;
  assert.strictEqual(run('parseChapterNumber("One Piece Vol 100 Chapter 1000.cbz")'), 1000); checks++;
  assert.strictEqual(run('parseChapterNumber("Chainsaw Man c097.cbz")'), 97); checks++;

  // ------------------------------------------------- sequel cover matching
  assert.deepStrictEqual(plain(run('anilistTitleVariants("Apothecary Diaries S2")')).slice(0, 3),
    ['Apothecary Diaries 2nd Season', 'Apothecary Diaries Season 2', 'Apothecary Diaries II']); checks++;
  assert.deepStrictEqual(plain(run('anilistTitleVariants("Monster (2004)")')), ['Monster (2004)', 'Monster']); checks++;
  const media = (romaji) => ({ title: { romaji }, coverImage: { large: 'x' } });
  ctx.list = [media('Kusuriya no Hitorigoto'), media('Kusuriya no Hitorigoto 2nd Season'), media('Kusuriya no Hitorigoto 3rd Season')];
  assert.strictEqual(run('pickSeasonMatch(list, 2)').title.romaji, 'Kusuriya no Hitorigoto 2nd Season', 'the matching season is picked, not the first result'); checks++;
  assert.strictEqual(run('pickSeasonMatch(list, 1)').title.romaji, 'Kusuriya no Hitorigoto'); checks++;
  ctx.list = [media('Mushoku Tensei II: Isekai Ittara Honki Dasu'), media('Mushoku Tensei')];
  assert.strictEqual(run('pickSeasonMatch(list, 2)').title.romaji, 'Mushoku Tensei II: Isekai Ittara Honki Dasu', 'roman numerals followed by a subtitle count'); checks++;
  ctx.list = [media('Frieren')];
  assert.strictEqual(run('pickSeasonMatch(list, 2)'), null, 'a sequel never takes season 1 artwork'); checks++;

  console.log('library-layout checks passed: ' + checks + ' assertions (categories, containers, matching, scene names, sequel covers)');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
