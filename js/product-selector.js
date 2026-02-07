/**
 * ARCHIVE-35 PRODUCT SELECTOR V2
 *
 * Aspect-ratio aware print product selector for Pictorem fulfillment.
 * This is a complete drop-in replacement for the original product-selector.js
 *
 * Features:
 * - Dynamically shows print sizes based on photo's aspect ratio
 * - Quality indicators (DPI-based museum/excellent/good ratings)
 * - Dynamic pricing per material and size
 * - Stripe integration for checkout
 * - Pictorem metadata for fulfillment
 * - Dark theme with gold (#c4973b) accents
 *
 * Usage:
 *   const photoData = { id: 'gt-001', dimensions: {...}, title: '...' };
 *   openProductSelector(photoData);
 */

// ============================================================================
// ASPECT RATIO CATEGORIES
// ============================================================================

const ASPECT_RATIO_CATEGORIES = {
  standard_3_2: {
    name: 'Standard 3:2',
    range: [1.4, 1.6],
    sizes: [
      { width: 12, height: 8, inches: 96 },
      { width: 18, height: 12, inches: 216 },
      { width: 24, height: 16, inches: 384 },
      { width: 36, height: 24, inches: 864 },
      { width: 48, height: 32, inches: 1536 },
      { width: 60, height: 40, inches: 2400 }
    ]
  },
  wide_16_9: {
    name: 'Wide 16:9',
    range: [1.6, 1.9],
    sizes: [
      { width: 16, height: 9, inches: 144 },
      { width: 24, height: 14, inches: 336 },
      { width: 32, height: 18, inches: 576 },
      { width: 48, height: 27, inches: 1296 }
    ]
  },
  four_3: {
    name: '4:3 Ratio',
    range: [1.2, 1.4],
    sizes: [
      { width: 16, height: 12, inches: 192 },
      { width: 20, height: 16, inches: 320 },
      { width: 24, height: 18, inches: 432 },
      { width: 40, height: 30, inches: 1200 }
    ]
  },
  square: {
    name: 'Square',
    range: [0.95, 1.05],
    sizes: [
      { width: 12, height: 12, inches: 144 },
      { width: 20, height: 20, inches: 400 },
      { width: 30, height: 30, inches: 900 }
    ]
  },
  panorama_2_1: {
    name: 'Panorama 2:1',
    range: [1.9, 2.3],
    sizes: [
      { width: 24, height: 12, inches: 288 },
      { width: 36, height: 18, inches: 648 },
      { width: 48, height: 24, inches: 1152 }
    ]
  },
  panorama_3_1: {
    name: 'Panorama 3:1',
    range: [2.7, 3.3],
    sizes: [
      { width: 36, height: 12, inches: 432 },
      { width: 48, height: 16, inches: 768 },
      { width: 60, height: 20, inches: 1200 }
    ]
  },
  ultra_wide_4_1: {
    name: 'Ultra-Wide 4:1+',
    range: [3.5, Infinity],
    sizes: [
      { width: 60, height: 15, inches: 900 },
      { width: 72, height: 18, inches: 1296 }
    ]
  }
};

// ============================================================================
// MATERIALS & BASE PRICING
// ============================================================================

const MATERIALS = {
  canvas: {
    name: 'Canvas',
    basePrice: 105,
    maxInches: 2400,
    description: 'Museum-quality canvas wrap with professional stretching'
  },
  metal: {
    name: 'Metal',
    basePrice: 130,
    maxInches: 2400,
    description: 'Vibrant metal print with aluminum coating'
  },
  acrylic: {
    name: 'Acrylic',
    basePrice: 195,
    maxInches: 2400,
    description: 'Premium acrylic with stunning color depth'
  },
  paper: {
    name: 'Fine Art Paper',
    basePrice: 60,
    maxInches: 2400,
    description: 'Archival fine art paper with matte finish'
  },
  wood: {
    name: 'Wood',
    basePrice: 120,
    maxInches: 2400,
    description: 'Rustic wood print on premium plywood'
  }
};

// ============================================================================
// PRICING CALCULATION
// ============================================================================

function calculatePrice(materialKey, sizeInches) {
  const material = MATERIALS[materialKey];
  if (!material) return 0;

  // Price scales with area using a logarithmic curve
  // Base price for base size (smallest), increases with area
  const baseSize = 96; // 12x8
  const ratio = sizeInches / baseSize;
  const scaleFactor = Math.pow(ratio, 0.75); // Sub-linear scaling

  return Math.round(material.basePrice * scaleFactor);
}

