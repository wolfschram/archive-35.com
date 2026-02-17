/**
 * ARCHIVE-35 Order History
 * Cloudflare Pages Function
 *
 * GET /api/account/orders
 * Returns order history for the logged-in customer from Stripe.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY
 *
 * Required KV bindings:
 *   AUTH_SESSIONS
 */

export async function onRequestGet(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cookie',
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json',
  };

  try {
    // Authenticate via session cookie
    const cookieHeader = request.headers.get('Cookie') || '';
    const sessionToken = parseCookie(cookieHeader, 'a35_session');

    if (!sessionToken) {
      return new Response(
        JSON.stringify({ error: 'Not authenticated' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const sessionData = await env.AUTH_SESSIONS.get(sessionToken);
    if (!sessionData) {
      return new Response(
        JSON.stringify({ error: 'Session expired' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const session = JSON.parse(sessionData);
    const { stripeCustomerId } = session;

    if (!stripeCustomerId) {
      // Customer exists but has no Stripe record — return empty orders
      return new Response(
        JSON.stringify({ orders: [] }),
        { status: 200, headers: corsHeaders }
      );
    }

    const STRIPE_KEY = env.STRIPE_SECRET_KEY;
    if (!STRIPE_KEY) {
      return new Response(
        JSON.stringify({ error: 'Service unavailable' }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Fetch completed checkout sessions from Stripe
    const params = new URLSearchParams();
    params.append('customer', stripeCustomerId);
    params.append('status', 'complete');
    params.append('limit', '25');

    const sessionsResp = await fetch(
      `https://api.stripe.com/v1/checkout/sessions?${params.toString()}`,
      {
        headers: { 'Authorization': `Bearer ${STRIPE_KEY}` },
      }
    );

    if (!sessionsResp.ok) {
      console.error('Stripe sessions fetch error:', sessionsResp.status);
      return new Response(
        JSON.stringify({ orders: [] }),
        { status: 200, headers: corsHeaders }
      );
    }

    const sessionsData = await sessionsResp.json();

    // Transform into clean order objects
    const orders = sessionsData.data.map(session => {
      const meta = session.metadata || {};
      const orderType = meta.orderType || 'print';

      // Build item description
      let itemDescription = '';
      if (orderType === 'print' || orderType === 'mixed') {
        const title = meta.photoTitle || 'Fine Art Print';
        const material = meta.material || '';
        const width = meta.printWidth || '';
        const height = meta.printHeight || '';
        const size = width && height ? `${width}×${height}"` : '';
        itemDescription = [title, material, size].filter(Boolean).join(' — ');
      }
      if (orderType === 'license') {
        const title = meta.licensePhotoTitle || 'Image License';
        const tier = meta.licenseTierName || '';
        itemDescription = [title, tier].filter(Boolean).join(' — ');
      }
      if (orderType === 'mixed') {
        const licTitle = meta.licensePhotoTitle || '';
        if (licTitle) {
          itemDescription += ` + License: ${licTitle}`;
        }
      }

      return {
        id: session.id,
        date: new Date(session.created * 1000).toISOString(),
        amount: session.amount_total ? (session.amount_total / 100).toFixed(2) : '0.00',
        currency: session.currency || 'usd',
        status: session.payment_status || 'unknown',
        orderType,
        description: itemDescription || 'Archive-35 Order',
        photoId: meta.photoId || meta.licensePhotoId || '',
      };
    });

    return new Response(
      JSON.stringify({ orders }),
      { status: 200, headers: corsHeaders }
    );

  } catch (err) {
    console.error('Orders fetch error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to load orders' }),
      { status: 500, headers: corsHeaders }
    );
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Cookie',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}

function parseCookie(cookieHeader, name) {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}
