/**
 * Generate a synthetic test room image for mockup engine development.
 *
 * Creates a 3000x2000 image with:
 * - Warm gray wall background
 * - Darker floor area
 * - Subtle baseboard line
 * - A lighter rectangle indicating where the art placement zone is
 *
 * This lets us test the compositing pipeline without needing real room photos.
 * Real room templates will be sourced/shot later.
 */

const sharp = require('sharp');
const path = require('path');

const WIDTH = 3000;
const HEIGHT = 2000;

async function generateTestRoom() {
  // Create the base room image using SVG for precise control
  const svg = `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <!-- Wall -->
      <rect width="${WIDTH}" height="1400" fill="#E8E0D8"/>

      <!-- Subtle wall texture gradient -->
      <rect width="${WIDTH}" height="1400" fill="url(#wallGrad)" opacity="0.15"/>

      <!-- Floor -->
      <rect y="1400" width="${WIDTH}" height="600" fill="#8B7355"/>

      <!-- Baseboard -->
      <rect y="1380" width="${WIDTH}" height="20" fill="#D0C8BE"/>

      <!-- Wall placement guide (subtle) -->
      <rect x="800" y="280" width="850" height="640" fill="none"
            stroke="#D5CFC8" stroke-width="2" stroke-dasharray="10,5" opacity="0.5"/>

      <!-- Shadow under where art would go -->
      <rect x="805" y="925" width="840" height="8" fill="#C8C0B5" opacity="0.3" rx="4"/>

      <!-- Simple side table silhouette (right side) -->
      <rect x="1900" y="1100" width="300" height="280" rx="5" fill="#6B5B4D"/>
      <rect x="1880" y="1080" width="340" height="25" rx="3" fill="#7A6A5C"/>

      <!-- Simple plant silhouette (left side) -->
      <ellipse cx="500" cy="1050" rx="120" ry="150" fill="#5C7A52" opacity="0.6"/>
      <rect x="480" y="1200" width="40" height="180" rx="5" fill="#8B7355"/>

      <defs>
        <linearGradient id="wallGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#FFF" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#000" stop-opacity="0.1"/>
        </linearGradient>
      </defs>
    </svg>
  `;

  const outputPath = path.join(__dirname, '..', '..', 'templates', 'rooms', 'test-living-room-01.jpg');

  await sharp(Buffer.from(svg))
    .jpeg({ quality: 92 })
    .toFile(outputPath);

  console.log(`Test room generated: ${outputPath}`);
  console.log(`Dimensions: ${WIDTH}x${HEIGHT}`);
  console.log('Placement zone corners (matching template JSON):');
  console.log('  TL: [845, 310]  TR: [1610, 290]');
  console.log('  BL: [835, 900]  BR: [1620, 885]');
}

generateTestRoom().catch(console.error);