// ============================================================================
// DPI & QUALITY CALCULATION
// ============================================================================

function calculateDPI(photoWidth, photoHeight, printWidth, printHeight) {
  // True print DPI: pixels divided by inches
  const dpiW = photoWidth / printWidth;
  const dpiH = photoHeight / printHeight;
  return Math.round(Math.min(dpiW, dpiH));
}

function getQualityBadge(dpi) {
  if (dpi >= 300) {
    return { level: 'Museum Quality', class: 'quality-museum', icon: '★★★' };
  } else if (dpi >= 200) {
    return { level: 'Excellent', class: 'quality-excellent', icon: '★★' };
  } else if (dpi >= 150) {
    return { level: 'Good', class: 'quality-good', icon: '★' };
  }
  return null; // Don't show if below minimum
}

// ============================================================================
// ASPECT RATIO MATCHING
// ============================================================================

function getMatchingCategory(photoAspectRatio, tolerance = 0.1) {
  for (const [key, category] of Object.entries(ASPECT_RATIO_CATEGORIES)) {
    const [min, max] = category.range;
    if (
      photoAspectRatio >= min * (1 - tolerance) &&
      photoAspectRatio <= max * (1 + tolerance)
    ) {
      return { key, ...category };
    }
  }
  // Default to standard 3:2 if no match
  return ASPECT_RATIO_CATEGORIES.standard_3_2;
}

function filterSizesByAspectRatio(sizes, photoAspectRatio, tolerance = 0.1) {
  return sizes.filter((size) => {
    const sizeRatio = size.width / size.height;
    return (
      sizeRatio >= photoAspectRatio * (1 - tolerance) &&
      sizeRatio <= photoAspectRatio * (1 + tolerance)
    );
  });
}

// ============================================================================
// MODAL UI GENERATION
// ============================================================================

function createProductSelectorModal(photoData) {
  // Validate photo data
  if (!photoData.dimensions) {
    console.error('Photo data missing dimensions object', photoData);
    return;
  }

  const {
    id,
    title,
    dimensions: { width: photoWidth, height: photoHeight, aspectRatio, megapixels }
  } = photoData;

  // Get matching aspect ratio category
  const category = getMatchingCategory(aspectRatio);
  const applicableSizes = filterSizesByAspectRatio(category.sizes, aspectRatio);

  // Create modal HTML
  const modal = document.createElement('div');
  modal.className = 'product-selector-modal';
  modal.id = 'product-selector-modal';

  modal.innerHTML = `
    <div class="product-selector-overlay" data-close="true"></div>
    <div class="product-selector-content">
      <button class="close-button" aria-label="Close selector">&times;</button>

      <div class="selector-header">
        <h2>Print "${title}"</h2>
        <p class="selector-subtitle">
          Photo dimensions: ${photoWidth} × ${photoHeight} px (${megapixels} MP, ${category.name})
        </p>
      </div>

      <div class="selector-body">
        <!-- Material Selection -->
        <div class="material-section">
          <h3>Step 1: Choose Material</h3>
          <div class="material-grid">
            ${Object.entries(MATERIALS)
              .map(
                ([key, material]) => `
              <div class="material-option" data-material="${key}">
                <input type="radio" id="material-${key}" name="material" value="${key}" />
                <label for="material-${key}">
                  <div class="material-name">${material.name}</div>
                  <div class="material-description">${material.description}</div>
                </label>
              </div>
            `
              )
              .join('')}
          </div>
        </div>

        <!-- Size Selection -->
        <div class="size-section">
          <h3>Step 2: Choose Size</h3>
          <div class="size-grid" id="size-grid">
            <!-- Dynamically populated based on selected material -->
          </div>
        </div>

        <!-- Price Summary -->
        <div class="price-summary">
          <div class="summary-row">
            <span>Material:</span>
            <span id="summary-material">Select material</span>
          </div>
          <div class="summary-row">
            <span>Size:</span>
            <span id="summary-size">Select size</span>
          </div>
          <div class="summary-row">
            <span>Quality:</span>
            <span id="summary-quality">—</span>
          </div>
          <div class="summary-row total">
            <span>Total Price:</span>
            <span id="summary-price">$0</span>
          </div>
        </div>

        <!-- Additional Info -->
        <div class="product-info">
          <div class="info-item">
            <strong>Production Time:</strong> 5-7 business days
          </div>
          <div class="info-item">
            <strong>Shipping:</strong> Standard 3-5 days (within USA)
          </div>
          <div class="info-item">
            <strong>Pictorem Provider:</strong> Professional prints via www.pictorem.com
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="product-actions">
          <button class="add-to-cart-button" id="add-to-cart-button" disabled>
            Add to Cart
          </button>
          <button class="buy-now-button" id="buy-now-button" disabled>
            Buy Now
          </button>
        </div>
      </div>
    </div>
  `;

  return { modal, category, applicableSizes, photoData };
}

