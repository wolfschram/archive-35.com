/**
 * compositor.js — Sharp-based Mockup Compositing Engine
 *
 * Takes an art photo and a room template, applies perspective transform,
 * and composites the art onto the room wall. Supports multiple output
 * formats for different platforms (Etsy, Pinterest, Website).
 *
 * Pipeline:
 *   1. Load room template image + art photo
 *   2. Compute print size → pixel dimensions for the placement zone
 *   3. Resize art to fit the placement zone (respecting aspect ratio)
 *   4. Compute homography from art rect → wall quad corners
 *   5. Warp art pixels using reverse-mapping
 *   6. Composite warped art onto room template
 *   7. Apply optional shadow/light overlay
 *   8. Output as JPEG at target dimensions
 */

'use strict';

const sharp = require('sharp');
const path = require('path');
const { computeHomography, warpImageBilinear, getTransformedBounds } = require('./homography');

/**
 * Generate a single mockup composite.
 *
 * @param {object} options
 * @param {string} options.photoPath - Absolute path to the art photo
 * @param {object} options.template - Template JSON object (from templates.json)
 * @param {string} options.printSize - Print size string e.g. "24x36"
 * @param {number} [options.zoneIndex=0] - Which placement zone to use
 * @param {string} [options.quality='high'] - 'high' (bilinear) or 'fast' (nearest)
 * @returns {Promise<Buffer>} JPEG buffer of the composited mockup
 */
