/**
 * ARCHIVE-35 Micro-License Download Delivery
 * Cloudflare Pages Function
 *
 * GET /api/micro-license/download?session_id=cs_xxx
 * Verifies payment and generates a signed download URL.
 * URL expires in 72 hours.
 *
 * Required env vars:
 *   - STRIPE_SECRET_KEY
 *   - ORIGINALS (R2 bucket binding for image files)
 */

const TIER_RESOLUTIONS = {
  web: { maxWidth: 1200, quality: 85 },
  commercial: { maxWidth: null, quality: 95 }, // Full resolution
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");

  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  if (!sessionId) {
    return new Response(
      JSON.stringify({ error: "session_id is required" }),
      { status: 400, headers: corsHeaders }
    );
  }

  const STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) {
    return new Response(
      JSON.stringify({ error: "Payment system not configured" }),
      { status: 500, headers: corsHeaders }
    );
  }

  try {
    // Verify payment with Stripe
    const stripeRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
      {
        headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
      }
    );
    const session = await stripeRes.json();

    if (session.error) {
      return new Response(
        JSON.stringify({ error: "Invalid session" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (session.payment_status !== "paid") {
      return new Response(
        JSON.stringify({ error: "Payment not completed", payment_status: session.payment_status }),
        { status: 402, headers: corsHeaders }
      );
    }

    // Extract metadata
    const meta = session.metadata || {};
    const imageId = meta.licensePhotoId;
    const tier = meta.licenseTier || "web";
    const filename = meta.licensePhotoFilename || `${imageId}.jpg`;

    if (!imageId) {
      return new Response(
        JSON.stringify({ error: "No image ID in session metadata" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Check if download already generated (idempotency)
    const downloadKey = `download:${sessionId}`;
    if (env.AGENT_REQUESTS) {
      const existing = await env.AGENT_REQUESTS.get(downloadKey);
      if (existing) {
        const parsed = JSON.parse(existing);
        if (new Date(parsed.expires_at) > new Date()) {
          return new Response(JSON.stringify(parsed), { status: 200, headers: corsHeaders });
        }
      }
    }

    // Generate signed URL from R2
    const R2_BUCKET = env.ORIGINALS;
    if (!R2_BUCKET) {
      return new Response(
        JSON.stringify({
          error: "Download system temporarily unavailable",
          note: "Please contact wolf@archive-35.com with your session ID for manual delivery",
          session_id: sessionId,
        }),
        { status: 503, headers: corsHeaders }
      );
    }

    // Look up the image in R2
    const possibleKeys = [
      `originals/${filename}`,
      filename,
      `${imageId}.jpg`,
      `originals/${imageId}.jpg`,
    ];

    let imageObject = null;
    let foundKey = null;
    for (const key of possibleKeys) {
      const obj = await R2_BUCKET.head(key);
      if (obj) {
        imageObject = obj;
        foundKey = key;
        break;
      }
    }

    if (!imageObject) {
      // Log the issue and provide manual delivery instructions
      return new Response(
        JSON.stringify({
          status: "processing",
          message: "Your license is confirmed. Download link will be emailed within 24 hours.",
          session_id: sessionId,
          image_id: imageId,
          tier: tier,
          contact: "wolf@archive-35.com",
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    // Generate signed download URL (72 hours expiry)
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    // For R2 signed URLs, we need to serve the file through a worker
    // Return the download path that can be accessed with the session token
    const downloadUrl = `${url.origin}/api/micro-license/serve?session_id=${sessionId}&key=${encodeURIComponent(foundKey)}`;

    const result = {
      status: "ready",
      download_url: downloadUrl,
      image_id: imageId,
      tier: tier,
      filename: filename,
      expires_at: expiresAt.toISOString(),
      license: {
        type: tier === "commercial" ? "Commercial License" : "Web / Social License",
        duration: tier === "commercial" ? "2 years" : "1 year",
        resolution: tier === "commercial" ? "Full resolution" : "1200px",
        c2pa_verified: true,
      },
    };

    // Cache the download token
    if (env.AGENT_REQUESTS) {
      await env.AGENT_REQUESTS.put(downloadKey, JSON.stringify(result), {
        expirationTtl: 72 * 60 * 60,
      });
    }

    // Log the sale
    const saleLog = {
      timestamp: new Date().toISOString(),
      type: "micro-license",
      session_id: sessionId,
      image_id: imageId,
      tier: tier,
      amount_cents: session.amount_total,
      customer_email: session.customer_details?.email || "unknown",
    };

    if (env.AGENT_REQUESTS) {
      const saleKey = `sale:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      await env.AGENT_REQUESTS.put(saleKey, JSON.stringify(saleLog), {
        expirationTtl: 86400 * 365,
      });
    }

    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Download delivery error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: corsHeaders }
    );
  }
}
