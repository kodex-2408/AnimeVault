# AnimeVault — Development Guide

Engineering-facing documentation: how the codebase is organized, how to verify
changes, what the security posture is, and which design decisions are load-bearing.
User-facing release history lives in [CHANGELOG.md](CHANGELOG.md).

---

## Codebase map

| File | Role |
|---|---|
| `main.js` | Main-process entry only: startup log, sandbox, `cover://` registration, `registerHandlers()`, app lifecycle and the single-instance lock |
| `main/state.js` | The settings object `config` (loaded in place, never reassigned) and `state` — runtime handles shared across modules (`mainWindow`, `tray`, `isQuitting`, library cache). Always `state.mainWindow`, never a local copy |
| `main/config/` | `config.js` (config.json load/save, shrink guard, backups, Gemini key, watch-history helpers, `config:*`), `security.js` (path containment, validators), `backup.js` (export/import, backup/restore) |
| `main/scanner/` | `parsers.js` (filenames), `library.js` (layout, scan, index, `library:*`), `history.js` (`watch:*`), `organizer.js` (`manager:*`), `watcher.js`, `duplicates.js` |
| `main/players/` | `player.js` (launch, auto-mark poller, thumbnails, manga reader), `mpv.js`, `vlc.js` |
| `main/services/` | `covers.js`, `anilist.js`, `mal.js`, `nyaa.js`, `downloads.js` (auto-download wiring), `ai.js` (Luma handlers) |
| `main/window/` | `window.js` (window + `window:*`), `tray.js`, `protocol.js` (`cover://` handler) |
| `main/ipc/` | `registerHandlers.js` calls every module's `register()` (where its `ipcMain.handle` calls live); `system.js` holds dialog/shell handlers |
| `preload.js` | `contextBridge` API surface (`window.api`) — every renderer capability is an explicit channel here |
| `autoDownload.js` | Electron-free module: Nyaa RSS/HTML search, release scoring, title matching, tracking-ledger reconciliation. Required directly by tests |
| `gemini.js` | Electron-free module: streaming Google Gemini client for Luma, using the user's own free AI Studio key (SSE from main process; the renderer never sees the key or the network). Required directly by tests |
| `index.html` | App shell only: titlebar, sidebar, overlay hosts, strict CSP, and the ordered `<script src>` list. No inline code |
| `theme-boot.js` | Applies the cached theme before first paint (no flash of the wrong theme) |
| `styles/` | `tokens.css` (colors, glass, shadows, radii, motion) → `base.css` (shell, sidebar, titlebar) → `components.css` (buttons, cards, menus, modals…) → `views.css` (per-page layouts) |
| `renderer/core.js` | State `S` (a small reactive store: `Store.subscribe` / `Store.notify` / `Store.set`), escapers `E()`/`A()`/`On()`/`Tip()`, the delegated action dispatcher, icons, toasts, promise dialogs, menus, tooltips, segmented controls |
| `renderer/helpers.js` | Pure logic: parsers, MAL/status helpers, title matching, schedule math, analyzers |
| `renderer/data.js` | Library/MAL/download data layer and sync queues |
| `renderer/app.js` | Navigation, sidebar, routing, shortcuts, command palette |
| `renderer/<view>.js` | One file per area: `library`, `detail`, `explore`, `schedule`, `stats`, `hub`, `filemgmt`, `mal`, `settings`, `appearance`, `luma`, `setup`; `bootstrap.js` runs last |
| `tests/` | Eleven Node suites, no Electron or network needed (`npm test`); `source-extract.js` is the shared function extractor, `main-source.js` concatenates `main.js` + `main/**` for extraction |

Runtime split matters for testing: anything pure lives in `autoDownload.js` and is
requireable; everything touching Electron/IPC/DOM is tested by *extracting real
function source* out of the main-process files and the renderer scripts (loaded in order by `tests/renderer-source.js`) and running it in a `vm` sandbox
(see below) or via source-text invariant assertions.

---

## Commands

```bat
npm start                 Run from source (Electron dev mode)
npm test                  All suites, no Electron required
BUILD.bat                 Portable build (prompts arch)
BUILD-INSTALLER.bat       NSIS installer build
```

After building, remember the packaged exe freezes whatever source it was built
from — rebuild before re-testing changed behavior.

---

## Test suite guide

Run everything with `npm test`; each file is standalone `node tests/<file>`.

