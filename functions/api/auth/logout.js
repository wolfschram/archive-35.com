/**
 * ARCHIVE-35 Logout
 * Cloudflare Pages Function
 *
 * POST /api/auth/logout
 * Clears the session cookie and removes session from KV.
 *
 * Required KV bindings:
 *   AUTH_SESSIONS
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // Parse session cookie
    const cookieHeader = request.headers.get('Cookie') || '';
    const sessionToken = parseCookie(cookieHeader, 'a35_session');

    // Delete session from KV if it exists
    if (sessionToken && env.AUTH_SESSIONS) {
      await env.AUTH_SESSIONS.delete(sessionToken);
    }

    // Clear cookie and redirect to home
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/',
        'Set-Cookie': 'a35_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0',
      },
    });

  } catch (err) {
    console.error('Logout error:', err);
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/',
        'Set-Cookie': 'a35_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0',
      },
    });
  }
}

// Also support GET for simple link-based logout
export async function onRequestGet(context) {
  return onRequestPost(context);
}

function parseCookie(cookieHeader, name) {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}
