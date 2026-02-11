/**
 * ARCHIVE-35 Stripe Webhook → Pictorem Auto-Fulfillment + Email Confirmations
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
 * 7. Sends order confirmation email to customer (via Resend)
 * 8. Sends order notification email to Wolf (via Resend)
 *
 * Required Cloudflare env vars:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   PICTOREM_API_KEY (default: "archive-35")
 *   RESEND_API_KEY
 *   ORIGINAL_SIGNING_SECRET (shared HMAC secret for signed original URLs)
 *
 * Required Cloudflare bindings:
 *   ORIGINALS (R2 bucket: archive-35-originals) — high-res originals
 */

// ============================================================================
// MATERIAL MAPPING: Website → Pictorem preordercode
// ============================================================================

const MATERIAL_MAP = {
  canvas: {
    material: 'canvas',
    type: 'stretched',
    displayName: 'Canvas',
    additionals: ['semigloss', 'mirrorimage', 'c15', 'none', 'none'],
  },
  metal: {
    material: 'metal',
    type: 'al',
    displayName: 'Metal',
    additionals: ['none', 'none'],
  },
  acrylic: {
    material: 'acrylic',
    type: 'ac220',
    displayName: 'Acrylic',
    additionals: ['none', 'none'],
  },
  paper: {
    material: 'paper',
    type: 'art',
    displayName: 'Fine Art Paper',
    additionals: ['none', 'none'],
  },
  wood: {
    material: 'wood',
    type: 'ru14',
    displayName: 'Wood',
    additionals: ['none', 'none'],
  },
};

// ============================================================================
// COLLECTION MAPPING: Photo ID prefix → collection slug
// ============================================================================

function getCollectionFromPhotoId(photoId) {
  if (!photoId) return 'grand-teton';
  const prefix = photoId.split('-')[0];
  const map = {
    'a': 'africa',
    'gt': 'grand-teton',
    'nz': 'new-zealand',
  };
  return map[prefix] || 'grand-teton';
}

// ============================================================================
// BUILD PICTOREM PREORDER CODE
// ============================================================================

function buildPreorderCode(material, printWidth, printHeight) {
  const mapping = MATERIAL_MAP[material];
  if (!mapping) {
    throw new Error(`Unknown material: ${material}`);
  }

  const orientation = printWidth >= printHeight ? 'horizontal' : 'vertical';

  const parts = [
    '1',
    mapping.material,
    mapping.type,
    orientation,
    String(printWidth),
    String(printHeight),
    ...mapping.additionals,
  ];

  return parts.join('|');
}

// ============================================================================
// R2 ORIGINAL IMAGE HELPERS
// ============================================================================

/**
 * Generate an HMAC-signed URL for the serve-original endpoint.
 * Pictorem downloads from this URL → our proxy fetches from R2.
 * Default expiry: 24 hours (plenty for Pictorem to download).
 */
async function generateSignedOriginalUrl(key, secret, expiryMs = 24 * 60 * 60 * 1000) {
  const expiry = String(Date.now() + expiryMs);
  const message = `${key}:${expiry}`;
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  const signature = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return `https://archive-35.com/api/serve-original?key=${encodeURIComponent(key)}&exp=${expiry}&sig=${signature}`;
}

/**
 * Try to get the high-res original URL from R2.
 * Falls back to web-optimized if R2 is unavailable or original not uploaded yet.
 */