| Suite | Strategy | Covers |
|---|---|---|
| `contracts.test.js` | Source scanning + `vm.Script` compile | Every preload `invoke()` channel has an `ipcMain.handle()` counterpart; every renderer script parses; no inline scripts or `on*=` handlers anywhere; CSP `script-src` has no `unsafe-inline`/`unsafe-eval`; new renderer folders are packaged; lockfile version matches package.json |
| `search-matching.test.js` | Requires `../autoDownload` directly | Release-title confidence: romanization drift, season suffixes, uploader short-title forms, noise words |
| `mal-data.test.js` | Extracts `mergeMalData` from main.js source, executes in `vm` | List-status merge authority: PATCH responses win once local status exists; GET is trusted only for freshly linked series |
| `mal-backfill.test.js` | Same extraction approach | Startup repair skips series that already have usable list status |
| `state-integrity.test.js` | Source-text invariants | Vault-mode store routing, sandbox stays on, CSP present, secrets stripped from metadata export, dormant code stays removed |
| `auto-download-state.test.js` | Requires `../autoDownload` | Handoff trust windows, cursor reconciliation/fallback, legacy baseline migration |
| `security-and-parsers.test.js` | Generalized source-extraction + invariants | See next section |
| `library-layout.test.js` | Real helpers from `main.js` in `vm` against a temp tree | Category inference, category containers, season-aware folder matching, scene-style names, sequel cover matching |
| `playback-and-tracking.test.js` | Real player-option and untrack helpers from `main/` in `vm` | One subtitle list per player and "Off", Bluetooth delay units (MPV seconds, VLC ms), untrack by name / MAL id / path, main-owned config keys |
| `renderer-store.test.js` | Real `Store`/`S` from `core.js` in `vm` | Plain reads/writes, batched per-key notifications, `Store.notify` for in-place changes, subscriber isolation, unsubscribe |
| `filesystem-safety.test.js` | Real path helpers and File Management handlers from `main.js`, run in `vm` against a temp folder tree | Symlink/junction containment, forbidden roots, safe names, no-clobber moves, Ungroup scope, organizer result contract and undo, renderer config-write validation |

### How source extraction works

Functions that cannot be `require()`d (they live in `main.js` / `main/**` / `renderer/*.js`
behind Electron imports) are pulled out of the actual source text by a small
lexer-aware brace scanner and executed inside a `vm.createContext` sandbox with
stub dependencies (`path`, label helpers, mode flags). This tests the *shipped*
implementation — renaming or changing semantics breaks the suite immediately,
unlike mirrored copies which rot silently. Follow this pattern for new pure-logic
coverage; add `require`-based tests only for `autoDownload.js`.

### What `security-and-parsers.test.js` locks in

- **Escapers executed from source**: `E()` escapes `& < > " '`; `A()` emits exactly
  `data-act` + `data-arg` and its JSON arguments survive hostile inputs
  (apostrophes, quotes, backslashes, entity smuggling, newlines, tag injection, JS
  and attribute breakout, unicode) byte-identical. The dispatcher runs only
  registered actions and the renderer never evaluates strings as code.
- **Both episode parsers executed from source**, same 13-case matrix
  (`Title 05 - 1080p` → 5, `Season 2 - 1080p` → null, year rejection,
  SxxEyy/dash regressions…), keeping main and renderer parsing in parity.
- **Validators**: `safeEpisodeNumber`, `safeMalId`, `safeHistoryKey`
  (prototype-pollution key defense) truth tables.
- **Mode-aware statuses**: `malStatusOptions()` returns `reading`/`plan_to_read`
  in manga mode, `watching`/`plan_to_watch` in anime mode.
- **Packaging contract**: literal entries in `build.files` exist on disk
  (including `luma/` — deleting it silently breaks packaging).
- **Security invariants**: credential/OAuth-state stripping in `config:get`,
  shrink-guard archive marker, daily snapshot hook, auth-server connection
  teardown, plain-PKCE parameter (and absence of `S256`), duplicate-resolver
  array support, cover:// registration + CSP entry, recursive-delete flags.

---

## Manual smoke-test checklist (Electron-only paths)

The automated suites cannot execute the protocol handler or live OAuth listener;
run these inside the packaged app after meaningful changes (~5 minutes):

1. **cover:// pipeline** — Collection renders covers; DevTools network shows
   `cover://` requests returning 200 (no `data:` payloads).
2. **OAuth end-to-end** — MAL page → apiconfig button opens the site → Connect →
   authorize the *newest* browser tab → themed success page → app toasts
   Connected. Negative path: authorize an older tab → explanatory
   "Stale authorization tab" page. Every attempt appends to
   `%APPDATA%\animevault\auth-debug.log` (boot version, binds, inbound requests,
   state decisions, exchange result) — check it first when the flow fails;
   it never logs code/state values, only shapes and prefixes.
3. **Shrink guard** — Settings → Reset All Preferences → expect
   `%APPDATA%\animevault\config.json.lost-<timestamp>`.
