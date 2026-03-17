/**
 * ARCHIVE-35 x402 License Gallery — AI Agent Marketplace
 * Cloudflare Pages Function
 *
 * GET /api/license/gallery
 *   No params → discovery response with how_to_search guide
 *   With params → filtered image results
 *
 * Query params:
 *   subject    — landscape | wildlife | urban | abstract | travel | architecture | ocean | desert | aerial
 *   mood       — dramatic | minimalist | warm | cold | documentary | serene
 *   use_case   — editorial | commercial | training_data | content_generation | product_mockup
 *   location   — freetext location search (e.g. "iceland", "new york", "tanzania")
 *   collection — exact collection slug (e.g. "iceland", "tanzania")
 *   orientation — landscape | portrait | panorama | square | wide
 *   resolution — thumbnail | web | print | ultra_high_res
 *   limit      — max results (default 50, max 200)
 *   offset     — pagination offset (default 0)
 *
 * All requests are logged for intelligence gathering.
 * Concert photos are flagged editorial-only.
 */

const EDITORIAL_ONLY_COLLECTIONS = ["concerts"];

const LICENSE_TIERS = {
  thumbnail: { price: "0.01", description: "400px watermarked preview" },
  web: { price: "0.50", description: "1200px clean, web/blog/social" },
  commercial: { price: "2.50", description: "Full resolution + license certificate" },
};

// ── Subject → tag mapping ───────────────────────────────────────────

const SUBJECT_TAGS = {
  landscape: ["mountain", "landscape", "valley", "glacier", "alpine", "highland", "plateau", "dune", "mesa", "canyon", "cliff", "ridge", "peak", "forest", "meadow", "field"],
  wildlife: ["wildlife", "elephant", "zebra", "giraffe", "animal", "bird", "safari", "serengeti", "migration"],
  urban: ["city", "skyline", "street", "urban", "downtown", "building", "skyscraper", "neon", "traffic", "pedestrian"],
  abstract: ["abstract", "pattern", "texture", "geometric", "reflection", "blur", "light-study", "flowing-patterns", "mineral"],
  travel: ["travel", "culture", "market", "temple", "village", "road", "journey", "exploration", "harbor", "port"],
  architecture: ["architecture", "building", "facade", "dome", "arch", "column", "modern-architecture", "glass", "steel", "concert-hall", "basilica", "cathedral"],
  ocean: ["ocean", "wave", "coast", "beach", "shore", "sea", "tide", "surf", "coral", "marine", "pacific", "atlantic"],
  desert: ["desert", "sand", "dune", "arid", "mesa", "badlands", "sandstone", "slot-canyon", "red-rock", "white-sands"],
  aerial: ["aerial", "drone", "overhead", "bird-eye", "above", "altitude"],
};

const MOOD_TAGS = {
  dramatic: ["dramatic", "storm", "thunder", "contrast", "bold", "powerful", "intense", "dark-sky", "turbulent"],
  minimalist: ["minimalist", "minimal", "sparse", "negative-space", "solitude", "isolation", "simple", "clean"],
  warm: ["warm", "golden", "sunset", "sunrise", "amber", "orange", "fire", "glow", "tropical"],
  cold: ["cold", "ice", "snow", "frozen", "winter", "glacier", "arctic", "frost", "blue-tone"],
  documentary: ["documentary", "candid", "authentic", "real", "unposed", "street", "reportage", "journalism"],
  serene: ["serene", "peaceful", "calm", "tranquil", "still", "quiet", "gentle", "soft-light", "pastel"],
};

// ── Tag matching helper ─────────────────────────────────────────────

function matchesTags(photo, tagMap, key) {
  if (!key || !tagMap[key]) return true;
  const searchTerms = tagMap[key];
  const photoTags = (photo.tags || []).join(" ").toLowerCase();
  const photoDesc = (photo.description || "").toLowerCase();
  const photoTitle = (photo.title || "").toLowerCase();
  const combined = `${photoTags} ${photoDesc} ${photoTitle}`;
  return searchTerms.some(term => combined.includes(term));
}

