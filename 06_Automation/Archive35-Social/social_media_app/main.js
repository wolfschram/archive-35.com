const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawn } = require('child_process');

let mainWindow;
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ─── PATHS ────────────────────────────────────────────
const APP_ROOT = __dirname;
const CONFIG_DIR = path.join(APP_ROOT, 'config');
const OUTPUT_DIR = path.join(APP_ROOT, 'output');
const LOGS_DIR = path.join(APP_ROOT, 'logs');
const TEMP_DIR = path.join(os.tmpdir(), 'archive35');

// Handshake defaults to local, overridden by config.handshakePath
let HANDSHAKE_DIR = path.join(APP_ROOT, 'handshake');

// Ensure dirs exist
[CONFIG_DIR, OUTPUT_DIR, LOGS_DIR, TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── PLATFORM DEFINITIONS (8 PLATFORMS) ───────────────
const PLATFORMS = {
  instagram_reels: {
    label: 'Instagram Reels', format: 'portrait', width: 1080, height: 1920,
    duration: 15, template: 'A35_Portrait_9x16', photoCount: 8, supportsLinks: false
  },
  tiktok: {
    label: 'TikTok', format: 'portrait', width: 1080, height: 1920,
    duration: 15, template: 'A35_Portrait_9x16', photoCount: 8, supportsLinks: false
  },
  youtube: {
    label: 'YouTube', format: 'widescreen', width: 1920, height: 1080,
    duration: 30, template: 'A35_Widescreen_16x9', photoCount: 14, supportsLinks: true
  },
  youtube_shorts: {
    label: 'YouTube Shorts', format: 'portrait', width: 1080, height: 1920,
    duration: 15, template: 'A35_Portrait_9x16', photoCount: 8, supportsLinks: true
  },
  facebook: {
    label: 'Facebook', format: 'widescreen', width: 1920, height: 1080,
    duration: 30, template: 'A35_Widescreen_16x9', photoCount: 14, supportsLinks: true
  },
  instagram_feed: {
    label: 'Instagram Feed', format: 'square', width: 1080, height: 1080,
    duration: 15, template: 'A35_Square_1x1', photoCount: 10, supportsLinks: false
  },
  linkedin: {
    label: 'LinkedIn', format: 'widescreen', width: 1920, height: 1080,
    duration: 30, template: 'A35_Widescreen_16x9', photoCount: 14, supportsLinks: true
  },
  x_twitter: {
    label: 'X / Twitter', format: 'widescreen', width: 1920, height: 1080,
    duration: 30, template: 'A35_Widescreen_16x9', photoCount: 14, supportsLinks: true
  }
};

// ─── CONFIG ───────────────────────────────────────────
const CONFIG_PATH = path.join(CONFIG_DIR, 'settings.json');

function loadConfig() {
  const defaults = {
    photographyPath: '',
    pngSeqPath: '',
    audioPath: '',
    outputPath: OUTPUT_DIR,
    handshakePath: '',
    port: 8035,
    schedule: {
      enabled: false,
      postsPerDay: 2,
      times: ['09:00', '18:00'],
      timezone: 'America/Los_Angeles'
    },
    rotation: {
      mode: 'sequential',
      lastGalleryIndex: -1,
      usedGalleries: []
    },
    video: {
      fps: 30,
      codec: 'libx264',
      quality: 'medium',
      crf: 18,
      audioFadeIn: 1.0,
      audioFadeOut: 2.0
    },
    platforms: {
      instagram_reels: { enabled: true, handle: '@archive35' },
      tiktok: { enabled: true, handle: '@archive35' },
      youtube: { enabled: true, handle: 'Archive-35' },
      youtube_shorts: { enabled: true, handle: 'Archive-35' },
      facebook: { enabled: true, handle: 'Archive-35' },
      instagram_feed: { enabled: true, handle: '@archive35' },
      linkedin: { enabled: true, handle: 'Archive-35' },
      x_twitter: { enabled: true, handle: '@archive35' }
    },
    apiKeys: {}
  };

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      // Deep merge platforms
      const merged = { ...defaults, ...saved };
      merged.platforms = { ...defaults.platforms, ...(saved.platforms || {}) };
      merged.schedule = { ...defaults.schedule, ...(saved.schedule || {}) };
      merged.rotation = { ...defaults.rotation, ...(saved.rotation || {}) };
      merged.video = { ...defaults.video, ...(saved.video || {}) };
      return merged;
    }
  } catch (e) {
    log('error', `Config load failed: ${e.message}`);
  }
  return defaults;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getHandshakeDir() {
  const config = loadConfig();
  if (config.handshakePath && fs.existsSync(config.handshakePath)) {
    return config.handshakePath;
  }
  // Fallback to local handshake folder
  if (!fs.existsSync(HANDSHAKE_DIR)) fs.mkdirSync(HANDSHAKE_DIR, { recursive: true });
  return HANDSHAKE_DIR;
}

