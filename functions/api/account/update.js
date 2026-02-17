/**
 * ARCHIVE-35 Account Profile Update
 * Cloudflare Pages Function
 *
 * POST /api/account/update
 * Updates the user's name (and syncs to Stripe).
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY
 *
 * Required KV bindings:
 *   AUTH_SESSIONS
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    const sessionRaw = await env.AUTH_SESSIONS.get(sessionToken);
    if (!sessionRaw) {
      return new Response(
        JSON.stringify({ error: 'Session expired' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const session = JSON.parse(sessionRaw);
    const { name } = await request.json();

    if (name !== undefined) {
      const trimmedName = (name || '').trim();
      session.name = trimmedName;

      // Update Stripe customer name if we have a customer ID
      if (session.stripeCustomerId && env.STRIPE_SECRET_KEY) {
        const updateParams = new URLSearchParams();
        updateParams.append('name', trimmedName);
        await fetch(`https://api.stripe.com/v1/customers/${session.stripeCustomerId}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: updateParams.toString(),
        });
      }
    }

    // Save updated session back to KV (preserve TTL by re-setting)
    await env.AUTH_SESSIONS.put(sessionToken, JSON.stringify(session), {
      expirationTtl: 2592000, // 30 days
    });

    return new Response(
      JSON.stringify({
        success: true,
        name: session.name,
        email: session.email,
      }),
      { status: 200, headers: corsHeaders }
    );

  } catch (err) {
    console.error('Account update error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to update profile' }),
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
      'Access-Control-Allow-Headers': 'Content-Type, Cookie',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}

function parseCookie(cookieHeader, name) {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}
