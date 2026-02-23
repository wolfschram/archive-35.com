/**
 * server.js — Archive-35 Mockup Compositing Service
 *
 * Express server providing REST endpoints for mockup generation.
 * Port 8036 (alongside Agent on 8035, Studio Electron UI).
 *
 * Endpoints:
 *   GET  /health              — Service health check
 *   GET  /templates           — List all room templates
 *   GET  /templates/:id       — Get template details
 *   POST /templates           — Create new template
 *   PUT  /templates/:id       — Update template
 *   POST /preview             — Generate single mockup preview (returns JPEG)
 *   POST /composite/batch     — Start batch compositing job (Phase 5)
 *   GET  /composite/status/:id — Check batch job progress (Phase 5)
 *   GET  /mockups             — List generated mockups (Phase 5)
 */

'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const { generateMockup, generatePlatformMockup } = require('./compositor');
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
    res.json({ gallery: req.params.name, count: photos.length, photos });
  } catch (err) {
    console.error('Error listing photos:', err);
    res.status(500).json({ error: 'Failed to list photos' });
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
