const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const isDev = require('electron-is-dev');

// Load environment variables
require('dotenv').config({
  path: path.join(__dirname, '..', '..', '.env')
});

// Base path for Archive-35 folder
const ARCHIVE_BASE = path.join(__dirname, '..', '..');
const PORTFOLIO_DIR = path.join(ARCHIVE_BASE, '01_Portfolio');
const DELETE_DIR = path.join(ARCHIVE_BASE, '_files_to_delete');
const ARCHIVE_DIR = path.join(ARCHIVE_BASE, '_archived');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the app
  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, 'build', 'index.html')}`;

  mainWindow.loadURL(startUrl);

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// ===================
// IPC HANDLERS
// ===================

// Select folder dialog
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0] || null;
});

// Select files dialog
ipcMain.handle('select-files', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'tiff', 'tif', 'png'] }
    ],
    ...options
  });
  return result.filePaths || [];
});

// Get environment variable
ipcMain.handle('get-env', (event, key) => {
  return process.env[key] || null;
});

// Get base path
ipcMain.handle('get-base-path', () => {
  return path.join(__dirname, '..', '..');
});

// ===================
// PORTFOLIO HANDLERS
// ===================

// Get all portfolios from 01_Portfolio folder
ipcMain.handle('get-portfolios', async () => {
  try {
    const entries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
    const portfolios = [];

    for (const entry of entries) {
      // Skip hidden folders and non-directories
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) {
        continue;
      }

      const portfolioPath = path.join(PORTFOLIO_DIR, entry.name);
      let photoCount = 0;
      let location = '';

      // Try to read _gallery.json for metadata
      const galleryJsonPath = path.join(portfolioPath, '_gallery.json');
      try {
        if (fsSync.existsSync(galleryJsonPath)) {
          const galleryData = JSON.parse(await fs.readFile(galleryJsonPath, 'utf8'));
          location = galleryData.location || '';
        }
      } catch (err) {
        // Ignore JSON parse errors
      }

      // Count photos in originals/ or web/ subfolder
      const originalsPath = path.join(portfolioPath, 'originals');
      const webPath = path.join(portfolioPath, 'web');

      try {
        if (fsSync.existsSync(originalsPath)) {
          const files = await fs.readdir(originalsPath);
          photoCount = files.filter(f => /\.(jpg|jpeg|tiff|tif|png)$/i.test(f)).length;
        } else if (fsSync.existsSync(webPath)) {
          const files = await fs.readdir(webPath);
          photoCount = files.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f)).length;
        }
      } catch (err) {
        // Ignore read errors
      }

      portfolios.push({
        id: entry.name.toLowerCase().replace(/\s+/g, '_'),
        name: entry.name.replace(/_/g, ' '),
        folderName: entry.name,
        photoCount,
        location
      });
    }

    return portfolios;
  } catch (err) {
    console.error('Failed to get portfolios:', err);
    return [];
  }
});

// Get photos for a specific portfolio
ipcMain.handle('get-portfolio-photos', async (event, portfolioId) => {
  try {
    // Find the folder matching the portfolio ID
    const entries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
    const portfolioFolder = entries.find(e =>
      e.isDirectory() && e.name.toLowerCase().replace(/\s+/g, '_') === portfolioId
    );

    if (!portfolioFolder) {
      return [];
    }

    const portfolioPath = path.join(PORTFOLIO_DIR, portfolioFolder.name);
    const photosJsonPath = path.join(portfolioPath, '_photos.json');
    const originalsPath = path.join(portfolioPath, 'originals');
    const webPath = path.join(portfolioPath, 'web');

    const photos = [];

    // Try to read _photos.json for metadata
    let photoMetadata = {};
    try {
      if (fsSync.existsSync(photosJsonPath)) {
        const data = JSON.parse(await fs.readFile(photosJsonPath, 'utf8'));
        if (Array.isArray(data)) {
          data.forEach(p => { photoMetadata[p.filename] = p; });
        }
      }
    } catch (err) {
      // Ignore JSON errors
    }

    // Read photos from originals folder
    const sourcePath = fsSync.existsSync(originalsPath) ? originalsPath : webPath;
    if (fsSync.existsSync(sourcePath)) {
      const files = await fs.readdir(sourcePath);
      const imageFiles = files.filter(f => /\.(jpg|jpeg|tiff|tif|png|webp)$/i.test(f));

      for (const filename of imageFiles) {
        const meta = photoMetadata[filename] || {};
        photos.push({
          id: filename.replace(/\.[^.]+$/, '').toLowerCase().replace(/\s+/g, '_'),
          filename,
          title: meta.title || filename.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
          inWebsite: meta.inWebsite ?? true,
          inArtelo: meta.inArtelo ?? false,
          inSocialQueue: meta.inSocialQueue ?? false
        });
      }
    }

    return photos;
  } catch (err) {
    console.error('Failed to get portfolio photos:', err);
    return [];
  }
});

// Soft delete photos (move to _files_to_delete)
ipcMain.handle('soft-delete-photos', async (event, { portfolioId, photoIds }) => {
  try {
    // Ensure _files_to_delete folder exists
    await fs.mkdir(DELETE_DIR, { recursive: true });

    // Find the portfolio folder
    const entries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
    const portfolioFolder = entries.find(e =>
      e.isDirectory() && e.name.toLowerCase().replace(/\s+/g, '_') === portfolioId
    );

    if (!portfolioFolder) {
      return { success: false, error: 'Portfolio not found' };
    }

    const portfolioPath = path.join(PORTFOLIO_DIR, portfolioFolder.name);
    const originalsPath = path.join(portfolioPath, 'originals');
    const webPath = path.join(portfolioPath, 'web');
    const thumbsPath = path.join(portfolioPath, 'thumbs');

    const movedFiles = [];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const deleteBatchDir = path.join(DELETE_DIR, `${portfolioFolder.name}_${timestamp}`);
    await fs.mkdir(deleteBatchDir, { recursive: true });

    // Get all photos in portfolio to match IDs to filenames
    const photos = await ipcMain.handle('get-portfolio-photos', event, portfolioId);
    const photosToDelete = photos.filter(p => photoIds.includes(p.id));

    for (const photo of photosToDelete) {
      // Move from originals/
      const origPath = path.join(originalsPath, photo.filename);
      if (fsSync.existsSync(origPath)) {
        await fs.rename(origPath, path.join(deleteBatchDir, photo.filename));
        movedFiles.push(photo.filename);
      }

      // Move web versions (try various extensions)
      const webName = photo.filename.replace(/\.[^.]+$/, '');
      for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
        const webFile = path.join(webPath, webName + ext);
        if (fsSync.existsSync(webFile)) {
          await fs.rename(webFile, path.join(deleteBatchDir, webName + ext));
        }
        // Also check thumbs
        const thumbFile = path.join(thumbsPath, webName + ext);
        if (fsSync.existsSync(thumbFile)) {
          await fs.rename(thumbFile, path.join(deleteBatchDir, 'thumb_' + webName + ext));
        }
      }

      // TODO: Update _photos.json, website JSON, Artelo queue, social queue
    }

    return { success: true, movedFiles };
  } catch (err) {
    console.error('Soft delete failed:', err);
    return { success: false, error: err.message };
  }
});

// Archive photos (move to _archived, preserve metadata)
ipcMain.handle('archive-photos', async (event, { portfolioId, photoIds }) => {
  try {
    // Ensure _archived folder exists
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });

    // Similar logic to soft-delete but preserve metadata
    const entries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
    const portfolioFolder = entries.find(e =>
      e.isDirectory() && e.name.toLowerCase().replace(/\s+/g, '_') === portfolioId
    );

    if (!portfolioFolder) {
      return { success: false, error: 'Portfolio not found' };
    }

    const portfolioPath = path.join(PORTFOLIO_DIR, portfolioFolder.name);
    const originalsPath = path.join(portfolioPath, 'originals');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveBatchDir = path.join(ARCHIVE_DIR, `${portfolioFolder.name}_${timestamp}`);
    await fs.mkdir(archiveBatchDir, { recursive: true });

    const photos = await ipcMain.handle('get-portfolio-photos', event, portfolioId);
    const photosToArchive = photos.filter(p => photoIds.includes(p.id));
    const archivedFiles = [];

    for (const photo of photosToArchive) {
      const origPath = path.join(originalsPath, photo.filename);
      if (fsSync.existsSync(origPath)) {
        await fs.rename(origPath, path.join(archiveBatchDir, photo.filename));
        archivedFiles.push(photo.filename);
      }
    }

    // Save metadata alongside archived files
    await fs.writeFile(
      path.join(archiveBatchDir, '_metadata.json'),
      JSON.stringify({ archivedAt: new Date().toISOString(), photos: photosToArchive }, null, 2)
    );

    return { success: true, archivedFiles };
  } catch (err) {
    console.error('Archive failed:', err);
    return { success: false, error: err.message };
  }
});

// Process ingest (placeholder - actual processing logic TBD)
ipcMain.handle('process-ingest', async (event, { files, mode, portfolioId, newGallery }) => {
  try {
    // TODO: Implement actual processing:
    // 1. Extract EXIF metadata
    // 2. Generate AI descriptions (via API)
    // 3. Resize for web
    // 4. Create/update gallery files

    console.log('Processing ingest:', { files: files.length, mode, portfolioId, newGallery });

    // For now, just return success
    return { success: true };
  } catch (err) {
    console.error('Process ingest failed:', err);
    return { success: false, error: err.message };
  }
});
