/**
 * homography.js — Perspective Transform Math for Archive-35 Mockup Engine
 *
 * Computes a 3x3 homography matrix that maps a rectangle (the art photo)
 * onto an arbitrary quadrilateral (the wall placement zone in a room template).
 *
 * The math: Given 4 source corners (rect) and 4 destination corners (quad),
 * solve for the 3x3 matrix H such that H * [x, y, 1]^T = [x', y', w']
 * where (x'/w', y'/w') are the transformed coordinates.
 *
 * Used by compositor.js to warp art photos onto room walls with correct perspective.
 */

'use strict';

/**
 * Compute homography matrix from 4 point correspondences.
 *
 * @param {Array<{x: number, y: number}>} src - Source rectangle corners [TL, TR, BR, BL]
 * @param {Array<{x: number, y: number}>} dst - Destination quadrilateral corners [TL, TR, BR, BL]
 * @returns {number[]} 3x3 matrix as flat 9-element array [a,b,c,d,e,f,g,h,1]
 */
function computeHomography(src, dst) {
  // Build the 8x8 system of equations: A * h = b
  // For each point pair (x,y) -> (x',y'):
  //   x*h1 + y*h2 + h3 - x*x'*h7 - y*x'*h8 = x'
  //   x*h4 + y*h5 + h6 - x*y'*h7 - y*y'*h8 = y'

  const A = [];
  const b = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x;
    const sy = src[i].y;
    const dx = dst[i].x;
    const dy = dst[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);

    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }

  // Solve using Gaussian elimination with partial pivoting
  const h = solveLinearSystem(A, b);

  // Return 3x3 matrix (h9 = 1 by convention)
  return [
    h[0], h[1], h[2],
    h[3], h[4], h[5],
    h[6], h[7], 1.0
  ];
}

/**
 * Apply homography to transform a single point.
 *
 * @param {number[]} H - 3x3 homography matrix (flat 9-element array)
 * @param {number} x - Source x coordinate
 * @param {number} y - Source y coordinate
 * @returns {{x: number, y: number}} Transformed point
 */
function transformPoint(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w
  };
}

/**
 * Compute the inverse homography matrix.
 * Used for reverse-mapping: given a pixel in the output, find where it
 * came from in the source image.
 *
 * @param {number[]} H - 3x3 homography matrix (flat 9-element array)
 * @returns {number[]} Inverse 3x3 matrix (flat 9-element array)
 */
function invertHomography(H) {
  const [a, b, c, d, e, f, g, h, i] = H;

  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);

  if (Math.abs(det) < 1e-10) {
    throw new Error('Homography matrix is singular (degenerate corners?)');
  }

  const invDet = 1.0 / det;

  return [
    (e * i - f * h) * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    (f * g - d * i) * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    (d * h - e * g) * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet
  ];
}

/**
 * Compute bounding box of the transformed quadrilateral.
 * Used to determine the output region for compositing.
 *
 * @param {number[]} H - 3x3 homography matrix
 * @param {number} width - Source image width
 * @param {number} height - Source image height
 * @returns {{x: number, y: number, width: number, height: number}} Bounding box
 */
