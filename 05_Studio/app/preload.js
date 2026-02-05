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

  // Platform info
  platform: process.platform
});
