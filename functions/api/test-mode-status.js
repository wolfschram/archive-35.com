/**
 * ARCHIVE-35 Test Mode Status Endpoint
 * Cloudflare Pages Function
 *
 * GET /api/test-mode-status?mode=test|live
 * Returns confirmation of which Stripe keys are configured and active.
 * Used by the frontend test mode banner to give clear system-wide feedback.
 */

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const requestedMode = url.searchParams.get('mode') || 'live';

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  const hasLiveKey = !!env.STRIPE_SECRET_KEY && env.STRIPE_SECRET_KEY.startsWith('sk_live_');
  const hasTestKey = !!env.STRIPE_TEST_SECRET_KEY && env.STRIPE_TEST_SECRET_KEY.startsWith('sk_test_');

  // Determine what would actually happen in each mode
  const status = {
    requestedMode,
    backend: {
      liveKeyConfigured: hasLiveKey,
      testKeyConfigured: hasTestKey,
    },
    services: {
      stripe: {
        mode: requestedMode === 'test' && hasTestKey ? 'test' : 'live',
        ready: requestedMode === 'test' ? hasTestKey : hasLiveKey,
        detail: requestedMode === 'test'
          ? (hasTestKey ? 'Test secret key active — test cards accepted' : 'No test key configured — will use live key!')
          : (hasLiveKey ? 'Live secret key active — real charges' : 'No live key configured!'),
      },
      pictorem: {
        mode: requestedMode === 'test' ? 'mock' : 'live',
        detail: requestedMode === 'test'
          ? 'Orders will be simulated (no real prints)'
          : 'Live fulfillment — real print orders',
      },
      webhook: {
        mode: requestedMode === 'test' ? 'test' : 'live',
        detail: requestedMode === 'test'
          ? 'Webhook will detect livemode=false and mock Pictorem'
          : 'Webhook processes real payments and orders',
      },
    },
    allSystemsReady: requestedMode === 'test'
      ? hasTestKey
      : hasLiveKey,
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(status), {
    status: 200,
    headers: corsHeaders,
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