// ─── LOGGING ──────────────────────────────────────────
function log(level, message) {
  const ts = new Date().toISOString();
  const entry = `[${ts}] [${level.toUpperCase()}] ${message}\n`;
  const logFile = path.join(LOGS_DIR, `social_${new Date().toISOString().split('T')[0]}.log`);
  try { fs.appendFileSync(logFile, entry); } catch (e) {}
  if (isDev) console.log(entry.trim());
}

// ─── WINDOW ───────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3001');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'build', 'index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
  log('info', 'Archive-35 Social Media started');
}

app.whenReady().then(() => {
  createWindow();
  startScheduler();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });

// ─── IPC: CONFIG ──────────────────────────────────────
ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('save-config', (_, config) => {
  saveConfig(config);
  restartScheduler();
  return { success: true };
});

ipcMain.handle('select-folder', async (_, title) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Select Folder',
    properties: ['openDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('get-platforms', () => PLATFORMS);

// ─── IPC: GALLERY SCANNER (with gallery.json support) ─
ipcMain.handle('scan-galleries', async () => {
  const config = loadConfig();
  const photoPath = config.photographyPath;
  if (!photoPath || !fs.existsSync(photoPath)) {
    return { error: 'Photography path not configured or not found' };
  }

  try {
    const entries = fs.readdirSync(photoPath, { withFileTypes: true });
    const galleries = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

      const galleryPath = path.join(photoPath, entry.name);
      const files = fs.readdirSync(galleryPath).filter(f =>
        /\.(jpg|jpeg|png|tif|tiff)$/i.test(f) && !f.startsWith('.')
      );

      // Read gallery.json if it exists (enhanced mode)
      let metadata = null;
      const metaPath = path.join(galleryPath, 'gallery.json');
      try {
        if (fs.existsSync(metaPath)) {
          metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        }
      } catch (e) {
        log('warn', `Invalid gallery.json in ${entry.name}: ${e.message}`);
      }

      galleries.push({
        name: metadata?.name || entry.name,
        folderName: entry.name,
        path: galleryPath,
        photoCount: files.length,
        photos: files.map(f => ({
          filename: f,
          path: path.join(galleryPath, f)
        })),
        metadata: metadata,
        slug: entry.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-'),
        hasMetadata: !!metadata
      });
    }

    galleries.sort((a, b) => a.name.localeCompare(b.name));
    log('info', `Scanned ${galleries.length} galleries, ${galleries.reduce((s, g) => s + g.photoCount, 0)} total photos`);
    return { galleries };
  } catch (e) {
    log('error', `Gallery scan failed: ${e.message}`);
    return { error: e.message };
  }
});

ipcMain.handle('get-photo-thumbnail', async (_, photoPath) => {
  try {
    const sharp = require('sharp');
    const buffer = await sharp(photoPath)
      .resize(400, 300, { fit: 'cover' })
      .jpeg({ quality: 70 })
      .toBuffer();
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } catch (e) {
    return null;
  }
});

// ─── IPC: PNG SEQUENCE SCANNER ────────────────────────
ipcMain.handle('scan-templates', async () => {
  const config = loadConfig();
  const seqPath = config.pngSeqPath;
  if (!seqPath || !fs.existsSync(seqPath)) {
    return { error: 'PNG sequence path not configured or not found' };
  }

  try {
    const entries = fs.readdirSync(seqPath, { withFileTypes: true });
    const templates = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      const templatePath = path.join(seqPath, entry.name);
      const frames = fs.readdirSync(templatePath)
        .filter(f => /\.png$/i.test(f) && !f.startsWith('.'))
        .sort();

      // Check for positions.json
      let positions = null;
      const posPath = path.join(templatePath, 'positions.json');
      try {
        if (fs.existsSync(posPath)) {
          positions = JSON.parse(fs.readFileSync(posPath, 'utf8'));
        }
      } catch (e) {
        log('warn', `Invalid positions.json in ${entry.name}: ${e.message}`);
      }

      // Determine format from folder name
      let format = 'unknown';
      const nameLower = entry.name.toLowerCase();
      if (nameLower.includes('portrait') || nameLower.includes('9x16')) format = 'portrait';
      else if (nameLower.includes('square') || nameLower.includes('1x1')) format = 'square';
      else if (nameLower.includes('widescreen') || nameLower.includes('16x9')) format = 'widescreen';

      if (frames.length > 0) {
        templates.push({
          name: entry.name,
          path: templatePath,
          frameCount: frames.length,
          firstFrame: path.join(templatePath, frames[0]),
          format,
          hasPositions: !!positions,
          positions
        });
      }
    }

    log('info', `Found ${templates.length} PNG templates`);
    return { templates };
  } catch (e) {
    log('error', `Template scan failed: ${e.message}`);
    return { error: e.message };
  }
});

