/**
 * ARCHIVE-35 Test Mode Banner
 *
 * Auto-detects test mode from window.STRIPE_PUBLIC_KEY prefix.
 * Shows a persistent banner with backend system status confirmation.
 * Calls /api/test-mode-status to verify ALL systems are in test mode.
 */

(function () {
  'use strict';

  const isTestMode = window.STRIPE_PUBLIC_KEY && window.STRIPE_PUBLIC_KEY.startsWith('pk_test_');
  if (!isTestMode) return; // Live mode — no banner needed

  // Create banner immediately for instant visual feedback
  const banner = document.createElement('div');
  banner.id = 'archive35-test-banner';
  banner.innerHTML = `
    <div style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 99999;
      background: linear-gradient(90deg, #d97706, #f59e0b, #d97706);
      color: #000;
      padding: 8px 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      font-weight: 600;
      text-align: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
    ">
      <span style="font-size: 16px;">⚠️</span>
      <span id="test-banner-text">TEST MODE — Verifying backend systems...</span>
      <span id="test-banner-status" style="
        display: inline-flex;
        gap: 8px;
        align-items: center;
        font-weight: 400;
        font-size: 12px;
      "></span>
    </div>
  `;
  document.body.prepend(banner);

  // Push page content down so banner doesn't overlap
  document.body.style.paddingTop = '40px';

  // Verify backend systems
  const apiBase = 'https://archive-35-com.pages.dev';
  fetch(`${apiBase}/api/test-mode-status?mode=test`)
    .then(res => res.json())
    .then(status => {
      const textEl = document.getElementById('test-banner-text');
      const statusEl = document.getElementById('test-banner-status');

      if (status.allSystemsReady) {
        textEl.textContent = 'TEST MODE ACTIVE';
        statusEl.innerHTML = `
          <span style="color: #065f46;">✓ Stripe: ${status.services.stripe.mode}</span>
          <span style="color: #065f46;">✓ Pictorem: ${status.services.pictorem.mode}</span>
          <span style="color: #065f46;">✓ Webhook: ${status.services.webhook.mode}</span>
          <span style="opacity: 0.7;">| Use card 4242 4242 4242 4242</span>
        `;
      } else {
        textEl.textContent = 'TEST MODE — BACKEND NOT READY';
        statusEl.innerHTML = `
          <span style="color: #991b1b;">✗ Backend test key missing!</span>
          <span style="opacity: 0.7;">Frontend is test but backend may use live key</span>
        `;
        // Change banner to red to warn
        banner.firstElementChild.style.background = 'linear-gradient(90deg, #dc2626, #ef4444, #dc2626)';
        banner.firstElementChild.style.color = '#fff';
      }
    })
    .catch(() => {
      const textEl = document.getElementById('test-banner-text');
      textEl.textContent = 'TEST MODE — Could not verify backend status';
    });
})();
