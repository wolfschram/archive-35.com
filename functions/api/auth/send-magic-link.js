/**
 * ARCHIVE-35 Magic Link Authentication
 * Cloudflare Pages Function
 *
 * POST /api/auth/send-magic-link
 * Sends a magic link email to the customer for passwordless login.
 *
 * Flow:
 * 1. Receive email address
 * 2. Look up or create Stripe customer
 * 3. Generate magic link token
 * 4. Store token in KV (15 min TTL)
 * 5. Send email via Resend
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY
 *   RESEND_API_KEY
 *
 * Required KV bindings:
 *   AUTH_MAGIC_LINKS
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
    const { email } = await request.json();

    if (!email || !email.includes('@')) {
      return new Response(
        JSON.stringify({ error: 'Please enter a valid email address.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Rate limiting: check if a magic link was recently sent (prevent spam)
    const recentKey = `rate:${normalizedEmail}`;
    const recentSend = await env.AUTH_MAGIC_LINKS.get(recentKey);
    if (recentSend) {
      return new Response(
        JSON.stringify({ success: true, message: 'If an account exists, a login link has been sent.' }),
        { status: 200, headers: corsHeaders }
      );
    }

    // Look up existing Stripe customer by email
    const STRIPE_KEY = env.STRIPE_SECRET_KEY;
    let stripeCustomerId = null;
    let customerName = '';

    if (STRIPE_KEY) {
      const searchParams = new URLSearchParams();
      searchParams.append('query', `email:"${normalizedEmail}"`);
      searchParams.append('limit', '1');

      const searchUrl = `https://api.stripe.com/v1/customers/search?${searchParams.toString()}`;
      const searchResponse = await fetch(searchUrl, {
        headers: { 'Authorization': `Bearer ${STRIPE_KEY}` },
      });

      if (searchResponse.ok) {
        const searchResult = await searchResponse.json();
        if (searchResult.data && searchResult.data.length > 0) {
          stripeCustomerId = searchResult.data[0].id;
          customerName = searchResult.data[0].name || '';
        }
      }
    }

    // If no Stripe customer found, create one
    if (!stripeCustomerId && STRIPE_KEY) {
      const createParams = new URLSearchParams();
      createParams.append('email', normalizedEmail);

      const createResp = await fetch('https://api.stripe.com/v1/customers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${STRIPE_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: createParams.toString(),
      });

      if (createResp.ok) {
        const newCustomer = await createResp.json();
        stripeCustomerId = newCustomer.id;
      }
    }

    // Generate magic link token
    const token = crypto.randomUUID();

    // Store in KV with 15 minute TTL
    await env.AUTH_MAGIC_LINKS.put(token, JSON.stringify({
      email: normalizedEmail,
      stripeCustomerId: stripeCustomerId || '',
      name: customerName,
      createdAt: Date.now(),
    }), { expirationTtl: 900 }); // 15 minutes

    // Set rate limit (60 second cooldown)
    await env.AUTH_MAGIC_LINKS.put(recentKey, '1', { expirationTtl: 60 });

    // Build magic link URL
    const siteUrl = 'https://archive-35.com';
    const magicLink = `${siteUrl}/api/auth/verify?token=${token}`;

    // Send email via Resend
    const RESEND_KEY = env.RESEND_API_KEY;
    if (RESEND_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Archive-35 <orders@archive-35.com>',
          to: [normalizedEmail],
          subject: 'Your Archive-35 Login Link',
          html: buildMagicLinkEmail(magicLink, customerName),
        }),
      });
    }

    // Always return success (don't reveal if email exists)
    return new Response(
      JSON.stringify({ success: true, message: 'If an account exists, a login link has been sent.' }),
      { status: 200, headers: corsHeaders }
    );

  } catch (err) {
    console.error('Magic link error:', err);
    return new Response(
      JSON.stringify({ error: 'Something went wrong. Please try again.' }),
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

/**
 * Build the magic link email HTML
 */
function buildMagicLinkEmail(magicLink, name) {
  const greeting = name ? `Hi ${name},` : 'Hi there,';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:30px;">
              <span style="font-size:24px;font-weight:200;letter-spacing:0.15em;color:#fcfcfc;">ARCHIVE</span><span style="font-size:24px;font-weight:200;color:#e8b84d;">-35</span>
            </td>
          </tr>

          <!-- Content Card -->
          <tr>
            <td style="background-color:#111111;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;">
              <p style="color:#fcfcfc;font-size:16px;margin:0 0 20px;">${greeting}</p>
              <p style="color:#a0a0a0;font-size:14px;line-height:1.6;margin:0 0 30px;">
                Click the button below to sign in to your Archive-35 account. This link expires in 15 minutes.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:10px 0 30px;">
                    <a href="${magicLink}" style="display:inline-block;background-color:#e8b84d;color:#0a0a0a;font-size:14px;font-weight:600;text-decoration:none;padding:14px 40px;border-radius:8px;letter-spacing:0.05em;">
                      Sign In to Archive-35
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color:#777777;font-size:12px;line-height:1.5;margin:0;">
                If you didn't request this link, you can safely ignore this email.
                <br><br>
                Can't click the button? Copy this link:<br>
                <a href="${magicLink}" style="color:#e8b84d;font-size:11px;word-break:break-all;">${magicLink}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:30px;">
              <p style="color:#777777;font-size:11px;margin:0;">
                &copy; 2026 Archive-35. Fine art photography prints.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
