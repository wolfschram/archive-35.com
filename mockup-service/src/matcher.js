/**
 * matcher.js — Aspect Ratio Compatibility Engine (v2 — Safe Zone Support)
 *
 * ⚠️ PROTECTED FILE — Risk: HIGH
 * Dependencies: data/photos.json, templates/templates.json
 * Side effects: Compatibility matrix determines which mockups can be generated
 * Read first: CONSTRAINTS.md (data/photos.json, templates.json), LESSONS_LEARNED.md #033
 * Consumers: Mockup Service (server.js), compositor.js, prompt-generator.js
 *
 * Maps photos ↔ room templates based on aspect ratio.
 * Prevents impossible combinations (ultra-wide pano in portrait zone).
 * Identifies gaps where new ChatGPT room templates are needed.
 *
 * v2 changes (2026-02-23):
 *   - Safe zone support: when template has safeZone, uses expanded area for tolerance
 *   - analyzeTemplate() now returns both greenZone and safeZone aspect ratios
 *   - isCompatible() accepts optional safeZoneAspect for extended matching
 *
 * Data sources:
 *   - data/photos.json (photos with dimensions.aspectRatio)
 *   - templates/templates.json (templates with zone corners + optional safeZone)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Default tolerance: 15% aspect ratio mismatch before art looks stretched
const DEFAULT_TOLERANCE = 0.15;

// Aspect ratio categories (matches js/product-selector.js)
const ASPECT_CATEGORIES = [
  { name: 'square',          min: 0.95, max: 1.05 },
  { name: '4:3',             min: 1.05, max: 1.40 },
  { name: 'standard-3:2',    min: 1.40, max: 1.60 },
  { name: 'wide-16:9',       min: 1.60, max: 1.90 },
  { name: 'panorama-2:1',    min: 1.90, max: 2.20 },
  { name: 'wide-panorama',   min: 2.20, max: 2.70 },
  { name: 'panorama-3:1',    min: 2.70, max: 3.30 },
  { name: 'ultra-wide-4:1',  min: 3.30, max: 10.0 },
  { name: 'portrait',        min: 0.30, max: 0.95 },
];

/**
 * Classify an aspect ratio into a named category.
 */
function classifyAspect(ratio) {
  for (const cat of ASPECT_CATEGORIES) {
    if (ratio >= cat.min && ratio < cat.max) return cat.name;
  }
  return ratio < 1 ? 'portrait' : 'ultra-wide-4:1';
}

/**
 * Compute zone aspect ratio from a template's placement zone corners.
 *
 * @param {object} template - Template object from templates.json
 * @param {number} [zoneIndex=0]
 * @returns {number} Aspect ratio (width / height)
 */
function analyzeTemplate(template, zoneIndex = 0) {
  const zone = template.placementZones[zoneIndex];
  if (!zone) return null;

  const c = zone.corners;

  // If maxDimensions are available (from auto-detection), use those
  if (zone.maxDimensions) {
    return zone.maxDimensions.width / zone.maxDimensions.height;
  }

  // Otherwise compute from corners
  const zoneW = Math.hypot(
    c.topRight[0] - c.topLeft[0],
    c.topRight[1] - c.topLeft[1]
  );
  const zoneH = Math.hypot(
    c.bottomLeft[0] - c.topLeft[0],
    c.bottomLeft[1] - c.topLeft[1]
  );

  return zoneW / zoneH;
}

/**
 * Compute safe zone aspect ratio from a template's safeZone field.
 * Returns null if no safeZone defined — caller should fall back to green zone.
 *
 * @param {object} template - Template object from templates.json
 * @returns {{ aspect: number, width: number, height: number } | null}
 */
