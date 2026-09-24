# AnimeVault Changelog

All notable changes, newest first. Engineering context — test guide, security
posture, design decisions, open roadmap — lives in [DEVELOPMENT.md](DEVELOPMENT.md).

## 5.1.0 — Refined glass, hardened core

### Design
- Floating chrome: the title bar is no longer a bar — search, Anime/Manga and
  Luma float as glass capsules while content scrolls underneath, fading out
  under a soft blurred edge. The sidebar is an inset glass panel with rounded
  corners.
- The backdrop takes its color from the featured series' artwork, so every
  glass surface picks up the mood of what you're watching (off in
  performance mode or with background effects disabled).
- New glass material: a specular rim catches light on the top-left edge of
  every glass surface and follows your pointer across cards, buttons and
  tiles. Panels are frosted instead of opaque.
- The sidebar selection and segmented controls move like liquid lenses: they
  stretch while travelling and spring back into shape.
- When the Collection toolbar docks, it and the title bar become one glass
  surface instead of letting posters peek between them.
- Glossier primary buttons, play buttons, progress and chart bars; empty
  states get a floating glass orb.
- Fixes: the MyAnimeList chip no longer truncates ("Connect MAL"), airing
  badges on posters use a compact time ("Tmrw 3:30p") with the full time on
  hover, the synopsis "Show more" no longer paints a mismatched box, and
  Luma's chat formatting follows the theme instead of fixed colors.

### Fixed
- File Management tools were wired to a pre-5.0 contract. "Ungroup a folder"
  moved the files of every sibling series folder into the one you picked;
  "Rename inside a folder" and "Undo last operation" failed outright; every
  result showed as skipped. All tools now work as described, never overwrite
  an existing file, and every run can be undone.
- Restoring a backup put covers in the wrong folder, so they never showed.

### Security
- Electron 33 → 44 (a year of Chromium security fixes), electron-builder 26,
  adm-zip 0.6.1; `npm audit` reports 0 vulnerabilities (was 25).
- Packaged builds lock Electron fuses: no run-as-Node mode, no NODE_OPTIONS
  or --inspect hooks, and app code loads only from the packaged app archive.
- File actions check where a path really points, so a shortcut, symlink or
  junction inside a library folder can't reach files outside it.
- Your home folder, system folders, Program Files and the app's own folders
  can no longer be used as library or download-watch folders.
- MyAnimeList tokens can only be written by the main process; player and
  reader paths must be real .exe paths.
- Deleting single files or duplicates only accepts media files.
- Backups no longer contain MyAnimeList tokens or the client secret. Restore
  validates the zip, keeps your current login, and writes through the normal
  config safety chain (backup rotation and shrink guard).
- Every renderer is sandboxed and can't open pop-up windows or webviews.

## 5.0.0 — Liquid Glass redesign

### Design
- New design system: one set of tokens for color, translucent glass, four
  shadow levels, radii and motion, shared by every screen. Amber stays the
  default accent; every theme and custom accent flows through the same tokens.
- Title bar: Anime/Manga, search and Luma now share one glass capsule style.
  Search opens a command palette (Ctrl K) that jumps to pages, actions, series
  and your My List.
- Sidebar: a sliding lens marks the active page; it can collapse to an icon
  rail (Ctrl B). The footer now has a MyAnimeList sync chip plus two matching
  icon buttons (theme, shortcuts) instead of the mismatched ? and Light/Dark
  buttons.
- Series cards lift and catch a light sweep on hover and never darken. Badges
  are frosted glass and truncate cleanly.
- Continue Watching cards pick up color from each series' own art instead of
  flat gray, and use the same primary button as the rest of the app.
- Collection: a rotating featured billboard, a sticky filter toolbar, shelves
  per category, and a floating action bar when you select several series.
- Series detail is a sheet with a condensing header, stat tiles, streaming
  links, an episode grid/list, MAL and auto-download cards.
- Schedule rebuilt as a TV guide: next-up countdown cards, a 7-day week board
  that starts today with a live "now" line, and an agenda timeline.
- Stats rebuilt: KPI tiles, a list-status donut, score distribution, formats,
  top genres and a 26-week activity heatmap.
- Library Hub: Import Inbox, Activity and Downloads as three tiles. The import
  screen is now a two-pane reviewer (titles on the left, match and destination
  on the right). New downloads show a small notice instead of an automatic
  pop-up.
- File Management: grouped tool tiles with results in one consistent sheet;
  health check, gap detector, cover manager and batch delete redone.
- Settings: two-pane layout with searchable sections. Appearance: live preview,
  accent swatches with a custom picker, theme gallery, transparency, motion,
  font and background controls.
- Motion: spring-based transitions, gliding segmented controls, view
  transitions between pages. Appearance → Motion (None / Relaxed / Normal /
  Snappy) and Performance mode control all of it.
- Themes: eight dark (Midnight, Noir Gold, Graphite, Aurora, Forest, Lagoon,
  Crimson, Orchid) and eight light (Pearl, Porcelain, Cloud, Matcha, Seafoam,
  Lilac, Sakura, Butter), each from its own color family. Retired themes
  (Charcoal, Starry Night, Clay) switch to their closest replacement.
- Appearance → Featured card: the blurred artwork behind the Collection
  billboard can be light, dark, or follow the theme (Auto).
- Tile grids (tools, stats, themes, hub, up next) pick an even column count
  as the window narrows (4 → 2×2, 8 → 4×2); odd counts balance their rows.

### Security
- Renderer split into `renderer/*.js` and `styles/*.css`; the page has **no
  inline scripts or `on*=` handlers** and the CSP drops `'unsafe-inline'` from
  `script-src`. Buttons declare actions through `data-act` with JSON arguments,
  so titles and paths can no longer break into code.
- `shell:openFolder` reveals files in their folder instead of opening (and
  potentially running) them.
- Player and reader channels only open video/manga file types.
- VLC's web-interface password is random per launch.
- mpv receives the file after `--`, so a file name can never be read as an option.
- Cover downloads refuse private, loopback and link-local addresses.
- AniList list import runs in the main process with GraphQL variables (new
  `anilist:userMalIds` channel) instead of building queries from user input.

