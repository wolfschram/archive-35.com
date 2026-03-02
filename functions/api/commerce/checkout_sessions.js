/**
 * Archive-35 — OpenAI Agentic Commerce Protocol Checkout Sessions
 *
 * Implements the ACP checkout flow endpoints:
 *   POST /api/commerce/checkout_sessions         — Create session
 *   GET  /api/commerce/checkout_sessions?id=xxx  — Get session status
 *
 * Spec: https://developers.openai.com/commerce/specs/checkout
 *
 * NOTE: This is a foundation implementation. Full Stripe SharedPaymentToken
 * processing requires merchant approval from OpenAI and Stripe Connect setup.
 * These endpoints return proper ACP responses for integration testing.
 */

const ACP_VERSION = '2025-09-29';

const MATERIALS = {
  canvas: { name: 'Canvas' },
  metal: { name: 'Metal' },
  acrylic: { name: 'Acrylic' },
  paper: { name: 'Fine Art Paper' },
  wood: { name: 'Wood' }
};

// Price lookup table — real Pictorem API costs × 2 (50% margin, verified 2026-03-02)
const PRICE_TABLE = {
  canvas: { '12x8': 101, '16x9': 109, '12x12': 90, '16x12': 98, '18x12': 120, '24x10': 124, '24x12': 113, '20x16': 137, '24x14': 140, '24x16': 129, '20x20': 151, '24x18': 156, '36x12': 137, '42x12': 168, '36x15': 174, '32x18': 179, '36x18': 191, '48x16': 192, '36x24': 208, '56x16': 232, '30x30': 214, '60x15': 233, '48x20': 242, '48x24': 255, '40x30': 282, '60x20': 282, '48x27': 298, '72x18': 459, '60x25': 331, '48x32': 337, '60x40': 640 },
  metal: { '12x8': 90, '16x9': 110, '12x12': 110, '16x12': 130, '18x12': 140, '24x10': 150, '24x12': 170, '20x16': 183, '24x14': 190, '24x16': 210, '20x20': 217, '24x18': 230, '36x12': 230, '42x12': 260, '36x15': 275, '32x18': 290, '36x18': 320, '48x16': 370, '36x24': 409, '56x16': 423, '30x30': 424, '60x15': 424, '48x20': 449, '48x24': 529, '40x30': 549, '60x20': 549, '48x27': 589, '72x18': 750, '60x25': 674, '48x32': 689, '60x40': 1209 },
  acrylic: { '12x8': 123, '16x9': 142, '12x12': 142, '16x12': 160, '18x12': 170, '24x10': 179, '24x12': 197, '20x16': 210, '24x14': 216, '24x16': 234, '20x20': 240, '24x18': 253, '36x12': 253, '42x12': 281, '36x15': 294, '32x18': 308, '36x18': 336, '48x16': 382, '36x24': 419, '56x16': 432, '30x30': 433, '60x15': 433, '48x20': 456, '48x24': 530, '40x30': 549, '60x20': 549, '48x27': 586, '72x18': 747, '60x25': 664, '48x32': 678, '60x40': 1173 },
  paper: { '12x8': 33, '16x9': 37, '12x12': 37, '16x12': 42, '18x12': 44, '24x10': 46, '24x12': 50, '20x16': 53, '24x14': 54, '24x16': 59, '20x20': 60, '24x18': 63, '36x12': 63, '42x12': 69, '36x15': 72, '32x18': 75, '36x18': 82, '48x16': 92, '36x24': 101, '56x16': 104, '30x30': 104, '60x15': 104, '48x20': 109, '48x24': 126, '40x30': 131, '60x20': 131, '48x27': 139, '72x18': 139, '60x25': 157, '48x32': 160, '60x40': 237 },
  wood: { '12x8': 54, '16x9': 66, '12x12': 66, '16x12': 79, '18x12': 85, '24x10': 92, '24x12': 104, '20x16': 113, '24x14': 117, '24x16': 130, '20x20': 134, '24x18': 143, '36x12': 143, '42x12': 162, '36x15': 171, '32x18': 181, '36x18': 200, '48x16': 231, '36x24': 257, '56x16': 265, '30x30': 266, '60x15': 266, '48x20': 282, '48x24': 333, '40x30': 346, '60x20': 346, '48x27': 371, '72x18': 533, '60x25': 425, '48x32': 435, '60x40': 825 },
};

function lookupPrice(materialKey, w, h) {
  const key = `${w}x${h}`;
  if (PRICE_TABLE[materialKey] && PRICE_TABLE[materialKey][key]) return PRICE_TABLE[materialKey][key];
  const alt = `${h}x${w}`;
  if (PRICE_TABLE[materialKey] && PRICE_TABLE[materialKey][alt]) return PRICE_TABLE[materialKey][alt];
  return 0;
}

// Parse variant ID like "a-001_canvas_24x16"
function parseVariantId(variantId) {
  const parts = variantId.split('_');
  if (parts.length < 3) return null;

  const sizeStr = parts[parts.length - 1];
  const materialKey = parts[parts.length - 2];
  const photoId = parts.slice(0, -2).join('_');

  const [w, h] = sizeStr.split('x').map(Number);
  if (!MATERIALS[materialKey] || !w || !h) return null;

  const priceCents = lookupPrice(materialKey, w, h) * 100;

  return {
    photoId,
    materialKey,
    materialName: MATERIALS[materialKey].name,
    width: w,
    height: h,
    size: `${w}" x ${h}"`,
    priceCents
  };
}

function generateSessionId() {
  return 'cs_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, API-Version',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'API-Version': ACP_VERSION,
      ...CORS_HEADERS
    }
  });
}

