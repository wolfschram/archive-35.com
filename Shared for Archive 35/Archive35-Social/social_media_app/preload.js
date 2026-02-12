const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  selectFolder: (title) => ipcRenderer.invoke('select-folder', title),

  // Platform definitions
  getPlatforms: () => ipcRenderer.invoke('get-platforms'),

  // Gallery
  scanGalleries: () => ipcRenderer.invoke('scan-galleries'),
  getPhotoThumbnail: (path) => ipcRenderer.invoke('get-photo-thumbnail', path),

  // Templates
  scanTemplates: () => ipcRenderer.invoke('scan-templates'),

  // Compositor
  compositeFrames: (opts) => ipcRenderer.invoke('composite-frames', opts),
  onCompositeProgress: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('composite-progress', handler);
    return () => ipcRenderer.removeListener('composite-progress', handler);
  },

  // Renderer
  renderVideo: (opts) => ipcRenderer.invoke('render-video', opts),
  renderAllPlatforms: (opts) => ipcRenderer.invoke('render-all-platforms', opts),
  onRenderProgress: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('render-progress', handler);
    return () => ipcRenderer.removeListener('render-progress', handler);
  },
  onMultiRenderStatus: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('multi-render-status', handler);
    return () => ipcRenderer.removeListener('multi-render-status', handler);
  },
  checkFfmpeg: () => ipcRenderer.invoke('check-ffmpeg'),

  // Post generation
  generatePostContent: (opts) => ipcRenderer.invoke('generate-post-content', opts),
  generateAllPostContent: (opts) => ipcRenderer.invoke('generate-all-post-content', opts),

  // Queue & History
  getRenderQueue: () => ipcRenderer.invoke('get-render-queue'),
  saveRenderQueue: (data) => ipcRenderer.invoke('save-render-queue', data),
  getPostHistory: () => ipcRenderer.invoke('get-post-history'),
  savePostHistory: (data) => ipcRenderer.invoke('save-post-history', data),

  // Outputs
  listOutputs: () => ipcRenderer.invoke('list-outputs'),
  openInFinder: (path) => ipcRenderer.invoke('open-in-finder', path),

  // Handshake
  writeHeartbeat: () => ipcRenderer.invoke('write-heartbeat'),
  readStudioStatus: () => ipcRenderer.invoke('read-studio-status'),
  readGalleryQueue: () => ipcRenderer.invoke('read-gallery-queue'),

  // Gallery rotation
  getNextGallery: () => ipcRenderer.invoke('get-next-gallery'),

  // Schedule
  getScheduleLog: () => ipcRenderer.invoke('get-schedule-log'),
});
