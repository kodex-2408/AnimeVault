'use strict';

// main/state.js - the user settings object and the runtime handles that
// several main-process modules share (window, tray, library cache).

const path = require('path');

// The app's root folder (index.html, preload.js, icon.png, bin/).
const APP_ROOT = path.join(__dirname, '..');

// Runtime handles shared by several modules. Read and assign them as
// state.mainWindow etc.; a module never keeps its own copy.
const state = {
  mainWindow: null,
  tray: null,
  isQuitting: false,
  // Shared library cache for cross-module access
  lastLibraryScan: [],
  libraryScanReady: false, // true once the first scan has populated the cache
};

// User settings. Loaded in place by config/config.js loadConfig(), so every
// module can hold this object directly.
const config = {
  // Folders: array of { path, label, type:'seasonal'|'movies'|'series'|'custom' }
  folders: [],
  vlcPath: 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
  malClientId: '',
  malClientSecret: '',
  malAccessToken: '',
  malRefreshToken: '',
  malTokenExpiry: 0,
  malCodeVerifier: '',
  watchHistory: {},
  // Theme
  theme: 'dark',
  fullTheme: 'pearl',
  accentColor: '#c0792a',
  themeAccents: {},
  customThemeColors: {},
  fontFamily: 'Segoe UI',
  themePreset: 'default',
  // Auto-mark
  autoMarkEnabled: true,
  autoMarkPercent: 80,
  // Vault mode: 'anime' or 'manga'
  vaultMode: 'anime',
  // Manga folders (separate from anime folders)
  mangaFolders: [],
  mangaWatchHistory: {},
  // Manga reader path (empty = system default for .cbz/.cbr)
  readerPath: '',
  // Manga preferred uploaders on Nyaa
  mangaUploaders: ['LuCaZ','Danke','Leviatan'],
  forceHevc: true, // Strongly prefer HEVC/x265 over H.264/x264
  // Auto-download watchlist for airing series
  autoDownloadWatchlist: [],
  autoDownloadCriteria: false, // deprecated compatibility key; explicit tracking only
  autoDownloadPollMinutes: 60,
  autoDownloadEnabled: false,
  minimizeToTray: false,
  desktopNotifications: true,
  watcherIgnorePatterns: [],
  searchPresets: [],
  performanceMode: false,
  incrementalScan: true,
  titleAliases: { anime: {}, manga: {} },
  gapRules: { anime: {}, manga: {} },
  animeImportInbox: [],
  mangaImportInbox: [],
  activityLog: [],
  openRouterApiKey: '',
  lumaModel: 'anthropic/claude-haiku-5.5',
  autoDownloadBatchLimit: 0,
};

module.exports = { APP_ROOT, state, config };
