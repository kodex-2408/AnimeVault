# AnimeVault

A personal desktop anime & manga library manager built with Electron. Organize your local collection, track watch/read progress, explore new titles, download via Nyaa.si, and sync with MyAnimeList — all in one app.

**Current version: 5.0.0 — Liquid Glass redesign.** See [docs/CHANGELOG.md](docs/CHANGELOG.md) for release history and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for engineering notes.

---

## MangaVault Mode

Toggle the **Anime / Manga** pill in the titlebar to switch modes:

- **Separate libraries** — Independent anime and manga folders with isolated watch/read histories
- **MAL manga sync** — All API calls route to `/manga/` endpoints (chapters read, manga list, manga details)
- **File support** — Scans `.cbz`, `.cbr`, `.zip`, `.pdf`; parses chapter numbers from filenames
- **Reader integration** — Opens manga files with your configured reader (OpenComic, CDisplayEx, SumatraPDF) or system default
- **Nyaa manga** — Searches Nyaa category `c=3_1` (English-translated manga)
- **Smart labels** — UI adapts automatically: Ep → Ch, Watching → Reading, Plan to Watch → Plan to Read

---

## Features

### Library & Collection
- **Auto-scan** library folders and display series with cover art from AniList
- **Netflix-style UI** with hero banners, animated card grids, and liquid-glass styling
- **12 built-in themes** + accent color picker, font selector, and animation speed control
- **Category filters** with custom folder organization (Series, Seasonal, Movies, etc.)
- **Continue Watching** row sorted by recency
- **Duplicate file detection** with codec/size comparison and auto-resolution
- **Library Health Check** — scans for missing episodes, duplicates, and orphaned files
- **Episode Gap Detector v2** — season-aware expected ranges, exclusions, and guarded multi-download actions
- **Incremental library index** — reparses only folders that changed, with a manual rebuild option

### Explore & Discovery
- Browse MAL **top anime/manga** rankings and current **seasonal anime**
- **Live search** with instant results and cover previews
- **Donghua filter** — optionally hide Chinese anime from results
- Clickable cards with synopsis, stats, genres, and streaming/source links

### My List & MAL Sync
- **Full MAL library** with grid and list views, "Load More" pagination
- **Smart progress bars** — accent = watched/read, blue = aired-but-unwatched
- **Broadcast schedule** for airing series (Mexico City timezone)
- **Auto-sync** progress, status, and score bidirectionally
- **Sync conflict resolution** — choose Keep MAL, Keep Local, or Merge when progress diverges
- **Sync audit log** — persistent ring buffer of the last 50 sync operations
- **Bulk auto-linking** — fuzzy-match unlinked series to MAL entries
- **Manual MAL ID linking** — directly enter a MAL ID when search fails
- **Import Inbox** — persistent, explicit review of new and unlinked titles with top-five cover previews and an optional auto-match toggle in Settings → Import Matching
- **Sync Health validation** — flags suspicious title, season, year, and episode-total mismatches
- **Library Hub** — merged Import Inbox, Background Activity, and Downloads in one view with sub-tabs
- **Deep Stats dashboard** — score/status distributions, media formats, top genres, weekly watch heatmap, monthly activity, and premiere-year breakdown
- **TV-guide Schedule** — enlarged 7-day horizontal grid sorted by air time with today highlighted
- **Rotating hero banner** — Netflix-style carousel of your in-progress series that rotates every 7 seconds (pauses on hover) with arrows, progress dots, and Ken Burns pan

### Downloads & Nyaa
- **Smart split-button** on every series — quick default or granular options:
  - **Latest Episode** — targets next aired episode using preferred uploader
  - **Entire Series** — broad search ordered by seed count
  - **Browse on Nyaa.si** — open browser search
- **Explicit Auto-Download tracking** — opt in during import, from a series page/context menu, or with Collection/My List batch selection
- **Verified latest episodes** — checks current releases instead of treating a weekly calendar estimate as authoritative; optional per-series numbering correction
- **HEVC/x265 priority** — codec-aware scoring with size awareness to avoid bloated releases
- **Resilient Nyaa title matching** — compact uploader/codec/title-anchor searches tolerate shortened release titles and romanization drift while retaining strict episode, season, quality, and uploader validation
- **1-hour deduplication window** with full download history and retry
- Configure preferred uploader, quality (1080p/720p/480p), and source

