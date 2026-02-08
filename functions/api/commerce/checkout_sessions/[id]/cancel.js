/**
 * Archive-35 — ACP Cancel Checkout Session
 *
 * POST /api/commerce/checkout_sessions/{id}/cancel
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

  return new Response(JSON.stringify({
    id: sessionId,
    status: 'canceled',
    messages: [
      { type: 'info', text: 'Checkout session canceled successfully.' }
    ]
  }, null, 2), { status: 200, headers });
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
