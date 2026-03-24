/**
 * ARCHIVE-35 Cart Event Logger
 * Cloudflare Pages Function
 *
 * POST /api/cart-event
 * Forwards cart activity events (add, remove, clear, abandoned) to
 * Google Sheets via GOOGLE_SHEET_WEBHOOK_URL for Wolf's visibility.
 *
 * Non-blocking from the client side — fire and forget.
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const data = await request.json();

    // Validate event type
    const validEvents = ['cart_add', 'cart_remove', 'cart_clear', 'cart_abandoned'];
    if (!data.eventType || !validEvents.includes(data.eventType)) {
      return new Response(
        JSON.stringify({ error: 'Invalid event type' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Forward to Google Sheets webhook
    const webhookUrl = env.GOOGLE_SHEET_WEBHOOK_URL;
    if (webhookUrl) {
      const payload = {
        orderType: data.eventType,
        timestamp: data.timestamp || new Date().toISOString(),
        sessionId: data.sessionId || '',
        customerName: data.userName || '',
        customerEmail: data.userEmail || '',
        photoTitle: data.photoTitle || '',
        photoId: data.photoId || '',
        photoFilename: data.photoFilename || '',
        collection: data.collection || '',
        material: data.material || '',
        size: data.size || '',
        options: data.options || '',
        scene: data.scene || '',
        zone: data.zone || '',
        price: data.price || '',
        cartTotal: data.cartTotal || '',
        cartCount: data.cartCount || '',
        pageUrl: data.pageUrl || '',
      };

      // Fire and forget — don't block response on webhook
      context.waitUntil(
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(err => {
          console.error('Google Sheets webhook failed:', err.message);
        })
      );
    } else {
      console.warn('GOOGLE_SHEET_WEBHOOK_URL not configured — cart event not forwarded');
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: corsHeaders }
    );

  } catch (err) {
    console.error('Cart event error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: corsHeaders }
    );
  }
}

// CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
