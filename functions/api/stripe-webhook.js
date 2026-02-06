/**
 * ARCHIVE-35 Stripe Webhook → Pictorem Auto-Fulfillment
 * Cloudflare Pages Function
 *
 * POST /api/stripe-webhook
 *
 * Flow:
 * 1. Receives Stripe webhook event (checkout.session.completed)
 * 2. Extracts order details + shipping address
 * 3. Maps material to Pictorem preordercode
 * 4. Validates order with Pictorem API
 * 5. Gets price confirmation from Pictorem
 * 6. Submits order to Pictorem for fulfillment
 *
 * Required Cloudflare env vars:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   PICTOREM_API_KEY (default: "archive-35")
 */

// ============================================================================
// MATERIAL MAPPING: Website → Pictorem preordercode
// ============================================================================

const MATERIAL_MAP = {
  canvas: {
    material: 'canvas',
    type: 'stretched',
    // semigloss finish, mirror image wrap (no content loss), 1.5" thick, no frame
    additionals: ['semigloss', 'mirrorimage', 'c15', 'none', 'none'],
  },
  metal: {
    material: 'metal',
    type: 'al',           // aluminum
    additionals: ['none', 'none'],
  },
  acrylic: {
    material: 'acrylic',
    type: 'ac220',        // 2-20mm acrylic
    additionals: ['none', 'none'],
  },
  paper: {
    material: 'paper',
    type: 'art',          // fine art paper
    additionals: ['none', 'none'],
  },
  wood: {
    material: 'wood',
    type: 'ru14',         // rustic 1/4"
    additionals: ['none', 'none'],
  },
};

// ============================================================================
// BUILD PICTOREM PREORDER CODE
// ============================================================================

function buildPreorderCode(material, printWidth, printHeight) {
  const mapping = MATERIAL_MAP[material];
  if (!mapping) {
    throw new Error(`Unknown material: ${material}`);
  }

  // Determine orientation
  const orientation = printWidth >= printHeight ? 'horizontal' : 'vertical';

  // Format: numCopies|material|type|orientation|width|height|additional|...
  const parts = [
    '1',                    // numCopies
    mapping.material,       // material
    mapping.type,           // type
    orientation,            // orientation
    String(printWidth),     // width in inches
    String(printHeight),    // height in inches
    ...mapping.additionals, // finish, wrap, thickness, frame options
  ];

  return parts.join('|');
}

// ============================================================================
// PICTOREM API CALLS
// ============================================================================

const PICTOREM_BASE = 'https://www.pictorem.com/artflow';

async function pictoremRequest(endpoint, apiKey, body) {
  const response = await fetch(`${PICTOREM_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'artFlowKey': apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, status: response.status };
  }
}

async function validatePreorder(apiKey, preorderCode) {
  return pictoremRequest('validatepreorder', apiKey, {
    preOrderCode: preorderCode,
  });
}

async function getPrice(apiKey, preorderCode) {
  return pictoremRequest('getprice', apiKey, {
    preOrderCode: preorderCode,
  });
}

async function sendOrder(apiKey, orderData) {
  return pictoremRequest('sendorder', apiKey, orderData);
}

// ============================================================================
// STRIPE SESSION RETRIEVAL
// ============================================================================

async function getStripeSession(sessionId, stripeKey) {
  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=customer_details&expand[]=line_items&expand[]=shipping_details`,
    {
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
      },
    }
  );
  return response.json();
}

// ============================================================================
// WEBHOOK SIGNATURE VERIFICATION
// ============================================================================

async function verifyWebhookSignature(payload, sigHeader, secret) {
  if (!secret) return true; // Skip verification if no secret configured

  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key] = value;
    return acc;
  }, {});

  const timestamp = parts['t'];
  const signature = parts['v1'];

  if (!timestamp || !signature) return false;

  // Check timestamp freshness (5 min tolerance)
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (age > 300) return false;

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expected = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return expected === signature;
}

// ============================================================================
// MAIN WEBHOOK HANDLER
// ============================================================================

