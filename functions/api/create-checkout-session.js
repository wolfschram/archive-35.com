/**
 * ARCHIVE-35 Stripe Checkout Session Creator
 * Cloudflare Pages Function
 *
 * POST /api/create-checkout-session
 * Creates a Stripe Checkout Session and returns the session ID.
 * Stores Pictorem fulfillment metadata in session metadata.
 *
 * Supports test mode: when testMode=true, uses STRIPE_TEST_SECRET_KEY
 * Required Cloudflare Pages env vars:
 *   - STRIPE_SECRET_KEY (live mode)
 *   - STRIPE_TEST_SECRET_KEY (test mode)
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const body = await request.json();
    const { lineItems, successUrl, cancelUrl, returnUrl, uiMode, pictorem, pictoremItems, license, testMode, stripeCustomerId, customerEmail } = body;

    // Select appropriate Stripe key based on test mode flag
    const isTestMode = testMode === true;
    const STRIPE_SECRET_KEY = isTestMode
      ? (env.STRIPE_TEST_SECRET_KEY || env.STRIPE_SECRET_KEY)
      : env.STRIPE_SECRET_KEY;

    if (!STRIPE_SECRET_KEY) {
      return new Response(
        JSON.stringify({ error: 'Stripe not configured. Contact support.' }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Validate key matches requested mode
    const keyIsTest = STRIPE_SECRET_KEY.startsWith('sk_test_');
    if (isTestMode && !keyIsTest) {
      console.warn('Test mode requested but no test secret key configured — falling back to live key');
    }

    if (!lineItems || !lineItems.length) {
      return new Response(
        JSON.stringify({ error: 'No line items provided' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // ================================================================
    // PRE-FLIGHT CHECK: Verify R2 originals exist BEFORE creating
    // the Stripe session. This prevents charging customers for items
    // that cannot be fulfilled (prints) or delivered (licenses).
    // For mixed orders, check BOTH print and license originals.
    // SKIP in test mode — test items may not have R2 originals.
    // See: Pipeline Audit Risk A — "Too Late" validation fix.
    // ================================================================
    const R2_BUCKET = env.ORIGINALS;
    if (R2_BUCKET && !isTestMode) {
      // Build list of R2 keys to verify
      const r2Checks = [];

      // Check ALL print items (multi-item array or single pictorem object)
      const allPrintChecks = pictoremItems && pictoremItems.length > 0
        ? pictoremItems
        : pictorem ? [pictorem] : [];
      for (const printItem of allPrintChecks) {
        const fn = printItem.photoFilename || printItem.photoId || '';
        const col = printItem.collection || '';
        if (fn) {
          let key = col ? `${col}/${fn}` : fn;
          if (!key.match(/\.(jpg|jpeg|png|tiff?)$/i)) key += '.jpg';
          r2Checks.push({ key, type: 'print' });
        }
      }

      if (license) {
        const fn = license.photoFilename || license.photoId || '';
        const col = license.collection || '';
        if (fn) {
          // Prefer collection-based key (single source of truth), fall back to originals/ prefix
          let key = col && col !== 'licensing' ? `${col}/${fn}` : `originals/${fn}`;
          if (!key.match(/\.(jpg|jpeg|png|tiff?)$/i)) key += '.jpg';
          r2Checks.push({ key, type: 'license' });
        }
      }

      for (const check of r2Checks) {
        try {
          const headResult = await R2_BUCKET.head(check.key);
          if (!headResult) {
            console.error(`PRE-FLIGHT BLOCK: R2 original missing (${check.type}): ${check.key}`);
            return new Response(
              JSON.stringify({
                error: 'This product is temporarily unavailable. Please try again later or contact us.',
                detail: `Original image not found in storage (${check.type})`,
                missingKey: check.key,
              }),
              { status: 400, headers: corsHeaders }
            );
          }
          console.log(`PRE-FLIGHT OK: R2 original verified (${check.type}): ${check.key} (${headResult.size} bytes)`);
        } catch (r2Err) {
          // R2 check failed but don't block if it's a transient error
          console.warn(`PRE-FLIGHT WARNING: R2 check failed for ${check.type} (${r2Err.message}) — allowing checkout to proceed`);
        }
      }
    }

    const origin = new URL(request.url).origin;

    // Build Stripe API params (form-encoded)
    const isEmbedded = uiMode === 'embedded';
    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('allow_promotion_codes', 'true');

    // Automatic sales tax calculation via Stripe Tax
    // Requires: Stripe Tax enabled + tax registrations configured in Stripe Dashboard
    // (Settings → Tax → Add registration → at minimum California)
    // Tax is calculated based on shipping address (prints) or billing address (licenses)
    params.append('automatic_tax[enabled]', 'true');

    if (isEmbedded) {
      params.append('ui_mode', 'embedded');
      params.append('return_url', returnUrl || `${origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`);
    } else {
      params.append('success_url', successUrl || `${origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`);
      params.append('cancel_url', cancelUrl || `${origin}/gallery.html`);
    }

    // Support multiple line items
    lineItems.forEach((item, i) => {
      params.append(`line_items[${i}][price_data][currency]`, 'usd');
      params.append(`line_items[${i}][price_data][product_data][name]`, item.price_data.product_data.name);
      const desc = item.price_data.product_data.description;
      if (desc) {
        params.append(`line_items[${i}][price_data][product_data][description]`, desc);
      }
      params.append(`line_items[${i}][price_data][unit_amount]`, item.price_data.unit_amount.toString());
      params.append(`line_items[${i}][price_data][tax_behavior]`, 'exclusive'); // tax added on top of price
      params.append(`line_items[${i}][quantity]`, '1');

      // Per-item metadata (for Pictorem fulfillment)
      if (item.price_data.product_data.metadata) {
        const meta = item.price_data.product_data.metadata;
        Object.entries(meta).forEach(([key, value]) => {
          params.append(`line_items[${i}][price_data][product_data][metadata][${key}]`, value);
        });
      }
    });

    // Determine order type: print, license, or mixed
    const hasPrint = !!pictorem;
    const hasLicense = !!license;
    const orderType = hasPrint && hasLicense ? 'mixed' : hasLicense ? 'license' : 'print';
    params.append('metadata[orderType]', orderType);

    // PRINT metadata — physical fulfillment via Pictorem
    // Support multi-item: pictoremItems[] array (new), or single pictorem object (backward compat)
    const allPrintItems = pictoremItems && pictoremItems.length > 0
      ? pictoremItems
      : pictorem ? [pictorem] : [];

    if (allPrintItems.length > 0) {
      params.append('metadata[printItemCount]', String(allPrintItems.length));

      allPrintItems.forEach((item, idx) => {
        // Each item stored as compact JSON — Stripe allows up to 500 chars per value
        const itemData = JSON.stringify({
          photoId: item.photoId || '',
          photoTitle: item.photoTitle || '',
          photoFilename: item.photoFilename || '',
          collection: item.collection || '',
          material: item.material || '',
          w: item.dimensions?.width || '',
          h: item.dimensions?.height || '',
          ow: item.dimensions?.originalWidth || '',
          oh: item.dimensions?.originalHeight || '',
          dpi: item.dimensions?.dpi || '',
          subType: item.subType || '',
          mounting: item.mounting || '',
          finish: item.finish || '',
          edge: item.edge || '',
          frame: item.frame || '',
          mat: item.mat || '',
          matW: item.matWidth || '',
        });
        params.append(`metadata[printItem_${idx}]`, itemData);
      });

      // Backward compat: also store first item as flat keys (for older webhook versions during rollout)
      const first = allPrintItems[0];
      params.append('metadata[photoId]', first.photoId || '');
      params.append('metadata[photoTitle]', first.photoTitle || '');
      params.append('metadata[photoFilename]', first.photoFilename || '');
      params.append('metadata[collection]', first.collection || '');
      params.append('metadata[material]', first.material || '');
      params.append('metadata[printWidth]', String(first.dimensions?.width || ''));
      params.append('metadata[printHeight]', String(first.dimensions?.height || ''));
      params.append('metadata[originalWidth]', String(first.dimensions?.originalWidth || ''));
      params.append('metadata[originalHeight]', String(first.dimensions?.originalHeight || ''));
      params.append('metadata[dpi]', String(first.dimensions?.dpi || ''));
      params.append('metadata[subType]', first.subType || '');
      params.append('metadata[mounting]', first.mounting || '');
      params.append('metadata[finish]', first.finish || '');
      params.append('metadata[edge]', first.edge || '');
      params.append('metadata[frame]', first.frame || '');
      params.append('metadata[mat]', first.mat || '');
      params.append('metadata[matWidth]', String(first.matWidth || ''));
    }

    if (license) {
      // LICENSE metadata — digital delivery
      // Prefix with 'license_' to avoid collision with print metadata
      params.append('metadata[licensePhotoId]', license.photoId || '');
      params.append('metadata[licensePhotoTitle]', license.photoTitle || '');
      params.append('metadata[licensePhotoFilename]', license.photoFilename || '');
      params.append('metadata[licenseCollection]', license.collection || '');
      params.append('metadata[licenseTier]', license.tier || '');
      params.append('metadata[licenseTierName]', license.tierName || '');
      params.append('metadata[licenseFormat]', license.format || 'jpeg');
      params.append('metadata[licenseClassification]', license.classification || '');
      params.append('metadata[resolution]', license.resolution || '');
    }

    if (!pictorem && !license) {
      console.warn('Checkout session: NO pictorem or license metadata provided');
    }
    // Store item count for webhook multi-item handling
    params.append('metadata[itemCount]', lineItems.length.toString());

    // Collect shipping address when prints are involved (needed for fulfillment)
    if (hasPrint) {
      const allowedCountries = ['US', 'CA', 'GB', 'AU', 'DE', 'NZ', 'AT', 'CH', 'FR', 'IT', 'ES', 'NL', 'BE', 'IE', 'JP'];
      allowedCountries.forEach((country, i) => {
        params.append(`shipping_address_collection[allowed_countries][${i}]`, country);
      });
    }

    // Customer: use existing Stripe customer if logged in, otherwise create new
    if (stripeCustomerId) {
      params.append('customer', stripeCustomerId);
    } else {
      params.append('customer_creation', 'always');
      // Pre-fill email from Riedel portal or auth
      if (customerEmail) {
        params.append('customer_email', customerEmail);
      }
    }

    // Create Stripe Checkout Session
    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await stripeResponse.json();

    if (session.error) {
      console.error('Stripe error:', session.error);
      return new Response(
        JSON.stringify({ error: session.error.message }),
        { status: 400, headers: corsHeaders }
      );
    }

    const responsePayload = {
      sessionId: session.id,
      url: session.url,
      mode: keyIsTest ? 'test' : 'live',
      livemode: session.livemode
    };

    // For embedded mode, include client_secret for stripe.initEmbeddedCheckout()
    if (isEmbedded && session.client_secret) {
      responsePayload.clientSecret = session.client_secret;
    }

    return new Response(
      JSON.stringify(responsePayload),
      { status: 200, headers: corsHeaders }
    );

  } catch (err) {
    console.error('Checkout error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: corsHeaders }
    );
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