function errorResponse(code, message, status = 400) {
  return jsonResponse({
    error: { code, message },
    messages: [{ type: 'error', text: message }]
  }, status);
}

// --- Fulfillment Options ---

const FULFILLMENT_OPTIONS = [
  {
    id: 'standard_us',
    title: 'Standard Shipping (USA & Canada)',
    subtitle: '7-21 business days (includes production time)',
    carrier: 'UPS / FedEx',
    cost_cents: 0
  },
  {
    id: 'international',
    title: 'International Shipping',
    subtitle: '14-30 business days',
    carrier: 'DHL / FedEx International',
    cost_cents: 4500
  }
];

// --- Checkout Session Builder ---

function buildCheckoutResponse(sessionId, items, fulfillmentAddress, buyer, fulfillmentOptionId, status) {
  const lineItems = [];
  let itemsSubtotal = 0;

  for (const item of items) {
    const variant = parseVariantId(item.id);
    if (!variant) continue;

    const lineTotal = variant.priceCents * (item.quantity || 1);
    const tax = Math.round(lineTotal * 0.08); // 8% estimated tax

    lineItems.push({
      id: `li_${item.id}`,
      item: {
        id: item.id,
        title: `${variant.materialName} Print ${variant.size}`,
        quantity: item.quantity || 1
      },
      base_amount: variant.priceCents,
      discount: 0,
      subtotal: lineTotal,
      tax,
      total: lineTotal + tax
    });

    itemsSubtotal += lineTotal;
  }

  const taxTotal = Math.round(itemsSubtotal * 0.08);
  const selectedFulfillment = FULFILLMENT_OPTIONS.find(f => f.id === fulfillmentOptionId) || FULFILLMENT_OPTIONS[0];
  const shippingCost = selectedFulfillment.cost_cents;
  const grandTotal = itemsSubtotal + taxTotal + shippingCost;

  const now = new Date();
  const minDelivery = new Date(now.getTime() + 7 * 86400000);
  const maxDelivery = new Date(now.getTime() + 21 * 86400000);

  return {
    id: sessionId,
    status,
    currency: 'usd',
    payment_provider: {
      provider: 'stripe',
      supported_payment_methods: ['card']
    },
    line_items: lineItems,
    fulfillment_address: fulfillmentAddress || null,
    buyer: buyer || null,
    fulfillment_options: FULFILLMENT_OPTIONS.map(opt => ({
      id: opt.id,
      title: opt.title,
      subtitle: opt.subtitle,
      carrier: opt.carrier,
      earliest_delivery_time: minDelivery.toISOString(),
      latest_delivery_time: maxDelivery.toISOString(),
      subtotal: itemsSubtotal,
      tax: taxTotal,
      total: itemsSubtotal + taxTotal + opt.cost_cents
    })),
    fulfillment_option_id: fulfillmentOptionId || 'standard_us',
    totals: [
      { type: 'items_base_amount', display_text: 'Subtotal', amount: itemsSubtotal },
      { type: 'tax', display_text: 'Estimated Tax', amount: taxTotal },
      { type: 'fulfillment', display_text: selectedFulfillment.title, amount: shippingCost },
      { type: 'total', display_text: 'Total', amount: grandTotal }
    ],
    messages: status === 'ready_for_payment'
      ? []
      : [{ type: 'info', text: 'Archive-35 checkout is in preview mode. Full payment processing coming soon.' }],
    links: {
      update_checkout: {
        href: `/api/commerce/checkout_sessions/${sessionId}`,
        method: 'POST'
      }
    }
  };
}

// --- Request Handlers ---

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    // Validate required fields
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return errorResponse('invalid_request', 'items array is required and must not be empty');
    }

    // Validate each item
    for (const item of body.items) {
      if (!item.id) {
        return errorResponse('invalid_request', 'Each item must have an id');
      }
      const variant = parseVariantId(item.id);
      if (!variant) {
        return errorResponse('invalid_item', `Invalid product variant: ${item.id}. Format: {photo_id}_{material}_{width}x{height}`);
      }
    }

    const sessionId = generateSessionId();
    const response = buildCheckoutResponse(
      sessionId,
      body.items,
      body.fulfillment_address || null,
      body.buyer || null,
      body.fulfillment_option_id || 'standard_us',
      'ready_for_payment'
    );

    return jsonResponse(response, 201);

  } catch (err) {
    return errorResponse('parse_error', `Invalid request body: ${err.message}`);
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sessionId = url.searchParams.get('id');

  if (!sessionId) {
    return jsonResponse({
      service: 'Archive-35 Agentic Commerce Protocol',
      version: ACP_VERSION,
      endpoints: {
        create_session: 'POST /api/commerce/checkout_sessions',
        get_session: 'GET /api/commerce/checkout_sessions?id={session_id}',
        complete_session: 'POST /api/commerce/checkout_sessions/{id}/complete',
        cancel_session: 'POST /api/commerce/checkout_sessions/{id}/cancel',
        product_feed: 'GET /api/commerce/feed.json'
      },
      status: 'preview',
      note: 'Full Stripe SharedPaymentToken checkout requires OpenAI merchant approval. Apply at chatgpt.com/merchants/'
    });
  }

  // In a full implementation, we'd look up the session from KV storage.
  // For now, return a status message.
  return jsonResponse({
    id: sessionId,
    status: 'expired',
    messages: [
      { type: 'info', text: 'Session lookup requires persistent storage (Cloudflare KV). This endpoint is ready for production integration.' }
    ]
  });
}

export async function onRequestOptions() {
  return new Response('', {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'Access-Control-Max-Age': '86400'
    }
  });
}
