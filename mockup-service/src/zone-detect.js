/**
 * zone-detect.js — Auto-detect wall placement zones in room photos.
 *
 * Analyzes room template images to find:
 *   1. Empty picture frames (rectangular borders with uniform interior)
 *   2. Green-screen zones (#00FF00 chroma key rectangles)
 *   3. Blank wall areas (largest uniform-color region suitable for art)
 *
 * Returns placement zone corner coordinates compatible with templates.json.
 *
 * Uses Sharp for pixel access — no OpenCV dependency needed.
 */

'use strict';

const sharp = require('sharp');
const path = require('path');

/**
 * Detect the best placement zone in a room image.
 *
 * @param {string} imagePath - Path to the room template image
 * @param {object} [options]
 * @param {number} [options.minAreaPercent=3] - Min zone area as % of image
 * @param {number} [options.maxAreaPercent=60] - Max zone area as % of image
 * @param {string} [options.method='auto'] - 'auto' | 'green' | 'frame' | 'blank'
 * @returns {Promise<object>} Detection result with corners and metadata
 */
async function detectZone(imagePath, options = {}) {
  const {
    minAreaPercent = 3,
    maxAreaPercent = 60,
    method = 'auto'
  } = options;

  // Load image as raw pixels (downscaled for speed)
  const ANALYSIS_WIDTH = 800;
  const meta = await sharp(imagePath).metadata();
  const scale = ANALYSIS_WIDTH / meta.width;
  const analysisHeight = Math.round(meta.height * scale);

  const { data, info } = await sharp(imagePath)
    .resize(ANALYSIS_WIDTH, analysisHeight)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const totalPixels = w * h;
  const minArea = totalPixels * (minAreaPercent / 100);
  const maxArea = totalPixels * (maxAreaPercent / 100);

  let result = null;

  // Try detection methods in priority order
  if (method === 'auto' || method === 'green') {
    result = detectGreenZone(data, w, h, minArea, maxArea);
    if (result) result.method = 'green-screen';
  }

  if (!result && (method === 'auto' || method === 'frame')) {
    result = detectFrameZone(data, w, h, minArea, maxArea);
    if (result) result.method = 'frame-detection';
  }

  if (!result && (method === 'auto' || method === 'blank')) {
    result = detectBlankWall(data, w, h, minArea, maxArea);
    if (result) result.method = 'blank-wall';
  }

  if (!result) {
    // Fallback: center region at 30% of image
    const margin = 0.35;
    result = {
      corners: {
        topLeft: [Math.round(w * margin), Math.round(h * 0.2)],
        topRight: [Math.round(w * (1 - margin)), Math.round(h * 0.2)],
        bottomRight: [Math.round(w * (1 - margin)), Math.round(h * 0.65)],
        bottomLeft: [Math.round(w * margin), Math.round(h * 0.65)]
      },
      confidence: 0.2,
      method: 'fallback-center'
    };
  }

  // Scale corners back to original image dimensions
  const scaleBack = meta.width / ANALYSIS_WIDTH;
  const corners = {
    topLeft: [Math.round(result.corners.topLeft[0] * scaleBack), Math.round(result.corners.topLeft[1] * scaleBack)],
    topRight: [Math.round(result.corners.topRight[0] * scaleBack), Math.round(result.corners.topRight[1] * scaleBack)],
    bottomRight: [Math.round(result.corners.bottomRight[0] * scaleBack), Math.round(result.corners.bottomRight[1] * scaleBack)],
    bottomLeft: [Math.round(result.corners.bottomLeft[0] * scaleBack), Math.round(result.corners.bottomLeft[1] * scaleBack)]
  };

  return {
    corners,
    method: result.method,
    confidence: result.confidence,
    imageWidth: meta.width,
    imageHeight: meta.height,
    zoneWidth: Math.round(Math.hypot(
      corners.topRight[0] - corners.topLeft[0],
      corners.topRight[1] - corners.topLeft[1]
    )),
    zoneHeight: Math.round(Math.hypot(
      corners.bottomLeft[0] - corners.topLeft[0],
      corners.bottomLeft[1] - corners.topLeft[1]
    ))
  };
}

