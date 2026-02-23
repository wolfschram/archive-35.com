#!/usr/bin/env node
/**
 * detect-rooms.js — CLI script to auto-detect wall zones in room templates.
 *
 * Usage:
 *   node scripts/detect-rooms.js              # Detect all rooms in templates/rooms/
 *   node scripts/detect-rooms.js --rebuild    # Rebuild templates.json from scratch
 *   node scripts/detect-rooms.js --image path/to/room.jpg  # Detect single image
 *
 * Scans room images, finds wall placement zones, updates templates.json.
 */

'use strict';

const path = require('path');
const fs = require('fs').promises;
const { detectZone, autoDetectTemplates } = require('../src/zone-detect');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ROOMS_DIR = path.join(REPO_ROOT, 'templates', 'rooms');
const TEMPLATES_PATH = path.join(REPO_ROOT, 'templates', 'templates.json');

async function main() {
  const args = process.argv.slice(2);

  // Single image detection
  if (args.includes('--image')) {
    const imgIdx = args.indexOf('--image') + 1;
    const imgPath = args[imgIdx];
    if (!imgPath) {
      console.error('Usage: --image <path-to-room-image>');
      process.exit(1);
    }

    const fullPath = path.isAbsolute(imgPath) ? imgPath : path.resolve(imgPath);
    console.log(`\nDetecting zone in: ${fullPath}\n`);

    const result = await detectZone(fullPath);
    console.log('Detection result:');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Full directory detection
  const rebuild = args.includes('--rebuild');

  console.log('=== Archive-35 Room Zone Auto-Detection ===\n');
  console.log(`Rooms directory: ${ROOMS_DIR}`);
  console.log(`Mode: ${rebuild ? 'REBUILD (replacing all auto-detected)' : 'MERGE (keeping existing)'}\n`);

  // Check rooms directory exists
  try {
    await fs.access(ROOMS_DIR);
  } catch {
    console.error(`ERROR: Rooms directory not found: ${ROOMS_DIR}`);
    console.error('Please download room images first (see Mockup_Room_Download_Guide.docx)');
    process.exit(1);
  }

  // Auto-detect all rooms
  const detected = await autoDetectTemplates(ROOMS_DIR);

  if (detected.length === 0) {
    console.log('\nNo new room images found to detect.');
    console.log('Add room images (jpg/png) to templates/rooms/ and run again.');
    return;
  }

  // Merge or rebuild
  let finalTemplates;

  if (rebuild) {
    // Keep only the original test template, replace everything else
    let existing = [];
    try {
      const raw = await fs.readFile(TEMPLATES_PATH, 'utf8');
      existing = JSON.parse(raw);
    } catch {}

    const manual = existing.filter(t => !t._detection);
    finalTemplates = [...manual, ...detected];
    console.log(`\nRebuilt: ${manual.length} manual + ${detected.length} auto-detected = ${finalTemplates.length} total`);
  } else {
    // Merge: keep existing, add new
    let existing = [];
    try {
      const raw = await fs.readFile(TEMPLATES_PATH, 'utf8');
      existing = JSON.parse(raw);
    } catch {}

    const existingIds = new Set(existing.map(t => t.id));
    const newTemplates = detected.filter(t => !existingIds.has(t.id));

    finalTemplates = [...existing, ...newTemplates];
    console.log(`\nMerged: ${existing.length} existing + ${newTemplates.length} new = ${finalTemplates.length} total`);

    if (newTemplates.length === 0) {
      console.log('(All detected rooms already in templates.json)');
    }
  }

  // Write templates.json
  await fs.writeFile(TEMPLATES_PATH, JSON.stringify(finalTemplates, null, 2));
  console.log(`\nWritten to: ${TEMPLATES_PATH}`);

  // Summary table
  console.log('\n--- Detection Summary ---\n');
  console.log('ID'.padEnd(25) + 'Category'.padEnd(15) + 'Method'.padEnd(20) + 'Confidence'.padEnd(12) + 'Zone Size');
  console.log('-'.repeat(85));

  for (const t of detected) {
    const d = t._detection;
    const zone = t.placementZones[0];
    console.log(
      t.id.padEnd(25) +
      t.category.padEnd(15) +
      d.method.padEnd(20) +
      `${(d.confidence * 100).toFixed(0)}%`.padEnd(12) +
      `${zone.maxDimensions.width}x${zone.maxDimensions.height}`
    );
  }

  console.log('\nDone! Templates are ready for compositing.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