// ============================================================================
// EVENT HANDLERS & INTERACTIONS
// ============================================================================

function setupProductSelectorEvents(modal, category, applicableSizes, photoData) {
  const overlay = modal.querySelector('.product-selector-overlay');
  const closeBtn = modal.querySelector('.close-button');
  const materialOptions = modal.querySelectorAll('.material-option');
  const sizeGrid = modal.querySelector('#size-grid');
  const addToCartBtn = modal.querySelector('#add-to-cart-button');
  const buyNowBtn = modal.querySelector('#buy-now-button');

  let selectedMaterial = null;
  let selectedSize = null;

  // Close modal
  const closeModal = () => {
    modal.remove();
  };

  overlay.addEventListener('click', closeModal);
  closeBtn.addEventListener('click', closeModal);

  // Material selection
  materialOptions.forEach((option) => {
    option.addEventListener('click', () => {
      // Remove previous selection
      materialOptions.forEach((o) => o.classList.remove('selected'));

      // Mark as selected
      option.classList.add('selected');
      const input = option.querySelector('input[type="radio"]');
      input.checked = true;
      selectedMaterial = input.value;

      // Update summary
      const materialName = MATERIALS[selectedMaterial].name;
      modal.querySelector('#summary-material').textContent = materialName;

      // Reset size selection when material changes
      selectedSize = null;
      sizeGrid.innerHTML = '';
      modal.querySelector('#summary-size').textContent = 'Select size';
      modal.querySelector('#summary-quality').textContent = '—';
      modal.querySelector('#summary-price').textContent = '$0';
      addToCartBtn.disabled = true;
      buyNowBtn.disabled = true;

      // Populate sizes for this material
      populateSizes(sizeGrid, applicableSizes, photoData, selectedMaterial, modal, (size) => {
        selectedSize = size;
        updatePriceSummary(modal, selectedMaterial, selectedSize, photoData);
        addToCartBtn.disabled = false;
        buyNowBtn.disabled = false;
      });
    });
  });

  // Size selection happens in populateSizes callback
  // Add to cart
  addToCartBtn.addEventListener('click', () => {
    if (selectedMaterial && selectedSize) {
      addToCart(photoData, selectedMaterial, selectedSize);
      closeModal();
    }
  });

  // Buy now
  buyNowBtn.addEventListener('click', () => {
    if (selectedMaterial && selectedSize) {
      initiateStripeCheckout(photoData, selectedMaterial, selectedSize);
    }
  });
}

function populateSizes(container, sizes, photoData, materialKey, modal, onSelect) {
  const { width: photoWidth, height: photoHeight } = photoData.dimensions;

  container.innerHTML = sizes
    .map((size) => {
      const dpi = calculateDPI(photoWidth, photoHeight, size.width, size.height);
      const quality = getQualityBadge(dpi);
      const price = calculatePrice(materialKey, size.inches);

      // Skip if quality is too low
      if (!quality) {
        return '';
      }

      return `
        <div class="size-option" data-size="${size.width}x${size.height}">
          <input type="radio" id="size-${size.width}x${size.height}"
                 name="size" value="${size.width}x${size.height}" />
          <label for="size-${size.width}x${size.height}">
            <div class="size-dimensions">${size.width}" × ${size.height}"</div>
            <div class="size-dpi">${dpi} DPI</div>
            <div class="quality-badge ${quality.class}">${quality.level}</div>
            <div class="size-price">$${price}</div>
          </label>
        </div>
      `;
    })
    .join('');

  // Add event listeners to size options
  const sizeInputs = container.querySelectorAll('input[type="radio"]');
  sizeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      const [w, h] = input.value.split('x').map(Number);
      const selectedSize = { width: w, height: h, inches: (w * h) };
      onSelect(selectedSize);
    });
  });
}

