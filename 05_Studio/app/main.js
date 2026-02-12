const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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

// ===================
// R2 UPLOAD CLIENT (lazy-initialized)
// ===================
let r2Client = null;

function getR2Client() {
  const env = parseEnvFileSync();
  const accessKey = env.R2_ACCESS_KEY_ID;
  const secretKey = env.R2_SECRET_ACCESS_KEY;
  const endpoint = env.R2_ENDPOINT;
  if (!accessKey || !secretKey || !endpoint) return null;

  try {
    const { S3Client } = require('@aws-sdk/client-s3');
    r2Client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    });
    return r2Client;
  } catch (err) {
    console.warn('R2 client init failed:', err.message);
    return null;
  }
}

// Sync version for early use before IPC is ready
function parseEnvFileSync() {
  try {
    const envPath = path.join(ARCHIVE_BASE, '.env');
    const content = fsSync.readFileSync(envPath, 'utf8');
    const keys = {};
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) keys[match[1]] = match[2];
    }
    return keys;
  } catch { return {}; }
}

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

// Open external URL in default browser
ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    console.error('Failed to open external URL:', err);
    return { success: false, error: err.message };
  }
});

// ===================
// API KEY MANAGEMENT
// ===================

const ENV_PATH = path.join(ARCHIVE_BASE, '.env');

// Helper: parse .env file into object
function parseEnvFile() {
  try {
    const content = fsSync.readFileSync(ENV_PATH, 'utf8');
    const keys = {};
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) keys[match[1]] = match[2];
    }
    return keys;
  } catch { return {}; }
}

// Helper: mask a key for display (show first 8 and last 4 chars)
function maskKey(value) {
  if (!value || value.length < 16) return value ? '••••••••' : '';
  return value.slice(0, 8) + '••••••' + value.slice(-4);
}

// Get all API key statuses
ipcMain.handle('get-api-keys', async () => {
  const env = parseEnvFile();
  return [
    { id: 'ANTHROPIC_API_KEY', name: 'Claude AI (Anthropic)', description: 'Powers AI photo metadata generation', value: env.ANTHROPIC_API_KEY || '', masked: maskKey(env.ANTHROPIC_API_KEY), configured: !!env.ANTHROPIC_API_KEY },
    { id: 'PICTOREM_API_KEY', name: 'Pictorem', description: 'Print fulfillment service', value: env.PICTOREM_API_KEY || '', masked: maskKey(env.PICTOREM_API_KEY), configured: !!env.PICTOREM_API_KEY },
    { id: 'STRIPE_SECRET_KEY', name: 'Stripe', description: 'Payment processing', value: env.STRIPE_SECRET_KEY || '', masked: maskKey(env.STRIPE_SECRET_KEY), configured: !!env.STRIPE_SECRET_KEY },
    { id: 'STRIPE_PUBLISHABLE_KEY', name: 'Stripe (Publishable)', description: 'Stripe frontend key', value: env.STRIPE_PUBLISHABLE_KEY || '', masked: maskKey(env.STRIPE_PUBLISHABLE_KEY), configured: !!env.STRIPE_PUBLISHABLE_KEY },
    { id: 'R2_ACCESS_KEY_ID', name: 'Cloudflare R2 (Access Key)', description: 'S3-compatible storage for high-res originals', value: env.R2_ACCESS_KEY_ID || '', masked: maskKey(env.R2_ACCESS_KEY_ID), configured: !!env.R2_ACCESS_KEY_ID },
    { id: 'R2_SECRET_ACCESS_KEY', name: 'Cloudflare R2 (Secret Key)', description: 'R2 secret access key', value: env.R2_SECRET_ACCESS_KEY || '', masked: maskKey(env.R2_SECRET_ACCESS_KEY), configured: !!env.R2_SECRET_ACCESS_KEY },
    { id: 'R2_ENDPOINT', name: 'Cloudflare R2 (Endpoint)', description: 'S3 API endpoint URL', value: env.R2_ENDPOINT || '', masked: env.R2_ENDPOINT ? env.R2_ENDPOINT.slice(0, 30) + '...' : '', configured: !!env.R2_ENDPOINT },
    { id: 'R2_BUCKET_NAME', name: 'Cloudflare R2 (Bucket)', description: 'R2 bucket for originals', value: env.R2_BUCKET_NAME || '', masked: env.R2_BUCKET_NAME || '', configured: !!env.R2_BUCKET_NAME },
    { id: 'STRIPE_TEST_SECRET_KEY', name: 'Stripe Test Secret', description: 'Stripe test mode secret key', value: env.STRIPE_TEST_SECRET_KEY || '', masked: maskKey(env.STRIPE_TEST_SECRET_KEY), configured: !!env.STRIPE_TEST_SECRET_KEY },
    { id: 'STRIPE_TEST_PUBLISHABLE_KEY', name: 'Stripe Test Publishable', description: 'Stripe test mode publishable key', value: env.STRIPE_TEST_PUBLISHABLE_KEY || '', masked: maskKey(env.STRIPE_TEST_PUBLISHABLE_KEY), configured: !!env.STRIPE_TEST_PUBLISHABLE_KEY },
    { id: 'STRIPE_TEST_WEBHOOK_SECRET', name: 'Stripe Test Webhook Secret', description: 'Stripe test webhook signing secret', value: env.STRIPE_TEST_WEBHOOK_SECRET || '', masked: maskKey(env.STRIPE_TEST_WEBHOOK_SECRET), configured: !!env.STRIPE_TEST_WEBHOOK_SECRET },
    { id: 'META_ACCESS_TOKEN', name: 'Meta (Instagram/Facebook)', description: 'Social media posting', value: env.META_ACCESS_TOKEN || '', masked: maskKey(env.META_ACCESS_TOKEN), configured: !!env.META_ACCESS_TOKEN },
    { id: 'GOOGLE_ANALYTICS_ID', name: 'Google Analytics', description: 'Website traffic tracking', value: env.GOOGLE_ANALYTICS_ID || '', masked: maskKey(env.GOOGLE_ANALYTICS_ID), configured: !!env.GOOGLE_ANALYTICS_ID },
  ];
});

