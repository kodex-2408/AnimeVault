# Tsundoku

*積ん読: the pile you mean to get to.* A desktop library for your anime and manga, built with Electron (formerly **AnimeVault**). Organize your local collection, track what you've watched and read, read manga in the built-in reader, find new releases on Nyaa.si and keep everything in sync with MyAnimeList.

**Current version: 5.10.0 — Manga translation with a text detector.** See [docs/CHANGELOG.md](docs/CHANGELOG.md) for release history and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for engineering notes.

---

## Anime and manga

Toggle the **Anime / Manga** switch in the title bar (or press `Ctrl+Shift+M`):

- **Separate libraries** — independent anime and manga folders with their own watch/read history
- **MAL manga sync** — manga mode uses MyAnimeList's manga endpoints (chapters read, manga list, manga details)
- **File support** — `.cbz`, `.cbr`, `.zip`, `.pdf`, `.epub` and `.mobi`; chapter numbers and titles are read from the file names
- **Built-in reader** — single page, double page or long strip, left-to-right or right-to-left, zoom (Ctrl + wheel or the − / % / + control), whole-window fullscreen; marks a chapter read when you reach a share of its pages (default 90%)
- **Translate pages** — the reader's Translate tool (`T`) finds the text with a manga text detector (downloaded once, 95 MB; runs on your GPU), erases it and letters the translation into each balloon's shape, one balloon at a time, even where balloons run together (Claude on OpenRouter with your Tsumi key; 16 languages; Claude Haiku 5.5 or Sonnet 5.5). `T` again shows the original. Switched on per chapter, since each new page is a paid request; finished pages are saved (they follow the chapter through renames and moves), so reopening a chapter shows them at once and costs nothing
- **Reader apps** — or open chapters in CDisplayEx, OpenComic, SumatraPDF, calibre and others; a chapter is marked read after it has been open for a reading time you choose (default 120 seconds)
- **Clean chapter names** — cards show a chapter's real title, or just its number; new manga series are renamed to `Series - Ch 012 - Title.cbz` on import (optional, undoable)
- **Getting chapters** — Tsundoku doesn't download manga itself (Nyaa is mostly anime). The setup guide, the empty manga library and each manga series page point to [HaruNeko](https://github.com/manga-download/haruneko/releases), the successor of HakuNeko: pick WeebCentral or MangaDex as the source, download chapters as CBZ, and set HaruNeko's download folder to your Tsundoku manga folder so new chapters appear on their own
- **Nyaa manga** — searches Nyaa category `c=3_1` (English-translated manga)
- **Smart labels** — Ep → Ch, Watching → Reading, Plan to Watch → Plan to Read

---

## Features

### Library & Collection
- **Auto-scan** library folders and show series with cover art from AniList
- **Hero banners, card grids and liquid-glass styling**
- **12 built-in themes**, accent colour picker, font picker (Figtree by default) and animation speed
- **Category filters** with your own folder organization (Series, Seasonal, Movies, …)
- **Continue Watching / Reading** row sorted by recency
- **Duplicate file detection** with codec/size comparison and auto-resolution
- **Library Health Check** — missing episodes, duplicates and orphaned files
- **Episode Gap Detector** — season-aware expected ranges, exclusions and guarded multi-download actions
- **Incremental library index** — re-reads only folders that changed, with a manual rebuild option

### Explore & Discovery
- Browse MAL **top anime/manga** rankings and the current **season**
- **Live search** with instant results and cover previews
- **Donghua filter** — optionally hide Chinese animation from results
- Cards with synopsis, stats, genres and links

### My List & MAL Sync
- **Full MAL list** with grid and list views
- **Progress bars** — accent = watched/read, blue = aired but not yet watched
- **Broadcast schedule** for airing series, shown in your own time zone
- **Two-way sync** of progress, status and score; checkmarks follow what you mark on MyAnimeList
- **Pause sync** — while paused, checkmarks are locked and nothing is sent or pulled
- **Sync conflict resolution** — Keep MAL, Keep Local or Merge when progress diverges
- **Sync activity log** — the last 100 changes sent to MyAnimeList (Settings → MyAnimeList)
- **Bulk auto-linking** and **manual MAL ID linking**
- **Import Inbox** — review new and unlinked titles with top-five cover previews; optional auto-match
- **Sync Health** — flags suspicious title, season, year and episode-count mismatches
- **Library Hub** — Import Inbox, Background Activity and Downloads in one place
- **Stats dashboard** — score/status distributions, formats, top genres, weekly heatmap, monthly activity, premiere years
- **TV-guide Schedule** — 7-day grid sorted by air time with today highlighted

