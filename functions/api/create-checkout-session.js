/**
 * ARCHIVE-35 Stripe Checkout Session Creator
 * Cloudflare Pages Function
 *
 * POST /api/create-checkout-session
 * Creates a Stripe Checkout Session and returns the session ID.
 * Stores Pictorem fulfillment metadata in session metadata.
 *
 * Required Cloudflare Pages env var: STRIPE_SECRET_KEY
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
    const STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;
    if (!STRIPE_SECRET_KEY) {
      return new Response(
        JSON.stringify({ error: 'Stripe not configured. Contact support.' }),
        { status: 500, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const { lineItems, successUrl, cancelUrl, pictorem } = body;

    if (!lineItems || !lineItems.length) {
      return new Response(
        JSON.stringify({ error: 'No line items provided' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const item = lineItems[0];
    const origin = new URL(request.url).origin;

    // Build Stripe API params (form-encoded)
    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', successUrl || `${origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url', cancelUrl || `${origin}/gallery.html`);

    // Line item
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][product_data][name]', item.price_data.product_data.name);
    params.append('line_items[0][price_data][product_data][description]', item.price_data.product_data.description || '');
    params.append('line_items[0][price_data][unit_amount]', item.price_data.unit_amount.toString());
    params.append('line_items[0][quantity]', '1');

    // Product metadata (for Pictorem fulfillment)
    if (item.price_data.product_data.metadata) {
      const meta = item.price_data.product_data.metadata;
      Object.entries(meta).forEach(([key, value]) => {
        params.append(`line_items[0][price_data][product_data][metadata][${key}]`, value);
      });
    }

    // Session-level metadata for Pictorem order processing
    if (pictorem) {
      params.append('metadata[photoId]', pictorem.photoId || '');
      params.append('metadata[photoTitle]', pictorem.photoTitle || '');
      params.append('metadata[material]', pictorem.material || '');
      params.append('metadata[printWidth]', String(pictorem.dimensions?.width || ''));
      params.append('metadata[printHeight]', String(pictorem.dimensions?.height || ''));
      params.append('metadata[originalWidth]', String(pictorem.dimensions?.originalWidth || ''));
      params.append('metadata[originalHeight]', String(pictorem.dimensions?.originalHeight || ''));
      params.append('metadata[dpi]', String(pictorem.dimensions?.dpi || ''));
    }

    // Collect shipping address (needed for Pictorem fulfillment)
    const allowedCountries = ['US', 'CA', 'GB', 'AU', 'DE', 'NZ', 'AT', 'CH', 'FR', 'IT', 'ES', 'NL', 'BE', 'IE', 'JP'];
    allowedCountries.forEach((country, i) => {
      params.append(`shipping_address_collection[allowed_countries][${i}]`, country);
    });

    // Customer email collection
    params.append('customer_creation', 'always');

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

    return new Response(
      JSON.stringify({ sessionId: session.id, url: session.url }),
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
