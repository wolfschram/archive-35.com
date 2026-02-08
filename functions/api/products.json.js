/**
 * ARCHIVE-35 Products API
 *
 * Returns a structured JSON catalog of all available photographs and print options.
 * Designed for AI agent consumption (ChatGPT, Claude, etc.) and third-party integrations.
 *
 * Endpoint: GET /api/products.json
 */

// Materials and base pricing (mirrors product-selector.js)
const MATERIALS = {
  canvas: { name: 'Canvas', basePrice: 105, description: 'Museum-quality canvas wrap with professional stretching' },
  metal: { name: 'Metal', basePrice: 130, description: 'Vibrant metal print with aluminum coating' },
  acrylic: { name: 'Acrylic', basePrice: 195, description: 'Premium acrylic with stunning color depth' },
  paper: { name: 'Fine Art Paper', basePrice: 60, description: 'Archival fine art paper with matte finish' },
  wood: { name: 'Wood', basePrice: 120, description: 'Rustic wood print on premium plywood' }
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

function calculatePrice(basePrice, sizeInches) {
  const baseSize = 96;
  const ratio = sizeInches / baseSize;
  return Math.round(basePrice * Math.pow(ratio, 0.75));
}

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
          const sizeInches = size.width * size.height;
          const dpi = Math.round(Math.min(
            photo.dimensions.width / size.width,
            photo.dimensions.height / size.height
          ));
          // Only include sizes with acceptable print quality (150+ DPI)
          if (dpi >= 150) {
            variants.push({
              material: material.name,
              materialKey,
              size: `${size.width}" x ${size.height}"`,
              widthInches: size.width,
              heightInches: size.height,
              price: calculatePrice(material.basePrice, sizeInches),
              currency: 'USD',
              dpi,
              quality: dpi >= 300 ? 'Museum Quality' : dpi >= 200 ? 'Excellent' : 'Good'
            });
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
        startingPrice: m.basePrice
      })),
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