// Save a single API key
ipcMain.handle('save-api-key', async (event, { keyId, value }) => {
  try {
    let content = fsSync.existsSync(ENV_PATH) ? fsSync.readFileSync(ENV_PATH, 'utf8') : '';
    const regex = new RegExp(`^${keyId}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${keyId}=${value}`);
    } else {
      content += `\n${keyId}=${value}`;
    }
    fsSync.writeFileSync(ENV_PATH, content);
    // Update process.env so it takes effect immediately
    process.env[keyId] = value;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Test an API key
ipcMain.handle('test-api-key', async (event, { keyId, value }) => {
  try {
    if (keyId === 'ANTHROPIC_API_KEY') {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: value });
      const resp = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say OK' }]
      });
      return { success: true, message: 'Claude API connected successfully' };
    }
    if (keyId === 'R2_ACCESS_KEY_ID' || keyId === 'R2_SECRET_ACCESS_KEY') {
      // Test R2 connection by listing bucket contents
      const env = parseEnvFile();
      const accessKey = keyId === 'R2_ACCESS_KEY_ID' ? value : env.R2_ACCESS_KEY_ID;
      const secretKey = keyId === 'R2_SECRET_ACCESS_KEY' ? value : env.R2_SECRET_ACCESS_KEY;
      const endpoint = env.R2_ENDPOINT;
      const bucket = env.R2_BUCKET_NAME;
      if (accessKey && secretKey && endpoint && bucket) {
        try {
          const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
          const s3 = new S3Client({
            region: 'auto',
            endpoint,
            credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
          });
          const result = await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
          return { success: true, message: `R2 connected! Bucket "${bucket}" accessible (${result.KeyCount || 0} objects listed)` };
        } catch (r2err) {
          return { success: false, error: `R2 connection failed: ${r2err.message}` };
        }
      }
      return { success: true, message: 'Key saved — configure all R2 fields to enable connection test' };
    }
    return { success: true, message: 'Key saved (no test available for this service)' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ===================
// TEST / LIVE MODE MANAGEMENT
// ===================

const MODE_FILE = path.join(ARCHIVE_BASE, '.studio-mode');

function getCurrentMode() {
  try {
    if (fsSync.existsSync(MODE_FILE)) {
      const mode = fsSync.readFileSync(MODE_FILE, 'utf8').trim();
      if (mode === 'test' || mode === 'live') return mode;
    }
  } catch {}
  return 'live'; // Default to live
}

function setCurrentMode(mode) {
  fsSync.writeFileSync(MODE_FILE, mode);
}

// Get current mode
ipcMain.handle('get-mode', async () => {
  return getCurrentMode();
});

// Set mode (test or live)
ipcMain.handle('set-mode', async (event, mode) => {
  if (mode !== 'test' && mode !== 'live') {
    return { success: false, error: 'Invalid mode. Use "test" or "live".' };
  }
  try {
    setCurrentMode(mode);
    console.log(`Mode switched to: ${mode.toUpperCase()}`);
    // Notify all windows
    if (mainWindow) {
      mainWindow.webContents.send('mode-changed', mode);
    }
    return { success: true, mode };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Get mode-specific config (Stripe keys, mock flags, etc.)
ipcMain.handle('get-mode-config', async () => {
  const mode = getCurrentMode();
  const env = parseEnvFile();

  if (mode === 'test') {
    return {
      mode: 'test',
      stripe: {
        publishableKey: env.STRIPE_TEST_PUBLISHABLE_KEY || '',
        secretKey: env.STRIPE_TEST_SECRET_KEY || '',
        configured: !!(env.STRIPE_TEST_PUBLISHABLE_KEY && env.STRIPE_TEST_SECRET_KEY),
      },
      pictorem: {
        useMock: true,
        mockMessage: 'Pictorem orders are simulated in test mode (no real orders placed)',
      },
      r2: {
        prefix: 'test/',
        message: 'R2 uploads go to test/ prefix',
      },
      webhook: {
        url: env.STRIPE_TEST_WEBHOOK_SECRET ? 'configured' : 'not configured',
      },
    };
  }

  return {
    mode: 'live',
    stripe: {
      publishableKey: env.STRIPE_PUBLISHABLE_KEY || '',
      secretKey: env.STRIPE_SECRET_KEY || '',
      configured: !!(env.STRIPE_PUBLISHABLE_KEY && env.STRIPE_SECRET_KEY),
    },
    pictorem: {
      useMock: false,
    },
    r2: {
      prefix: '',
    },
    webhook: {
      url: 'production',
    },
  };
});

// ===================
// THUMBNAIL HANDLER
// ===================

ipcMain.handle('get-thumbnail', async (event, filePath) => {
  try {
    const sharp = require('sharp');
    const buffer = await sharp(filePath)
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.error('Thumbnail failed:', filePath, err.message);
    return null;
  }
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
      let country = '';

      // Try to read _gallery.json for metadata
      const galleryJsonPath = path.join(portfolioPath, '_gallery.json');
      try {
        if (fsSync.existsSync(galleryJsonPath)) {
          const galleryData = JSON.parse(await fs.readFile(galleryJsonPath, 'utf8'));
          // FIX: Format location object to string
          location = formatLocation(galleryData.location);
          // Extract country from location object
          if (galleryData.location) {
            country = typeof galleryData.location === 'object'
              ? (galleryData.location.country || '')
              : '';
          }
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
        location,
        country
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
          path: path.join(sourcePath, filename),
          title: meta.title || filename.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
          description: meta.description || '',
          location: formatLocation(meta.location) || '',
          tags: meta.tags || [],
          timeOfDay: meta.timeOfDay || '',
          dimensions: meta.dimensions || null,
          inWebsite: meta.inWebsite ?? true,
          inPictorem: meta.inPictorem ?? false,
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

    // Resolve collection slug for R2 key construction
    let collectionSlug = '';
    try {
      const galleryPath = path.join(portfolioPath, '_gallery.json');
      if (fsSync.existsSync(galleryPath)) {
        const gal = JSON.parse(fsSync.readFileSync(galleryPath, 'utf8'));
        collectionSlug = gal.slug || '';
      }
    } catch (e) {}
    if (!collectionSlug) {
      collectionSlug = portfolioId.replace(/[_\s]+/g, '-').replace(/-+$/, '');
    }

    const r2DeletedKeys = [];

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

      // Delete from R2 bucket (Pictorem fulfillment originals)
      try {
        const s3 = getR2Client();
        const bucketName = parseEnvFileSync().R2_BUCKET_NAME;
        if (s3 && bucketName && collectionSlug) {
          const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
          const modePrefix = getCurrentMode() === 'test' ? 'test/' : '';
          const r2Key = `${modePrefix}${collectionSlug}/${webName}.jpg`;
          await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: r2Key }));
          r2DeletedKeys.push(r2Key);
          console.log(`R2 deleted: ${r2Key}`);
        }
      } catch (r2Err) {
        console.warn(`R2 delete failed for ${webName} (non-blocking):`, r2Err.message);
      }
    }

    return { success: true, movedFiles, r2DeletedKeys };
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

// Build the AI prompt with geographic constraints
function buildAIPrompt(galleryContext, filename) {
  const c = galleryContext?.country || '';
  const n = galleryContext?.name || '';
  const l = galleryContext?.location || '';

  let prompt = 'You are a fine art photography metadata assistant for Archive-35, a landscape photography brand by Wolfgang Schram.\n\n';

  if (c) {
    prompt += '=== MANDATORY GEOGRAPHIC CONSTRAINT ===\n';
    prompt += `These photos were taken in ${c}. Gallery: "${n}".${l ? ' Region: ' + l + '.' : ''}\n`;
    prompt += 'RULES:\n';
    prompt += `- EVERY tag, description, and location MUST be consistent with ${c}\n`;
    prompt += `- NEVER use tags or words like "Antarctica", "polar", "Arctic", "Alpine", "Patagonia", "Iceland", "Norway", "Scandinavia", or ANY country/region that is NOT ${c}\n`;
    prompt += `- Even if a scene has glaciers, snow, or ice, it is in ${c}. Describe it as ${c} scenery.\n`;
    prompt += `- The location field MUST be a real place within ${c}\n`;
    prompt += `- Geography tags MUST reference ${c} and regions within ${c} ONLY\n`;
    prompt += '=== END CONSTRAINT ===\n\n';
  }

  prompt += 'Respond with ONLY valid JSON (no markdown):\n';
  prompt += '{\n';
  prompt += '  "title": "short evocative title (3-6 words)",\n';
  prompt += `  "description": "1-2 sentence art description for fine art print buyers. Timeless tone. No time-of-day references (no sunrise, sunset, morning, evening).",\n`;
  prompt += `  "location": "specific place or region in ${c || 'the photographed area'}",\n`;
  prompt += '  "tags": ["15-20 tags for maximum discoverability"]\n';
  prompt += '}\n\n';

  prompt += 'TAG STRATEGY (generate 15-20 tags across ALL these categories):\n';
  prompt += '- Subject: what is in the photo (mountain, glacier, waterfall, forest, lake, etc.)\n';
  prompt += `- Geography: ${c || 'country'}, region, specific place names ONLY from ${c || 'the area'}\n`;
  prompt += '- Mood/emotion: serene, dramatic, majestic, tranquil, powerful, etc.\n';
  prompt += '- Style: landscape-photography, fine-art, nature-photography, wall-art, etc.\n';
  prompt += '- Physical features: geological terms, water features, vegetation types\n';
  prompt += '- Colors: dominant colors (emerald, azure, golden, etc.)\n';
  prompt += '- Buyer keywords: home-decor, office-art, canvas-print, gallery-wall, etc.\n';
  prompt += '- Weather: mist, fog, clouds, clear-sky, overcast, etc.\n\n';

  prompt += 'REMINDER: Timeless tone. No time-of-day. Tags lowercase and hyphenated.';
  if (c) {
    prompt += ` ALL geographic references MUST be ${c}. NEVER reference any other country or polar region.`;
  }
  prompt += `\nFilename: ${filename}`;

  return prompt;
}

// Analyze photos - extract EXIF, dimensions, and prepare for AI descriptions
ipcMain.handle('analyze-photos', async (event, { files, galleryContext }) => {
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

          // AI-generated content (populated below if API key available)
          title: '',
          description: '',
          location: '',
          tags: [],

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

    // AI metadata generation (requires ANTHROPIC_API_KEY in .env)
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const Anthropic = require('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey });
        const sharp = require('sharp');

        const aiTotal = results.filter(p => !p.error).length;
        let aiDone = 0;

        for (const photo of results) {
          if (photo.error) continue;
          aiDone++;
          if (mainWindow) {
            mainWindow.webContents.send('ingest-progress', {
              phase: 'ai',
              current: aiDone,
              total: aiTotal,
              filename: photo.filename,
              message: `AI analyzing photo ${aiDone} of ${aiTotal}: ${photo.filename}`
            });
          }
          try {
            // Resize for API (max 1024px, keep small for speed)
            const thumbBuffer = await sharp(photo.path)
              .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 70 })
              .toBuffer();
            const base64Image = thumbBuffer.toString('base64');

            const response = await client.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 500,
              messages: [{
                role: 'user',
                content: [
                  { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } },
                  { type: 'text', text: buildAIPrompt(galleryContext, photo.filename) }
                ]
              }]
            });

            let text = response.content[0]?.text || '';
            // Strip markdown code fences if Claude wraps in ```json ... ```
            text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
            const parsed = JSON.parse(text);
            if (parsed.title) photo.title = parsed.title;
            if (parsed.description) photo.description = parsed.description;
            if (parsed.location) photo.location = parsed.location;
            if (parsed.tags) photo.tags = parsed.tags;
          } catch (aiErr) {
            console.warn('AI analysis failed for', photo.filename, aiErr.message);
          }
        }
      } catch (sdkErr) {
        console.warn('Anthropic SDK not available:', sdkErr.message);
      }
    } else {
      console.log('No ANTHROPIC_API_KEY set — skipping AI metadata generation');
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
    const { signImageC2PA, isC2PAAvailable } = require('./c2pa-sign');
    const c2paReady = isC2PAAvailable();
    if (c2paReady) {
      console.log('C2PA signing available — will embed content credentials');
    } else {
      console.log('C2PA signing not available — skipping content credentials');
    }

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
        slug: folderName.toLowerCase().replace(/[_\s]+/g, '-').replace(/-+$/, ''),
        status: 'draft',
        dates: {
          published: null
        },
        location: {
          country: newGallery.country || '',
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
    const totalPhotos = photos.length;
    let processedCount = 0;

    for (const photo of photos) {
      try {
        processedCount++;
        if (mainWindow) {
          mainWindow.webContents.send('ingest-progress', {
            phase: 'finalize',
            current: processedCount,
            total: totalPhotos,
            filename: photo.filename,
            message: `Processing ${processedCount} of ${totalPhotos}: ${photo.filename}`
          });
        }
        const filename = photo.filename;
        const baseName = filename.replace(/\.[^.]+$/, '');

        // Copy original to originals folder
        const origDest = path.join(originalsFolder, filename);
        await fs.copyFile(photo.path, origDest);

        // Upload original to R2 for Pictorem high-res fulfillment
        try {
          const s3 = getR2Client();
          const bucketName = parseEnvFileSync().R2_BUCKET_NAME;
          if (s3 && bucketName) {
            const { PutObjectCommand } = require('@aws-sdk/client-s3');
            // Use gallery slug for R2 key consistency with webhook
            let collectionSlug;
            try {
              const galleryPath = path.join(targetFolder, '_gallery.json');
              if (fsSync.existsSync(galleryPath)) {
                const gal = JSON.parse(fsSync.readFileSync(galleryPath, 'utf8'));
                collectionSlug = gal.slug;
              }
            } catch (e) {}
            if (!collectionSlug) {
              collectionSlug = (portfolioId || (newGallery?.name || 'unknown').toLowerCase())
                .replace(/[_\s]+/g, '-').replace(/-+$/, '');
            }
            const modePrefix = getCurrentMode() === 'test' ? 'test/' : '';
            const r2Key = `${modePrefix}${collectionSlug}/${baseName}.jpg`;
            const fileBuffer = await fs.readFile(photo.path);
            await s3.send(new PutObjectCommand({
              Bucket: bucketName,
              Key: r2Key,
              Body: fileBuffer,
              ContentType: 'image/jpeg',
            }));
            console.log(`R2 upload: ${r2Key} (${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB)`);
            if (mainWindow) {
              mainWindow.webContents.send('ingest-progress', {
                phase: 'finalize',
                current: processedCount,
                total: totalPhotos,
                filename: photo.filename,
                message: `Uploaded original to R2: ${photo.filename}`
              });
            }
          }
        } catch (r2Err) {
          console.warn('R2 upload failed (non-blocking):', r2Err.message);
        }

        // Create web-optimized version (max 2000px long edge, 85% quality)
        const webDest = path.join(webFolder, `${baseName}-full.jpg`);
        await sharp(photo.path)
          .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toFile(webDest);

        // Sign web-optimized image with C2PA Content Credentials
        let c2paSigned = false;
        if (c2paReady) {
          try {
            const c2paResult = await signImageC2PA(webDest, {
              title: photo.title || baseName,
              author: 'Wolf',
              location: typeof photo.location === 'object'
                ? [photo.location.place, photo.location.region, photo.location.country].filter(Boolean).join(', ')
                : (photo.location || ''),
              year: new Date().getFullYear(),
              description: photo.description || `Fine art photograph by Wolf`
            });
            c2paSigned = c2paResult.success;
            if (!c2paResult.success) {
              console.warn(`C2PA signing failed for ${baseName}: ${c2paResult.error}`);
            } else {
              console.log(`C2PA signed: ${baseName}-full.jpg`);
            }
          } catch (c2paErr) {
            console.warn(`C2PA signing error for ${baseName}:`, c2paErr.message);
          }
        }

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
          dimensions: photo.dimensions,
          thumbnail: `${baseName}-thumb.jpg`,
          full: `${baseName}-full.jpg`,
          c2pa: c2paSigned
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

// Reorder photos within a portfolio
ipcMain.handle('reorder-photos', async (event, { portfolioId, orderedFilenames }) => {
  try {
    const entries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
    const portfolioFolder = entries.find(e =>
      e.isDirectory() && e.name.toLowerCase().replace(/\s+/g, '_') === portfolioId
    );
    if (!portfolioFolder) return { success: false, error: 'Portfolio not found' };

    const portfolioPath = path.join(PORTFOLIO_DIR, portfolioFolder.name);
    const photosJsonPath = path.join(portfolioPath, '_photos.json');
    if (!fsSync.existsSync(photosJsonPath)) return { success: false, error: 'No _photos.json found' };

    const photos = JSON.parse(await fs.readFile(photosJsonPath, 'utf8'));
    const photoMap = {};
    photos.forEach(p => { photoMap[p.filename] = p; });

    // Rebuild array in new order, keeping any not in orderedFilenames at the end
    const reordered = [];
    for (const fn of orderedFilenames) {
      if (photoMap[fn]) {
        reordered.push(photoMap[fn]);
        delete photoMap[fn];
      }
    }
    // Append any remaining photos not in the ordered list
    Object.values(photoMap).forEach(p => reordered.push(p));

    await fs.writeFile(photosJsonPath, JSON.stringify(reordered, null, 2));
    return { success: true, count: reordered.length };
  } catch (err) {
    console.error('Reorder photos failed:', err);
    return { success: false, error: err.message };
  }
});

// ===== RENAME PORTFOLIO =====
ipcMain.handle('rename-portfolio', async (event, { portfolioId, newName }) => {
  try {
    if (!newName || !newName.trim()) {
      return { success: false, error: 'Name cannot be empty' };
    }

    const cleanName = newName.trim();
    const newFolderName = cleanName.replace(/\s+/g, '_');
    const newSlug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const newId = newFolderName.toLowerCase();

    // Invalid characters check
    if (/[<>:"/\\|?*]/.test(cleanName)) {
      return { success: false, error: 'Name contains invalid characters' };
    }

    // Find current folder
    const entries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
    const currentFolder = entries.find(e =>
      e.isDirectory() && e.name.toLowerCase().replace(/\s+/g, '_') === portfolioId
    );
    if (!currentFolder) return { success: false, error: 'Portfolio not found' };

    const oldPath = path.join(PORTFOLIO_DIR, currentFolder.name);
    const newPath = path.join(PORTFOLIO_DIR, newFolderName);

    // Check for duplicate (skip if same folder, case-insensitive)
    if (currentFolder.name.toLowerCase() !== newFolderName.toLowerCase()) {
      if (fsSync.existsSync(newPath)) {
        return { success: false, error: 'A portfolio with that name already exists' };
      }
    }

    // Update _gallery.json before renaming folder
    const galleryJsonPath = path.join(oldPath, '_gallery.json');
    if (fsSync.existsSync(galleryJsonPath)) {
      const galleryData = JSON.parse(await fs.readFile(galleryJsonPath, 'utf8'));
      galleryData.id = newId;
      galleryData.title = cleanName;
      galleryData.slug = newSlug;
      await fs.writeFile(galleryJsonPath, JSON.stringify(galleryData, null, 2));
    }

    // Rename the 01_Portfolio folder
    // Handle case-insensitive filesystems with two-step rename
    if (currentFolder.name.toLowerCase() === newFolderName.toLowerCase() && currentFolder.name !== newFolderName) {
      const tmpPath = oldPath + '_rename_tmp';
      await fs.rename(oldPath, tmpPath);
      await fs.rename(tmpPath, newPath);
    } else if (currentFolder.name !== newFolderName) {
      await fs.rename(oldPath, newPath);
    }

    // Also rename Photography folder if it exists
    const PHOTOGRAPHY_DIR = path.join(ARCHIVE_BASE, 'Photography');
    if (fsSync.existsSync(PHOTOGRAPHY_DIR)) {
      try {
        const photoEntries = await fs.readdir(PHOTOGRAPHY_DIR, { withFileTypes: true });
        // Match by normalized name (spaces, underscores, case-insensitive)
        const oldNorm = currentFolder.name.toLowerCase().replace(/[_\s]+/g, '');
        const photoFolder = photoEntries.find(e => {
          if (!e.isDirectory()) return false;
          const norm = e.name.toLowerCase().replace(/[_\s]+/g, '');
          return norm === oldNorm;
        });
        if (photoFolder) {
          const oldPhotoPath = path.join(PHOTOGRAPHY_DIR, photoFolder.name);
          const newPhotoPath = path.join(PHOTOGRAPHY_DIR, cleanName);
          if (photoFolder.name.toLowerCase() === cleanName.toLowerCase() && photoFolder.name !== cleanName) {
            const tmpPhotoPath = oldPhotoPath + '_rename_tmp';
            await fs.rename(oldPhotoPath, tmpPhotoPath);
            await fs.rename(tmpPhotoPath, newPhotoPath);
          } else if (photoFolder.name !== cleanName) {
            await fs.rename(oldPhotoPath, newPhotoPath);
          }
        }
      } catch (photoErr) {
        console.warn('Photography folder rename skipped:', photoErr.message);
      }
    }

    console.log(`Portfolio renamed: ${currentFolder.name} → ${newFolderName}`);
    return {
      success: true,
      newId: newId,
      newName: cleanName,
      newFolderName: newFolderName,
      newSlug: newSlug
    };
  } catch (err) {
    console.error('Rename portfolio failed:', err);
    return { success: false, error: err.message };
  }
});

// Get/set portfolio display order
ipcMain.handle('get-portfolio-order', async () => {
  try {
    const orderPath = path.join(PORTFOLIO_DIR, '_portfolio-order.json');
    if (fsSync.existsSync(orderPath)) {
      return JSON.parse(await fs.readFile(orderPath, 'utf8'));
    }
    // Default: return folder names in alphabetical order
    const entries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
      .map(e => e.name)
      .sort();
  } catch (err) {
    console.error('Get portfolio order failed:', err);
    return [];
  }
});

ipcMain.handle('save-portfolio-order', async (event, { orderedFolderNames }) => {
  try {
    const orderPath = path.join(PORTFOLIO_DIR, '_portfolio-order.json');
    await fs.writeFile(orderPath, JSON.stringify(orderedFolderNames, null, 2));
    return { success: true };
  } catch (err) {
    console.error('Save portfolio order failed:', err);
    return { success: false, error: err.message };
  }
});

// Replace photo with a new image
ipcMain.handle('replace-photo', async (event, { portfolioId, photoId, newFilePath }) => {
  try {
    const sharp = require('sharp');
    const { signImageC2PA, isC2PAAvailable } = require('./c2pa-sign');

    // Find portfolio folder
    const entries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
    const portfolio = entries.find(e =>
      e.isDirectory() && e.name.toLowerCase().replace(/\s+/g, '_') === portfolioId
    );
    if (!portfolio) return { success: false, error: 'Portfolio not found' };

    const portfolioPath = path.join(PORTFOLIO_DIR, portfolio.name);
    const originalsFolder = path.join(portfolioPath, 'originals');
    const webFolder = path.join(portfolioPath, 'web');

    // Read _photos.json to find the photo entry
    const photosJsonPath = path.join(portfolioPath, '_photos.json');
    let photosData = JSON.parse(await fs.readFile(photosJsonPath, 'utf8'));
    const photoIndex = photosData.findIndex(p => p.id === photoId);
    if (photoIndex === -1) return { success: false, error: 'Photo not found in metadata' };

    const photo = photosData[photoIndex];
    const baseName = photo.filename.replace(/\.[^.]+$/, '');

    // 1. Replace original
    const origDest = path.join(originalsFolder, photo.filename);
    await fs.copyFile(newFilePath, origDest);

    // 2. Create new web-optimized version
    const webDest = path.join(webFolder, `${baseName}-full.jpg`);
    await sharp(newFilePath)
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(webDest);

    // 3. Sign with C2PA
    const c2paReady = isC2PAAvailable();
    if (c2paReady) {
      try {
        await signImageC2PA(webDest, {
          title: photo.title || baseName,
          author: 'Wolf',
          location: typeof photo.location === 'object'
            ? [photo.location.place, photo.location.region, photo.location.country].filter(Boolean).join(', ')
            : (photo.location || ''),
          year: new Date().getFullYear(),
          description: photo.description || 'Fine art photograph by Wolf'
        });
      } catch (c2paErr) {
        console.warn('C2PA signing failed for replacement:', c2paErr.message);
      }
    }

    // 4. Create new thumbnail
    const thumbDest = path.join(webFolder, `${baseName}-thumb.jpg`);
    await sharp(newFilePath)
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(thumbDest);

    // 5. Upload to R2
    try {
      const s3 = getR2Client();
      const bucketName = parseEnvFileSync().R2_BUCKET_NAME;
      if (s3 && bucketName) {
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        let collectionSlug;
        try {
          const galleryPath = path.join(portfolioPath, '_gallery.json');
          if (fsSync.existsSync(galleryPath)) {
            const gal = JSON.parse(fsSync.readFileSync(galleryPath, 'utf8'));
            collectionSlug = gal.slug;
          }
        } catch (e) {}
        if (!collectionSlug) {
          collectionSlug = portfolioId.replace(/[_\s]+/g, '-').replace(/-+$/, '');
        }
        const modePrefix = getCurrentMode() === 'test' ? 'test/' : '';
        const r2Key = `${modePrefix}${collectionSlug}/${baseName}.jpg`;
        const fileBuffer = await fs.readFile(newFilePath);
        await s3.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: r2Key,
          Body: fileBuffer,
          ContentType: 'image/jpeg',
        }));
        console.log(`R2 upload (replace): ${r2Key}`);
      }
    } catch (r2Err) {
      console.warn('R2 upload failed (non-blocking):', r2Err.message);
    }

    // 6. Update dimensions in _photos.json
    const newMetadata = await sharp(newFilePath).metadata();
    const aspectRatio = newMetadata.width / newMetadata.height;
    let orientation = 'landscape';
    if (aspectRatio < 0.95) orientation = 'portrait';
    else if (aspectRatio >= 0.95 && aspectRatio <= 1.05) orientation = 'square';
    else if (aspectRatio > 2.0) orientation = 'panorama';
    else if (aspectRatio > 1.5) orientation = 'wide';

    photosData[photoIndex].dimensions = {
      width: newMetadata.width,
      height: newMetadata.height,
      aspectRatio: parseFloat(aspectRatio.toFixed(3)),
      aspectRatioString: `${newMetadata.width}:${newMetadata.height}`,
      orientation,
      megapixels: parseFloat(((newMetadata.width * newMetadata.height) / 1000000).toFixed(1))
    };

    await fs.writeFile(photosJsonPath, JSON.stringify(photosData, null, 2));

    return { success: true, message: `Replaced ${photo.filename} successfully` };
  } catch (err) {
    console.error('replace-photo failed:', err);
    return { success: false, error: err.message };
  }
});

// Process ingest (legacy - kept for compatibility)
ipcMain.handle('process-ingest', async (event, { files, mode, portfolioId, newGallery }) => {
  console.log('process-ingest called - redirecting to analyze-photos');
  return { success: true, message: 'Use analyze-photos and finalize-ingest instead' };
});

// ===================
// BATCH R2 UPLOAD (backfill existing originals)
// ===================

ipcMain.handle('batch-upload-r2', async () => {
  const results = { uploaded: 0, skipped: 0, failed: 0, errors: [], collections: {} };

  try {
    const s3 = getR2Client();
    const bucketName = parseEnvFileSync().R2_BUCKET_NAME;

    if (!s3 || !bucketName) {
      return { success: false, error: 'R2 credentials not configured. Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, and R2_BUCKET_NAME in Settings → API Keys.' };
    }

    const { PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

    const entries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
    const portfolioDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'));

    let totalFiles = 0;
    let processedFiles = 0;

    // First pass: count total files
    for (const dir of portfolioDirs) {
      const originalsPath = path.join(PORTFOLIO_DIR, dir.name, 'originals');
      if (fsSync.existsSync(originalsPath)) {
        const files = await fs.readdir(originalsPath);
        totalFiles += files.filter(f => /\.(jpg|jpeg|tiff|tif|png)$/i.test(f)).length;
      }
    }

    // Second pass: upload
    for (const dir of portfolioDirs) {
      const portfolioPath = path.join(PORTFOLIO_DIR, dir.name);
      const originalsPath = path.join(portfolioPath, 'originals');
      const galleryJsonPath = path.join(portfolioPath, '_gallery.json');

      if (!fsSync.existsSync(originalsPath)) continue;

      // Get collection slug from _gallery.json (must match webhook expectations)
      let collectionSlug;
      try {
        if (fsSync.existsSync(galleryJsonPath)) {
          const gallery = JSON.parse(await fs.readFile(galleryJsonPath, 'utf8'));
          collectionSlug = gallery.slug;
        }
      } catch (e) {}

      if (!collectionSlug) {
        // Fallback: convert folder name to hyphenated slug
        collectionSlug = dir.name.toLowerCase().replace(/[_\s]+/g, '-').replace(/-+$/, '');
      }

      results.collections[collectionSlug] = { uploaded: 0, skipped: 0, failed: 0 };

      const files = await fs.readdir(originalsPath);
      const imageFiles = files.filter(f => /\.(jpg|jpeg|tiff|tif|png)$/i.test(f));

      for (const filename of imageFiles) {
        processedFiles++;
        const baseName = filename.replace(/\.[^.]+$/, '');
        const r2Key = `${collectionSlug}/${baseName}.jpg`;

        if (mainWindow) {
          mainWindow.webContents.send('r2-upload-progress', {
            current: processedFiles,
            total: totalFiles,
            collection: collectionSlug,
            filename,
            r2Key,
            message: `Uploading ${processedFiles}/${totalFiles}: ${r2Key}`
          });
        }

        try {
          // Check if already exists in R2
          try {
            await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: r2Key }));
            // Already exists — skip
            results.skipped++;
            results.collections[collectionSlug].skipped++;
            console.log(`R2 skip (exists): ${r2Key}`);
            continue;
          } catch (headErr) {
            // Not found — proceed with upload (this is expected)
          }

          const filePath = path.join(originalsPath, filename);
          const fileBuffer = await fs.readFile(filePath);

          await s3.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: r2Key,
            Body: fileBuffer,
            ContentType: 'image/jpeg',
          }));

          results.uploaded++;
          results.collections[collectionSlug].uploaded++;
          console.log(`R2 upload: ${r2Key} (${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB)`);

        } catch (uploadErr) {
          results.failed++;
          results.collections[collectionSlug].failed++;
          results.errors.push(`${r2Key}: ${uploadErr.message}`);
          console.error(`R2 upload failed: ${r2Key}`, uploadErr.message);
        }
      }
    }

    if (mainWindow) {
      mainWindow.webContents.send('r2-upload-progress', {
        current: totalFiles,
        total: totalFiles,
        message: `Done! ${results.uploaded} uploaded, ${results.skipped} already existed, ${results.failed} failed.`
      });
    }

    return { success: true, ...results };
  } catch (err) {
    console.error('batch-upload-r2 failed:', err);
    return { success: false, error: err.message, ...results };
  }
});

