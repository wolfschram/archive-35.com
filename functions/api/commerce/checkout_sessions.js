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
  canvas: { name: 'Canvas', basePrice: 82 },
  metal: { name: 'Metal', basePrice: 99 },
  acrylic: { name: 'Acrylic', basePrice: 149 },
  paper: { name: 'Fine Art Paper', basePrice: 45 },
  wood: { name: 'Wood', basePrice: 92 }
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

// Parse variant ID like "a-001_canvas_24x16"
function parseVariantId(variantId) {
  const parts = variantId.split('_');
  if (parts.length < 3) return null;

  const sizeStr = parts[parts.length - 1];
  const materialKey = parts[parts.length - 2];
  const photoId = parts.slice(0, -2).join('_');

  const [w, h] = sizeStr.split('x').map(Number);
  if (!MATERIALS[materialKey] || !w || !h) return null;

  const sizeInches = w * h;
  const priceCents = calculatePrice(MATERIALS[materialKey].basePrice, sizeInches) * 100;

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
