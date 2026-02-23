/**
 * batch.js — Batch Compositing Job Queue for Archive-35 Mockup Engine
 *
 * Manages batch jobs that generate mockup images across multiple photos,
 * templates, and platforms. Jobs run asynchronously with progress tracking.
 *
 * Flow:
 *   1. Client POSTs batch config (photoIds, templateIds, platforms, printSize)
 *   2. Engine creates a job, returns jobId immediately
 *   3. Job processes images in parallel (configurable concurrency)
 *   4. Client polls /composite/status/:jobId for progress
 *   5. On completion, manifest JSON written to mockups/batches/
 */

'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { generatePlatformMockup } = require('./compositor');
const { getTemplate, REPO_ROOT } = require('./templates');

// In-memory job store (persists for service lifetime)
const jobs = new Map();

// Concurrency limit for compositing
const MAX_CONCURRENT = 3;

/**
 * Create and start a new batch compositing job.
 *
 * @param {object} config
 * @param {string[]} config.photoPaths - Relative paths to photos (from repo root)
 * @param {string[]} config.templateIds - Template IDs to composite onto
 * @param {string[]} config.platforms - Target platforms: 'etsy', 'pinterest', 'web-full', 'web-thumb'
 * @param {string} config.printSize - Print size string e.g. "24x36"
 * @returns {object} Job info { jobId, totalImages, status }
 */
async function createBatchJob(config) {
  const { photoPaths = [], templateIds = [], platforms = [], printSize = '24x36', queueToAgent = false } = config;

  if (!photoPaths.length) throw new Error('No photos specified');
  if (!templateIds.length) throw new Error('No templates specified');
  if (!platforms.length) throw new Error('No platforms specified');

  const jobId = `batch-${Date.now()}-${uuidv4().slice(0, 8)}`;
  const totalImages = photoPaths.length * templateIds.length * platforms.length;

  const job = {
    jobId,
    config: { photoPaths, templateIds, platforms, printSize, queueToAgent },
    totalImages,
    completed: 0,
    failed: 0,
    status: 'running',
    results: [],
    errors: [],
    startTime: Date.now(),
    endTime: null
  };

  jobs.set(jobId, job);

  // Run asynchronously — don't await
  processBatchJob(job).catch(err => {
    console.error(`[Batch] Job ${jobId} crashed:`, err);
    job.status = 'failed';
    job.endTime = Date.now();
  });

  return { jobId, totalImages, status: 'running' };
}

/**
 * Process all images in a batch job with controlled concurrency.
 */
