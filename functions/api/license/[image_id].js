/**
 * ARCHIVE-35 x402 Image Licensing Endpoint
 * Cloudflare Pages Function
 *
 * GET /api/license/{image_id}
 *
 * Returns HTTP 402 Payment Required with USDC payment details.
 * After payment confirmation on Base network, returns full-res download URL.
 *
 * Three license tiers:
 *   - thumbnail:  $0.01  — 400px watermarked preview
 *   - web:        $0.50  — 1200px clean, web/blog/social use (DEFAULT)
 *   - commercial: $2.50  — full resolution + license certificate
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
  thumbnail: {
    price: "0.01",
    currency: "USDC",
    description: "Thumbnail preview — 400px max, watermarked",
    max_dimension: 400,
    watermarked: true,
    usage: "Preview only. Watermarked. No commercial or editorial use.",
  },
  web: {
    price: "0.50",
    currency: "USDC",
    description: "Web license — 1200px clean, web/blog/social use",
    max_dimension: 1200,
    watermarked: false,
    usage: "Web use permitted. Credit required: Wolf Schram / Archive-35",
  },
  commercial: {
    price: "2.50",
    currency: "USDC",
    description: "Commercial full-resolution license — print, web, advertising + license certificate",
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

// ── Payment verification (stub — real verification via Coinbase SDK) ──

async function verifyPayment(txHash, expectedAmount, walletAddress) {
  // TODO: Verify on-chain via Base RPC or Coinbase CDP SDK
  // For now, check transaction hash format
  if (!txHash || !txHash.startsWith("0x") || txHash.length !== 66) {
    return { verified: false, error: "Invalid transaction hash format" };
  }

  // Real implementation would:
  // 1. Query Base network for transaction receipt
  // 2. Verify: to === walletAddress
  // 3. Verify: value >= expectedAmount in USDC
  // 4. Verify: status === 1 (success)
  // 5. Verify: not already used (idempotency)

  return {
    verified: false,
    error: "On-chain verification not yet implemented — coming with CDP SDK integration",
    tx_hash: txHash,
  };
}

// ── Signed download URL generation ─────────────────────────────────────

async function generateDownloadUrl(imageId, maxDimension, secret) {
  // Generate time-limited signed URL for R2 original
  const expiry = Date.now() + 3600000; // 1 hour
  const key = imageId.includes("/") ? imageId : `originals/${imageId}`;
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
  const txHash = url.searchParams.get("tx");

  // If no transaction hash — return 402 Payment Required
  if (!txHash) {
    const payment = buildPaymentRequired(imageId, tier, walletAddress);
    if (!payment) {
      return new Response(
        JSON.stringify({
          error: `Invalid tier: ${tier}`,
          valid_tiers: Object.keys(LICENSE_TIERS),
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(payment.body), {
      status: 402,
      headers: payment.headers,
    });
  }

  // Transaction hash provided — verify payment
  const license = LICENSE_TIERS[tier];
  if (!license) {
    return new Response(
      JSON.stringify({ error: `Invalid tier: ${tier}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const verification = await verifyPayment(txHash, license.price, walletAddress);

  if (!verification.verified) {
    return new Response(
      JSON.stringify({
        verified: false,
        error: verification.error,
        tx_hash: txHash,
        note: "On-chain verification coming soon. Contact wolf@archive-35.com for manual licensing.",
      }),
      { status: 402, headers: { "Content-Type": "application/json" } }
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
    secret
  );

  return new Response(
    JSON.stringify({
      verified: true,
      license: tier,
      image_id: imageId,
      download_url: downloadUrl,
      usage_terms: license.usage,
      expires_in: "1 hour",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
