/**
 * Cloudflare Pages Function — Analytics event receiver
 *
 * KV binding: ANALYTICS_EVENTS
 * Env vars:   GOOGLE_SHEET_WEBHOOK_URL (optional)
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const body = await request.json();
    const events = body.events || [];

    if (!events.length) {
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    const backgroundTasks = [];

    // --- Store events in KV, grouped by session + day ---
    const sessionId = events[0]?.sid || 'unknown';
    const dateKey = new Date().toISOString().split('T')[0];
    const kvKey = `session:${sessionId}:${dateKey}`;

    let existing = [];
    try {
      const prev = await env.ANALYTICS_EVENTS?.get(kvKey);
      if (prev) existing = JSON.parse(prev);
    } catch (e) {
      // First write for this session/day — start fresh
    }

    existing.push(...events);

    if (env.ANALYTICS_EVENTS) {
      await env.ANALYTICS_EVENTS.put(kvKey, JSON.stringify(existing), {
        expirationTtl: 2592000, // 30 days
      });
    }

    // --- Forward significant events to Google Sheet ---
    const SHEET_URL = env.GOOGLE_SHEET_WEBHOOK_URL;
    const SIGNIFICANT = ['cart_add', 'checkout_start', 'login'];

    if (SHEET_URL) {
      for (const evt of events) {
        if (SIGNIFICANT.includes(evt.type)) {
          backgroundTasks.push(
            fetch(SHEET_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderType: 'activity',
                activityType: evt.type,
                customerName: evt.user?.name || '',
                customerEmail: evt.user?.email || '',
                sessionId: evt.sid || '',
                page: evt.url || '',
                data: JSON.stringify(evt.data || {}),
                timestamp: new Date(evt.ts).toISOString(),
              }),
            }).catch((err) => console.error('Sheet log error:', err))
          );
        }
      }
    }

    if (backgroundTasks.length > 0) {
      context.waitUntil(Promise.allSettled(backgroundTasks));
    }

    return new Response(
      JSON.stringify({ ok: true, count: events.length }),
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error('Track error:', err);
    return new Response(
      JSON.stringify({ ok: false }),
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
