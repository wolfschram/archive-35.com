import { hasValidPrintableEntitlement } from "./catalog.js";

const DOWNLOAD_WINDOW_MS = 72 * 60 * 60 * 1000;

function jsonError(message, status) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id") || "";
  if (!sessionId) return jsonError("session_id is required", 400);

  const isTest = sessionId.startsWith("cs_test_");
  if (isTest && env.ALLOW_TEST_DELIVERY !== "true") {
    return jsonError("Test delivery is disabled", 403);
  }
  const stripeKey = isTest ? env.STRIPE_TEST_SECRET_KEY : env.STRIPE_SECRET_KEY;
  if (!stripeKey) return jsonError("Payment verification is unavailable", 503);

  const stripeResponse = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${stripeKey}` } }
  );
  const session = await stripeResponse.json();
  if (!stripeResponse.ok || session.error) return jsonError("Invalid session", 400);

  const product = hasValidPrintableEntitlement(session);
  if (!product) return jsonError("No valid printable entitlement", 403);
  if (Date.now() > session.created * 1000 + DOWNLOAD_WINDOW_MS) {
    return jsonError("Download link expired", 410);
  }
  if (!env.ORIGINALS) return jsonError("Digital delivery is unavailable", 503);

  const object = await env.ORIGINALS.get(product.r2Key);
  if (!object) return jsonError("Download file is unavailable", 404);

  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${product.filename}"`,
      "Content-Length": String(object.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
