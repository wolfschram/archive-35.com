/* ARCHIVE-35 Analytics Configuration */
/* Google Analytics 4 with AI Agent Detection and Custom Events */

/**
 * AI Agent Detection Module
 * Identifies different visitor types for accurate traffic analysis
 */

// Detect visitor type from User-Agent
const visitorTypeDetection = (() => {
  const userAgent = navigator.userAgent.toLowerCase();

  // Known AI crawlers and bots
  const aiAgentPatterns = /gptbot|claudebot|ccbot|anthropic|chatgpt|perplexity|cohere|openai|gemini/i;
  const searchBotPatterns = /googlebot|bingbot|yandex|duckduckbot|slurp|baidu|bingbot|slurp|sogou|exabot/i;

  return {
    isAIAgent: aiAgentPatterns.test(userAgent),
    isSearchBot: searchBotPatterns.test(userAgent),
    userAgent: userAgent,

    getVisitorType() {
      if (this.isAIAgent) return 'ai_agent';
      if (this.isSearchBot) return 'search_bot';
      return 'human';
    },

    getUserAgentCategory() {
      if (this.isAIAgent) return 'ai';
      if (this.isSearchBot) return 'search';
      return 'direct';
    }
  };
})();

/**
 * Initialize GA4 with custom user properties
 * Must be called after gtag script is loaded
 */
function initializeGA4() {
  if (typeof gtag !== 'function') {
    console.warn('GA4 gtag not loaded yet');
    return;
  }

  // Set custom user properties for visitor type
  gtag('set', 'user_properties', {
    visitor_type: visitorTypeDetection.getVisitorType(),
    user_agent_category: visitorTypeDetection.getUserAgentCategory()
  });

  // Only track events for real humans (not bots)
  if (visitorTypeDetection.getVisitorType() === 'human') {
    initializeEventTracking();
  }
}

/**
 * Track custom events for human visitors only
 */
function initializeEventTracking() {
  // Track when lightbox/gallery images are viewed
  trackPhotoViews();

  // Track product interactions
  trackProductInteractions();

  // Track collection browsing
  trackCollectionBrowsing();
}

/**
 * Track photo/image views in lightbox
 */
function trackPhotoViews() {
  // Listen for lightbox open events
  const lightbox = document.getElementById('lightbox');
  if (!lightbox) return;

  const lightboxImage = lightbox.querySelector('.lightbox-image');
  const lightboxTitle = lightbox.querySelector('.lightbox-title');

  // Watch for when lightbox becomes visible
  const observer = new MutationObserver(() => {
    if (lightbox.style.display !== 'none' && lightbox.style.visibility !== 'hidden') {
      const imageTitle = lightboxTitle?.textContent || 'Unknown Photo';
      gtag('event', 'view_item', {
        items: [{
          id: imageTitle,
          name: imageTitle,
          category: 'photo',
          custom_map: {
            dimension1: 'photo_title',
            dimension2: 'view_type'
          },
          photo_title: imageTitle,
          view_type: 'lightbox'
        }],
        value: 0
      });
    }
  });

  observer.observe(lightbox, {
    attributes: true,
    attributeFilter: ['style'],
    subtree: true
  });
}

/**
 * Track product/print selection and cart interactions
 */
function trackProductInteractions() {
  // Track when product selector opens or changes
  window.addEventListener('product-selector-opened', (e) => {
    if (typeof gtag === 'function') {
      gtag('event', 'select_item', {
        items: [{
          id: e.detail?.photoId || 'unknown',
          name: e.detail?.photoTitle || 'Print Selection',
          category: 'print'
        }]
      });
    }
  });

  // Track add to cart events
  window.addEventListener('item-added-to-cart', (e) => {
    if (typeof gtag === 'function') {
      gtag('event', 'add_to_cart', {
        items: [{
          id: e.detail?.photoId || 'unknown',
          name: e.detail?.photoTitle || 'Print',
          category: e.detail?.material || 'print',
          price: e.detail?.price || 0,
          quantity: 1,
          custom_map: {
            dimension1: 'material_type',
            dimension2: 'size',
            dimension3: 'frame_option'
          },
          material_type: e.detail?.material || 'unknown',
          size: e.detail?.size || 'unknown',
          frame_option: e.detail?.frame || 'none'
        }],
        value: e.detail?.price || 0,
        currency: 'USD'
      });
    }
  });

  // Track checkout initiation
  window.addEventListener('checkout-initiated', (e) => {
    if (typeof gtag === 'function') {
      gtag('event', 'begin_checkout', {
        value: e.detail?.cartValue || 0,
        currency: 'USD',
        items: e.detail?.items || []
      });
    }
  });

  // Track purchase completion
  window.addEventListener('purchase-completed', (e) => {
    if (typeof gtag === 'function') {
      gtag('event', 'purchase', {
        transaction_id: e.detail?.orderId || 'unknown',
        value: e.detail?.totalValue || 0,
        currency: 'USD',
        tax: e.detail?.tax || 0,
        shipping: e.detail?.shipping || 0,
        items: e.detail?.items || []
      });
    }
  });
}

/**
 * Track collection browsing
 */
function trackCollectionBrowsing() {
  const urlParams = new URLSearchParams(window.location.search);
  const collectionId = urlParams.get('collection') || urlParams.get('id');

  if (collectionId) {
    gtag('event', 'view_item_list', {
      items: [{
        id: collectionId,
        name: collectionId.replace('-', ' ').toUpperCase(),
        category: 'collection'
      }],
      custom_map: {
        dimension1: 'collection_name'
      },
      collection_name: collectionId
    });
  }
}

/**
 * Generic event tracking function
 * Use this to track custom events throughout the app
 * Example: trackEvent('contact_form_submitted', { form_type: 'inquiry' })
 */
window.trackEvent = function(eventName, params = {}) {
  if (typeof gtag === 'function' && visitorTypeDetection.getVisitorType() === 'human') {
    // Add visitor type to all events
    const eventData = {
      ...params,
      visitor_type: visitorTypeDetection.getVisitorType()
    };
    gtag('event', eventName, eventData);
  }
};

/**
 * Initialize analytics when gtag is ready
 * GA4 gtag script should be loaded in HTML head
 */
document.addEventListener('DOMContentLoaded', () => {
  // Give gtag script time to load
  setTimeout(() => {
    initializeGA4();
  }, 500);
});

// Also attempt init immediately in case gtag loads very fast
if (typeof gtag === 'function') {
  initializeGA4();
}
