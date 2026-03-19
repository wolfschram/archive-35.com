export async function onRequestPost(context) {
  const { request, env } = context;

  const body = await request.json().catch(() => ({}));
  const apiKey = body.api_key;
  const imageId = body.image_id;
  const tier = body.tier || "web";

  if (!apiKey || !imageId) {
    return new Response(JSON.stringify({ error: "api_key and image_id required" }), {
      status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  const kv = env.CREDIT_BALANCES;
  if (!kv) {
    return new Response(JSON.stringify({
      error: "Credit system not configured",
      setup: "Add KV binding CREDIT_BALANCES in Cloudflare Pages settings"
    }), {
      status: 503, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  const tierCosts = { web: 2.50, commercial: 5.00 };
  const cost = tierCosts[tier] || 2.50;

  const currentBalance = parseFloat(await kv.get(`credits:${apiKey}`) || "0");

  if (currentBalance < cost) {
    return new Response(JSON.stringify({
      error: "Insufficient credits",
      balance: currentBalance,
      cost: cost,
      purchase_url: "https://archive-35.com/api/credits/purchase"
    }), {
      status: 402, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  // Deduct credits
  const newBalance = currentBalance - cost;
  await kv.put(`credits:${apiKey}`, newBalance.toString());

  // Generate download URL (same pattern as [image_id].js)
  const downloadUrl = `https://archive-35.com/api/license/${imageId}?tier=${tier}&credited=true`;

  return new Response(JSON.stringify({
    success: true,
    image_id: imageId,
    tier: tier,
    cost: cost,
    remaining_balance: newBalance,
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