async function processBatchJob(job) {
  const { photoPaths, templateIds, platforms, printSize } = job.config;

  // Build task list
  const tasks = [];
  for (const photoPath of photoPaths) {
    for (const templateId of templateIds) {
      for (const platform of platforms) {
        tasks.push({ photoPath, templateId, platform, printSize });
      }
    }
  }

  // Process with concurrency limit
  let index = 0;

  async function processNext() {
    while (index < tasks.length && job.status === 'running') {
      const taskIndex = index++;
      const task = tasks[taskIndex];

      try {
        const result = await processOneImage(task, job.jobId);
        job.results.push(result);
        job.completed++;
      } catch (err) {
        job.errors.push({
          ...task,
          error: err.message
        });
        job.failed++;
        job.completed++;
        console.error(`[Batch] Failed: ${task.photoPath} + ${task.templateId} → ${task.platform}: ${err.message}`);
      }
    }
  }

  // Launch concurrent workers
  const workers = [];
  for (let i = 0; i < Math.min(MAX_CONCURRENT, tasks.length); i++) {
    workers.push(processNext());
  }
  await Promise.all(workers);

  // Finalize
  job.status = job.failed === job.totalImages ? 'failed' : 'completed';
  job.endTime = Date.now();

  // Queue successful results to Agent content pipeline
  if (job.config.queueToAgent && job.results.length > 0) {
    let agentQueued = 0;
    const http = require('http');
    for (const result of job.results) {
      try {
        const body = JSON.stringify({
          image_path: result.outputPath,
          platform: result.platform,
          photo_path: result.photoPath,
          template_id: result.templateId,
          gallery: result.gallery || '',
          auto_generate: true
        });
        await new Promise((resolve, reject) => {
          const req = http.request({
            hostname: '127.0.0.1', port: 8035,
            path: '/mockup-content/queue', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: 30000
          }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
          req.write(body);
          req.end();
        });
        agentQueued++;
      } catch (err) {
        console.warn(`[Batch] Failed to queue ${result.outputPath} to Agent:`, err.message);
      }
    }
    job.agentQueued = agentQueued;
    console.log(`[Batch] Queued ${agentQueued}/${job.results.length} to Agent content pipeline`);
  }

  // Write batch manifest
  await writeBatchManifest(job);

  console.log(`[Batch] Job ${job.jobId} complete: ${job.completed - job.failed} success, ${job.failed} failed in ${((job.endTime - job.startTime) / 1000).toFixed(1)}s`);
}

/**
 * Process a single image: composite + save to disk.
 */
async function processOneImage(task, jobId) {
  const { photoPath, templateId, platform, printSize } = task;

  const template = await getTemplate(templateId);
  if (!template) throw new Error(`Template ${templateId} not found`);

  const resolvedPhotoPath = path.isAbsolute(photoPath)
    ? photoPath
    : path.join(REPO_ROOT, photoPath);

  // Generate slug from photo filename
  const photoFilename = path.basename(photoPath, path.extname(photoPath));
  const photoSlug = photoFilename.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-');

  // Determine gallery from path
  const pathParts = photoPath.split('/');
  const galleryIndex = pathParts.indexOf('photography');
  const gallery = galleryIndex >= 0 && pathParts.length > galleryIndex + 1
    ? pathParts[galleryIndex + 1].toLowerCase().replace(/[^a-z0-9]+/g, '-')
    : 'unknown';

  // Output path: mockups/{gallery}/{photo-slug}/{slug}-{template}-{platform}.jpg
  const outputDir = path.join(REPO_ROOT, 'mockups', gallery, photoSlug);
  const outputFilename = `${photoSlug}-${templateId}-${platform}.jpg`;
  const outputPath = path.join(outputDir, outputFilename);

  const startTime = Date.now();

  await generatePlatformMockup({
    photoPath: resolvedPhotoPath,
    template,
    printSize,
    platform,
    quality: 'high',
    outputPath
  });

  const elapsed = Date.now() - startTime;

  return {
    photoPath,
    templateId,
    platform,
    printSize,
    outputPath: path.relative(REPO_ROOT, outputPath),
    gallery,
    photoSlug,
    renderTimeMs: elapsed
  };
}

/**
 * Write batch job manifest to mockups/batches/.
 */
async function writeBatchManifest(job) {
  const batchDir = path.join(REPO_ROOT, 'mockups', 'batches');
  await fs.mkdir(batchDir, { recursive: true });

  const manifest = {
    jobId: job.jobId,
    config: job.config,
    totalImages: job.totalImages,
    successCount: job.completed - job.failed,
    failedCount: job.failed,
    status: job.status,
    startTime: new Date(job.startTime).toISOString(),
    endTime: new Date(job.endTime).toISOString(),
    durationMs: job.endTime - job.startTime,
    results: job.results,
    errors: job.errors
  };

  const manifestPath = path.join(batchDir, `${job.jobId}.json`);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  return manifestPath;
}

/**
 * Get job status.
 */
function getJobStatus(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;

  return {
    jobId: job.jobId,
    status: job.status,
    totalImages: job.totalImages,
    completed: job.completed,
    failed: job.failed,
    progress: job.totalImages > 0 ? Math.round((job.completed / job.totalImages) * 100) : 0,
    durationMs: (job.endTime || Date.now()) - job.startTime,
    errors: job.errors
  };
}

/**
 * Cancel a running job.
 */
function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  job.status = 'cancelled';
  job.endTime = Date.now();
  return true;
}

/**
 * List all jobs (most recent first).
 */
