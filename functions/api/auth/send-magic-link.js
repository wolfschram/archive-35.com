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
    const { email, name } = await request.json();

    if (!email || !email.includes('@')) {
      return new Response(
        JSON.stringify({ error: 'Please enter a valid email address.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const providedName = (name || '').trim();

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
          // If user provided a name and Stripe has none, update Stripe
          if (providedName && !customerName) {
            customerName = providedName;
            const updateParams = new URLSearchParams();
            updateParams.append('name', providedName);
            await fetch(`https://api.stripe.com/v1/customers/${stripeCustomerId}`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${STRIPE_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: updateParams.toString(),
            });
          }
        }
      }
    }

    // Track if this is a brand new customer (for welcome email + sheet)
    let isNewCustomer = false;

    // If no Stripe customer found, create one
    if (!stripeCustomerId && STRIPE_KEY) {
      isNewCustomer = true;
      const createParams = new URLSearchParams();
      createParams.append('email', normalizedEmail);
      if (providedName) {
        createParams.append('name', providedName);
        customerName = providedName;
      }

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

    // Use provided name if we still don't have one
    if (providedName && !customerName) {
      customerName = providedName;
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

    // For new customers: send welcome email + notify Wolf + log to Google Sheet
    // CRITICAL: Use context.waitUntil() so Cloudflare keeps the Worker alive
    // until all background operations complete. Without this, fire-and-forget
    // fetch() calls can be killed when the Response is returned.
    if (isNewCustomer) {
      const RESEND_KEY2 = env.RESEND_API_KEY;
      const WOLF_BIZ = 'wolf@archive-35.com';
      const backgroundTasks = [];

      // Send welcome email from Wolf with BCC to Wolf
      if (RESEND_KEY2) {
        backgroundTasks.push(
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${RESEND_KEY2}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Wolf Schram <wolf@archive-35.com>',
              to: [normalizedEmail],
              bcc: [WOLF_BIZ],
              subject: 'Welcome to Archive-35',
              html: buildWelcomeEmail(customerName),
            }),
          }).catch(err => console.error('Welcome email error:', err))
        );
      }

      // Send signup notification to Wolf
      if (RESEND_KEY2) {
        backgroundTasks.push(
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${RESEND_KEY2}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Archive-35 <orders@archive-35.com>',
              to: [WOLF_BIZ],
              subject: `[New Signup] ${customerName || normalizedEmail}`,
              html: buildSignupNotificationEmail(customerName, normalizedEmail),
            }),
          }).catch(err => console.error('Signup notification error:', err))
        );
      }

      // Log new signup to Google Sheet
      const SHEET_URL = env.GOOGLE_SHEET_WEBHOOK_URL;
      if (SHEET_URL) {
        backgroundTasks.push(
          fetch(SHEET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderType: 'signup',
              customerName: customerName,
              customerEmail: normalizedEmail,
              customerPaid: 0,
              status: 'active',
              notes: 'Account signup via magic link',
            }),
          }).catch(err => console.error('Google Sheet log error:', err))
        );
      }

      // Keep Worker alive until all background tasks complete
      if (backgroundTasks.length > 0) {
        context.waitUntil(Promise.allSettled(backgroundTasks));
      }
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
 * Build welcome email from Wolf
 */
function buildWelcomeEmail(name) {
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
              <p style="color:#a0a0a0;font-size:14px;line-height:1.8;margin:0 0 20px;">
                Thank you for joining the Archive-35 community. I'm genuinely glad to have you here.
              </p>
              <p style="color:#a0a0a0;font-size:14px;line-height:1.8;margin:0 0 20px;">
                Archive-35 is a personal project rooted in my passion for landscape photography. Every image in the collection captures a moment of light, place, and time that moved me — and I hope you'll find something here that resonates with you too.
              </p>
              <p style="color:#a0a0a0;font-size:14px;line-height:1.8;margin:0 0 20px;">
                If you have any questions, feedback, or just want to talk about photography — I'm always happy to have that conversation. And if an image doesn't meet your expectations, I want to know. Your honest feedback, even criticism, helps me grow.
              </p>
              <p style="color:#a0a0a0;font-size:14px;line-height:1.8;margin:0 0 30px;">
                Feel free to reach out anytime. I read every message personally.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:10px 0 30px;">
                    <a href="https://archive-35.com/gallery.html" style="display:inline-block;background-color:#e8b84d;color:#0a0a0a;font-size:14px;font-weight:600;text-decoration:none;padding:14px 40px;border-radius:8px;letter-spacing:0.05em;">
                      Explore the Gallery
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color:#fcfcfc;font-size:14px;margin:0 0 4px;">Warm regards,</p>
              <p style="color:#e8b84d;font-size:14px;margin:0;">Wolf Schram</p>
              <p style="color:#777777;font-size:12px;margin:4px 0 0;">Founder, Archive-35</p>
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

/**
 * Build signup notification email for Wolf
 */
function buildSignupNotificationEmail(name, email) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:#111;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#ccc;">
<h2 style="color:#4caf50;margin:0 0 8px;">New Account Signup</h2>
<p style="color:#666;font-size:13px;margin:0 0 24px;">Archive-35 &middot; ${new Date().toISOString().split('T')[0]}</p>
<table cellpadding="8" cellspacing="0" style="background:#1a1a1a;border:1px solid #333;border-radius:8px;width:100%;max-width:600px;font-size:14px;">
  <tr><td style="color:#999;">Name</td><td style="color:#fff;"><strong>${name || 'Not provided'}</strong></td></tr>
  <tr><td style="color:#999;">Email</td><td style="color:#fff;">${email}</td></tr>
  <tr><td style="color:#999;">Time</td><td style="color:#fff;">${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}</td></tr>
</table>
<p style="margin:16px 0 0;color:#999;font-size:13px;">A welcome email has been sent to the customer. Their info has been logged to the Google Sheet.</p>
</body>
</html>`;
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