### Downloads & Nyaa
- **Split download button** on every series:
  - **Latest episode** — the next aired episode from your preferred uploader
  - **Entire series** — broad search ordered by seeders
  - **Browse on Nyaa.si**
- **Release picker** — choose the release yourself for latest-episode, single-episode or whole-series downloads
- **Season-aware matching** — Erai-raws first, otherwise the best-seeded release for the right season and episode
- **Auto-download tracking** — opt in per series; verified latest episodes; optional numbering correction
- **HEVC/x265 priority** with size awareness to avoid bloated releases
- **1-hour duplicate guard** with full download history and retry
- Preferred uploader, quality (1080p / 720p / 480p) and source

### Playback
- **VLC or MPV** — set the path in Settings (no player is bundled; install one)
- **Auto-mark** episodes at a configurable percentage (default 80%)
- **Subtitle language** preferences (primary + fallback)
- **Bluetooth audio delay fix** — plays audio earlier by the number of milliseconds you set (300 ms suits most headphones)

### File Management & Organization
- **Format loose files** — rename and organize video/manga files
- **Safe series rename** — renames the folder and files while keeping the MAL link and history
- **Rename in folder**, **batch process** with undo, **group/ungroup folders**
- **Delete series** — to the Recycle Bin, with path guards; if Windows can't recycle a file (in use, path too long, OneDrive placeholder), nothing is deleted and you're told why
- **Download watcher** — checks a watch folder every 30 seconds and files new downloads into your library
- **Root-level folder handling** — processes whole dropped folders

### UI & Customization
- **Command palette** (`Ctrl+K`) — views, actions and library items
- **Keyboard shortcuts** with a help sheet (`Shift+?`)
- **System tray** — minimize to tray instead of closing
- **Notification preferences** per category
- **Background Activity Center** — status and retry history for scans, imports, covers, sync, watcher and downloads
- **Performance mode** — less blur and motion for lower-power PCs or very large libraries
- **Accessible by default** — follows the Windows animation setting until you pick a Motion speed, readable secondary text in every theme, and dialogs that keep keyboard focus
- **Animated backgrounds** — ambient, orbs, particles or mesh, with intensity control
- **Right-click menus** on cards
- **GPT-6 Luna switch** — Settings → Tsumi → "Use GPT-6 Luna" moves Tsumi's chat and page translation to OpenAI's GPT-6 Luna at medium reasoning (same OpenRouter key)
- **Tsumi, the assistant** — chat about your library, powered by Claude Haiku 5.5 through OpenRouter with your own OpenRouter key (paid per use; low reasoning effort), with optional web search
- **Guided tour** — Tsumi shows you around the app, with a few "try it" steps; replay any part from Settings
- **Tsumi, the companion** — a little pile of unread books that hops around the window (it never blocks clicks), toggled from Settings → Tsumi

