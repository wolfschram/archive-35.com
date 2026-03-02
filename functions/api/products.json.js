/**
 * ARCHIVE-35 Products API
 *
 * Returns a structured JSON catalog of all available photographs and print options.
 * Designed for AI agent consumption (ChatGPT, Claude, etc.) and third-party integrations.
 *
 * Endpoint: GET /api/products.json
 */

// Materials (descriptions only — pricing from PRICE_TABLE lookup)
const MATERIALS = {
  canvas: { name: 'Canvas', description: 'Museum-quality canvas wrap with professional stretching', hangReady: true },
  metal: { name: 'Metal', description: 'Vibrant ChromaLuxe HD metal with standoff mounting', hangReady: true },
  acrylic: { name: 'Acrylic', description: 'Premium acrylic with stunning color depth', hangReady: true },
  paper: { name: 'Fine Art Paper', description: 'Archival fine art paper with matte finish', hangReady: false },
  wood: { name: 'Wood', description: 'Rustic wood print on premium plywood', hangReady: true }
};

// Price lookup table — real Pictorem API costs × 2 (50% margin, verified 2026-03-02)
const PRICE_TABLE = {
  canvas: { '12x8': 101, '16x9': 109, '12x12': 90, '16x12': 98, '18x12': 120, '24x10': 124, '24x12': 113, '20x16': 137, '24x14': 140, '24x16': 129, '20x20': 151, '24x18': 156, '36x12': 137, '42x12': 168, '36x15': 174, '32x18': 179, '36x18': 191, '48x16': 192, '36x24': 208, '56x16': 232, '30x30': 214, '60x15': 233, '48x20': 242, '48x24': 255, '40x30': 282, '60x20': 282, '48x27': 298, '72x18': 459, '60x25': 331, '48x32': 337, '60x40': 640 },
  metal: { '12x8': 90, '16x9': 110, '12x12': 110, '16x12': 130, '18x12': 140, '24x10': 150, '24x12': 170, '20x16': 183, '24x14': 190, '24x16': 210, '20x20': 217, '24x18': 230, '36x12': 230, '42x12': 260, '36x15': 275, '32x18': 290, '36x18': 320, '48x16': 370, '36x24': 409, '56x16': 423, '30x30': 424, '60x15': 424, '48x20': 449, '48x24': 529, '40x30': 549, '60x20': 549, '48x27': 589, '72x18': 750, '60x25': 674, '48x32': 689, '60x40': 1209 },
  acrylic: { '12x8': 123, '16x9': 142, '12x12': 142, '16x12': 160, '18x12': 170, '24x10': 179, '24x12': 197, '20x16': 210, '24x14': 216, '24x16': 234, '20x20': 240, '24x18': 253, '36x12': 253, '42x12': 281, '36x15': 294, '32x18': 308, '36x18': 336, '48x16': 382, '36x24': 419, '56x16': 432, '30x30': 433, '60x15': 433, '48x20': 456, '48x24': 530, '40x30': 549, '60x20': 549, '48x27': 586, '72x18': 747, '60x25': 664, '48x32': 678, '60x40': 1173 },
  paper: { '12x8': 33, '16x9': 37, '12x12': 37, '16x12': 42, '18x12': 44, '24x10': 46, '24x12': 50, '20x16': 53, '24x14': 54, '24x16': 59, '20x20': 60, '24x18': 63, '36x12': 63, '42x12': 69, '36x15': 72, '32x18': 75, '36x18': 82, '48x16': 92, '36x24': 101, '56x16': 104, '30x30': 104, '60x15': 104, '48x20': 109, '48x24': 126, '40x30': 131, '60x20': 131, '48x27': 139, '72x18': 139, '60x25': 157, '48x32': 160, '60x40': 237 },
  wood: { '12x8': 54, '16x9': 66, '12x12': 66, '16x12': 79, '18x12': 85, '24x10': 92, '24x12': 104, '20x16': 113, '24x14': 117, '24x16': 130, '20x20': 134, '24x18': 143, '36x12': 143, '42x12': 162, '36x15': 171, '32x18': 181, '36x18': 200, '48x16': 231, '36x24': 257, '56x16': 265, '30x30': 266, '60x15': 266, '48x20': 282, '48x24': 333, '40x30': 346, '60x20': 346, '48x27': 371, '72x18': 533, '60x25': 425, '48x32': 435, '60x40': 825 },
};

function lookupPrice(materialKey, width, height) {
  const key = `${width}x${height}`;
  if (PRICE_TABLE[materialKey] && PRICE_TABLE[materialKey][key]) {
    return PRICE_TABLE[materialKey][key];
  }
  const altKey = `${height}x${width}`;
  if (PRICE_TABLE[materialKey] && PRICE_TABLE[materialKey][altKey]) {
    return PRICE_TABLE[materialKey][altKey];
  }
  return 0;
}

