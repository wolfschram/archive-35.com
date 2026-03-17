/**
 * ARCHIVE-35 x402 License Gallery — AI Agent Marketplace
 * Cloudflare Pages Function
 *
 * GET /api/license/gallery
 *
 * Returns all licensable images with thumbnails, titles, locations,
 * pricing tiers, and license endpoints. This is the discovery endpoint
 * for AI agents to browse and purchase image licenses.
 *
 * Query params:
 *   collection — filter by collection slug (e.g. "iceland", "tanzania")
 *   orientation — filter by "landscape", "portrait", "panorama", "square"
 *   limit — max results (default 100, max 1109)
 *   offset — pagination offset (default 0)
 *
 * Concert photos are flagged editorial-only (no commercial tier).
 */

const EDITORIAL_ONLY_COLLECTIONS = ["concerts"];

const LICENSE_TIERS = {
  thumbnail: { price: "0.01", description: "400px watermarked preview" },
  web: { price: "0.50", description: "1200px clean, web/blog/social" },
  commercial: { price: "2.50", description: "Full resolution + license certificate" },
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const filterCollection = url.searchParams.get("collection");
  const filterOrientation = url.searchParams.get("orientation");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 1200);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  // Load photos.json from the deployed site
  let photos;
  try {
    const origin = url.origin;
    const res = await fetch(`${origin}/data/photos.json`);
    if (!res.ok) throw new Error(`photos.json: ${res.status}`);
    photos = await res.json();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load photo catalog", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Filter
  let filtered = photos;
  if (filterCollection) {
    filtered = filtered.filter(p => p.collection === filterCollection);
  }
  if (filterOrientation) {
    filtered = filtered.filter(p => p.dimensions?.orientation === filterOrientation);
  }

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);

  const walletAddress = env.COINBASE_WALLET_ADDRESS || "0x184590B1c57F77Bafd1A692e5148758daa409FAE";

  // Build gallery entries
  const items = page.map(photo => {
    const isEditorial = EDITORIAL_ONLY_COLLECTIONS.includes(photo.collection);
    const defaultTier = isEditorial ? "web" : "web";
    const availableTiers = isEditorial
      ? { thumbnail: LICENSE_TIERS.thumbnail, web: LICENSE_TIERS.web }
      : { ...LICENSE_TIERS };

    return {
      image_id: photo.id,
      title: photo.title,
      collection: photo.collection,
      collection_title: photo.collectionTitle,
      location: photo.location || null,
      year: photo.year || null,
      thumbnail: photo.thumbnail ? `${url.origin}/${photo.thumbnail}` : null,
      dimensions: photo.dimensions || null,
      tags: (photo.tags || []).slice(0, 5),
      default_tier: defaultTier,
      default_price: LICENSE_TIERS[defaultTier].price,
      editorial_only: isEditorial,
      currency: "USDC",
      network: "base",
      chain_id: 8453,
      pay_to: walletAddress,
      license_endpoint: `${url.origin}/api/license/${photo.id}`,
      available_tiers: availableTiers,
    };
  });

  const collections = [...new Set(photos.map(p => p.collection))].sort();

  return new Response(
    JSON.stringify({
      gallery: "Archive-35 / The Restless Eye by Wolf Schram",
      description: "Fine art photography from 55+ countries. License images via x402 protocol (USDC on Base).",
      total_images: total,
      showing: items.length,
      offset,
      limit,
      collections: filterCollection ? [filterCollection] : collections,
      editorial_only_collections: EDITORIAL_ONLY_COLLECTIONS,
      default_tier: "web",
      default_price: "0.50",
      currency: "USDC",
      network: "base",
      items,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    }
  );
}
