const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Dialogs
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFiles: (options) => ipcRenderer.invoke('select-files', options),

  // Environment
  getEnv: (key) => ipcRenderer.invoke('get-env', key),
  getBasePath: () => ipcRenderer.invoke('get-base-path'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

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

  // Portfolio rename
  renamePortfolio: (data) => ipcRenderer.invoke('rename-portfolio', data),

  // Portfolio delete
  deletePortfolio: (data) => ipcRenderer.invoke('delete-portfolio', data),

  // Metadata editing
  updatePhotoMetadata: (data) => ipcRenderer.invoke('update-photo-metadata', data),

  // Replace photo with new image
  replacePhoto: (data) => ipcRenderer.invoke('replace-photo', data),

  // Photo/portfolio reordering
  reorderPhotos: (data) => ipcRenderer.invoke('reorder-photos', data),
  getPortfolioOrder: () => ipcRenderer.invoke('get-portfolio-order'),
  savePortfolioOrder: (data) => ipcRenderer.invoke('save-portfolio-order', data),

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
  onModeDeployProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('mode-deploy-progress', handler);
    return () => ipcRenderer.removeListener('mode-deploy-progress', handler);
  },

  // Website deploy
  deployWebsite: () => ipcRenderer.invoke('deploy-website'),
  checkDeployStatus: () => ipcRenderer.invoke('check-deploy-status'),
  onDeployProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('deploy-progress', handler);
    return () => ipcRenderer.removeListener('deploy-progress', handler);
  },

  // Auto-scan Photography folder
  scanPhotography: () => ipcRenderer.invoke('scan-photography'),
  onScanProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('scan-progress', handler);
    return () => ipcRenderer.removeListener('scan-progress', handler);
  },

  // Service status checks
  checkServiceStatus: (service) => ipcRenderer.invoke('check-service-status', service),
  checkAllServices: () => ipcRenderer.invoke('check-all-services'),

  // Google Analytics
  getAnalyticsConfig: () => ipcRenderer.invoke('get-analytics-config'),
  getAnalyticsData: () => ipcRenderer.invoke('get-analytics-data'),

  // Stripe Promotion Code Management
  stripeListCoupons: () => ipcRenderer.invoke('stripe-list-coupons'),
  stripeCreateCoupon: (data) => ipcRenderer.invoke('stripe-create-coupon', data),
  stripeDeleteCoupon: (couponId) => ipcRenderer.invoke('stripe-delete-coupon', couponId),
  stripeListPromoCodes: () => ipcRenderer.invoke('stripe-list-promo-codes'),
  stripeCreatePromoCode: (data) => ipcRenderer.invoke('stripe-create-promo-code', data),
  stripeDeactivatePromoCode: (promoId) => ipcRenderer.invoke('stripe-deactivate-promo-code', promoId),

  // Folder Sync (iCloud / one-way)
  getSyncConfig: () => ipcRenderer.invoke('get-sync-config'),
  saveSyncConfig: (data) => ipcRenderer.invoke('save-sync-config', data),
  runFolderSync: (data) => ipcRenderer.invoke('run-folder-sync', data),
  onSyncProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('sync-progress', handler);
    return () => ipcRenderer.removeListener('sync-progress', handler);
  },

  // Cross-page events — ingest completion triggers WebsiteControl refresh
  onIngestComplete: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('ingest-complete', handler);
    return () => ipcRenderer.removeListener('ingest-complete', handler);
  },

  // R2 Batch Upload (backfill originals)
  batchUploadR2: () => ipcRenderer.invoke('batch-upload-r2'),
  onR2UploadProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('r2-upload-progress', handler);
    return () => ipcRenderer.removeListener('r2-upload-progress', handler);
  },

  // Stripe-to-Sheet Reconciliation
  reconcileStripeOrders: (opts) => ipcRenderer.invoke('reconcile-stripe-orders', opts),

  // About Page Editor
  loadAboutContent: () => ipcRenderer.invoke('load-about-content'),
  saveAboutContent: (data) => ipcRenderer.invoke('save-about-content', data),
  selectAboutPhoto: () => ipcRenderer.invoke('select-about-photo'),
  onAboutDeployProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('about-deploy-progress', handler);
    return () => ipcRenderer.removeListener('about-deploy-progress', handler);
  },

  // Licensing Manager: file I/O and command execution
  readFile: (relativePath) => ipcRenderer.invoke('read-file', relativePath),
  writeFile: (relativePath, data) => ipcRenderer.invoke('write-file', relativePath, data),
  runCommand: (command) => ipcRenderer.invoke('run-command', command),

  // Platform info
  platform: process.platform
});
