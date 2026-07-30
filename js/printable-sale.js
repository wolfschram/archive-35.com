(function () {
  'use strict';

  var SALE_START = '2026-07-30T00:00:00-07:00';
  var SALE_END = '2026-08-07T00:00:00-07:00';

  function isActiveAt(value) {
    var timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return (
      Number.isFinite(timestamp) &&
      timestamp >= new Date(SALE_START).getTime() &&
      timestamp < new Date(SALE_END).getTime()
    );
  }

  function restoreExpiredOfferPrices(value) {
    if (!value || typeof value !== 'object') return;
    if (
      value['@type'] === 'Offer' &&
      value.priceValidUntil === '2026-08-06'
    ) {
      if (value.price === '9.00') value.price = '12.00';
      if (value.price === '13.50') value.price = '18.00';
      delete value.priceValidUntil;
    }
    Object.keys(value).forEach(function (key) {
      restoreExpiredOfferPrices(value[key]);
    });
  }

  function apply(now) {
    var active = isActiveAt(now || new Date());
    document.documentElement.dataset.printableSale = active ? 'active' : 'ended';

    document.querySelectorAll('[data-printable-sale]').forEach(function (element) {
      element.hidden = !active;
    });
    document.querySelectorAll('[data-printable-base]').forEach(function (element) {
      element.hidden = active;
    });
    document.querySelectorAll('[data-sale-active-label]').forEach(function (element) {
      element.textContent = active
        ? element.dataset.saleActiveLabel
        : element.dataset.saleBaseLabel;
      element.dataset.priceUsd = active
        ? element.dataset.salePriceUsd
        : element.dataset.basePriceUsd;
    });
    if (!active) {
      document.querySelectorAll('script[type="application/ld+json"]').forEach(function (script) {
        try {
          var schema = JSON.parse(script.textContent);
          restoreExpiredOfferPrices(schema);
          script.textContent = JSON.stringify(schema);
        } catch (error) {
          // Leave unrelated or malformed structured data untouched.
        }
      });
    }

    return active;
  }

  window.Archive35PrintableSale = {
    startsAt: SALE_START,
    endsAt: SALE_END,
    isActiveAt: isActiveAt,
    restoreExpiredOfferPrices: restoreExpiredOfferPrices,
    apply: apply
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      apply(new Date());
    });
  } else {
    apply(new Date());
  }
})();