export async function onRequestPost(context) {
  const { request, env } = context;

  const STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET || '';
  const PICTOREM_API_KEY = env.PICTOREM_API_KEY || 'archive-35';

  try {
    // Read raw body for signature verification
    const rawBody = await request.text();

    // Verify webhook signature
    const sigHeader = request.headers.get('stripe-signature') || '';
    if (STRIPE_WEBHOOK_SECRET) {
      const valid = await verifyWebhookSignature(rawBody, sigHeader, STRIPE_WEBHOOK_SECRET);
      if (!valid) {
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const event = JSON.parse(rawBody);

    // Only handle checkout.session.completed
    if (event.type !== 'checkout.session.completed') {
      return new Response(JSON.stringify({ received: true, skipped: event.type }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const session = event.data.object;
    const metadata = session.metadata || {};

    // Extract order info from session metadata
    const photoId = metadata.photoId;
    const material = metadata.material;
    const printWidth = parseInt(metadata.printWidth);
    const printHeight = parseInt(metadata.printHeight);

    if (!photoId || !material || !printWidth || !printHeight) {
      console.error('Missing order metadata:', metadata);
      return new Response(JSON.stringify({ error: 'Missing order metadata' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get full session details (shipping address, customer info)
    const fullSession = await getStripeSession(session.id, STRIPE_SECRET_KEY);
    const shipping = fullSession.shipping_details || fullSession.customer_details || {};
    const address = shipping.address || {};
    const customerName = shipping.name || fullSession.customer_details?.name || '';
    const customerEmail = fullSession.customer_details?.email || '';

    // Split name into first/last
    const nameParts = customerName.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Build Pictorem preorder code
    const preorderCode = buildPreorderCode(material, printWidth, printHeight);
    console.log('Pictorem preorder code:', preorderCode);

    // Step 1: Validate the preorder
    const validation = await validatePreorder(PICTOREM_API_KEY, preorderCode);
    console.log('Pictorem validation:', JSON.stringify(validation));

    if (validation.error || validation.valid === false) {
      console.error('Pictorem validation failed:', validation);
      // Don't fail the webhook — Stripe payment already succeeded
      // Flag for manual review
      return new Response(JSON.stringify({
        received: true,
        warning: 'Pictorem validation failed — needs manual fulfillment',
        validation,
        preorderCode,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Step 2: Get Pictorem price (for logging/verification)
    const priceResult = await getPrice(PICTOREM_API_KEY, preorderCode);
    console.log('Pictorem price:', JSON.stringify(priceResult));

    // Step 3: Build image URL
    // Use the web version for now (2000px). For higher res, originals need cloud hosting.
    const collection = photoId.split('-')[0] === 'nz' ? 'new-zealand' : 'grand-teton';
    const filename = metadata.photoTitle ? metadata.photoTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-') : photoId;
    // Construct the URL from the website's image path
    const imageUrl = `https://archive-35.com/images/${collection}/${photoId}-full.jpg`;

    // Step 4: Submit order to Pictorem
    const orderPayload = {
      'orderList[0][preOrderCode]': preorderCode,
      'orderList[0][fileurl]': imageUrl,
      'orderList[0][clientRef]': `stripe_${session.id}`,
      'delivery[firstname]': firstName,
      'delivery[lastname]': lastName,
      'delivery[address1]': address.line1 || '',
      'delivery[address2]': address.line2 || '',
      'delivery[city]': address.city || '',
      'delivery[province]': address.state || '',
      'delivery[country]': address.country || 'US',
      'delivery[cp]': address.postal_code || '',
      'delivery[email]': customerEmail,
      'delivery[phone]': '',
    };

    console.log('Submitting Pictorem order:', JSON.stringify(orderPayload));
    const orderResult = await sendOrder(PICTOREM_API_KEY, orderPayload);
    console.log('Pictorem order result:', JSON.stringify(orderResult));

    return new Response(JSON.stringify({
      received: true,
      fulfilled: true,
      preorderCode,
      pictoremOrder: orderResult,
      stripeSessionId: session.id,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Webhook handler error:', err);
    // Always return 200 to Stripe to prevent retries on our errors
    return new Response(JSON.stringify({
      received: true,
      error: err.message,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, stripe-signature',
    },
  });
}
