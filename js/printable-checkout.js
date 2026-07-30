(function () {
  'use strict';

  async function startCheckout(button) {
    var status = button.parentElement.querySelector('.printable-checkout-status');
    var originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Opening secure checkout…';
    if (status) status.textContent = '';

    try {
      var response = await fetch('/api/printable/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sku: button.dataset.printableSku })
      });
      var result = await response.json();
      if (!response.ok || !result.url) {
        throw new Error(result.error || 'Checkout is unavailable');
      }
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'begin_checkout', {
          currency: 'USD',
          value: result.price_usd,
          items: [{ item_id: result.sku, item_category: 'printable' }]
        });
      }
      window.location.assign(result.url);
    } catch (error) {
      if (status) {
        status.textContent = error.message + '. You can still purchase through Etsy.';
      }
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('.direct-printable-button');
    if (!button || button.hidden || button.disabled) return;
    startCheckout(button);
  });
})();