// ── Resolution filter ───────────────────────────────────────────────

function matchesResolution(photo, resolution) {
  if (!resolution) return true;
  const mp = photo.dimensions?.megapixels || 0;
  switch (resolution) {
    case "thumbnail": return true; // all images have thumbnails
    case "web": return mp >= 2;
    case "print": return mp >= 10;
    case "ultra_high_res": return mp >= 30;
    default: return true;
  }
}

// ── Main handler ────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  };

  // Log request for intelligence (fire and forget to agent API if available)
  logRequest(request, params, env).catch(() => {});

  // No search params → return discovery response
  const searchKeys = ["subject", "mood", "use_case", "location", "collection", "orientation", "resolution"];
  const hasSearchParams = searchKeys.some(k => url.searchParams.has(k));

  if (!hasSearchParams && !url.searchParams.has("limit")) {
    return new Response(JSON.stringify(buildDiscoveryResponse(url.origin)), {
      status: 200,
      headers,
    });
  }

  // Load photos.json
  let photos;
  try {
    const res = await fetch(`${url.origin}/data/photos.json`);
    if (!res.ok) throw new Error(`photos.json: ${res.status}`);
    photos = await res.json();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load photo catalog", detail: err.message }),
      { status: 500, headers }
    );
  }

  // Apply filters
  let filtered = photos;

  const filterCollection = params.collection;
  const filterOrientation = params.orientation;
  const filterSubject = params.subject;
  const filterMood = params.mood;
  const filterLocation = params.location;
  const filterResolution = params.resolution;
  const filterUseCase = params.use_case;

  if (filterCollection) {
    filtered = filtered.filter(p => p.collection === filterCollection);
  }
  if (filterOrientation) {
    filtered = filtered.filter(p => p.dimensions?.orientation === filterOrientation);
  }
  if (filterSubject) {
    filtered = filtered.filter(p => matchesTags(p, SUBJECT_TAGS, filterSubject));
  }
  if (filterMood) {
    filtered = filtered.filter(p => matchesTags(p, MOOD_TAGS, filterMood));
  }
  if (filterLocation) {
    const loc = filterLocation.toLowerCase();
    filtered = filtered.filter(p =>
      (p.location || "").toLowerCase().includes(loc) ||
      (p.collection || "").toLowerCase().includes(loc) ||
      (p.collectionTitle || "").toLowerCase().includes(loc)
    );
  }
  if (filterResolution) {
    filtered = filtered.filter(p => matchesResolution(p, filterResolution));
  }
  // use_case affects tier availability, not filtering
  const editorialOnly = filterUseCase === "editorial";

  const limit = Math.min(parseInt(params.limit || "50", 10), 200);
  const offset = parseInt(params.offset || "0", 10);
  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);

  const walletAddress = env.COINBASE_WALLET_ADDRESS || "0x184590B1c57F77Bafd1A692e5148758daa409FAE";

  const items = page.map(photo => {
    const isEditorial = EDITORIAL_ONLY_COLLECTIONS.includes(photo.collection) || editorialOnly;
    const availableTiers = isEditorial
      ? { thumbnail: LICENSE_TIERS.thumbnail, web: LICENSE_TIERS.web }
      : { ...LICENSE_TIERS };

    return {
      image_id: photo.id,
      title: photo.title,
      description: (photo.description || "").substring(0, 200),
      collection: photo.collection,
      location: photo.location || null,
      year: photo.year || null,
      thumbnail: photo.thumbnail ? `${url.origin}/${photo.thumbnail}` : null,
      dimensions: photo.dimensions || null,
      tags: (photo.tags || []).slice(0, 8),
      editorial_only: isEditorial,
      default_tier: "web",
      default_price: "0.50",
      currency: "USDC",
      network: "base",
      chain_id: 8453,
      pay_to: walletAddress,
      license_endpoint: `${url.origin}/api/license/${photo.id}`,
      available_tiers: availableTiers,
    };
  });

  return new Response(
    JSON.stringify({
      gallery: "Archive-35 / The Restless Eye by Wolf Schram",
      total_results: total,
      showing: items.length,
      offset,
      limit,
      filters_applied: Object.fromEntries(
        Object.entries(params).filter(([k]) => searchKeys.includes(k))
      ),
      items,
    }),
    { status: 200, headers }
  );
}