/**
 * Detect a chroma green (#00FF00) zone.
 * Looks for a rectangular region of bright green pixels.
 */
function detectGreenZone(data, w, h, minArea, maxArea) {
  // Build a binary mask of green pixels
  const mask = new Uint8Array(w * h);
  let greenCount = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 3;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];

      // Green channel dominant, others low
      if (g > 150 && r < 100 && b < 100 && (g - r) > 80 && (g - b) > 80) {
        mask[y * w + x] = 1;
        greenCount++;
      }
    }
  }

  if (greenCount < minArea * 0.5) return null;

  // Find bounding box of green region
  const bbox = findBoundingBox(mask, w, h);
  if (!bbox) return null;

  const area = (bbox.x2 - bbox.x1) * (bbox.y2 - bbox.y1);
  if (area < minArea || area > maxArea) return null;

  // Check density — should be mostly green inside the bbox
  let insideGreen = 0;
  for (let y = bbox.y1; y <= bbox.y2; y++) {
    for (let x = bbox.x1; x <= bbox.x2; x++) {
      if (mask[y * w + x]) insideGreen++;
    }
  }
  const density = insideGreen / area;
  if (density < 0.7) return null;

  return {
    corners: {
      topLeft: [bbox.x1, bbox.y1],
      topRight: [bbox.x2, bbox.y1],
      bottomRight: [bbox.x2, bbox.y2],
      bottomLeft: [bbox.x1, bbox.y2]
    },
    confidence: Math.min(0.95, density)
  };
}

/**
 * Detect an empty picture frame by looking for rectangular edges.
 *
 * Strategy: find a rectangular region where:
 *   - The border has a distinct color (dark frame edge)
 *   - The interior is relatively uniform (empty frame / white/gray fill)
 */