// ===================
// DEPLOY STATUS CHECK
// ===================

ipcMain.handle('check-deploy-status', async () => {
  try {
    const entries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
    const portfolioDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'));

    let portfolioPhotoCount = 0;
    const portfolioCollections = [];

    for (const dir of portfolioDirs) {
      const portfolioPath = path.join(PORTFOLIO_DIR, dir.name);
      const photosJsonPath = path.join(portfolioPath, '_photos.json');
      const galleryJsonPath = path.join(portfolioPath, '_gallery.json');
      const webPath = path.join(portfolioPath, 'web');

      let gallery = {};
      try {
        if (fsSync.existsSync(galleryJsonPath)) {
          gallery = JSON.parse(await fs.readFile(galleryJsonPath, 'utf8'));
        }
      } catch (e) {}

      const folderSlug = dir.name.toLowerCase().replace(/[_\s]+/g, '-').replace(/-+$/, '');
      const collectionSlug = gallery.slug || folderSlug;
      let photoCount = 0;
      let hasPhotosJson = false;

      if (fsSync.existsSync(photosJsonPath)) {
        const photos = JSON.parse(await fs.readFile(photosJsonPath, 'utf8'));
        photoCount = photos.length;
        hasPhotosJson = true;
      } else if (fsSync.existsSync(webPath)) {
        const webFiles = await fs.readdir(webPath);
        photoCount = webFiles.filter(f => f.endsWith('-full.jpg')).length;
      }

      portfolioPhotoCount += photoCount;
      portfolioCollections.push({
        name: dir.name.replace(/_/g, ' ').trim(),
        slug: collectionSlug,
        count: photoCount,
        hasPhotosJson
      });
    }

    // Read website photos.json
    const photosJsonWebPath = path.join(ARCHIVE_BASE, 'data', 'photos.json');
    let websitePhotoCount = 0;
    let websiteCollections = [];
    try {
      if (fsSync.existsSync(photosJsonWebPath)) {
        const data = JSON.parse(await fs.readFile(photosJsonWebPath, 'utf8'));
        websitePhotoCount = (data.photos || []).length;
        const collMap = {};
        for (const p of data.photos || []) {
          if (!collMap[p.collection]) collMap[p.collection] = 0;
          collMap[p.collection]++;
        }
        websiteCollections = Object.entries(collMap).map(([slug, count]) => ({ slug, count }));
      }
    } catch (e) {}

    // Get last deploy date from git log
    let lastDeployDate = null;
    try {
      const { execSync } = require('child_process');
      lastDeployDate = execSync('git log -1 --format=%ci -- data/photos.json', { cwd: ARCHIVE_BASE, encoding: 'utf8', timeout: 5000 }).trim();
    } catch (e) {}

    const pendingPhotos = portfolioPhotoCount - websitePhotoCount;

    return {
      portfolioPhotoCount,
      websitePhotoCount,
      pendingPhotos: Math.max(0, pendingPhotos),
      portfolioCollections,
      websiteCollections,
      lastDeployDate,
      needsDeploy: pendingPhotos > 0
    };
  } catch (err) {
    console.error('check-deploy-status failed:', err);
    return { error: err.message };
  }
});