---

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- Windows 10 or 11, x64 or ARM64
- A video player for anime playback: [VLC](https://www.videolan.org/) or [MPV](https://mpv.io/installation/). If VLC is missing, the setup guide and Settings → Playback can install it for you through winget
- For manga (optional): a reader app such as [CDisplayEx](https://www.cdisplayex.com/) if you prefer it to the built-in reader, and [HaruNeko](https://github.com/manga-download/haruneko/releases) to download chapters

### Install & Run (Dev)
```bat
npm install
npm start
```

### Run the test suite
```bat
npm test
```
Seventeen suites (run on Windows and Ubuntu in CI) covering the IPC contract and CSP, search matching, MAL data and sync, state integrity, file safety and moves, library layout, playback and tracking, the renderer store, Tsumi's OpenRouter client, the manga reader (titles, renames, reading timer, EPUB/MOBI/PDF) and page translation. Details in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

---

## Build

| Script | Output | Description |
|--------|--------|-------------|
| `BUILD.bat` (x64) | `dist\Tsundoku-x64.exe` | **Portable** — single self-contained `.exe`, no install needed |
| `BUILD.bat` (ARM64) | `dist\win-arm64-unpacked\Tsundoku.exe` and `dist\Tsundoku-arm64.zip` | **Portable, native ARM64** — run `Tsundoku.exe` from the folder (or extract the zip anywhere) |
| `BUILD-INSTALLER.bat` | `dist\Tsundoku-Setup-<arch>.exe` | **Installer** — setup wizard with Start Menu shortcut and uninstaller |

The batch files wrap the `npm run build*` / `npm run build-installer*` scripts in `package.json`, where the electron-builder configuration lives (`build` key). `dist/` is build output and is excluded from packaging and version control.

**Which should I use?**
- **Personal use → Portable** (`BUILD.bat`). Drop anywhere and run. No registry entries. USB-friendly.
- **Sharing → Installer** (`BUILD-INSTALLER.bat`). Setup wizard, Program Files placement, Add/Remove Programs entry.

**Why is ARM64 a folder, not one `.exe`?** The single-file portable format starts the app through a small x86 launcher, which Windows on ARM runs emulated (and flags as such) for as long as the app is open. The folder/zip build is native ARM64 end to end.

**Coming from AnimeVault?** Your settings, library, MyAnimeList sign-in and assistant key carry over: on its first start Tsundoku moves `%APPDATA%\AnimeVault` to `%APPDATA%\Tsundoku` (or keeps using the old folder if it can't be moved). Delete the old `AnimeVault` build or shortcut afterwards. An installed copy updates in place, because the installer ID is unchanged.

**Is my OpenRouter key shared when I share the app?** No. Tsumi's key is entered once per PC (Settings → Tsumi) and stored encrypted with that Windows account in `%APPDATA%\Tsundoku`. It is not in the app files, `config.json`, backups or exports, and it survives updates and rebuilds. Anyone you share the app with adds their own key. Don't build a key into the app: anything inside an app can be extracted.

**Will the portable build work on another computer?**
Yes — it is self-contained (Electron runtime + Chromium + Node.js), fonts included. The recipient needs no Node.js, only a video player (VLC or MPV) for anime playback.

---

## Configuration

### First Launch
The setup guide walks you through theme, library folders, player and subtitles, the Bluetooth audio delay, download preferences, the MAL connection and Tsumi. Reopen it any time from Settings → Performance & window.

### MyAnimeList
1. Create an API app at [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig)
2. Set the redirect URI to `http://localhost:19876/callback`
3. Enter the Client ID in Settings → MyAnimeList
4. Click Connect and authorize

### Download Handling
Tsundoku finds the best Nyaa match, downloads the `.torrent` file and opens it with your torrent client. Magnet links are used when a torrent file isn't available.

### Notification Preferences
Settings → Notifications → toggle categories individually. Turning a category off only silences its toasts; the feature keeps working.

---

## Tech Stack
- **Electron** ^44 — desktop runtime
- **Plain HTML/CSS/JS** — no framework; the renderer is split into one script per area (`renderer/`), the main process into modules (`main/`)
- **pdf.js** — PDF pages in the built-in reader; **ONNX Runtime Web** — the translator's text detector ([comic-text-detector](https://github.com/dmMaze/comic-text-detector), downloaded on first use, GPL-3.0); **adm-zip** and **node-unrar-js** — comic archives
- **Figtree**, **Bricolage Grotesque** and **Comic Neue** (manga lettering) — bundled typefaces (SIL Open Font License)
- **MyAnimeList API v2** — anime/manga data and list sync
- **AniList GraphQL** — cover art and search
- **OpenRouter** — Tsumi (Claude Haiku 5.5) and page translation (Claude Haiku 5.5 or Sonnet 5.5)

## License
Personal use. The bundled fonts are under the SIL Open Font License (see `fonts/`).