async function getOriginalImageUrl(env, collection, photoFilename) {
  const R2_BUCKET = env.ORIGINALS;
  const SIGNING_SECRET = env.ORIGINAL_SIGNING_SECRET;
  const webFallbackUrl = `https://archive-35.com/images/${collection}/${photoFilename}-full.jpg`;

  // If R2 not configured, fall back to web-optimized
  if (!R2_BUCKET || !SIGNING_SECRET) {
    console.error('⚠️ CRITICAL: R2 or signing secret not configured — using web-optimized image for Pictorem. Print quality will be POOR.');
    return { url: webFallbackUrl, source: 'web-optimized', warning: 'R2 storage not configured. Pictorem will receive web-optimized (low-res) image. Print quality will be unacceptable for large formats.' };
  }

  // Check if original exists in R2
  // Key convention: {collection}/{photoFilename}.jpg (e.g. "grand-teton/gt-001.jpg")
  const r2Key = `${collection}/${photoFilename}.jpg`;

  try {
    const headResult = await R2_BUCKET.head(r2Key);
    if (headResult) {
      // Original exists — generate signed URL
      const signedUrl = await generateSignedOriginalUrl(r2Key, SIGNING_SECRET);
      console.log(`R2 original found: ${r2Key} (${headResult.size} bytes) → signed URL generated`);
      return { url: signedUrl, source: 'r2-original', size: headResult.size };
    }
  } catch (err) {
    console.error('R2 head check failed:', err.message);
  }

  // Original not in R2 — this is a CRITICAL issue for print quality
  console.error(`⚠️ CRITICAL: Original not in R2 (${r2Key}) — falling back to web-optimized. Print quality will be POOR.`);
  return { url: webFallbackUrl, source: 'web-optimized-fallback', warning: `High-res original "${r2Key}" not found in R2 bucket. Pictorem will receive web-optimized (2000px, 85% JPEG) image. At large print sizes this produces ~56 DPI — unacceptable for fine art.` };
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
  if (!secret) return true;

  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key] = value;
    return acc;
  }, {});

  const timestamp = parts['t'];
  const signature = parts['v1'];

  if (!timestamp || !signature) return false;

  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (age > 300) return false;

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
// EMAIL TEMPLATES
// ============================================================================

