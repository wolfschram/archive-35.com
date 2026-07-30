import { hasValidPrintableEntitlement } from "./catalog.js";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
};
const DOWNLOAD_WINDOW_MS = 72 * 60 * 60 * 1000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id") || "";
  if (!sessionId) return json({ error: "session_id is required" }, 400);

  const isTest = sessionId.startsWith("cs_test_");
  if (isTest && env.ALLOW_TEST_DELIVERY !== "true") {
    return json({ error: "Test delivery is disabled" }, 403);
  }
  const stripeKey = isTest ? env.STRIPE_TEST_SECRET_KEY : env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json({ error: "Payment verification is unavailable" }, 503);

  const stripeResponse = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${stripeKey}` } }
  );
  const session = await stripeResponse.json();
  if (!stripeResponse.ok || session.error) return json({ error: "Invalid session" }, 400);

  const product = hasValidPrintableEntitlement(session);
  if (!product) return json({ error: "No valid printable entitlement" }, 403);

  const expiresAt = session.created * 1000 + DOWNLOAD_WINDOW_MS;
  if (Date.now() > expiresAt) {
    return json(
      { error: "Download link expired", contact: "wolf@archive-35.com" },
      410
    );
  }
  if (!env.ORIGINALS || !(await env.ORIGINALS.head(product.r2Key))) {
    return json(
      { error: "Download is temporarily unavailable", contact: "wolf@archive-35.com" },
      503
    );
  }

  return json({
    status: "ready",
    sku: product.sku,
    title: product.title,
    download_url: `${url.origin}/api/printable/serve?session_id=${encodeURIComponent(sessionId)}`,
    filename: product.filename,
    expires_at: new Date(expiresAt).toISOString(),
  });
}