async function generateMockup({ photoPath, template, printSize, zoneIndex = 0, quality = 'high', overshoot = 8 }) {
  // 1. Load room template
  const roomImage = sharp(template.imagePath);
  const roomMeta = await roomImage.metadata();
  const roomWidth = roomMeta.width;
  const roomHeight = roomMeta.height;

  // 2. Get placement zone
  const zone = template.placementZones[zoneIndex];
  if (!zone) {
    throw new Error(`Placement zone index ${zoneIndex} not found in template "${template.id}"`);
  }

  // 3. Parse print size and compute art dimensions within the zone
  const [printW, printH] = parsePrintSize(printSize);
  const artDimensions = computeArtDimensions(zone, printW, printH);

  // 4. Load and resize art photo to fit the computed dimensions
  const artResized = await sharp(photoPath)
    .resize(artDimensions.width, artDimensions.height, { fit: 'cover' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 5. Compute the destination quad (where art goes on the wall)
  //    Scale from zone's full area to match the print size proportions
  //    overshoot extends the art beyond the zone boundary to cover green edges
  const dstCorners = computeDestinationCorners(zone, artDimensions, printW, printH, overshoot);

  // 6. Compute homography: art rectangle → wall quadrilateral
  const srcCorners = [
    { x: 0, y: 0 },
    { x: artResized.info.width, y: 0 },
    { x: artResized.info.width, y: artResized.info.height },
    { x: 0, y: artResized.info.height }
  ];

  const H = computeHomography(srcCorners, dstCorners);

  // 7. Get bounding box of transformed region
  const bounds = getTransformedBounds(H, artResized.info.width, artResized.info.height);

  // Clamp bounds to room dimensions
  const clampedX = Math.max(0, bounds.x);
  const clampedY = Math.max(0, bounds.y);
  const clampedW = Math.min(bounds.width, roomWidth - clampedX);
  const clampedH = Math.min(bounds.height, roomHeight - clampedY);

  // 8. Warp art pixels
  const warpedPixels = warpImageBilinear(
    artResized.data,
    artResized.info.width,
    artResized.info.height,
    H,
    clampedW,
    clampedH,
    clampedX,
    clampedY
  );

  // 9. Create the warped art as a Sharp image for compositing
  const warpedImage = sharp(warpedPixels, {
    raw: {
      width: clampedW,
      height: clampedH,
      channels: 4
    }
  }).png(); // PNG to preserve alpha

  const warpedBuffer = await warpedImage.toBuffer();

  // 10. Composite warped art onto room template
  const composited = await sharp(template.imagePath)
    .composite([
      {
        input: warpedBuffer,
        left: clampedX,
        top: clampedY,
        blend: 'over'
      }
    ])
    .removeAlpha() // Force 3-channel RGB output
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 11. Remove green-screen spill (reflections on floors, walls, furniture)
  const ch = composited.info.channels;
  const cleaned = removeGreenSpill(composited.data, composited.info.width, composited.info.height, ch);

  // 12. Encode final JPEG
  const result = await sharp(cleaned, {
    raw: {
      width: composited.info.width,
      height: composited.info.height,
      channels: ch
    }
  }).jpeg({ quality: 90 }).toBuffer();

  return result;
}

/**
 * Generate mockup for a specific platform with correct dimensions.
 *
 * @param {object} options - Same as generateMockup plus:
 * @param {string} options.platform - 'etsy' | 'pinterest' | 'web-full' | 'web-thumb'
 * @param {string} [options.outputPath] - If set, writes to file instead of returning buffer
 * @returns {Promise<Buffer>} Platform-sized JPEG buffer
 */
async function generatePlatformMockup(options) {
  const mockup = await generateMockup(options);

  const platformSpecs = {
    'etsy': { width: 2000, height: 2000, fit: 'cover' },
    'pinterest': { width: 1000, height: 1500, fit: 'cover' },
    'web-full': { width: 2000, height: null, fit: 'inside' },
    'web-thumb': { width: 400, height: null, fit: 'inside' }
  };

  const spec = platformSpecs[options.platform];
  if (!spec) {
    throw new Error(`Unknown platform: ${options.platform}`);
  }

  let pipeline = sharp(mockup);

  if (spec.height) {
    // Fixed aspect ratio crop (Etsy 1:1, Pinterest 2:3)
    pipeline = pipeline.resize(spec.width, spec.height, {
      fit: 'cover',
      position: 'centre'
    });
  } else {
    // Responsive width (website)
    pipeline = pipeline.resize(spec.width, null, {
      fit: 'inside',
      withoutEnlargement: true
    });
  }

  const result = await pipeline.jpeg({ quality: 90 }).toBuffer();

  if (options.outputPath) {
    const fs = require('fs').promises;
    await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
    await fs.writeFile(options.outputPath, result);
  }

  return result;
}

/**
 * Add a subtle shadow/frame effect to make the art look mounted.
 * Applied as a thin dark border with slight drop shadow.
 *
 * @param {Buffer} compositeBuffer - The composited mockup JPEG
 * @param {object} zone - Placement zone from template
 * @param {Array<{x,y}>} artCorners - The 4 destination corners of the art
 * @returns {Promise<Buffer>} JPEG with shadow overlay
 */
async function addFrameShadow(compositeBuffer, zone, artCorners) {
  // For Phase 1, shadow is a simple darkened border effect
  // Full shadow overlay with light angle comes in Phase 4
  // For now, return as-is — the perspective warp already looks good
  return compositeBuffer;
}

// --- Helpers ---

/**
 * Parse print size string like "24x36" into [width, height] in inches.
 */
function parsePrintSize(sizeStr) {
  const parts = sizeStr.split('x').map(Number);
  if (parts.length !== 2 || parts.some(isNaN)) {
    throw new Error(`Invalid print size: "${sizeStr}". Expected format like "24x36"`);
  }
  return parts;
}

/**
 * Compute the pixel dimensions for the art within the placement zone,
 * respecting the print aspect ratio.
 *
 * The zone defines the maximum wall area. The art is scaled to fit
 * within that area while maintaining the print's aspect ratio.
 */
function computeArtDimensions(zone, printW, printH) {
  const corners = zone.corners;

  // Approximate zone dimensions from corners
  const zoneW = Math.hypot(
    corners.topRight[0] - corners.topLeft[0],
    corners.topRight[1] - corners.topLeft[1]
  );
  const zoneH = Math.hypot(
    corners.bottomLeft[0] - corners.topLeft[0],
    corners.bottomLeft[1] - corners.topLeft[1]
  );

  // Print aspect ratio
  const printAspect = printW / printH;
  const zoneAspect = zoneW / zoneH;

  let artW, artH;
  if (printAspect > zoneAspect) {
    // Art is wider than zone — fit to zone width
    artW = Math.round(zoneW);
    artH = Math.round(zoneW / printAspect);
  } else {
    // Art is taller than zone — fit to zone height
    artH = Math.round(zoneH);
    artW = Math.round(zoneH * printAspect);
  }

  // Cap at reasonable resolution for compositing (2x the zone for quality)
  const maxDim = 2000;
  if (artW > maxDim || artH > maxDim) {
    const scale = maxDim / Math.max(artW, artH);
    artW = Math.round(artW * scale);
    artH = Math.round(artH * scale);
  }

  return { width: artW, height: artH };
}

/**
 * Compute the 4 destination corners for the art on the wall.
 *
 * The placement zone corners define the MAXIMUM wall area.
 * The art may be smaller than the zone (if print size doesn't fill it),
 * so we center it within the zone and scale proportionally.
 *
 * @param {number} [overshootPx=0] - Pixels to extend art beyond zone boundary
 *   to cover green-screen edge bleed. Converted to normalized overshoot.
 */
function computeDestinationCorners(zone, artDimensions, printW, printH, overshootPx = 0) {
  const c = zone.corners;

  // Zone corner vectors
  const tl = { x: c.topLeft[0], y: c.topLeft[1] };
  const tr = { x: c.topRight[0], y: c.topRight[1] };
  const bl = { x: c.bottomLeft[0], y: c.bottomLeft[1] };
  const br = { x: c.bottomRight[0], y: c.bottomRight[1] };

  // Approximate zone dimensions
  const zoneW = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const zoneH = Math.hypot(bl.x - tl.x, bl.y - tl.y);

  // How much of the zone the art fills
  const printAspect = printW / printH;
  const zoneAspect = zoneW / zoneH;

  let scaleX, scaleY;
  if (printAspect > zoneAspect) {
    scaleX = 1.0;
    scaleY = (zoneW / printAspect) / zoneH;
  } else {
    scaleY = 1.0;
    scaleX = (zoneH * printAspect) / zoneW;
  }

  // Convert pixel overshoot to normalized zone fraction
  const ovX = overshootPx / zoneW;
  const ovY = overshootPx / zoneH;

  // Center the art within the zone, with overshoot expansion
  const offsetX = (1 - scaleX) / 2 - ovX;
  const offsetY = (1 - scaleY) / 2 - ovY;
  const fillX = scaleX + 2 * ovX;
  const fillY = scaleY + 2 * ovY;

  // Bilinear interpolation of zone corners to get art corners
  // P(u,v) = (1-u)(1-v)*TL + u*(1-v)*TR + (1-u)*v*BL + u*v*BR
  function lerp(u, v) {
    return {
      x: (1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + (1 - u) * v * bl.x + u * v * br.x,
      y: (1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + (1 - u) * v * bl.y + u * v * br.y
    };
  }

  return [
    lerp(offsetX, offsetY),                        // Top-left
    lerp(offsetX + fillX, offsetY),                // Top-right
    lerp(offsetX + fillX, offsetY + fillY),        // Bottom-right
    lerp(offsetX, offsetY + fillY)                  // Bottom-left
  ];
}

/**
 * Remove green-screen color spill from the composited image.
 *
 * AI-generated rooms with #00FF00 zones often have green reflections
 * on floors, furniture, and walls. This scans the pixel buffer and
 * neutralizes ONLY pixels with a strong green-screen signature.
 *
 * Tight detection thresholds to avoid false positives:
 *   - G > 150 (strong green channel)
 *   - G > R * 1.8 (green much stronger than red)
 *   - G > B * 1.8 (green much stronger than blue)
 *   - R < 120 AND B < 120 (red and blue channels are low)
 *
 * @param {Buffer} data - Raw pixel buffer
 * @param {number} width
 * @param {number} height
 * @param {number} [channels=3] - 3 for RGB, 4 for RGBA
 * @returns {Buffer} Cleaned pixel buffer
 */
function removeGreenSpill(data, width, height, channels = 3) {
  const out = Buffer.from(data); // Copy to avoid mutating original

  for (let i = 0; i < width * height; i++) {
    const idx = i * channels;
    const r = out[idx];
    const g = out[idx + 1];
    const b = out[idx + 2];

    // Tight detection: only catch actual green-screen pixels and their direct spill
    // Pure green screen: G=255, R≈0, B≈0
    // Green spill/reflection: G>150, R<120, B<120, G dominates by 1.8x
    if (g > 150 && r < 120 && b < 120 && g > r * 1.8 && g > b * 1.8) {
      // How "green-screeny" is this pixel? (0 = mild spill, 1 = pure #00FF00)
      const greenExcess = (g - Math.max(r, b)) / 255;
      const spillStrength = Math.min(1.0, greenExcess * 2.0);

      // Compute luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Blend toward warm neutral (natural floor/wall tone)
      const neutralR = Math.min(255, lum * 1.08);
      const neutralG = Math.min(255, lum * 0.92);
      const neutralB = Math.min(255, lum * 0.88);

      out[idx]     = Math.round(r + (neutralR - r) * spillStrength);
      out[idx + 1] = Math.round(g + (neutralG - g) * spillStrength);
      out[idx + 2] = Math.round(b + (neutralB - b) * spillStrength);

      // Clamp
      out[idx]     = Math.min(255, Math.max(0, out[idx]));
      out[idx + 1] = Math.min(255, Math.max(0, out[idx + 1]));
      out[idx + 2] = Math.min(255, Math.max(0, out[idx + 2]));
    }
  }

  return out;
}

module.exports = {
  generateMockup,
  generatePlatformMockup,
  addFrameShadow,
  removeGreenSpill,
  parsePrintSize,
  computeArtDimensions,
  computeDestinationCorners
};
