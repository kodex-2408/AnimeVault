# AnimeVault

A personal desktop anime & manga library manager built with Electron. Organize your local anime and manga collection, track watch/read progress, explore new titles, download via Nyaa.si, and sync with MyAnimeList — all in one app.

## MangaVault Mode

AnimeVault includes a built-in **MangaVault** mode, toggled via the Anime/Manga pill in the titlebar. Switching modes:

- Swaps to your **manga library folders** and separate read history
- Routes all MAL API calls to `/manga/` endpoints (chapters instead of episodes)
- Searches Nyaa using the **English-translated manga** category (`c=3_1`)
- Changes all UI labels: Ep→Ch, Watching→Reading, Plan to Watch→Plan to Read
- Shows **manga source shortcuts** in the Explore tab (MangaDex, MangaFire, MangaReader, etc.)
- Opens `.cbz`/`.cbr` files with your configured reader (OpenComic, CDisplayEx, SumatraPDF, or system default)

Anime and manga data are fully isolated — separate folders, watch/read histories, and MAL list endpoints.

---

## MangaVault Mode

AnimeVault doubles as a manga library manager. Toggle the **Anime / Manga** pill in the titlebar to switch modes:

- **Separate libraries**: Anime and manga folders are managed independently
- **MAL manga sync**: All API calls switch to manga endpoints — chapters read, manga list, manga details
- **File support**: Scans `.cbz`, `.cbr`, `.zip`, `.pdf` files; parses chapter numbers from filenames
- **Reader integration**: Opens manga files with your system default reader (OpenComic, CDisplayEx, SumatraPDF, etc.) or a configured reader path
- **Nyaa manga**: Searches Nyaa category `c=3_1` (English-translated manga/literature)
- **Source shortcuts**: Quick-access buttons to MangaDex, MangaFire, MangaReader, Nyaa, MangaSee, ComicK
- **Smart labels**: All UI labels adapt — Ep → Ch, Watching → Reading, Plan to Watch → Plan to Read

---

## Features

### Collection
- Auto-scan library folders and display anime with cover art
- Netflix-style UI with hero banners and animated card grid
- 16 built-in themes + accent color picker and animation speed control
- MAL status and category filters (Watching, Completed, Plan to Watch, On Hold, Dropped)

### Explore
- Browse MAL top anime rankings and current seasonal anime
- Live search with instant results and cover previews
- Clickable cards with synopsis, stats, genres, and streaming links

### My List
- Full MAL library with grid and list views
- Smart progress bars: accent = watched, blue = aired-but-unwatched
- Broadcast schedule for airing series (Mexico City timezone)
- Sorting by title, score, progress + genre filtering

### Downloads
- **Split Download button** on every series detail — click for smart default, arrow (▾) for options:
  - **Latest Episode** — targets the latest *aired* episode (not just watched+1); uses preferred uploader for airing series
  - **Entire Series** — broad eng sub search ordered by seed count
  - **Batch / Season Pack** — tries batch, complete, S01, Season 1, Blu-ray, BD naming variants
  - **Browse on Nyaa.si** — opens browser search
- **Download Mode**: External Client (default) opens `.torrent` in qBittorrent/etc.; Built-in uses bundled aria2c
- Configure preferred uploader (Erai-raws, SubsPlease, Judas, VARYG) and quality (1080p/720p/480p) in Settings

### Playback (Bundled MPV)
- MPV bundled — no external player installation required
- VLC and custom MPV paths supported as alternatives
- Auto-mark episodes at configurable % (default 80%)
- Subtitle language injection (primary + fallback)
- Optional −300ms audio offset for Bluetooth headphone latency

### Watch Progress & MAL Sync
- MyAnimeList OAuth2 integration
- Sequential checkbox logic for episode tracking
- Sync pause toggle in the status bar

### File Management
- Format, rename, group, and batch-process video files
- Rename-in-folder tool for files lacking series name
- Undo formatting, smart destination matching
- Delete series (individual + batch)
- Download watcher with 5-minute polling

---

## Build Outputs

| Script | Output | Description |
|--------|--------|-------------|
| `BUILD.bat` | `dist\AnimeVault-x64.exe` | **Portable** — single self-contained `.exe`, no install needed |
| `BUILD-INSTALLER.bat` | `dist\AnimeVault-Setup-x64.exe` | **Installer** — setup wizard that installs to Program Files, adds Start Menu shortcut and uninstaller |

**Which should I use?**

- **Personal use → Portable** (`BUILD.bat`). Drop the `.exe` anywhere, run it, done. No registry entries. Carry it on a USB drive if you want.
- **Sharing → Installer** (`BUILD-INSTALLER.bat`). Gives the recipient a familiar setup wizard, places the app in Program Files, and creates an uninstaller in Add/Remove Programs.

**Will a standalone `.exe` work on another computer?**

Yes — the portable `.exe` is fully self-contained (Electron runtime + Chromium + Node.js + your bundled MPV/aria2c are all packed inside). The recipient needs no Node.js, no runtime, no dependencies. They just double-click and run. The only requirement is **Windows 10 x64 or newer** (if you built for x64).

---

## Setup

### Prerequisites
- [Node.js](https://nodejs.org/) v18+

### Bundled Binaries
Place the following in a `bin/` folder at the project root before building:
- `mpv.exe` — from [mpv.io](https://mpv.io/installation/) (Windows x64 LGPL build)
- `aria2c.exe` — from [aria2 releases](https://github.com/aria2/aria2/releases) (optional, only needed for Built-in download mode)
- Any required `.dll` files alongside `mpv.exe`

These are automatically bundled into the output via `extraResources`.

### Install & Run (Dev)
```bat
npm install
npm start
```

### Build Portable .exe
Run `BUILD.bat` and select your architecture. Output: `dist\AnimeVault-x64.exe`

### Build Installer
Run `BUILD-INSTALLER.bat`. Output: `dist\AnimeVault-Setup-x64.exe`

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

---

## Tech Stack
- **Electron** ^33 — desktop runtime
- **Vanilla HTML/CSS/JS** — single-file UI, no frameworks
- **MPV** — bundled video player (x64 LGPL build)
- **aria2c** — optional bundled torrent client (JSON-RPC)
- **MyAnimeList API v2** — anime data and list sync
- **AniList GraphQL** — cover art and search

## License
Personal use.
