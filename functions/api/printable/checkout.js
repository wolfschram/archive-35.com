import { currentPriceCents, getPrintable } from "./catalog.js";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: JSON_HEADERS,
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("A JSON request body is required", 400);
  }

  const product = getPrintable(body?.sku);
  if (!product) return jsonError("This printable is not available", 404);
  if (!env.STRIPE_SECRET_KEY) return jsonError("Payment system is unavailable", 503);
  if (!env.ORIGINALS) return jsonError("Digital delivery is unavailable", 503);

  const stored = await env.ORIGINALS.head(product.r2Key);
  if (
    !stored ||
    stored.size !== product.bytes ||
    stored.customMetadata?.sha256 !== product.sha256
  ) {
    return jsonError("This printable is not yet available for instant download", 409);
  }

  const origin = new URL(request.url).origin;
  const priceCents = currentPriceCents();
  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("success_url", `${origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}&type=printable`);
  params.append("cancel_url", `${origin}/printable-${product.slug}.html`);
  params.append("customer_creation", "always");
  params.append("automatic_tax[enabled]", "true");
  params.append("billing_address_collection", "required");
  params.append("shipping_address_collection[allowed_countries][0]", "US");
  params.append(
    "custom_text[shipping_address][message]",
    "Nothing will be shipped. This address confirms U.S. eligibility and calculates any required tax."
  );
  params.append(
    "custom_text[submit][message]",
    "Digital download only. By paying, you accept the personal-use license and Terms of Sale."
  );

  params.append("line_items[0][price_data][currency]", "usd");
  params.append("line_items[0][price_data][unit_amount]", String(priceCents));
  params.append("line_items[0][price_data][product_data][name]", product.title);
  params.append(
    "line_items[0][price_data][product_data][description]",
    "Five high-resolution JPEG ratios. Personal wall display only. No physical item."
  );
  params.append(
    "line_items[0][price_data][product_data][tax_code]",
    "txcd_10501000"
  );
  params.append("line_items[0][quantity]", "1");

  params.append("metadata[orderType]", "printable");
  params.append("metadata[printableSku]", product.sku);
  params.append("metadata[printableTitle]", product.title);
  params.append("metadata[printablePriceCents]", String(priceCents));
  params.append("metadata[itemCount]", "1");

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const session = await stripeResponse.json();
  if (!stripeResponse.ok || session.error || !session.url) {
    console.error("Printable Stripe session error", session.error?.type || stripeResponse.status);
    return jsonError("Checkout could not be started", 502);
  }

  return new Response(
    JSON.stringify({
      url: session.url,
      sku: product.sku,
      price_usd: priceCents / 100,
    }),
    { status: 200, headers: JSON_HEADERS }
  );
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