### Fixed
- VLC, MPV and reader paths entered in Settings were never saved.
- Rename, episode offset, category and gap-rule prompts did nothing
  (`prompt()` isn't supported by Electron); they now use in-app dialogs.
- Deleting a series whose name contains an apostrophe broke the confirm dialog.
- Manga reader detection returned a single path the UI couldn't read; it now
  returns every installed reader.
- Luma's "check downloads", "rescan" and "sync" actions called functions that
  didn't exist.
- Schedule showed the wrong auto-download state; My List broadcast times
  ignored the time of day; Explore details looked up local episodes by the MAL
  title.
- My List no longer re-downloads on every repaint; Luma's mascot no longer
  stacks animation loops; Reset preferences no longer writes a rejected key.
- Error messages from MAL/Nyaa are escaped before being shown.
- Card buttons (themes, cover results, matches, destinations) fill their grid
  cells on Electron's Chromium; long titles are clipped instead of overlapping.
- Switching pages no longer lands part-way down the page (the reset to the top
  was being overridden by smooth scrolling).

## Unreleased — 2026-08-22 working session

### Security
- `config:get` no longer exposes MAL access/refresh tokens or internal OAuth flow
  state (`malAuthState`) to the renderer; the latter previously broke every
  settings round-trip because `config:setAll` rejects unknown keys.
- Inline-handler escaping hardened: `E()` escapes apostrophes; `J()` rewritten as
  JS-escape-then-entity-encode, blocking quote breakout, entity re-decoding, and
  raw-newline breakage. Four unescaped interpolation sites fixed (sync-log errors,
  MAL search errors, file-manager result loops).
- MAL OAuth hardening: random per-attempt CSRF `state`, required end-to-end; the
  loopback listener fully tears down between attempts (`closeAllConnections` +
  `unref`) and binds both IPv4/IPv6 loopback; fails fast when port 19876 is held
  by a foreign process instead of silently timing out.
- Duplicate resolver validates every deletion path against the library allowlist
  and accepts array payloads; null payloads no longer crash the handler.
- Episode progress values are validated (integer 1–9999) across mark, mark-up-to,
  and set-watched-list IPC handlers.

### Fixed
- **MAL OAuth actually completes**: MAL supports only *plain* PKCE per its official
  authorization reference — sending S256 passed user consent and then failed the
  token exchange with `invalid_grant`. Also verified before showing "Connected!".
- **OAuth code-length cap removed**: the callback's 512-char sanity check rejected
  every real MAL authorization code (official docs: normally ~1,000 bytes), so
  consent could never complete even with everything else working. Raised to
  4,096 with accurate rejection reasons and code-length diagnostics.
- **Playback no longer crashes the app**: launching an episode with a missing
  player executable (e.g. VLC path pointing at a non-existent default install)
  raised an uncaught `spawn ENOENT` exception dialog. Player/reader launches now
  resolve common install locations, fall back to the OS default player with an
  informational toast, and return actionable errors instead of crashing.
- Nyaa HTML fallback always reported 0 seeders (`[2]` index on a `/g` match array),
  silently corrupting release scoring; trusted/remake rows were skipped entirely.
- `Title 05 - 1080p.mkv` parsed as having no episode in both filename parsers;
  dash-resolution pattern added ahead of metadata stripping.
- Manga mode sent anime fields/statuses to MAL edits (`num_watched_episodes`,
  `watching`) — manga edits now use `num_chapters_read`/`reading`/`plan_to_read`.
- Series folders containing subfolders failed to delete (`ENOTEMPTY`); deletes are
  recursive within path allowlists.
- Download history was recorded before torrent handoff, poisoning the 1-hour dedup
  window on failure; history is recorded only after success, with accurate method.
- Batch delete reported "Deleted 0 series" even on success (wrong response field)
  and swallowed per-item errors; accurate counts and failure reporting now.
- Multi-duplicate resolution deleted only one extra copy when 3+ duplicates existed.
- Stale async responses can no longer clobber newer views/data (sequence tokens in
  Explore/My List/Schedule loaders; identity guard in the series detail overlay).
- Titles containing apostrophes no longer break delete confirmations and streaming
  search links built into inline handlers.

### Performance
- Auto-mark/sync/link flows patch single-series state locally instead of triggering
  full library rescans (7 call sites; bulk MAL refresh is zero-scan end-to-end).
- Covers stream through a new privileged `cover://` protocol (same access rules as
  the previous IPC): scan-time hydration went from N base64 IPC round-trips to
  instant URLs with zero retained heap copies; CSP `img-src` includes `cover:`.
- Background cover fetches repaint at most once per second on cover-bearing views;
  library grid re-renders preserve scroll position.

### Added
- **AI Assistant (OpenRouter)** — new sidebar view with streaming chat. The API
  key follows the MAL-secret pattern (stored only in the main process, stripped
  from every renderer-facing read, "saved" placeholder UX); all network traffic
  originates main-side so the CSP stays untouched; model id is free-text
  (defaults to `deepseek/deepseek-v4-flash-0731`); Stop aborts mid-stream;
  the system prompt is grounded in your actual library so recommendations
  reference your collection.
- 🔑 Open `myanimelist.net/apiconfig` button on the MAL integration page; redirect
  hint corrected to `http://localhost:19876`.
- Client Secret field now shows a "Saved - leave blank to keep using it"
  placeholder via a non-sensitive existence flag, instead of looking empty when
  a secret is already stored.

### Incident & durability hardening (2026-08-22)
A `config.json` destruction outside any observable app session (cause unidentified
after forensics; see DEVELOPMENT.md) reset settings, MAL links, and watch history,
and single-generation backup rotation cemented the loss. Library folders were
rebuilt from the surviving scan index and covers returned from cache. Hardening so
any recurrence is recoverable by design:
- Catastrophic-shrink guard archives a valid >8 KB config being replaced by <25%
  of its size as `config.json.lost-<timestamp>` before overwrite.
- Two-generation backups (`.bak.old`) with a third fallback source in `loadConfig`.
- Daily snapshots (`backups/config-YYYY-MM-DD.json`, newest 7 kept), independent
  of the runtime fallback chain.

---
## v4.11.3 (2026-08-15)

### Fixed
- **Auto-Download tracker** — a series that had a torrent handed off (then stopped in the client or deleted in Explorer) is no longer skipped silently forever. Handoff counters now stay trusted only while the episode exists locally (or within a 24-hour grace window), after which the cursor falls back to what's actually in the library folder. Deleted episodes are offered again on the next poll, and the poller now waits for the first real library scan before evaluating folders at startup.
- Toast and activity copy for the tracker now say "torrent handed off" instead of "downloaded" — the app never downloads bytes itself.

### Changed
- **Schedule** — 7-column TV-guide grid enlarged to fill the page (240px+ columns, 64×90 covers, bigger typography, air-time chips) and scales with window size.
- **Collection hero** — now a Netflix-style rotating carousel of all your in-progress series: auto-advances every 7 seconds, pauses on hover, and offers prev/next arrows, progress dots, a slide counter, and Ken Burns background pan. Resume and More Info adapt per slide.
- **Continue Watching row** — first card no longer clips its hover glow; row scrolls vertically-safe with proper radius on the cover and bottom padding.

### Added
- **Luma companion (replaces Yoshi)** — a Mario Galaxy-style star spirit built from the user-provided 8-bit Luma PNG, with matching generated variants (left, lean-left, lean-right) and stardust sparkles. He roams the entire window, tilts toward his direction, bobs while floating, and turns to face you. Toggleable from Settings → Companion with a separate sparkle-trail toggle.

---

## v4.11.2 (2026-08-14)

### Security
- `config:get` no longer exposes the MAL client secret or PKCE verifier to the renderer.
- `config:set`/`config:setAll` accept only whitelisted config keys; watch-history keys are prototype-pollution-safe.
- MAL IDs, seasonal/year/limit parameters, and auto-download updates are validated before API calls.
- Cover reads are restricted to image files inside `cover-cache/` or `thumbnails/`.
- Cover/image fetches block internal hosts, cap redirects (5) and payload size (15 MB).
- The MAL OAuth loopback server binds to `127.0.0.1` and validates the `state` parameter; token refresh gained a timeout.
- All renderer permission requests are denied by default.
- Magnet links handed to the OS are protocol-validated; Nyaa info-hashes must be well-formed.
- Watcher destinations, thumbnail episode numbers, backup/import paths, and watch-and-delete targets are validated.

### Added
- **Library Hub** — Import Inbox, Background Activity, and Downloads merged into one view with sub-tabs (sidebar entry replaces the three old entries).
- **Deep Stats dashboard** — score/status distributions, media formats, top genres, weekly watch heatmap, monthly activity, premiere-year breakdown, disk usage.
- **TV-guide Schedule** — 7-column grid sorted by air time, today highlighted.
- **Import matching toggle** — Settings → Import Matching: auto-select the best MAL match (45%+ confidence) or stay fully manual; placement always requires user confirmation.
- **Walking Yoshi mascot** — pixel-art companion that walks the bottom edge of the window with left/right/front frames; toggle in Settings → Companion.
- File Management tools regrouped into Rename & Organize / Maintenance / Cover Art / Danger Zone sections.
- `npm test` and `npm run build*` scripts with an inline electron-builder config; restore-from-backup fixed via `webUtils.getPathForFile`.

### Changed
- First-run wizard copy updated to describe the current app (hub, stats, schedule, mascot).
- README theme count corrected (12 themes); IMPLEMENTATION/REVIEW refreshed for 4.11.2.
- Removed dead code across `main.js`, `preload.js`, and `autoDownload.js`; Nyaa search cache is now size-capped.

---

## v4.11.1 (2026-08-13)

### Fixed
- MAL list status (watching status, watched episodes, rating) could stay missing on series cards after linking/import: the first MAL fetch merged list status correctly, but an empty placeholder or a metadata-only refresh could drop it again. The merge now treats empty placeholders as non-authoritative and only preserves a real stored status.
- A plain MAL anime object's media `status` ("finished_airing", "currently_airing") was being shown as the user's list status when `my_list_status` was missing. List-status normalization now requires list-specific fields.
- Removing an entry from the MAL list now also clears the locally cached list status so cards stop showing a status MAL no longer has.

### Added
- Background MAL list-status backfill: on startup (and shortly after connecting MAL), linked series whose `my_list_status` is missing or empty are refreshed from MAL with the standard request throttle, repairing any library entries affected by earlier releases. The backfill only touches incomplete records, never blocking the UI.
- Sync Health now flags linked series with missing list-status data, so they can be repaired with Refresh.
- Regression tests for merge behavior and the backfill trigger.

## v4.11.0 (2026-07-31)

### Added
- Persistent Import Inbox with restart-safe placement choices, explicit MAL selection, top-five thumbnails, provider aliases, and direct `#MAL-ID` lookup.
- Suspicious-link analysis in Sync Health using title confidence, explicit season conflicts, release year, and local-versus-MAL episode totals.
- Parser Preview and per-mode MAL/AniList/Nyaa title aliases.
- Episode Gap Detector v2 with expected aired/finished ranges, tracked verified-latest data, per-series starts and exclusions, multi-select, and guarded batch downloads.
- Persistent Background Activity center for scans, imports, MAL refreshes, covers, watcher events, downloads, gaps, backups, failures, and supported retries.
- Incremental per-mode library index with cache statistics, manual rebuild, and stale-folder cleanup.
- Optional Performance Mode with shorter transitions, reduced redraws, parallel cover loading, and expensive visual effects disabled while active.

### Fixed
- Anime and manga now use isolated watch/read histories, MAL metadata caches, categories, tags, and scoped cover-cache files. Recoverable legacy manga data is migrated during scanning.
- MAL search results no longer select the first candidate automatically. Unlinked series are sent to manual review instead of fuzzy auto-linking.
- Package and lockfile versions are synchronized at 4.11.0.
- Invalid watcher ignore expressions no longer interrupt polling.
- Metadata exports no longer include MAL access tokens, refresh tokens, client secrets, or PKCE verifiers.

### Security and regression coverage
- Enabled Chromium renderer sandboxing and added a restrictive local-page Content Security Policy.
- Added state-integrity checks for mode isolation, explicit linking, the import inbox, scan index, parser preview, gap detector, Sync Health, Activity Center, and Performance Mode.

---

## v4.10.9 (2026-07-22)

### Fixed
- Replaced the poller's stored-counter starting point with a season-specific episode ledger reconciled against the exact local folder on every poll.
- Added stable tracked identity using MAL ID plus local series path, with exact-name and unique-MAL-ID fallbacks for older watchlist rows.
- Added a safe migration for legacy watchlist entries: existing local episodes become the baseline; unresolved entries start tracking from the currently verified episode instead of opening a historical-season download window.
- Latest-episode verification now reads Nyaa publication dates and rejects releases published before the tracked MAL season began, even when uploaders omit `S2`, `II`, or other season markers.
- Manual episode downloads and history retries inherit the same season identity whenever the requested title belongs to a tracked series.
- Existing local episodes are checked before any torrent window is generated, preventing already-present Hyakkano-style episodes from being handed off again.
- New tracking records persist the local path, MAL season start date, local baseline, and identity key.
- Scheduled polling now hands off at most one missing episode per series per poll, preventing any residual mismatch from opening an entire season of torrent windows at once.

### Regression coverage
- Previous-season releases predating the current MAL entry are rejected.
- A legacy entry with local episodes 1 and 2 targets only episode 3.
- A legacy entry whose local folder cannot be resolved does not backfill episodes 1 through the verified latest.

---

## v4.10.8 (2026-07-22)

### Fixed
- Replaced full-title-only Nyaa discovery with a compact anchor fallback modeled on practical searches such as `erai hevc otome` and `erai hevc clevatess`.
- Decoupled broad discovery from strict validation: results must still match the configured uploader tier, requested episode, requested quality, compatible season, and a confidence-scored series identity.
- Added tolerant title identity matching for release-group abbreviations, shortened licensor titles, punctuation drift, honorific tokenization, and stable word-prefix changes such as `Otome Game` / `Otomege`.
- Made latest-episode verification use the same compact search fallback instead of relying on a full metadata title.
- Added explicit Arabic/Roman season conflict rejection so a broad anchor cannot accept a different numbered season.
- Changed browser-based Nyaa links to concise uploader/codec/title-anchor searches sorted newest-first, without requiring `S2`, `II`, subtitles, or other potentially absent metadata.
- Added a repeatable search-matching regression suite covering title drift, shortened titles, unrelated-title rejection, season conflicts, quality checks, and compact query generation.

### Verified examples
- `Otome Game Sekai wa Mob ni Kibishii Sekai desu 2` matches Erai-raws' shortened `Otomege Sekai wa Mob ni Kibishii Sekai Desu 2` release.
- `Clevatess II Majuu no Ou to Itsuwari no Yuusha Denshou` matches Erai-raws' shortened `Clevatess II` release.

---

## v4.10.7 (2026-07-21)

### Fixed
- Made the configured uploader a strict selection tier for scheduled and immediate episode downloads. If a valid Erai-raws release exists, releases from other uploaders can no longer outrank it through seeders, codec bonuses, or trust scoring.
- Continued through Nyaa query fallbacks until a preferred-uploader result also matches the requested series and exact episode, preventing unrelated early results from stopping the search.
- Added punctuation and hyphen normalization for Nyaa searches, including colons, periods, apostrophes, Unicode dashes, and hyphenated words such as `Tai-Ari` / `Tai Ari` and `Ojou-sama` / `Ojou sama`.
- Repaired the HTML-search fallback's disconnected search-variant helper.
- Made manual browser searches use the normalized series title while preserving the selected uploader, quality, and episode filters.
- Removed unreachable legacy MAL criteria code so enabling Auto-Download cannot implicitly populate the explicit watchlist.

### Clarified
- Enabling Auto-Download changes only the global scheduler state. A fresh installation begins with an empty watchlist; existing explicitly tracked entries remain tracked when the scheduler is toggled off and back on.

---

## v4.10.6 (2026-07-21)

### Fixed
- Restored transitions and keyframe animations when Windows or Chromium reports reduced motion but AnimeVault is explicitly set to Slow, Normal, or Fast.
- Made AnimeVault's Animation Speed setting authoritative: only the in-app None option globally disables motion.
- Avoided persisting configuration or forcing an extra render merely to apply the saved motion preference during startup.
- Restored cursor-responsive surface lighting under the same explicit motion policy.

---

## v4.10.5 (2026-07-21)

### Changed
- **Explicit-only auto-tracking:** Library scans and MAL Watching no longer add series to the watchlist. Tracking is enabled only during import, on a series page, from a context menu, or through Collection/My List selection mode. Existing tracked entries are preserved.
- **Verified latest episode:** Scheduled and manual latest-episode downloads now inspect current Nyaa releases and choose the highest confidently title-matched episode. Calendar estimates remain informational and can no longer make the app request an unreleased episode.
- **Per-series correction:** Tracked series support a `-12` to `+12` correction for unusual numbering, split cours, recap offsets, or provider naming differences. The UI shows estimated and verified values separately.

### Added
- Auto-track choice in the new-series placement/linking window.
- Track/untrack actions on series pages and in Collection/My List context menus.
- Selection mode in Collection and My List for batch tracking, status changes, category moves, and guarded local deletion.
- Local rename action that renames the folder and episode files while preserving watch history, MAL identity, cover cache, category, tags, and tracking state without triggering a MAL re-link or resync.

### Fixed
- Manual “Download latest episode” now completes the search-and-open flow instead of returning only the calculated next number.
- Episode searches continue to broader queries when an earlier query returns unrelated results without the requested exact episode.
- Batch delete now passes the validated folder path to the backend and lists every affected folder before confirmation.
- Auto-download add is idempotent by MAL ID/local name, preventing duplicate tracked entries.
- Card click handling no longer opens a detail view behind selection mode.

### Visual polish
- Replaced the overshooting card-hover spring with a smaller, continuous ease-out lift; reduced cover zoom and shadow displacement for smoother entry and exit motion.

---

## v4.10.4 (2026-07-20)

### Fixed
- **Auto-download configuration identity:** `loadConfig()` and `config:setAll` now mutate the shared config object instead of replacing it. The extracted auto-download module therefore sees loaded credentials, preferences, watchlists, mode changes, and runtime settings rather than a stale copy of the defaults.
- **Episode parser control characters:** Replaced three accidental backspace characters in Nyaa episode regexes with real `\b` word boundaries, restoring the `EP12`, loose-quality, and dash-separated detection paths.
- **Poll scheduling:** The scheduler now respects `autoDownloadPollMinutes`, cancels its delayed startup poll when disabled, clears existing timers before restarting, and prevents overlapping polls.
- **Full-series downloads:** Full-series searches now score broad results instead of trying to match a null episode number. Direct Nyaa searches also use the anime or manga category appropriate to the active vault.
- **Watcher placement:** Folder placement no longer produces a duplicated `Series/Series` directory and now validates source, destination, and generated folder names.
- **Config durability:** Config writes use a temporary file and retain the previous valid config as `config.json.bak`; startup restores that backup when the primary file cannot be parsed.
- **IPC file boundaries:** Playback, thumbnail, cover, manga-reader, episode-list, and file-manager actions now reject paths outside configured AnimeVault locations. Config keys and vault modes are validated.
- **External navigation:** Renderer-created windows are denied and safe HTTP(S)/magnet links are handed to the system; unexpected top-level navigation is blocked.
- **Build scripts:** Invalid architecture input is handled explicitly, lockfile builds use `npm ci`, npm errors remain visible, misleading administrator advice was removed, and installer artifact naming now matches the documentation.
- **Documentation drift:** Removed references to an unimplemented built-in aria2 download mode and synchronized the package version.

### Visual polish
- Added pointer-responsive surface lighting to library cards, management cards, stat tiles, and explore heroes.
- Added a restrained gleam to progress bars and more dimensional management-card hover states.
- Added operating-system reduced-motion support; background effects and transform-heavy hover motion are suppressed automatically.

---

## v4.10.3 (2026-06-01)

### Fixed
- **MAL Edit Card Refresh Bug (root cause: stale GET overwriting fresh PATCH)**: `watch:setMalData` in `main.js:743` was unconditionally merging incoming `malData` from `malGetAnimeDetails` (a GET call) into `config.watchHistory[seriesName].malData`. The earlier `prevMLS` preservation guard only restored `my_list_status` when it was already truthy — meaning for a series freshly linked to MAL, the `if (prevMLS)` check was falsy and the stale `my_list_status` from the GET response silently overwrote the authoritative value just written by `mal:editStatus` from the PATCH response. Result: PATCH succeeds on the server, the disk write commits, `scanLibrary` reloads the library, `render()` is called — but every card in the grid still showed the pre-PATCH status/score/progress.
  - **Fix:** Strip `my_list_status` from the incoming GET data entirely before merging (`delete incoming.my_list_status`). The PATCH handler `mal:editStatus` already wrote the authoritative value directly. The GET response has no business touching it. The `prevMLS` fallback is still applied afterwards to handle the normal case where a series was already linked and re-fetched.
- **Redundant `api.scanLibrary()` in three MAL edit handlers**: `malAdjustEp`, `malSetStatus`, and `malRemoveFromList` in `index.html` were each calling `await fetchMD(name, malId)` (which already runs `S.lib = await api.scanLibrary()` internally) and then calling `api.scanLibrary()` again immediately afterwards. Removed the second scan — saves one full disk read + IPC round-trip per edit operation and eliminates a race where the redundant scan could clobber `S.lib` with a stale result that races against the render.

---

## v4.10.2 (2026-05-24)

### Fixed
- **Unlinked Series Cards Not Clickable**: `dlSplitBtn()` now uses a null-safe status expression `((malData && (malData.status || (mls && mls.status))) || '').toString()` to prevent `TypeError: null.toString()` when clicking cards with the yellow ⚠ Sync badge (no MAL link).
- **Duplicate Episode Detection Popup**: `checkDuplicatesAfterScan()` now uses `parseMediaNumber()` for vault-mode-aware episode/chapter parsing, and enriches file objects with codec, resolution, and human-readable size. Frontend duplicate popup renderer added with `showDuplicatePopup()`, `closeDuplicatePopup()`, `selectDupFile()`, `resolveDupByCodec()`, `resolveDupBySize()`, `resolveDupManual()`, and `doResolveDup()` functions. Popup shows series name, episode number, file metadata tags, and smart action buttons (Keep HEVC, Keep Larger, Confirm Selection). Auto-dismisses after 30 seconds.
- **Duplicate Function Definitions (main.js)**: Removed the first occurrence block of `parseEpisodeNumber`, `parseChapterNumber`, and `parseMediaNumber`. The remaining single definition uses `path.parse()`, `RELEASE_META_STRIP`, and proper year-filtering.
- **Duplicate Function Definitions (autoDownload.js)**: Removed the first (shorter) pair of `getNextEpisodeNumber` and `parseNyaaEpisodeNumber`. The remaining definitions include the `validate()` helper for rejecting 4-digit years and out-of-range numbers.
- **Auto-Download Batch Cap**: Aligned `maxBatch` in `runAutoDownloadPoller` with the documented v4.10.1 behavior — changed from `6` to `24`.
- **Nyaa Full-Series Query Builder**: The `nyaa:autoDownload` IPC handler now uses an `epNum`-aware query builder. When `epNum` is `null` (full-series/batch mode), queries no longer contain the literal string `"null"`. Instead, broader series-only queries are used.
- **preload.js API Naming Collision**: Removed the duplicate `openFolder` export from the Dialogs block. `browseFolder` already covers folder selection; the remaining `openFolder` (under Shell) takes a path argument and opens that specific folder.
- **MAL Manga Status Translation**: `mal:editStatus` now translates anime-status strings to manga equivalents before the API call: `watching` → `reading`, `plan_to_watch` → `plan_to_read`. This fixes silent failures when changing a linked manga's status via the detail overlay in MangaVault mode.
- **Episode Sort Error (Auto-Watch)**: `library:getEpisodes` sort comparator now explicitly coerces `episodeNum` through `Number()` and guards against `NaN` via `isNaN()` checks. Eliminates the "sort method cannot convert a string value to a number value" error that appeared when filenames produced non-numeric episode parses.
- **Complex Filename Parsing**: Added `RELEASE_META_STRIP` regex (50+ tokens) and `stripReleaseMetadata()` helper that removes release metadata (BluRay, H.264, FLAC, Dual, Kitsune, SubsPlease, Erai-raws, x264/x265, etc.) from filenames before episode/series extraction.
  - Added `extractSeriesName()` that detects "Title (Year)" and "Title Year" patterns, producing clean series names (e.g. `Monster 2004 S01 1080p...` -> `Monster (2004)`).
  - `parseEpisodeNumber()` now strips brackets/parentheses and metadata tokens, skips 4-digit years, and handles the ` - 26` end-of-string pattern.
  - `parseVideoFilename()` and `parseMangaFilename()` updated with 5 pattern paths using metadata-stripped matching.
- **Watcher Path Error on Folder Placement**: `placeNewSeries()` was passing the grouped frontend item (which lacks `originalPath` and `isFolder`) directly to the backend. Folder-type items queued by the watcher Phase 1.5 have those fields stored on `item.files[0]`. Fixed by building a proper `payload` object that pulls `originalPath` and `isFolder` from the first file entry. Also fixed the log entry to use `.file` instead of the non-existent `.name`.
- **Placement Toast Action Buttons**: The watcher notification toast for new series now includes inline "Place in [Category]" buttons directly in the toast (bottom-right tray), so the user can select a destination folder without navigating to File Management. Each configured folder becomes a quick-action button. Also includes a "Manage" button to open the File Management tab for more options. Duration extended to 15 seconds for these multi-action toasts.
- **MAL Auto-Linking Completely Broken**: `mal:bulkAutoSync` was calling `mal:autoSync` via `ipcMain.emit()`, but `mal:autoSync` only works for series that already have a `malId` — it returns `{ error: 'No MAL link' }` for unlinked series. The frontend expected `status: 'linked'` / `status: 'needs_review'` which was never returned. Rewrote `mal:bulkAutoSync` to actually search MAL for each series using `malSearch`, score results with `fuzzyTitleMatch()` (threshold 0.6), and auto-link confident matches. Returns proper status codes so the frontend's `status==='linked'` and `status==='needs_review'` filters work correctly.
- **Unsynced Card Click Bug**: Collection tab cards for unsynced series had a `.card-warn` badge with `pointer-events:auto` but no explicit `onclick`, relying solely on event delegation. Added explicit `onclick` to both the card (to open detail view) and the `.card-warn` badge (to open `malRelink()`), with `event.stopPropagation()` to prevent conflicts. Clicking the warn badge now reliably opens the MAL relink dialog; clicking elsewhere on the card opens the series detail view.

### Added
- **Watcher Root-Level Folder Handling**: Phase 1.5 added to `watcherPoll()` for folders dropped into the watch root.
  - Detects subdirectories with video files, extracts a clean series name, and renames the folder on disk if needed.
  - If all files inside belong to the same series and no existing folder is found, queues the **entire folder** as a new series unit (`isFolder: true`) with files pre-renamed.
  - `watcher:placeNewSeries` updated to support `isFolder` items: moves the whole folder or merges files if destination already exists.
  - Leaves no empty folders behind in the watch root.
- **Library Health Check Toast Notifications**: `runHealthCheck()` now shows toasts:
  - `"Running health check..."` when starting
  - `"Health check complete — X missing, Y duplicates, Z orphans"` (error toast) when issues found
  - `"Health check complete — library is healthy"` (success toast) when clean
- **Notification Preferences** (Settings): New section with 6 toggleable notification types:
  1. **File Watcher** — organized files / new series detected
  2. **Library Health Check** — scan results
  3. **Library Rescan** — after adding/moving files
  4. **Auto-Download** — download notifications
  5. **MAL Sync** — sync status & errors
  6. **Duplicate Files** — duplicate detection alerts
  - All default to **ON**. Every toast call throughout the codebase now respects these toggles via `notifEnabled(key)`.
  - New helpers: `notifEnabled()`, `setNotifPref()`, `resetNotifPrefs()`.
- **"Insert ID" button added to MAL sync error panel** and **MAL Links settings panel** for unlinked series. When clicked, opens a dialog where the user enters a numeric MAL ID directly. The app fetches the entry from MAL, shows a preview (title, type, score, episodes, cover), and the user confirms to link. Functions added: `malManualIdInput()`, `malManualIdSubmit()`, `malManualIdConfirm()`, `closeMalManualId()`.

### Changed
- Bumped version to 4.10.2 in package.json.
- All existing toast notifications (watcher auto-moved files, new series detected, auto-download results, MAL sync, library rescan, duplicate alerts) now check `notifEnabled()` before firing, allowing users to silence specific notification categories without losing the underlying functionality.

---

## v4.10.1

### Fixed
- **Auto-Download Over-downloading (Bug A)**: `runAutoDownloadPoller` now downloads all pending episodes per series in a single poll via an inner `while` loop with a safety cap (`maxBatch = 24`), instead of only one episode per interval. Each series is processed and cleared independently, preventing duplicate downloads across series.
- **Wrong Season Episodes Downloaded (Bug B)**: Fixed the season-guard regex template string where `\b` was interpreted as a literal backspace character instead of a regex word boundary. Now properly filters out releases from incorrect seasons.
- **Pending Episodes Not Fetched (Bug C)**: The new batch-download loop continues fetching `nextEp = lastDownloadedEp + 1` until Nyaa has no more episodes, ensuring no silently skipped episodes between polls.
- **Watcher Leaves Empty Folders (Bug D)**: `watcherPoll()` now removes empty subdirectories even when they contain no video files (files may have been moved out in a previous poll run).
- **Empty Watchlist Crash**: Added null-guard `watchlist?.length` in `checkAutoDownloadCriteria` to prevent crashes when the watchlist is empty.
- **Strict `startsWith` Matching**: `findExistingSeriesFolder` now uses a smarter similarity check (token-set overlap + lowercase startsWith) instead of naive `startsWith`, preventing unrelated series with shared prefixes from colliding.
- **Regex Compilation in Loops**: Moved frequently-used regex definitions outside loops in `nyaaSearchHtml` and `watcherPoll` to reduce per-iteration overhead.
- **Memory Leaks**: Ensured all `setInterval` calls have corresponding `clearInterval` cleanup paths.
- **Unhandled Promise Rejections**: Added `.catch()` handlers to floating promise chains in file system watchers and IPC handlers.
- **Race Condition in `saveConfig`**: Added a simple write-queue flag to prevent concurrent writes from corrupting the config file.

### Added
- **Per-Series "Download Latest Episode" Menu**: Right-click any series in the library grid or MAL list to trigger an immediate Nyaa search for the next missing episode (relative to local library). New IPC: `autoDownload:latestEpisode`.
- **`autoDownload.js` Module**: Extracted the auto-download poller and Nyaa search helpers into a dedicated CommonJS module for long-term maintainability.

### Changed
- **Performance**: Switched hot-path directory scans from `readdirSync` to `readdir` (async) to reduce main-thread blocking.
- **Library Scan Debounce**: `scanLibrary` is now debounced (300 ms) to prevent rapid successive scans during bulk file operations.

## v4.10.0 (2026-04-24) — Duplicate Detection, Special Character Fixes & Auto-Download Bug Fix

### Feature: Duplicate File Detection & Resolution (Core Flow)
- Integrated Library Health Check duplicate detection into the core app flow. When the app detects duplicate files for the same episode during a library scan:
  - Sends a **system tray notification** warning the user about duplicates.
  - Opens a **liquid-glass popup** in the lower-right corner (matching the toast notification area) with smooth slide-in animations.
  - Presents duplicate files with metadata: **codec** (HEVC / H.264), **file size**, **resolution**.
  - Lets the user choose which file to keep: **Prefer HEVC**, **Prefer Larger File**, or **Manual Selection**.
  - Automatically deletes rejected file(s) after user confirmation.
  - Auto-dismisses after 30 seconds if the user doesn't interact.
- New IPC channels: `duplicate:showModal`, `duplicate:resolve`, `duplicate:modalClosed`, `duplicate:found`, `duplicate:resolved`.

### Fix: Special Character Handling in Series Names
- Fixed detection and sync issues for series with special characters (`?`, `!`, `:`, `'`, `,`, `;`, `~`).
- **Nyaa auto-download / search**: When the original title yields no results, the app now automatically tries **normalized search variants** (e.g., `Re:Zero` → `Re Zero`, `ReZero`). This handles uploaders that omit special characters.
- **MAL sync**: The bulk auto-sync similarity function now uses `fuzzyTitleMatch()`, which normalizes special characters before comparing titles. This fixes linking between local folder names and MAL titles that use different punctuation.

### Fix: Download Dropdown Contextual Options
- The download split-button dropdown is now **context-aware** based on series status:
  - **Completed series**: Hides "Download Latest Episode" (no new episodes exist).
  - **Airing series**: Keeps "Download Latest Episode", hides "Batch / Season Pack" (airing series rarely have batch seeds).
  - **Removed "Batch / Season Pack" entirely** — it was redundant with "Entire Series" since the user can choose which folder/season to download in the torrent client popup.

### Fix: Auto-Fetch Episode 1 Bug
- The auto-download criteria mode no longer tries to download **episode 1** for every airing series in the user's MAL profile on startup.
- Now **cross-checks local library state** before triggering any download: if the user's local folder already contains episodes up to (or beyond) the latest aired count, the series is skipped entirely.
- Only triggers downloads when `localHighestEpisode < latestAiredEpisode`.
- `getLocalHighestEpisode()` uses fuzzy title matching to locate the series in the library, tolerating special character differences.

### Fix: Config Persistence & Backup
- Added an automatic config backup. If `config.json` is corrupted, the app restores from `config.json.bak`.
- Improved `loadConfig()` error handling with fallback chain: primary → backup → defaults.
- `saveConfig()` now writes to a `.tmp` file and atomically renames to prevent corruption during crashes.

### UI: Updated Toast & Popup Styling
- All toast notifications now use **liquid-glass styling**: `backdrop-filter: blur(24px) saturate(1.2)` with semi-transparent dark backgrounds and subtle borders.
- Improved text contrast on all toast variants (success, error, info) for better readability against the glassmorphism effect.
- Toast animation refined: smoother `translateX` slide-in with better easing curve.
- Duplicate resolution popup redesigned from a center-screen modal to a **lower-right popup** that sits alongside toasts, making it less intrusive while maintaining full functionality.

---

## v4.9.0 (2026-04-22) — Auto-Download for Airing Series

### Feature: Auto-Download Watchlist
- New **Auto-Download** system that periodically polls Nyaa for new episodes of tracked airing series.
- **Manual tracking**: Toggle "🔔 Track for auto-download" on any series detail overlay. The app seeds the registry with current local episode count and starts checking for `lastDownloadedEp + 1`.
- **Criteria mode**: Settings → Auto-Download → "Auto-track airing series from MAL" automatically populates the watchlist from your MAL Watching list, filtering for `currently_airing` status.
- **Poll intervals**: 15 min / 30 min / 1 hr (default 30 min). Respects Nyaa rate limits.
- **One-click flow**: When a new episode is found, the best-scored release is downloaded and opened via your default torrent client (qBittorrent, etc.). No manual Nyaa search needed.
- **Smart dedup**: Uses existing 1-hour dedup window (`downloads:checkRecent`) to prevent duplicate downloads.
- **Episode parsing**: `parseNyaaEpisodeNumber()` extracts episode numbers from release titles like `[Erai-raws] Oshi no Ko - 12 (1080p)`.

### Feature: Minimize to System Tray
- New **Window & Tray** section in Settings with a "Minimize to system tray" toggle.
- When enabled, clicking the minimize button or the close button hides the window to the system tray instead of exiting the app.
- Tray icon appears in the Windows notification area with:
  - **Left-click**: toggle show/hide the window
  - **Right-click**: context menu with "Show/Hide AnimeVault" and "Quit"
- The tray is created on startup if the setting is enabled, and destroyed when disabled.
- `applyMinimizeToTray()` attaches/detaches `minimize` and `close` event handlers dynamically.
- `isQuitting` flag ensures that "Quit" from the tray menu actually exits the app regardless of the tray setting.
- New IPC: `window:setMinimizeToTray` updates config and applies tray state immediately.

### Fixes (Auto-Download Poller)
- **Silent failures eliminated**: `runAutoDownloadPoller()` now returns a comprehensive result report (`downloaded` / `no_results` / `no_exact_match` / `dedup` / `error`) and sends it to the renderer via `autoDownload:pollComplete`. The UI shows descriptive toasts for every outcome.
- **Multi-query search**: Instead of one rigid query, the poller now tries multiple query variants per series (e.g., `[Erai-raws] Series - 12`, `[Erai-raws] Series 12 1080p`, broad `Series 12`) and stops at the first hit. This dramatically improves match rate when uploaders use inconsistent naming.
- **Strengthened episode parsing**: `parseNyaaEpisodeNumber()` gained two new patterns:
  - Pattern 6: loose ` 12 ` before quality markers without parens/brackets
  - Pattern 7: episode number at end of title before extension
- **Force poll**: New **Force Poll** button in Settings bypasses the 1-hour dedup window. Useful when a previous download failed and you want to retry immediately.
- **Dedup bypass**: `runAutoDownloadPoller(force)` accepts a `force` flag. `pollNow` passes `force=true` when triggered by the Force Poll button.

### Backend
- `autoDownloadWatchlist` config array persists tracked series with `lastLocalEp`, `lastDownloadedEp`, `preferredUploader`, `quality`, `source`.
- `runAutoDownloadPoller()`: scheduled Nyaa search per tracked series, exact episode match (`ep === lastDownloadedEp + 1`), score-aware selection via existing `scoreRelease()` pipeline.
- `syncAutoDownloadCriteria()`: syncs watchlist from MAL Watching list on startup and when criteria mode is toggled.
- New IPC handlers: `autoDownload:*` family (getWatchlist, addSeries, removeSeries, updateSeries, toggle, getStatus, setPollMinutes, setCriteria, pollNow).
- Renderer toast channel: `autoDownload:toast` fires when an episode is auto-downloaded or criteria sync adds new series.

### UI
- Detail overlay: "🔔 Tracked" / "🔕 Track for auto-download" button (anime mode only).
- Settings → Auto-Download: enable toggle, criteria toggle, poll interval dropdown, Poll Now button, tracked series list with per-series remove.
- Event delegation pattern for all auto-download buttons (no inline `onclick` escaping).

---

## v4.8.0 (2026-04-22) — Batches 1–4: Bug Fixes, UI/UX, Sync Integrity, Nyaa Polish

Batch 1 lands the seven critical bug fixes from the v4.8 master brief (Section 1). Batch 2 adds UI/UX & Navigation (Section 2). Batches 3+4 add Sync & Data Integrity (Section 3) and targeted Nyaa/Reader improvements (Section 4 minus 4.2). Section 4.2 (RSS watcher), Section 5 backend, Section 6 analytics, and Section 7.1 rename pass remain deferred pending scope review.

---

### Batches 3 + 4 — Sync & Data Integrity + Nyaa Polish

#### Feature 3.1: MAL Sync Audit Log
- Every `mal:editStatus` call now produces a log entry with timestamp, series name, mode (anime/manga), before→after diff per changed field (status / progress / score), success flag, HTTP status, and error message if applicable. Persisted in `config.syncLog` as a ring buffer capped at 50 entries so it survives app restarts without growing unbounded.
- The handler now fetches the pre-patch state via a `GET /my_list_status` before the `PATCH`, so the diff captures real transitions (e.g., `status: watching → completed`, `num_watched_episodes: 11 → 12`) rather than just echoing back what was sent. Identical values are omitted from the diff, so the log stays readable.
- New **"📋 View Sync Activity"** button in Settings → MyAnimeList → Sync Settings. Opens a scrollable table of the last 50 entries with When / Series / Mode / Change / Status columns. Failed calls are highlighted red. "Clear log" destructively empties the buffer after a confirm.
- `api.malEditStatus(malId, fields, seriesName?)` — renderer now passes the series name so the log shows something human-readable instead of "MAL #12345". All renderer callers that have the name (`autoSyncSeries`) updated; the ones that don't (generic edit modals) still work and just log the malId.

#### Feature 3.2: Smart Sync Conflict Resolution
- `autoSyncSeries` previously overwrote MAL's progress with the local count, even when MAL was higher. That regressed progress made on the mobile MAL app, the website, or another machine. The new flow compares before syncing: when `localHighest < malHighest > 0`, it blocks and shows a conflict modal.
- Modal offers four choices: **Keep MAL** (adopt MAL's progress locally — expands the watched list to include 1..malHighest, then skips the sync since MAL is already correct), **Keep Local** (overwrite MAL with the local count, the old behavior), **Merge to higher** (syncs `max(local, mal)` to MAL), and **Cancel** (do nothing). Modal is `await`-able via promise so sync logic blocks until the user chooses.
- Does not trigger when local >= MAL (no regression risk) or when MAL is 0 (nothing to protect). Triggers on every `autoSyncSeries` call path: marking an episode, unmarking, markAll, player auto-mark at N%.

#### Feature 3.3: Download History Panel + 1hr Dedup
- Every `nyaa:autoDownload` call logs an entry with timestamp, series, episode, mode (ep/full/batch), chosen release title, seeders, size, method (magnet/external), preferred uploader, and a dedup key (`series|episode|mode`). Persisted in `config.downloadHistory` capped at 50.
- New **"📜 View Download History"** button in Settings → Nyaa Downloads. Opens a card list of the last 50 downloads with per-entry **🔁 Retry** (re-runs the same search with the same mode + episode) and **🔍 Browse** (opens Nyaa in browser for that title). "Clear history" wipes the log.
- New IPC `downloads:checkRecent(title, ep, mode)` returns `{recent, minutesAgo, entry}` for queries within the last hour. The handler is exposed for future use by download-trigger UI — currently the 1hr dedup is advisory (logged but not enforced) so the user never gets silently blocked from re-downloading when they actually meant to. If you want hard dedup later, the plumbing is in place.

#### Feature 3.4: Config Hash Watcher Reactivity
- `saveSets` now hashes the watcher-relevant subset of config (`folders[].path`, `mangaFolders[].path`, `watcherFolder`) before and after save. When the hash changes and the watcher is active, it's auto-restarted with the new paths, so adding or removing a library folder immediately updates where the watcher deposits auto-organized files. A toast confirms: "Watcher restarted with updated folders."
- The hash is memoized across saves via a module-level `_lastWatcherHash`, so repeated Save clicks without folder changes don't churn the watcher.

#### Feature 4.1: `scoreRelease()` Size Awareness
- New helper `parseReleaseSize(sizeStr)` parses Nyaa's human-readable size strings (`"1.2 GiB"`, `"412.3 MiB"`, etc.) into raw bytes for comparison.
- `scoreRelease(r, uploader, ctx)` now accepts an optional context object. When `config.avoidOversizedHevc` is enabled and `ctx.h264Ceiling` is set, candidates marked HEVC get only a +300 bonus instead of +1000 if their size exceeds 2× the H.264 ceiling. This keeps HEVC as a preference rather than a hard override — a reasonably-sized H.264 release can win against a bloated HEVC one.
- `computeH264Ceiling(results)` finds the size of the best-seeded H.264 release in a candidate set; computed once per `autoDownload` call and passed to every `scoreRelease` invocation in that call.
- All six `scoreRelease` call sites in `autoDownload` updated to pass the shared `scoreCtx`. Without the feature flag, behavior is identical to before.
- New toggle in Settings → Nyaa Downloads: **"Avoid oversized HEVC releases"** (default off).

#### Feature 4.3: Manga Reader Auto-Detection
- New IPC `manga:detectReaders` scans Program Files, Program Files (x86), and %LOCALAPPDATA% for OpenComic, CDisplayEx, and SumatraPDF. Checks multiple common install layouts (top-level, `Programs/` subdirectory, portable-to-root). Returns an array of `{name, path}` hits, deduplicated.
- New **"🔍 Auto-detect"** button next to the Reader Application path input in Settings → Manga Reader:
  - Zero hits: shows an informative message in the hint area; no change.
  - Exactly one hit: pre-fills the path, saves the config, shows "Detected: [AppName]".
  - Multiple hits: opens a picker modal listing each detected reader with its path; clicking a row sets the path.
- Uses `data-reader-idx` event delegation for the picker rows — consistent with the v4.7.1 escape-safe pattern.

#### Feature: Keyboard Shortcuts Discoverability
Batch 2 added the shortcut layer but hid it. This delivery makes it discoverable:
- New **"?" button** in the sidebar footer, right of the MAL status badge. Subtle border that brightens to the accent color on hover. Tooltip: "Keyboard shortcuts (Shift+?)".
- New **Shift+?** global shortcut opens the help modal from anywhere except inside an input. Uses the standard convention (? is already Shift+/ on most keyboards).
- New **"Keyboard shortcuts"** action in the Ctrl+K palette.
- The help modal itself groups shortcuts by category (Navigation / Sidebar tabs / Chords / Detail overlay / Palette) with monospace keycap styling. Includes a note that plain-key shortcuts (1-6, /) are suppressed while typing in inputs, while Ctrl chords work everywhere.

---

### Batch 2 — UI/UX & Navigation

#### Feature 2.1: Command Palette (Ctrl/Cmd+K)
- New Spotlight-style overlay bound to `Ctrl+K` (and `Cmd+K` on Mac). Centered modal with a single search input, results grouped into **Views / Actions / Library / My List**, `↑↓` to navigate, `Enter` to run, `Esc` or click-outside to dismiss.
- **No CDN dependency.** A lightweight custom fuzzy scorer (~25 lines) handles matching: exact match → prefix → substring → subsequence, with bonuses for consecutive chars and word-start matches, and a mild length penalty to prefer shorter candidates on ties. Good enough for a few hundred items and removes the need for Fuse.js.
- **Action set:** "Rescan library", "Sync all with MAL", "Switch to Anime/Manga mode", "Pause/Resume MAL sync" (label flips to match current state), "Fetch missing covers", "Open app data folder", "Library Health Check", "Keyboard shortcuts".
- **Dynamic indexing:** every local series becomes a jump target (opens the detail overlay); if the MAL My List is already loaded it's indexed too (opens the explore detail). Palette intentionally does *not* trigger network calls on open — it only uses data already in state.
- Keyboard polish: palette input's `Escape`/arrow handlers `stopPropagation` so they don't bleed through and close the detail overlay behind it; `Ctrl+F` is suppressed while the palette is open since the user is already in a search box.

#### Feature 2.2: Real keyboard shortcuts
- Replaced the minimal keydown handler (previously Escape + Alt arrows only) with a full global shortcut layer. All shortcuts have an `_isTypingTarget()` guard so they don't hijack characters while the user is typing in an input, textarea, select, or contenteditable.
- **Always-active chords (work even while typing):** `Ctrl/Cmd+K` palette, `Ctrl/Cmd+F` focus active search, `Ctrl/Cmd+E` Explore, `Ctrl/Cmd+L` My List, `Ctrl/Cmd+,` Settings, `Ctrl/Cmd+Shift+M` toggle vault mode, `Shift+?` keyboard help, `Alt+←/→` view-history back/forward, `Escape` close palette-then-detail-overlay (chains correctly).
- **Plain-key shortcuts (suppressed while typing):** `/` focus active search, `1` Collection, `2` Explore, `3` My List, `4` Continue, `5` Completed, `6` File Management.
- **Inside the detail overlay:** `Enter` plays the next unwatched episode; `↑/↓` smooth-scroll the episode list; `Esc` closes.

#### Feature 2.3: Continue Watching sort by recency
- `vCont()` was already sorting by `watchData.lastWatched` desc. The actual bug was in `vLib()` — the Continue Watching row on the main Library page was using unsorted `all.filter(...)` output, which followed `S.lib` alphabetical order. That row now uses the same `lastWatched` desc sort, so the most recently watched series is first on both the Library page *and* the dedicated Continue view.

#### Feature 2.4: Library Health Check
- New shared tool card in **File Management → Tools → Library Health Check**, available in both Anime and Manga modes. Scans every local series against three issue classes: **Missing** (whole-number gaps in sequential numbering), **Duplicates** (multiple files resolving to the same number), **Orphans** (files where the number couldn't be parsed).
- **Sanity guard:** if the "missing" count would exceed 2× the "present" count, the series is probably a movie/specials folder, and the missing report is suppressed rather than flooding the results with false positives.
- **Report UI:** modal with a summary header, then per-series expandable rows sorted by issue count descending. Each row shows colored chips for its issue types and expands to reveal the specific missing numbers, duplicate groups, and orphan filenames. Each row has a "📂 Open folder" button via `data-hc-open` event delegation.
- Also accessible from the command palette as the "Library Health Check" action.

---

### Batch 1 — Critical Bug Fixes

#### Fix 1.1: `parseVideoFilename` no longer hardcodes `1080p`
- **Problem:** When formatting files via any path that called `parseVideoFilename` (Format Loose Files, Batch Process, watcher auto-organize), the renamed output always contained `(1080p)` regardless of the actual file resolution. A 720p file ended up renamed to `Foo - 01 (1080p) (HEVC).mkv`, making the resolution tag in the filename a lie.
- **Fix:** Extracted a shared `detectResolution(filename)` helper that matches `2160p`/`1080p`/`720p`/`480p` in the source name. When no marker is present, it falls back to `config.preferredQuality` (or `config.nyaaQuality`) before defaulting to `1080p`. All three match branches in `parseVideoFilename` now inject the detected resolution instead of a hardcoded string.

#### Fix 1.2: Explore status filter broken by operator precedence
- **Problem:** The status filter in `exfFilterResults` read `if ((a.status || '') || '' !== ef.status) return false;`. Because `!==` binds tighter than `||`, this parsed as `((a.status || '') || ('' !== ef.status))` — a value that's truthy whenever `ef.status` is non-empty, causing the filter to reject every card.
- **Fix:** Corrected to `if ((a.status || '') !== ef.status) return false;`.

#### Fix 1.3: `mal:updateStatus` routed wrong media type in Manga mode
- **Problem:** `mal:updateStatus` hardcoded `/anime/${malId}` endpoints and `num_watched_episodes` regardless of vault mode. In MangaVault mode, progress syncs silently failed or updated the wrong media type.
- **Fix:** The handler now branches on `config.vaultMode`. Manga mode hits `/manga/${malId}` and writes `num_chapters_read`. Status-rank table widened to recognize `reading`/`plan_to_read` so downgrades are prevented symmetrically.

#### Fix 1.4: Magnet URL normalization now shared between RSS and HTML scrapers
- **Problem:** The HTML scraper did `.replace(/&amp;/g, '&')` on magnet hrefs; the RSS parser did nothing. The inconsistency was a bug waiting to happen.
- **Fix:** Added a shared `normalizeMagnet(url)` helper that unescapes `&amp;`, `&lt;`, `&gt;`, `&quot;`, and numeric `&#NN;` entities. Both parser paths go through it.

#### Fix 1.5: Reset Preferences left MAL auth state stale
- **Problem:** `resetAllPreferences` called `api.setAllConfig({setupDone:false})`, and `setAllConfig` *merges* rather than replaces — so `malCodeVerifier`, `malClientId`, and `malClientSecret` survived the reset, making the next MAL connect fail with an unhelpful error.
- **Fix:** `resetAllPreferences` now explicitly nulls every credential and auth-state field.

#### Fix 1.6: Atomic config writes
- **Problem:** `saveConfig()` wrote directly to `config.json`. A crash mid-write could truncate the file.
- **Fix:** `saveConfig()` now writes to `config.json.tmp` and uses `fs.renameSync()` to atomically swap it into place.

#### Fix 1.7: Path-traversal guard on series deletion
- **Problem:** `library:deleteSeries` and `library:batchDeleteSeries` ran `fs.rmSync` on whatever path the renderer handed them.
- **Fix:** Added `isPathWithinLibrary(target)` that resolves the target and verifies it's inside one of the configured `folders` or `mangaFolders` roots (and not equal to a root). Both handlers reject paths that fail the check.

---

### Housekeeping
- `package.json` bumped to **4.8.0**.
- No new dependencies. Three new `preload.js` bridges (`detectMangaReaders`, `malGetSyncLog/Clear`, `downloadsGetHistory/Clear/CheckRecent`). `malEditStatus` signature extended with optional `seriesName` (backwards compatible — existing callers work unchanged).
- Batch 5 (targeted Backend — PKCE S256, persistent MPV IPC, audio profiles) is the next planned delivery. Section 5.1 (SQLite), 4.2 (RSS watcher), 5.4 (tray), 6.x (analytics/thumbnails), and 7.1 (rename pass) remain deferred pending scope review.

---

## v4.7.2 (2026-04-22) — HEVC Enforcement, Background Effects, Animation Polish

### Fix: Strong HEVC/x265 Priority for Auto-Download
- **Problem:** Auto-download consistently picked H.264 releases over HEVC because raw seeder count was the only sorting criterion, even when HEVC releases were available from the same provider.
- **Solution:** Implemented `scoreRelease()` quality scoring function that evaluates every candidate release with codec-aware weights:
  - **+1000** seed-equivalent bonus for HEVC/x265 releases
  - **-500** penalty for H.264/x264 releases
  - **+50** bonus for 10-bit / Hi10p releases
  - **+30** bonus for FLAC audio
  - **-200** penalty for 480p, **-100** for 720p
  - **+150** bonus for preferred uploader matches
- **Unified scoring across all download modes:** episode, full-series, and batch downloads all use the same scoring pipeline — no mode bypasses the codec check.
- **Changed query strategy:** Instead of "first query with results wins," the downloader now **collects and deduplicates results from ALL query variations** before scoring. This prevents better-encoded releases from being missed because they appeared in a later query.
- New **"Force HEVC/x265 over H.264/x264"** toggle in Settings → Nyaa Downloads (enabled by default). Added `forceHevc` config option.

### Fix: Unsynced Series Card Interaction
- **Root cause analysis:** Per v4.7.1, all card interactions use event delegation (not inline handlers) to avoid escaping bugs with special characters in titles. The delegation handler for `.card-warn` runs before the `.card` handler and correctly calls `malRelink()` when the sync badge is clicked.
- **Improvements:** Added `pointer-events: auto`, `cursor: pointer`, and subtle hover feedback to the `.card-warn` badge to make it more discoverable and responsive. Event delegation order verified — clicking the badge triggers sync relink, clicking anywhere else on the card opens the detail view.
- **No inline onclick handlers added** (consistent with v4.7.1 architecture) to avoid re-introducing escaping bugs with titles containing apostrophes or brackets.

### Feature: Animated Background Effects
- New **"Background Effects"** section in Settings → Appearance with three ambient animation types:
  - **Particles:** Floating luminous dots in accent colors that drift upward and fade
  - **Liquid Orbs:** Soft, blurred gradient blobs that slowly drift and morph
  - **Mesh Gradient:** Multi-point radial gradient mesh that subtly shifts colors
- Each effect supports three intensity levels: **Subtle / Medium / Vivid**
- All effects respect the global **Animation Speed** setting (disabled when set to "None")
- Dynamically created background layer — no DOM clutter when disabled
- Live preview via **"Apply Preview"** button

### Visual Polish: Liquid Glass & Enhanced Animations
- **CSS variable refinements:** Increased `--accent-glow` opacity, expanded `--shadow-glow` layers, slightly larger border radii, longer transition durations for a softer feel
- **Card hover:** Enhanced scale (1.06x), deeper shadow with accent glow bleed, added `backdrop-filter` blur
- **Button hover:** Added secondary glow layer, refined active-state feedback
- **Detail panel:** Added `backdrop-filter` blur, ambient accent glow, refined border treatment
- **Hero section:** Subtle radial accent glow overlay
- **Toast entrance:** Added subtle rotation + overshoot for organic feel
- **Spinner:** Color-shifting border animation
- **Liquid Glass:** New `.liquid-glass` utility class with edge-highlight pseudo-element for Apple-like depth
- **Shimmer effect:** New `.shimmer-bg` utility for skeleton/loading states
- **Filter tabs & link buttons:** Enhanced lift and glow on hover

---

## v4.7.1 (2026-04-09) — Fix: Unsynced cards fully unlocked

### Fix: Card click/right-click now uses event delegation instead of inline handlers
- **Root cause:** Inline `onclick="odtl('...')"` handlers broke silently when series names contained characters that escaped incorrectly in HTML attributes (e.g., apostrophes in titles like "Komi Can't Communicate", brackets in "[Oshi no Ko]")
- **Fix:** All card click, play button, and right-click context menu handlers switched from inline `onclick`/`oncontextmenu` to centralized event delegation using `data-series` and `data-ctx` attributes
- Cards now use `data-series="SeriesName"` (HTML-escaped via `E()`) instead of `onclick="odtl('escaped')"` (JS-escaped via `J()`)
- Event delegation catches clicks on `.card[data-series]` and `.scrc[data-series]` elements, reads the attribute, and calls `odtl()` / `showCtxMenu()` / `pNxt()` programmatically
- This approach is immune to escaping issues — the series name is stored as a data attribute and retrieved via `getAttribute()`, never embedded in executable JS
- Play buttons also switched to `data-play` attribute delegation
- `sCard()` now accepts an optional `ctx` parameter ('collection', 'continue', 'completed') for correct context menu behavior per tab
- All card types (Collection, Continue Watching, Completed, horizontal scroll cards) updated

## v4.7.0 (2026-04-09) — Batch 3: Appearance Revamp, Filter Buttons, UI Polish

### Feature: Appearance page split layout with Theme Customizer (Part 8)
- Appearance page now uses a split layout: theme swatches on the left, customizer panel on the right
- **Themes reorganized**: 4 Dark (Black, Charcoal, Chess, Graphite), 4 Colorful (Aurora, Midnight, Starry Night, Ember), 4 Light (White, Claude, Cream, Pearl)
- New **Ember** theme: warm dark gradient with orange accent
- Removed Ink, Slate, and Lavender themes
- Live hover preview removed per user request — click to apply directly
- **Customizer panel** (sticky right side) consolidates: current theme indicator, accent color picker, font selector (Traditional/Modern split), animation speed control
- All customizer changes apply instantly without navigating away

### Feature: Animation speeds now noticeably different
- **None**: 0ms transitions, 0ms card animations — instant everything
- **Slow**: 500ms transitions, 900ms slow transitions, 800ms card entrance — deliberate and relaxed
- **Normal** (default): 220ms/400ms transitions, 500ms card entrance — balanced
- **Fast**: 80ms/150ms transitions, 200ms card entrance — snappy
- Card entrance animation (`fiu`) now uses CSS variable `--anim-card` so speed setting actually affects card rendering
- Speed buttons show emoji icons (⏹🐢⚡🚀) for quick identification

### Feature: My List filter buttons ported from Explore style (Part 6C)
- Sort and Genre dropdowns replaced with Explore-style pill filter buttons
- Sort button opens chip-based dropdown panel; Genre button opens chip grid with all detected genres
- Active sort/genre highlighted with accent; "Clear" button resets both

### Feature: General UI polish pass (Part 7)
- Card hover: scale 1.05 with accent glow shadow, smoother cubic-bezier
- Sidebar active nav item has accent gradient underline
- Filter tabs (.ft): accent glow on hover, accent shadow when active

## v4.6.1 (2026-04-09) — Batch 2 fixes

### Fix: Sync badge click now works reliably (Part 1B)
- Switched from inline onclick to event delegation for card-warn badges to avoid JS escaping issues with series names containing special characters
- Added MAL connection check to malRelink — if MAL is not connected, shows an actionable "Connect" toast instead of silently failing
- Cards remain fully clickable regardless of sync status

### Feature: Right-click context menu on Explore tab cards
- Explore grid cards now support right-click context menus
- Options: View details, Open on MAL, status shortcuts, download series, browse on Nyaa
- If a local library match exists: also shows Open in file manager and Change cover

### Fix: Change cover opens search modal instead of auto-fetching
- Right-click → "Change cover" now opens a full AniList search modal with 8 results
- User can search by any term, see cover previews, and pick the exact cover they want
- "Auto-fetch best match" button available as a fallback for quick one-click fetch
- Applied to both Collection and My List context menus

### Feature: Settings — App Data & Reset section
- New "Data & Cache" section at bottom of Settings page
- **Open App Data Folder** — opens %AppData%/animevault (config, cache, covers) in the system file manager
- **Reset All Preferences** — clears all settings, MAL tokens, watch history, and folder paths with confirmation prompt; restarts the setup wizard; cover art files on disk are preserved
- Backend modified: config:get now includes `_userDataPath`; config:setAll strips it to prevent persisting

## v4.6.0 (2026-04-09) — Batch 2: Actionable Notifications, Context Menu, Donghua Filter

### Fix: Cards 15% smaller
- `.sg.lg` max reduced from 200px to 170px (clamp(120px, 12.75vw, 170px))

### Feature: Redesigned sync error notification (Part 1A)
- Sync errors now show a rich panel instead of a small toast
- Panel shows per-series breakdown with title and error reason
- Each entry has a "Fix" button that opens the re-link modal directly
- If >3 entries, first 3 shown with "Show X more" expandable toggle
- Panel is scrollable, has manual close (×) button, and a "Review All Links" footer

### Feature: Sync warning badge on unlinked cards (Part 1B)
- Collection cards missing MAL links now show a small amber "⚠ Sync" badge at top-left
- Clicking the badge opens the MAL re-link modal directly for that series
- Cards remain fully interactable — no hard lock

### Feature: Actionable notifications (Part 2)
- Toast system extended with optional action button and close (×) button
- Error toasts now display for 8 seconds (up from 4)
- "Connect MAL first" → includes "Connect" button opening MAL settings
- "Link MAL first" / "Link to MAL first" → includes "Link" button opening re-link modal
- "Scan failed" → includes "Retry" button
- Toast max-width increased from 400px to 480px to accommodate action buttons

### Feature: Right-click context menu on cards (Part 3)
- Right-click on any series card shows a context-aware menu at cursor position
- **Collection/Continue/Completed cards:** Re-sync MAL, Change cover, Refresh metadata, Open on MAL, Open in file manager, Mark status shortcuts (Watching/Completed/On Hold/Dropped/Plan to Watch), Delete files (with confirmation)
- **My List cards:** View details, Open on MAL, Open in file manager (if local), Change cover (if local), Mark status shortcuts, Download series, Browse on Nyaa
- Menu stays within viewport bounds, dismisses on click outside or Escape
- Styled to match the existing dropdown aesthetic with hover effects
- Destructive actions (delete) shown in red with confirmation prompt

### Feature: Filter Chinese anime (donghua) from Explore (Part 4)
- New toggle in Settings → Explore / Discovery: "Hide Chinese anime (donghua) from Explore"
- Default: ON (donghua hidden)
- Detection uses known Chinese studio names (Bilibili, Haoliners, Tencent, etc.) and CJK-heavy title heuristic
- Applied to seasonal results, top anime/manga results, and Load More pagination
- Toggling clears cached Explore data so filter takes effect on next visit

## v4.5.1 (2026-04-09) — Batch 1 fixes

### Fix: My List cards — status moved to overlay info line
- Removed the colored status badge from top-left corner of My List grid cards
- Status now displays in the overlay info line alongside episode count and MAL score (e.g. "11 ep · ★ 8.54 · completed")
- User score (✎ rating) removed from overlay — status replaces it
- Matches the Collection tab's overlay pattern where status sits in the info line

### Fix: Collection cards — category badge removed, grouped by category
- Removed the `card-cat` category badge (MOVIES, SEASONAL, etc.) from the top-left corner of Collection cards
- When "All" categories are shown (no specific category filter), series are now grouped under category subtitle headers (e.g. "Series", "Seasonal", "Movies") with each group's cards beneath
- When a specific category filter is active or searching, cards display as a flat grid (no grouping)

### Fix: Responsive card sizing
- Card grid minimum widths now use `clamp()` to scale proportionally with window size
- `.sg.lg` cards: clamp(140px, 15vw, 200px) — full size at fullscreen, shrinks smoothly when window is smaller
- `.sg` cards (Explore): clamp(120px, 13vw, 160px) — same proportional scaling
- Cards maintain their aspect ratio at all sizes

## v4.5.0 (2026-04-09) — Batch 1: Visual Consistency & Card Redesign

### Fix: Remove hover white border on cards (Part 9)
- Removed `border-color:rgba(255,255,255,.08)` from `.card:hover` rule
- Cards now hover cleanly with accent glow shadow only, no white border artifact
- Verified across all card variants (Collection, Continue, Completed, Explore, My List)

### Feature: Section title gradient applied universally (Part 6A)
- Extracted gradient style into shared `.section-title-gradient` CSS utility class
- Applied to all page/section titles: Explore, Continue Watching, Completed, Collection (Continue Watching row + All Series row), Settings, Appearance, File Management, MyAnimeList, and Explore sub-sections (Seasonal, Top Anime, Filtered Results)
- Uses the same `linear-gradient(135deg, var(--accent), var(--accent-light))` as My List title
- Works across all themes (light and dark) via CSS variables

### Feature: Card size uniformity across tabs (Part 6B)
- Collection tab "All Series" grid now uses `.sg.lg` (200px minimum) matching Continue Watching and Completed
- My List grid cards now use `.sg.lg` (200px minimum) instead of 170px
- Explore tab retains its existing mixed layout (150px/160px) as specified
- All card-bearing tabs now share consistent card dimensions

### Feature: Font selector split — Traditional & Modern/Fun (Part 5)
- Single font dropdown replaced with two side-by-side dropdowns in the Appearance tab
- **Traditional:** Segoe UI, Roboto, Source Sans 3, Lato, Open Sans, Montserrat, JetBrains Mono
- **Modern / Fun:** Inter, Nunito, Outfit, Sora, Plus Jakarta Sans, DM Sans, Lexend, Space Grotesk, Poppins
- Active font's dropdown gets an accent border highlight
- Both dropdowns feed the same font setting — last selected wins

### Feature: My List card redesign — Collection-style overlay (Part 10)
- My List grid cards now use the Collection tab's overlay card design
- Cover image fills the entire card with info overlaid at the bottom (no solid-color bottom segment)
- Top-right badge shows progress (watched/total) matching Collection's `card-b` pattern
- Top-left badge shows MAL status (watching, completed, etc.) with status color styling
- Broadcast schedule badge repositioned below status badge when both are present
- Progress bar pinned to absolute bottom of card cover using `cpb`/`cpf` classes
- Dual-layer progress: accent color for watched, status color for aired-but-unwatched
- Overlay text zone shows title (2-line clamp), episode count, MAL score, and user score
- Solid-color `card-i` bottom segment fully removed

## v4.4.1 (2026-04-06)

### Fix: My List — removed pencil edit button; editing via stat cards in detail overlay
- The ✏ edit button is removed from both grid and list card views
- Clicking any card in My List opens the full detail overlay (same as Collection tab) where the editable stat cards (Your Score, Progress, Your Status) can be clicked to edit
- This is consistent with the Collection tab UX shown in the series detail panel

### Fix: Theme-breaking visual regression rolled back
- Sidebar and titlebar changes from v4.4.0 used hardcoded dark RGBA values that broke light themes
- All CSS reverted to use theme CSS variables — visual appearance is identical to v4.3.1 baseline
- Navigation (Alt+Left/Right, mouse back/forward) kept intact

### Fix: Auto-mark enabled state now correctly defaults to true on startup
- Added explicit init() check: if autoMarkEnabled is undefined in saved config, it is set to true and persisted
- Prevents the feature from appearing disabled on first launch or after config file migrations


## v4.4.0

 (2026-04-05)

### Feature: HEVC-first download preference
- Episode downloads now try HEVC/x265 releases before falling back to standard quality
- Full-series downloads also query HEVC first, then standard
- When a preferred uploader is set (e.g. Erai-raws), uploader-tagged results are still prioritized, with HEVC preference applied within that set

### Feature: Alt+Left/Right and mouse back/forward navigation
- Alt+Left Arrow: navigate back through view history
- Alt+Right Arrow: navigate forward through view history
- Mouse back button (button 3) and forward button (button 4) also work
- All view changes via the sidebar are tracked in history

### Feature: Enhanced transparency & glass effects
- Titlebar now uses backdrop-blur with a gradient overlay for depth
- Sidebar background uses glassmorphism with subtle transparency
- Modal backdrop blur increased with saturation boost for cinematic feel
- Modal panel uses a subtle gradient instead of flat color
- Card hover glow now includes accent color shadow for a neon-edge effect

### Feature: My List — full list by default
- Initial fetch size increased from 100 to 1000 entries so the full list loads on first open
- Default filter changed from "Watching" to "All" so users see their entire list
- Load More still available for very large lists (1000+ entries)

### Feature: My List — collection-style cards
- Grid view cards now match the collection tab style with hover-reveal info overlay (consistent UX)
- Edit (✏) button preserved inside the hover overlay

### Feature: File Management — Fetch Covers panel
- "Fetch Missing Covers" card added to both anime and manga File Management
- "Fetch All" auto-fetches all missing covers from AniList
- "Manage" opens a full cover manager with per-series manual search and override

### Fix: Auto-fetch cover on MAL link
- When a series is linked to a MAL entry (via Search or Review Links), the cover art is now automatically fetched from AniList if not already cached

### Fix: Auto-mark enabled state restores correctly on startup
- `autoMarkEnabled` now defaults to `true` in the config baseline, preventing it from appearing disabled on first launch or after config migrations

## v4.3.1 (2026-03-30)

### Fix: Collection — thumbnails now load in MangaVault mode
- Cover background fetch now renders progressively (every 5 covers) instead of waiting for all covers to arrive, so cards fill in immediately as AniList responds rather than staying blank
- `switchMode()` now fully resets explore, filter, and My List state when toggling between modes, preventing stale anime data from bleeding into manga mode

### Fix: Series detail overlay — links are now mode-aware
- Manga mode shows: MangaDex, MangaFire, MangaReader, Nyaa, MAL (manga URL)
- Anime mode keeps: Nyaa.si, Miruro, Crunchyroll, Netflix, MAL (anime URL)
- Root cause: `nyaaTitle` was referenced before its `var` declaration (used in `dlSplitBtn()` call), causing a silent JS error that made any series without MAL data completely unclickable — fixed by hoisting the declaration

### Fix: Explore tab — shows top manga in MangaVault mode
- `loadExplore()` now branches on vault mode: manga mode fetches top manga ranking (no seasonal, MAL has no manga seasonal endpoint); anime mode keeps seasonal + top anime
- Seasonal hero section is hidden in manga mode
- Section heading reads "Top Manga" / "Top Anime" based on mode
- Explore detail overlay action buttons are now mode-aware (MangaDex/MangaFire in manga mode, Crunchyroll/Miruro in anime mode)
- MAL link in explore detail correctly points to `/manga/` or `/anime/`

### Fix: Explore source shortcuts bar
- Moved from the explore page header into the correct position (was already in detail overlays)
- Removed defunct MangaSee and ComicK entries
- Anime mode now also shows quick-access shortcuts (Crunchyroll, Miruro, Nyaa)

### Fix: Explore filters — media type and status now correct in manga mode
- Media Type filter shows manga-relevant options in manga mode: Manga, Novel, One Shot, Manhwa, Manhua, Doujinshi
- Status filter shows manga-relevant statuses: Publishing, Finished, Upcoming (instead of Airing, Finished, Upcoming)

### Fix: Read chapter count not syncing correctly
- `autoSyncSeries()` now sends `num_chapters_read` (not `num_watched_episodes`) in manga mode
- `syncMal()` applies the same fix
- MAL was silently ignoring the progress update because the field name was wrong for manga endpoints

### Fix: My List — "Reading" and "Plan to Read" sections now populate
- `loadMyList()` now translates UI filter keys to correct MAL manga status strings before the API call: `watching` → `reading`, `plan_to_watch` → `plan_to_read`
- Same translation applied in `loadMoreMyList()`
- CSS status badges added for `reading` and `plan_to_read` manga statuses

### Fix: Continue Reading now shows in-progress manga
- `vCont()`, `vLib()` continue-watching row, and `filt()` now accept `reading` as an active/in-progress status alongside `watching` and `on_hold`
- Collection filter tab for "Watching/Reading" and "Plan to Watch/Read" correctly matches both anime and manga status strings

### Fix: File Management — mode-aware tools
- Manga mode shows: **Organize Manga Folder** (renames .cbz/.cbr files using folder name + parsed chapter number → `Series Name - Ch.001.cbz`), Undo Last Operation, Rescan Library, Delete Series
- Anime mode keeps: Format Loose Files, Rename in Folder, Undo Formatting, Ungroup Folder, Batch Process, Rescan Library, Delete Series
- New `manager:formatManga` IPC handler in main.js uses `getMangaFiles()` + `parseChapterNumber()` with chapter-aware output format
- New `api.managerFormatManga()` preload bridge added

---

## v4.3.0 (2026-03-30)

### Feature: MangaVault Mode Toggle
- Anime / Manga pill toggle in the titlebar switches vault.mode between anime and manga, persisted in config
- Switching mode re-initializes the app with the correct data source, folders, watch history, and MAL endpoints
- App title changes to "MangaVault" / "AnimeVault" based on active mode

### Feature: MAL Manga Endpoint Support
- All MAL API calls branch on vault mode: /manga/{id} instead of /anime/{id}
- Progress field: num_chapters_read instead of num_episodes_watched
- AniList queries switch to type: MANGA for search and cover art
- User list fetches from /users/@me/mangalist in manga mode

### Feature: Mode-Aware UI Labels
- "Watching" → "Reading", "Plan to Watch" → "Plan to Read" across all filter tabs, edit panels, and status badges
- "Ep" → "Ch", "Episodes" → "Chapters" in progress stats, detail overlays, cards, and search results

### Feature: Manga Library Scanner
- New getMangaFiles() scanner detects .cbz, .cbr, .zip, .pdf files
- New parseChapterNumber() parser handles Ch.XX, Chapter XX, c.XX, and - XX patterns
- Separate mangaFolders and mangaWatchHistory config fields

### Feature: Nyaa Manga Category
- Manga mode uses Nyaa category c=3_1 (English-translated manga) for all searches

### Feature: Manga Reader Integration
- Settings → Manga Reader: configure an external reader path
- If empty, .cbz/.cbr files open with the system default app

---

## v4.2.1 (2026-03-27)

### Fix: Library not auto-loading on startup
- Removed dead api.onTorrentCompleted call in init() that was aborting startup

### Fix: My List dropdown — series data now editable
- Inline edit panel (Status, Score, Episodes Watched) with Save / Cancel / Remove actions

### Feature: My List — "Load More" pagination
- Initial 100 entries, +50 per click, state reset on filter switches

---

## v4.1.5 (2026-03-22)

### Fix: Empty title / double toast on download
### Fix: Preferred uploader being silently replaced
### Fix: isAiring detection handles both MAL status forms

---

## v4.0 (2026-03-15)
- Bundled MPV, build system

## v3.5 (2026-03-15)
- Nyaa uploader/quality prefs, My List improvements, themes, file management

## v3.0 (2026-03-14)
- Explore tab, My List, delete series, setup wizard

## v2.1.0 (2026-03-12)
- Auto-mark, download watcher, 8 themes

## v2.0.0 (2026-02-23)
- Netflix UI, MAL integration, file tools, AniList covers

## v1.0.0 (2026-02-08)
- Initial release
