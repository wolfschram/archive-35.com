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

// Helper to format location (handles both string and object formats)
function formatLocation(location) {
  if (!location) return '';
  if (typeof location === 'string') return location;
  if (typeof location === 'object') {
    const parts = [location.place, location.region, location.country].filter(Boolean);
    return parts.join(', ');
  }
  return String(location);
}

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
          // FIX: Format location object to string
          location = formatLocation(galleryData.location);
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
          description: meta.description || '',
          location: formatLocation(meta.location) || '',
          tags: meta.tags || [],
          timeOfDay: meta.timeOfDay || '',
          dimensions: meta.dimensions || null,
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
    const allPhotos = await fs.readdir(originalsPath).catch(() => []);
    const photosToDelete = allPhotos.filter(f => {
      const id = f.replace(/\.[^.]+$/, '').toLowerCase().replace(/\s+/g, '_');
      return photoIds.includes(id);
    });

    for (const filename of photosToDelete) {
      // Move from originals/
      const origPath = path.join(originalsPath, filename);
      if (fsSync.existsSync(origPath)) {
        await fs.rename(origPath, path.join(deleteBatchDir, filename));
        movedFiles.push(filename);
      }

      // Move web versions (try various extensions)
      const webName = filename.replace(/\.[^.]+$/, '');
      for (const suffix of ['-full.jpg', '-thumb.jpg', '.jpg', '.jpeg', '.png', '.webp']) {
        const webFile = path.join(webPath, webName + suffix);
        if (fsSync.existsSync(webFile)) {
          await fs.rename(webFile, path.join(deleteBatchDir, webName + suffix));
        }
      }
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

    const allPhotos = await fs.readdir(originalsPath).catch(() => []);
    const photosToArchive = allPhotos.filter(f => {
      const id = f.replace(/\.[^.]+$/, '').toLowerCase().replace(/\s+/g, '_');
      return photoIds.includes(id);
    });
    const archivedFiles = [];

    for (const filename of photosToArchive) {
      const origPath = path.join(originalsPath, filename);
      if (fsSync.existsSync(origPath)) {
        await fs.rename(origPath, path.join(archiveBatchDir, filename));
        archivedFiles.push(filename);
      }
    }

    // Save metadata alongside archived files
    await fs.writeFile(
      path.join(archiveBatchDir, '_metadata.json'),
      JSON.stringify({ archivedAt: new Date().toISOString(), files: archivedFiles }, null, 2)
    );

    return { success: true, archivedFiles };
  } catch (err) {
    console.error('Archive failed:', err);
    return { success: false, error: err.message };
  }
});

// ===================
// PHOTO ANALYSIS HANDLERS
// ===================

// Analyze photos - extract EXIF, dimensions, and prepare for AI descriptions
ipcMain.handle('analyze-photos', async (event, { files }) => {
  try {
    const sharp = require('sharp');
    let exiftool = null;

    // Try to use exiftool if available
    try {
      const ExifTool = require('exiftool-vendored').ExifTool;
      exiftool = new ExifTool();
    } catch (err) {
      console.warn('ExifTool not available, using sharp only');
    }

    const results = [];

    for (const filePath of files) {
      try {
        // Get image dimensions using Sharp
        const metadata = await sharp(filePath).metadata();

        // Calculate aspect ratio
        const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
        const divisor = gcd(metadata.width, metadata.height);
        const aspectRatioW = metadata.width / divisor;
        const aspectRatioH = metadata.height / divisor;
        const aspectRatio = metadata.width / metadata.height;

        // Determine orientation category
        let orientation = 'landscape';
        if (aspectRatio < 0.95) orientation = 'portrait';
        else if (aspectRatio >= 0.95 && aspectRatio <= 1.05) orientation = 'square';
        else if (aspectRatio > 2.0) orientation = 'panorama';
        else if (aspectRatio > 1.5) orientation = 'wide';

        // Get EXIF data if exiftool available
        let exifData = {};
        if (exiftool) {
          try {
            exifData = await exiftool.read(filePath);
          } catch (exifErr) {
            console.warn('EXIF read failed for', filePath);
          }
        }

        const filename = path.basename(filePath);

        results.push({
          id: filename.replace(/\.[^.]+$/, '').toLowerCase().replace(/\s+/g, '_'),
          filename,
          path: filePath,

          // Image dimensions (CRITICAL for print sizing!)
          dimensions: {
            width: metadata.width,
            height: metadata.height,
            aspectRatio: parseFloat(aspectRatio.toFixed(3)),
            aspectRatioString: `${aspectRatioW}:${aspectRatioH}`,
            orientation,
            megapixels: parseFloat(((metadata.width * metadata.height) / 1000000).toFixed(1))
          },

          // EXIF metadata
          exif: {
            camera: exifData.Model || null,
            lens: exifData.LensModel || exifData.Lens || null,
            focalLength: exifData.FocalLength || null,
            aperture: exifData.FNumber || exifData.Aperture || null,
            shutterSpeed: exifData.ExposureTime || exifData.ShutterSpeed || null,
            iso: exifData.ISO || null,
            dateTaken: exifData.DateTimeOriginal || exifData.CreateDate || null,
            gps: exifData.GPSLatitude && exifData.GPSLongitude ? {
              lat: exifData.GPSLatitude,
              lng: exifData.GPSLongitude
            } : null
          },

          // Placeholders for AI-generated content
          title: '',
          description: '',
          location: '',
          tags: [],
          timeOfDay: 'unknown',

          // Processing state
          approved: false
        });

      } catch (err) {
        console.error('Failed to analyze', filePath, err);
        results.push({
          filename: path.basename(filePath),
          path: filePath,
          error: err.message
        });
      }
    }

    if (exiftool) {
      await exiftool.end();
    }

    return { success: true, photos: results };

  } catch (err) {
    console.error('analyze-photos failed:', err);
    return { success: false, error: err.message };
  }
});