function analyzeSafeZone(template) {
  const sz = template.safeZone;
  if (!sz || !sz.w || !sz.h) {
    // No explicit safe zone — estimate as 15% larger than green zone
    const greenAspect = analyzeTemplate(template);
    if (!greenAspect) return null;

    const zone = template.placementZones?.[0];
    if (!zone) return null;

    const c = zone.corners;
    const greenW = zone.maxDimensions?.width || Math.hypot(c.topRight[0] - c.topLeft[0], c.topRight[1] - c.topLeft[1]);
    const greenH = zone.maxDimensions?.height || Math.hypot(c.bottomLeft[0] - c.topLeft[0], c.bottomLeft[1] - c.topLeft[1]);

    // Default safe zone: 15% larger in each direction (30% total expansion)
    const safeW = Math.round(greenW * 1.30);
    const safeH = Math.round(greenH * 1.30);

    return { aspect: safeW / safeH, width: safeW, height: safeH };
  }

  return { aspect: sz.w / sz.h, width: sz.w, height: sz.h };
}

/**
 * Check if a photo aspect ratio is compatible with a zone aspect ratio.
 *
 * @param {number} photoAspect - Photo width/height ratio
 * @param {number} zoneAspect - Zone width/height ratio
 * @param {number} [tolerance=0.15] - Max relative difference (0.15 = 15%)
 * @returns {{ compatible: boolean, score: number, fitType: string }}
 */
function isCompatible(photoAspect, zoneAspect, tolerance = DEFAULT_TOLERANCE) {
  const diff = Math.abs(photoAspect - zoneAspect) / Math.max(photoAspect, zoneAspect);
  const score = Math.max(0, 1 - diff);

  let fitType;
  if (diff <= 0.05) {
    fitType = 'exact';       // <5% — perfect fit
  } else if (diff <= tolerance) {
    fitType = 'good';        // 5-15% — slight stretch, acceptable
  } else if (diff <= tolerance * 1.5) {
    fitType = 'stretched';   // 15-22% — noticeable stretch, warn user
  } else {
    fitType = 'incompatible';
  }

  return {
    compatible: diff <= tolerance,
    score,
    fitType,
    percentDiff: Math.round(diff * 100)
  };
}

/**
 * Build a full compatibility matrix: photos ↔ templates.
 *
 * @param {object[]} photos - Array from photos.json
 * @param {object[]} templates - Array from templates.json
 * @param {number} [tolerance=0.15]
 * @returns {object} Matrix with per-photo and per-template lookups
 */
function buildCompatibilityMatrix(photos, templates, tolerance = DEFAULT_TOLERANCE) {
  // Pre-compute template zone aspect ratios (green zone + safe zone)
  const templateAspects = templates.map(t => {
    const greenAspect = analyzeTemplate(t);
    const safeInfo = analyzeSafeZone(t);
    return {
      id: t.id,
      name: t.name || t.id,
      category: t.category || 'other',
      imagePath: t.imagePath || t.image,
      zoneAspect: greenAspect,
      safeZoneAspect: safeInfo?.aspect || null,
      safeZoneDimensions: safeInfo ? { width: safeInfo.width, height: safeInfo.height } : null,
      zoneCategory: classifyAspect(greenAspect || 0),
      zoneDimensions: t.placementZones[0]?.maxDimensions || null,
      hasSafeZone: !!t.safeZone || true  // true = at least default 15% expansion
    };
  }).filter(t => t.zoneAspect != null);

  // Build per-photo compatibility
  const byPhoto = {};
  const byTemplate = {};
  const unmatched = [];

  // Init template lookup
  for (const t of templateAspects) {
    byTemplate[t.id] = { template: t, compatiblePhotos: [] };
  }

  for (const photo of photos) {
    const ar = photo.dimensions?.aspectRatio;
    if (!ar) continue;

    const matches = [];

    for (const tmpl of templateAspects) {
      // First check green zone compatibility (tight fit)
      const greenResult = isCompatible(ar, tmpl.zoneAspect, tolerance);

      // If not compatible with green zone, check safe zone (expanded area)
      let result = greenResult;
      let usingSafeZone = false;
      if (!greenResult.compatible && tmpl.safeZoneAspect) {
        const safeResult = isCompatible(ar, tmpl.safeZoneAspect, tolerance);
        if (safeResult.compatible) {
          result = safeResult;
          usingSafeZone = true;
        }
      }

      if (result.compatible) {
        const match = {
          templateId: tmpl.id,
          templateName: tmpl.name,
          templateCategory: tmpl.category,
          zoneAspect: tmpl.zoneAspect,
          safeZoneAspect: tmpl.safeZoneAspect,
          usingSafeZone,
          ...result
        };
        matches.push(match);

        // Add to template reverse lookup
        byTemplate[tmpl.id].compatiblePhotos.push({
          photoId: photo.id,
          collection: photo.collection,
          title: photo.title,
          aspectRatio: ar,
          usingSafeZone,
          ...result
        });
      }
    }

    // Sort matches by score (best first)
    matches.sort((a, b) => b.score - a.score);

    byPhoto[photo.id] = {
      photo: {
        id: photo.id,
        collection: photo.collection,
        title: photo.title,
        aspectRatio: ar,
        orientation: photo.dimensions?.orientation,
        category: classifyAspect(ar),
        thumbnail: photo.thumbnail
      },
      matchCount: matches.length,
      matches
    };

    if (matches.length === 0) {
      unmatched.push({
        id: photo.id,
        collection: photo.collection,
        title: photo.title,
        aspectRatio: ar,
        category: classifyAspect(ar),
        recommendation: getTemplateRecommendation(ar, templateAspects)
      });
    }
  }

  return { byPhoto, byTemplate, unmatched, templateAspects };
}

