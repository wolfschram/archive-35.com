/**
 * ARCHIVE-35 Magic Link Verification
 * Cloudflare Pages Function
 *
 * GET /api/auth/verify?token=xxx
 * Validates a magic link token, creates a session, and redirects to account page.
 *
 * Required KV bindings:
 *   AUTH_MAGIC_LINKS
 *   AUTH_SESSIONS
 */

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return redirectWithError('Invalid login link.');
    }

    // Look up magic link token
    const tokenData = await env.AUTH_MAGIC_LINKS.get(token);
    if (!tokenData) {
      return redirectWithError('This login link has expired or already been used. Please request a new one.');
    }

    const { email, stripeCustomerId, name } = JSON.parse(tokenData);

    // Delete magic link token (one-time use)
    await env.AUTH_MAGIC_LINKS.delete(token);

    // Create session token
    const sessionToken = crypto.randomUUID();
    const sessionData = {
      email,
      stripeCustomerId: stripeCustomerId || '',
      name: name || '',
      createdAt: Date.now(),
    };

    // Store session in KV with 30-day TTL
    await env.AUTH_SESSIONS.put(sessionToken, JSON.stringify(sessionData), {
      expirationTtl: 2592000, // 30 days
    });

    // Redirect to account page with session cookie
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/account.html',
        'Set-Cookie': `a35_session=${sessionToken}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000`,
      },
    });

  } catch (err) {
    console.error('Verify error:', err);
    return redirectWithError('Something went wrong. Please try again.');
  }
}

function redirectWithError(message) {
  const encoded = encodeURIComponent(message);
  return new Response(null, {
    status: 302,
    headers: {
      'Location': `/login.html?error=${encoded}`,
    },
  });
}