// ===================
// WEBSITE DEPLOY
// ===================

ipcMain.handle('deploy-website', async () => {
  try {
    const DATA_DIR = path.join(ARCHIVE_BASE, 'data');
    const IMAGES_DIR = path.join(ARCHIVE_BASE, 'images');

    const sendProgress = (step, message, current = 0, total = 0) => {
      if (mainWindow) {
        mainWindow.webContents.send('deploy-progress', { step, message, current, total });
      }
    };

    // Phase 1: Scan portfolios
    sendProgress('scan', 'Scanning portfolios...');

    const entries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
    const portfolioDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'));

    // Read existing photos.json for fallback (hand-curated legacy data)
    let existingPhotosData = { photos: [] };
    const photosJsonWebPath = path.join(DATA_DIR, 'photos.json');
    try {
      if (fsSync.existsSync(photosJsonWebPath)) {
        existingPhotosData = JSON.parse(await fs.readFile(photosJsonWebPath, 'utf8'));
      }
    } catch (e) {}

    const allWebsitePhotos = [];
    const copyTasks = [];

    for (const dir of portfolioDirs) {
      const portfolioPath = path.join(PORTFOLIO_DIR, dir.name);
      const photosJsonPath = path.join(portfolioPath, '_photos.json');
      const galleryJsonPath = path.join(portfolioPath, '_gallery.json');
      const webPath = path.join(portfolioPath, 'web');

      // Get gallery metadata
      let gallery = {};
      try {
        if (fsSync.existsSync(galleryJsonPath)) {
          gallery = JSON.parse(await fs.readFile(galleryJsonPath, 'utf8'));
        }
      } catch (e) {}

      const folderSlug = dir.name.toLowerCase().replace(/[_\s]+/g, '-').replace(/-+$/, '');
      const collectionSlug = gallery.slug || folderSlug;
      const collectionTitle = (gallery.title || dir.name.replace(/_/g, ' ')).replace(/,.*$/, '').trim();
      const collectionLocation = formatLocation(gallery.location) || '';

      if (fsSync.existsSync(photosJsonPath)) {
        // Has _photos.json — use Studio-ingested metadata
        sendProgress('scan', `Reading ${dir.name}...`);
        const photos = JSON.parse(await fs.readFile(photosJsonPath, 'utf8'));
        const prefix = collectionSlug.split('-').map(w => w[0]).join('').substring(0, 2);

        photos.forEach((photo, idx) => {
          const baseName = photo.filename.replace(/\.[^.]+$/, '');
          const thumbName = photo.thumbnail || `${baseName}-thumb.jpg`;
          const fullName = photo.full || `${baseName}-full.jpg`;

          allWebsitePhotos.push({
            id: `${prefix}-${String(idx + 1).padStart(3, '0')}`,
            filename: baseName,
            title: photo.title || baseName,
            description: photo.description || '',
            collection: collectionSlug,
            collectionTitle,
            tags: photo.tags || [],
            location: typeof photo.location === 'string' ? photo.location : collectionLocation,
            year: new Date().getFullYear(),
            thumbnail: `images/${collectionSlug}/${thumbName}`,
            full: `images/${collectionSlug}/${fullName}`,
            dimensions: photo.dimensions || null
          });

          // Queue image copies
          const destDir = path.join(IMAGES_DIR, collectionSlug);
          if (fsSync.existsSync(path.join(webPath, thumbName))) {
            copyTasks.push({ src: path.join(webPath, thumbName), dest: path.join(destDir, thumbName) });
          }
          if (fsSync.existsSync(path.join(webPath, fullName))) {
            copyTasks.push({ src: path.join(webPath, fullName), dest: path.join(destDir, fullName) });
          }
        });
      } else {
        // No _photos.json — use existing hand-curated data/photos.json entries
        const existingForCollection = existingPhotosData.photos.filter(p =>
          p.collection === collectionSlug || p.collection === folderSlug
        );
        if (existingForCollection.length > 0) {
          allWebsitePhotos.push(...existingForCollection);
        }

        // Still copy web images to ensure sync
        if (fsSync.existsSync(webPath)) {
          try {
            const webFiles = await fs.readdir(webPath);
            const destDir = path.join(IMAGES_DIR, collectionSlug);
            for (const wf of webFiles) {
              if (/\.(jpg|jpeg|png|webp)$/i.test(wf)) {
                copyTasks.push({ src: path.join(webPath, wf), dest: path.join(destDir, wf) });
              }
            }
          } catch (e) {}
        }
      }
    }

    // Phase 2: Copy images
    sendProgress('images', 'Copying images to website...', 0, copyTasks.length);

    const targetDirs = new Set(copyTasks.map(t => path.dirname(t.dest)));
    for (const d of targetDirs) {
      await fs.mkdir(d, { recursive: true });
    }

    let copied = 0;
    for (const task of copyTasks) {
      try {
        await fs.copyFile(task.src, task.dest);
        copied++;
        if (copied % 5 === 0 || copied === copyTasks.length) {
          sendProgress('images', `Syncing image files: ${copied}/${copyTasks.length} (${Math.ceil(copied/2)} photos)`, copied, copyTasks.length);
        }
      } catch (e) {
        console.warn('Copy failed:', task.src, e.message);
      }
    }

    // Phase 3: C2PA Verification
    sendProgress('c2pa', 'Verifying Content Credentials...');
    let c2paSigned = 0;
    let c2paUnsigned = 0;
    for (const dir of portfolioDirs) {
      const portfolioPath = path.join(PORTFOLIO_DIR, dir.name);
      const photosJsonPath = path.join(portfolioPath, '_photos.json');
      if (fsSync.existsSync(photosJsonPath)) {
        try {
          const photos = JSON.parse(await fs.readFile(photosJsonPath, 'utf8'));
          for (const p of photos) {
            if (p.c2pa) c2paSigned++; else c2paUnsigned++;
          }
        } catch (e) {}
      }
    }
    sendProgress('c2pa', c2paUnsigned > 0
      ? `C2PA: ${c2paSigned}/${c2paSigned + c2paUnsigned} signed (${c2paUnsigned} unsigned)`
      : `C2PA: All ${c2paSigned} photos have Content Credentials`);

    // Phase 4: R2 Verification
    sendProgress('r2', 'Checking R2 cloud backup...');
    let r2Status = 'unknown';
    try {
      // Check if R2 env vars are configured
      const hasR2 = process.env.R2_ACCESS_KEY_ID && process.env.R2_BUCKET_NAME;
      if (hasR2) {
        r2Status = 'configured';
        sendProgress('r2', 'R2 cloud storage configured');
      } else {
        r2Status = 'unconfigured';
        sendProgress('r2', '\u26A0 R2 not configured — originals not backed up to cloud');
      }
    } catch (e) {
      r2Status = 'error';
      sendProgress('r2', 'R2 check failed: ' + e.message);
    }

    // Phase 5: Write photos.json
    sendProgress('data', 'Writing photo data...');
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(photosJsonWebPath, JSON.stringify({ photos: allWebsitePhotos }, null, 2));

    // Phase 4: Git operations
    sendProgress('git', 'Committing changes...');
    const { execSync } = require('child_process');
    const gitOpts = { cwd: ARCHIVE_BASE, encoding: 'utf8', timeout: 30000 };

    // Clean up stale git lock files before any git operation
    const lockFiles = [
      '.git/HEAD.lock',
      '.git/index.lock',
      '.git/refs/heads/main.lock'
    ];
    for (const lockFile of lockFiles) {
      const lockPath = path.join(ARCHIVE_BASE, lockFile);
      try {
        if (fsSync.existsSync(lockPath)) {
          fsSync.unlinkSync(lockPath);
          console.log(`Removed stale lock: ${lockFile}`);
        }
      } catch (e) { /* lock file doesn't exist or already removed */ }
    }

    try {
      execSync('git add data/photos.json images/', gitOpts);

      // Check if there are staged changes before committing
      const gitStatus = execSync('git diff --cached --stat', gitOpts).trim();
      if (gitStatus) {
        const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        execSync(`git commit -m "Deploy: update photos — ${dateStr}"`, gitOpts);
      } else {
        console.log('No changes to commit — skipping git commit');
      }

      sendProgress('push', 'Pushing to GitHub...');
      execSync('git push origin main', { ...gitOpts, timeout: 60000 });

      const noNewContent = copied === 0;

      // Verify website is live with updated content
      sendProgress('verify', 'Waiting for website to update...');
      let verified = false;
      const maxAttempts = 20; // ~60 seconds max
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          sendProgress('verify', `Checking website... (attempt ${attempt}/${maxAttempts})`);
          const resp = await fetch('https://archive-35.com/data/photos.json', { timeout: 8000 });
          if (resp.ok) {
            const liveData = await resp.json();
            const liveCount = Array.isArray(liveData?.photos) ? liveData.photos.length : (Array.isArray(liveData) ? liveData.length : 0);
            if (liveCount >= allWebsitePhotos.length) {
              sendProgress('verify', `Website verified — ${liveCount} photos live`);
              verified = true;
              break;
            } else {
              sendProgress('verify', `Website has ${liveCount}/${allWebsitePhotos.length} photos — waiting for CDN...`);
            }
          }
        } catch (fetchErr) {
          sendProgress('verify', `Website not ready yet... (attempt ${attempt}/${maxAttempts})`);
        }
        // Wait 3 seconds between attempts
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      const verifyMsg = verified ? '' : ' (website may still be updating)';
      sendProgress('done', noNewContent
        ? `All ${allWebsitePhotos.length} photos already deployed.${verifyMsg}`
        : `Deploy complete! ${allWebsitePhotos.length} photos published (${copied} synced).${verifyMsg}`);

      return {
        success: true,
        verified,
        photosPublished: allWebsitePhotos.length,
        imagesCopied: copied,
        c2paSigned,
        c2paUnsigned,
        r2Status,
        message: noNewContent
           ? `All ${allWebsitePhotos.length} photos already deployed.${verifyMsg}`
           : `Deployed ${allWebsitePhotos.length} photos to archive-35.com (${copied} synced)${verifyMsg}`
      };
    } catch (gitErr) {
      const errMsg = (gitErr.stderr || '') + (gitErr.stdout || '') + (gitErr.message || '');
      sendProgress('error', `Git error: ${errMsg}`);
      return {
        success: false,
        error: `Git operation failed: ${errMsg}`,
        photosPublished: allWebsitePhotos.length,
        imagesCopied: copied,
        c2paSigned,
        c2paUnsigned,
        r2Status
      };
    }

  } catch (err) {
    console.error('deploy-website failed:', err);
    if (mainWindow) {
      mainWindow.webContents.send('deploy-progress', { step: 'error', message: err.message });
    }
    return { success: false, error: err.message };
  }
});

