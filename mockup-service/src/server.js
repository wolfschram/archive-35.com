/**
 * server.js — Archive-35 Mockup Compositing Service (v2 — Phase 2/3)
 *
 * ⚠️ PROTECTED FILE — Risk: HIGH
 * Dependencies: compositor.js, templates.js, matcher.js, batch.js, zone-detect.js, prompt-generator.js
 * Side effects: All mockup API calls go through this server
 * Read first: CONSTRAINTS.md (ports, templates.json), LESSONS_LEARNED.md #033
 * Consumers: Studio (via IPC mockupApiCall), Agent (via HTTP localhost:8036)
 *
 * Express server providing REST endpoints for mockup generation.
 * Port 8036 (alongside Agent on 8035, Studio Electron UI).
 *
 * v2 endpoints (2026-02-23):
 *   POST /preview/social      — Generate branded mockup for social posting
 *   GET  /branding/config     — Get current branding configuration
 *   POST /branding/test       — Test branding overlay on a sample image
 *
 * v3 endpoints (thumbnail/enhanced gallery):
 *   GET  /galleries/:name/photos     — Enhanced gallery with dimensions and thumbnail URLs
 *   GET  /thumbnail                  — Serve thumbnail of any photo (query: path, size=200)
 *   GET  /templates/:id/thumbnail    — Serve template thumbnail (query: size=200)
 *
 * Existing endpoints:
 *   GET  /health              — Service health check
 *   GET  /galleries           — List all galleries
 *   GET  /galleries/:name     — List photos in gallery (now with dimensions)
 *   GET  /templates           — List all room templates
 *   GET  /templates/:id       — Get template details
 *   POST /templates           — Create/update template
 *   POST /preview             — Generate single mockup preview (returns JPEG)
 *   POST /composite/batch     — Start batch compositing job
 *   GET  /composite/status/:id — Check batch job progress
 *   GET  /mockups             — List generated mockups
 *   GET  /match/*             — Compatibility engine endpoints
 *   POST /prompt/*            — ChatGPT prompt generator endpoints
 */

'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs').promises;
const fsSync = require('fs');
const { generateMockup, generatePlatformMockup, addBrandingOverlay } = require('./compositor');
const {
  listTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  validateTemplate,
  REPO_ROOT
} = require('./templates');
const {
  createBatchJob,
  getJobStatus,
  cancelJob,
  listJobs,
  listMockups,
  listGalleries,
  listPhotos
} = require('./batch');
const { detectZone, autoDetectTemplates } = require('./zone-detect');
const {
  loadAndAnalyze,
  isCompatible,
  getSmartMatchPairs,
  ASPECT_CATEGORIES
} = require('./matcher');
const {
  generateRoomPrompt,
  generatePromptsForUnmatched,
  ROOM_PRESETS
} = require('./prompt-generator');

const app = express();

// Cached compatibility matrix (rebuilt on demand)
let _cachedMatrix = null;
let _cachedPhotos = null;
function getMatrix() {
  if (!_cachedMatrix) {
    const result = loadAndAnalyze(REPO_ROOT);
    _cachedMatrix = result.matrix;
    _cachedPhotos = result.photos;
  }
  return { matrix: _cachedMatrix, photos: _cachedPhotos };
}
function invalidateMatrix() { _cachedMatrix = null; _cachedPhotos = null; }

// Thumbnail cache (in-memory, max 500 entries)
const thumbnailCache = new Map();
const MAX_THUMBNAIL_CACHE = 500;

function setCachedThumbnail(cacheKey, buffer) {
  if (thumbnailCache.size >= MAX_THUMBNAIL_CACHE) {
    const firstKey = thumbnailCache.keys().next().value;
    thumbnailCache.delete(firstKey);
  }
  thumbnailCache.set(cacheKey, buffer);
}

function getCachedThumbnail(cacheKey) {
  return thumbnailCache.get(cacheKey);
}

const PORT = process.env.MOCKUP_PORT || 8036;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve generated mockups as static files
app.use('/mockups/file', express.static(path.join(REPO_ROOT, 'mockups')));