/**
 * Generate a recommendation for unmatched photos.
 */
function getTemplateRecommendation(photoAspect, existingTemplates) {
  const category = classifyAspect(photoAspect);
  const existingInCategory = existingTemplates.filter(t => t.zoneCategory === category);

  if (existingInCategory.length === 0) {
    return `Need a ${category} room template (aspect ratio ~${photoAspect.toFixed(2)}:1)`;
  }

  // Find closest template
  let closest = existingTemplates[0];
  let closestDiff = Infinity;
  for (const t of existingTemplates) {
    const diff = Math.abs(photoAspect - t.zoneAspect);
    if (diff < closestDiff) { closestDiff = diff; closest = t; }
  }

  const diff = Math.round(((photoAspect - closest.zoneAspect) / closest.zoneAspect) * 100);
  return `Closest template "${closest.name}" is ${Math.abs(diff)}% ${diff > 0 ? 'narrower' : 'wider'} than needed. Generate a ${category} room with ~${photoAspect.toFixed(1)}:1 zone.`;
}

/**
 * Get compatibility statistics summary.
 */
function getCompatibilityStats(matrix) {
  const photoIds = Object.keys(matrix.byPhoto);
  const total = photoIds.length;

  let with0 = 0, with1 = 0, with2to5 = 0, with6plus = 0;
  const collectionCoverage = {};

  for (const pid of photoIds) {
    const entry = matrix.byPhoto[pid];
    const count = entry.matchCount;

    if (count === 0) with0++;
    else if (count === 1) with1++;
    else if (count <= 5) with2to5++;
    else with6plus++;

    // Track per-collection coverage
    const collection = entry.photo.collection;
    if (!collectionCoverage[collection]) {
      collectionCoverage[collection] = { total: 0, matched: 0, unmatched: 0 };
    }
    collectionCoverage[collection].total++;
    if (count > 0) collectionCoverage[collection].matched++;
    else collectionCoverage[collection].unmatched++;
  }

  // Template utilization
  const templateStats = matrix.templateAspects.map(t => ({
    id: t.id,
    name: t.name,
    category: t.category,
    zoneAspect: Math.round(t.zoneAspect * 100) / 100,
    zoneCategory: t.zoneCategory,
    compatiblePhotoCount: matrix.byTemplate[t.id]?.compatiblePhotos.length || 0
  })).sort((a, b) => b.compatiblePhotoCount - a.compatiblePhotoCount);

  // Identify aspect ratio gaps
  const unmatchedCategories = {};
  for (const u of matrix.unmatched) {
    if (!unmatchedCategories[u.category]) unmatchedCategories[u.category] = 0;
    unmatchedCategories[u.category]++;
  }

  return {
    totalPhotos: total,
    coverage: {
      matched: total - with0,
      unmatched: with0,
      percentCovered: Math.round(((total - with0) / total) * 100)
    },
    distribution: {
      with0matches: with0,
      with1match: with1,
      with2to5matches: with2to5,
      with6plusMatches: with6plus
    },
    collectionCoverage,
    templateUtilization: templateStats,
    aspectRatioGaps: unmatchedCategories,
    unmatchedPhotos: matrix.unmatched
  };
}