// ===================
// SERVICE STATUS CHECKS
// ===================

// ===== AUTO-SCAN PHOTOGRAPHY FOLDER =====

function normalizeForMatch(str) {
  return str.toLowerCase().trim()
    .replace(/[_\-\s:]+/g, '')
    .replace(/[àáäâ]/g, 'a').replace(/[èéëê]/g, 'e')
    .replace(/[ìíïî]/g, 'i').replace(/[òóöô]/g, 'o')
    .replace(/[ùúüû]/g, 'u').replace(/ñ/g, 'n').replace(/ç/g, 'c');
}

function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i][j - 1], dp[i - 1][j]);
    }
  }
  return dp[m][n];
}

function calculateSimilarity(a, b) {
  const na = normalizeForMatch(a), nb = normalizeForMatch(b);
  if (!na.length || !nb.length) return 0;
  const dist = levenshteinDistance(na, nb);
  return Math.max(0, (1 - dist / Math.max(na.length, nb.length)) * 100);
}

ipcMain.handle('scan-photography', async () => {
  try {
    const PHOTOGRAPHY_DIR = path.join(ARCHIVE_BASE, 'Photography');
    if (!fsSync.existsSync(PHOTOGRAPHY_DIR)) {
      return { success: false, error: 'Photography folder not found' };
    }

    // Load scan config
    const configPath = path.join(PORTFOLIO_DIR, '.scan-config.json');
    let config = { excludeFolders: [], aliasMap: {} };
    try {
      if (fsSync.existsSync(configPath)) {
        config = JSON.parse(fsSync.readFileSync(configPath, 'utf8'));
      }
    } catch (e) {}

    // Always exclude licensing source folders from gallery scan
    // These go through the licensing pipeline (09_Licensing/), not gallery ingest
    const LICENSING_EXCLUSIONS = [
      'Large Scale Photography Stitch',
      'large-scale-photography-stitch',
      'Licensing',
      'licensing'
    ];
    const userExcludes = config.excludeFolders || [];
    config.excludeFolders = [...new Set([...userExcludes, ...LICENSING_EXCLUSIONS])];

    // Normalize alias map keys
    const aliasMap = {};
    for (const [key, val] of Object.entries(config.aliasMap || {})) {
      aliasMap[normalizeForMatch(key)] = val;
    }

    // Get existing portfolios
    const portfolioEntries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
    const portfolios = portfolioEntries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => {
        const originalsDir = path.join(PORTFOLIO_DIR, e.name, 'originals');
        let originalsMap = {};
        if (fsSync.existsSync(originalsDir)) {
          try {
            const files = fsSync.readdirSync(originalsDir).filter(f => /\.(jpg|jpeg|tiff|tif|png)$/i.test(f));
            files.forEach(f => {
              try {
                originalsMap[f] = fsSync.statSync(path.join(originalsDir, f)).mtime.getTime();
              } catch (e) {}
            });
          } catch (e) {}
        }
        return { folderName: e.name, originalsMap };
      });

    // Scan Photography subfolders
    const photoEntries = await fs.readdir(PHOTOGRAPHY_DIR, { withFileTypes: true });
    const scanResults = [];

    for (const entry of photoEntries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if ((config.excludeFolders || []).includes(entry.name)) continue;

      const folderPath = path.join(PHOTOGRAPHY_DIR, entry.name);

      // Send progress
      if (mainWindow) {
        mainWindow.webContents.send('scan-progress', { message: `Scanning: ${entry.name}` });
      }

      // Get image files
      let imageFiles = [];
      try {
        const allFiles = await fs.readdir(folderPath);
        imageFiles = allFiles.filter(f => /\.(jpg|jpeg|tiff|tif|png)$/i.test(f));
      } catch (e) {}

      if (imageFiles.length === 0) {
        scanResults.push({
          folderName: entry.name, path: folderPath, status: 'empty',
          match: null, counts: { new: 0, updated: 0, existing: 0 },
          newFiles: [], updatedFiles: []
        });
        continue;
      }

      // Try alias match first
      const normalizedName = normalizeForMatch(entry.name);
      let matchedPortfolio = null;
      let matchConfidence = 0;
      let matchMethod = null;

      if (aliasMap[normalizedName]) {
        const aliasTarget = aliasMap[normalizedName];
        const found = portfolios.find(p => p.folderName === aliasTarget);
        if (found) {
          matchedPortfolio = found;
          matchConfidence = 100;
          matchMethod = 'alias';
        }
      }

      // Fuzzy match if no alias
      if (!matchedPortfolio) {
        let bestScore = 0;
        let bestMatch = null;
        for (const p of portfolios) {
          const score = calculateSimilarity(entry.name, p.folderName);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = p;
          }
        }
        if (bestMatch && bestScore >= 60) {
          matchedPortfolio = bestMatch;
          matchConfidence = Math.round(bestScore);
          matchMethod = 'fuzzy';
        }
      }

      // Compare files
      const newFiles = [];
      const updatedFiles = [];
      let existingCount = 0;

      const originalsMap = matchedPortfolio ? matchedPortfolio.originalsMap : {};

      for (const filename of imageFiles) {
        const filePath = path.join(folderPath, filename);
        let fileMtime;
        try { fileMtime = fsSync.statSync(filePath).mtime.getTime(); } catch (e) { continue; }

        if (!originalsMap[filename]) {
          newFiles.push({ filename, path: filePath });
        } else if (fileMtime > originalsMap[filename]) {
          updatedFiles.push({ filename, path: filePath });
        } else {
          existingCount++;
        }
      }

      // Determine status
      let status = 'up-to-date';
      if (!matchedPortfolio) status = 'new-gallery';
      else if (newFiles.length > 0 || updatedFiles.length > 0) status = 'has-updates';

      scanResults.push({
        folderName: entry.name,
        path: folderPath,
        status,
        match: matchedPortfolio ? {
          portfolioFolder: matchedPortfolio.folderName,
          confidence: matchConfidence,
          method: matchMethod
        } : null,
        counts: { new: newFiles.length, updated: updatedFiles.length, existing: existingCount },
        newFiles,
        updatedFiles
      });
    }

    // Sort: new-gallery first, then has-updates, then up-to-date, then empty
    const statusOrder = { 'new-gallery': 0, 'has-updates': 1, 'up-to-date': 2, 'empty': 3 };
    scanResults.sort((a, b) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4));

    return {
      success: true,
      scanResults,
      summary: {
        totalFolders: scanResults.length,
        newGalleries: scanResults.filter(r => r.status === 'new-gallery').length,
        withUpdates: scanResults.filter(r => r.status === 'has-updates').length,
        upToDate: scanResults.filter(r => r.status === 'up-to-date').length,
        empty: scanResults.filter(r => r.status === 'empty').length,
        totalNewPhotos: scanResults.reduce((s, r) => s + r.counts.new, 0),
        totalUpdatedPhotos: scanResults.reduce((s, r) => s + r.counts.updated, 0)
      }
    };
  } catch (err) {
    console.error('scan-photography failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('check-service-status', async (event, service) => {
  try {
    const { execSync } = require('child_process');
    const env = parseEnvFile();

    switch (service) {
      case 'github': {
        try {
          const output = execSync('git ls-remote --exit-code origin', {
            cwd: ARCHIVE_BASE,
            encoding: 'utf8',
            timeout: 10000
          });
          return { status: 'ok', message: 'Connected to GitHub' };
        } catch (err) {
          return { status: 'error', message: 'Failed to connect to GitHub' };
        }
      }

      case 'cloudflare': {
        try {
          const response = await fetch('https://archive-35.com/data/photos.json', { method: 'HEAD', timeout: 5000 });
          if (response.ok) {
            return { status: 'ok', message: `Site responding (${response.status})` };
          } else {
            return { status: 'warning', message: `Site returned ${response.status}` };
          }
        } catch (err) {
          return { status: 'error', message: 'Could not reach archive-35.com' };
        }
      }

      case 'stripe': {
        if (!env.STRIPE_SECRET_KEY) {
          return { status: 'error', message: 'API key not configured' };
        }
        return { status: 'ok', message: 'API key configured' };
      }

      case 'r2': {
        if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_ENDPOINT || !env.R2_BUCKET_NAME) {
          return { status: 'error', message: 'R2 configuration incomplete' };
        }
        try {
          const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
          const s3 = new S3Client({
            region: 'auto',
            endpoint: env.R2_ENDPOINT,
            credentials: {
              accessKeyId: env.R2_ACCESS_KEY_ID,
              secretAccessKey: env.R2_SECRET_ACCESS_KEY,
            },
          });
          const result = await s3.send(new ListObjectsV2Command({ Bucket: env.R2_BUCKET_NAME, MaxKeys: 1 }));
          return { status: 'ok', message: `Bucket accessible (${result.KeyCount || 0} objects)` };
        } catch (err) {
          return { status: 'error', message: 'Could not access R2 bucket' };
        }
      }

      case 'c2pa': {
        const pythonCandidates = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3'];
        let foundPython = null;
        for (const py of pythonCandidates) {
          try {
            execSync(`${py} -c "import c2pa"`, { timeout: 5000, stdio: 'ignore' });
            foundPython = py;
            break;
          } catch { /* try next */ }
        }
        if (!foundPython) {
          return { status: 'error', message: 'c2pa-python not installed. Run: pip3 install c2pa-python' };
        }
        const c2paDir = require('path').join(ARCHIVE_BASE, '07_C2PA');
        const hasCerts = require('fs').existsSync(require('path').join(c2paDir, 'chain.pem'))
          && require('fs').existsSync(require('path').join(c2paDir, 'signer_pkcs8.key'));
        if (!hasCerts) {
          return { status: 'error', message: 'c2pa-python installed but certificates missing in 07_C2PA/' };
        }
        return { status: 'ok', message: `c2pa-python + certificates ready (${foundPython})` };
      }

      case 'anthropic': {
        if (!env.ANTHROPIC_API_KEY) {
          return { status: 'error', message: 'API key not configured' };
        }
        try {
          const Anthropic = require('@anthropic-ai/sdk');
          const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
          const resp = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'OK' }]
          });
          return { status: 'ok', message: 'API key valid' };
        } catch (err) {
          return { status: 'error', message: 'API key invalid or connection failed' };
        }
      }

      default:
        return { status: 'error', message: 'Unknown service' };
    }
  } catch (err) {
    console.error(`Service check failed for ${service}:`, err);
    return { status: 'error', message: `Check failed: ${err.message}` };
  }
});