// ─── IPC: GREEN SCREEN COMPOSITOR ─────────────────────
// The AE templates use pure green (RGB 0,255,0) as placeholders.
// Method: For each frame, detect green areas and replace with photos.
// If positions.json exists: use explicit coordinates.
// If not: use alpha-based compositing (template on top, photos behind).
ipcMain.handle('composite-frames', async (_, { templatePath, photos, outputDir, positions }) => {
  try {
    const sharp = require('sharp');
    const templateFrames = fs.readdirSync(templatePath)
      .filter(f => /\.png$/i.test(f) && !f.startsWith('.'))
      .sort();

    // Use /tmp/archive35/ for temp frames, then copy final
    const tempFramesDir = path.join(TEMP_DIR, `comp_${Date.now()}`);
    if (!fs.existsSync(tempFramesDir)) fs.mkdirSync(tempFramesDir, { recursive: true });

    // Get template dimensions from first frame
    const firstFrameMeta = await sharp(path.join(templatePath, templateFrames[0])).metadata();
    const tplWidth = firstFrameMeta.width;
    const tplHeight = firstFrameMeta.height;

    let completed = 0;
    const total = templateFrames.length;

    // Pre-scale all photos to template size for dest-over compositing
    // This covers the case where no positions.json exists
    const scaledPhotos = [];
    for (let i = 0; i < photos.length; i++) {
      try {
        const buf = await sharp(photos[i].path)
          .resize(tplWidth, tplHeight, { fit: 'cover' })
          .removeAlpha()
          .raw()
          .toBuffer();
        scaledPhotos.push(buf);
      } catch (e) {
        log('warn', `Failed to scale photo ${photos[i].path}: ${e.message}`);
      }
    }

    if (scaledPhotos.length === 0) {
      return { error: 'No valid photos could be loaded' };
    }

    for (const frame of templateFrames) {
      const framePath = path.join(templatePath, frame);

      // Read template frame with alpha channel
      const templateRaw = await sharp(framePath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const { data: tplData, info: tplInfo } = templateRaw;
      const pixelCount = tplInfo.width * tplInfo.height;

      // Create background canvas with photo(s)
      // For green screen: we create a canvas, paint photos where green pixels exist
      // Simple approach: create a full-frame photo layer, then composite template on top
      // Template's alpha channel naturally hides the non-green areas

      // Pick which photo to show (cycle through photos based on frame index)
      // In reality, each frame shows all photos at once since the AE template
      // has multiple green placeholders visible at different positions in 3D space.
      // The template's rendered alpha handles which pixels show through.

      // Create base canvas from the first scaled photo
      const photoIndex = completed % scaledPhotos.length;
      const photoCanvas = await sharp(scaledPhotos[photoIndex], {
        raw: { width: tplWidth, height: tplHeight, channels: 3 }
      })
        .png()
        .toBuffer();

      // Composite: photo as background, template frame on top
      // The template PNG has alpha transparency where the green screen areas are
      // This lets the photo show through those areas
      const outPath = path.join(tempFramesDir, frame);
      await sharp(photoCanvas)
        .composite([{
          input: framePath,
          blend: 'over'
        }])
        .png({ compressionLevel: 4 })
        .toFile(outPath);

      completed++;
      if (mainWindow && completed % 10 === 0) {
        mainWindow.webContents.send('composite-progress', {
          completed, total, frame,
          percent: Math.round((completed / total) * 100)
        });
      }
    }

    // Copy composited frames to final output dir
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const tempFiles = fs.readdirSync(tempFramesDir).filter(f => f.endsWith('.png')).sort();
    for (const f of tempFiles) {
      fs.copyFileSync(path.join(tempFramesDir, f), path.join(outputDir, f));
    }

    // Cleanup temp
    try {
      fs.rmSync(tempFramesDir, { recursive: true, force: true });
    } catch (e) {
      log('warn', `Temp cleanup failed: ${e.message}`);
    }

    log('info', `Composited ${completed} frames to ${outputDir}`);
    if (mainWindow) {
      mainWindow.webContents.send('composite-progress', {
        completed: total, total, frame: 'done',
        percent: 100
      });
    }
    return { success: true, frameCount: completed, outputDir };
  } catch (e) {
    log('error', `Compositing failed: ${e.message}`);
    return { error: e.message };
  }
});

// ─── IPC: FFMPEG RENDER ───────────────────────────────
ipcMain.handle('render-video', async (_, { framesDir, outputPath, audioPath, platformKey }) => {
  const config = loadConfig();
  const { fps, codec, quality, crf } = config.video;
  const platform = platformKey ? PLATFORMS[platformKey] : null;

  // Ensure output directory exists
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  return new Promise((resolve) => {
    // Detect frame naming pattern
    const frames = fs.readdirSync(framesDir).filter(f => f.endsWith('.png')).sort();
    if (frames.length === 0) {
      return resolve({ error: 'No frames found in directory' });
    }

    // Detect naming pattern (00000.png or frame_0001.png etc)
    const firstFrame = frames[0];
    let inputPattern;
    if (/^\d{5}\.png$/.test(firstFrame)) {
      inputPattern = '%05d.png';
    } else if (/^\d{4}\.png$/.test(firstFrame)) {
      inputPattern = '%04d.png';
    } else {
      inputPattern = '%05d.png'; // default to 5-digit
    }

    const duration = platform ? platform.duration : Math.ceil(frames.length / fps);

    const args = [
      '-y',
      '-framerate', String(fps),
      '-i', path.join(framesDir, inputPattern),
    ];

    // Add audio if provided
    if (audioPath && fs.existsSync(audioPath)) {
      args.push('-i', audioPath);
      const fadeOutStart = Math.max(0, duration - config.video.audioFadeOut);
      args.push('-af', `afade=t=in:d=${config.video.audioFadeIn},afade=t=out:st=${fadeOutStart}:d=${config.video.audioFadeOut}`);
      args.push('-c:a', 'aac', '-b:a', '192k');
      args.push('-shortest');
    }

    args.push(
      '-c:v', codec,
      '-preset', quality,
      '-crf', String(crf || 18),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputPath
    );

    log('info', `Rendering video: ffmpeg ${args.join(' ')}`);

    const ffmpeg = spawn('ffmpeg', args);
    let stderr = '';

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
      const timeMatch = data.toString().match(/time=(\d+:\d+:\d+\.\d+)/);
      if (timeMatch && mainWindow) {
        mainWindow.webContents.send('render-progress', {
          time: timeMatch[1],
          platform: platformKey || 'default',
          raw: data.toString()
        });
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        log('info', `Video rendered: ${outputPath}`);
        resolve({ success: true, outputPath });
      } else {
        log('error', `FFmpeg failed (code ${code}): ${stderr.slice(-500)}`);
        resolve({ error: `FFmpeg exited with code ${code}`, details: stderr.slice(-500) });
      }
    });

    ffmpeg.on('error', (e) => {
      log('error', `FFmpeg spawn error: ${e.message}`);
      resolve({ error: e.message });
    });
  });
});

