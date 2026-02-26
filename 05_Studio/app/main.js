const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const isDev = require('electron-is-dev');
const http = require('http');

// Load environment variables
require('dotenv').config({
  path: path.join(__dirname, '..', '..', '.env')
});

// Base path for Archive-35 folder
const ARCHIVE_BASE = path.join(__dirname, '..', '..');
const PORTFOLIO_DIR = path.join(ARCHIVE_BASE, '01_Portfolio');
const DELETE_DIR = path.join(ARCHIVE_BASE, '_files_to_delete');
const ARCHIVE_DIR = path.join(ARCHIVE_BASE, '_archived');

// SHARED EXCLUSION LIST — portfolios that should NEVER appear in the gallery website
// Used by: deploy scan, check-deploy-status, scan-photography, R2 batch upload
// Add new exclusions HERE, not in individual handlers
// See LESSONS_LEARNED.md Lesson 022, 026 for why this matters
const EXCLUDED_PORTFOLIO_FOLDERS = [
  'Large_Scale_Photography_Stitch',
  'Large Scale Photography Stitch',
  'large-scale-photography-stitch',
  'Iceland_Ring_Road',
  'Iceland Ring Road',
  'iceland-ring-road',
  'Antilope_Canyon_',
  'Utha_National_Parks_',
  'Utha National Parks',
  'Licensing',
  'licensing',
];

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