function updatePriceSummary(modal, materialKey, size, photoData) {
  const { width: photoWidth, height: photoHeight } = photoData.dimensions;
  const dpi = calculateDPI(photoWidth, photoHeight, size.width, size.height);
  const quality = getQualityBadge(dpi);
  const price = calculatePrice(materialKey, size.inches);

  modal.querySelector('#summary-size').textContent =
    `${size.width}" × ${size.height}"`;
  modal.querySelector('#summary-quality').textContent = quality ? quality.level : '—';
  modal.querySelector('#summary-price').textContent = `$${price}`;
}

// ============================================================================
// ADD TO CART INTEGRATION
// ============================================================================

function addToCart(photoData, materialKey, size) {
  const { id, title, thumbnail, dimensions } = photoData;
  const material = MATERIALS[materialKey];
  const price = calculatePrice(materialKey, size.inches);
  const sizeStr = `${size.width}" × ${size.height}"`;

  // Create cart item
  const cartItem = {
    photoId: id,
    title: title,
    material: material.name,
    size: sizeStr,
    price: price,
    thumbnail: thumbnail,
    // stripePrice will be set to empty for now - handled via backend API
    stripePrice: null,
    metadata: {
      photoId: id,
      material: materialKey,
      width: size.width.toString(),
      height: size.height.toString(),
      originalPhotoWidth: dimensions.width.toString(),
      originalPhotoHeight: dimensions.height.toString(),
      dpi: calculateDPI(
        dimensions.width,
        dimensions.height,
        size.width,
        size.height
      ).toString()
    }
  };

  // Add to cart
  if (window.cart && window.cart.addToCart) {
    window.cart.addToCart(cartItem);

    // Show toast notification
    if (window.cartUI && window.cartUI.showToast) {
      window.cartUI.showToast(`Added "${title}" to cart`);
    }
  } else {
    console.error('Cart not available');
    alert('Cart system is not initialized. Please refresh the page.');
  }
}

// ============================================================================
// STRIPE CHECKOUT INTEGRATION
// ============================================================================

function initiateStripeCheckout(photoData, materialKey, size) {
  const { id, title, dimensions } = photoData;
  const material = MATERIALS[materialKey];
  const price = calculatePrice(materialKey, size.inches);
  const priceInCents = price * 100;

  // Create line item for Stripe
  const lineItem = {
    price_data: {
      currency: 'usd',
      product_data: {
        name: `${title} - ${material.name}`,
        description: `${size.width}" × ${size.height}" Print`,
        metadata: {
          photoId: id,
          material: materialKey,
          width: size.width.toString(),
          height: size.height.toString(),
          originalPhotoWidth: dimensions.width.toString(),
          originalPhotoHeight: dimensions.height.toString(),
          dpi: calculateDPI(
            dimensions.width,
            dimensions.height,
            size.width,
            size.height
          ).toString()
        }
      },
      unit_amount: priceInCents
    },
    quantity: 1
  };

  // Create checkout session (requires backend endpoint)
  const checkoutData = {
    lineItems: [lineItem],
    successUrl: `${window.location.origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: window.location.href,
    pictorem: {
      photoId: id,
      photoTitle: title,
      photoFilename: photoData.filename || id,
      material: materialKey,
      dimensions: {
        width: size.width,
        height: size.height,
        originalWidth: dimensions.width,
        originalHeight: dimensions.height,
        dpi: calculateDPI(dimensions.width, dimensions.height, size.width, size.height)
      }
    }
  };

  // Close the modal while processing
  const modal = document.getElementById('product-selector-modal');
  const checkoutBtn = modal?.querySelector('#checkout-button');
  if (checkoutBtn) {
    checkoutBtn.textContent = 'Processing...';
    checkoutBtn.disabled = true;
  }

  // Try Stripe checkout first, fall back to contact form
  // Use pages.dev endpoint for API calls (custom domain function routing may lag)
  const apiBase = 'https://archive-35-com.pages.dev';
  fetch(`${apiBase}/api/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(checkoutData)
  })
    .then((res) => {
      if (!res.ok) throw new Error('Checkout endpoint not available');
      return res.json();
    })
    .then((data) => {
      // Prefer direct URL redirect (Stripe's recommended approach)
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      // Fallback to redirectToCheckout for older integration
      if (data.sessionId && window.Stripe && window.STRIPE_PUBLIC_KEY) {
        window.Stripe(window.STRIPE_PUBLIC_KEY).redirectToCheckout({
          sessionId: data.sessionId
        });
      } else {
        throw new Error('Stripe not configured');
      }
    })
    .catch((err) => {
      console.warn('Stripe checkout unavailable, redirecting to contact form:', err.message);
      // Fallback: redirect to contact page with order details
      const orderSummary = encodeURIComponent(
        `I would like to order:\n\nPhoto: ${title}\nMaterial: ${material.name}\nSize: ${size.width}" \u00d7 ${size.height}"\nPrice: $${price}\n\nPlease send me a payment link.`
      );
      window.location.href = `contact.html?message=${orderSummary}`;
    });
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Open product selector modal for a photo
 * @param {Object} photoData - Photo object from photos.json with dimensions
 */
