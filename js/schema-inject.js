/**
 * ARCHIVE-35 Schema.org Structured Data Injection
 *
 * Dynamically injects Product + VisualArtwork JSON-LD for each photo
 * when viewed in the lightbox or product selector.
 */
(function() {
  'use strict';

  let currentSchemaScript = null;

  /**
   * Inject Schema.org JSON-LD for a photo product
   */
  function injectProductSchema(photo) {
    // Remove previous schema if present
    if (currentSchemaScript) {
      currentSchemaScript.remove();
      currentSchemaScript = null;
    }

    if (!photo || !photo.dimensions) return;

    // Calculate price range
    const minPrice = 60;  // Fine Art Paper smallest size
    const maxPrice = 750; // Acrylic largest size (approximate)

    const schema = {
      '@context': 'https://schema.org',
      '@type': ['Product', 'VisualArtwork'],
      'name': photo.title,
      'description': photo.description || `Fine art photography print: ${photo.title}`,
      'image': `https://archive-35.com/${photo.full}`,
      'url': `https://archive-35.com/gallery.html?collection=${photo.collection}`,
      'artMedium': 'Photography',
      'artform': 'Photograph',
      'creator': {
        '@type': 'Person',
        'name': 'Wolf',
        'url': 'https://archive-35.com/about.html'
      },
      'copyrightHolder': {
        '@type': 'Organization',
        'name': 'Archive-35'
      },
      'copyrightYear': photo.year || 2026,
      'contentLocation': {
        '@type': 'Place',
        'name': photo.location || ''
      },
      'offers': {
        '@type': 'AggregateOffer',
        'lowPrice': minPrice,
        'highPrice': maxPrice,
        'priceCurrency': 'USD',
        'availability': 'https://schema.org/InStock',
        'seller': {
          '@type': 'Organization',
          'name': 'Archive-35',
          'url': 'https://archive-35.com'
        },
        'shippingDetails': {
          '@type': 'OfferShippingDetails',
          'shippingRate': {
            '@type': 'MonetaryAmount',
            'value': 0,
            'currency': 'USD'
          },
          'shippingDestination': {
            '@type': 'DefinedRegion',
            'addressCountry': ['US', 'CA']
          },
          'deliveryTime': {
            '@type': 'ShippingDeliveryTime',
            'handlingTime': {
              '@type': 'QuantitativeValue',
              'minValue': 5,
              'maxValue': 14,
              'unitCode': 'DAY'
            },
            'transitTime': {
              '@type': 'QuantitativeValue',
              'minValue': 5,
              'maxValue': 9,
              'unitCode': 'DAY'
            }
          }
        }
      },
      'material': ['Canvas', 'Metal', 'Acrylic', 'Fine Art Paper', 'Wood'],
      'width': {
        '@type': 'QuantitativeValue',
        'value': photo.dimensions.width,
        'unitCode': 'PX'
      },
      'height': {
        '@type': 'QuantitativeValue',
        'value': photo.dimensions.height,
        'unitCode': 'PX'
      },
      'keywords': (photo.tags || []).join(', ')
    };

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
    currentSchemaScript = script;
  }

  // Hook into lightbox open events
  // Watch for lightbox visibility changes
  const observer = new MutationObserver(function(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        const lightbox = document.getElementById('lightbox');
        if (lightbox && lightbox.classList.contains('active')) {
          // Lightbox opened - inject schema for current photo
          const photo = window.filteredPhotos && window.filteredPhotos[window.currentPhotoIndex];
          if (photo) {
            injectProductSchema(photo);
          }
        }
      }
    }
  });

  document.addEventListener('DOMContentLoaded', function() {
    const lightbox = document.getElementById('lightbox');
    if (lightbox) {
      observer.observe(lightbox, { attributes: true, attributeFilter: ['class'] });
    }
  });

  // Export for manual use
  window.injectProductSchema = injectProductSchema;
})();