// Finalize ingest - resize for web, create gallery files
ipcMain.handle('finalize-ingest', async (event, { photos, mode, portfolioId, newGallery }) => {
  try {
    const sharp = require('sharp');

    // Determine target portfolio folder
    let targetFolder;
    if (mode === 'existing' && portfolioId) {
      const entries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
      const portfolio = entries.find(e =>
        e.isDirectory() && e.name.toLowerCase().replace(/\s+/g, '_') === portfolioId
      );
      if (!portfolio) {
        return { success: false, error: 'Portfolio not found' };
      }
      targetFolder = path.join(PORTFOLIO_DIR, portfolio.name);
    } else if (mode === 'new' && newGallery) {
      // Create new portfolio folder
      const folderName = newGallery.name.replace(/\s+/g, '_');
      targetFolder = path.join(PORTFOLIO_DIR, folderName);
      await fs.mkdir(targetFolder, { recursive: true });
      await fs.mkdir(path.join(targetFolder, 'originals'), { recursive: true });
      await fs.mkdir(path.join(targetFolder, 'web'), { recursive: true });

      // Create _gallery.json
      const galleryJson = {
        id: folderName.toLowerCase(),
        title: newGallery.name,
        slug: folderName.toLowerCase(),
        status: 'draft',
        dates: {
          shot_start: newGallery.dateRange || null,
          published: null
        },
        location: {
          country: '',
          region: '',
          place: newGallery.location || '',
          coordinates: null
        },
        photo_count: photos.length
      };
      await fs.writeFile(
        path.join(targetFolder, '_gallery.json'),
        JSON.stringify(galleryJson, null, 2)
      );
    } else {
      return { success: false, error: 'Invalid mode or missing gallery info' };
    }

    const originalsFolder = path.join(targetFolder, 'originals');
    const webFolder = path.join(targetFolder, 'web');

    // Ensure folders exist
    await fs.mkdir(originalsFolder, { recursive: true });
    await fs.mkdir(webFolder, { recursive: true });

    const processedPhotos = [];

    for (const photo of photos) {
      try {
        const filename = photo.filename;
        const baseName = filename.replace(/\.[^.]+$/, '');

        // Copy original to originals folder
        const origDest = path.join(originalsFolder, filename);
        await fs.copyFile(photo.path, origDest);

        // Create web-optimized version (max 2000px long edge, 85% quality)
        const webDest = path.join(webFolder, `${baseName}-full.jpg`);
        await sharp(photo.path)
          .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toFile(webDest);

        // Create thumbnail (400px long edge)
        const thumbDest = path.join(webFolder, `${baseName}-thumb.jpg`);
        await sharp(photo.path)
          .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(thumbDest);

        processedPhotos.push({
          id: photo.id,
          filename: photo.filename,
          title: photo.title,
          description: photo.description,
          location: photo.location,
          tags: photo.tags,
          timeOfDay: photo.timeOfDay,
          dimensions: photo.dimensions,
          thumbnail: `${baseName}-thumb.jpg`,
          full: `${baseName}-full.jpg`
        });

      } catch (err) {
        console.error('Failed to process', photo.filename, err);
      }
    }

    // Create/update _photos.json
    const photosJsonPath = path.join(targetFolder, '_photos.json');
    let existingPhotos = [];
    try {
      if (fsSync.existsSync(photosJsonPath)) {
        existingPhotos = JSON.parse(await fs.readFile(photosJsonPath, 'utf8'));
      }
    } catch (err) {
      // Ignore
    }

    const allPhotos = [...existingPhotos, ...processedPhotos];
    await fs.writeFile(photosJsonPath, JSON.stringify(allPhotos, null, 2));

    return {
      success: true,
      processed: processedPhotos.length,
      folder: targetFolder
    };

  } catch (err) {
    console.error('finalize-ingest failed:', err);
    return { success: false, error: err.message };
  }
});

