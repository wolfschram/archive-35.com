/**
 * ARCHIVE-35 Micro-License Checkout
 * Cloudflare Pages Function
 *
 * POST /api/micro-license/checkout
 * Creates a Stripe Checkout Session for micro-license purchases ($0.50 - $2.50)
 *
 * Body: { image_id, tier, image_title, image_filename, classification }
 *
 * Required env vars:
 *   - STRIPE_SECRET_KEY (live mode)
 *   - STRIPE_TEST_SECRET_KEY (test mode, optional)
 */

const TIER_CONFIG = {
  web: {
    price_cents: 50,        // $0.50
    name_suffix: "Web / Social License",
    description: "1200px clean image. Web, blog, social media use. 1 year license.",
    resolution: "1200px",
    duration: "1 year",
  },
  commercial: {
    price_cents: 250,       // $2.50
    name_suffix: "Commercial License",
    description: "Full resolution + license certificate. Commercial use. 2 years.",
    resolution: "Full resolution",
    duration: "2 years",
  },
};

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  try {
    const body = await request.json();
    const { image_id, tier, image_title, image_filename, classification, testMode } = body;

    // Validate inputs
    if (!image_id || !tier) {
      return new Response(
        JSON.stringify({ error: "image_id and tier are required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const tierConfig = TIER_CONFIG[tier];
    if (!tierConfig) {
      return new Response(
        JSON.stringify({ error: `Invalid tier: ${tier}. Use 'web' or 'commercial'.` }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Select Stripe key
    const isTestMode = testMode === true;
    const STRIPE_SECRET_KEY = isTestMode
      ? (env.STRIPE_TEST_SECRET_KEY || env.STRIPE_SECRET_KEY)
      : env.STRIPE_SECRET_KEY;

    if (!STRIPE_SECRET_KEY) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured" }),
        { status: 500, headers: corsHeaders }
      );
    }

    const origin = new URL(request.url).origin;
    const productName = `${image_title || image_id} - ${tierConfig.name_suffix}`;

    // Build Stripe API params
    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("allow_promotion_codes", "true");
    params.append("success_url", `${origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}&type=micro-license`);
    params.append("cancel_url", `${origin}/micro-licensing.html`);
    params.append("customer_creation", "always");

    // Line item
    params.append("line_items[0][price_data][currency]", "usd");
    params.append("line_items[0][price_data][product_data][name]", productName);
    params.append("line_items[0][price_data][product_data][description]", tierConfig.description);
    params.append("line_items[0][price_data][unit_amount]", tierConfig.price_cents.toString());
    params.append("line_items[0][quantity]", "1");

    // Metadata for fulfillment
    params.append("metadata[orderType]", "micro-license");
    params.append("metadata[licensePhotoId]", image_id);
    params.append("metadata[licensePhotoTitle]", image_title || "");
    params.append("metadata[licensePhotoFilename]", image_filename || "");
    params.append("metadata[licenseTier]", tier);
    params.append("metadata[licenseTierName]", tierConfig.name_suffix);
    params.append("metadata[licenseResolution]", tierConfig.resolution);
    params.append("metadata[licenseDuration]", tierConfig.duration);
    params.append("metadata[licenseClassification]", classification || "");
    params.append("metadata[itemCount]", "1");

    // Create Stripe Checkout Session
    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await stripeResponse.json();

    if (session.error) {
      console.error("Stripe error:", session.error);
      return new Response(
        JSON.stringify({ error: session.error.message }),
        { status: 400, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        sessionId: session.id,
        url: session.url,
        tier,
        price: tierConfig.price_cents / 100,
        mode: STRIPE_SECRET_KEY.startsWith("sk_test_") ? "test" : "live",
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error("Micro-license checkout error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: corsHeaders }
    );
  }
}

// CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
