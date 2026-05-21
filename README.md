# AnimeVault

A personal desktop anime & manga library manager built with Electron. Organize your local collection, track watch/read progress, explore new titles, download via Nyaa.si, and sync with MyAnimeList — all in one app.

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
- **16 built-in themes** + accent color picker, font selector, and animation speed control
- **Category filters** with custom folder organization (Series, Seasonal, Movies, etc.)
- **Continue Watching** row sorted by recency
- **Duplicate file detection** with codec/size comparison and auto-resolution
- **Library Health Check** — scans for missing episodes, duplicates, and orphaned files

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

### Downloads & Nyaa
- **Smart split-button** on every series — quick default or granular options:
  - **Latest Episode** — targets next aired episode using preferred uploader
  - **Entire Series** — broad search ordered by seed count
  - **Browse on Nyaa.si** — open browser search
- **Auto-Download** for airing series — polls Nyaa periodically for new episodes
- **HEVC/x265 priority** — codec-aware scoring with size awareness to avoid bloated releases
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
- **Liquid-glass styling** — backdrop-filter blur, accent glows, and shimmer effects
- **Animated backgrounds** — particles, liquid orbs, or mesh gradient with intensity control
- **Right-click context menus** on cards with status shortcuts, cover change, and file actions

---

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- Windows 10 x64 or newer

### Bundled Binaries
Place the following in a `bin/` folder at the project root before building:
- `mpv.exe` — from [mpv.io](https://mpv.io/installation/) (Windows x64 LGPL build)
- `aria2c.exe` — from [aria2 releases](https://github.com/aria2/aria2/releases) (optional, for Built-in download mode)
- Any required `.dll` files alongside `mpv.exe`

These are automatically bundled into the output via `extraResources`.

### Install & Run (Dev)
```bat
npm install
npm start
```

---

## Build

| Script | Output | Description |
|--------|--------|-------------|
| `BUILD.bat` | `dist\AnimeVault-x64.exe` | **Portable** — single self-contained `.exe`, no install needed |
| `BUILD-INSTALLER.bat` | `dist\AnimeVault-Setup-x64.exe` | **Installer** — setup wizard with Start Menu shortcut and uninstaller |

**Which should I use?**
- **Personal use → Portable** (`BUILD.bat`). Drop anywhere and run. No registry entries. USB-friendly.
- **Sharing → Installer** (`BUILD-INSTALLER.bat`). Familiar setup wizard, Program Files placement, Add/Remove Programs entry.

**Will a standalone `.exe` work on another computer?**
Yes — the portable `.exe` is fully self-contained (Electron runtime + Chromium + Node.js + bundled MPV/aria2c). The recipient needs no dependencies. Just double-click and run.

---

## Configuration

### First Launch
The setup wizard guides you through: theme, library folders, player choice, subtitle language, Nyaa uploader preference, and MAL connection.

### MyAnimeList
1. Create an API app at [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig)
2. Set redirect URI to `http://localhost:19876/callback`
3. Enter Client ID in Settings → MyAnimeList
4. Click Connect and authorize

### Download Mode
Settings → Nyaa Downloads → Download Mode:
- **External Client** (default): finds best Nyaa match, downloads `.torrent`, opens with system torrent client
- **Built-in (aria2c)**: uses bundled aria2c (requires `bin/aria2c.exe`)

### Notification Preferences
Settings → Notifications → toggle categories individually. All toasts respect these preferences without disabling the underlying feature.

---

## Tech Stack
- **Electron** ^33 — desktop runtime
- **Vanilla HTML/CSS/JS** — single-file UI, no frameworks
- **MPV** — bundled video player (x64 LGPL build)
- **aria2c** — optional bundled torrent client (JSON-RPC)
- **MyAnimeList API v2** — anime/manga data and list sync
- **AniList GraphQL** — cover art and search

## License
Personal use.