function openProductSelector(photoData) {
  // Inject styles if not already present
  if (!document.getElementById('product-selector-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'product-selector-styles';
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);
  }

  // Close existing modal if open
  const existing = document.getElementById('product-selector-modal');
  if (existing) {
    existing.remove();
  }

  // Validate dimensions exist
  if (!photoData.dimensions) {
    console.warn('Product selector: photo missing dimensions', photoData.id || photoData.title);
    alert('Print ordering is not available for this photo yet. Dimensions data is missing.');
    return;
  }

  // Create new modal
  const { modal, category, applicableSizes } =
    createProductSelectorModal(photoData);

  // Add to page
  document.body.appendChild(modal);

  // Setup events
  setupProductSelectorEvents(modal, category, applicableSizes, photoData);

  // Trigger transition animation
  setTimeout(() => {
    modal.classList.add('visible');
  }, 10);
}

// ============================================================================
// STYLES (should be in separate CSS file, but included here for reference)
// ============================================================================

const STYLES = `
  /* Product Selector Modal */
  .product-selector-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  .product-selector-modal.visible {
    opacity: 1;
  }

  .product-selector-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    cursor: pointer;
  }

  .product-selector-content {
    position: relative;
    background: #1a1a1a;
    color: #fff;
    border-radius: 12px;
    max-width: 800px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }

  .close-button {
    position: absolute;
    top: 16px;
    right: 16px;
    background: none;
    border: none;
    color: #c4973b;
    font-size: 28px;
    cursor: pointer;
    z-index: 10001;
    padding: 0;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-button:hover {
    opacity: 0.8;
  }

  .selector-header {
    padding: 32px 24px 24px;
    border-bottom: 1px solid #333;
  }

  .selector-header h2 {
    margin: 0 0 8px 0;
    font-size: 24px;
    color: #fff;
  }

  .selector-subtitle {
    margin: 0;
    font-size: 14px;
    color: #999;
  }

  .selector-body {
    padding: 24px;
  }

  .material-section,
  .size-section {
    margin-bottom: 32px;
  }

  .material-section h3,
  .size-section h3 {
    margin: 0 0 16px 0;
    font-size: 16px;
    color: #c4973b;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .material-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
  }

  .material-option {
    position: relative;
  }

  .material-option input[type='radio'] {
    position: absolute;
    opacity: 0;
  }

  .material-option label {
    display: block;
    padding: 16px;
    border: 2px solid #333;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    background: #222;
  }

  .material-option input[type='radio']:checked + label {
    border-color: #c4973b;
    background: rgba(196, 151, 59, 0.1);
  }

  .material-name {
    font-weight: 600;
    margin-bottom: 4px;
  }

  .material-description {
    font-size: 12px;
    color: #999;
    line-height: 1.3;
  }

  .size-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 12px;
  }

  .size-option {
    position: relative;
  }

  .size-option input[type='radio'] {
    position: absolute;
    opacity: 0;
  }

  .size-option label {
    display: block;
    padding: 12px;
    border: 2px solid #333;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    background: #222;
    text-align: center;
  }

  .size-option input[type='radio']:checked + label {
    border-color: #c4973b;
    background: rgba(196, 151, 59, 0.1);
  }

  .size-dimensions {
    font-weight: 600;
    margin-bottom: 4px;
  }

  .size-dpi {
    font-size: 12px;
    color: #999;
    margin-bottom: 4px;
  }

  .quality-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 8px;
    border-radius: 4px;
    margin-bottom: 6px;
    display: inline-block;
  }

  .quality-museum {
    background: rgba(76, 175, 80, 0.2);
    color: #4caf50;
  }

  .quality-excellent {
    background: rgba(255, 193, 7, 0.2);
    color: #ffc107;
  }

  .quality-good {
    background: rgba(33, 150, 243, 0.2);
    color: #2196f3;
  }

  .size-price {
    font-weight: 600;
    color: #c4973b;
  }

  .price-summary {
    background: #222;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 16px;
    margin: 24px 0;
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    font-size: 14px;
    color: #ccc;
  }

  .summary-row.total {
    border-top: 1px solid #333;
    padding-top: 12px;
    margin-top: 12px;
    font-size: 18px;
    font-weight: 600;
    color: #c4973b;
  }

  .product-info {
    background: rgba(196, 151, 59, 0.05);
    border-left: 3px solid #c4973b;
    padding: 16px;
    margin: 24px 0;
    border-radius: 4px;
  }

  .info-item {
    font-size: 13px;
    line-height: 1.6;
    margin-bottom: 8px;
  }

  .info-item:last-child {
    margin-bottom: 0;
  }

  .product-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 8px;
  }

  .add-to-cart-button,
  .buy-now-button {
    padding: 14px 24px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .add-to-cart-button {
    background: #c4973b;
    color: #000;
  }

  .add-to-cart-button:not(:disabled):hover {
    background: #d4a755;
    transform: translateY(-2px);
  }

  .buy-now-button {
    background: transparent;
    color: #c4973b;
    border: 1px solid #c4973b;
  }

  .buy-now-button:not(:disabled):hover {
    background: rgba(196, 151, 59, 0.1);
    border-color: #d4a755;
    color: #d4a755;
    transform: translateY(-2px);
  }

  .add-to-cart-button:disabled,
  .buy-now-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 600px) {
    .product-actions {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 600px) {
    .product-selector-content {
      width: 95%;
    }

    .material-grid {
      grid-template-columns: 1fr;
    }

    .size-grid {
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    }
  }
`;