/**
 * Get smart-match pairs for batch generation.
 * Returns array of { photoPath, templateId, printSize } ready for compositor.
 *
 * @param {object} matrix - Compatibility matrix
 * @param {object[]} photos - Full photos array
 * @param {object} options
 * @param {number} [options.maxPerPhoto=3] - Max templates per photo
 * @param {string} [options.fitType='good'] - Minimum fit: 'exact', 'good', 'stretched'
 * @returns {object[]} Pairs for batch processing
 */
function getSmartMatchPairs(matrix, photos, options = {}) {
  const { maxPerPhoto = 3, fitType = 'good' } = options;
  const minScore = fitType === 'exact' ? 0.95 : fitType === 'good' ? 0.85 : 0.78;

  const pairs = [];
  const photoLookup = {};
  for (const p of photos) { photoLookup[p.id] = p; }

  for (const [photoId, entry] of Object.entries(matrix.byPhoto)) {
    const photo = photoLookup[photoId];
    if (!photo) continue;

    // Get best matches up to maxPerPhoto
    const bestMatches = entry.matches
      .filter(m => m.score >= minScore)
      .slice(0, maxPerPhoto);

    for (const match of bestMatches) {
      // Find the template to get zone dimensions for print size
      const tmpl = matrix.templateAspects.find(t => t.id === match.templateId);
      if (!tmpl || !tmpl.zoneDimensions) continue;

      const zw = tmpl.zoneDimensions.width;
      const zh = tmpl.zoneDimensions.height;
      const printSize = Math.round(zw / 10) + 'x' + Math.round(zh / 10);

      // Build photo path from collection and filename
      const photoPath = `photography/${photo.collectionTitle || photo.collection}/${photo.filename}.jpg`;

      pairs.push({
        photoId: photo.id,
        photoPath,
        photoTitle: photo.title,
        collection: photo.collection,
        templateId: match.templateId,
        templateName: match.templateName,
        printSize,
        score: match.score,
        fitType: match.fitType
      });
    }
  }

  return pairs.sort((a, b) => b.score - a.score);
}

/**
 * Load photos.json and templates.json and build the matrix.
 * Convenience function for one-shot analysis.
 */
function loadAndAnalyze(repoRoot, tolerance = DEFAULT_TOLERANCE) {
  const photosPath = path.join(repoRoot, 'data', 'photos.json');
  const templatesPath = path.join(repoRoot, 'templates', 'templates.json');

  const photosData = JSON.parse(fs.readFileSync(photosPath, 'utf-8'));
  const templates = JSON.parse(fs.readFileSync(templatesPath, 'utf-8'));

  const photos = photosData.photos || photosData;
  const matrix = buildCompatibilityMatrix(photos, templates, tolerance);
  const stats = getCompatibilityStats(matrix);

  return { photos, templates, matrix, stats };
}

module.exports = {
  classifyAspect,
  analyzeTemplate,
  analyzeSafeZone,
  isCompatible,
  buildCompatibilityMatrix,
  getCompatibilityStats,
  getSmartMatchPairs,
  getTemplateRecommendation,
  loadAndAnalyze,
  ASPECT_CATEGORIES,
  DEFAULT_TOLERANCE
};