function detectFrameZone(data, w, h, minArea, maxArea) {
  // Convert to grayscale and compute edge magnitudes
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 3;
      gray[y * w + x] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
  }

  // Sobel edge detection
  const edges = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y - 1) * w + (x - 1)] + gray[(y - 1) * w + (x + 1)]
        - 2 * gray[y * w + (x - 1)] + 2 * gray[y * w + (x + 1)]
        - gray[(y + 1) * w + (x - 1)] + gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)]
        + gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];
      edges[y * w + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  // Threshold edges
  const edgeThreshold = 30;
  const edgeMask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    edgeMask[i] = edges[i] > edgeThreshold ? 1 : 0;
  }

  // Horizontal line scan: find strong horizontal edge segments
  const hLines = [];
  for (let y = Math.round(h * 0.05); y < Math.round(h * 0.95); y++) {
    let runStart = -1;
    let runLen = 0;
    for (let x = 0; x < w; x++) {
      if (edgeMask[y * w + x]) {
        if (runStart === -1) runStart = x;
        runLen++;
      } else {
        if (runLen > w * 0.08) {
          hLines.push({ y, x1: runStart, x2: runStart + runLen - 1, len: runLen });
        }
        runStart = -1;
        runLen = 0;
      }
    }
    if (runLen > w * 0.08) {
      hLines.push({ y, x1: runStart, x2: runStart + runLen - 1, len: runLen });
    }
  }

  // Vertical line scan: find strong vertical edge segments
  const vLines = [];
  for (let x = Math.round(w * 0.05); x < Math.round(w * 0.95); x++) {
    let runStart = -1;
    let runLen = 0;
    for (let y = 0; y < h; y++) {
      if (edgeMask[y * w + x]) {
        if (runStart === -1) runStart = y;
        runLen++;
      } else {
        if (runLen > h * 0.08) {
          vLines.push({ x, y1: runStart, y2: runStart + runLen - 1, len: runLen });
        }
        runStart = -1;
        runLen = 0;
      }
    }
    if (runLen > h * 0.08) {
      vLines.push({ x, y1: runStart, y2: runStart + runLen - 1, len: runLen });
    }
  }

  if (hLines.length < 2 || vLines.length < 2) return null;

  // Try to form rectangles from line pairs
  let bestRect = null;
  let bestScore = 0;

  // Sort horizontal lines by y
  hLines.sort((a, b) => a.y - b.y);
  vLines.sort((a, b) => a.x - b.x);

  // Try pairs of horizontal lines (top + bottom edge)
  for (let i = 0; i < Math.min(hLines.length, 20); i++) {
    for (let j = i + 1; j < Math.min(hLines.length, 20); j++) {
      const top = hLines[i];
      const bot = hLines[j];

      const heightGap = bot.y - top.y;
      if (heightGap < h * 0.08 || heightGap > h * 0.8) continue;

      // Check overlap in x
      const overlapX1 = Math.max(top.x1, bot.x1);
      const overlapX2 = Math.min(top.x2, bot.x2);
      if (overlapX2 - overlapX1 < w * 0.08) continue;

      // Look for matching vertical lines on left and right
      let bestLeft = null, bestRight = null;
      for (const vl of vLines) {
        if (vl.y1 <= top.y + 5 && vl.y2 >= bot.y - 5) {
          if (Math.abs(vl.x - overlapX1) < w * 0.05) {
            if (!bestLeft || Math.abs(vl.x - overlapX1) < Math.abs(bestLeft.x - overlapX1)) {
              bestLeft = vl;
            }
          }
          if (Math.abs(vl.x - overlapX2) < w * 0.05) {
            if (!bestRight || Math.abs(vl.x - overlapX2) < Math.abs(bestRight.x - overlapX2)) {
              bestRight = vl;
            }
          }
        }
      }

      if (!bestLeft || !bestRight) continue;

      const rectW = bestRight.x - bestLeft.x;
      const rectH = bot.y - top.y;
      const area = rectW * rectH;

      if (area < minArea || area > maxArea) continue;

      // Score: prefer larger rectangles, centered vertically, with good aspect ratio
      const aspectRatio = rectW / rectH;
      const aspectScore = (aspectRatio >= 0.5 && aspectRatio <= 2.5) ? 1 : 0.5;
      const centerY = (top.y + bot.y) / 2;
      const verticalScore = 1 - Math.abs(centerY / h - 0.4); // Prefer upper-center
      const sizeScore = area / (w * h);

      // Check interior uniformity
      const uniformity = checkUniformity(data, w, bestLeft.x + 5, top.y + 5, bestRight.x - 5, bot.y - 5);

      const score = sizeScore * aspectScore * verticalScore * uniformity;

      if (score > bestScore) {
        bestScore = score;
        bestRect = {
          x1: bestLeft.x,
          y1: top.y,
          x2: bestRight.x,
          y2: bot.y
        };
      }
    }
  }

  if (!bestRect) return null;

  // Inset slightly to get inside the frame
  const inset = 3;
  return {
    corners: {
      topLeft: [bestRect.x1 + inset, bestRect.y1 + inset],
      topRight: [bestRect.x2 - inset, bestRect.y1 + inset],
      bottomRight: [bestRect.x2 - inset, bestRect.y2 - inset],
      bottomLeft: [bestRect.x1 + inset, bestRect.y2 - inset]
    },
    confidence: Math.min(0.85, bestScore * 10 + 0.3)
  };
}

/**
 * Detect the largest blank/uniform wall area.
 *
 * Strategy: Find the largest rectangular region with low color variance.
 * Uses a sliding window approach with variance thresholding.
 */