4. **Daily snapshots** — after any save, `%APPDATA%\animevault\backups\config-<today>.json`
   exists; >7-day-old snapshots pruned.
5. **Recursive delete** — deleting a series folder containing subfolders succeeds.
6. **Playback without a player** — with a bogus VLC path in Settings, playing an
   episode must show an info toast (OS default player) — never a main-process
   error dialog.
7. **Assistant round-trip** — Luma dock: paste a Google AI Studio key (`AIza…`),
   save (a rejected key is refused immediately), send a message; tokens stream
   into the bubble, Stop aborts mid-stream, API errors show their text. The key must never appear in DevTools network
   or config reads (it lives only in the main process).

---

## Config durability chain

Order of defense for `%APPDATA%\animevault\config.json`:

1. Primary write is atomic (temp file + rename; copy fallback on Windows rename races).
2. Rotation keeps `.bak` (previous good generation) and `.bak.old` (generation before that);
   `loadConfig` falls back primary → `.bak` → `.bak.old`.
3. **Catastrophic-shrink guard**: replacing a valid >8 KB config with <25% of its
   size first archives the old file as `config.json.lost-<ISO timestamp>`.
   Deliberate resets produce the same archive — that is expected, not a bug.
4. **Daily snapshots**: `backups/config-YYYY-MM-DD.json`, newest 7 kept; disaster
   recovery only, never read at runtime.

Note honestly: these make corruption/wipes *recoverable*, not impossible. The one
recorded loss event (2026-08-22) had an off-screen cause that was never identified.

---

## Load-bearing design decisions

- **MAL OAuth uses plain PKCE.** MAL's authorization reference states only
  `code_challenge_method=plain` is supported; sending S256 passes consent and then
  fails the token exchange with `invalid_grant`. Do not "upgrade" this.
- **OAuth state is regenerated per Connect click.** Authorizing an older browser
  tab intentionally fails verification; the callback page explains this. Missing
  (vs mismatched) state is tolerated as a documented downgrade because PKCE still
  binds the exchange.
- **Auto-download tracking is explicit-only.** Scans and MAL watching status never
  create watchlist rows; membership changes only through user surfaces.
- **Handoff counters are hints, not truth.** `lastDownloadedEp` is trusted only
  while the local folder corroborates it (or within a grace window); otherwise the
  cursor falls back to the folder so deleted episodes are re-offered.
- **`mergeMalData` authority**: when both sides carry MAL's `updated_at`, the
  newer list status wins (so changes made on MAL reach the app, and a stale GET
  never undoes a fresh PATCH). Without timestamps the stored status stays
  authoritative and GET only seeds series that have none. `mal:pullListStatuses`
  applies the same rule to the whole MAL list (startup, every 10 min, on focus).
- **Release choice (5.2)**: `autoDownload.rankReleases` — batch first (full-series
  requests only), then Erai-raws, then a healthy HEVC release when "Prefer HEVC" is
  on (3+ seeders, not oversized when that setting is on), then seeders, then the
  newer upload. The per-group preference setting is gone. With "Let me pick the
  release", manual downloads return ranked candidates; the choice comes back as
  token + index only (`nyaa:downloadChoice`), never as a URL from the renderer.
- **Library layout (5.2)**: a folder's category is its type, or — for "custom" —
  inferred from its label/name. Subfolders named like a category (movies,
  seasonal, series…) that contain folders are containers (`listSeriesDirs`).
  Watcher matching is season-aware (`parseSeasonSuffix`) and ignores punctuation.
- **Manga field mapping happens client-side.** Server-side translation maps status
  strings only; `num_chapters_read` vs `num_watched_episodes` must be chosen by
  the caller based on vault mode.
- **Download history is written only after a successful OS handoff**, so failures
  never poison the 1-hour dedup window.
- **Renderer event contract (5.0)**: markup never contains code. Interactive
  elements declare `data-act="name"` (or `data-change` / `data-input` /
  `data-enter` / `data-ctx`) plus JSON `data-arg`, built with `A()` / `On()`. One
  delegated listener per event looks the name up in the `ACT` registry; only
  names registered with `act(name, fn)` or allowlisted with `expose(...)` can run.
  Use `E()` for every interpolated text or attribute value. The CSP
  (`script-src 'self'`) makes any regression fail closed.
- **No native dialogs**: `prompt()` does not exist in Electron — use
  `askText` / `askChoice` / `askConfirm` from `core.js`.

---

## Filesystem & process security model (5.1)

