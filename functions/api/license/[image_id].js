/**
 * ARCHIVE-35 x402 Image Licensing Endpoint
 * Cloudflare Pages Function
 *
 * GET /api/license/{image_id}
 *
 * Returns HTTP 402 Payment Required with USDC payment details.
 * After payment confirmation on Base network, returns full-res download URL.
 *
 * Two license tiers:
 *   - web:        $2.50  — 2400px clean, web/blog/social use (DEFAULT)
 *   - commercial: $5.00  — full resolution + license certificate
 *
 * Payment: USDC on Base network via Coinbase x402 protocol.
 * Facilitator: Coinbase (1,000 free transactions/month).
 *
 * Required env vars:
 *   COINBASE_WALLET_ADDRESS — Wolf's USDC receiving wallet
 *   ORIGINAL_SIGNING_SECRET — for generating signed download URLs
 *   R2 binding: ORIGINALS — archive-35-originals bucket
 */

// ── License tiers ──────────────────────────────────────────────────────

const LICENSE_TIERS = {
  web: {
    price: "2.50",
    currency: "USDC",
    description: "Web license — 2400px clean, web/blog/social use, 1-year license",
    max_dimension: 2400,
    watermarked: false,
    usage: "Web use permitted. Credit required: Wolf Schram / Archive-35",
  },
  commercial: {
    price: "5.00",
    currency: "USDC",
    description: "Commercial full-resolution license — print, web, advertising + license certificate, 2-year license",
    max_dimension: null, // full res
    watermarked: false,
    usage: "Commercial use permitted. No exclusivity. License certificate included. Credit appreciated.",
  },
};

// ── x402 payment response ──────────────────────────────────────────────

function buildPaymentRequired(imageId, tier, walletAddress) {
  const license = LICENSE_TIERS[tier];
  if (!license) return null;

  return {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "X-Payment-Required": "true",
      "X-Payment-Network": "base",
      "X-Payment-Currency": "USDC",
      "X-Payment-Amount": license.price,
      "X-Payment-Address": walletAddress,
    },
    body: {
      payment_required: true,
      image_id: imageId,
      license_tier: tier,
      price: license.price,
      currency: license.currency,
      network: "base",
      chain_id: 8453,
      pay_to: walletAddress,
      description: license.description,
      usage_terms: license.usage,
      brand: "Archive-35 / The Restless Eye by Wolf Schram",
      verify_payment: `/api/license/${imageId}?tier=${tier}&tx={transaction_hash}`,
      available_tiers: Object.entries(LICENSE_TIERS).map(([k, v]) => ({
        tier: k,
        price: v.price,
        description: v.description,
      })),
    },
  };
}

// ── Payment verification via x402 facilitator ──────────────────────────

async function verifyPayment(paymentHeader, expectedAmount, expectedRecipient) {
  const FACILITATOR_URL = "https://x402.org/facilitator";
  try {
    const response = await fetch(`${FACILITATOR_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payment: paymentHeader,
        expectedAmount: expectedAmount,
        expectedRecipient: expectedRecipient,
        network: "base",
        currency: "USDC",
      }),
    });
    if (!response.ok) {
      return { valid: false, error: `Facilitator returned ${response.status}` };
    }
    const result = await response.json();
    return { valid: result.valid === true, txHash: result.txHash || null, error: result.error || null };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

// ── Signed download URL generation ─────────────────────────────────────

async function generateDownloadUrl(imageId, maxDimension, secret, tier) {
  // Generate time-limited signed URL
  // Route micro-license tiers to down-converted versions, not originals
  const expiry = Date.now() + 72 * 60 * 60 * 1000; // 72 hours
  let key;
  if (tier === "web" || tier === "commercial") {
    // Micro-license: serve down-converted version (2400px web / 4000px commercial)
    key = `micro/${tier}/${imageId}.jpg`;
  } else {
    // Full license: serve original
    key = imageId.includes("/") ? imageId : `originals/${imageId}`;
  }
  const message = `${key}:${expiry}`;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  let url = `/api/serve-original?key=${encodeURIComponent(key)}&exp=${expiry}&sig=${sig}`;
  if (maxDimension) {
    url += `&max=${maxDimension}`;
  }
  return url;
}

// ── Main handler ───────────────────────────────────────────────────────

export async function onRequest(context) {
  const { params, request, env } = context;
  const imageId = params.image_id;

  if (!imageId) {
    return new Response(JSON.stringify({ error: "Missing image_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const walletAddress = env.COINBASE_WALLET_ADDRESS;
  if (!walletAddress) {
    return new Response(
      JSON.stringify({ error: "Licensing not configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const url = new URL(request.url);
  const tier = url.searchParams.get("tier") || "web";
  const paymentHeader = request.headers.get("X-PAYMENT");

  // Validate tier
  const license = LICENSE_TIERS[tier];
  if (!license) {
    return new Response(
      JSON.stringify({
        error: `Invalid tier: ${tier}`,
        valid_tiers: Object.keys(LICENSE_TIERS),
      }),
      { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }

  // If no X-PAYMENT header — return 402 Payment Required
  if (!paymentHeader) {
    const payment = buildPaymentRequired(imageId, tier, walletAddress);
    if (!payment) {
      return new Response(
        JSON.stringify({
          error: `Invalid tier: ${tier}`,
          valid_tiers: Object.keys(LICENSE_TIERS),
        }),
        { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    return new Response(JSON.stringify(payment.body), {
      status: 402,
      headers: { ...payment.headers, "Access-Control-Allow-Origin": "*" },
    });
  }

  // X-PAYMENT header present — verify payment via x402 facilitator
  const verification = await verifyPayment(paymentHeader, license.price, walletAddress);

  if (!verification.valid) {
    return new Response(
      JSON.stringify({
        verified: false,
        error: verification.error,
        note: "Payment verification failed. Contact wolf@archive-35.com for manual licensing.",
      }),
      { status: 402, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }

  // Payment verified — generate download URL
  const secret = env.ORIGINAL_SIGNING_SECRET;
  if (!secret) {
    return new Response(
      JSON.stringify({ error: "Download signing not configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const downloadUrl = await generateDownloadUrl(
    imageId,
    license.max_dimension,
    secret,
    tier
  );

  return new Response(
    JSON.stringify({
      verified: true,
      license: tier,
      image_id: imageId,
      download_url: downloadUrl,
      tx_hash: verification.txHash,
      usage_terms: license.usage,
      expires_in: "72 hours",
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
  );
}