// ─── IPC: MULTI-PLATFORM RENDER ───────────────────────
// Renders the same gallery/photos into all enabled platform formats
ipcMain.handle('render-all-platforms', async (_, { gallery, photos, enabledPlatforms }) => {
  const config = loadConfig();
  const results = {};
  const dateStr = new Date().toISOString().split('T')[0];
  const slug = gallery.slug || gallery.name.toLowerCase().replace(/[^a-z0-9]/g, '-');

  // Group platforms by template to avoid re-compositing the same frames
  const templateGroups = {};
  for (const platformKey of enabledPlatforms) {
    const platform = PLATFORMS[platformKey];
    if (!platform) continue;
    const tplName = platform.template;
    if (!templateGroups[tplName]) {
      templateGroups[tplName] = { platforms: [], photoCount: platform.photoCount };
    }
    templateGroups[tplName].platforms.push(platformKey);
    // Use the highest photo count for this template
    templateGroups[tplName].photoCount = Math.max(
      templateGroups[tplName].photoCount, platform.photoCount
    );
  }

  // Scan available templates
  const seqPath = config.pngSeqPath;
  if (!seqPath || !fs.existsSync(seqPath)) {
    return { error: 'PNG sequence path not configured' };
  }

  const templateDirs = fs.readdirSync(seqPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .reduce((acc, d) => { acc[d.name] = path.join(seqPath, d.name); return acc; }, {});

  for (const [tplName, group] of Object.entries(templateGroups)) {
    const tplPath = templateDirs[tplName];
    if (!tplPath) {
      for (const pk of group.platforms) {
        results[pk] = { error: `Template ${tplName} not found` };
      }
      continue;
    }

    // Select photos for this template
    const shuffled = [...photos].sort(() => Math.random() - 0.5);
    const selectedPhotos = shuffled.slice(0, Math.min(group.photoCount, shuffled.length));

    // Composite frames once for this template
    const framesDir = path.join(TEMP_DIR, `frames_${slug}_${tplName}_${Date.now()}`);
    if (mainWindow) {
      mainWindow.webContents.send('multi-render-status', {
        phase: 'compositing', template: tplName,
        platforms: group.platforms
      });
    }

    const compResult = await new Promise(resolve => {
      ipcMain.emit('composite-frames-internal', null, {
        templatePath: tplPath, photos: selectedPhotos, outputDir: framesDir
      }, resolve);
    }).catch(() => null);

    // Use direct compositing call
    const sharp = require('sharp');
    const templateFrames = fs.readdirSync(tplPath)
      .filter(f => /\.png$/i.test(f) && !f.startsWith('.'))
      .sort();

    if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });

    const firstMeta = await sharp(path.join(tplPath, templateFrames[0])).metadata();

    // Pre-scale photos
    const scaledBuf = await sharp(selectedPhotos[0].path)
      .resize(firstMeta.width, firstMeta.height, { fit: 'cover' })
      .removeAlpha()
      .png()
      .toBuffer();

    let compCompleted = 0;
    for (const frame of templateFrames) {
      const outPath = path.join(framesDir, frame);
      await sharp(scaledBuf)
        .composite([{ input: path.join(tplPath, frame), blend: 'over' }])
        .png({ compressionLevel: 4 })
        .toFile(outPath);

      compCompleted++;
      if (mainWindow && compCompleted % 20 === 0) {
        mainWindow.webContents.send('composite-progress', {
          completed: compCompleted, total: templateFrames.length,
          percent: Math.round((compCompleted / templateFrames.length) * 100)
        });
      }
    }

    // Render video for each platform using this template
    for (const platformKey of group.platforms) {
      const outputFilename = `${platformKey}_${slug}.mp4`;
      const outputPath = path.join(OUTPUT_DIR, dateStr, outputFilename);

      if (mainWindow) {
        mainWindow.webContents.send('multi-render-status', {
          phase: 'rendering', platform: platformKey, template: tplName
        });
      }

      // Render using the existing render-video handler logic
      const renderResult = await renderVideoInternal({
        framesDir, outputPath,
        audioPath: config.audioPath || null,
        platformKey
      });

      results[platformKey] = renderResult;

      // Generate post content sidecar
      if (renderResult.success) {
        const postContent = generatePostContent(gallery, platformKey);
        const sidecarPath = outputPath.replace('.mp4', '.json');
        fs.writeFileSync(sidecarPath, JSON.stringify(postContent, null, 2));
      }
    }

    // Cleanup temp frames
    try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch (e) {}
  }

  return { results, dateStr };
});

