/**
 * ARCHIVE-35 Micro-License Image Serve
 * Cloudflare Pages Function
 *
 * GET /api/micro-license/serve?session_id=cs_xxx&key=micro/web/alps-001.jpg
 *
 * Verifies the Stripe session is paid, checks 72-hour expiry,
 * reads the image from R2, and streams the binary file to the buyer.
 *
 * Required env vars:
 *   - STRIPE_SECRET_KEY (or STRIPE_TEST_SECRET_KEY)
 *   - ORIGINALS (R2 bucket binding)
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Handle preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const sessionId = url.searchParams.get("session_id");
  const key = url.searchParams.get("key");

  if (!sessionId || !key) {
    return new Response(
      JSON.stringify({ error: "session_id and key parameters are required" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  const STRIPE_KEY = env.STRIPE_SECRET_KEY || env.STRIPE_TEST_SECRET_KEY;
  if (!STRIPE_KEY) {
    return new Response(
      JSON.stringify({ error: "Payment verification not configured" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  try {
    // Verify payment with Stripe
    const stripeRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
      { headers: { Authorization: `Bearer ${STRIPE_KEY}` } }
    );
    const session = await stripeRes.json();

    if (session.error) {
      return new Response(
        JSON.stringify({ error: "Invalid session ID" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (session.payment_status !== "paid") {
      return new Response(
        JSON.stringify({ error: "Payment not completed", payment_status: session.payment_status }),
        { status: 402, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check 72-hour expiry from session creation
    const createdAt = session.created * 1000; // Stripe uses seconds
    const expiresAt = createdAt + 72 * 60 * 60 * 1000;
    if (Date.now() > expiresAt) {
      return new Response(
        JSON.stringify({
          error: "Download link expired (72-hour limit)",
          created: new Date(createdAt).toISOString(),
          expired: new Date(expiresAt).toISOString(),
          contact: "wolf@archive-35.com",
        }),
        { status: 410, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Read image from R2
    const R2_BUCKET = env.ORIGINALS;
    if (!R2_BUCKET) {
      return new Response(
        JSON.stringify({
          error: "Download system temporarily unavailable",
          contact: "wolf@archive-35.com",
          session_id: sessionId,
        }),
        { status: 503, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const object = await R2_BUCKET.get(key);
    if (!object) {
      return new Response(
        JSON.stringify({
          error: "Image not found in storage",
          key: key,
          contact: "wolf@archive-35.com",
          session_id: sessionId,
        }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Extract filename for Content-Disposition
    const filename = key.split("/").pop() || "archive-35-licensed-image.jpg";

    // Stream the image binary
    return new Response(object.body, {
      status: 200,
      headers: {
        "Content-Type": object.httpMetadata?.contentType || "image/jpeg",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": object.size?.toString() || "",
        "Cache-Control": "private, no-store",
        ...corsHeaders,
      },
    });
  } catch (err) {
    console.error("Serve error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
}
