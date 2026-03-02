/**
 * Archive-35 — OpenAI Agentic Commerce Protocol Product Feed
 *
 * Returns all products in ACP-compatible format for ChatGPT shopping.
 * Spec: https://developers.openai.com/commerce/specs/feed/
 *
 * Endpoint: GET /api/commerce/feed.json
 */

const MATERIALS = {
  canvas: { name: 'Canvas' },
  metal: { name: 'Metal' },
  acrylic: { name: 'Acrylic' },
  paper: { name: 'Fine Art Paper' },
  wood: { name: 'Wood' }
};

// Price lookup table — real Pictorem API costs × 2 (50% margin, verified 2026-03-02)
const PRICE_TABLE = {
  canvas: { '12x8': 101, '18x12': 120, '24x16': 129, '36x24': 208, '48x32': 337, '60x40': 640 },
  metal: { '12x8': 90, '18x12': 140, '24x16': 210, '36x24': 409, '48x32': 689, '60x40': 1209 },
  acrylic: { '12x8': 123, '18x12': 170, '24x16': 234, '36x24': 419, '48x32': 678, '60x40': 1173 },
  paper: { '12x8': 33, '18x12': 44, '24x16': 59, '36x24': 101, '48x32': 160, '60x40': 237 },
  wood: { '12x8': 54, '18x12': 85, '24x16': 130, '36x24': 257, '48x32': 435, '60x40': 825 },
};

function lookupPrice(materialKey, w, h) {
  const key = `${w}x${h}`;
  return (PRICE_TABLE[materialKey] && PRICE_TABLE[materialKey][key]) || 0;
}

const STANDARD_SIZES = [
  { width: 12, height: 8, label: '12" x 8"' },
  { width: 18, height: 12, label: '18" x 12"' },
  { width: 24, height: 16, label: '24" x 16"' },
  { width: 36, height: 24, label: '36" x 24"' },
  { width: 48, height: 32, label: '48" x 32"' },
  { width: 60, height: 40, label: '60" x 40"' }
];

export async function onRequestGet(context) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=900'
  };

  try {
    const photosUrl = new URL('/data/photos.json', context.request.url);
    const photosResponse = await fetch(photosUrl.toString());
    if (!photosResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to load catalog' }), { status: 500, headers });
    }

    const photosData = await photosResponse.json();
    const photos = photosData.photos || photosData;

    // Build ACP product feed — each material/size variant is a separate product
    const products = [];

    for (const photo of photos) {
      // Find cheapest and most expensive variants for the parent product
      let minPrice = Infinity;
      let maxPrice = 0;
      const variants = [];

      for (const [matKey, mat] of Object.entries(MATERIALS)) {
        for (const size of STANDARD_SIZES) {
          const sizeInches = size.width * size.height;
          const dpi = Math.round(Math.min(
            photo.dimensions.width / size.width,
            photo.dimensions.height / size.height
          ));

          if (dpi >= 150) {
            const priceUsd = lookupPrice(matKey, size.width, size.height);
            if (!priceUsd) continue;
            const priceCents = priceUsd * 100;
            if (priceUsd < minPrice) minPrice = priceUsd;
            if (priceUsd > maxPrice) maxPrice = priceUsd;

            variants.push({
              id: `${photo.id}_${matKey}_${size.width}x${size.height}`,
              title: `${photo.title} — ${mat.name} ${size.label}`,
              description: photo.description,
              price: priceCents,
              currency: 'USD',
              availability: 'in_stock',
              image_url: `https://archive-35.com/${photo.full}`,
              additional_images: [`https://archive-35.com/${photo.thumbnail}`],
              category: 'Fine Art Photography',
              brand: 'Archive-35',
              product_type: `${mat.name} Print`,
              group_id: photo.id,
              variant_attributes: {
                material: mat.name,
                size: size.label
              },
              seller_name: 'Archive-35',
              seller_url: 'https://archive-35.com',
              shipping_cost: 0,
              shipping_time_min_days: 7,
              shipping_time_max_days: 21,
              return_policy_url: 'https://archive-35.com/terms.html',
              return_window_days: 0,
              tags: [...(photo.tags || []), photo.collectionTitle, mat.name, 'Fine Art', 'Photography', 'Wall Art'],
              enable_search: true,
              enable_checkout: true
            });
          }
        }
      }

      // Parent product (group listing)
      products.push({
        id: photo.id,
        title: photo.title,
        description: photo.description,
        price: minPrice * 100,
        currency: 'USD',
        availability: 'in_stock',
        image_url: `https://archive-35.com/${photo.full}`,
        additional_images: [`https://archive-35.com/${photo.thumbnail}`],
        category: 'Fine Art Photography',
        brand: 'Archive-35',
        product_type: 'Fine Art Print',
        tags: [...(photo.tags || []), photo.collectionTitle, 'Fine Art', 'Photography', 'Wall Art'],
        group_id: photo.id,
        seller_name: 'Archive-35',
        seller_url: 'https://archive-35.com',
        shipping_cost: 0,
        shipping_time_min_days: 7,
        shipping_time_max_days: 21,
        return_policy_url: 'https://archive-35.com/terms.html',
        return_window_days: 0,
        enable_search: true,
        enable_checkout: true,
        variants: variants.length
      });

      // Add all variants
      products.push(...variants);
    }

    const feed = {
      feed_version: '1.0',
      merchant: {
        name: 'Archive-35',
        url: 'https://archive-35.com',
        description: 'Fine art landscape and wildlife photography prints by Wolf',
        currency: 'USD',
        country: 'US'
      },
      updated_at: new Date().toISOString(),
      total_products: products.length,
      products
    };

    return new Response(JSON.stringify(feed, null, 2), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error', message: err.message }), { status: 500, headers });
  }
}