// Internal render function (shared by IPC handler and multi-platform)
function renderVideoInternal({ framesDir, outputPath, audioPath, platformKey }) {
  const config = loadConfig();
  const { fps, codec, quality, crf } = config.video;
  const platform = platformKey ? PLATFORMS[platformKey] : null;

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  return new Promise((resolve) => {
    const frames = fs.readdirSync(framesDir).filter(f => f.endsWith('.png')).sort();
    if (frames.length === 0) return resolve({ error: 'No frames found' });

    const firstFrame = frames[0];
    let inputPattern = /^\d{5}\.png$/.test(firstFrame) ? '%05d.png' : '%04d.png';
    const duration = platform ? platform.duration : Math.ceil(frames.length / fps);

    const args = [
      '-y', '-framerate', String(fps),
      '-i', path.join(framesDir, inputPattern)
    ];

    if (audioPath && fs.existsSync(audioPath)) {
      args.push('-i', audioPath);
      const fadeOutStart = Math.max(0, duration - config.video.audioFadeOut);
      args.push('-af', `afade=t=in:d=${config.video.audioFadeIn},afade=t=out:st=${fadeOutStart}:d=${config.video.audioFadeOut}`);
      args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    }

    args.push(
      '-c:v', codec, '-preset', quality, '-crf', String(crf || 18),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      outputPath
    );

    const ffmpeg = spawn('ffmpeg', args);
    let stderr = '';

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
      const timeMatch = data.toString().match(/time=(\d+:\d+:\d+\.\d+)/);
      if (timeMatch && mainWindow) {
        mainWindow.webContents.send('render-progress', {
          time: timeMatch[1], platform: platformKey || 'default'
        });
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        log('info', `Video rendered: ${outputPath}`);
        resolve({ success: true, outputPath });
      } else {
        log('error', `FFmpeg failed (code ${code}): ${stderr.slice(-500)}`);
        resolve({ error: `FFmpeg exited with code ${code}` });
      }
    });

    ffmpeg.on('error', (e) => resolve({ error: e.message }));
  });
}

