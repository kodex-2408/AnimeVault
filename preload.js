const { contextBridge, ipcRenderer } = require('electron');

// ── Invoke helpers ──
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

// ── One-way event helpers ──
const on = (channel, cb) => {
  const handler = (_, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

// Batch A.7: safe preload init with diagnostic fallback
try {
contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => invoke('window:minimize'),
  maximize: () => invoke('window:maximize'),
  close: () => invoke('window:close'),
  setMinimizeToTray: (enabled) => invoke('window:setMinimizeToTray', enabled),

  // Config
  getConfig: () => invoke('config:get'),
  setConfig: (key, value) => invoke('config:set', key, value),
  setAllConfig: (cfg) => invoke('config:setAll', cfg),
  getUserDataPath: () => invoke('config:getUserDataPath'),
  setVaultMode: (mode) => invoke('config:setVaultMode', mode),

  // Dialogs
  openFolder: () => invoke('dialog:openFolder'),
  openFile: (filters) => invoke('dialog:openFile', filters),
  browseFolder: () => invoke('dialog:openFolder'),

  // Library
  scanLibrary: () => invoke('library:scan'),
  getEpisodes: (seriesPath) => invoke('library:getEpisodes', seriesPath),
  deleteSeries: (seriesPath) => invoke('library:deleteSeries', seriesPath),
  batchDeleteSeries: (paths) => invoke('library:batchDeleteSeries', paths),
  deleteEpisodeFile: (filePath) => invoke('library:deleteEpisodeFile', filePath),

  // Watch history
  getWatchHistory: (seriesName) => invoke('watch:getHistory', seriesName),
  markEpisode: (seriesName, episodeNum) => invoke('watch:markEpisode', seriesName, episodeNum),
  markUpTo: (seriesName, epNum, allEpNums) => invoke('watch:markUpTo', seriesName, epNum, allEpNums),
  unmarkFrom: (seriesName, epNum) => invoke('watch:unmarkFrom', seriesName, epNum),
  setEpisodesWatched: (seriesName, epList) => invoke('watch:setEpisodesWatched', seriesName, epList),
  setMalId: (seriesName, malId) => invoke('watch:setMalId', seriesName, malId),
  setMalData: (seriesName, malData) => invoke('watch:setMalData', seriesName, malData),

  // Player
  play: (filePath, seriesName, episodeNum) => invoke('player:play', filePath, seriesName, episodeNum),
  getBundledInfo: () => invoke('player:getBundledInfo'),

  // Shell
  openExternal: (url) => invoke('shell:openExternal', url),
  openFolder: (p) => invoke('shell:openFolder', p),
  nyaaOpenExternal: (title, quality, uploader, epNum) => invoke('nyaa:autoDownload', title, quality, uploader, epNum, 'ep'),

  // Cover cache
  getCoverDataUrl: (filePath) => invoke('cover:getDataUrl', filePath),

  // AniList
  anilistSearch: (title, count) => invoke('anilist:search', title, count),
  anilistFetchCover: (seriesName, url) => invoke('anilist:fetchCover', seriesName, url),
  anilistGetCachedCover: (name) => invoke('anilist:getCachedCover', name),
  anilistFetchAllCovers: (seriesList) => invoke('anilist:fetchAllCovers', seriesList),

  // MAL
  malIsAuthenticated: () => invoke('mal:isAuthenticated'),
  malGetAuthUrl: (clientId, clientSecret) => invoke('mal:getAuthUrl', clientId, clientSecret),
  malStartAuthServer: () => invoke('mal:startAuthServer'),
  malExchangeToken: (code) => invoke('mal:exchangeToken', code),
  malSearch: (query) => invoke('mal:search', query),
  malGetAnimeDetails: (malId) => invoke('mal:getAnimeDetails', malId),
  malUpdateStatus: (malId, numWatched, status) => invoke('mal:updateStatus', malId, numWatched, status),
  malAddOrUpdateListItem: (malId, fields) => invoke('mal:addOrUpdateListItem', malId, fields),
  malEditStatus: (malId, fields, seriesName) => invoke('mal:editStatus', malId, fields, seriesName),
  malDeleteEntry: (malId) => invoke('mal:deleteEntry', malId),
  malAutoSync: (seriesName) => invoke('mal:autoSync', seriesName),
  malBulkAutoSync: (seriesList) => invoke('mal:bulkAutoSync', seriesList),
  malUnlinkSeries: (seriesName) => invoke('mal:unlinkSeries', seriesName),
  malGetTopAnime: (limit, offset) => invoke('mal:getTopAnime', limit, offset),
  malGetSeasonal: (year, season) => invoke('mal:getSeasonal', year, season),
  malGetUserList: (status, limit, offset) => invoke('mal:getUserList', status, limit, offset),
  malGetSyncLog: () => invoke('mal:getSyncLog'),
  malClearSyncLog: () => invoke('mal:clearSyncLog'),

  // Nyaa
  nyaaSearch: (query) => invoke('nyaa:search', query),
  nyaaAutoDownload: (seriesTitle, quality, preferredUploader, epNum, mode) =>
    invoke('nyaa:autoDownload', seriesTitle, quality, preferredUploader, epNum, mode),
  autoDownloadLatestEpisode: (seriesName, malId) => invoke('autoDownload:latestEpisode', seriesName, malId),

  // Auto-download watchlist
  autoDownloadGetWatchlist: () => invoke('autoDownload:getWatchlist'),
  autoDownloadAddSeries: (entry) => invoke('autoDownload:addSeries', entry),
  autoDownloadRemoveSeries: (seriesName) => invoke('autoDownload:removeSeries', seriesName),
  autoDownloadUpdateSeries: (seriesName, updates) => invoke('autoDownload:updateSeries', seriesName, updates),
  autoDownloadToggle: (enabled) => invoke('autoDownload:toggle', enabled),
  autoDownloadGetStatus: () => invoke('autoDownload:getStatus'),
  autoDownloadSetPollMinutes: (mins) => invoke('autoDownload:setPollMinutes', mins),
  autoDownloadSetCriteria: (enabled) => invoke('autoDownload:setCriteria', enabled),
  autoDownloadPollNow: (force) => invoke('autoDownload:pollNow', force),

  // Downloads history
  downloadsGetHistory: () => invoke('downloads:getHistory'),
  downloadsClearHistory: () => invoke('downloads:clearHistory'),
  downloadsCheckRecent: (seriesTitle, epNum, dlMode) => invoke('downloads:checkRecent', seriesTitle, epNum, dlMode),

  // Manager / file management
  managerRename: (rootFolder, dryRun) => invoke('manager:rename', rootFolder, dryRun),
  managerGroup: (rootFolder, seasonalFolder, dryRun) => invoke('manager:group', rootFolder, seasonalFolder, dryRun),
  managerUngroup: (rootFolder, seasonalFolder, dryRun) => invoke('manager:ungroup', rootFolder, seasonalFolder, dryRun),
  managerBatch: (batchFolder, dryRun) => invoke('manager:batch', batchFolder, dryRun),
  managerFormat: (sourceFolder, destFolder) => invoke('manager:format', sourceFolder, destFolder),
  managerFormatFolder: (folderPath, newFolderName) => invoke('manager:formatFolder', folderPath, newFolderName),
  managerFormatManga: (folderPath, newFolderName) => invoke('manager:formatManga', folderPath, newFolderName),
  managerUndoFormat: () => invoke('manager:undoFormat'),
  managerHasUndo: () => invoke('manager:hasUndo'),

  // Manga
  openMangaFile: (filePath) => invoke('manga:openFile', filePath),
  detectMangaReaders: () => invoke('manga:detectReaders'),

  // Watcher
  watcherStart: (watchFolder, destFolder) => invoke('watcher:start', watchFolder, destFolder),
  watcherStop: () => invoke('watcher:stop'),
  watcherStatus: () => invoke('watcher:status'),
  watcherPollNow: () => invoke('watcher:pollNow'),
  watcherPlaceNewSeries: (item, destFolder) => invoke('watcher:placeNewSeries', item, destFolder),

  // Duplicates
  duplicateResolve: (data) => invoke('duplicate:resolve', data),
  duplicateModalClosed: () => ipcRenderer.send('duplicate:modalClosed'),

  // ── Event listeners (one-way from main → renderer) ──
  onNewFiles: (cb) => on('watcher:newFiles', cb),
  onAutoMark: (cb) => on('player:automark', cb),
  onAutoDownloadToast: (cb) => on('autoDownload:toast', cb),
  onAutoDownloadPollComplete: (cb) => on('autoDownload:pollComplete', cb),
  onDuplicateShowModal: (cb) => on('duplicate:showModal', cb),
  onDuplicateResolved: (cb) => on('duplicate:resolved', cb),

  // Batch A F1: Desktop notifications
  onAutoDownloadNotify: (cb) => on('autoDownload:notify', cb),

  // Batch C F10: Thumbnails
  extractThumbnail: (filePath, seriesName, episodeNum) => invoke('player:extractThumbnail', filePath, seriesName, episodeNum),
  onThumbnailReady: (cb) => on('thumb:ready', cb),

  // Batch C F9: Import/Export
  exportLibraryMetadata: () => invoke('library:exportMetadata'),
  exportLibraryCSV: () => invoke('library:exportCSV'),
  importAniList: (filePath) => invoke('library:importAniList', filePath),
  backupAppData: (destPath) => invoke('library:backup', destPath),
  restoreAppData: (zipPath) => invoke('library:restore', zipPath),
});
} catch (e) {
  console.error('[Preload] CRITICAL: Failed to expose api bridge:', e.message);
  // Inject a minimal api object so the renderer doesn't crash on undefined api.* calls
  contextBridge.exposeInMainWorld('api', {});
  contextBridge.exposeInMainWorld('__preloadError', e.message);
}
