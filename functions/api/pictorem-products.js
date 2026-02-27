/**
 * ARCHIVE-35 Pictorem Product List Proxy
 * Cloudflare Pages Function (v2)
 *
 * POST /api/pictorem-products
 *
 * Proxies requests to Pictorem's buildproductlist API endpoint.
 * Needed because Pictorem's API doesn't support CORS (server-to-server only).
 * Used by the product selector to discover available frame mouldings.
 *
 * Also supports validatepreorder and getprice for client-side validation.
 *
 * Required Cloudflare env vars:
 *   PICTOREM_API_KEY
 */

const PICTOREM_BASE = 'https://www.pictorem.com/artflow/0.1';

async function pictoremRequest(endpoint, apiKey, body) {
  const response = await fetch(`${PICTOREM_BASE}/${endpoint}/`, {
    method: 'POST',
    headers: {
      'artFlowKey': apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });

  const text = await response.text();
  try {
    return { data: JSON.parse(text), httpStatus: response.status };
  } catch {
    return { raw: text.substring(0, 500), httpStatus: response.status };
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const PICTOREM_API_KEY = env.PICTOREM_API_KEY || 'archive-35';
    if (!PICTOREM_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Pictorem API not configured' }),
        { status: 500, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const { action, preordercode } = body;

    if (!preordercode) {
      return new Response(
        JSON.stringify({ error: 'preordercode is required' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Whitelist allowed actions to prevent API abuse
    const allowedActions = ['buildproductlist', 'validatepreorder', 'getprice'];
    if (!action || !allowedActions.includes(action)) {
      return new Response(
        JSON.stringify({ error: `Invalid action. Allowed: ${allowedActions.join(', ')}` }),
        { status: 400, headers: corsHeaders }
      );
    }

    const result = await pictoremRequest(action, PICTOREM_API_KEY, {
      preordercode: preordercode,
    });

    // Include debug info (key length only, not the key itself)
    result._debug = {
      keyLength: PICTOREM_API_KEY.length,
      keyPrefix: PICTOREM_API_KEY.substring(0, 4),
      url: `${PICTOREM_BASE}/${action}/`,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error('Pictorem proxy error:', err);
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