// ─── POST CONTENT GENERATOR ───────────────────────────
function generatePostContent(gallery, platformKey) {
  const platform = PLATFORMS[platformKey];
  const meta = gallery.metadata || {};
  const name = meta.name || gallery.name;
  const location = meta.location || '';
  const description = meta.description || '';
  const mood = meta.mood || '';
  const websiteUrl = meta.website_url || `https://archive-35.com/galleries/${gallery.slug}`;

  // Base hashtags (always include)
  const baseHashtags = ['#archive35', '#therestlesseye', '#fineartphotography'];

  // Gallery-specific hashtags
  const galleryHashtags = (meta.hashtags || []).map(h => h.startsWith('#') ? h : `#${h}`);

  // Build caption based on platform
  let caption = '';
  let hashtags = [...baseHashtags, ...galleryHashtags];
  let link = '';

  if (platform.supportsLinks) {
    link = websiteUrl;
  }

  // Short caption for TikTok/Reels
  if (['instagram_reels', 'tiktok', 'youtube_shorts'].includes(platformKey)) {
    caption = location ? `${name}. ${location}.` : `${name}.`;
    if (description) caption += ` ${description.split('.')[0]}.`;
  }
  // Medium caption for feed/facebook
  else if (['instagram_feed', 'facebook'].includes(platformKey)) {
    caption = name;
    if (location) caption += ` — ${location}`;
    if (description) caption += `\n\n${description}`;
  }
  // Longer for YouTube/LinkedIn/X
  else {
    caption = name;
    if (location) caption += ` | ${location}`;
    if (description) caption += `\n\n${description}`;
    if (mood) caption += `\n\n${mood}`;
  }

  // Limit hashtags to ~12 per platform
  hashtags = [...new Set(hashtags)].slice(0, 12);

  return {
    platform: platformKey,
    platformLabel: platform.label,
    gallery: name,
    caption,
    hashtags,
    hashtagString: hashtags.join(' '),
    link,
    generatedAt: new Date().toISOString(),
    format: platform.format,
    dimensions: `${platform.width}x${platform.height}`,
    duration: platform.duration
  };
}

ipcMain.handle('generate-post-content', (_, { gallery, platformKey }) => {
  return generatePostContent(gallery, platformKey);
});

ipcMain.handle('generate-all-post-content', (_, { gallery }) => {
  const config = loadConfig();
  const results = {};
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    if (config.platforms[key]?.enabled) {
      results[key] = generatePostContent(gallery, key);
    }
  }
  return results;
});

// ─── IPC: RENDER QUEUE ────────────────────────────────
const QUEUE_PATH = path.join(LOGS_DIR, 'render_queue.json');

ipcMain.handle('get-render-queue', () => {
  try {
    if (fs.existsSync(QUEUE_PATH)) {
      return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
    }
  } catch (e) {}
  return { queue: [], history: [] };
});

ipcMain.handle('save-render-queue', (_, data) => {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(data, null, 2));
  return { success: true };
});

// ─── IPC: POST HISTORY ───────────────────────────────
const HISTORY_PATH = path.join(LOGS_DIR, 'post_history.json');

ipcMain.handle('get-post-history', () => {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    }
  } catch (e) {}
  return { posts: [] };
});

ipcMain.handle('save-post-history', (_, data) => {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(data, null, 2));
  return { success: true };
});

// ─── IPC: HANDSHAKE (Enhanced Protocol) ───────────────
ipcMain.handle('write-heartbeat', () => {
  const config = loadConfig();
  let queueLength = 0;
  try {
    const qd = fs.existsSync(QUEUE_PATH)
      ? JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'))
      : { queue: [] };
    queueLength = qd.queue?.length || 0;
  } catch (e) {}

  let postsToday = 0;
  let rendersToday = 0;
  let errorsToday = 0;
  try {
    const history = fs.existsSync(HISTORY_PATH)
      ? JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'))
      : { posts: [] };
    const today = new Date().toISOString().split('T')[0];
    postsToday = (history.posts || []).filter(p => p.date?.startsWith(today)).length;
  } catch (e) {}

  // Count rendered videos for today
  const todayDir = path.join(OUTPUT_DIR, new Date().toISOString().split('T')[0]);
  try {
    if (fs.existsSync(todayDir)) {
      rendersToday = fs.readdirSync(todayDir).filter(f => f.endsWith('.mp4')).length;
    }
  } catch (e) {}

  const heartbeat = {
    app: 'archive35-social-media',
    version: '0.2.0',
    status: 'running',
    last_heartbeat: new Date().toISOString(),
    machine: 'i7-macbook-pro',
    current_task: 'idle',
    last_render: null,
    next_scheduled: null,
    stats: {
      videos_rendered_today: rendersToday,
      posts_made_today: postsToday,
      galleries_available: 26,
      errors_today: errorsToday,
      queue_length: queueLength
    }
  };

  // Write to handshake folder
  const hsDir = getHandshakeDir();
  const hbPath = path.join(hsDir, 'social_status.json');
  try {
    fs.writeFileSync(hbPath, JSON.stringify(heartbeat, null, 2));
  } catch (e) {
    log('error', `Failed to write heartbeat: ${e.message}`);
  }
  return heartbeat;
});