// Frame add-on options (from product-catalog.json v3)
const FRAME_OPTIONS = {
  floatingFrames: [
    { code: '303-19', name: 'Black Floating Frame', applicableTo: ['canvas', 'metal', 'acrylic'] },
    { code: '303-12', name: 'Natural Wood Floating Frame', applicableTo: ['canvas', 'metal', 'acrylic'] },
    { code: '317-22', name: 'White Floating Frame', applicableTo: ['canvas', 'metal', 'acrylic'] },
  ],
  pictureFrames: [
    { code: '241-29', name: 'Black Picture Frame', applicableTo: ['paper'] },
    { code: '241-22', name: 'White Picture Frame', applicableTo: ['paper'] },
    { code: '724-12', name: 'Natural Wood Picture Frame', applicableTo: ['paper'] },
  ],
};

// Standard sizes for 3:2 aspect ratio (most common)
const STANDARD_SIZES = [
  { width: 12, height: 8 },
  { width: 18, height: 12 },
  { width: 24, height: 16 },
  { width: 36, height: 24 },
  { width: 48, height: 32 },
  { width: 60, height: 40 }
];

export async function onRequestGet(context) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600'
  };

  try {
    // Fetch photos.json from the same origin
    const photosUrl = new URL('/data/photos.json', context.request.url);
    const photosResponse = await fetch(photosUrl.toString());

    if (!photosResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to load photo catalog' }), {
        status: 500, headers
      });
    }

    const photosData = await photosResponse.json();
    const photos = photosData.photos || photosData;

    // Build collections summary
    const collectionsMap = {};
    for (const photo of photos) {
      if (!collectionsMap[photo.collection]) {
        collectionsMap[photo.collection] = {
          id: photo.collection,
          name: photo.collectionTitle,
          count: 0,
          url: `https://archive-35.com/collection.html?id=${photo.collection}`
        };
      }
      collectionsMap[photo.collection].count++;
    }

    // Build product catalog
    const products = photos.map(photo => {
      const variants = [];
      for (const [materialKey, material] of Object.entries(MATERIALS)) {
        for (const size of STANDARD_SIZES) {
          const dpi = Math.round(Math.min(
            photo.dimensions.width / size.width,
            photo.dimensions.height / size.height
          ));
          // Only include sizes with acceptable print quality (150+ DPI)
          if (dpi >= 150) {
            const price = lookupPrice(materialKey, size.width, size.height);
            if (price > 0) {
              variants.push({
                material: material.name,
                materialKey,
                size: `${size.width}" x ${size.height}"`,
                widthInches: size.width,
                heightInches: size.height,
                price,
                currency: 'USD',
                dpi,
                quality: dpi >= 300 ? 'Museum Quality' : dpi >= 200 ? 'Excellent' : 'Good'
              });
            }
          }
        }
      }

      return {
        id: photo.id,
        title: photo.title,
        description: photo.description,
        collection: photo.collection,
        collectionTitle: photo.collectionTitle,
        location: photo.location,
        tags: photo.tags,
        image: {
          thumbnail: `https://archive-35.com/${photo.thumbnail}`,
          full: `https://archive-35.com/${photo.full}`,
          dimensions: photo.dimensions
        },
        url: `https://archive-35.com/gallery.html?collection=${photo.collection}`,
        variants,
        shipping: {
          domestic: 'Free (USA & Canada, 5-9 business days)',
          international: 'Available upon request'
        },
        productionTime: '5-14 business days depending on material'
      };
    });

    // Starting prices (smallest standard size per material)
    const startingPrices = {};
    for (const matKey of Object.keys(MATERIALS)) {
      startingPrices[matKey] = lookupPrice(matKey, 12, 8);
    }

    const catalog = {
      store: {
        name: 'Archive-35',
        description: 'Fine art landscape and wildlife photography prints by Wolf',
        url: 'https://archive-35.com',
        currency: 'USD',
        artist: 'Wolf',
        copyright: '2026 Archive-35 / Wolf. All rights reserved.',
        termsOfSale: 'https://archive-35.com/terms.html',
        privacyPolicy: 'https://archive-35.com/privacy.html',
        contact: 'https://archive-35.com/contact.html'
      },
      collections: Object.values(collectionsMap),
      materials: Object.entries(MATERIALS).map(([key, m]) => ({
        key,
        name: m.name,
        description: m.description,
        startingPrice: startingPrices[key],
        hangReady: m.hangReady
      })),
      frameOptions: FRAME_OPTIONS,
      totalProducts: products.length,
      products
    };

    return new Response(JSON.stringify(catalog, null, 2), {
      status: 200, headers
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error', message: err.message }), {
      status: 500, headers
    });
  }
}