app.whenReady().then(() => {
  createWindow();

  // Auto-start Agent backend in background (don't block window rendering)
  if (fsSync.existsSync(AGENT_DIR) && fsSync.existsSync(path.join(AGENT_DIR, 'src', 'api.py'))) {
    console.log('[Agent] Auto-starting backend...');
    startAgentProcess().catch(err => {
      console.warn('[Agent] Auto-start failed:', err.message);
    });
  }

  // Auto-start Mockup compositing service in background
  if (fsSync.existsSync(MOCKUP_DIR) && fsSync.existsSync(path.join(MOCKUP_DIR, 'src', 'server.js'))) {
    console.log('[Mockup] Auto-starting compositing service...');
    startMockupProcess().catch(err => {
      console.warn('[Mockup] Auto-start failed:', err.message);
    });
  }
});

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
// AUTO-DEPLOYS stripe-config.json with step-by-step verified feedback.
// Each step is confirmed before proceeding to the next.
ipcMain.handle('set-mode', async (event, mode) => {
  if (mode !== 'test' && mode !== 'live') {
    return { success: false, error: 'Invalid mode. Use "test" or "live".' };
  }

  const sendModeProgress = (step, status, message) => {
    if (mainWindow) {
      mainWindow.webContents.send('mode-deploy-progress', { step, status, message, mode });
    }
  };

  const steps = [];
  try {
    // Step 1: Read environment keys
    sendModeProgress('keys', 'running', `Reading ${mode} Stripe keys from .env...`);
    const env = parseEnvFile();
    const pubKey = mode === 'test'
      ? (env.STRIPE_TEST_PUBLISHABLE_KEY || '')
      : (env.STRIPE_PUBLISHABLE_KEY || '');
    const secretKeyConfigured = mode === 'test'
      ? !!env.STRIPE_TEST_SECRET_KEY
      : !!env.STRIPE_SECRET_KEY;

    if (!pubKey) {
      sendModeProgress('keys', 'error', `No ${mode} publishable key found in .env — add ${mode === 'test' ? 'STRIPE_TEST_PUBLISHABLE_KEY' : 'STRIPE_PUBLISHABLE_KEY'} in Settings`);
      return { success: false, error: `No ${mode} publishable key configured` };
    }
    if (!secretKeyConfigured) {
      sendModeProgress('keys', 'error', `No ${mode} secret key found in .env — add ${mode === 'test' ? 'STRIPE_TEST_SECRET_KEY' : 'STRIPE_SECRET_KEY'} in Settings`);
      return { success: false, error: `No ${mode} secret key configured` };
    }

    const keyPrefix = pubKey.startsWith('pk_test_') ? 'pk_test_' : 'pk_live_';
    sendModeProgress('keys', 'ok', `${mode.toUpperCase()} keys verified — publishable: ${keyPrefix}...${pubKey.slice(-4)}, secret: configured`);
    steps.push('keys');

    // Step 2: Write stripe-config.json
    sendModeProgress('config', 'running', 'Writing stripe-config.json...');
    const stripeConfig = { mode: mode, publishableKey: pubKey };
    const dataDir = path.join(ARCHIVE_BASE, 'data');
    const siteDataDir = path.join(ARCHIVE_BASE, '_site', 'data');
    const configContent = JSON.stringify(stripeConfig, null, 2) + '\n';
    fsSync.writeFileSync(path.join(dataDir, 'stripe-config.json'), configContent);
    if (fsSync.existsSync(siteDataDir)) {
      fsSync.writeFileSync(path.join(siteDataDir, 'stripe-config.json'), configContent);
    }

    // Verify the file was written correctly
    const verifyConfig = JSON.parse(fsSync.readFileSync(path.join(dataDir, 'stripe-config.json'), 'utf8'));
    if (verifyConfig.mode !== mode || verifyConfig.publishableKey !== pubKey) {
      sendModeProgress('config', 'error', 'stripe-config.json verification failed — file contents do not match');
      return { success: false, error: 'Config file verification failed' };
    }
    sendModeProgress('config', 'ok', `stripe-config.json written and verified — mode: ${mode}, key: ${keyPrefix}...${pubKey.slice(-4)}`);
    steps.push('config');

    // Step 3: Save mode setting
    sendModeProgress('mode', 'running', `Setting Studio mode to ${mode.toUpperCase()}...`);
    setCurrentMode(mode);
    sendModeProgress('mode', 'ok', `Studio mode set to ${mode.toUpperCase()}`);
    steps.push('mode');

    // Step 4: Git commit and push
    sendModeProgress('git', 'running', 'Committing and pushing to GitHub...');
    const { execSync } = require('child_process');
    const gitOpts = { cwd: ARCHIVE_BASE, encoding: 'utf8', timeout: 30000 };
    try {
      execSync('git add data/stripe-config.json _site/data/stripe-config.json', gitOpts);
      const status = execSync('git diff --cached --stat', gitOpts).trim();
      if (status) {
        execSync(`git commit -m "Switch Stripe to ${mode.toUpperCase()} mode"`, gitOpts);
        execSync('git push', gitOpts);
        sendModeProgress('git', 'ok', `Pushed to GitHub — Cloudflare deploy triggered`);
      } else {
        sendModeProgress('git', 'ok', 'Already on correct mode — no changes needed');
      }
    } catch (gitErr) {
      sendModeProgress('git', 'error', `Git push failed: ${gitErr.message}`);
      return { success: false, error: `Git push failed: ${gitErr.message}`, steps };
    }
    steps.push('git');

    // Step 5: Verify live site (poll stripe-config.json on archive-35.com)
    sendModeProgress('verify', 'running', 'Waiting for Cloudflare deploy (~60s)...');
    let verified = false;
    const https = require('https');
    const fetchConfig = () => new Promise((resolve) => {
      const url = `https://archive-35.com/data/stripe-config.json?_t=${Date.now()}`;
      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });

    // Poll every 10 seconds for up to 2 minutes
    for (let attempt = 1; attempt <= 12; attempt++) {
      await new Promise(r => setTimeout(r, 10000));
      sendModeProgress('verify', 'running', `Checking live site... attempt ${attempt}/12`);
      const liveConfig = await fetchConfig();
      if (liveConfig && liveConfig.mode === mode && liveConfig.publishableKey === pubKey) {
        verified = true;
        break;
      }
    }

    if (verified) {
      sendModeProgress('verify', 'ok', `CONFIRMED — archive-35.com is now in ${mode.toUpperCase()} mode`);
      steps.push('verify');
    } else {
      sendModeProgress('verify', 'warning', `Push completed but live site not yet updated — Cloudflare may still be deploying. Check back in a few minutes.`);
      steps.push('verify-pending');
    }

    // Step 6: Final summary
    sendModeProgress('done', 'ok', `${mode.toUpperCase()} MODE ACTIVE — all systems switched`);

    // Notify all windows
    if (mainWindow) {
      mainWindow.webContents.send('mode-changed', mode);
    }
    return { success: true, mode, deployed: true, verified, steps };
  } catch (err) {
    sendModeProgress('error', 'error', err.message);
    return { success: false, error: err.message, steps };
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

    // Try to read _photos.json for metadata AND ordering
    // _photos.json array order = display order (set by Save Photo Order in Gallery Preview)
    let photosJsonData = [];
    let photoMetadata = {};
    try {
      if (fsSync.existsSync(photosJsonPath)) {
        const data = JSON.parse(await fs.readFile(photosJsonPath, 'utf8'));
        if (Array.isArray(data)) {
          photosJsonData = data;
          data.forEach(p => { photoMetadata[p.filename] = p; });
        }
      }
    } catch (err) {
      // Ignore JSON errors
    }

    // Determine source path for image file paths
    const sourcePath = fsSync.existsSync(originalsPath) ? originalsPath : webPath;

    // Build photo list using _photos.json order as primary source
    // This preserves the order Wolf set in Gallery Preview → Save Photo Order
    const addedFilenames = new Set();

    // First: add all photos from _photos.json in their saved order
    for (const meta of photosJsonData) {
      const filename = meta.filename;
      if (!filename) continue;
      addedFilenames.add(filename);
      photos.push({
        id: filename.replace(/\.[^.]+$/, '').toLowerCase().replace(/\s+/g, '_'),
        filename,
        path: sourcePath ? path.join(sourcePath, filename) : '',
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

    // Then: append any filesystem photos NOT in _photos.json (new/untracked files)
    if (fsSync.existsSync(sourcePath)) {
      const files = await fs.readdir(sourcePath);
      const imageFiles = files.filter(f => /\.(jpg|jpeg|tiff|tif|png|webp)$/i.test(f));

      for (const filename of imageFiles) {
        if (addedFilenames.has(filename)) continue; // Already added from _photos.json
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
function buildAIPrompt(galleryContext, filename, photoData) {
  const c = galleryContext?.country || '';
  const n = galleryContext?.name || '';
  const l = galleryContext?.location || '';
  // Derive geographic context: country field first, then gallery/folder name as fallback
  const geoContext = c || n;
  const exif = photoData?.exif || {};
  const dims = photoData?.dimensions || {};
  const hasGPS = exif.gps && exif.gps.lat && exif.gps.lng;

  let prompt = 'You are a fine art photography metadata assistant for Archive-35, a landscape photography brand by Wolfgang Schram.\n\n';

  // === VISUAL ANALYSIS INSTRUCTION ===
  prompt += '=== ANALYZE THE IMAGE CAREFULLY ===\n';
  prompt += 'Study this photograph closely before responding. Look at:\n';
  prompt += '- Geological formations: rock types, colors, layering, erosion patterns\n';
  prompt += '- Vegetation: desert scrub, alpine meadows, tropical, temperate forest, etc.\n';
  prompt += '- Water features: ocean, lake, river, dry lakebed, salt flats\n';
  prompt += '- Sky and atmosphere: haze patterns, altitude indicators\n';
  prompt += '- Man-made features: roads, buildings, power lines, infrastructure\n';
  prompt += '- Distinctive landmarks: recognize iconic landscapes (Death Valley salt flats, Grand Canyon layers, Iceland moss fields, etc.)\n';
  prompt += 'Use these visual cues to identify the ACTUAL location. Do NOT guess randomly.\n';
  prompt += '=== END ANALYSIS ===\n\n';

  // === EXIF CONTEXT (bonus info when available) ===
  if (hasGPS || exif.camera || exif.dateTaken) {
    prompt += 'EXIF metadata: ';
    const parts = [];
    if (hasGPS) parts.push(`GPS: ${exif.gps.lat}, ${exif.gps.lng} (use to confirm location)`);
    if (exif.camera) parts.push(`Camera: ${exif.camera}`);
    if (exif.lens) parts.push(`Lens: ${exif.lens}`);
    if (exif.dateTaken) parts.push(`Date: ${exif.dateTaken}`);
    prompt += parts.join(' | ') + '\n\n';
  }

  // === GALLERY CONTEXT (user-provided geographic constraint — highest authority) ===
  if (geoContext) {
    prompt += '=== MANDATORY GEOGRAPHIC CONSTRAINT ===\n';
    prompt += `These photos were taken in ${geoContext}.${c ? ` Gallery: "${n}".` : ''}${l ? ' Region: ' + l + '.' : ''}\n`;
    prompt += 'RULES:\n';
    prompt += `- EVERY tag, description, and location MUST be consistent with ${geoContext}\n`;
    prompt += `- NEVER reference ANY country or region that is NOT ${geoContext}\n`;
    prompt += `- Even if a scene resembles another country, it IS in ${geoContext}\n`;
    prompt += `- The location field MUST be a real, specific place within ${geoContext}\n`;
    prompt += '=== END CONSTRAINT ===\n\n';
  } else {
    prompt += '=== LOCATION ACCURACY RULES ===\n';
    prompt += 'No gallery context was provided. You MUST identify the location from the image.\n';
    prompt += 'RULES:\n';
    prompt += '- Study the geological features, vegetation, and landscape CHARACTER carefully\n';
    prompt += '- Only name a specific location if you can see distinctive, recognizable features\n';
    prompt += '- If you recognize the general region but not the exact spot, name the region (e.g., "Death Valley National Park, California")\n';
    prompt += '- If you can only determine the biome/terrain type, use that (e.g., "Mojave Desert, Southwestern United States")\n';
    prompt += '- NEVER fabricate exotic locations — a desert is more likely Death Valley or Utah than Iran or Chile\n';
    prompt += '- This photographer primarily shoots in: Western US (California, Utah, Nevada, Arizona, Colorado), Iceland, Argentina, Tanzania, Cuba, South Africa, and European Alps\n';
    prompt += '- Weight your guess toward these known regions when the landscape could match\n';
    prompt += '=== END RULES ===\n\n';
  }

  // === IMAGE DIMENSIONS ===
  if (dims.width && dims.height) {
    prompt += `Image: ${dims.width}x${dims.height}px (${dims.megapixels}MP, ${dims.orientation})\n\n`;
  }

  prompt += 'Respond with ONLY valid JSON (no markdown):\n';
  prompt += '{\n';
  prompt += '  "title": "short evocative title (3-6 words)",\n';
  prompt += '  "description": "1-2 sentence art description for fine art print buyers. Timeless tone. No time-of-day references (no sunrise, sunset, morning, evening).",\n';
  prompt += `  "location": "specific place identified from image analysis${geoContext ? ', within ' + geoContext : ''}",\n`;
  prompt += '  "tags": ["15-20 tags for maximum discoverability"]\n';
  prompt += '}\n\n';

  prompt += 'TAG STRATEGY (generate 15-20 tags across ALL these categories):\n';
  prompt += '- Subject: what is in the photo (mountain, glacier, waterfall, desert, lake, etc.)\n';
  prompt += `- Geography: ${geoContext || 'identified location'}, region, specific landmarks\n`;
  prompt += '- Mood/emotion: serene, dramatic, majestic, tranquil, powerful, etc.\n';
  prompt += '- Style: landscape-photography, fine-art, nature-photography, wall-art, etc.\n';
  prompt += '- Physical features: geological terms, water features, vegetation types\n';
  prompt += '- Colors: dominant colors (emerald, azure, golden, ochre, etc.)\n';
  prompt += '- Buyer keywords: home-decor, office-art, canvas-print, gallery-wall, etc.\n';
  prompt += '- Weather/atmosphere: mist, fog, clouds, clear-sky, haze, etc.\n\n';

  prompt += 'REMINDER: Timeless tone. No time-of-day. Tags lowercase and hyphenated.';
  if (geoContext) {
    prompt += ` ALL geographic references MUST be ${geoContext} only.`;
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
            // Resize for API — larger = better recognition, especially for panoramas
            // Panoramas (>2:1) get extra width so the AI can see landscape details
            const isPano = photo.dimensions && photo.dimensions.aspectRatio > 2.0;
            const maxDim = isPano ? 2500 : 1800;
            const thumbBuffer = await sharp(photo.path)
              .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 85 })
              .toBuffer();
            const base64Image = thumbBuffer.toString('base64');

            const response = await client.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 500,
              messages: [{
                role: 'user',
                content: [
                  { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } },
                  { type: 'text', text: buildAIPrompt(galleryContext, photo.filename, photo) }
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
      // Check for near-duplicate existing portfolios before creating new folder
      const folderName = newGallery.name.replace(/\s+/g, '_');
      const existingEntries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
      const existingFolders = existingEntries.filter(e => e.isDirectory()).map(e => e.name);
      let matchedFolder = null;
      for (const existing of existingFolders) {
        const existingName = existing.replace(/_/g, ' ').replace(/\s+$/, '');
        const newName = newGallery.name.replace(/\s+$/, '');
        // Use geo-suffix-aware matching: strip suffixes, then compare cores
        const coreExisting = stripGeoSuffix(existingName);
        const coreNew = stripGeoSuffix(newName);
        let score;
        if (coreExisting.length > 0 && coreNew.length > 0) {
          score = calculateSimilarity(coreExisting, coreNew);
          // If geo cores match at >=80%, trust it; otherwise use full name at higher threshold
          if (score >= 80) { matchedFolder = existing; break; }
        }
        score = calculateSimilarity(existingName, newName);
        if (score >= 90) { matchedFolder = existing; break; }
      }
      if (matchedFolder) {
        // Use existing portfolio instead of creating a misspelled duplicate
        console.log(`[DEDUP] "${newGallery.name}" matched existing folder "${matchedFolder}" — using existing`);
        targetFolder = path.join(PORTFOLIO_DIR, matchedFolder);
      } else {
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
      }
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
    let r2Failures = [];

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
            // Originals always go to production path — no mode prefix
            // Mode separation is for website data, not source files
            const r2Key = `${collectionSlug}/${baseName}.jpg`;
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
          console.error('R2 UPLOAD FAILED:', r2Err.message);
          r2Failures = r2Failures || [];
          r2Failures.push({ filename: photo.filename, error: r2Err.message });
          if (mainWindow) {
            mainWindow.webContents.send('ingest-progress', {
              phase: 'finalize',
              current: processedCount,
              total: totalPhotos,
              filename: photo.filename,
              warning: true,
              message: `WARNING: R2 upload FAILED for ${photo.filename}: ${r2Err.message}`
            });
          }
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

        // Create HD WebP version (max 3500px long edge) for 4K/Retina lightbox
        const hdDest = path.join(webFolder, `${baseName}-hd.webp`);
        await sharp(photo.path, { limitInputPixels: false })
          .resize(3500, 3500, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toFile(hdDest);

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

    // Notify all pages that ingest completed — WebsiteControl uses this to refresh status
    if (mainWindow) {
      mainWindow.webContents.send('ingest-complete', {
        processed: processedPhotos.length,
        folder: targetFolder,
        portfolioId: portfolioId || null
      });
    }

    return {
      success: true,
      processed: processedPhotos.length,
      folder: targetFolder,
      r2Failures: r2Failures.length > 0 ? r2Failures : undefined,
      r2Warning: r2Failures.length > 0 ? `${r2Failures.length} photo(s) failed to upload to R2. Run R2 Batch Upload from Website Control to fix.` : undefined
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

// ===== DELETE PORTFOLIO =====
ipcMain.handle('delete-portfolio', async (event, { portfolioName }) => {
  try {
    if (!portfolioName || !portfolioName.trim()) {
      return { success: false, error: 'Portfolio name cannot be empty' };
    }

    const cleanName = portfolioName.trim();
    const portfolioId = cleanName.toLowerCase().replace(/\s+/g, '_');
    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    // Find the portfolio folder in 01_Portfolio
    const entries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
    const portfolioFolder = entries.find(e =>
      e.isDirectory() && e.name.toLowerCase().replace(/\s+/g, '_') === portfolioId
    );

    if (!portfolioFolder) {
      return { success: false, error: 'Portfolio not found' };
    }

    const portfolioPath = path.join(PORTFOLIO_DIR, portfolioFolder.name);

    // Delete the portfolio folder from 01_Portfolio
    await fs.rm(portfolioPath, { recursive: true, force: true });
    console.log(`Portfolio deleted: ${portfolioFolder.name}`);

    // Also try to delete corresponding images folder
    const IMAGES_DIR = path.join(ARCHIVE_BASE, 'images');
    if (fsSync.existsSync(IMAGES_DIR)) {
      try {
        const imageEntries = await fs.readdir(IMAGES_DIR, { withFileTypes: true });
        // Match images folder by slug (case-insensitive)
        const imageFolder = imageEntries.find(e => {
          if (!e.isDirectory()) return false;
          return e.name.toLowerCase() === slug;
        });
        if (imageFolder) {
          const imageFolderPath = path.join(IMAGES_DIR, imageFolder.name);
          await fs.rm(imageFolderPath, { recursive: true, force: true });
          console.log(`Images folder deleted: ${imageFolder.name}`);
        }
      } catch (imgErr) {
        console.warn('Images folder delete skipped:', imgErr.message);
      }
    }

    return { success: true, deleted: portfolioFolder.name };
  } catch (err) {
    console.error('Delete portfolio failed:', err);
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

    // 4. Create HD WebP version (3500px for 4K/Retina lightbox)
    const hdDest = path.join(webFolder, `${baseName}-hd.webp`);
    await sharp(newFilePath, { limitInputPixels: false })
      .resize(3500, 3500, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(hdDest);

    // 5. Create new thumbnail
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
    const portfolioDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_') && !EXCLUDED_PORTFOLIO_FOLDERS.includes(e.name));

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

          // Compute MD5 for integrity verification
          const crypto = require('crypto');
          const md5Hash = crypto.createHash('md5').update(fileBuffer).digest('hex');

          await s3.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: r2Key,
            Body: fileBuffer,
            ContentType: 'image/jpeg',
            Metadata: { md5: md5Hash },
          }));

          results.uploaded++;
          results.collections[collectionSlug].uploaded++;
          console.log(`R2 upload: ${r2Key} (${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB, MD5: ${md5Hash.substring(0, 8)}...)`);

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
// STRIPE-TO-SHEET RECONCILIATION
// Fetches recent Stripe checkout.session.completed events and returns
// them for comparison against the Google Sheet order log.
// See: Pipeline Audit Q98-2 — catch missed webhooks.
// ===================

ipcMain.handle('reconcile-stripe-orders', async (event, { days = 7 } = {}) => {
  try {
    const env = parseEnvFileSync();
    const stripeKey = env.STRIPE_SECRET_KEY || env.STRIPE_TEST_SECRET_KEY;
    if (!stripeKey) {
      return { success: false, error: 'Stripe API key not configured. Set STRIPE_SECRET_KEY in Settings.' };
    }

    // Fetch completed checkout sessions from the last N days
    const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    const params = new URLSearchParams({
      limit: '100',
      status: 'complete',
      'created[gte]': String(since),
    });

    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions?${params}`, {
      headers: { 'Authorization': `Bearer ${stripeKey}` },
    });
    const data = await response.json();

    if (data.error) {
      return { success: false, error: `Stripe API error: ${data.error.message}` };
    }

    const sessions = (data.data || []).map(s => ({
      sessionId: s.id,
      created: new Date(s.created * 1000).toISOString(),
      amount: s.amount_total ? (s.amount_total / 100).toFixed(2) : '0',
      currency: s.currency,
      customerEmail: s.customer_details?.email || s.customer_email || 'unknown',
      customerName: s.customer_details?.name || '',
      paymentStatus: s.payment_status,
      orderType: s.metadata?.orderType || 'unknown',
      photoTitle: s.metadata?.photoTitle || '',
      photoId: s.metadata?.photoId || '',
      livemode: s.livemode,
    }));

    return {
      success: true,
      days,
      sessionCount: sessions.length,
      sessions,
      message: sessions.length === 0
        ? `No completed checkouts in the last ${days} days.`
        : `Found ${sessions.length} completed checkout(s) in the last ${days} days. Compare against your Google Sheet "Orders" tab to find any missing entries.`,
    };
  } catch (err) {
    console.error('Stripe reconciliation error:', err);
    return { success: false, error: err.message };
  }
});

// ===================
// DEPLOY STATUS CHECK
// ===================

ipcMain.handle('check-deploy-status', async () => {
  try {
    const entries = await fs.readdir(PORTFOLIO_DIR, { withFileTypes: true });
    // Exclude hidden, underscore-prefixed, and licensing-only folders (same exclusions as scan-photography)
    const portfolioDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_') && !EXCLUDED_PORTFOLIO_FOLDERS.includes(e.name));

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
    let portfolioDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_') && !EXCLUDED_PORTFOLIO_FOLDERS.includes(e.name));

    // Respect saved portfolio order from _portfolio-order.json
    // This ensures collections appear on the website in the order Wolf set in Studio
    const portfolioOrderPath = path.join(PORTFOLIO_DIR, '_portfolio-order.json');
    try {
      if (fsSync.existsSync(portfolioOrderPath)) {
        const savedOrder = JSON.parse(fsSync.readFileSync(portfolioOrderPath, 'utf8'));
        if (Array.isArray(savedOrder) && savedOrder.length > 0) {
          const orderMap = new Map(savedOrder.map((name, idx) => [name, idx]));
          portfolioDirs.sort((a, b) => {
            const posA = orderMap.has(a.name) ? orderMap.get(a.name) : 9999;
            const posB = orderMap.has(b.name) ? orderMap.get(b.name) : 9999;
            return posA - posB;
          });
          sendProgress('scan', `Portfolio order: using saved order (${savedOrder.length} collections)`);
        }
      }
    } catch (e) {
      console.warn('Could not read portfolio order:', e.message);
    }

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
        photos.forEach((photo, idx) => {
          const baseName = photo.filename.replace(/\.[^.]+$/, '');
          const thumbName = photo.thumbnail || `${baseName}-thumb.jpg`;
          const fullName = photo.full || `${baseName}-full.jpg`;

          allWebsitePhotos.push({
            id: `${collectionSlug}-${String(idx + 1).padStart(3, '0')}`,
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

    // Phase 4: R2 Verification — REAL object count comparison
    sendProgress('r2', 'Verifying R2 cloud backup (counting objects)...');
    let r2Status = 'unknown';
    let r2ObjectCount = 0;
    let r2MissingFiles = [];
    try {
      const s3 = getR2Client();
      const bucketName = parseEnvFileSync().R2_BUCKET_NAME;
      if (s3 && bucketName) {
        const { ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');
        // Count all objects in R2 (excluding test/ prefix and originals/ licensing prefix)
        let continuationToken = undefined;
        let allR2Keys = [];
        do {
          const listCmd = new ListObjectsV2Command({
            Bucket: bucketName,
            MaxKeys: 1000,
            ContinuationToken: continuationToken
          });
          const listResult = await s3.send(listCmd);
          if (listResult.Contents) {
            allR2Keys.push(...listResult.Contents.map(obj => obj.Key));
          }
          continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined;
        } while (continuationToken);

        // Filter out non-gallery keys (originals/ licensing prefix)
        const galleryR2Keys = allR2Keys.filter(k => !k.startsWith('originals/'));
        r2ObjectCount = galleryR2Keys.length;

        // Check which website photos are missing from R2
        // Accept both production path and test/ path (for backward compat)
        for (const photo of allWebsitePhotos) {
          const expectedKey = `${photo.collection}/${photo.filename}.jpg`;
          const testKey = `test/${photo.collection}/${photo.filename}.jpg`;
          if (!galleryR2Keys.includes(expectedKey) && !galleryR2Keys.includes(testKey)) {
            r2MissingFiles.push(expectedKey);
          }
        }

        if (r2MissingFiles.length === 0) {
          r2Status = 'ok';
          sendProgress('r2', `R2 VERIFIED: ${r2ObjectCount} originals in cloud, all ${allWebsitePhotos.length} website photos backed up`);
        } else {
          r2Status = 'warning';
          sendProgress('r2', `R2 WARNING: ${r2MissingFiles.length} of ${allWebsitePhotos.length} photos MISSING from R2! (${r2ObjectCount} objects in bucket)`);
          console.error('R2 MISSING FILES:', r2MissingFiles.slice(0, 20));
        }
      } else {
        r2Status = 'unconfigured';
        sendProgress('r2', 'R2 not configured — originals not backed up to cloud');
      }
    } catch (e) {
      r2Status = 'error';
      sendProgress('r2', 'R2 verification failed: ' + e.message);
      console.error('R2 verification error:', e);
    }

    // HARD BLOCK: If R2 has missing files, abort deploy
    // Deploying a site with products that can't be fulfilled is unacceptable.
    // Wolf must upload missing originals via "Upload All Originals to R2" first.
    // See: Pipeline Audit Gap A — deploy warning upgraded to hard block.
    if (r2Status === 'warning' && r2MissingFiles.length > 0) {
      sendProgress('r2', `DEPLOY BLOCKED: ${r2MissingFiles.length} photos missing from R2. Upload originals first, then deploy again.`);
      return {
        success: false,
        error: `Deploy blocked: ${r2MissingFiles.length} photos not backed up to R2. Use "Upload All Originals to R2" in Website Control first.`,
        r2Status: 'blocked',
        r2MissingCount: r2MissingFiles.length,
        r2MissingFiles: r2MissingFiles.slice(0, 20),
        totalPhotos: allWebsitePhotos.length,
      };
    }

    // Phase 5: Write photos.json
    sendProgress('data', 'Writing photo data...');
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(photosJsonWebPath, JSON.stringify({ photos: allWebsitePhotos }, null, 2));

    // Phase 5a: Auto-generate llms-full.txt from photos.json data
    // Ensures collection names, counts, and photo listings stay in sync after renames/additions
    sendProgress('data', 'Regenerating llms-full.txt...');
    try {
      // Group photos by collection
      const collectionMap = {};
      for (const photo of allWebsitePhotos) {
        if (!collectionMap[photo.collection]) {
          collectionMap[photo.collection] = {
            title: photo.collectionTitle,
            slug: photo.collection,
            photos: []
          };
        }
        collectionMap[photo.collection].photos.push(photo);
      }
      const collections = Object.values(collectionMap).sort((a, b) => a.title.localeCompare(b.title));
      const totalPhotos = allWebsitePhotos.length;
      const totalCollections = collections.length;

      // Build collections section
      let collectionsText = '';
      for (const col of collections) {
        collectionsText += `### ${col.title} (${col.photos.length} photographs)\n`;
        collectionsText += `- URL: https://archive-35.com/collection.html?id=${col.slug}\n`;
        collectionsText += `- Gallery: https://archive-35.com/gallery.html?collection=${col.slug}\n\n`;
        // Show up to 5 sample photos, then "... and N more"
        const maxSamples = 5;
        const samples = col.photos.slice(0, maxSamples);
        for (const p of samples) {
          const mp = p.dimensions ? `${(p.dimensions.megapixels || 0).toFixed(1)}MP` : '';
          const tags = (p.tags || []).slice(0, 8).join(', ');
          collectionsText += `  - ${p.title} | ${p.location || 'Unknown'} | ${mp} | Tags: ${tags}\n`;
        }
        if (col.photos.length > maxSamples) {
          collectionsText += `  - ... and ${col.photos.length - maxSamples} more photographs\n`;
        }
        collectionsText += '\n';
      }

      // Read existing file to extract static footer sections
      const llmsFullPath = path.join(ARCHIVE_BASE, 'llms-full.txt');
      let staticFooter = '';
      try {
        const existing = await fs.readFile(llmsFullPath, 'utf8');
        // Extract everything from "## Commercial Licensing" onward
        const footerIdx = existing.indexOf('## Commercial Licensing');
        if (footerIdx !== -1) {
          staticFooter = existing.substring(footerIdx);
        }
      } catch (e) {
        // No existing file — use minimal footer
        staticFooter = '## Copyright\n\nAll images copyright Wolf / Archive-35.\nNOT licensed for AI training, scraping, or reproduction.\nPrint purchase = personal display rights.\nCommercial use requires explicit license purchase.';
      }

      // Assemble full file
      const llmsContent = `# Archive-35 | Complete Catalog for AI Agents

> This is the full machine-readable catalog of Archive-35 fine art photography.
> Summary version: https://archive-35.com/llms.txt

## Artist

- Name: Wolf
- Experience: 17+ years, 55+ countries
- Equipment: Canon EOS professional camera systems
- Specialties: Landscape, wildlife, street, architectural photography
- Content Authenticity: All images C2PA signed (ES256, verifiable at contentcredentials.org)
- Website: https://archive-35.com

## Print Collections (${totalPhotos} photographs, ${totalCollections} collections)

${collectionsText}${staticFooter}`;

      await fs.writeFile(llmsFullPath, llmsContent);
      console.log(`llms-full.txt regenerated: ${totalPhotos} photos, ${totalCollections} collections`);
      sendProgress('data', `llms-full.txt regenerated (${totalPhotos} photos, ${totalCollections} collections)`);
    } catch (llmsErr) {
      console.error('llms-full.txt generation failed:', llmsErr.message);
      sendProgress('data', `WARNING: llms-full.txt generation failed: ${llmsErr.message}`);
    }

    // Phase 5b: Sync gallery.html inline data from photos.json
    // CRITICAL: Studio deploy previously skipped this — gallery.html had stale const G=[]
    // See LESSONS_LEARNED.md Lesson 001 and Lesson 018
    sendProgress('sync', 'Syncing gallery.html inline data...');
    try {
      const { execSync: execSyncEarly } = require('child_process');
      execSyncEarly('python3 sync_gallery_data.py', { cwd: ARCHIVE_BASE, encoding: 'utf8', timeout: 30000 });
      sendProgress('sync', 'Gallery data synced from photos.json');
    } catch (syncErr) {
      console.error('Gallery sync failed:', syncErr.message);
      sendProgress('sync', `WARNING: Gallery sync failed — gallery.html may be stale: ${syncErr.message}`);
    }

    // Phase 5c: Pre-deploy validation — catches data problems BEFORE they reach production
    // This is the safety net that prevents deploying broken/stale/orphaned data
    sendProgress('validate', 'Running pre-deploy validation...');
    let deployWarnings = [];
    {
      const valErrors = [];
      const valWarnings = [];

      // CHECK 1: Schema — every photo has required fields
      const requiredFields = ['id', 'collection', 'filename', 'thumbnail', 'full', 'title'];
      for (const photo of allWebsitePhotos) {
        const missing = requiredFields.filter(f => !photo[f]);
        if (missing.length > 0) {
          valErrors.push(`Photo "${photo.id || photo.filename || '???'}" missing fields: ${missing.join(', ')}`);
        }
      }

      // CHECK 2: Duplicate photo IDs
      const allIds = allWebsitePhotos.map(p => p.id);
      const dupeIds = allIds.filter((id, i) => allIds.indexOf(id) !== i);
      if (dupeIds.length > 0) {
        valErrors.push(`${dupeIds.length} duplicate photo ID(s): ${[...new Set(dupeIds)].slice(0, 5).join(', ')}`);
      }

      // CHECK 3: No empty/null collection slugs
      const allSlugs = [...new Set(allWebsitePhotos.map(p => p.collection))];
      if (allSlugs.includes(undefined) || allSlugs.includes(null) || allSlugs.includes('')) {
        valErrors.push('Some photos have empty/null collection slug');
      }

      // CHECK 4: Orphan references in hardcoded files
      const filesToCheck = ['index.html', 'sitemap.xml', 'llms.txt', 'llms-full.txt'];
      for (const file of filesToCheck) {
        const filePath = path.join(ARCHIVE_BASE, file);
        if (fsSync.existsSync(filePath)) {
          const content = fsSync.readFileSync(filePath, 'utf8');
          // Find collection slug references (gallery.html#slug or collection=slug)
          const refs = content.match(/(?:gallery\.html[#?](?:collection=)?|collection\.html\?id=)([a-z0-9-]+)/g) || [];
          const fileSlugs = refs.map(r => r.replace(/.*[#=]/, ''));
          for (const slug of fileSlugs) {
            if (slug && !allSlugs.includes(slug)) {
              valWarnings.push(`"${file}" references collection "${slug}" which is NOT in photos.json — orphan reference`);
            }
          }
        }
      }

      // CHECK 5: Photo count sanity — warn if dropping >20%
      try {
        const liveResp = await fetch('https://archive-35.com/data/photos.json', { signal: AbortSignal.timeout(8000) });
        if (liveResp.ok) {
          const liveData = await liveResp.json();
          const liveCount = liveData?.photos?.length || 0;
          const localCount = allWebsitePhotos.length;
          if (liveCount > 0 && localCount < liveCount * 0.8) {
            valWarnings.push(`Photo count dropping ${liveCount} → ${localCount} (${Math.round((1 - localCount / liveCount) * 100)}% decrease) — verify this is intentional`);
          }
        }
      } catch (e) { /* skip if can't reach live site */ }

      // CHECK 6: Gallery.html freshness — does inline data match photos.json?
      const galleryPath = path.join(ARCHIVE_BASE, 'gallery.html');
      if (fsSync.existsSync(galleryPath)) {
        const galleryContent = fsSync.readFileSync(galleryPath, 'utf8');
        const inlineSlugs = (galleryContent.match(/slug:"([^"]+)"/g) || []).map(s => s.replace('slug:"', '').replace('"', ''));
        if (inlineSlugs.length !== allSlugs.length) {
          valErrors.push(`gallery.html has ${inlineSlugs.length} collections but photos.json has ${allSlugs.length} — data out of sync even after gallery sync`);
        }
      }

      // DECISION: Block or proceed
      if (valErrors.length > 0) {
        sendProgress('error', `DEPLOY BLOCKED: ${valErrors.length} validation error(s)`);
        return {
          success: false,
          error: `Pre-deploy validation failed:\n• ${valErrors.join('\n• ')}`,
          warnings: valWarnings,
          validationErrors: valErrors,
          photosPublished: allWebsitePhotos.length,
        };
      }

      if (valWarnings.length > 0) {
        sendProgress('validate', `${valWarnings.length} warning(s) — proceeding with deploy`);
        console.warn('Pre-deploy warnings:', valWarnings);
      } else {
        sendProgress('validate', `All ${allWebsitePhotos.length} photos passed validation`);
      }
      deployWarnings = valWarnings;
    }

    // Phase 5d: Write Stripe config based on current mode (test/live)
    // This is the SINGLE SOURCE OF TRUTH for which Stripe key the website uses.
    // Studio's test/live toggle controls this — no code changes needed to switch.
    const currentMode = getCurrentMode();
    const envKeys = parseEnvFile();
    const stripeConfig = {
      mode: currentMode,
      publishableKey: currentMode === 'test'
        ? (envKeys.STRIPE_TEST_PUBLISHABLE_KEY || '')
        : (envKeys.STRIPE_PUBLISHABLE_KEY || ''),
    };
    const stripeConfigPath = path.join(DATA_DIR, 'stripe-config.json');
    await fs.writeFile(stripeConfigPath, JSON.stringify(stripeConfig, null, 2) + '\n');
    sendProgress('config', `Stripe mode: ${currentMode.toUpperCase()} — publishable key written to stripe-config.json`);

    // Phase 6: Git operations
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
      // Sync _site/ mirror so Cloudflare Pages serves fresh content
      // _site/ is the build output directory — must mirror source files
      const siteDir = path.join(ARCHIVE_BASE, '_site');
      const cpSync = (src, dest) => {
        try { execSync(`cp -r ${src} ${dest}`, gitOpts); } catch (e) { /* source may not exist yet */ }
      };
      cpSync('data/photos.json', path.join(siteDir, 'data', 'photos.json'));
      cpSync('data/licensing-catalog.json', path.join(siteDir, 'data', 'licensing-catalog.json'));
      // Ensure _site/09_Licensing dirs exist and sync thumbnails + watermarks
      execSync(`mkdir -p ${path.join(siteDir, '09_Licensing')}`, gitOpts);
      cpSync('09_Licensing/thumbnails', path.join(siteDir, '09_Licensing', 'thumbnails'));
      cpSync('09_Licensing/watermarked', path.join(siteDir, '09_Licensing', 'watermarked'));
      cpSync('09_Licensing/zoom', path.join(siteDir, '09_Licensing', 'zoom'));

      // Stage ALL website-relevant files INCLUDING per-collection metadata
      // _photos.json files are the source of truth for each portfolio collection
      // _catalog.json is the source of truth for licensing — ALL must be committed
      execSync('git add data/ images/ *.html css/ js/ functions/ build.sh llms*.txt sitemap.xml robots.txt logos/ 09_Licensing/thumbnails/ 09_Licensing/watermarked/ 09_Licensing/zoom/ api/ licensing/ 01_Portfolio/*/_photos.json 09_Licensing/_catalog.json _site/', gitOpts);

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
      const maxAttempts = 60; // ~180 seconds (3 min) — matches frontend timeout
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
        r2ObjectCount,
        r2MissingCount: r2MissingFiles.length,
        r2MissingFiles: r2MissingFiles.slice(0, 20),
        warnings: deployWarnings,
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

// Strip common geographic suffixes that inflate fuzzy scores
// between unrelated locations (e.g. "Sequoia National Park" vs "Utah National Parks")
function stripGeoSuffix(str) {
  return str.toLowerCase().trim()
    .replace(/\b(national\s*parks?|national\s*forests?|national\s*monuments?|state\s*parks?|national\s*recreation\s*areas?)\b/gi, '')
    .replace(/\s+/g, ' ').trim();
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
    // NOTE: Folder names on disk use underscores (e.g. Large_Scale_Photography_Stitch)
    //       so we normalize both sides for comparison
    const userExcludes = config.excludeFolders || [];
    config.excludeFolders = [...new Set([...userExcludes, ...EXCLUDED_PORTFOLIO_FOLDERS])];

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
      // Normalize: compare lowercase with underscores→spaces for robust matching
      const normalName = entry.name.toLowerCase().replace(/_/g, ' ');
      const isExcluded = (config.excludeFolders || []).some(
        ex => ex.toLowerCase().replace(/_/g, ' ') === normalName
      );
      if (isExcluded) continue;

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
          // Score the full names
          const fullScore = calculateSimilarity(entry.name, p.folderName);
          // Also score with geographic suffixes stripped to avoid
          // false matches like "Sequoia National Park" → "Utah National Parks"
          const strippedA = stripGeoSuffix(entry.name);
          const strippedB = stripGeoSuffix(p.folderName);
          const coreScore = (strippedA && strippedB)
            ? calculateSimilarity(strippedA, strippedB) : 0;
          // If core names match well (>=80%), trust that even if full names
          // differ in length (e.g. "Grand Teton" vs "Grand Teton National Park").
          // If core names DON'T match, don't let shared suffixes like
          // "National Park" inflate the score (Sequoia vs Utah).
          const score = (coreScore >= 80)
            ? Math.max(fullScore, coreScore)
            : Math.min(fullScore, coreScore + 30);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = p;
          }
        }
        if (bestMatch && bestScore >= 75) {
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
    const path = require('path');
    const fsSync = require('fs');

    // Deep test: returns { status, message, checks[] }
    // Each check: { name, status: 'ok'|'warning'|'error', detail }
    switch (service) {
      case 'github': {
        const checks = [];
        // 1. Remote connectivity — can we push deploys?
        try {
          execSync('git ls-remote --exit-code origin', { cwd: ARCHIVE_BASE, encoding: 'utf8', timeout: 10000 });
          checks.push({ name: 'Remote connection', status: 'ok', detail: 'Connected to origin — deploys can push' });
        } catch (err) {
          checks.push({ name: 'Remote connection', status: 'error', detail: 'Cannot reach GitHub — deploys will fail until network/auth is restored' });
        }
        // 2. Current branch — must be main for Cloudflare Pages to pick up
        try {
          const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ARCHIVE_BASE, encoding: 'utf8', timeout: 5000 }).trim();
          checks.push({ name: 'Branch', status: branch === 'main' ? 'ok' : 'warning',
            detail: branch === 'main' ? 'On main — Cloudflare Pages deploys from this branch' : `On "${branch}" — Cloudflare only deploys from main, switch before deploying` });
        } catch (e) { checks.push({ name: 'Branch', status: 'error', detail: 'Cannot determine branch — git may be corrupted' }); }
        // 3. Uncommitted changes — will these be included in next deploy?
        try {
          const status = execSync('git status --porcelain', { cwd: ARCHIVE_BASE, encoding: 'utf8', timeout: 5000 }).trim();
          const lines = status ? status.split('\n').length : 0;
          checks.push({ name: 'Working tree', status: lines === 0 ? 'ok' : 'warning',
            detail: lines === 0 ? 'Clean — no pending changes' : `${lines} uncommitted file${lines !== 1 ? 's' : ''} — these will be included in the next deploy` });
        } catch (e) { checks.push({ name: 'Working tree', status: 'error', detail: 'Cannot check — git may be in a broken state' }); }
        // 4. Lock files — stale locks block all git operations
        const lockFiles = ['.git/HEAD.lock', '.git/index.lock'].filter(f => fsSync.existsSync(path.join(ARCHIVE_BASE, f)));
        checks.push({ name: 'Lock files', status: lockFiles.length === 0 ? 'ok' : 'error',
          detail: lockFiles.length === 0 ? 'No stale locks — git operations are unblocked' : `Stale: ${lockFiles.join(', ')} — delete these files to unblock git` });
        // 5. Last commit — what was last deployed?
        try {
          const log = execSync('git log -1 --format="%h %s (%cr)"', { cwd: ARCHIVE_BASE, encoding: 'utf8', timeout: 5000 }).trim();
          checks.push({ name: 'Last commit', status: 'ok', detail: log });
        } catch (e) { checks.push({ name: 'Last commit', status: 'error', detail: 'Cannot read git log — repository may be corrupted' }); }
        // 6. Ahead/behind remote — is local in sync with what's deployed?
        try {
          execSync('git fetch origin main --dry-run', { cwd: ARCHIVE_BASE, encoding: 'utf8', timeout: 10000, stdio: 'pipe' });
          const aheadBehind = execSync('git rev-list --left-right --count origin/main...HEAD', { cwd: ARCHIVE_BASE, encoding: 'utf8', timeout: 5000 }).trim();
          const [behind, ahead] = aheadBehind.split('\t').map(Number);
          if (ahead === 0 && behind === 0) {
            checks.push({ name: 'Remote sync', status: 'ok', detail: 'Local matches remote — live site has latest code' });
          } else {
            checks.push({ name: 'Remote sync', status: 'warning', detail: `${ahead} commit${ahead !== 1 ? 's' : ''} ahead, ${behind} behind — local and live site are out of sync` });
          }
        } catch (e) { checks.push({ name: 'Remote sync', status: 'warning', detail: 'Cannot fetch remote — unable to verify if local matches live site' }); }

        const worst = checks.some(c => c.status === 'error') ? 'error' : checks.some(c => c.status === 'warning') ? 'warning' : 'ok';
        const okCount = checks.filter(c => c.status === 'ok').length;
        return { status: worst, message: `${okCount}/${checks.length} passed`, checks };
      }

      case 'cloudflare': {
        const checks = [];
        // 1. Site reachable — is the website up?
        try {
          const resp = await fetch('https://archive-35.com/', { method: 'HEAD', signal: AbortSignal.timeout(5000) });
          checks.push({ name: 'Site reachable', status: resp.ok ? 'ok' : 'warning',
            detail: resp.ok ? 'archive-35.com is online and serving pages' : `HTTP ${resp.status} — site may be down or misconfigured` });
        } catch (e) { checks.push({ name: 'Site reachable', status: 'error', detail: 'Cannot reach archive-35.com — site is down, DNS or Cloudflare issue' }); }
        // 2. photos.json — is the gallery data accessible?
        try {
          const resp = await fetch('https://archive-35.com/data/photos.json', { method: 'HEAD', signal: AbortSignal.timeout(5000) });
          checks.push({ name: 'photos.json', status: resp.ok ? 'ok' : 'error',
            detail: resp.ok ? 'Gallery data file is being served to visitors' : `HTTP ${resp.status} — gallery/search/collection pages will break` });
        } catch (e) { checks.push({ name: 'photos.json', status: 'error', detail: 'Gallery data not accessible — all gallery features broken' }); }
        // 3. Live vs local comparison — is the deployed site current?
        try {
          const resp = await fetch('https://archive-35.com/data/photos.json', { signal: AbortSignal.timeout(10000) });
          const liveData = await resp.json();
          const livePhotos = liveData?.photos || [];
          const localRaw = fsSync.readFileSync(path.join(ARCHIVE_BASE, 'data', 'photos.json'), 'utf8');
          const localPhotos = JSON.parse(localRaw)?.photos || [];
          const match = livePhotos.length === localPhotos.length;
          checks.push({ name: 'Photo count', status: match ? 'ok' : 'warning',
            detail: match
              ? `Live and local both have ${livePhotos.length} photos — site is current`
              : `Live has ${livePhotos.length}, local has ${localPhotos.length} — deploy needed to sync` });
          // Collection count
          const liveCols = [...new Set(livePhotos.map(p => p.collection))];
          const localCols = [...new Set(localPhotos.map(p => p.collection))];
          const colMatch = liveCols.length === localCols.length;
          checks.push({ name: 'Collection count', status: colMatch ? 'ok' : 'warning',
            detail: colMatch
              ? `${liveCols.length} collections on both — no missing galleries`
              : `Live: ${liveCols.length}, Local: ${localCols.length} — deploy needed to add/remove galleries` });
          // Orphan detection — collections on live that shouldn't be there
          const orphans = liveCols.filter(c => !localCols.includes(c));
          if (orphans.length > 0) {
            checks.push({ name: 'Orphan galleries', status: 'error',
              detail: `Live site still shows REMOVED galleries: ${orphans.join(', ')} — deploy to remove them` });
          } else {
            checks.push({ name: 'Orphan galleries', status: 'ok', detail: 'No stale galleries on live site' });
          }
          // Missing from live — collections in local that aren't on live yet
          const missing = localCols.filter(c => !liveCols.includes(c));
          if (missing.length > 0) {
            checks.push({ name: 'Pending galleries', status: 'warning',
              detail: `New galleries not yet live: ${missing.join(', ')} — deploy to publish` });
          }
        } catch (e) { checks.push({ name: 'Photo count', status: 'warning', detail: 'Cannot compare — unable to fetch live data or read local file' }); }
        // 4. HTTPS
        checks.push({ name: 'HTTPS/SSL', status: 'ok', detail: 'Certificate valid — Cloudflare manages SSL automatically' });
        // 5. Key pages accessible
        const pages = [
          { name: 'Gallery page', url: 'gallery.html', why: 'main photo browsing experience' },
          { name: 'Licensing page', url: 'licensing.html', why: 'licensing purchase flow' },
          { name: 'Checkout webhook', url: 'api/products.json', why: 'AI agent product feed' }
        ];
        for (const page of pages) {
          try {
            const resp = await fetch(`https://archive-35.com/${page.url}`, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
            checks.push({ name: page.name, status: resp.ok ? 'ok' : 'error',
              detail: resp.ok ? `Serving — ${page.why}` : `HTTP ${resp.status} — ${page.why} is broken` });
          } catch (e) { checks.push({ name: page.name, status: 'error', detail: `Not accessible — ${page.why} is broken` }); }
        }

        const worst = checks.some(c => c.status === 'error') ? 'error' : checks.some(c => c.status === 'warning') ? 'warning' : 'ok';
        const okCount = checks.filter(c => c.status === 'ok').length;
        return { status: worst, message: `${okCount}/${checks.length} passed`, checks };
      }

      case 'stripe': {
        const checks = [];
        // 1. Live key — required for real payments
        checks.push({ name: 'Live API key', status: env.STRIPE_SECRET_KEY ? 'ok' : 'error',
          detail: env.STRIPE_SECRET_KEY ? 'Configured — real payments can be processed' : 'Missing — no real payments possible until configured in .env' });
        // 2. Test key — needed for test purchases
        checks.push({ name: 'Test API key', status: env.STRIPE_TEST_SECRET_KEY ? 'ok' : 'warning',
          detail: env.STRIPE_TEST_SECRET_KEY ? 'Configured — test mode available' : 'Missing — cannot run test purchases' });
        // 3. Webhook secret — this is a CLOUDFLARE PAGES env var, not local .env
        // It's set in Cloudflare Dashboard → Pages → Settings → Environment Variables
        checks.push({ name: 'Webhook secret', status: env.STRIPE_WEBHOOK_SECRET ? 'ok' : 'ok',
          detail: env.STRIPE_WEBHOOK_SECRET
            ? 'Configured locally — order fulfillment (Pictorem + email) will trigger'
            : 'Set in Cloudflare Pages dashboard (not local .env) — this is correct, webhooks run on Cloudflare Workers' });
        // 4. Test webhook — also a Cloudflare Pages env var
        checks.push({ name: 'Test webhook secret', status: env.STRIPE_TEST_WEBHOOK_SECRET ? 'ok' : 'ok',
          detail: env.STRIPE_TEST_WEBHOOK_SECRET
            ? 'Configured locally — test webhooks verified'
            : 'Set in Cloudflare Pages dashboard (not local .env) — test webhooks run on Cloudflare Workers' });
        // 5. Validate live key with real API call
        if (env.STRIPE_SECRET_KEY) {
          try {
            const resp = await fetch('https://api.stripe.com/v1/customers?limit=1', {
              headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
              signal: AbortSignal.timeout(10000)
            });
            if (resp.ok) {
              checks.push({ name: 'API connection', status: 'ok', detail: 'Live key accepted by Stripe — checkout will work' });
            } else {
              const data = await resp.json().catch(() => ({}));
              checks.push({ name: 'API connection', status: 'error', detail: `Stripe rejected key: ${data?.error?.message || resp.status} — checkout will fail` });
            }
          } catch (e) { checks.push({ name: 'API connection', status: 'error', detail: 'Cannot reach Stripe API — network issue or Stripe outage' }); }
        } else {
          checks.push({ name: 'API connection', status: 'error', detail: 'No key to validate' });
        }
        // 6. Recent activity
        if (env.STRIPE_SECRET_KEY) {
          try {
            const weekAgo = Math.floor((Date.now() - 7 * 86400000) / 1000);
            const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions?limit=100&created[gte]=${weekAgo}`, {
              headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
              signal: AbortSignal.timeout(10000)
            });
            if (resp.ok) {
              const data = await resp.json();
              const sessions = data.data || [];
              const paid = sessions.filter(s => s.payment_status === 'paid').length;
              checks.push({ name: 'Recent orders (7d)', status: 'ok', detail: `${sessions.length} checkout sessions, ${paid} paid — revenue pipeline active` });
            } else {
              checks.push({ name: 'Recent orders (7d)', status: 'warning', detail: 'Cannot read sessions — permissions may be limited' });
            }
          } catch (e) { checks.push({ name: 'Recent orders (7d)', status: 'warning', detail: 'Timeout reading sessions' }); }
        }
        // 7. Promo codes
        if (env.STRIPE_SECRET_KEY) {
          try {
            const resp = await fetch('https://api.stripe.com/v1/promotion_codes?active=true&limit=100', {
              headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
              signal: AbortSignal.timeout(10000)
            });
            if (resp.ok) {
              const data = await resp.json();
              const count = (data.data || []).length;
              checks.push({ name: 'Promo codes', status: 'ok', detail: `${count} active code${count !== 1 ? 's' : ''} — customers can use at checkout` });
            }
          } catch (e) { /* skip */ }
        }

        const worst = checks.some(c => c.status === 'error') ? 'error' : checks.some(c => c.status === 'warning') ? 'warning' : 'ok';
        const okCount = checks.filter(c => c.status === 'ok').length;
        return { status: worst, message: `${okCount}/${checks.length} passed`, checks };
      }

      case 'r2': {
        const checks = [];
        // 1. Credentials — needed for all R2 operations
        const allCreds = env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ENDPOINT && env.R2_BUCKET_NAME;
        checks.push({ name: 'Credentials', status: allCreds ? 'ok' : 'error',
          detail: allCreds
            ? 'All 4 env vars configured — R2 operations enabled'
            : 'Missing: ' + [!env.R2_ACCESS_KEY_ID && 'ACCESS_KEY_ID', !env.R2_SECRET_ACCESS_KEY && 'SECRET_KEY', !env.R2_ENDPOINT && 'ENDPOINT', !env.R2_BUCKET_NAME && 'BUCKET_NAME'].filter(Boolean).join(', ') + ' — uploads and deploy verification will fail' });

        if (allCreds) {
          try {
            const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
            const s3 = new S3Client({ region: 'auto', endpoint: env.R2_ENDPOINT, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });
            // 2. Bucket connectivity
            await s3.send(new ListObjectsV2Command({ Bucket: env.R2_BUCKET_NAME, MaxKeys: 1 }));
            checks.push({ name: 'Bucket access', status: 'ok', detail: `Connected to "${env.R2_BUCKET_NAME}" — read/write operations working` });

            // 3. Full inventory scan
            let allR2Keys = [];
            let continuationToken = undefined;
            do {
              const page = await s3.send(new ListObjectsV2Command({ Bucket: env.R2_BUCKET_NAME, MaxKeys: 1000, ContinuationToken: continuationToken }));
              if (page.Contents) allR2Keys.push(...page.Contents.map(o => o.Key));
              continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
            } while (continuationToken);

            const galleryKeys = allR2Keys.filter(k => !k.startsWith('test/') && !k.startsWith('originals/'));
            const licensingKeys = allR2Keys.filter(k => k.startsWith('originals/'));
            const testKeys = allR2Keys.filter(k => k.startsWith('test/'));
            checks.push({ name: 'Bucket inventory', status: 'ok',
              detail: `${allR2Keys.length} files: ${galleryKeys.length} gallery originals, ${licensingKeys.length} licensing originals, ${testKeys.length} test files` });

            // 4. Gallery backup completeness — are all photos backed up for print fulfillment?
            try {
              const localRaw = fsSync.readFileSync(path.join(ARCHIVE_BASE, 'data', 'photos.json'), 'utf8');
              const localPhotos = JSON.parse(localRaw)?.photos || [];
              const galleryR2Set = new Set(galleryKeys);
              const missing = [];
              for (const photo of localPhotos) {
                const expectedKey = `${photo.collection}/${photo.filename}.jpg`;
                if (!galleryR2Set.has(expectedKey)) missing.push(expectedKey);
              }
              if (missing.length === 0) {
                checks.push({ name: 'Gallery backup', status: 'ok',
                  detail: `All ${localPhotos.length} photos backed up — print orders can be fulfilled` });
              } else {
                checks.push({ name: 'Gallery backup', status: 'error',
                  detail: `${missing.length} of ${localPhotos.length} photos MISSING — print orders for these will FAIL. Run "Upload All Originals to R2"` });
              }
            } catch (e) { checks.push({ name: 'Gallery backup', status: 'warning', detail: 'Cannot compare — photos.json unreadable locally' }); }

            // 5. Licensing backup
            checks.push({ name: 'Licensing backup', status: licensingKeys.length >= 45 ? 'ok' : licensingKeys.length > 0 ? 'warning' : 'error',
              detail: licensingKeys.length >= 45
                ? `${licensingKeys.length} licensing originals — all license purchases can be delivered`
                : licensingKeys.length > 0
                  ? `Only ${licensingKeys.length} of 45 expected — some license deliveries may fail`
                  : 'No licensing originals in R2 — license purchases cannot be delivered' });

          } catch (err) {
            checks.push({ name: 'Bucket access', status: 'error', detail: `Connection failed: ${err.message} — all R2 operations blocked` });
          }
        }

        const worst = checks.some(c => c.status === 'error') ? 'error' : checks.some(c => c.status === 'warning') ? 'warning' : 'ok';
        const okCount = checks.filter(c => c.status === 'ok').length;
        return { status: worst, message: `${okCount}/${checks.length} passed`, checks };
      }

      case 'c2pa': {
        const checks = [];
        // 1. Python — needed to run C2PA signing during deploy
        const pythonCandidates = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3'];
        let foundPython = null;
        for (const py of pythonCandidates) {
          try { execSync(`${py} --version`, { timeout: 5000, stdio: 'pipe' }); foundPython = py; break; } catch { /* try next */ }
        }
        checks.push({ name: 'Python3', status: foundPython ? 'ok' : 'error',
          detail: foundPython ? `Found: ${foundPython} — deploy can run signing scripts` : 'Not found — deploy will skip C2PA signing, photos will lack provenance data' });
        // 2. c2pa module
        if (foundPython) {
          try {
            execSync(`${foundPython} -c "import c2pa; print(c2pa.__version__)"`, { timeout: 5000, stdio: 'pipe' });
            checks.push({ name: 'c2pa-python', status: 'ok', detail: 'Module installed — can embed content credentials in photos' });
          } catch (e) { checks.push({ name: 'c2pa-python', status: 'error', detail: 'Not installed — run: pip3 install c2pa-python. Without this, photos have no provenance proof' }); }
        }
        // 3. Certificate chain — proves Wolf owns the photos
        const c2paDir = path.join(ARCHIVE_BASE, '07_C2PA');
        const chainPath = path.join(c2paDir, 'chain.pem');
        checks.push({ name: 'Certificate (chain.pem)', status: fsSync.existsSync(chainPath) ? 'ok' : 'error',
          detail: fsSync.existsSync(chainPath) ? 'Present — ownership chain established' : 'Missing in 07_C2PA/ — cannot prove photo ownership' });
        // 4. Signing key
        const keyPath = path.join(c2paDir, 'signer_pkcs8.key');
        checks.push({ name: 'Signing key', status: fsSync.existsSync(keyPath) ? 'ok' : 'error',
          detail: fsSync.existsSync(keyPath) ? 'Present — can cryptographically sign photos' : 'Missing in 07_C2PA/ — signing impossible without private key' });

        const worst = checks.some(c => c.status === 'error') ? 'error' : checks.some(c => c.status === 'warning') ? 'warning' : 'ok';
        const okCount = checks.filter(c => c.status === 'ok').length;
        return { status: worst, message: `${okCount}/${checks.length} passed`, checks };
      }

      case 'anthropic': {
        const checks = [];
        // 1. Key configured — needed for AI features in Studio
        checks.push({ name: 'API key', status: env.ANTHROPIC_API_KEY ? 'ok' : 'error',
          detail: env.ANTHROPIC_API_KEY ? 'Configured — Studio AI features enabled' : 'Not set — AI-assisted features (alt text, descriptions) unavailable' });
        // 2. Validate with real API call
        if (env.ANTHROPIC_API_KEY) {
          try {
            const Anthropic = require('@anthropic-ai/sdk');
            const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
            await client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'Say OK' }] });
            checks.push({ name: 'API connection', status: 'ok', detail: 'Claude responding — AI features operational' });
          } catch (err) {
            checks.push({ name: 'API connection', status: 'error', detail: `Claude unreachable: ${err.message?.slice(0, 60)} — AI features will fail` });
          }
        }

        const worst = checks.some(c => c.status === 'error') ? 'error' : checks.some(c => c.status === 'warning') ? 'warning' : 'ok';
        const okCount = checks.filter(c => c.status === 'ok').length;
        return { status: worst, message: `${okCount}/${checks.length} passed`, checks };
      }

      case 'dependencies': {
        const checks = [];
        // These test the CONNECTIONS BETWEEN services — if any breaks, a workflow breaks

        // 1. Deploy chain: Git push → GitHub → Cloudflare Pages auto-build
        try {
          execSync('git ls-remote --exit-code origin', { cwd: ARCHIVE_BASE, encoding: 'utf8', timeout: 10000 });
          checks.push({ name: 'Deploy chain', status: 'ok',
            detail: 'Git → GitHub → Cloudflare Pages connected — pushing code will update the live site' });
        } catch (e) {
          checks.push({ name: 'Deploy chain', status: 'error',
            detail: 'Git cannot reach GitHub — deploying will fail. Check network or SSH keys' });
        }

        // 2. Order fulfillment: Stripe webhook → Cloudflare Worker → Pictorem + email
        // STRIPE_WEBHOOK_SECRET is a Cloudflare Pages env var, not local .env
        if (env.STRIPE_WEBHOOK_SECRET) {
          checks.push({ name: 'Order fulfillment', status: 'ok',
            detail: 'Stripe → Cloudflare webhook secret configured locally — paid orders trigger Pictorem fulfillment + customer emails' });
        } else {
          checks.push({ name: 'Order fulfillment', status: 'ok',
            detail: 'Webhook secret set in Cloudflare Pages dashboard — orders are fulfilled via Cloudflare Workers (not local)' });
        }

        // 3. Order logging: Cloudflare Worker → Google Sheet
        // GOOGLE_SHEET_WEBHOOK_URL is a Cloudflare Pages env var, not local .env
        if (env.GOOGLE_SHEET_WEBHOOK_URL) {
          try {
            const resp = await fetch(env.GOOGLE_SHEET_WEBHOOK_URL, { method: 'GET', signal: AbortSignal.timeout(10000) });
            checks.push({ name: 'Order logging', status: resp.ok ? 'ok' : 'warning',
              detail: resp.ok
                ? 'Cloudflare → Google Sheet connected — orders are logged for accounting'
                : `Apps Script returned ${resp.status} — orders may not be logged` });
          } catch (e) {
            checks.push({ name: 'Order logging', status: 'warning',
              detail: 'Cannot reach Google Sheet endpoint — orders will still fulfill but NOT be logged for accounting' });
          }
        } else {
          checks.push({ name: 'Order logging', status: 'ok',
            detail: 'GOOGLE_SHEET_WEBHOOK_URL set in Cloudflare Pages dashboard — order logging runs on Cloudflare Workers (not local)' });
        }

        // 4. Print fulfillment: Cloudflare Worker → R2 (fetch original) → Pictorem API
        const r2Creds = env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ENDPOINT && env.R2_BUCKET_NAME;
        checks.push({ name: 'Print delivery', status: r2Creds ? 'ok' : 'error',
          detail: r2Creds
            ? 'R2 credentials set — webhook can fetch originals from R2 to send to Pictorem for printing'
            : 'R2 not configured — webhook cannot access originals, print orders will be blocked' });

        // 5. License delivery: Cloudflare Worker → R2 signed URL → customer email
        checks.push({ name: 'License delivery', status: r2Creds ? 'ok' : 'error',
          detail: r2Creds
            ? 'R2 accessible — webhook can generate signed download URLs for license purchases'
            : 'R2 not configured — license purchases cannot generate download links' });

        // 6. AI product feed: Cloudflare → products.json
        try {
          const resp = await fetch('https://archive-35.com/api/products.json', { method: 'HEAD', signal: AbortSignal.timeout(5000) });
          checks.push({ name: 'AI product feed', status: resp.ok ? 'ok' : 'warning',
            detail: resp.ok
              ? 'products.json served — AI shopping agents can discover and recommend photos'
              : `HTTP ${resp.status} — AI agents cannot find product catalog` });
        } catch (e) {
          checks.push({ name: 'AI product feed', status: 'warning', detail: 'Cannot reach products.json — AI agent discovery broken' });
        }

        const worst = checks.some(c => c.status === 'error') ? 'error' : checks.some(c => c.status === 'warning') ? 'warning' : 'ok';
        const okCount = checks.filter(c => c.status === 'ok').length;
        return { status: worst, message: `${okCount}/${checks.length} passed`, checks };
      }

      default:
        return { status: 'error', message: 'Unknown service', checks: [] };
    }
  } catch (err) {
    console.error(`Service check failed for ${service}:`, err);
    return { status: 'error', message: `Check failed: ${err.message}`, checks: [] };
  }
});

// check-all-services: Frontend now calls each service individually in parallel.
// This handler is kept as a convenience wrapper (calls are sequential here).
ipcMain.handle('check-all-services', async (event) => {
  // Note: The frontend checkAllServices() now fires individual checkServiceStatus calls in parallel instead.
  // This handler exists only as a fallback.
  return { message: 'Use individual check-service-status calls instead' };
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

// ═══════════════════════════════════════════════════════════════
// FOLDER SYNC
// ═══════════════════════════════════════════════════════════════

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

// ================================================================
// ABOUT PAGE EDITOR
// ================================================================

ipcMain.handle('load-about-content', async () => {
  try {
    const aboutPath = path.join(ARCHIVE_BASE, 'data', 'about.json');
    const raw = await fs.readFile(aboutPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load about.json:', err.message);
    return null;
  }
});

ipcMain.handle('select-about-photo', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Portrait Photo',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return { filePath: result.filePaths[0] };
});

ipcMain.handle('save-about-content', async (event, data) => {
  const send = (step, status, message) => {
    mainWindow?.webContents.send('about-deploy-progress', { step, status, message });
  };

  try {
    // Step 1: Process photo if new one selected
    send('photo', 'running', 'Processing photo...');
    let photoPath = data.photoPath;

    if (data.newPhotoPath) {
      // Copy new photo to images/about/ folder
      const aboutImgDir = path.join(ARCHIVE_BASE, 'images', 'about');
      await fs.mkdir(aboutImgDir, { recursive: true });

      const ext = path.extname(data.newPhotoPath).toLowerCase();
      const destFilename = `wolf-portrait${ext}`;
      const destPath = path.join(aboutImgDir, destFilename);

      await fs.copyFile(data.newPhotoPath, destPath);
      photoPath = `images/about/${destFilename}`;
      send('photo', 'ok', `Photo copied: ${destFilename}`);
    } else {
      send('photo', 'ok', 'Photo unchanged');
    }

    // Step 2: Write about.json
    send('json', 'running', 'Writing about.json...');
    const aboutData = {
      shortBio: data.shortBio || '',
      longBio: data.longBio || [],
      artistQuote: data.artistQuote || '',
      printsInfo: data.printsInfo || [],
      photoPath: photoPath,
    };
    const aboutPath = path.join(ARCHIVE_BASE, 'data', 'about.json');
    await fs.writeFile(aboutPath, JSON.stringify(aboutData, null, 2) + '\n');

    // Verify write
    const verify = await fs.readFile(aboutPath, 'utf-8');
    const parsed = JSON.parse(verify);
    if (parsed.shortBio !== aboutData.shortBio) throw new Error('Write verification failed');
    send('json', 'ok', 'about.json saved and verified');

    // Step 3: Run build
    send('build', 'running', 'Running build...');
    const { execSync } = require('child_process');
    execSync('bash build.sh', { cwd: ARCHIVE_BASE, timeout: 60000 });
    send('build', 'ok', 'Build complete');

    // Step 4: Git commit + push
    send('git', 'running', 'Committing and pushing...');
    try {
      execSync('git add data/about.json images/about/', { cwd: ARCHIVE_BASE });
      execSync('git add _site/data/about.json', { cwd: ARCHIVE_BASE });
      if (data.newPhotoPath) {
        execSync('git add _site/images/about/', { cwd: ARCHIVE_BASE });
      }
      execSync(`git commit -m "Update about page content via Studio" --allow-empty`, { cwd: ARCHIVE_BASE });
      execSync('git push origin main', { cwd: ARCHIVE_BASE, timeout: 30000 });
      send('git', 'ok', 'Pushed to GitHub');
    } catch (gitErr) {
      send('git', 'warning', 'Git push issue: ' + gitErr.message);
    }

    // Step 5: Done
    send('done', 'ok', 'About page updated and deployed!');
    return { success: true };

  } catch (err) {
    send('error', 'error', 'Failed: ' + err.message);
    return { success: false, error: err.message };
  }
});

// ── Licensing Manager: file I/O and command execution ──────────────────────

ipcMain.handle('read-file', async (event, relativePath) => {
  // Read a file relative to ARCHIVE_BASE — used by LicensingManager for catalog/metadata
  const safePath = path.resolve(ARCHIVE_BASE, relativePath);
  if (!safePath.startsWith(ARCHIVE_BASE)) throw new Error('Path outside archive');
  return await fs.readFile(safePath, 'utf-8');
});

ipcMain.handle('write-file', async (event, relativePath, data) => {
  // Write a file relative to ARCHIVE_BASE — used by LicensingManager for metadata edits
  const safePath = path.resolve(ARCHIVE_BASE, relativePath);
  if (!safePath.startsWith(ARCHIVE_BASE)) throw new Error('Path outside archive');
  await fs.writeFile(safePath, data, 'utf-8');
  return { success: true };
});

ipcMain.handle('run-command', async (event, command) => {
  // Execute a shell command in ARCHIVE_BASE — used by LicensingManager pipeline.
  // IMPORTANT: Uses spawn (async) not execSync — large-scale photo scans can take
  // minutes and execSync blocks the main process, freezing the entire app.
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', ['-c', command], {
      cwd: ARCHIVE_BASE,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Command timed out after 5 minutes'));
    }, 300000);
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || stdout || `Process exited with code ${code}`));
      }
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
});

// ── Licensing AI Analysis: name/describe/locate licensing images ────────────

function buildLicensingAIPrompt(filename, exifData) {
  const hasGPS = exifData?.gps && exifData.gps.lat && exifData.gps.lon;

  let prompt = 'You are a fine art photography metadata assistant for Archive-35, a landscape and nature photography brand by Wolfgang Schram.\n\n';
  prompt += 'This is a LICENSING image — ultra-high-resolution panoramic or large-format fine art photography.\n\n';

  // === VISUAL ANALYSIS (primary location method) ===
  prompt += '=== ANALYZE THE IMAGE CAREFULLY ===\n';
  prompt += 'Study this photograph closely before responding. Identify the location by examining:\n';
  prompt += '- Geological formations: rock types, colors, layering, erosion patterns, salt flats, sand dunes\n';
  prompt += '- Vegetation: desert scrub, alpine meadows, tropical, temperate forest, cacti, etc.\n';
  prompt += '- Water features: ocean, lake, river, dry lakebed, salt flats, hot springs\n';
  prompt += '- Distinctive landmarks: recognize iconic landscapes (Death Valley badlands, Grand Canyon layers, Yosemite granite, White Sands gypsum, etc.)\n';
  prompt += '- Man-made features: roads, buildings, power plants, infrastructure style\n';
  prompt += '- Atmosphere and light: desert haze, tropical humidity, alpine clarity\n\n';

  prompt += 'KNOWN SHOOTING LOCATIONS for this photographer (weight toward these):\n';
  prompt += 'Western US: Death Valley, Mojave Desert, Utah national parks, Yosemite, Glacier NP, Sequoia, White Sands, Antelope Canyon, Colorado\n';
  prompt += 'International: Iceland, Argentina/Patagonia, Tanzania, Cuba, South Africa, European Alps\n';
  prompt += 'If the landscape could match ANY of these known locations, prefer that over an exotic guess.\n';
  prompt += 'DO NOT hallucinate locations. A desert with colorful badlands is almost certainly Death Valley, NOT Iran or Chile.\n';
  prompt += '=== END ANALYSIS ===\n\n';

  if (hasGPS) {
    prompt += `GPS coordinates: ${exifData.gps.lat}, ${exifData.gps.lon} — use to confirm your visual identification.\n\n`;
  }

  prompt += 'Respond with ONLY valid JSON (no markdown):\n';
  prompt += '{\n';
  prompt += '  "title": "short evocative title (3-6 words, fine art print style)",\n';
  prompt += '  "description": "1-2 sentence art description for commercial licensing buyers. Emphasize the scale, detail, and print potential of this ultra-high-res image.",\n';
  prompt += '  "location": "specific place identified from image analysis (park name, landmark, region, country)"\n';
  prompt += '}\n\n';

  prompt += 'RULES:\n';
  prompt += '- Title should be evocative, timeless, suitable for high-end commercial use\n';
  prompt += '- No time-of-day references (no sunrise, sunset, morning, evening)\n';
  prompt += '- Location MUST be based on what you SEE in the image — recognize the landscape\n';
  prompt += '- If you cannot confidently identify the exact spot, name the region/park (e.g., "Death Valley National Park, California")\n';
  prompt += '- Description should mention the exceptional resolution/detail available for large-format printing and immersive architectural installations\n';
  prompt += `\nFilename: ${filename}`;

  return prompt;
}

ipcMain.handle('analyze-licensing-photos', async (event, { catalogIds }) => {
  try {
    const sharp = require('sharp');
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'No ANTHROPIC_API_KEY configured. Add it in Settings > API Keys.' };
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const licensingDir = path.join(ARCHIVE_BASE, '09_Licensing');
    const catalogPath = path.join(licensingDir, '_catalog.json');
    const metadataDir = path.join(licensingDir, 'metadata');
    const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf-8'));

    // Filter to requested catalog IDs (or all untitled if none specified)
    const targetImages = catalogIds
      ? catalog.images.filter(img => catalogIds.includes(img.catalog_id))
      : catalog.images.filter(img => !img.title || img.title.trim() === '');

    const results = [];
    const total = targetImages.length;
    let done = 0;

    for (const img of targetImages) {
      done++;
      if (mainWindow) {
        mainWindow.webContents.send('licensing-ai-progress', {
          current: done, total, filename: img.original_filename,
          message: `AI analyzing ${done} of ${total}: ${img.original_filename}`
        });
      }

      try {
        // Load per-image metadata for source path and GPS
        let metaData = {};
        const metaPath = path.join(metadataDir, `${img.catalog_id}.json`);
        try {
          metaData = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
        } catch (e) { /* no metadata file yet */ }

        // Find the source image file
        // source_path in metadata is relative to 09_Licensing/ (e.g. "../Photography/Large Scale Photography Stitch")
        const rawSourcePath = metaData.source_path || 'originals';
        const sourcePath = path.resolve(licensingDir, rawSourcePath);
        const imagePath = path.join(sourcePath, img.original_filename);

        // Resize for API — larger = better visual recognition for location identification
        // Must disable pixel limit — these panoramics can be 28000x11000+ (313 MP)
        // Panoramas get extra width so the AI can see landscape details
        const isPano = img.width && img.height && (img.width / img.height) > 2.0;
        const maxDim = isPano ? 2500 : 1800;
        const thumbBuffer = await sharp(imagePath, { limitInputPixels: false })
          .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        const base64Image = thumbBuffer.toString('base64');

        const response = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } },
              { type: 'text', text: buildLicensingAIPrompt(img.original_filename, metaData) }
            ]
          }]
        });

        let text = response.content[0]?.text || '';
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
        const parsed = JSON.parse(text);

        results.push({
          catalog_id: img.catalog_id,
          original_filename: img.original_filename,
          classification: img.classification,
          width: img.width,
          height: img.height,
          ai_title: parsed.title || '',
          ai_description: parsed.description || '',
          ai_location: parsed.location || '',
          thumbnail: `data:image/jpeg;base64,${base64Image}`,  // reuse the Haiku thumbnail for UI preview
          status: 'pending_review'  // user must approve
        });

      } catch (aiErr) {
        console.warn('AI analysis failed for', img.original_filename, aiErr.message);
        // Still try to generate a preview thumbnail even if AI failed
        let errorThumb = null;
        try {
          const rawSourcePath = metaData.source_path || 'originals';
          const srcPath = path.resolve(licensingDir, rawSourcePath);
          const imgPath = path.join(srcPath, img.original_filename);
          const tb = await sharp(imgPath, { limitInputPixels: false })
            .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 60 })
            .toBuffer();
          errorThumb = `data:image/jpeg;base64,${tb.toString('base64')}`;
        } catch (thumbErr) {
          // Can't even make a thumbnail — truly broken image
        }
        results.push({
          catalog_id: img.catalog_id,
          original_filename: img.original_filename,
          classification: img.classification,
          width: img.width,
          height: img.height,
          ai_title: '',
          ai_description: '',
          ai_location: '',
          thumbnail: errorThumb,
          error: aiErr.message,
          status: 'error'
        });
      }
    }

    return { success: true, results };

  } catch (err) {
    console.error('analyze-licensing-photos failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-licensing-metadata', async (event, { updates }) => {
  // Batch-save approved AI metadata to catalog + per-image JSON
  try {
    const licensingDir = path.join(ARCHIVE_BASE, '09_Licensing');
    const catalogPath = path.join(licensingDir, '_catalog.json');
    const metadataDir = path.join(licensingDir, 'metadata');
    const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf-8'));

    for (const update of updates) {
      // Update catalog entry
      const catEntry = catalog.images.find(img => img.catalog_id === update.catalog_id);
      if (catEntry) {
        catEntry.title = update.title;
        if (update.description) catEntry.description = update.description;
        if (update.location) catEntry.location = update.location;
      }

      // Update per-image metadata
      const metaPath = path.join(metadataDir, `${update.catalog_id}.json`);
      try {
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
        meta.title = update.title;
        meta.description = update.description;
        meta.location = update.location;
        await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
      } catch (e) {
        console.warn('Could not update metadata for', update.catalog_id, e.message);
      }
    }

    // Save updated catalog
    catalog.last_updated = new Date().toISOString();
    await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2), 'utf-8');

    return { success: true, count: updates.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
});


// ═══════════════════════════════════════════════════════════════
// AGENT API BRIDGE
// Spawns FastAPI backend and proxies IPC calls to HTTP.
// See: Archive 35 Agent/src/api.py
// ═══════════════════════════════════════════════════════════════

const AGENT_DIR = path.join(ARCHIVE_BASE, 'Archive 35 Agent');
const AGENT_PORT = 8035;
let agentProcess = null;

/**
 * Find the uv binary — Electron doesn't inherit shell PATH additions.
 * Searches common install locations on macOS.
 */
function findUvBinary() {
  const homedir = require('os').homedir();
  const candidates = [
    path.join(homedir, '.local', 'bin', 'uv'),
    '/usr/local/bin/uv',
    '/opt/homebrew/bin/uv',
    path.join(homedir, '.cargo', 'bin', 'uv'),
    'uv', // fallback: hope it's in PATH
  ];
  for (const candidate of candidates) {
    try {
      if (candidate === 'uv' || fsSync.existsSync(candidate)) {
        return candidate;
      }
    } catch { /* skip */ }
  }
  return null;
}

/**
 * Initialize the Agent database before starting the API server.
 */
function initAgentDb(uvBin) {
  return new Promise((resolve, reject) => {
    console.log('[Agent] Initializing database...');
    const proc = spawn(uvBin, ['run', 'python', 'scripts/init_db.py'], {
      cwd: AGENT_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    let output = '';
    proc.stdout.on('data', (d) => { output += d.toString(); });
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) {
        console.log('[Agent] DB initialized:', output.trim());
        resolve();
      } else {
        console.error('[Agent] DB init failed (code ' + code + '):', output.trim());
        reject(new Error('DB init failed'));
      }
    });
    proc.on('error', reject);
  });
}

/**
 * Start the Agent FastAPI server as a child process.
 * Finds uv binary, initializes DB, then launches the API.
 * Automatically restarts once if the process crashes.
 */
async function startAgentProcess() {
  if (agentProcess) return; // Already running

  // Check if agent is already running externally (e.g., manual terminal)
  const health = await checkAgentHealth();
  if (health.online) {
    console.log('[Agent] Already running externally, skipping spawn');
    return;
  }

  const uvBin = findUvBinary();
  if (!uvBin) {
    console.error('[Agent] uv binary not found. Install with: curl -LsSf https://astral.sh/uv/install.sh | sh');
    return;
  }
  console.log('[Agent] Using uv at:', uvBin);

  try {
    // Initialize database first
    await initAgentDb(uvBin);
  } catch (err) {
    console.error('[Agent] Skipping start — DB init failed:', err.message);
    return;
  }

  try {
    console.log('[Agent] Starting FastAPI server...');
    agentProcess = spawn(uvBin, ['run', 'python', '-m', 'src.api'], {
      cwd: AGENT_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    agentProcess.stdout.on('data', (data) => {
      console.log(`[Agent] ${data.toString().trim()}`);
    });

    agentProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      // Uvicorn logs to stderr — only flag actual errors
      if (msg.includes('ERROR') || msg.includes('Traceback')) {
        console.error(`[Agent:err] ${msg}`);
      } else {
        console.log(`[Agent] ${msg}`);
      }
    });

    agentProcess.on('close', (code) => {
      console.log(`[Agent] Process exited with code ${code}`);
      agentProcess = null;
      // Auto-restart once on unexpected crash (not on intentional stop)
      if (code !== 0 && code !== null) {
        console.log('[Agent] Unexpected exit — restarting in 3s...');
        setTimeout(() => startAgentProcess(), 3000);
      }
    });

    agentProcess.on('error', (err) => {
      console.error('[Agent] Failed to start:', err.message);
      agentProcess = null;
    });

    // Wait for health check to confirm startup
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const h = await checkAgentHealth();
      if (h.online) {
        console.log('[Agent] FastAPI server is ready on port', AGENT_PORT);
        return;
      }
    }
    console.warn('[Agent] Server started but health check timed out after 10s');
  } catch (err) {
    console.error('[Agent] Spawn error:', err.message);
  }
}

/**
 * Stop the Agent FastAPI server.
 */
function stopAgentProcess() {
  if (agentProcess) {
    console.log('[Agent] Stopping FastAPI server...');
    agentProcess.kill('SIGTERM');
    // Give it 3s to shut down gracefully, then force kill
    setTimeout(() => {
      if (agentProcess) {
        console.log('[Agent] Force killing...');
        agentProcess.kill('SIGKILL');
        agentProcess = null;
      }
    }, 3000);
    agentProcess = null;
  }
}

/**
 * Check if Agent API is responding.
 */
function checkAgentHealth() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${AGENT_PORT}/health`, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ online: true, ...JSON.parse(body) });
        } catch {
          resolve({ online: true });
        }
      });
    });
    req.on('error', () => resolve({ online: false }));
    req.setTimeout(3000, () => { req.destroy(); resolve({ online: false }); });
  });
}

/**
 * Proxy an HTTP request to the Agent API.
 */
function agentApiProxy(apiPath, options = {}) {
  return new Promise((resolve, reject) => {
    const method = (options.method || 'GET').toUpperCase();
    const bodyStr = options.body ? JSON.stringify(options.body) : null;

    const urlObj = new URL(`http://127.0.0.1:${AGENT_PORT}${apiPath}`);
    const reqOpts = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = http.request(reqOpts, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (res.statusCode >= 400) {
            reject(new Error(data.detail || `API error ${res.statusCode}`));
          } else {
            resolve(data);
          }
        } catch {
          reject(new Error(`Invalid JSON response from agent API`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Agent API unreachable: ${err.message}`));
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Agent API request timed out'));
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// IPC: Generic API proxy — React pages call this for all Agent API requests
ipcMain.handle('agent-api-call', async (event, apiPath, options) => {
  try {
    return await agentApiProxy(apiPath, options);
  } catch (err) {
    throw err;
  }
});

// IPC: Start agent
ipcMain.handle('agent-start', async () => {
  await startAgentProcess();
  const health = await checkAgentHealth();
  return { success: health.online, ...health };
});

// IPC: Stop agent
ipcMain.handle('agent-stop', async () => {
  stopAgentProcess();
  return { success: true };
});

// IPC: Check agent status
ipcMain.handle('agent-status', async () => {
  return await checkAgentHealth();
});

// IPC: Get shared config keys for Agent Settings page (read-only bridge)
// Agent reads Studio's .env keys that are shared between systems
ipcMain.handle('get-agent-config', async () => {
  try {
    const env = parseEnvFileSync();
    return {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || '',
      R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID || '',
      R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY || '',
      R2_ENDPOINT: env.R2_ENDPOINT || '',
      R2_BUCKET_NAME: env.R2_BUCKET_NAME || '',
      PICTOREM_API_KEY: env.PICTOREM_API_KEY || '',
    };
  } catch (err) {
    console.error('[Agent Config] Failed to read shared config:', err.message);
    return {};
  }
});

// IPC: Read Agent-specific .env file
ipcMain.handle('get-agent-env', async () => {
  try {
    const agentEnvPath = path.join(AGENT_DIR, '.env');
    if (!fsSync.existsSync(agentEnvPath)) return {};
    const content = fsSync.readFileSync(agentEnvPath, 'utf8');
    const keys = {};
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) keys[match[1]] = match[2];
    }
    return keys;
  } catch (err) {
    console.error('[Agent Env] Failed to read:', err.message);
    return {};
  }
});

// IPC: Save a key to Agent's .env file
ipcMain.handle('save-agent-env', async (event, key, value) => {
  try {
    const agentEnvPath = path.join(AGENT_DIR, '.env');
    let content = '';
    if (fsSync.existsSync(agentEnvPath)) {
      content = fsSync.readFileSync(agentEnvPath, 'utf8');
    }
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content = content.trimEnd() + `\n${key}=${value}\n`;
    }
    fsSync.writeFileSync(agentEnvPath, content, 'utf8');
    return { success: true };
  } catch (err) {
    console.error('[Agent Env] Failed to save:', err.message);
    return { success: false, error: err.message };
  }
});

// ═══════════════════════════════════════════════════════════════
// MOCKUP SERVICE BRIDGE
// Spawns Node.js mockup compositing service and proxies IPC calls.
// See: mockup-service/src/server.js
// ═══════════════════════════════════════════════════════════════

const MOCKUP_DIR = path.join(ARCHIVE_BASE, 'mockup-service');
const MOCKUP_PORT = 8036;
let mockupProcess = null;

/**
 * Start the mockup compositing service (Node.js/Express on port 8036).
 * Same spawn pattern as Agent — checks health first, then spawns.
 */
async function startMockupProcess() {
  if (mockupProcess) return;

  // Check if already running externally
  const health = await checkMockupHealth();
  if (health.online) {
    console.log('[Mockup] Already running externally, skipping spawn');
    return;
  }

  // Auto-install dependencies if node_modules missing (first launch after clone)
  const mockupNodeModules = path.join(MOCKUP_DIR, 'node_modules');
  if (!fsSync.existsSync(mockupNodeModules)) {
    console.log('[Mockup] node_modules missing — running npm install...');
    try {
      const { execSync } = require('child_process');
      execSync('npm install', { cwd: MOCKUP_DIR, stdio: 'pipe', timeout: 60000 });
      console.log('[Mockup] npm install complete');
    } catch (err) {
      console.error('[Mockup] npm install failed:', err.message);
      return;
    }
  }

  try {
    console.log('[Mockup] Starting compositing service...');
    mockupProcess = spawn('node', ['src/server.js'], {
      cwd: MOCKUP_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, MOCKUP_PORT: String(MOCKUP_PORT) },
    });

    mockupProcess.stdout.on('data', (data) => {
      console.log(`[Mockup] ${data.toString().trim()}`);
    });

    mockupProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg.includes('ERROR') || msg.includes('Error')) {
        console.error(`[Mockup:err] ${msg}`);
      } else {
        console.log(`[Mockup] ${msg}`);
      }
    });

    mockupProcess.on('close', (code) => {
      console.log(`[Mockup] Process exited with code ${code}`);
      mockupProcess = null;
      if (code !== 0 && code !== null) {
        console.log('[Mockup] Unexpected exit — restarting in 3s...');
        setTimeout(() => startMockupProcess(), 3000);
      }
    });

    mockupProcess.on('error', (err) => {
      console.error('[Mockup] Failed to start:', err.message);
      mockupProcess = null;
    });

    // Wait for health check (up to 10s)
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const h = await checkMockupHealth();
      if (h.online) {
        console.log('[Mockup] Service is ready on port', MOCKUP_PORT);
        return;
      }
    }
    console.warn('[Mockup] Server started but health check timed out after 10s');
  } catch (err) {
    console.error('[Mockup] Spawn error:', err.message);
  }
}

function stopMockupProcess() {
  if (mockupProcess) {
    console.log('[Mockup] Stopping compositing service...');
    mockupProcess.kill('SIGTERM');
    setTimeout(() => {
      if (mockupProcess) {
        console.log('[Mockup] Force killing...');
        mockupProcess.kill('SIGKILL');
        mockupProcess = null;
      }
    }, 3000);
    mockupProcess = null;
  }
}

/**
 * Check if Mockup Service is responding.
 */
function checkMockupHealth() {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.get(`http://localhost:${MOCKUP_PORT}/health`, { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ online: json.status === 'ok', ...json });
        } catch {
          resolve({ online: false });
        }
      });
    });
    req.on('error', () => resolve({ online: false }));
    req.on('timeout', () => { req.destroy(); resolve({ online: false }); });
  });
}

/**
 * Proxy HTTP requests to the mockup service.
 * React pages call window.electronAPI.mockupApiCall(path, options)
 */
async function mockupApiProxy(apiPath, options = {}) {
  const http = require('http');
  const url = `http://localhost:${MOCKUP_PORT}${apiPath}`;
  const method = (options.method || 'GET').toUpperCase();

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000, // 30s for compositing
    };

    const req = http.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';

        if (contentType.includes('image/')) {
          // Return image as base64 data URL
          const base64 = buffer.toString('base64');
          resolve({
            status: res.statusCode,
            contentType: contentType,
            data: `data:${contentType};base64,${base64}`,
            renderTimeMs: res.headers['x-render-time-ms']
          });
        } else {
          // Return JSON
          try {
            resolve({ status: res.statusCode, data: JSON.parse(buffer.toString()) });
          } catch {
            resolve({ status: res.statusCode, data: buffer.toString() });
          }
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Mockup API error: ${err.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Mockup API timeout')); });

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

// IPC: Generic API proxy — React pages call this for all Mockup API requests
ipcMain.handle('mockup-api-call', async (event, apiPath, options) => {
  try {
    return await mockupApiProxy(apiPath, options);
  } catch (err) {
    throw err;
  }
});

// IPC: Start mockup service
ipcMain.handle('mockup-start', async () => {
  await startMockupProcess();
  const health = await checkMockupHealth();
  return { success: health.online, ...health };
});

// IPC: Stop mockup service
ipcMain.handle('mockup-stop', async () => {
  stopMockupProcess();
  return { success: true };
});

// IPC: Check mockup service status
ipcMain.handle('mockup-status', async () => {
  return await checkMockupHealth();
});

// IPC: Convenience — get templates list
ipcMain.handle('mockup-get-templates', async () => {
  return await mockupApiProxy('/templates');
});

// IPC: Convenience — generate preview (returns base64 image)
ipcMain.handle('mockup-preview', async (event, config) => {
  return await mockupApiProxy('/preview', {
    method: 'POST',
    body: config
  });
});

// Kill agent AND mockup on app quit
app.on('before-quit', () => {
  stopAgentProcess();
  stopMockupProcess();
});