function getTransformedBounds(H, width, height) {
  const corners = [
    transformPoint(H, 0, 0),
    transformPoint(H, width, 0),
    transformPoint(H, width, height),
    transformPoint(H, 0, height)
  ];

  const xs = corners.map(c => c.x);
  const ys = corners.map(c => c.y);

  const minX = Math.floor(Math.min(...xs));
  const minY = Math.floor(Math.min(...ys));
  const maxX = Math.ceil(Math.max(...xs));
  const maxY = Math.ceil(Math.max(...ys));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

/**
 * Generate a pixel-level reverse mapping for compositing.
 * For each pixel in the destination region, compute the corresponding
 * source pixel using the inverse homography.
 *
 * Returns a Buffer of RGBA pixels that can be composited onto the room template.
 *
 * @param {Buffer} srcPixels - Source image raw pixel data (RGBA)
 * @param {number} srcWidth - Source image width
 * @param {number} srcHeight - Source image height
 * @param {number[]} H - Forward homography matrix
 * @param {number} dstWidth - Destination region width
 * @param {number} dstHeight - Destination region height
 * @param {number} offsetX - Destination region X offset
 * @param {number} offsetY - Destination region Y offset
 * @returns {Buffer} RGBA pixel buffer for the destination region
 */
function warpImage(srcPixels, srcWidth, srcHeight, H, dstWidth, dstHeight, offsetX, offsetY) {
  const Hinv = invertHomography(H);
  const output = Buffer.alloc(dstWidth * dstHeight * 4, 0); // RGBA, transparent

  for (let dy = 0; dy < dstHeight; dy++) {
    for (let dx = 0; dx < dstWidth; dx++) {
      // Map destination pixel back to source
      const src = transformPoint(Hinv, dx + offsetX, dy + offsetY);
      const sx = Math.round(src.x);
      const sy = Math.round(src.y);

      // Check bounds
      if (sx >= 0 && sx < srcWidth && sy >= 0 && sy < srcHeight) {
        const srcIdx = (sy * srcWidth + sx) * 4;
        const dstIdx = (dy * dstWidth + dx) * 4;

        output[dstIdx] = srcPixels[srcIdx];         // R
        output[dstIdx + 1] = srcPixels[srcIdx + 1]; // G
        output[dstIdx + 2] = srcPixels[srcIdx + 2]; // B
        output[dstIdx + 3] = srcPixels[srcIdx + 3]; // A
      }
    }
  }

  return output;
}

/**
 * Bilinear interpolation version of warpImage for higher quality output.
 * Slower but produces smoother results — use for final output, not previews.
 */
function warpImageBilinear(srcPixels, srcWidth, srcHeight, H, dstWidth, dstHeight, offsetX, offsetY) {
  const Hinv = invertHomography(H);
  const output = Buffer.alloc(dstWidth * dstHeight * 4, 0);

  for (let dy = 0; dy < dstHeight; dy++) {
    for (let dx = 0; dx < dstWidth; dx++) {
      const src = transformPoint(Hinv, dx + offsetX, dy + offsetY);

      const x0 = Math.floor(src.x);
      const y0 = Math.floor(src.y);
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      // Check all 4 neighbors are in bounds
      if (x0 >= 0 && x1 < srcWidth && y0 >= 0 && y1 < srcHeight) {
        const fx = src.x - x0;
        const fy = src.y - y0;

        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;

        const i00 = (y0 * srcWidth + x0) * 4;
        const i10 = (y0 * srcWidth + x1) * 4;
        const i01 = (y1 * srcWidth + x0) * 4;
        const i11 = (y1 * srcWidth + x1) * 4;

        const dstIdx = (dy * dstWidth + dx) * 4;

        for (let c = 0; c < 4; c++) {
          output[dstIdx + c] = Math.round(
            srcPixels[i00 + c] * w00 +
            srcPixels[i10 + c] * w10 +
            srcPixels[i01 + c] * w01 +
            srcPixels[i11 + c] * w11
          );
        }
      }
    }
  }

  return output;
}

// --- Linear algebra helpers ---

/**
 * Solve Ax = b using Gaussian elimination with partial pivoting.
 * @param {number[][]} A - 8x8 coefficient matrix
 * @param {number[]} b - 8-element right-hand side
 * @returns {number[]} Solution vector (8 elements)
 */
function solveLinearSystem(A, b) {
  const n = b.length;

  // Augmented matrix
  const M = A.map((row, i) => [...row, b[i]]);

  // Forward elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxVal = Math.abs(M[col][col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > maxVal) {
        maxVal = Math.abs(M[row][col]);
        maxRow = row;
      }
    }

    // Swap rows
    if (maxRow !== col) {
      [M[col], M[maxRow]] = [M[maxRow], M[col]];
    }

    if (Math.abs(M[col][col]) < 1e-10) {
      throw new Error('Singular matrix in homography computation (degenerate point configuration)');
    }

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= M[i][j] * x[j];
    }
    x[i] /= M[i][i];
  }

  return x;
}

module.exports = {
  computeHomography,
  transformPoint,
  invertHomography,
  getTransformedBounds,
  warpImage,
  warpImageBilinear,
  solveLinearSystem
};