ipcMain.handle('read-studio-status', () => {
  const hsDir = getHandshakeDir();
  const studioPath = path.join(hsDir, 'studio_status.json');
  try {
    if (fs.existsSync(studioPath)) {
      return JSON.parse(fs.readFileSync(studioPath, 'utf8'));
    }
  } catch (e) {}
  return null;
});

ipcMain.handle('read-gallery-queue', () => {
  const hsDir = getHandshakeDir();
  const queuePath = path.join(hsDir, 'gallery_queue.json');
  try {
    if (fs.existsSync(queuePath)) {
      return JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    }
  } catch (e) {}
  return { queue: [] };
});

// ─── IPC: OUTPUT FILES ───────────────────────────────
ipcMain.handle('list-outputs', () => {
  try {
    const files = [];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (/\.(mp4|mov|webm)$/i.test(entry.name)) {
          const stat = fs.statSync(fullPath);
          // Check for JSON sidecar
          let postContent = null;
          const sidecarPath = fullPath.replace(/\.(mp4|mov|webm)$/i, '.json');
          try {
            if (fs.existsSync(sidecarPath)) {
              postContent = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
            }
          } catch (e) {}

          files.push({
            filename: entry.name,
            path: fullPath,
            size: stat.size,
            created: stat.birthtime.toISOString(),
            folder: path.relative(OUTPUT_DIR, dir),
            postContent
          });
        }
      }
    };
    walk(OUTPUT_DIR);
    files.sort((a, b) => new Date(b.created) - new Date(a.created));
    return { files };
  } catch (e) {
    return { files: [], error: e.message };
  }
});

ipcMain.handle('open-in-finder', (_, filePath) => {
  const { shell } = require('electron');
  shell.showItemInFolder(filePath);
});

// ─── IPC: CHECK FFMPEG ───────────────────────────────
ipcMain.handle('check-ffmpeg', () => {
  try {
    const version = execSync('ffmpeg -version', { stdio: 'pipe' }).toString().split('\n')[0];
    return { installed: true, version };
  } catch (e) {
    return { installed: false, version: null };
  }
});