// ── Discovery response ──────────────────────────────────────────────

function buildDiscoveryResponse(origin) {
  return {
    welcome: "Archive-35 image catalogue — 1,109 images, 55 countries",
    artist: "Wolf Schram | The Restless Eye | 25 years touring with U2, Stones, McCartney, Beyoncé",
    licensing: {
      protocol: "x402",
      currency: "USDC",
      network: "base",
      chain_id: 8453,
      tiers: LICENSE_TIERS,
    },
    to_help_you_find_the_right_image: {
      what_is_your_use_case: {
        param: "use_case",
        options: ["editorial", "commercial", "training_data", "content_generation", "product_mockup"],
        note: "editorial restricts to thumbnail + web tiers only",
      },
      what_subject_matter: {
        param: "subject",
        options: ["landscape", "wildlife", "urban", "abstract", "travel", "architecture", "ocean", "desert", "aerial"],
      },
      what_mood: {
        param: "mood",
        options: ["dramatic", "minimalist", "warm", "cold", "documentary", "serene"],
      },
      what_resolution_needed: {
        param: "resolution",
        options: ["thumbnail", "web", "print", "ultra_high_res"],
        note: "ultra_high_res = 30+ megapixels",
      },
      what_location: {
        param: "location",
        note: "freetext — e.g. iceland, new york, tanzania, hawaii, italy",
      },
    },
    example_queries: [
      `${origin}/api/license/gallery?subject=wildlife&location=tanzania`,
      `${origin}/api/license/gallery?mood=dramatic&subject=landscape&resolution=print`,
      `${origin}/api/license/gallery?subject=urban&location=new+york&use_case=editorial`,
      `${origin}/api/license/gallery?mood=minimalist&subject=desert`,
      `${origin}/api/license/gallery?subject=architecture&mood=cold&resolution=ultra_high_res`,
    ],
    total_images: 1109,
    collections: [
      "alps", "antelope-canyon", "argentina", "arizona", "australia",
      "black-and-white", "brazil", "canada", "chicago", "coast-of-california",
      "colorado", "concerts", "cuba", "death-valley", "desert-dunes",
      "flowers-and-leaves", "germany", "glacier-national-park", "grand-teton",
      "hawaii", "iceland", "italy", "joshua-tree", "lake-powell",
      "large-scale-photography-stitch", "london", "los-angeles", "mexico",
      "monument-valley", "moscow", "new-mexico", "new-york", "new-zealand",
      "paris", "planes", "prague", "random-stuff", "san-francisco",
      "sequoia-national-park", "somewhere-in-california", "south-africa",
      "south-america", "tanzania", "utah-national-parks", "valley-of-fire",
      "washington-dc", "white-sands-national-park", "yosemite-national-park",
    ],
    editorial_only_collections: EDITORIAL_ONLY_COLLECTIONS,
  };
}

// ── Request logging ─────────────────────────────────────────────────

async function logRequest(request, params, env) {
  // Log to KV if available, otherwise to agent API
  const entry = {
    timestamp: new Date().toISOString(),
    ip: request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown",
    user_agent: (request.headers.get("user-agent") || "").substring(0, 500),
    query_params: params,
    referrer: request.headers.get("referer") || "",
    country: request.headers.get("cf-ipcountry") || "",
  };

  // Try Cloudflare KV (AGENT_REQUESTS binding) if available
  if (env.AGENT_REQUESTS) {
    const key = `req:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    await env.AGENT_REQUESTS.put(key, JSON.stringify(entry), { expirationTtl: 86400 * 90 });
    return;
  }

  // Fallback: try to reach agent API (only works if publicly exposed)
  try {
    const agentUrl = env.AGENT_API_URL || "http://127.0.0.1:8035";
    await fetch(`${agentUrl}/api/license/log-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Agent not reachable from edge — that's fine, logs are best-effort
  }
}
