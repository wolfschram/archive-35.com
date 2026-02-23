/**
 * compositor.js — Sharp-based Mockup Compositing Engine (v2 — Branding Support)
 *
 * ⚠️ PROTECTED FILE — Risk: HIGH
 * Dependencies: homography.js, templates.json, sharp (npm)
 * Side effects: Generates customer-facing mockup images for social + web
 * Read first: CONSTRAINTS.md, LESSONS_LEARNED.md #033, ChatGPT_Room_Prompt_Strategy_v2.docx
 * Consumers: Mockup Service (server.js), batch.js, Agent social pipeline
 *
 * Takes an art photo and a room template, applies perspective transform,
 * and composites the art onto the room wall. Supports multiple output
 * formats for different platforms (Etsy, Pinterest, Website).
 *
 * v2 changes (2026-02-23):
 *   - Branding overlay: Archive-35.com logo on all platform outputs
 *   - generatePlatformMockup() now applies branding after crop
 *   - New addBrandingOverlay() function with per-platform positioning
 *
 * Pipeline:
 *   1. Load room template image + art photo
 *   2. Compute print size → pixel dimensions for the placement zone
 *   3. Resize art to fit the placement zone (respecting aspect ratio)
 *   4. Compute homography from art rect → wall quad corners
 *   5. Warp art pixels using reverse-mapping
 *   6. Composite warped art onto room template
 *   7. Remove green-screen spill
 *   8. Apply branding overlay (logo + URL)
 *   9. Output as JPEG at target dimensions
 */

'use strict';

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Branding assets — resolved from repo root /logos/
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BRANDING = {
  logo: path.join(REPO_ROOT, 'logos', 'archive35-wordmark-600.png'),
  icon: path.join(REPO_ROOT, 'logos', 'archive35-icon-200.png'),
  // Per-platform branding config
  platforms: {
    'etsy':      { position: 'bottom-right', opacity: 0.7, scale: 0.12, padding: 30 },
    'pinterest': { position: 'bottom-right', opacity: 0.7, scale: 0.15, padding: 24 },
    'instagram': { position: 'bottom-right', opacity: 0.65, scale: 0.14, padding: 20 },
    'web-full':  { position: 'bottom-right', opacity: 0.5, scale: 0.10, padding: 20 },
    'web-thumb': { position: 'bottom-right', opacity: 0.5, scale: 0.15, padding: 8 },
  }
};
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
    'etsy':      { width: 2000, height: 2000, fit: 'cover' },
    'pinterest': { width: 1000, height: 1500, fit: 'cover' },
    'instagram': { width: 1080, height: 1080, fit: 'cover' },
    'web-full':  { width: 2000, height: null,  fit: 'inside' },
    'web-thumb': { width: 400,  height: null,  fit: 'inside' }
  };

  const spec = platformSpecs[options.platform];
  if (!spec) {
    throw new Error(`Unknown platform: ${options.platform}. Valid: ${Object.keys(platformSpecs).join(', ')}`);
  }

  let pipeline = sharp(mockup);

  if (spec.height) {
    // Fixed aspect ratio crop (Etsy 1:1, Pinterest 2:3, Instagram 1:1)
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

  let result = await pipeline.jpeg({ quality: 90 }).toBuffer();

  // Apply branding overlay (Archive-35.com logo) unless explicitly skipped
  if (options.platform && !options.skipBranding) {
    result = await addBrandingOverlay(result, options.platform, options);
  }

  if (options.outputPath) {
    const fsPromises = require('fs').promises;
    await fsPromises.mkdir(path.dirname(options.outputPath), { recursive: true });
    await fsPromises.writeFile(options.outputPath, result);
  }

  return result;
}

/**
 * Add Archive-35.com branding overlay to a mockup image.
 * Applies a semi-transparent logo in the specified corner.
 *
 * @param {Buffer} imageBuffer - JPEG buffer of the mockup
 * @param {string} platform - Platform name (etsy, pinterest, instagram, web-full, web-thumb)
 * @param {object} [options] - Override defaults
 * @param {boolean} [options.skipBranding=false] - If true, return image unchanged
 * @returns {Promise<Buffer>} JPEG buffer with branding overlay
 */
async function addBrandingOverlay(imageBuffer, platform, options = {}) {
  if (options.skipBranding) return imageBuffer;

  const config = BRANDING.platforms[platform] || BRANDING.platforms['web-full'];
  const logoPath = BRANDING.logo;

  // Check if logo file exists
  if (!fs.existsSync(logoPath)) {
    console.warn(`Branding logo not found at ${logoPath}, skipping overlay`);
    return imageBuffer;
  }

  // Get image dimensions
  const imgMeta = await sharp(imageBuffer).metadata();
  const imgW = imgMeta.width;
  const imgH = imgMeta.height;

  // Scale logo relative to image width
  const logoTargetW = Math.round(imgW * config.scale);

  // Resize logo with transparency → raw pixels for opacity manipulation
  const logoResized = await sharp(logoPath)
    .resize(logoTargetW, null, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = logoResized;

  // Apply opacity by modifying alpha channel
  if (config.opacity < 1.0) {
    const pixels = Buffer.from(data);
    for (let i = 3; i < pixels.length; i += 4) {
      pixels[i] = Math.round(pixels[i] * config.opacity);
    }

    var logoBuffer = await sharp(pixels, {
      raw: { width: info.width, height: info.height, channels: 4 }
    }).png().toBuffer();
  } else {
    var logoBuffer = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 }
    }).png().toBuffer();
  }

  // Compute position
  const pad = config.padding;
  let left, top;
  switch (config.position) {
    case 'bottom-right':
      left = imgW - info.width - pad;
      top = imgH - info.height - pad;
      break;
    case 'bottom-left':
      left = pad;
      top = imgH - info.height - pad;
      break;
    case 'top-right':
      left = imgW - info.width - pad;
      top = pad;
      break;
    default: // top-left
      left = pad;
      top = pad;
  }

  // Composite logo onto image
  return sharp(imageBuffer)
    .composite([{
      input: logoBuffer,
      left: Math.max(0, left),
      top: Math.max(0, top),
      blend: 'over'
    }])
    .jpeg({ quality: 90 })
    .toBuffer();
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

  // FILL the zone completely — art will be resized with fit:'cover' (crop to fill)
  // The zone IS the frame; the photo fills it edge-to-edge.
  // Print size is metadata only — it doesn't affect the visual mockup.
  let artW = Math.round(zoneW);
  let artH = Math.round(zoneH);

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

  // Art fills the entire zone — no aspect ratio letterboxing.
  // The photo is cropped to cover (via Sharp fit:'cover' in generateMockup).
  let scaleX = 1.0;
  let scaleY = 1.0;

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
  addBrandingOverlay,
  addFrameShadow,
  removeGreenSpill,
  parsePrintSize,
  computeArtDimensions,
  computeDestinationCorners
};