// Get available print sizes based on image dimensions
ipcMain.handle('get-print-sizes', async (event, { width, height }) => {
  // Calculate aspect ratio
  const aspectRatio = width / height;

  // Standard print sizes with their aspect ratios
  const allSizes = [
    // Standard 3:2 ratio
    { size: '12x8', ratio: 1.5, width: 12, height: 8 },
    { size: '18x12', ratio: 1.5, width: 18, height: 12 },
    { size: '24x16', ratio: 1.5, width: 24, height: 16 },
    { size: '36x24', ratio: 1.5, width: 36, height: 24 },
    { size: '48x32', ratio: 1.5, width: 48, height: 32 },
    { size: '60x40', ratio: 1.5, width: 60, height: 40 },

    // 4:3 ratio
    { size: '16x12', ratio: 1.333, width: 16, height: 12 },
    { size: '20x16', ratio: 1.25, width: 20, height: 16 },
    { size: '24x18', ratio: 1.333, width: 24, height: 18 },
    { size: '30x20', ratio: 1.5, width: 30, height: 20 },
    { size: '40x30', ratio: 1.333, width: 40, height: 30 },

    // Square
    { size: '12x12', ratio: 1.0, width: 12, height: 12 },
    { size: '20x20', ratio: 1.0, width: 20, height: 20 },
    { size: '30x30', ratio: 1.0, width: 30, height: 30 },

    // Panorama 2:1
    { size: '24x12', ratio: 2.0, width: 24, height: 12 },
    { size: '36x18', ratio: 2.0, width: 36, height: 18 },
    { size: '48x24', ratio: 2.0, width: 48, height: 24 },

    // Panorama 3:1
    { size: '36x12', ratio: 3.0, width: 36, height: 12 },
    { size: '48x16', ratio: 3.0, width: 48, height: 16 },
    { size: '60x20', ratio: 3.0, width: 60, height: 20 },

    // Ultra-wide panorama
    { size: '60x15', ratio: 4.0, width: 60, height: 15 },
    { size: '72x18', ratio: 4.0, width: 72, height: 18 },
  ];

  // Filter sizes that match the image aspect ratio (within 10% tolerance)
  // Also check minimum resolution (150 DPI)
  const MIN_DPI = 150;

  const compatibleSizes = allSizes.filter(s => {
    // Check aspect ratio match (within 10%)
    const ratioDiff = Math.abs(s.ratio - aspectRatio) / aspectRatio;
    if (ratioDiff > 0.10) return false;

    // Check if image has enough pixels for this print size at 150 DPI
    const requiredPixelsW = s.width * MIN_DPI;
    const requiredPixelsH = s.height * MIN_DPI;

    if (width < requiredPixelsW || height < requiredPixelsH) return false;

    return true;
  });

  // Calculate quality level for each size
  return compatibleSizes.map(s => {
    const dpiW = width / s.width;
    const dpiH = height / s.height;
    const effectiveDpi = Math.min(dpiW, dpiH);

    let quality = 'excellent';
    if (effectiveDpi < 200) quality = 'good';
    if (effectiveDpi < 150) quality = 'acceptable';
    if (effectiveDpi < 100) quality = 'low';

    return {
      ...s,
      effectiveDpi: Math.round(effectiveDpi),
      quality
    };
  });
});

// Update photo metadata
ipcMain.handle('update-photo-metadata', async (event, { portfolioId, photoId, metadata }) => {
  try {
    const entries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
    const portfolioFolder = entries.find(e =>
      e.isDirectory() && e.name.toLowerCase().replace(/\s+/g, '_') === portfolioId
    );

    if (!portfolioFolder) {
      return { success: false, error: 'Portfolio not found' };
    }

    const portfolioPath = path.join(PORTFOLIO_DIR, portfolioFolder.name);
    const photosJsonPath = path.join(portfolioPath, '_photos.json');

    let photos = [];
    try {
      if (fsSync.existsSync(photosJsonPath)) {
        photos = JSON.parse(await fs.readFile(photosJsonPath, 'utf8'));
      }
    } catch (err) {
      // Start with empty array
    }

    // Find and update the photo
    const photoIndex = photos.findIndex(p => p.id === photoId);
    if (photoIndex >= 0) {
      photos[photoIndex] = { ...photos[photoIndex], ...metadata };
    } else {
      // Add new entry
      photos.push({ id: photoId, ...metadata });
    }

    await fs.writeFile(photosJsonPath, JSON.stringify(photos, null, 2));

    return { success: true };
  } catch (err) {
    console.error('Update metadata failed:', err);
    return { success: false, error: err.message };
  }
});

// Process ingest (legacy - kept for compatibility)
ipcMain.handle('process-ingest', async (event, { files, mode, portfolioId, newGallery }) => {
  console.log('process-ingest called - redirecting to analyze-photos');
  return { success: true, message: 'Use analyze-photos and finalize-ingest instead' };
});