ipcMain.handle('check-all-services', async (event) => {
  const { execSync } = require('child_process');
  const env = parseEnvFile();
  const results = {};

  // Helper function to check individual services
  const checkService = async (service) => {
    try {
      switch (service) {
        case 'github': {
          try {
            execSync('git ls-remote --exit-code origin', {
              cwd: ARCHIVE_BASE,
              encoding: 'utf8',
              timeout: 10000
            });
            return { status: 'ok', message: 'Connected to GitHub' };
          } catch (err) {
            return { status: 'error', message: 'Failed to connect to GitHub' };
          }
        }

        case 'cloudflare': {
          try {
            const response = await fetch('https://archive-35.com/data/photos.json', { method: 'HEAD', timeout: 5000 });
            if (response.ok) {
              return { status: 'ok', message: `Site responding (${response.status})` };
            } else {
              return { status: 'warning', message: `Site returned ${response.status}` };
            }
          } catch (err) {
            return { status: 'error', message: 'Could not reach archive-35.com' };
          }
        }

        case 'stripe': {
          if (!env.STRIPE_SECRET_KEY) {
            return { status: 'error', message: 'API key not configured' };
          }
          return { status: 'ok', message: 'API key configured' };
        }

        case 'r2': {
          if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_ENDPOINT || !env.R2_BUCKET_NAME) {
            return { status: 'error', message: 'R2 configuration incomplete' };
          }
          try {
            const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
            const s3 = new S3Client({
              region: 'auto',
              endpoint: env.R2_ENDPOINT,
              credentials: {
                accessKeyId: env.R2_ACCESS_KEY_ID,
                secretAccessKey: env.R2_SECRET_ACCESS_KEY,
              },
            });
            const result = await s3.send(new ListObjectsV2Command({ Bucket: env.R2_BUCKET_NAME, MaxKeys: 1 }));
            return { status: 'ok', message: `Bucket accessible (${result.KeyCount || 0} objects)` };
          } catch (err) {
            return { status: 'error', message: 'Could not access R2 bucket' };
          }
        }

        case 'c2pa': {
          const pythonCandidates2 = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3'];
          let foundPy = null;
          for (const py of pythonCandidates2) {
            try {
              execSync(`${py} -c "import c2pa"`, { timeout: 5000, stdio: 'ignore' });
              foundPy = py;
              break;
            } catch { /* try next */ }
          }
          if (!foundPy) {
            return { status: 'error', message: 'c2pa-python not installed. Run: pip3 install c2pa-python' };
          }
          const c2paDir2 = require('path').join(ARCHIVE_BASE, '07_C2PA');
          const hasCerts2 = require('fs').existsSync(require('path').join(c2paDir2, 'chain.pem'))
            && require('fs').existsSync(require('path').join(c2paDir2, 'signer_pkcs8.key'));
          if (!hasCerts2) {
            return { status: 'error', message: 'c2pa-python installed but certificates missing in 07_C2PA/' };
          }
          return { status: 'ok', message: `c2pa-python + certificates ready (${foundPy})` };
        }

        case 'anthropic': {
          if (!env.ANTHROPIC_API_KEY) {
            return { status: 'error', message: 'API key not configured' };
          }
          try {
            const Anthropic = require('@anthropic-ai/sdk');
            const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
            const resp = await client.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 10,
              messages: [{ role: 'user', content: 'OK' }]
            });
            return { status: 'ok', message: 'API key valid' };
          } catch (err) {
            return { status: 'error', message: 'API key invalid or connection failed' };
          }
        }

        default:
          return { status: 'error', message: 'Unknown service' };
      }
    } catch (err) {
      console.error(`Service check failed for ${service}:`, err);
      return { status: 'error', message: `Check failed: ${err.message}` };
    }
  };

  const services = ['github', 'cloudflare', 'stripe', 'r2', 'c2pa', 'anthropic'];
  for (const service of services) {
    results[service] = await checkService(service);
  }

  return results;
});

