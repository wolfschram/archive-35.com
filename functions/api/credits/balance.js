export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const apiKey = url.searchParams.get("api_key");

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "api_key required" }), {
      status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  // Use KV storage for credit balances
  const kv = env.CREDIT_BALANCES;
  if (!kv) {
    return new Response(JSON.stringify({
      error: "Credit system not configured. KV binding CREDIT_BALANCES needed.",
      setup: "Add [[kv_namespaces]] with binding = 'CREDIT_BALANCES' to wrangler.toml"
    }), {
      status: 503, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  const balance = await kv.get(`credits:${apiKey}`);
  return new Response(JSON.stringify({
    api_key: apiKey,
    balance: balance ? parseFloat(balance) : 0,
    currency: "USD",
  }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}