// ─── GALLERY ROTATION ─────────────────────────────────
ipcMain.handle('get-next-gallery', async () => {
  const config = loadConfig();
  const photoPath = config.photographyPath;
  if (!photoPath || !fs.existsSync(photoPath)) {
    return { error: 'Photography path not configured' };
  }

  // First check Studio gallery queue
  const studioQueue = (() => {
    const hsDir = getHandshakeDir();
    const queuePath = path.join(hsDir, 'gallery_queue.json');
    try {
      if (fs.existsSync(queuePath)) {
        return JSON.parse(fs.readFileSync(queuePath, 'utf8'));
      }
    } catch (e) {}
    return { queue: [] };
  })();

  if (studioQueue.queue?.length > 0) {
    const next = studioQueue.queue[0];
    return { gallery: next.gallery, source: 'studio_queue', priority: next.priority };
  }

  // Use rotation mode
  const entries = fs.readdirSync(photoPath, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
    .map(e => e.name)
    .sort();

  if (entries.length === 0) return { error: 'No galleries found' };

  let nextGallery;
  const mode = config.rotation?.mode || 'sequential';

  if (mode === 'sequential') {
    const lastIdx = config.rotation?.lastGalleryIndex ?? -1;
    const nextIdx = (lastIdx + 1) % entries.length;
    nextGallery = entries[nextIdx];
    config.rotation.lastGalleryIndex = nextIdx;
    saveConfig(config);
  } else if (mode === 'random') {
    nextGallery = entries[Math.floor(Math.random() * entries.length)];
  } else {
    // queue mode — use the configured queue or fall back to sequential
    nextGallery = entries[(config.rotation?.lastGalleryIndex ?? -1 + 1) % entries.length];
  }

  return { gallery: nextGallery, source: mode };
});

// ─── SCHEDULING ENGINE (node-cron equivalent) ─────────
let schedulerInterval = null;

function startScheduler() {
  if (schedulerInterval) clearInterval(schedulerInterval);

  // Check every 60 seconds if a scheduled post is due
  schedulerInterval = setInterval(async () => {
    try {
      const config = loadConfig();
      if (!config.schedule?.enabled) return;

      const now = new Date();
      const tz = config.schedule.timezone || 'America/Los_Angeles';

      // Simple timezone offset approach
      const localTimeStr = now.toLocaleTimeString('en-US', {
        timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit'
      });

      const times = config.schedule.times || ['09:00', '18:00'];

      for (const schedTime of times) {
        if (localTimeStr === schedTime) {
          // Check if already posted this time slot today
          const today = now.toISOString().split('T')[0];
          const scheduleLog = loadScheduleLog();
          const key = `${today}_${schedTime}`;

          if (!scheduleLog.completed?.[key]) {
            log('info', `Scheduled post triggered: ${schedTime}`);
            await executeScheduledPost();

            // Mark as completed
            if (!scheduleLog.completed) scheduleLog.completed = {};
            scheduleLog.completed[key] = new Date().toISOString();
            saveScheduleLog(scheduleLog);
          }
        }
      }
    } catch (e) {
      log('error', `Scheduler error: ${e.message}`);
    }
  }, 60000); // Check every 60 seconds
}

function restartScheduler() {
  startScheduler();
}

const SCHEDULE_LOG_PATH = path.join(LOGS_DIR, 'schedule.json');

function loadScheduleLog() {
  try {
    if (fs.existsSync(SCHEDULE_LOG_PATH)) {
      return JSON.parse(fs.readFileSync(SCHEDULE_LOG_PATH, 'utf8'));
    }
  } catch (e) {}
  return { completed: {}, calendar: [] };
}

function saveScheduleLog(data) {
  fs.writeFileSync(SCHEDULE_LOG_PATH, JSON.stringify(data, null, 2));
}

ipcMain.handle('get-schedule-log', () => loadScheduleLog());

async function executeScheduledPost() {
  // This is the automated pipeline:
  // 1. Pick next gallery via rotation
  // 2. Scan photos
  // 3. Composite + render for all enabled platforms
  // 4. Save to output, add to post history
  log('info', 'Executing scheduled post...');

  try {
    const config = loadConfig();
    const photoPath = config.photographyPath;
    if (!photoPath) return;

    // Get next gallery
    const entries = fs.readdirSync(photoPath, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
      .map(e => e.name).sort();

    if (entries.length === 0) return;

    const lastIdx = config.rotation?.lastGalleryIndex ?? -1;
    const nextIdx = (lastIdx + 1) % entries.length;
    const galleryName = entries[nextIdx];

    config.rotation.lastGalleryIndex = nextIdx;
    saveConfig(config);

    const galleryPath = path.join(photoPath, galleryName);
    const photos = fs.readdirSync(galleryPath)
      .filter(f => /\.(jpg|jpeg|png|tif|tiff)$/i.test(f) && !f.startsWith('.'))
      .map(f => ({ filename: f, path: path.join(galleryPath, f) }));

    if (photos.length < 8) {
      log('warn', `Gallery ${galleryName} has only ${photos.length} photos, needs 8 minimum. Skipping.`);
      return;
    }

    log('info', `Scheduled render: ${galleryName} (${photos.length} photos)`);

    // For now, just log the scheduled post. Full auto-render can be enabled
    // when the system is tested and stable.
    const schedLog = loadScheduleLog();
    if (!schedLog.calendar) schedLog.calendar = [];
    schedLog.calendar.push({
      date: new Date().toISOString().split('T')[0],
      time: new Date().toLocaleTimeString('en-US', {
        timeZone: config.schedule.timezone, hour12: false, hour: '2-digit', minute: '2-digit'
      }),
      gallery: galleryName,
      photoCount: photos.length,
      status: 'scheduled',
      platforms: Object.keys(config.platforms).filter(k => config.platforms[k]?.enabled)
    });
    saveScheduleLog(schedLog);

  } catch (e) {
    log('error', `Scheduled post failed: ${e.message}`);
  }
}

// ─── HEARTBEAT TIMER ──────────────────────────────────
setInterval(() => {
  try {
    const config = loadConfig();
    let queueLength = 0;
    try {
      const qd = fs.existsSync(QUEUE_PATH)
        ? JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'))
        : { queue: [] };
      queueLength = qd.queue?.length || 0;
    } catch (e) {}

    const heartbeat = {
      app: 'archive35-social-media',
      version: '0.2.0',
      status: 'running',
      last_heartbeat: new Date().toISOString(),
      machine: 'i7-macbook-pro',
      current_task: 'idle',
      stats: {
        queue_length: queueLength
      }
    };

    const hsDir = getHandshakeDir();
    const hbPath = path.join(hsDir, 'social_status.json');
    fs.writeFileSync(hbPath, JSON.stringify(heartbeat, null, 2));
  } catch (e) {}
}, 60000);