### Playback
- **Bundled MPV** — no external player installation required
- **VLC and custom MPV** paths supported as alternatives
- **Auto-mark** episodes at configurable percentage (default 80%)
- **Subtitle language** injection (primary + fallback)
- Optional **−300ms audio offset** for Bluetooth headphone latency

### File Management & Organization
- **Format Loose Files** — auto-rename and organize video/manga files
- **Safe local series rename** — renames the folder and episode filenames while retaining AnimeVault/MAL metadata without re-linking
- **Rename in Folder** — inject series name into filenames
- **Batch Process** — multi-folder operations with undo support
- **Group/Ungroup folders** — merge or split series folders
- **Delete series** — individual or batch deletion with path-traversal guards
- **Download Watcher** — 5-minute polling of a watch folder with auto-organization
- **Root-level folder handling** — detects and processes entire dropped folders

### UI & Customization
- **Command Palette** (`Ctrl/Cmd+K`) — Spotlight-style search for views, actions, and library items
- **Keyboard shortcuts** — full shortcut layer with discoverability (`Shift+?`)
- **System tray** — minimize to tray instead of closing
- **Notification preferences** — toggle categories: Watcher, Health Check, Rescan, Auto-Download, MAL Sync, Duplicates
- **Background Activity Center** — persistent status and retry history for scans, imports, covers, sync, watcher, and download work (now inside Library Hub)
- **Performance Mode** — optional faster motion and reduced visual overhead for lower-power systems or very large libraries
- **Liquid-glass styling** — backdrop-filter blur, accent glows, and shimmer effects
- **Animated backgrounds** — particles, liquid orbs, or mesh gradient with intensity control
- **Right-click context menus** on cards with status shortcuts, cover change, and file actions
- **Free-roaming Luma companion** — a Mario Galaxy-style star spirit that drifts across the whole window with optional sparkle trails, toggled from Settings → Companion

---

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- Windows 10 x64 or newer

### Bundled Binaries
Place the following in a `bin/` folder at the project root before building:
- `mpv.exe` — from [mpv.io](https://mpv.io/installation/) (Windows x64 LGPL build)
- Any required `.dll` files alongside `mpv.exe`

These are automatically bundled into the output via `extraResources`.

### Install & Run (Dev)
```bat
npm install
npm start
```

### Run the test suite
```bat
npm test
```
Validates the IPC contract, renderer script syntax and the no-inline-code/CSP contract, search matching, MAL data merging, backfill behavior, and state-integrity regressions.

---

## Build

| Script | Output | Description |
|--------|--------|-------------|
| `BUILD.bat` | `dist\AnimeVault-<arch>.exe` | **Portable** — single self-contained `.exe`, no install needed |
| `BUILD-INSTALLER.bat` | `dist\AnimeVault-Setup-<arch>.exe` | **Installer** — setup wizard with Start Menu shortcut and uninstaller |

The batch files wrap `npm run build*`/`npm run build-installer*` scripts declared in `package.json`, with the electron-builder configuration inline in `package.json` (`build` key). `dist/` is build output and is excluded from packaging and version control.

**Which should I use?**
- **Personal use → Portable** (`BUILD.bat`). Drop anywhere and run. No registry entries. USB-friendly.
- **Sharing → Installer** (`BUILD-INSTALLER.bat`). Familiar setup wizard, Program Files placement, Add/Remove Programs entry.

**Will a standalone `.exe` work on another computer?**
Yes — the portable `.exe` is self-contained (Electron runtime + Chromium + Node.js + bundled MPV). The recipient needs no separate Node.js installation. Just double-click and run.

---

## Configuration

### First Launch
The setup wizard guides you through: theme, library folders, player choice, subtitle language, Nyaa uploader preference, and MAL connection.

### MyAnimeList
1. Create an API app at [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig)
2. Set redirect URI to `http://localhost:19876/callback`
3. Enter Client ID in Settings → MyAnimeList
4. Click Connect and authorize

### Download Handling
AnimeVault finds the best Nyaa match, downloads the `.torrent` file, and opens it with the system's configured torrent client. Magnet links are used as a fallback when a torrent ID is unavailable.

### Notification Preferences
Settings → Notifications → toggle categories individually. All toasts respect these preferences without disabling the underlying feature.

---

## Tech Stack
- **Electron** ^33 — desktop runtime
- **Vanilla HTML/CSS/JS** — single-file UI, no frameworks
- **MPV** — bundled video player (x64 LGPL build)
- **MyAnimeList API v2** — anime/manga data and list sync
- **AniList GraphQL** — cover art and search

## License
Personal use.
