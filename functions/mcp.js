/**
 * Archive-35 MCP Server (Model Context Protocol)
 *
 * Implements MCP over Streamable HTTP (JSON-RPC 2.0) as a Cloudflare Pages Function.
 * Exposes the Archive-35 product catalog to AI agents (Claude, ChatGPT, Gemini).
 *
 * Endpoint: POST /mcp
 * Protocol: JSON-RPC 2.0 (MCP Streamable HTTP, stateless mode)
 * Spec: https://modelcontextprotocol.io/specification/2025-11-25
 */

const SERVER_INFO = {
  name: 'archive-35-mcp-server',
  version: '1.0.0'
};

const SERVER_CAPABILITIES = {
  tools: {},
  resources: {}
};

// --- Materials & Pricing (mirrors product-selector.js) ---

const MATERIALS = {
  canvas: { name: 'Canvas', basePrice: 105, description: 'Museum-quality canvas wrap with professional stretching' },
  metal: { name: 'Metal', basePrice: 130, description: 'Vibrant metal print with aluminum coating' },
  acrylic: { name: 'Acrylic', basePrice: 195, description: 'Premium acrylic with stunning color depth' },
  paper: { name: 'Fine Art Paper', basePrice: 60, description: 'Archival fine art paper with matte finish' },
  wood: { name: 'Wood', basePrice: 120, description: 'Rustic wood print on premium plywood' }
};

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

// --- Tool Definitions ---

const TOOLS = [
  {
    name: 'archive35_search_products',
    description: `Search Archive-35's fine art photography catalog by keyword. Searches across titles, descriptions, tags, locations, and collections.

Returns matching photographs with pricing and print options. Use this when a user is looking for specific types of photography (e.g., "wildlife", "mountains", "sunset").

Args:
  - query (string, required): Search term (e.g., "zebra", "Grand Teton", "landscape")
  - limit (number, optional): Max results to return, 1-50 (default: 10)

Returns: Array of matching products with id, title, description, collection, location, price range, and URL.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term to match against titles, descriptions, tags, and locations', minLength: 1 },
        limit: { type: 'number', description: 'Maximum results (1-50, default 10)', minimum: 1, maximum: 50, default: 10 }
      },
      required: ['query']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'archive35_get_product',
    description: `Get detailed information about a specific Archive-35 photograph by its ID.

Returns full product details including all available print materials, sizes, pricing, dimensions, and purchase URL.

Args:
  - id (string, required): Product ID (e.g., "a-001", "gt-025", "nz-010")

Returns: Complete product details with all print variants (material + size combinations with pricing).`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Product ID (e.g., "a-001", "gt-025", "nz-010")' }
      },
      required: ['id']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'archive35_get_collection',
    description: `Get all photographs in a specific Archive-35 collection.

Available collections:
  - "africa" (44 photographs) — Wildlife and landscapes from Tanzania/Serengeti
  - "grand-teton" (48 photographs) — Landscapes from Grand Teton National Park, Wyoming
  - "new-zealand" (16 photographs) — Landscapes from across New Zealand
  - "south-africa" (6 photographs) — Wildlife from South African game reserves and the Cape Peninsula

Args:
  - collection (string, required): Collection ID ("africa", "grand-teton", "new-zealand", or "south-africa")

Returns: All photographs in the collection with titles, descriptions, and price ranges.`,
    inputSchema: {
      type: 'object',
      properties: {
        collection: {
          type: 'string',
          description: 'Collection ID: "africa", "grand-teton", "new-zealand", or "south-africa"',
          enum: ['africa', 'grand-teton', 'new-zealand', 'south-africa']
        }
      },
      required: ['collection']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'archive35_get_catalog_summary',
    description: `Get a high-level overview of the entire Archive-35 catalog.

Returns store information, collection counts, available materials with starting prices, total product count, and links. Use this as a starting point to understand what's available before searching for specific products.

No arguments required.`,
    inputSchema: {
      type: 'object',
      properties: {}
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }
];

// --- Resource Definitions ---

const RESOURCES = [
  {
    uri: 'archive35://catalog',
    name: 'Archive-35 Product Catalog',
    description: 'Complete product catalog with all 114 photographs and their metadata',
    mimeType: 'application/json'
  },
  {
    uri: 'archive35://policies',
    name: 'Archive-35 Policies',
    description: 'Store policies including terms of sale, return policy, shipping, and privacy',
    mimeType: 'text/plain'
  },
  {
    uri: 'archive35://artist',
    name: 'About Wolf / Archive-35',
    description: 'Information about the photographer and the Archive-35 brand',
    mimeType: 'text/plain'
  }
];

// --- Data Loading ---

async function loadPhotos(requestUrl) {
  const photosUrl = new URL('/data/photos.json', requestUrl);
  const resp = await fetch(photosUrl.toString());
  if (!resp.ok) throw new Error('Failed to load photo catalog');
  const data = await resp.json();
  return data.photos || data;
}

function buildProductSummary(photo) {
  const minPrice = calculatePrice(MATERIALS.paper.basePrice, 12 * 8);
  const maxPrice = calculatePrice(MATERIALS.acrylic.basePrice, 60 * 40);
  return {
    id: photo.id,
    title: photo.title,
    description: photo.description,
    collection: photo.collectionTitle,
    location: photo.location,
    tags: photo.tags?.slice(0, 5),
    priceRange: `$${minPrice} — $${maxPrice} USD`,
    url: `https://archive-35.com/gallery.html?collection=${photo.collection}`,
    image: `https://archive-35.com/${photo.thumbnail}`
  };
}