function buildCustomerEmail(orderDetails) {
  const {
    photoTitle, materialName, sizeStr, price,
    imageUrl, customerName, orderRef, estimatedDelivery
  } = orderDetails;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#000;">
<tr><td align="center" style="padding:40px 20px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

<!-- Header -->
<tr><td style="padding:24px 0;text-align:center;border-bottom:1px solid #333;">
  <span style="font-size:28px;font-weight:100;letter-spacing:8px;color:#fff;">ARCHIVE</span><span style="font-size:28px;font-weight:100;letter-spacing:8px;color:#c4973b;">-35</span>
</td></tr>

<!-- Greeting -->
<tr><td style="padding:32px 0 16px;color:#fff;font-size:16px;">
  ${customerName ? `Dear ${customerName},` : 'Hello,'}
</td></tr>

<tr><td style="padding:0 0 24px;color:#ccc;font-size:15px;line-height:1.6;">
  Thank you for your order. Your fine art print is now in production with our printing partner.
</td></tr>

<!-- Product Image -->
<tr><td style="padding:0 0 24px;text-align:center;">
  <img src="${imageUrl}" alt="${photoTitle}" style="max-width:100%;height:auto;border:1px solid #333;" />
</td></tr>

<!-- Order Details -->
<tr><td style="padding:0 0 24px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #333;border-radius:8px;">
    <tr><td colspan="2" style="padding:16px 20px 8px;font-size:13px;color:#c4973b;text-transform:uppercase;letter-spacing:2px;font-weight:600;">
      Order Details
    </td></tr>
    <tr>
      <td style="padding:8px 20px;color:#999;font-size:14px;">Print</td>
      <td style="padding:8px 20px;color:#fff;font-size:14px;text-align:right;">${photoTitle}</td>
    </tr>
    <tr>
      <td style="padding:8px 20px;color:#999;font-size:14px;">Material</td>
      <td style="padding:8px 20px;color:#fff;font-size:14px;text-align:right;">${materialName}</td>
    </tr>
    <tr>
      <td style="padding:8px 20px;color:#999;font-size:14px;">Size</td>
      <td style="padding:8px 20px;color:#fff;font-size:14px;text-align:right;">${sizeStr}</td>
    </tr>
    <tr>
      <td style="padding:8px 20px 16px;color:#999;font-size:14px;border-top:1px solid #333;">Total</td>
      <td style="padding:8px 20px 16px;color:#c4973b;font-size:18px;font-weight:600;text-align:right;border-top:1px solid #333;">$${price}</td>
    </tr>
  </table>
</td></tr>

<!-- Timeline -->
<tr><td style="padding:0 0 24px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(196,151,59,0.05);border-left:3px solid #c4973b;border-radius:0 8px 8px 0;">
    <tr><td style="padding:16px 20px;color:#ccc;font-size:13px;line-height:1.8;">
      <strong style="color:#c4973b;">What happens next:</strong><br/>
      Your print enters production within 24 hours.<br/>
      Professional printing takes 5-7 business days.<br/>
      Shipping: Standard ground 5-9 business days (USA/Canada).<br/>
      <strong style="color:#fff;">Estimated delivery: ${estimatedDelivery}</strong>
    </td></tr>
  </table>
</td></tr>

<!-- Reference -->
<tr><td style="padding:0 0 32px;color:#666;font-size:12px;">
  Order reference: ${orderRef}
</td></tr>

<!-- Footer -->
<tr><td style="padding:24px 0;border-top:1px solid #333;text-align:center;">
  <span style="font-size:14px;font-weight:100;letter-spacing:4px;color:#666;">ARCHIVE</span><span style="font-size:14px;font-weight:100;letter-spacing:4px;color:#c4973b;">-35</span>
  <br/><span style="color:#666;font-size:12px;">Light. Place. Time.</span>
  <br/><br/>
  <a href="https://archive-35.com" style="color:#c4973b;font-size:12px;text-decoration:none;">archive-35.com</a>
  <span style="color:#333;font-size:12px;"> &middot; </span>
  <a href="mailto:hello@archive-35.com" style="color:#c4973b;font-size:12px;text-decoration:none;">hello@archive-35.com</a>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildWolfNotificationEmail(orderDetails) {
  const {
    photoId, photoTitle, materialName, material, sizeStr, price,
    imageUrl, pictoremImageUrl, imageSource, customerName, customerEmail, orderRef,
    shippingAddress, preorderCode, pictoremResult, wholesalePrice
  } = orderDetails;

  const addr = shippingAddress || {};

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:#111;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#ccc;">

<h2 style="color:#c4973b;margin:0 0 8px;">New Order</h2>
<p style="color:#666;font-size:13px;margin:0 0 24px;">Archive-35 &middot; ${new Date().toISOString().split('T')[0]}</p>

<table cellpadding="8" cellspacing="0" style="background:#1a1a1a;border:1px solid #333;border-radius:8px;width:100%;max-width:600px;font-size:14px;">
  <tr><td style="color:#999;">Customer</td><td style="color:#fff;"><strong>${customerName}</strong> &lt;${customerEmail}&gt;</td></tr>
  <tr><td style="color:#999;">Photo</td><td style="color:#fff;">${photoTitle} (${photoId})</td></tr>
  <tr><td style="color:#999;">Material</td><td style="color:#fff;">${materialName} (${material})</td></tr>
  <tr><td style="color:#999;">Size</td><td style="color:#fff;">${sizeStr}</td></tr>
  <tr><td style="color:#999;">Customer Paid</td><td style="color:#c4973b;font-weight:600;">$${price}</td></tr>
  ${wholesalePrice ? `<tr><td style="color:#999;">Pictorem Cost</td><td style="color:#fff;">$${wholesalePrice}</td></tr>` : ''}
  ${wholesalePrice && price ? `<tr><td style="color:#999;">Margin</td><td style="color:#4caf50;font-weight:600;">$${(price - wholesalePrice).toFixed(2)}</td></tr>` : ''}
  <tr><td colspan="2" style="border-top:1px solid #333;"></td></tr>
  <tr><td style="color:#999;">Ship To</td><td style="color:#fff;">${addr.line1 || ''}${addr.line2 ? ', ' + addr.line2 : ''}<br/>${addr.city || ''}, ${addr.state || ''} ${addr.postal_code || ''}<br/>${addr.country || ''}</td></tr>
  <tr><td colspan="2" style="border-top:1px solid #333;"></td></tr>
  <tr><td style="color:#999;">Image Source</td><td style="color:${imageSource === 'r2-original' ? '#4caf50' : '#f44336'};font-size:13px;font-weight:${imageSource === 'r2-original' ? 'normal' : 'bold'};">${imageSource === 'r2-original' ? 'R2 Original (high-res)' : '⚠️ WEB-OPTIMIZED FALLBACK — LOW RES'}</td></tr>
  ${imageSource !== 'r2-original' ? `<tr><td colspan="2" style="padding:12px 8px;background:#4a1010;border:2px solid #f44336;border-radius:4px;color:#ff8a80;font-size:13px;line-height:1.5;"><strong>⚠️ QUALITY ALERT:</strong> The high-res original was NOT found in R2 storage. Pictorem received a web-optimized image (2000px max, ~56 DPI at 36x24). This print quality is UNACCEPTABLE for fine art. Upload the original to R2 and contact Pictorem to replace the file before printing.</td></tr>` : ''}
  <tr><td style="color:#999;">Pictorem Code</td><td style="color:#fff;font-family:monospace;font-size:12px;">${preorderCode}</td></tr>
  <tr><td style="color:#999;">Pictorem Status</td><td style="color:#fff;">${pictoremResult ? JSON.stringify(pictoremResult).substring(0, 200) : 'N/A'}</td></tr>
  <tr><td style="color:#999;">Stripe Ref</td><td style="color:#fff;font-family:monospace;font-size:12px;">${orderRef}</td></tr>
</table>

<p style="margin:24px 0 0;"><img src="${imageUrl}" alt="${photoTitle}" style="max-width:400px;border:1px solid #333;" /></p>

</body>
</html>`;
}

// ============================================================================
// SEND EMAILS VIA RESEND
// ============================================================================

async function sendEmail(resendApiKey, { to, subject, html }) {
  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not set — skipping email to', to);
    return { skipped: true };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Archive-35 <orders@archive-35.com>',
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      console.error('Resend error:', JSON.stringify(result));
    }
    return result;
  } catch (err) {
    console.error('Email send failed:', err.message);
    return { error: err.message };
  }
}

// ============================================================================
// MAIN WEBHOOK HANDLER
// ============================================================================

export async function onRequestPost(context) {
  const { request, env } = context;

  const STRIPE_LIVE_SECRET_KEY = env.STRIPE_SECRET_KEY;
  const STRIPE_TEST_SECRET_KEY = env.STRIPE_TEST_SECRET_KEY || '';
  const STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET || '';
  const STRIPE_TEST_WEBHOOK_SECRET = env.STRIPE_TEST_WEBHOOK_SECRET || '';
  const PICTOREM_API_KEY = env.PICTOREM_API_KEY || 'archive-35';
  const RESEND_API_KEY = env.RESEND_API_KEY || '';
  const WOLF_EMAIL = env.WOLF_EMAIL || 'wolfbroadcast@gmail.com';

  try {
    // Read raw body for signature verification
    const rawBody = await request.text();

    // Verify webhook signature — try live secret first, then test secret
    const sigHeader = request.headers.get('stripe-signature') || '';
    if (STRIPE_WEBHOOK_SECRET || STRIPE_TEST_WEBHOOK_SECRET) {
      const liveValid = STRIPE_WEBHOOK_SECRET
        ? await verifyWebhookSignature(rawBody, sigHeader, STRIPE_WEBHOOK_SECRET)
        : false;
      const testValid = !liveValid && STRIPE_TEST_WEBHOOK_SECRET
        ? await verifyWebhookSignature(rawBody, sigHeader, STRIPE_TEST_WEBHOOK_SECRET)
        : false;

      if (!liveValid && !testValid) {
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

    // Detect test mode: Stripe test events have livemode=false
    const isTestMode = session.livemode === false || event.livemode === false;
    // Select the correct Stripe API key for fetching session details
    const STRIPE_SECRET_KEY = isTestMode && STRIPE_TEST_SECRET_KEY
      ? STRIPE_TEST_SECRET_KEY
      : STRIPE_LIVE_SECRET_KEY;
    if (isTestMode) {
      console.log('TEST MODE detected — using test key, Pictorem will be mocked');
    }

    // Extract order info from session metadata
    const photoId = metadata.photoId;
    const material = metadata.material;
    const printWidth = parseInt(metadata.printWidth);
    const printHeight = parseInt(metadata.printHeight);
    const photoTitle = metadata.photoTitle || photoId;

    if (!photoId || !material || !printWidth || !printHeight) {
      const missing = [];
      if (!photoId) missing.push('photoId');
      if (!material) missing.push('material');
      if (!printWidth) missing.push('printWidth');
      if (!printHeight) missing.push('printHeight');
      console.error('Missing order metadata fields:', missing.join(', '), '| Full metadata:', JSON.stringify(metadata));
      return new Response(JSON.stringify({
        error: 'Missing order metadata',
        missingFields: missing,
        receivedMetadata: Object.keys(metadata || {})
      }), {
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
    const amountPaid = fullSession.amount_total ? (fullSession.amount_total / 100).toFixed(2) : '0';

    // Split name into first/last
    const nameParts = customerName.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Build Pictorem preorder code
    const preorderCode = buildPreorderCode(material, printWidth, printHeight);
    console.log('Pictorem preorder code:', preorderCode);

    // Step 1: Validate the preorder
    let validation, wholesalePrice;

    if (isTestMode) {
      // MOCK: Skip real Pictorem calls in test mode
      validation = { valid: true, mock: true };
      wholesalePrice = '29.99';
      console.log('TEST: Mocked Pictorem validation (skipped real API)');
    } else {
      validation = await validatePreorder(PICTOREM_API_KEY, preorderCode);
      console.log('Pictorem validation:', JSON.stringify(validation));

      if (validation.error || validation.valid === false) {
        console.error('Pictorem validation failed:', validation);
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
      wholesalePrice = priceResult?.price || priceResult?.totalPrice || null;
    }

    // Step 3: Build image URLs
    const collection = getCollectionFromPhotoId(photoId);
    const photoFilename = metadata.photoFilename || photoId;

    // HIGH-RES for Pictorem: Try R2 original first, fall back to web-optimized
    const originalResult = await getOriginalImageUrl(env, collection, photoFilename);
    const pictoremImageUrl = originalResult.url;
    console.log(`Image for Pictorem: ${originalResult.source}${originalResult.size ? ` (${(originalResult.size / 1024 / 1024).toFixed(1)}MB)` : ''}`);

    // WEB-OPTIMIZED for emails: Always use the web version (smaller, loads fast in email)
    const emailImageUrl = `https://archive-35.com/images/${collection}/${photoFilename}-full.jpg`;

    // Step 4: Submit order to Pictorem
    const orderPayload = {
      'orderList[0][preOrderCode]': preorderCode,
      'orderList[0][fileurl]': pictoremImageUrl,
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

    let orderResult;
    if (isTestMode) {
      // MOCK: Don't submit real order to Pictorem in test mode
      orderResult = {
        mock: true,
        status: 'simulated',
        message: 'TEST MODE — no real Pictorem order created',
        orderId: `mock_${Date.now()}`,
      };
      console.log('TEST: Mocked Pictorem order (no real order placed)');
    } else {
      console.log('Submitting Pictorem order:', JSON.stringify(orderPayload));
      orderResult = await sendOrder(PICTOREM_API_KEY, orderPayload);
      console.log('Pictorem order result:', JSON.stringify(orderResult));
    }

    // ====================================================================
    // Step 5: Send confirmation emails
    // ====================================================================

    const materialDisplayName = MATERIAL_MAP[material]?.displayName || material;
    const sizeStr = `${printWidth}" x ${printHeight}"`;
    const orderRef = `stripe_${session.id}`;

    // Estimated delivery: 2-4 weeks from now
    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + 21);
    const estimatedDelivery = deliveryDate.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    });

    const orderDetails = {
      photoId,
      photoTitle,
      material,
      materialName: materialDisplayName,
      sizeStr,
      price: amountPaid,
      imageUrl: emailImageUrl,         // Web-optimized for email previews
      pictoremImageUrl,                // High-res URL sent to Pictorem
      imageSource: originalResult.source, // 'r2-original' or 'web-optimized-fallback'
      customerName,
      customerEmail,
      orderRef,
      estimatedDelivery,
      shippingAddress: address,
      preorderCode,
      pictoremResult: orderResult,
      wholesalePrice,
    };

    // Send customer confirmation email
    const customerEmailResult = await sendEmail(RESEND_API_KEY, {
      to: customerEmail,
      subject: `Your Archive-35 Print Order — ${photoTitle}`,
      html: buildCustomerEmail(orderDetails),
    });
    console.log('Customer email result:', JSON.stringify(customerEmailResult));

    // Send Wolf notification email
    const wolfEmailResult = await sendEmail(RESEND_API_KEY, {
      to: WOLF_EMAIL,
      subject: `${originalResult.source !== 'r2-original' ? '⚠️ LOW-RES ALERT — ' : ''}New Order: ${photoTitle} — ${materialDisplayName} ${sizeStr} — $${amountPaid}`,
      html: buildWolfNotificationEmail(orderDetails),
    });
    console.log('Wolf notification result:', JSON.stringify(wolfEmailResult));

    return new Response(JSON.stringify({
      received: true,
      fulfilled: true,
      testMode: isTestMode,
      preorderCode,
      imageSource: originalResult.source,
      pictoremOrder: orderResult,
      stripeSessionId: session.id,
      emailsSent: {
        customer: customerEmailResult?.id ? true : false,
        wolf: wolfEmailResult?.id ? true : false,
      },
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