// ===================
// GOOGLE ANALYTICS
// ===================

ipcMain.handle('get-analytics-config', async () => {
  const env = parseEnvFile();
  const measurementId = env.GOOGLE_ANALYTICS_ID || '';
  const propertyId = env.GOOGLE_ANALYTICS_PROPERTY_ID || '';
  const configured = !!(measurementId && propertyId);

  return {
    configured,
    measurementId,
    propertyId,
    streamId: '13580866536',
    accountId: '193131448',
    message: configured
      ? 'GA4 property configured. Data collection started.'
      : 'Google Analytics not configured. Add GOOGLE_ANALYTICS_ID and GOOGLE_ANALYTICS_PROPERTY_ID to .env'
  };
});

ipcMain.handle('get-analytics-data', async () => {
  try {
    const env = parseEnvFile();

    // ==================
    // 1. GA4 Status
    // ==================
    const measurementId = env.GOOGLE_ANALYTICS_ID || '';
    const propertyId = env.GOOGLE_ANALYTICS_PROPERTY_ID || '';
    const ga4Configured = !!(measurementId && propertyId);

    const ga4Data = {
      configured: ga4Configured,
      measurementId,
      propertyId,
      message: ga4Configured
        ? 'GA4 configured. Data collection enabled.'
        : 'GA4 not configured. Add GOOGLE_ANALYTICS_ID and GOOGLE_ANALYTICS_PROPERTY_ID to .env'
    };

    // ==================
    // 2. Stripe Revenue Data
    // ==================
    let stripeData = {
      configured: false,
      revenue: 0,
      orderCount: 0,
      averageOrder: 0,
      period: 'Last 30 days',
      error: null
    };

    const stripeSecretKey = env.STRIPE_SECRET_KEY;
    if (stripeSecretKey) {
      stripeData.configured = true;
      try {
        const stripe = require('stripe')(stripeSecretKey);

        // Fetch charges from last 30 days
        const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
        const charges = await stripe.charges.list({
          created: { gte: thirtyDaysAgo },
          limit: 100
        });

        // Calculate metrics
        let totalRevenue = 0;
        let successfulCharges = 0;

        for (const charge of charges.data) {
          // Only count successful charges
          if (charge.paid && !charge.refunded) {
            totalRevenue += charge.amount;
            successfulCharges++;
          }
        }

        // Convert from cents to dollars
        const revenue = totalRevenue / 100;
        const orderCount = successfulCharges;
        const averageOrder = orderCount > 0 ? revenue / orderCount : 0;

        stripeData = {
          configured: true,
          revenue: Math.round(revenue * 100) / 100,
          orderCount,
          averageOrder: Math.round(averageOrder * 100) / 100,
          period: 'Last 30 days'
        };

        console.log(`Stripe: ${orderCount} orders, $${revenue.toFixed(2)} revenue, avg $${averageOrder.toFixed(2)}`);
      } catch (stripeErr) {
        console.warn('Stripe data fetch failed:', stripeErr.message);
        stripeData.error = stripeErr.message;
      }
    } else {
      stripeData.error = 'STRIPE_SECRET_KEY not configured';
    }

    // ==================
    // 3. Cloudflare Web Analytics Data
    // ==================
    let cloudflareData = {
      configured: false,
      pageViews: 0,
      uniqueVisitors: 0,
      topPages: [],
      topReferrers: [],
      period: 'Last 7 days',
      error: null
    };

    const cloudflareToken = env.CLOUDFLARE_ANALYTICS_TOKEN;
    const accountId = env.R2_ACCOUNT_ID; // b7491e0a2209add17e1f4307eb77c991
    const siteTag = env.CLOUDFLARE_ZONE_TAG || '951402c170604a77bedfd24b90e2ec0d';

    if (cloudflareToken && accountId) {
      try {
        // Cloudflare Web Analytics uses RUM (Real User Monitoring) dataset
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const dateGte = sevenDaysAgo.toISOString().split('.')[0] + 'Z';
        const dateLte = now.toISOString().split('.')[0] + 'Z';

        const query = `query {
          viewer {
            accounts(filter: { accountTag: "${accountId}" }) {
              topPages: rumPageloadEventsAdaptiveGroups(
                filter: {
                  AND: [
                    { datetime_geq: "${dateGte}" }
                    { datetime_leq: "${dateLte}" }
                    { OR: [{ siteTag: "${siteTag}" }] }
                  ]
                }
                limit: 10
                orderBy: [sum_visits_DESC]
              ) {
                count
                sum {
                  visits
                }
                dimensions {
                  path: requestPath
                }
              }
              topReferrers: rumPageloadEventsAdaptiveGroups(
                filter: {
                  AND: [
                    { datetime_geq: "${dateGte}" }
                    { datetime_leq: "${dateLte}" }
                    { OR: [{ siteTag: "${siteTag}" }] }
                  ]
                }
                limit: 10
                orderBy: [sum_visits_DESC]
              ) {
                count
                sum {
                  visits
                }
                dimensions {
                  refererHost
                }
              }
            }
          }
        }`;

        const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cloudflareToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query })
        });

        if (!response.ok) {
          throw new Error(`Cloudflare API returned ${response.status}`);
        }

        const result = await response.json();

        if (result.errors && result.errors.length > 0) {
          throw new Error(result.errors[0].message);
        }

        const accountData = result.data?.viewer?.accounts?.[0];
        if (accountData) {
          // Process page views data
          let totalPageViews = 0;
          let totalVisits = 0;
          const topPages = [];

          if (accountData.topPages && accountData.topPages.length > 0) {
            for (const group of accountData.topPages) {
              const visits = group.sum?.visits || 0;
              const count = group.count || 0;
              totalVisits += visits;
              totalPageViews += count;

              topPages.push({
                path: group.dimensions?.path || '/',
                views: count,
                visitors: visits
              });
            }
          }

          // Process referrer data
          const topReferrers = [];
          if (accountData.topReferrers && accountData.topReferrers.length > 0) {
            for (const group of accountData.topReferrers) {
              const referrer = group.dimensions?.refererHost;
              if (referrer && referrer !== '' && referrer !== 'archive-35.com') {
                topReferrers.push({
                  source: referrer,
                  visits: group.sum?.visits || group.count || 0
                });
              }
            }
          }

          cloudflareData = {
            configured: true,
            pageViews: totalPageViews,
            uniqueVisitors: totalVisits,
            topPages: topPages.slice(0, 5),
            topReferrers: topReferrers.slice(0, 5),
            period: 'Last 7 days'
          };

          console.log(`Cloudflare: ${totalPageViews} page views, ${totalVisits} visits`);
        } else {
          // API returned data but no account match
          cloudflareData.configured = true;
          cloudflareData.pageViews = 0;
          cloudflareData.uniqueVisitors = 0;
          console.log('Cloudflare: No data yet (site may be new)');
        }
      } catch (cfErr) {
        console.warn('Cloudflare data fetch failed:', cfErr.message);
        cloudflareData.error = cfErr.message;
      }
    } else {
      if (!cloudflareToken) {
        cloudflareData.error = 'CLOUDFLARE_ANALYTICS_TOKEN not configured';
      } else if (!accountId) {
        cloudflareData.error = 'R2_ACCOUNT_ID (Cloudflare Account ID) not configured';
      }
    }

    // Return combined data
    return {
      ga4: ga4Data,
      cloudflare: cloudflareData,
      stripe: stripeData
    };

  } catch (err) {
    console.error('get-analytics-data failed:', err);
    return {
      ga4: { configured: false, error: err.message },
      cloudflare: { configured: false, error: err.message },
      stripe: { configured: false, error: err.message }
    };
  }
});

