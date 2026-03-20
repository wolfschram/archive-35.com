export async function onRequestPost(context) {
  const { request, env } = context;

  const body = await request.json().catch(() => ({}));
  const email = body.email;
  const imageId = body.image_id;
  const tier = body.tier || "micro";

  if (!email || !imageId) {
    return new Response(JSON.stringify({ error: "email and image_id required" }), {
      status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  // Use AGENT_REQUESTS KV (same store the webhook writes to)
  const kv = env.AGENT_REQUESTS;
  if (!kv) {
    return new Response(JSON.stringify({
      error: "Credit system not configured",
      setup: "Add KV binding AGENT_REQUESTS in Cloudflare Pages settings"
    }), {
      status: 503, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  const kvKey = `credits:${email}`;
  const raw = await kv.get(kvKey);
  const balance = raw ? JSON.parse(raw) : { credits: 0 };

  if (balance.credits < 1) {
    return new Response(JSON.stringify({
      error: "Insufficient credits",
      credits: balance.credits,
      cost: 1,
      purchase_url: "https://archive-35.com/micro-licensing.html"
    }), {
      status: 402, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  // Deduct 1 credit
  balance.credits -= 1;
  balance.last_updated = new Date().toISOString();
  balance.last_redeemed = { image_id: imageId, tier, at: new Date().toISOString() };
  await kv.put(kvKey, JSON.stringify(balance));

  // Generate download URL for the micro version
  const downloadUrl = `https://archive-35.com/api/license/${imageId}?tier=${tier}&credited=true`;

  return new Response(JSON.stringify({
    success: true,
    image_id: imageId,
    tier,
    credits_remaining: balance.credits,
    download_url: downloadUrl,
  }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }
  });
}
