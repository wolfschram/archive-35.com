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

const app = express();
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
