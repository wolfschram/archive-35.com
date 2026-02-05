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

  // Platform info
  platform: process.platform
});
