export async function onRequestPost(context) {
  const { request, env } = context;
  const STRIPE_KEY = env.STRIPE_SECRET_KEY || env.STRIPE_TEST_SECRET_KEY;

  if (!STRIPE_KEY) {
    return new Response(JSON.stringify({ error: "Stripe not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  const body = await request.json().catch(() => ({}));
  const amount = body.amount || 25; // $25 default credit pack
  const amountCents = Math.round(amount * 100);

  const params = new URLSearchParams({
    "payment_method_types[]": "card",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": `Archive-35 Credit Pack ($${amount})`,
    "line_items[0][price_data][unit_amount]": amountCents.toString(),
    "line_items[0][quantity]": "1",
    "mode": "payment",
    "success_url": "https://archive-35.com/micro-licensing.html?credits=purchased",
    "cancel_url": "https://archive-35.com/micro-licensing.html",
    "metadata[orderType]": "credit_pack",
    "metadata[creditAmount]": amount.toString(),
  });

  const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const session = await resp.json();
  if (session.error) {
    return new Response(JSON.stringify({ error: session.error.message }), {
      status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  return new Response(JSON.stringify({
    sessionId: session.id,
    url: session.url,
    amount: amount,
    credits: Math.floor(amount / 2.5), // $2.50 per credit
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