function buildProductDetail(photo) {
  const variants = [];
  for (const [materialKey, material] of Object.entries(MATERIALS)) {
    for (const size of STANDARD_SIZES) {
      const sizeInches = size.width * size.height;
      const dpi = Math.round(Math.min(
        photo.dimensions.width / size.width,
        photo.dimensions.height / size.height
      ));
      if (dpi >= 150) {
        variants.push({
          material: material.name,
          size: `${size.width}" x ${size.height}"`,
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
    collection: photo.collectionTitle,
    location: photo.location,
    year: photo.year,
    tags: photo.tags,
    image: {
      thumbnail: `https://archive-35.com/${photo.thumbnail}`,
      full: `https://archive-35.com/${photo.full}`,
      dimensions: photo.dimensions
    },
    variants,
    shipping: { domestic: 'Free (USA & Canada, 5-9 business days)', international: 'Available upon request' },
    productionTime: '5-14 business days depending on material',
    url: `https://archive-35.com/gallery.html?collection=${photo.collection}`,
    termsOfSale: 'https://archive-35.com/terms.html'
  };
}

// --- Tool Handlers ---

async function handleToolCall(name, args, requestUrl) {
  const photos = await loadPhotos(requestUrl);

  switch (name) {
    case 'archive35_search_products': {
      const query = (args.query || '').toLowerCase();
      const limit = Math.min(Math.max(args.limit || 10, 1), 50);

      const matches = photos.filter(p => {
        const searchable = [
          p.title, p.description, p.location,
          p.collection, p.collectionTitle,
          ...(p.tags || [])
        ].join(' ').toLowerCase();
        return searchable.includes(query);
      });

      const results = matches.slice(0, limit).map(buildProductSummary);

      return {
        total_matches: matches.length,
        showing: results.length,
        query: args.query,
        results
      };
    }

    case 'archive35_get_product': {
      const photo = photos.find(p => p.id === args.id);
      if (!photo) {
        return { error: `Product "${args.id}" not found. Valid IDs: a-001 to a-044, gt-001 to gt-048, nz-001 to nz-016, sa-001 to sa-006.` };
      }
      return buildProductDetail(photo);
    }

    case 'archive35_get_collection': {
      const collectionPhotos = photos.filter(p => p.collection === args.collection);
      if (collectionPhotos.length === 0) {
        return { error: `Collection "${args.collection}" not found. Valid: africa, grand-teton, new-zealand, south-africa.` };
      }
      return {
        collection: args.collection,
        name: collectionPhotos[0].collectionTitle,
        count: collectionPhotos.length,
        url: `https://archive-35.com/collection.html?id=${args.collection}`,
        products: collectionPhotos.map(buildProductSummary)
      };
    }

    case 'archive35_get_catalog_summary': {
      const collections = {};
      for (const p of photos) {
        if (!collections[p.collection]) {
          collections[p.collection] = { name: p.collectionTitle, count: 0 };
        }
        collections[p.collection].count++;
      }

      return {
        store: {
          name: 'Archive-35',
          tagline: 'Light. Place. Time.',
          description: 'Fine art landscape and wildlife photography prints by Wolf. 17+ years, 55+ countries.',
          url: 'https://archive-35.com',
          artist: 'Wolf',
          copyright: '© 2026 Wolf / Archive-35. All rights reserved.'
        },
        catalog: {
          totalProducts: photos.length,
          collections: Object.entries(collections).map(([id, c]) => ({
            id, name: c.name, count: c.count,
            url: `https://archive-35.com/collection.html?id=${id}`
          })),
          materials: Object.entries(MATERIALS).map(([key, m]) => ({
            key, name: m.name, description: m.description, startingPrice: `$${m.basePrice}`
          })),
          priceRange: '$60 — $1,013 USD',
          sizes: '12"x8" to 60"x40"'
        },
        shipping: { domestic: 'Free (USA & Canada)', international: 'Upon request' },
        policies: {
          returns: 'All sales final (custom made-to-order). Damaged/defective prints replaced free.',
          termsOfSale: 'https://archive-35.com/terms.html',
          privacyPolicy: 'https://archive-35.com/privacy.html'
        },
        links: {
          gallery: 'https://archive-35.com/gallery.html',
          catalogApi: 'https://archive-35.com/api/products.json',
          contact: 'https://archive-35.com/contact.html'
        }
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// --- Resource Handlers ---

async function handleResourceRead(uri, requestUrl) {
  switch (uri) {
    case 'archive35://catalog': {
      const photos = await loadPhotos(requestUrl);
      const catalog = photos.map(buildProductSummary);
      return [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ totalProducts: catalog.length, products: catalog }, null, 2)
      }];
    }

    case 'archive35://policies':
      return [{
        uri,
        mimeType: 'text/plain',
        text: `Archive-35 Store Policies

TERMS OF SALE
All sales are final. Each print is a custom, made-to-order fine art product. Art appreciation is subjective, and aesthetic preference is not grounds for a return. Color variations between screen and print are normal and expected.

DAMAGE/DEFECT CLAIMS
If your print arrives damaged or defective, contact us within 30 days. We will replace it at no charge. No physical return required — just provide a photo of the damage.

SHIPPING
Free shipping to USA and Canada (5-9 business days). International shipping available upon request.

PRINT FULFILLMENT
Prints are produced and shipped by Pictorem, a professional fine art print lab. Orders ship directly from Pictorem to you under Archive-35 white-label branding.

PRIVACY
We collect only what's needed to process your order. We do not sell personal data. Full policy: https://archive-35.com/privacy.html

COPYRIGHT
All photographs are copyrighted by Wolf / Archive-35. Purchase grants personal display rights only. Images are not licensed for reproduction, AI training, or commercial use.

Full Terms: https://archive-35.com/terms.html
Full Privacy Policy: https://archive-35.com/privacy.html`
      }];

    case 'archive35://artist':
      return [{
        uri,
        mimeType: 'text/plain',
        text: `About Wolf / Archive-35

Wolf is a fine art photographer with 17+ years of experience capturing landscapes and wildlife across 55+ countries. Archive-35 is his photography gallery and print shop, offering museum-quality prints of his original work.

The name "Archive-35" references the 35mm film format — a nod to the roots of photography and the craft of capturing light, place, and time.

COLLECTIONS
• Africa — Wildlife and landscape photography from Tanzania and the Serengeti (44 photographs)
• Grand Teton — Landscape photography from Grand Teton National Park, Wyoming (48 photographs)
• New Zealand — Landscape photography from across New Zealand (16 photographs)
• South Africa — Wildlife photography from South African game reserves and the Cape Peninsula (6 photographs)

PRINT MATERIALS
All photographs are available as museum-quality prints in five materials: Canvas, Metal, Acrylic, Fine Art Paper, and Wood. Sizes range from 12"x8" to 60"x40".

CONTACT
Website: https://archive-35.com
Email: wolf@archive-35.com
Contact form: https://archive-35.com/contact.html`
      }];

    default:
      return null;
  }
}

// --- JSON-RPC 2.0 Handler ---

function jsonRpcResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleJsonRpcRequest(request, requestUrl) {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      return jsonRpcResponse(id, {
        protocolVersion: '2025-11-25',
        capabilities: SERVER_CAPABILITIES,
        serverInfo: SERVER_INFO
      });

    case 'notifications/initialized':
      // Client notification — no response needed
      return null;

    case 'ping':
      return jsonRpcResponse(id, {});

    case 'tools/list':
      return jsonRpcResponse(id, { tools: TOOLS });

    case 'tools/call': {
      const { name, arguments: args } = params || {};
      if (!name) return jsonRpcError(id, -32602, 'Missing tool name');

      const tool = TOOLS.find(t => t.name === name);
      if (!tool) return jsonRpcError(id, -32602, `Unknown tool: ${name}`);

      try {
        const result = await handleToolCall(name, args || {}, requestUrl);
        return jsonRpcResponse(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        });
      } catch (err) {
        return jsonRpcResponse(id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true
        });
      }
    }

    case 'resources/list':
      return jsonRpcResponse(id, { resources: RESOURCES });

    case 'resources/read': {
      const { uri } = params || {};
      if (!uri) return jsonRpcError(id, -32602, 'Missing resource URI');

      const contents = await handleResourceRead(uri, requestUrl);
      if (!contents) return jsonRpcError(id, -32602, `Unknown resource: ${uri}`);

      return jsonRpcResponse(id, { contents });
    }

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

// --- Cloudflare Pages Function Handler ---

export async function onRequestPost(context) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id'
  };

  try {
    const body = await context.request.json();
    const requestUrl = context.request.url;

    // Handle batch requests
    if (Array.isArray(body)) {
      const responses = [];
      for (const req of body) {
        const resp = await handleJsonRpcRequest(req, requestUrl);
        if (resp !== null) responses.push(resp);
      }
      return new Response(JSON.stringify(responses), { status: 200, headers });
    }

    // Handle single request
    const response = await handleJsonRpcRequest(body, requestUrl);

    // Notifications don't get responses
    if (response === null) {
      return new Response('', { status: 204, headers });
    }

    return new Response(JSON.stringify(response), { status: 200, headers });

  } catch (err) {
    const errorResp = jsonRpcError(null, -32700, `Parse error: ${err.message}`);
    return new Response(JSON.stringify(errorResp), { status: 400, headers });
  }
}

// Handle OPTIONS for CORS
export async function onRequestOptions() {
  return new Response('', {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
      'Access-Control-Max-Age': '86400'
    }
  });
}

// Handle GET for server info / health check
export async function onRequestGet() {
  return new Response(JSON.stringify({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    protocol: 'MCP',
    protocolVersion: '2025-11-25',
    description: 'Archive-35 Fine Art Photography — MCP Server for AI agent access to product catalog',
    capabilities: Object.keys(SERVER_CAPABILITIES),
    tools: TOOLS.map(t => t.name),
    resources: RESOURCES.map(r => r.uri),
    usage: 'Send JSON-RPC 2.0 requests via POST to this endpoint. Start with "initialize" method.'
  }, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