// ===========================================
// STRIPE PROMOTION CODE MANAGEMENT
// ===========================================

/**
 * Makes authenticated requests to the Stripe API.
 * Automatically selects test or live secret key based on current mode.
 */
async function stripeApiRequest(method, endpoint, body = null) {
  const env = parseEnvFile();
  const mode = getCurrentMode();
  const secretKey = mode === 'test'
    ? (env.STRIPE_TEST_SECRET_KEY || env.STRIPE_SECRET_KEY)
    : env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error(`No Stripe ${mode} secret key configured. Check .env file.`);
  }

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }
  };

  if (body && (method === 'POST' || method === 'DELETE')) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value));
      }
    }
    options.body = params.toString();
  }

  const url = method === 'GET' && endpoint.includes('?')
    ? `https://api.stripe.com/v1${endpoint}`
    : `https://api.stripe.com/v1${endpoint}`;

  const response = await fetch(url, options);
  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }

  return data;
}

// List all coupons
ipcMain.handle('stripe-list-coupons', async () => {
  try {
    return { success: true, data: await stripeApiRequest('GET', '/coupons?limit=100') };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Create a coupon (the discount definition)
ipcMain.handle('stripe-create-coupon', async (event, data) => {
  try {
    const body = {};

    // Discount type
    if (data.percentOff) {
      body.percent_off = data.percentOff;
    } else if (data.amountOff) {
      body.amount_off = Math.round(data.amountOff * 100); // Convert dollars to cents
      body.currency = 'usd';
    }

    // Duration: once, repeating, or forever
    body.duration = data.duration || 'once';
    if (data.duration === 'repeating' && data.durationInMonths) {
      body.duration_in_months = data.durationInMonths;
    }

    // Display name
    if (data.name) body.name = data.name;

    // Max redemptions (total across all promo codes using this coupon)
    if (data.maxRedemptions) body.max_redemptions = data.maxRedemptions;

    // Expiration (Unix timestamp)
    if (data.redeemBy) body.redeem_by = data.redeemBy;

    // Internal metadata
    if (data.clientName) body['metadata[client_name]'] = data.clientName;
    if (data.clientEmail) body['metadata[client_email]'] = data.clientEmail;
    if (data.notes) body['metadata[notes]'] = data.notes;
    if (data.tier) body['metadata[tier]'] = data.tier;

    const result = await stripeApiRequest('POST', '/coupons', body);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Delete a coupon (also invalidates all associated promotion codes)
ipcMain.handle('stripe-delete-coupon', async (event, couponId) => {
  try {
    const result = await stripeApiRequest('DELETE', `/coupons/${encodeURIComponent(couponId)}`);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// List all promotion codes (customer-facing codes)
ipcMain.handle('stripe-list-promo-codes', async () => {
  try {
    const result = await stripeApiRequest('GET', '/promotion_codes?limit=100&expand[]=data.coupon');
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Create a promotion code (the customer-facing code string linked to a coupon)
ipcMain.handle('stripe-create-promo-code', async (event, data) => {
  try {
    const body = {
      coupon: data.couponId,
      code: data.code.toUpperCase().replace(/[^A-Z0-9-_]/g, ''),
    };

    if (data.maxRedemptions) body.max_redemptions = data.maxRedemptions;
    if (data.expiresAt) body.expires_at = data.expiresAt;
    if (data.firstTimeOnly) body['restrictions[first_time_transaction]'] = 'true';

    // Metadata for internal tracking
    if (data.clientName) body['metadata[client_name]'] = data.clientName;
    if (data.clientEmail) body['metadata[client_email]'] = data.clientEmail;
    if (data.notes) body['metadata[notes]'] = data.notes;

    const result = await stripeApiRequest('POST', '/promotion_codes', body);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Deactivate a promotion code (cannot be reactivated)
ipcMain.handle('stripe-deactivate-promo-code', async (event, promoId) => {
  try {
    const result = await stripeApiRequest('POST', `/promotion_codes/${promoId}`, { active: 'false' });
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ===========================================
// FOLDER SYNC (One-way: Source → Destination)
// ===========================================

const SYNC_CONFIG_FILE = path.join(ARCHIVE_BASE, '.studio-sync-config.json');

function readSyncConfig() {
  try {
    if (fsSync.existsSync(SYNC_CONFIG_FILE)) {
      return JSON.parse(fsSync.readFileSync(SYNC_CONFIG_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to read sync config:', err.message);
  }
  return null;
}

function writeSyncConfig(config) {
  fsSync.writeFileSync(SYNC_CONFIG_FILE, JSON.stringify(config, null, 2));
}

ipcMain.handle('get-sync-config', async () => {
  return readSyncConfig();
});

ipcMain.handle('save-sync-config', async (event, data) => {
  try {
    const existing = readSyncConfig() || {};
    const config = {
      ...existing,
      sourceFolder: data.sourceFolder,
      destFolder: data.destFolder,
      deleteOrphans: data.deleteOrphans || false,
    };
    writeSyncConfig(config);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Recursively walk a directory and return all file paths (relative to root).
 */
async function walkDir(dirPath, relativeTo = dirPath) {
  const entries = [];
  const items = await fs.readdir(dirPath, { withFileTypes: true });
  for (const item of items) {
    // Skip hidden files/folders (., .., .DS_Store, etc.)
    if (item.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      const subEntries = await walkDir(fullPath, relativeTo);
      entries.push(...subEntries);
    } else if (item.isFile()) {
      entries.push(path.relative(relativeTo, fullPath));
    }
  }
  return entries;
}

ipcMain.handle('run-folder-sync', async (event, data) => {
  const { sourceFolder, destFolder, deleteOrphans } = data;
  const startTime = Date.now();

  // Validate folders
  if (!sourceFolder || !destFolder) {
    return { success: false, error: 'Source and destination folders are required.' };
  }
  if (!fsSync.existsSync(sourceFolder)) {
    return { success: false, error: `Source folder not found: ${sourceFolder}` };
  }

  try {
    // Phase 1: Scan source
    mainWindow?.webContents.send('sync-progress', {
      phase: 'scanning', message: 'Scanning source folder...', percent: 0
    });

    const sourceFiles = await walkDir(sourceFolder);
    const totalFiles = sourceFiles.length;

    if (totalFiles === 0) {
      mainWindow?.webContents.send('sync-progress', {
        phase: 'complete', message: 'Source folder is empty — nothing to sync.',
        copied: 0, skipped: 0, deleted: 0, errors: 0, totalFiles: 0,
        duration: Date.now() - startTime
      });
      return { success: true };
    }

    // Phase 2: Copy new/updated files
    let copied = 0, skipped = 0, errors = 0;

    for (let i = 0; i < sourceFiles.length; i++) {
      const relPath = sourceFiles[i];
      const srcPath = path.join(sourceFolder, relPath);
      const dstPath = path.join(destFolder, relPath);

      try {
        const srcStat = await fs.stat(srcPath);
        let needCopy = false;

        try {
          const dstStat = await fs.stat(dstPath);
          // Copy if source is newer or different size
          if (srcStat.mtimeMs > dstStat.mtimeMs || srcStat.size !== dstStat.size) {
            needCopy = true;
          }
        } catch {
          // Dest doesn't exist — need copy
          needCopy = true;
        }

        if (needCopy) {
          // Ensure destination directory exists
          await fs.mkdir(path.dirname(dstPath), { recursive: true });
          await fs.copyFile(srcPath, dstPath);
          // Preserve modification time
          await fs.utimes(dstPath, srcStat.atime, srcStat.mtime);
          copied++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`Sync error for ${relPath}:`, err.message);
        errors++;
      }

      // Progress update every 10 files or on last file
      if (i % 10 === 0 || i === sourceFiles.length - 1) {
        const percent = Math.round(((i + 1) / totalFiles) * (deleteOrphans ? 80 : 100));
        mainWindow?.webContents.send('sync-progress', {
          phase: 'copying',
          message: `Copying: ${relPath}`,
          percent,
          current: i + 1,
          total: totalFiles,
        });
      }
    }

    // Phase 3: Delete orphans (optional)
    let deleted = 0;
    if (deleteOrphans) {
      mainWindow?.webContents.send('sync-progress', {
        phase: 'cleanup', message: 'Checking for orphaned files in destination...', percent: 85
      });

      try {
        const destFiles = await walkDir(destFolder);
        const sourceSet = new Set(sourceFiles);

        for (const relPath of destFiles) {
          if (!sourceSet.has(relPath)) {
            try {
              await fs.unlink(path.join(destFolder, relPath));
              deleted++;
            } catch (err) {
              console.error(`Delete error for ${relPath}:`, err.message);
              errors++;
            }
          }
        }
      } catch (err) {
        console.error('Orphan cleanup error:', err.message);
      }
    }

    // Save last sync time
    const config = readSyncConfig() || {};
    config.lastSync = new Date().toISOString();
    writeSyncConfig(config);

    // Complete
    const duration = Date.now() - startTime;
    mainWindow?.webContents.send('sync-progress', {
      phase: 'complete',
      message: `Sync complete. ${copied} copied, ${skipped} up to date${deleted > 0 ? `, ${deleted} deleted` : ''}.`,
      percent: 100,
      copied, skipped, deleted, errors, totalFiles, duration
    });

    return { success: true, copied, skipped, deleted, errors, totalFiles, duration };

  } catch (err) {
    mainWindow?.webContents.send('sync-progress', {
      phase: 'error', message: err.message
    });
    return { success: false, error: err.message };
  }
});
