/**
 * Archive-35 — ACP Complete Checkout Session
 *
 * POST /api/commerce/checkout_sessions/{id}/complete
 *
 * Accepts Stripe SharedPaymentToken and completes the order.
 * Full implementation requires Stripe Connect and OpenAI merchant approval.
 */

export async function onRequestPost(context) {
  const sessionId = context.params.id;

  const headers = {
    'Content-Type': 'application/json',
    'API-Version': '2025-09-29',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, API-Version'
  };

  try {
    const body = await context.request.json();

    // In production: validate SharedPaymentToken with Stripe
    // const spt = body.shared_payment_token;
    // const paymentIntent = await stripe.paymentIntents.create({...});

    return new Response(JSON.stringify({
      id: sessionId,
      status: 'pending',
      order_id: 'ord_' + Date.now().toString(36),
      currency: 'usd',
      messages: [
        {
          type: 'info',
          text: 'Archive-35 checkout is in preview mode. Payment processing via Stripe SharedPaymentToken will be activated after OpenAI merchant approval. Apply at chatgpt.com/merchants/'
        }
      ]
    }, null, 2), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({
      error: { code: 'parse_error', message: err.message },
      messages: [{ type: 'error', text: `Invalid request: ${err.message}` }]
    }), { status: 400, headers });
  }
}

export async function onRequestOptions() {
  return new Response('', {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, API-Version',
      'Access-Control-Max-Age': '86400'
    }
  });
}
