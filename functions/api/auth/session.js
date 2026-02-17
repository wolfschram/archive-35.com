/**
 * ARCHIVE-35 Session Check
 * Cloudflare Pages Function
 *
 * GET /api/auth/session
 * Returns the current user's session status.
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
    // Parse session cookie
    const cookieHeader = request.headers.get('Cookie') || '';
    const sessionToken = parseCookie(cookieHeader, 'a35_session');

    if (!sessionToken) {
      return new Response(
        JSON.stringify({ loggedIn: false }),
        { status: 200, headers: corsHeaders }
      );
    }

    // Look up session in KV
    const sessionData = await env.AUTH_SESSIONS.get(sessionToken);
    if (!sessionData) {
      return new Response(
        JSON.stringify({ loggedIn: false }),
        { status: 200, headers: corsHeaders }
      );
    }

    const session = JSON.parse(sessionData);

    return new Response(
      JSON.stringify({
        loggedIn: true,
        email: session.email,
        name: session.name || '',
        stripeCustomerId: session.stripeCustomerId || '',
      }),
      { status: 200, headers: corsHeaders }
    );

  } catch (err) {
    console.error('Session check error:', err);
    return new Response(
      JSON.stringify({ loggedIn: false }),
      { status: 200, headers: corsHeaders }
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