- **Allowed roots** are the library, manga and watch folders. `getAllowedFileRoots`
  drops any root that is, or contains, the home folder, Windows, Program Files,
  ProgramData, the install folder or userData (`isForbiddenRoot`) — even if it is
  already stored in config. A non-system drive root (D:\) stays allowed.
- **Containment is checked twice**: lexically and on `realpathLoose()` results,
  so a junction inside a library that points elsewhere fails the check.
- **Every name the app creates** (series folders, renamed files, thumbnail
  folders) passes `isSafeFileName`; every move goes through `moveNoClobber`
  (Windows `renameSync` would silently overwrite).
- **Renderer config writes** are validated only for values that changed
  (`validateRendererConfigValue`): MAL tokens are clear-only, program paths
  must be absolute `.exe`, folder lists must be absolute and non-forbidden.
- **Organizer runs** write a v2 undo log (`{ moves: [{ from, to }] }`);
  `manager:undoFormat` also reads the ≤5.0 array format.
- **Backups** exclude `BACKUP_SECRET_KEYS`; restore validates entry shapes,
  counts and sizes, keeps the current credentials, and saves via
  `writeConfigSafely` + `loadConfig`.
- **Electron**: `app.enableSandbox()` (skipped only with an explicit
  `--no-sandbox`, which root/CI runs need) and a `web-contents-created` guard
  (no webviews, no pop-ups, no navigation).
- **No Electron fuses (yet).** 5.1 briefly shipped `electronFuses` with
  electron-builder 26; the packaged Windows ARM64 portable build then exited
  before any app code ran (no startup.log), while `npm start` worked. Packaging
  is back to the 5.0 setup (electron-builder 25, no fuses). Re-enable fuses only
  after `dist\win-arm64-unpacked\AnimeVault.exe` is confirmed to start on real
  Windows ARM64 hardware. Build-time tools still show `npm audit` advisories;
  none ship in the app (`npm audit --omit=dev` is clean).
- **startup.log** (`%APPDATA%\animevault`) records every start, fatal
  main-process errors and single-instance hand-offs. If a build shows no
  window and writes no line here, the failure is below the app code
  (packaging, launcher, OS).

## Glass material system (5.1)

- `tokens.css` holds the glass recipe: `--glass-bg*` + `--glass-filter` for
  floating chrome, `--surface-glass*` for content panels (translucency only —
  the ambient backdrop is already blurred, so no per-panel backdrop-filter),
  and `--rim-hi/mid/lo/end` for the specular rim.
- The rim is one rule in `components.css` ("Glass rim"): a 1px masked
  gradient ring on `::after` (or `::before` for buttons and poster art). The
  gradient is written in that rule, not as a token, so a surface can retune
  `--rim-*` locally — a custom property that references other variables is
  resolved once where it's defined.
- `core.js` feeds `--gx/--gy` to surfaces in `SPECULAR_SEL` for the
  pointer-following highlight; `theme.js` `setAmbientArt()` crossfades the
  blurred backdrop art; `body.mc-scrolled` shows the title bar's scroll edge.
- Content scrolls under the title bar: `.mc` has `padding-top: var(--titlebar-h)`,
  and sticky children use `top: 0` (Chromium measures sticky offsets from the
  scroller's padding edge). Use `chromeTop()` when comparing positions.

## Main-process modules (5.2)

- A module keeps declarations at the top level and its `ipcMain.handle` /
  `app.on` calls inside `register()`. Nothing is wired until
  `main/ipc/registerHandlers.js` runs, once, from `main.js`.
- Dependencies point one way (config → scanner/services → window → entry); no
  require cycles, so imports are plain destructuring. The packaging test fails if
  a local `require` points at a file `build.files` would not ship.
- Values several modules assign (`mainWindow`, `tray`, `isQuitting`, the library
  cache) live on `state`; a module-private `let` stays in its module.
- Paths to app files use `APP_ROOT` from `main/state.js`, not `__dirname`.

## Renderer state (5.2)

`S` is still one plain-looking object, but it is a proxy: assigning a top-level
key publishes it to subscribers once per microtask. Use it for UI that must
follow state wherever it changes (the MAL chip follows `mal`/`cfg`; nav badges
follow `pendingNewSeries`/`activities`). Mutations inside a value
(`S.lib.push`, `S.cfg.x = y`) are not seen — call `Store.notify('key')`.

## Open work (priority order)

1. qBittorrent WebUI integration (true download-progress loop).
2. Signed NSIS + `electron-updater` release channel.
3. Mobile build: the 4.x `mobile/` project is not part of 5.x, so the
   `build-mobile`/`build-apk` scripts and `BUILD-APK.bat` were removed. A port
   would copy `renderer/`, `styles/` and `theme-boot.js` into a Capacitor shell.
