const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Dialogs
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFiles: (options) => ipcRenderer.invoke('select-files', options),

  // Environment
  getEnv: (key) => ipcRenderer.invoke('get-env', key),
  getBasePath: () => ipcRenderer.invoke('get-base-path'),

  // Portfolio operations
  getPortfolios: () => ipcRenderer.invoke('get-portfolios'),
  getPortfolioPhotos: (portfolioId) => ipcRenderer.invoke('get-portfolio-photos', portfolioId),
  softDeletePhotos: (data) => ipcRenderer.invoke('soft-delete-photos', data),
  archivePhotos: (data) => ipcRenderer.invoke('archive-photos', data),
  processIngest: (data) => ipcRenderer.invoke('process-ingest', data),

  // Photo analysis with dimension extraction
  analyzePhotos: (data) => ipcRenderer.invoke('analyze-photos', data),

  // Finalize ingest (resize, create gallery files)
  finalizeIngest: (data) => ipcRenderer.invoke('finalize-ingest', data),

  // Get compatible print sizes for an image
  getPrintSizes: (data) => ipcRenderer.invoke('get-print-sizes', data),

  // Metadata editing
  updatePhotoMetadata: (data) => ipcRenderer.invoke('update-photo-metadata', data),

  // Thumbnail generation
  getThumbnail: (filePath) => ipcRenderer.invoke('get-thumbnail', filePath),

  // Progress events
  onIngestProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('ingest-progress', handler);
    return () => ipcRenderer.removeListener('ingest-progress', handler);
  },

  // API key management
  getApiKeys: () => ipcRenderer.invoke('get-api-keys'),
  saveApiKey: (data) => ipcRenderer.invoke('save-api-key', data),
  testApiKey: (data) => ipcRenderer.invoke('test-api-key', data),

  // Test / Live mode management
  getMode: () => ipcRenderer.invoke('get-mode'),
  setMode: (mode) => ipcRenderer.invoke('set-mode', mode),
  getModeConfig: () => ipcRenderer.invoke('get-mode-config'),
  onModeChanged: (callback) => {
    const handler = (event, mode) => callback(mode);
    ipcRenderer.on('mode-changed', handler);
    return () => ipcRenderer.removeListener('mode-changed', handler);
  },

  // Website deploy
  deployWebsite: () => ipcRenderer.invoke('deploy-website'),
  checkDeployStatus: () => ipcRenderer.invoke('check-deploy-status'),
  onDeployProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('deploy-progress', handler);
    return () => ipcRenderer.removeListener('deploy-progress', handler);
  },

  // Platform info
  platform: process.platform
});