// --- Health ---

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'archive35-mockup-service',
    version: '1.0.0',
    port: PORT,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// --- Templates ---

app.get('/templates', async (req, res) => {
  try {
    const templates = await listTemplates();
    res.json({
      count: templates.length,
      templates: templates.map(t => ({
        id: t.id,
        name: t.name,
        category: t.category,
        image: t.image,
        dimensions: t.dimensions,
        printSizes: t.printSizes,
        wallColor: t.wallColor,
        ambientLight: t.ambientLight,
        placementZones: t.placementZones,
        zoneCount: t.placementZones ? t.placementZones.length : 0
      }))
    });
  } catch (err) {
    console.error('Error listing templates:', err);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

app.get('/templates/:id', async (req, res) => {
  try {
    const template = await getTemplate(req.params.id);
    if (!template) {
      return res.status(404).json({ error: `Template "${req.params.id}" not found` });
    }
    res.json(template);
  } catch (err) {
    console.error('Error getting template:', err);
    res.status(500).json({ error: 'Failed to get template' });
  }
});

app.post('/templates', async (req, res) => {
  try {
    const validation = validateTemplate(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Invalid template', details: validation.errors });
    }
    const saved = await saveTemplate(req.body);
    res.status(201).json(saved);
  } catch (err) {
    console.error('Error saving template:', err);
    res.status(500).json({ error: 'Failed to save template' });
  }
});

app.put('/templates/:id', async (req, res) => {
  try {
    const template = { ...req.body, id: req.params.id };
    const validation = validateTemplate(template);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Invalid template', details: validation.errors });
    }
    const saved = await saveTemplate(template);
    res.json(saved);
  } catch (err) {
    console.error('Error updating template:', err);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// --- Preview ---

app.post('/preview', async (req, res) => {
  try {
    const { templateId, photoPath, printSize = '24x36', platform, zoneIndex = 0 } = req.body;

    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }
    if (!photoPath) {
      return res.status(400).json({ error: 'photoPath is required' });
    }

    // Resolve photo path relative to repo root if not absolute
    const resolvedPhotoPath = path.isAbsolute(photoPath)
      ? photoPath
      : path.join(REPO_ROOT, photoPath);

    // Load template
    const template = await getTemplate(templateId);
    if (!template) {
      return res.status(404).json({ error: `Template "${templateId}" not found` });
    }

    const startTime = Date.now();

    let result;
    if (platform) {
      // Platform-specific output
      result = await generatePlatformMockup({
        photoPath: resolvedPhotoPath,
        template,
        printSize,
        zoneIndex,
        platform,
        quality: 'high'
      });
    } else {
      // Full-resolution mockup
      result = await generateMockup({
        photoPath: resolvedPhotoPath,
        template,
        printSize,
        zoneIndex,
        quality: 'high'
      });
    }

    const elapsed = Date.now() - startTime;
    console.log(`Preview generated in ${elapsed}ms — template: ${templateId}, photo: ${path.basename(photoPath)}, size: ${printSize}`);

    res.set('Content-Type', 'image/jpeg');
    res.set('X-Render-Time-Ms', String(elapsed));
    res.send(result);

  } catch (err) {
    console.error('Error generating preview:', err);
    res.status(500).json({
      error: 'Failed to generate preview',
      details: err.message
    });
  }
});

// --- Galleries (Photo Browser) ---

app.get('/galleries', async (req, res) => {
  try {
    const galleries = await listGalleries();
    res.json({ count: galleries.length, galleries });
  } catch (err) {
    console.error('Error listing galleries:', err);
    res.status(500).json({ error: 'Failed to list galleries' });
  }
});

app.get('/galleries/:name', async (req, res) => {
  try {
    const photos = await listPhotos(req.params.name);

    // Enhance photos with dimensions using Sharp
    const enhancedPhotos = await Promise.all(
      photos.map(async (photo) => {
        try {
          const fullPath = path.isAbsolute(photo.path)
            ? photo.path
            : path.join(REPO_ROOT, photo.path);

          if (fsSync.existsSync(fullPath)) {
            const metadata = await sharp(fullPath).metadata();
            return {
              ...photo,
              width: metadata.width,
              height: metadata.height,
              aspectRatio: metadata.width / metadata.height
            };
          }
        } catch (err) {
          console.error(`Failed to read metadata for ${photo.path}:`, err.message);
        }
        return photo;
      })
    );

    res.json({ gallery: req.params.name, count: enhancedPhotos.length, photos: enhancedPhotos });
  } catch (err) {
    console.error('Error listing photos:', err);
    res.status(500).json({ error: 'Failed to list photos' });
  }
});

// Enhanced gallery endpoint with thumbnail URLs
app.get('/galleries/:name/photos', async (req, res) => {
  try {
    const photos = await listPhotos(req.params.name);

    // Enhance photos with dimensions and thumbnail URLs
    const enhancedPhotos = await Promise.all(
      photos.map(async (photo) => {
        try {
          const fullPath = path.isAbsolute(photo.path)
            ? photo.path
            : path.join(REPO_ROOT, photo.path);

          if (fsSync.existsSync(fullPath)) {
            const stats = await fs.stat(fullPath);
            const metadata = await sharp(fullPath).metadata();

            return {
              filename: photo.filename || path.basename(photo.path),
              path: photo.path,
              sizeBytes: stats.size,
              sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
              width: metadata.width,
              height: metadata.height,
              aspectRatio: (metadata.width / metadata.height).toFixed(3),
              thumbnailUrl: `/thumbnail?path=${encodeURIComponent(photo.path)}`
            };
          }
        } catch (err) {
          console.error(`Failed to process photo ${photo.path}:`, err.message);
        }
        return null;
      })
    );

    const validPhotos = enhancedPhotos.filter(p => p !== null);
    res.json({ gallery: req.params.name, count: validPhotos.length, photos: validPhotos });
  } catch (err) {
    console.error('Error listing photos:', err);
    res.status(500).json({ error: 'Failed to list photos' });
  }
});

// --- Thumbnails ---

// Serve a thumbnail of any photo
// Query params: path (relative to REPO_ROOT), size (default 200)
app.get('/thumbnail', async (req, res) => {
  try {
    const { path: photoPath, size = 200 } = req.query;

    if (!photoPath) {
      return res.status(400).json({ error: 'path query parameter is required' });
    }

    const sizeNum = Math.max(50, Math.min(1000, parseInt(size) || 200));
    const cacheKey = `${photoPath}:${sizeNum}`;

    // Check cache first
    const cached = getCachedThumbnail(cacheKey);
    if (cached) {
      res.set('Content-Type', 'image/jpeg');
      res.set('X-Cache', 'HIT');
      return res.send(cached);
    }

    // Resolve path
    const fullPath = path.isAbsolute(photoPath)
      ? photoPath
      : path.join(REPO_ROOT, photoPath);

    if (!fsSync.existsSync(fullPath)) {
      return res.status(404).json({ error: `Photo not found: ${photoPath}` });
    }

    // Generate thumbnail with Sharp
    const thumbnail = await sharp(fullPath)
      .resize(sizeNum, sizeNum, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Cache it
    setCachedThumbnail(cacheKey, thumbnail);

    res.set('Content-Type', 'image/jpeg');
    res.set('X-Cache', 'MISS');
    res.send(thumbnail);
  } catch (err) {
    console.error('Error generating thumbnail:', err);
    res.status(500).json({ error: 'Failed to generate thumbnail', details: err.message });
  }
});

// Serve a room template thumbnail
// Query param: size (default 200)
app.get('/templates/:id/thumbnail', async (req, res) => {
  try {
    const { size = 200 } = req.query;

    const template = await getTemplate(req.params.id);
    if (!template) {
      return res.status(404).json({ error: `Template "${req.params.id}" not found` });
    }

    if (!template.image) {
      return res.status(400).json({ error: 'Template has no image' });
    }

    const sizeNum = Math.max(50, Math.min(1000, parseInt(size) || 200));
    const cacheKey = `template:${req.params.id}:${sizeNum}`;

    // Check cache first
    const cached = getCachedThumbnail(cacheKey);
    if (cached) {
      res.set('Content-Type', 'image/jpeg');
      res.set('X-Cache', 'HIT');
      return res.send(cached);
    }

    // Resolve template image path
    const imagePath = path.isAbsolute(template.image)
      ? template.image
      : path.join(REPO_ROOT, template.image);

    if (!fsSync.existsSync(imagePath)) {
      return res.status(404).json({ error: `Template image not found: ${template.image}` });
    }

    // Generate thumbnail with Sharp
    const thumbnail = await sharp(imagePath)
      .resize(sizeNum, sizeNum, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Cache it
    setCachedThumbnail(cacheKey, thumbnail);

    res.set('Content-Type', 'image/jpeg');
    res.set('X-Cache', 'MISS');
    res.send(thumbnail);
  } catch (err) {
    console.error('Error generating template thumbnail:', err);
    res.status(500).json({ error: 'Failed to generate template thumbnail', details: err.message });
  }
});

// --- Batch Compositing ---

app.post('/composite/batch', async (req, res) => {
  try {
    const result = await createBatchJob(req.body);
    res.status(202).json(result);
  } catch (err) {
    console.error('Error creating batch job:', err);
    res.status(400).json({ error: err.message });
  }
});

app.get('/composite/status/:jobId', async (req, res) => {
  const status = getJobStatus(req.params.jobId);
  if (!status) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(status);
});

app.post('/composite/cancel/:jobId', async (req, res) => {
  const cancelled = cancelJob(req.params.jobId);
  res.json({ success: cancelled });
});

app.get('/composite/jobs', async (req, res) => {
  res.json({ jobs: listJobs() });
});

// --- Mockups (Generated Files) ---

app.get('/mockups', async (req, res) => {
  try {
    const filters = {};
    if (req.query.gallery) filters.gallery = req.query.gallery;
    if (req.query.platform) filters.platform = req.query.platform;
    const mockups = await listMockups(filters);
    res.json({ count: mockups.length, mockups });
  } catch (err) {
    console.error('Error listing mockups:', err);
    res.status(500).json({ error: 'Failed to list mockups' });
  }
});

// Save a mockup to the social folder for agent posting
app.post('/mockups/save', async (req, res) => {
  try {
    const { templateId, photoPath, platform = 'etsy', printSize = '24x36' } = req.body;
    if (!templateId || !photoPath) {
      return res.status(400).json({ error: 'templateId and photoPath required' });
    }

    const resolvedPhotoPath = path.isAbsolute(photoPath) ? photoPath : path.join(REPO_ROOT, photoPath);
    const template = await getTemplate(templateId);
    if (!template) return res.status(404).json({ error: `Template "${templateId}" not found` });

    // Generate the platform-specific mockup
    const result = platform
      ? await generatePlatformMockup({ photoPath: resolvedPhotoPath, template, printSize, zoneIndex: 0, platform, quality: 'high' })
      : await generateMockup({ photoPath: resolvedPhotoPath, template, printSize, zoneIndex: 0, quality: 'high' });

    // Build filename from gallery + photo + template + platform
    const gallery = path.basename(path.dirname(photoPath)).toLowerCase().replace(/\s+/g, '-');
    const photo = path.basename(photoPath, path.extname(photoPath)).toLowerCase().replace(/\s+/g, '-');
    const filename = `${gallery}_${photo}_${templateId}_${platform || 'full'}.jpg`;

    // Save to mockups/social/
    const socialDir = path.join(REPO_ROOT, 'mockups', 'social');
    const fsPromises = require('fs').promises;
    await fsPromises.mkdir(socialDir, { recursive: true });
    const outPath = path.join(socialDir, filename);
    await fsPromises.writeFile(outPath, result);

    const stat = await fsPromises.stat(outPath);

    // If queueToAgent flag is set, call Agent API to queue for social posting
    let agentQueued = false;
    if (req.body.queueToAgent) {
      try {
        const http = require('http');
        const agentBody = JSON.stringify({
          image_path: `mockups/social/${filename}`,
          platform: platform || 'instagram',
          photo_path: photoPath,
          template_id: templateId,
          gallery: gallery,
          auto_generate: true
        });
        await new Promise((resolve, reject) => {
          const agentReq = http.request({
            hostname: '127.0.0.1', port: 8035,
            path: '/mockup-content/queue', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(agentBody) },
            timeout: 30000
          }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
              try { resolve(JSON.parse(data)); } catch { resolve(data); }
            });
          });
          agentReq.on('error', reject);
          agentReq.on('timeout', () => { agentReq.destroy(); reject(new Error('Agent timeout')); });
          agentReq.write(agentBody);
          agentReq.end();
        });
        agentQueued = true;
      } catch (err) {
        console.warn('Failed to queue to Agent:', err.message);
      }
    }

    res.json({
      success: true,
      filename,
      path: `mockups/social/${filename}`,
      sizeBytes: stat.size,
      platform,
      templateId,
      gallery,
      agentQueued
    });
  } catch (err) {
    console.error('Error saving mockup:', err);
    res.status(500).json({ error: 'Failed to save mockup', details: err.message });
  }
});

// --- Zone Auto-Detection ---

// Detect placement zone in a single image
app.post('/detect-zone', async (req, res) => {
  try {
    const { imagePath, method } = req.body;
    if (!imagePath) {
      return res.status(400).json({ error: 'imagePath is required' });
    }

    const fullPath = path.isAbsolute(imagePath) ? imagePath : path.join(REPO_ROOT, imagePath);
    const detection = await detectZone(fullPath, { method });

    res.json(detection);
  } catch (err) {
    console.error('Error detecting zone:', err);
    res.status(500).json({ error: 'Zone detection failed', details: err.message });
  }
});

// Auto-detect all room templates and rebuild templates.json
app.post('/detect-all', async (req, res) => {
  try {
    const roomsDir = path.join(REPO_ROOT, 'templates', 'rooms');
    const detected = await autoDetectTemplates(roomsDir);

    // Merge with existing templates (keep manually defined ones)
    const existing = listTemplates();
    const existingIds = new Set(existing.map(t => t.id));

    // Keep existing manual templates, add new auto-detected ones
    const merged = [...existing];
    let added = 0;
    for (const t of detected) {
      if (!existingIds.has(t.id)) {
        merged.push(t);
        added++;
      }
    }

    // Write merged templates
    const fs = require('fs').promises;
    const templatesPath = path.join(REPO_ROOT, 'templates', 'templates.json');
    await fs.writeFile(templatesPath, JSON.stringify(merged, null, 2));

    res.json({
      total: merged.length,
      added,
      existing: existing.length,
      detected: detected.map(d => ({
        id: d.id,
        category: d.category,
        method: d._detection.method,
        confidence: d._detection.confidence
      }))
    });
  } catch (err) {
    console.error('Error in auto-detect:', err);
    res.status(500).json({ error: 'Auto-detect failed', details: err.message });
  }
});

// --- Matching Engine ---

// Full compatibility stats
app.get('/match/stats', (req, res) => {
  try {
    const result = loadAndAnalyze(REPO_ROOT, parseFloat(req.query.tolerance) || undefined);
    res.json(result.stats);
  } catch (err) {
    console.error('Error computing match stats:', err);
    res.status(500).json({ error: 'Failed to compute match stats', details: err.message });
  }
});

// Compatible templates for a specific photo
app.get('/match/photo/:id', (req, res) => {
  try {
    const { matrix } = getMatrix();
    const entry = matrix.byPhoto[req.params.id];
    if (!entry) {
      return res.status(404).json({ error: `Photo "${req.params.id}" not found` });
    }
    res.json(entry);
  } catch (err) {
    console.error('Error matching photo:', err);
    res.status(500).json({ error: 'Failed to match photo', details: err.message });
  }
});

// Compatible photos for a specific template
app.get('/match/template/:id', (req, res) => {
  try {
    const { matrix } = getMatrix();
    const entry = matrix.byTemplate[req.params.id];
    if (!entry) {
      return res.status(404).json({ error: `Template "${req.params.id}" not found` });
    }
    res.json({
      template: entry.template,
      compatibleCount: entry.compatiblePhotos.length,
      photos: entry.compatiblePhotos
    });
  } catch (err) {
    console.error('Error matching template:', err);
    res.status(500).json({ error: 'Failed to match template', details: err.message });
  }
});

// Smart-match pairs for batch generation
app.get('/match/pairs', (req, res) => {
  try {
    const { matrix, photos } = getMatrix();
    const maxPerPhoto = parseInt(req.query.maxPerPhoto) || 3;
    const fitType = req.query.fitType || 'good';
    const pairs = getSmartMatchPairs(matrix, photos, { maxPerPhoto, fitType });
    res.json({
      totalPairs: pairs.length,
      uniquePhotos: new Set(pairs.map(p => p.photoId)).size,
      uniqueTemplates: new Set(pairs.map(p => p.templateId)).size,
      pairs
    });
  } catch (err) {
    console.error('Error computing pairs:', err);
    res.status(500).json({ error: 'Failed to compute pairs', details: err.message });
  }
});

// Force-refresh the cached matrix (after adding new templates)
app.post('/match/refresh', (req, res) => {
  invalidateMatrix();
  const { matrix } = getMatrix();
  const photoCount = Object.keys(matrix.byPhoto).length;
  const templateCount = matrix.templateAspects.length;
  res.json({ refreshed: true, photoCount, templateCount });
});

// Aspect ratio categories reference
app.get('/match/categories', (req, res) => {
  res.json({ categories: ASPECT_CATEGORIES });
});

// --- ChatGPT Prompt Generator ---

// Generate a single prompt for a specific aspect ratio + room type
app.post('/prompt/generate', (req, res) => {
  try {
    const { aspectRatio, roomType = 'living-room-modern', imageWidth, zonePercent } = req.body;
    if (!aspectRatio) {
      return res.status(400).json({ error: 'aspectRatio is required' });
    }
    const prompt = generateRoomPrompt({ aspectRatio, roomType, imageWidth, zonePercent });
    res.json({ aspectRatio, roomType, prompt });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Generate prompts for all unmatched photos
app.get('/prompt/unmatched', (req, res) => {
  try {
    const result = loadAndAnalyze(REPO_ROOT);
    const prompts = generatePromptsForUnmatched(result.stats.unmatchedPhotos);
    res.json({
      unmatchedPhotoCount: result.stats.unmatchedPhotos.length,
      promptsGenerated: prompts.length,
      prompts
    });
  } catch (err) {
    console.error('Error generating unmatched prompts:', err);
    res.status(500).json({ error: 'Failed to generate prompts', details: err.message });
  }
});

// List available room presets
app.get('/prompt/room-types', (req, res) => {
  const types = Object.entries(ROOM_PRESETS).map(([key, preset]) => ({
    id: key,
    name: preset.name,
    description: preset.description
  }));
  res.json({ roomTypes: types });
});

// --- Phase 2/3: Social Mockup Generation ---

// Generate a branded mockup ready for social posting
// Returns JPEG with Archive-35.com logo overlay
app.post('/preview/social', async (req, res) => {
  try {
    const {
      templateId,
      photoPath,
      printSize = '24x36',
      platform = 'instagram',
      zoneIndex = 0,
      skipBranding = false
    } = req.body;

    if (!templateId) return res.status(400).json({ error: 'templateId is required' });
    if (!photoPath) return res.status(400).json({ error: 'photoPath is required' });

    const validPlatforms = ['etsy', 'pinterest', 'instagram', 'web-full', 'web-thumb'];
    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({ error: `Invalid platform. Valid: ${validPlatforms.join(', ')}` });
    }

    const resolvedPhotoPath = path.isAbsolute(photoPath)
      ? photoPath
      : path.join(REPO_ROOT, photoPath);

    const template = await getTemplate(templateId);
    if (!template) {
      return res.status(404).json({ error: `Template "${templateId}" not found` });
    }

    const startTime = Date.now();

    const result = await generatePlatformMockup({
      photoPath: resolvedPhotoPath,
      template,
      printSize,
      zoneIndex,
      platform,
      quality: 'high',
      skipBranding
    });

    const elapsed = Date.now() - startTime;
    console.log(`Social mockup generated in ${elapsed}ms — platform: ${platform}, template: ${templateId}, photo: ${path.basename(photoPath)}`);

    res.set('Content-Type', 'image/jpeg');
    res.set('X-Render-Time-Ms', String(elapsed));
    res.set('X-Platform', platform);
    res.set('X-Branded', String(!skipBranding));
    res.send(result);
  } catch (err) {
    console.error('Error generating social mockup:', err);
    res.status(500).json({ error: 'Failed to generate social mockup', details: err.message });
  }
});

// Batch generate social mockups for a set of photo-template pairs
app.post('/preview/social/batch', async (req, res) => {
  try {
    const { pairs, platform = 'instagram', outputDir } = req.body;
    if (!pairs || !Array.isArray(pairs) || pairs.length === 0) {
      return res.status(400).json({ error: 'pairs array is required (each: {templateId, photoPath, printSize})' });
    }

    const results = [];
    const startTime = Date.now();

    for (const pair of pairs) {
      try {
        const template = await getTemplate(pair.templateId);
        if (!template) {
          results.push({ ...pair, status: 'error', error: `Template not found: ${pair.templateId}` });
          continue;
        }

        const resolvedPhotoPath = path.isAbsolute(pair.photoPath)
          ? pair.photoPath
          : path.join(REPO_ROOT, pair.photoPath);

        const outputPath = outputDir
          ? path.join(REPO_ROOT, outputDir, `${pair.templateId}_${path.basename(pair.photoPath, '.jpg')}_${platform}.jpg`)
          : null;

        await generatePlatformMockup({
          photoPath: resolvedPhotoPath,
          template,
          printSize: pair.printSize || '24x36',
          platform,
          quality: 'high',
          outputPath
        });

        results.push({
          ...pair,
          status: 'success',
          outputPath: outputPath || '(returned as buffer)'
        });
      } catch (pairErr) {
        results.push({ ...pair, status: 'error', error: pairErr.message });
      }
    }

    const elapsed = Date.now() - startTime;
    const succeeded = results.filter(r => r.status === 'success').length;

    res.json({
      totalPairs: pairs.length,
      succeeded,
      failed: pairs.length - succeeded,
      elapsedMs: elapsed,
      avgMs: Math.round(elapsed / pairs.length),
      results
    });
  } catch (err) {
    console.error('Error in social batch:', err);
    res.status(500).json({ error: 'Batch generation failed', details: err.message });
  }
});

// Get branding configuration
app.get('/branding/config', (req, res) => {
  const fsSync = require('fs');
  const logoPath = path.join(REPO_ROOT, 'logos', 'archive35-wordmark-600.png');
  const iconPath = path.join(REPO_ROOT, 'logos', 'archive35-icon-200.png');

  res.json({
    logoExists: fsSync.existsSync(logoPath),
    iconExists: fsSync.existsSync(iconPath),
    logoPath,
    iconPath,
    platforms: {
      etsy:      { size: '2000x2000', position: 'bottom-right', opacity: 0.7, scale: '12%' },
      pinterest: { size: '1000x1500', position: 'bottom-right', opacity: 0.7, scale: '15%' },
      instagram: { size: '1080x1080', position: 'bottom-right', opacity: 0.65, scale: '14%' },
      'web-full':  { size: '2000xAuto', position: 'bottom-right', opacity: 0.5, scale: '10%' },
      'web-thumb': { size: '400xAuto', position: 'bottom-right', opacity: 0.5, scale: '15%' }
    }
  });
});

// --- Error handling ---

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// --- Start ---

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Archive-35 Mockup Service running on port ${PORT}`);
    console.log(`Health: http://localhost:${PORT}/health`);
    console.log(`Repo root: ${REPO_ROOT}`);
  });
}

module.exports = app;
