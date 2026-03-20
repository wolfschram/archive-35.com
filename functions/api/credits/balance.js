export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const email = url.searchParams.get("email");

  if (!email) {
    return new Response(JSON.stringify({ error: "email parameter required" }), {
      status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  // Use AGENT_REQUESTS KV (same store the webhook writes to)
  const kv = env.AGENT_REQUESTS;
  if (!kv) {
    return new Response(JSON.stringify({
      error: "Credit system not configured. KV binding AGENT_REQUESTS needed.",
      setup: "Add [[kv_namespaces]] with binding = 'AGENT_REQUESTS' to wrangler.toml"
    }), {
      status: 503, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  const raw = await kv.get(`credits:${email}`);
  const balance = raw ? JSON.parse(raw) : { credits: 0 };

  return new Response(JSON.stringify({
    email,
    credits: balance.credits || 0,
    last_updated: balance.last_updated || null,
  }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}