function detectBlankWall(data, w, h, minArea, maxArea) {
  // Compute local variance in a grid of blocks
  const blockSize = 16;
  const gridW = Math.floor(w / blockSize);
  const gridH = Math.floor(h / blockSize);

  // For each block, compute color variance
  const variance = new Float32Array(gridW * gridH);
  const meanR = new Float32Array(gridW * gridH);
  const meanG = new Float32Array(gridW * gridH);
  const meanB = new Float32Array(gridW * gridH);

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      let sumR = 0, sumG = 0, sumB = 0;
      let sumR2 = 0, sumG2 = 0, sumB2 = 0;
      let count = 0;

      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const px = gx * blockSize + dx;
          const py = gy * blockSize + dy;
          if (px >= w || py >= h) continue;
          const idx = (py * w + px) * 3;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];
          sumR += r; sumG += g; sumB += b;
          sumR2 += r * r; sumG2 += g * g; sumB2 += b * b;
          count++;
        }
      }

      const mR = sumR / count, mG = sumG / count, mB = sumB / count;
      meanR[gy * gridW + gx] = mR;
      meanG[gy * gridW + gx] = mG;
      meanB[gy * gridW + gx] = mB;

      const vR = sumR2 / count - mR * mR;
      const vG = sumG2 / count - mG * mG;
      const vB = sumB2 / count - mB * mB;
      variance[gy * gridW + gx] = (vR + vG + vB) / 3;
    }
  }

  // Low-variance blocks = uniform wall
  const varianceThreshold = 200; // Tune: lower = stricter
  const uniformMask = new Uint8Array(gridW * gridH);
  for (let i = 0; i < gridW * gridH; i++) {
    uniformMask[i] = variance[i] < varianceThreshold ? 1 : 0;
  }

  // Find largest rectangular region of uniform blocks (max rectangle in histogram)
  let bestArea = 0;
  let bestRect = null;

  // Compute height histogram for each column
  const heights = new Uint16Array(gridW);

  for (let gy = 0; gy < gridH; gy++) {
    // Update heights
    for (let gx = 0; gx < gridW; gx++) {
      if (uniformMask[gy * gridW + gx]) {
        heights[gx]++;
      } else {
        heights[gx] = 0;
      }
    }

    // Max rectangle in histogram using stack
    const stack = [];
    for (let gx = 0; gx <= gridW; gx++) {
      const curH = gx < gridW ? heights[gx] : 0;
      while (stack.length > 0 && curH < heights[stack[stack.length - 1]]) {
        const hIdx = stack.pop();
        const height = heights[hIdx];
        const width = stack.length > 0 ? gx - stack[stack.length - 1] - 1 : gx;
        const area = height * width;

        if (area > bestArea) {
          const pixelArea = area * blockSize * blockSize;
          if (pixelArea >= minArea && pixelArea <= maxArea) {
            bestArea = area;
            const left = stack.length > 0 ? stack[stack.length - 1] + 1 : 0;
            bestRect = {
              x1: left * blockSize,
              y1: (gy - height + 1) * blockSize,
              x2: (left + width) * blockSize,
              y2: (gy + 1) * blockSize
            };
          }
        }
      }
      stack.push(gx);
    }
  }

  if (!bestRect) return null;

  // Check that the region is actually wall-like (not too dark, not floor/ceiling)
  const avgBrightness = computeAvgBrightness(data, w, bestRect.x1, bestRect.y1, bestRect.x2, bestRect.y2);
  if (avgBrightness < 80) return null; // Too dark, probably not a wall

  // Score based on size, position, and brightness
  const areaRatio = (bestRect.x2 - bestRect.x1) * (bestRect.y2 - bestRect.y1) / (w * h);
  const centerY = (bestRect.y1 + bestRect.y2) / 2 / h;
  const positionScore = 1 - Math.abs(centerY - 0.4) * 2; // Prefer upper-center

  return {
    corners: {
      topLeft: [bestRect.x1, bestRect.y1],
      topRight: [bestRect.x2, bestRect.y1],
      bottomRight: [bestRect.x2, bestRect.y2],
      bottomLeft: [bestRect.x1, bestRect.y2]
    },
    confidence: Math.min(0.7, areaRatio * 2 + positionScore * 0.2)
  };
}

// --- Utility functions ---

function findBoundingBox(mask, w, h) {
  let minX = w, maxX = 0, minY = h, maxY = 0;
  let found = false;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }

  if (!found) return null;
  return { x1: minX, y1: minY, x2: maxX, y2: maxY };
}