// ============================================================================
// LIGHTBOX INTEGRATION
// ============================================================================

/**
 * Hook into the lightbox "Buy Print" button to open the product selector.
 * Compatible with the existing gallery lightbox in js/main.js.
 */
function replaceLightboxBuyButton() {
  const buyBtn = document.querySelector('.lightbox-buy');
  if (buyBtn && !buyBtn.dataset.selectorAttached) {
    buyBtn.removeAttribute('href');
    buyBtn.removeAttribute('target');
    buyBtn.textContent = 'Order Print';
    buyBtn.dataset.selectorAttached = 'true';

    buyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const photo = window.filteredPhotos?.[window.currentPhotoIndex];
      if (photo) {
        if (typeof closeLightbox === 'function') closeLightbox();
        if (typeof window.closeLightbox === 'function') window.closeLightbox();
        setTimeout(() => openProductSelector(photo), 100);
      }
    });
  }
}

// Auto-init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  // Watch for lightbox creation and attach the buy button handler
  const observer = new MutationObserver(() => {
    replaceLightboxBuyButton();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Also try immediately and after delays for reliability
  setTimeout(replaceLightboxBuyButton, 100);
  setTimeout(replaceLightboxBuyButton, 500);
});

// ============================================================================
// EXPORT FOR USE
// ============================================================================

// If using modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    openProductSelector,
    ASPECT_RATIO_CATEGORIES,
    MATERIALS,
    calculatePrice,
    calculateDPI,
    getQualityBadge
  };
}

// Global scope
window.openProductSelector = openProductSelector;
window.ProductSelector = { open: openProductSelector, close: () => {
  const modal = document.getElementById('product-selector-modal');
  if (modal) modal.remove();
}};
window.PRODUCT_SELECTOR = {
  openProductSelector,
  ASPECT_RATIO_CATEGORIES,
  MATERIALS,
  calculatePrice,
  calculateDPI,
  getQualityBadge
};