function listJobs() {
  return Array.from(jobs.values())
    .sort((a, b) => b.startTime - a.startTime)
    .map(j => ({
      jobId: j.jobId,
      status: j.status,
      totalImages: j.totalImages,
      completed: j.completed,
      failed: j.failed,
      progress: j.totalImages > 0 ? Math.round((j.completed / j.totalImages) * 100) : 0,
      startTime: new Date(j.startTime).toISOString(),
      durationMs: (j.endTime || Date.now()) - j.startTime
    }));
}

/**
 * List generated mockups from the mockups/ directory.
 * Scans the filesystem for actual output files.
 *
 * @param {object} filters - Optional filters: { gallery, platform }
 * @returns {Promise<object[]>} Array of mockup file info
 */
async function listMockups(filters = {}) {
  const mockupsDir = path.join(REPO_ROOT, 'mockups');
  const mockups = [];

  try {
    const galleries = await fs.readdir(mockupsDir);

    for (const gallery of galleries) {
      if (gallery === 'batches') continue; // Skip manifests dir

      if (filters.gallery && gallery !== filters.gallery) continue;

      const galleryPath = path.join(mockupsDir, gallery);
      const stat = await fs.stat(galleryPath);
      if (!stat.isDirectory()) continue;

      const photoSlugs = await fs.readdir(galleryPath);

      for (const slug of photoSlugs) {
        const slugPath = path.join(galleryPath, slug);
        const slugStat = await fs.stat(slugPath);
        if (!slugStat.isDirectory()) continue;

        const files = await fs.readdir(slugPath);

        for (const file of files) {
          if (!file.endsWith('.jpg')) continue;

          // Parse filename: {slug}-{template}-{platform}.jpg
          const match = file.match(/^(.+)-([^-]+-[^-]+)-(\w[\w-]*\w)\.jpg$/);
          const platform = match ? match[3] : 'unknown';

          if (filters.platform && platform !== filters.platform) continue;

          const filePath = path.join(slugPath, file);
          const fileStat = await fs.stat(filePath);

          mockups.push({
            filename: file,
            path: path.relative(REPO_ROOT, filePath),
            gallery,
            photoSlug: slug,
            platform,
            sizeBytes: fileStat.size,
            createdAt: fileStat.birthtime.toISOString()
          });
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // mockups/ doesn't exist yet — that's fine
  }

  return mockups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * List galleries from the photography/ source of truth.
 * Returns gallery names and photo counts.
 */
async function listGalleries() {
  const photoDir = path.join(REPO_ROOT, 'photography');
  const galleries = [];

  try {
    const entries = await fs.readdir(photoDir);

    for (const entry of entries) {
      const entryPath = path.join(photoDir, entry);
      const stat = await fs.stat(entryPath);
      if (!stat.isDirectory()) continue;

      const files = await fs.readdir(entryPath);
      const photos = files.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));

      galleries.push({
        name: entry,
        slug: entry.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        photoCount: photos.length,
        path: `photography/${entry}`
      });
    }
  } catch (err) {
    console.error('Error listing galleries:', err);
  }

  return galleries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * List photos in a gallery.
 */
async function listPhotos(galleryName) {
  const galleryPath = path.join(REPO_ROOT, 'photography', galleryName);
  const photos = [];

  try {
    const files = await fs.readdir(galleryPath);

    for (const file of files) {
      if (!/\.(jpg|jpeg|png|webp)$/i.test(file)) continue;

      const filePath = path.join(galleryPath, file);
      const stat = await fs.stat(filePath);

      photos.push({
        filename: file,
        path: `photography/${galleryName}/${file}`,
        sizeBytes: stat.size,
        sizeMB: (stat.size / (1024 * 1024)).toFixed(1)
      });
    }
  } catch (err) {
    console.error('Error listing photos:', err);
  }

  return photos.sort((a, b) => a.filename.localeCompare(b.filename));
}

module.exports = {
  createBatchJob,
  getJobStatus,
  cancelJob,
  listJobs,
  listMockups,
  listGalleries,
  listPhotos
};