function checkUniformity(data, w, x1, y1, x2, y2) {
  if (x2 <= x1 || y2 <= y1) return 0;

  let sumR = 0, sumG = 0, sumB = 0;
  let sumR2 = 0, sumG2 = 0, sumB2 = 0;
  let count = 0;

  // Sample every 3rd pixel for speed
  for (let y = y1; y < y2; y += 3) {
    for (let x = x1; x < x2; x += 3) {
      const idx = (y * w + x) * 3;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      sumR += r; sumG += g; sumB += b;
      sumR2 += r * r; sumG2 += g * g; sumB2 += b * b;
      count++;
    }
  }

  if (count === 0) return 0;

  const vR = sumR2 / count - (sumR / count) ** 2;
  const vG = sumG2 / count - (sumG / count) ** 2;
  const vB = sumB2 / count - (sumB / count) ** 2;
  const avgVariance = (vR + vG + vB) / 3;

  // Low variance = uniform (good frame interior)
  // Map variance 0-1000 to score 1.0-0.0
  return Math.max(0, Math.min(1, 1 - avgVariance / 1000));
}

function computeAvgBrightness(data, w, x1, y1, x2, y2) {
  let sum = 0;
  let count = 0;

  for (let y = y1; y < y2; y += 4) {
    for (let x = x1; x < x2; x += 4) {
      const idx = (y * w + x) * 3;
      sum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      count++;
    }
  }

  return count > 0 ? sum / count : 0;
}

/**
 * Auto-scan a directory of room images and generate templates.json entries.
 *
 * @param {string} roomsDir - Directory containing room images
 * @param {object} [options]
 * @param {string[]} [options.defaultPrintSizes] - Default print sizes
 * @returns {Promise<object[]>} Array of template objects for templates.json
 */
async function autoDetectTemplates(roomsDir, options = {}) {
  const fs = require('fs').promises;
  const {
    defaultPrintSizes = ['16x24', '20x30', '24x36']
  } = options;

  const files = await fs.readdir(roomsDir);
  const imageFiles = files.filter(f =>
    /\.(jpg|jpeg|png|webp)$/i.test(f) && f !== 'test-living-room-01.jpg'
  );

  const templates = [];

  for (const file of imageFiles) {
    const imagePath = path.join(roomsDir, file);
    const id = path.basename(file, path.extname(file));

    // Derive category from filename
    const category = id.replace(/-\d+$/, '').replace(/-/g, ' ');

    try {
      console.log(`Detecting zone in: ${file}...`);
      const detection = await detectZone(imagePath);

      console.log(`  Method: ${detection.method}, Confidence: ${(detection.confidence * 100).toFixed(0)}%`);
      console.log(`  Zone: ${detection.zoneWidth}x${detection.zoneHeight}px`);

      templates.push({
        id: id,
        name: category.charAt(0).toUpperCase() + category.slice(1),
        category: getCategoryFromFilename(id),
        imagePath: `templates/rooms/${file}`,
        dimensions: {
          width: detection.imageWidth,
          height: detection.imageHeight
        },
        placementZones: [{
          corners: detection.corners,
          maxDimensions: {
            width: detection.zoneWidth,
            height: detection.zoneHeight
          }
        }],
        printSizes: defaultPrintSizes,
        wallColor: '#FFFFFF',
        lightAngle: 45,
        lightIntensity: 0.7,
        _detection: {
          method: detection.method,
          confidence: detection.confidence
        }
      });
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }
  }

  return templates;
}

function getCategoryFromFilename(id) {
  if (id.includes('living')) return 'living-room';
  if (id.includes('bedroom')) return 'bedroom';
  if (id.includes('office') || id.includes('workspace')) return 'office';
  if (id.includes('entry') || id.includes('hallway') || id.includes('foyer')) return 'entry';
  if (id.includes('lobby') || id.includes('hotel')) return 'lobby';
  if (id.includes('dining')) return 'dining-room';
  if (id.includes('gallery')) return 'gallery';
  if (id.includes('restaurant')) return 'restaurant';
  return 'other';
}

module.exports = {
  detectZone,
  detectGreenZone,
  detectFrameZone,
  detectBlankWall,
  autoDetectTemplates
};
