/**
 * ARCHIVE-35 Product Selector
 * Pictorem Print-on-Demand Integration
 */

// ===== Product Configuration =====
// Markup: 2.5x wholesale for all products (60% margin)
const MARKUP = 2.5;

const PRODUCTS = {
  canvas: {
    name: 'Canvas',
    description: 'Gallery-wrapped canvas with 1.5" depth',
    features: ['Satin finish', 'Museum-quality', 'Ready to hang'],
    basePrices: { // Wholesale prices (USD) from Pictorem
      '12x8': 42, '16x12': 56, '20x16': 68, '24x16': 76,
      '24x18': 82, '30x20': 98, '36x24': 122, '40x30': 148,
      '48x32': 178, '60x40': 228
    },
    markup: MARKUP,
    leadTime: '5-7'
  },
  metal: {
    name: 'Metal',
    description: 'HD sublimation on brushed aluminum',
    features: ['Vivid colors', 'Float mount included', 'Modern look'],
    basePrices: {
      '12x8': 52, '16x12': 72, '20x16': 88, '24x16': 96,
      '24x18': 104, '30x20': 128, '36x24': 158, '40x30': 198,
      '48x32': 248, '60x40': 328
    },
    markup: MARKUP,
    leadTime: '10-14'
  },
  acrylic: {
    name: 'Acrylic',
    description: 'Face-mounted on 1/4" crystal-clear acrylic',
    features: ['Luminous depth', 'Float mount included', 'Gallery finish'],
    basePrices: {
      '12x8': 78, '16x12': 102, '20x16': 128, '24x16': 138,
      '24x18': 148, '30x20': 188, '36x24': 238, '40x30': 298,
      '48x32': 378, '60x40': 498
    },
    markup: MARKUP,
    leadTime: '10-14'
  },
  paper: {
    name: 'Fine Art Paper',
    description: 'Archival Hahnemühle Photo Rag 308gsm',
    features: ['Museum quality', 'Acid-free', 'Unframed'],
    basePrices: {
      '12x8': 24, '16x12': 32, '20x16': 38, '24x16': 42,
      '24x18': 46, '30x20': 58, '36x24': 72, '40x30': 92,
      '48x32': 118, '60x40': 158
    },
    markup: MARKUP,
    leadTime: '5-7'
  },
  wood: {
    name: 'Wood',
    description: 'HD print on natural birch wood panel',
    features: ['Organic texture', 'Ready to hang', 'Eco-friendly'],
    basePrices: {
      '12x8': 48, '16x12': 62, '20x16': 72, '24x16': 76,
      '24x18': 82, '30x20': 98, '36x24': 122, '40x30': 148
    },
    markup: MARKUP,
    leadTime: '10-14'
  }
};

const SIZES = [
  { id: '12x8', label: '12" × 8"', category: 'small' },
  { id: '16x12', label: '16" × 12"', category: 'small' },
  { id: '20x16', label: '20" × 16"', category: 'medium' },
  { id: '24x16', label: '24" × 16"', category: 'medium', popular: true },
  { id: '24x18', label: '24" × 18"', category: 'medium' },
  { id: '30x20', label: '30" × 20"', category: 'large' },
  { id: '36x24', label: '36" × 24"', category: 'large', popular: true },
  { id: '40x30', label: '40" × 30"', category: 'xlarge' },
  { id: '48x32', label: '48" × 32"', category: 'xlarge' },
  { id: '60x40', label: '60" × 40"', category: 'xlarge' }
];

// ===== State =====
let selectorState = {
  photo: null,
  product: 'canvas',
  size: '24x16',
  isOpen: false
};

// ===== Initialize =====
function initProductSelector() {
  createSelectorModal();
  attachEventListeners();
}

// ===== Create Modal HTML =====
function createSelectorModal() {
  const modal = document.createElement('div');
  modal.id = 'product-selector';
  modal.className = 'product-selector';
  modal.innerHTML = `
    <div class="selector-backdrop"></div>
    <div class="selector-panel">
      <button class="selector-close" aria-label="Close">&times;</button>

      <div class="selector-header">
        <h2>Select Your Print</h2>
        <p class="selector-photo-title"></p>
      </div>

      <div class="selector-content">
        <!-- Preview -->
        <div class="selector-preview">
          <div class="preview-frame">
            <img class="preview-image" src="" alt="">
          </div>
          <div class="preview-scale">
            <span class="scale-indicator"></span>
          </div>
        </div>

        <!-- Options -->
        <div class="selector-options">
          <!-- Product Type -->
          <div class="option-group">
            <label class="option-label">Material</label>
            <div class="product-grid" id="product-options">
              ${Object.entries(PRODUCTS).map(([key, prod]) => `
                <button class="product-option ${key === 'canvas' ? 'active' : ''}" data-product="${key}">
                  <span class="product-name">${prod.name}</span>
                  <span class="product-from">from $${getMinPrice(key)}</span>
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Product Details -->
          <div class="product-details" id="product-details">
            <p class="product-description"></p>
            <ul class="product-features"></ul>
          </div>

          <!-- Size -->
          <div class="option-group">
            <label class="option-label">Size</label>
            <div class="size-grid" id="size-options"></div>
          </div>

          <!-- Summary -->
          <div class="selector-summary">
            <div class="summary-row">
              <span>Production Time</span>
              <span id="lead-time">10 business days</span>
            </div>
            <div class="summary-row">
              <span>Shipping</span>
              <span>Free (USA/Canada)</span>
            </div>
            <div class="summary-price">
              <span>Total</span>
              <span id="total-price">$169</span>
            </div>
          </div>

          <!-- Terms Checkbox -->
          <div class="terms-checkbox">
            <label>
              <input type="checkbox" id="terms-agree">
              <span>I agree to the <a href="terms.html" target="_blank">Terms of Sale</a></span>
            </label>
          </div>

          <!-- CTA -->
          <button class="btn btn-primary selector-buy" id="buy-button" disabled>
            Complete Purchase
          </button>
          <p class="selector-note">Secure checkout via Stripe • All sales final</p>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

// ===== Event Listeners =====
function attachEventListeners() {
  const modal = document.getElementById('product-selector');

  // Close button
  modal.querySelector('.selector-close').addEventListener('click', closeSelector);

  // Backdrop click
  modal.querySelector('.selector-backdrop').addEventListener('click', closeSelector);

  // Product options
  modal.querySelector('#product-options').addEventListener('click', (e) => {
    const option = e.target.closest('.product-option');
    if (option) {
      selectorState.product = option.dataset.product;
      updateSelector();
    }
  });

  // Size options (delegated)
  modal.querySelector('#size-options').addEventListener('click', (e) => {
    const option = e.target.closest('.size-option');
    if (option && !option.classList.contains('disabled')) {
      selectorState.size = option.dataset.size;
      updateSelector();
    }
  });

  // Terms checkbox - enable/disable buy button
  modal.querySelector('#terms-agree').addEventListener('change', (e) => {
    modal.querySelector('#buy-button').disabled = !e.target.checked;
  });

  // Buy button
  modal.querySelector('#buy-button').addEventListener('click', handleBuy);

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectorState.isOpen) {
      closeSelector();
    }
  });
}

// ===== Open Selector =====
function openSelector(photo) {
  selectorState.photo = photo;
  selectorState.isOpen = true;

  const modal = document.getElementById('product-selector');
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';

  // Set photo info
  modal.querySelector('.selector-photo-title').textContent = photo.title;
  modal.querySelector('.preview-image').src = photo.full || photo.thumbnail;

  updateSelector();
}

// ===== Close Selector =====
function closeSelector() {
  selectorState.isOpen = false;
  const modal = document.getElementById('product-selector');
  modal.classList.remove('active');
  document.body.style.overflow = '';
}

// ===== Update Selector UI =====
function updateSelector() {
  const product = PRODUCTS[selectorState.product];
  const modal = document.getElementById('product-selector');

  // Update product selection
  modal.querySelectorAll('.product-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.product === selectorState.product);
  });

  // Update product details
  modal.querySelector('.product-description').textContent = product.description;
  modal.querySelector('.product-features').innerHTML =
    product.features.map(f => `<li>${f}</li>`).join('');

  // Update size options
  const sizeGrid = modal.querySelector('#size-options');
  sizeGrid.innerHTML = SIZES.map(size => {
    const hasSize = product.basePrices[size.id];
    const price = hasSize ? getPrice(selectorState.product, size.id) : null;
    const isActive = size.id === selectorState.size && hasSize;

    return `
      <button class="size-option ${isActive ? 'active' : ''} ${!hasSize ? 'disabled' : ''}"
              data-size="${size.id}" ${!hasSize ? 'disabled' : ''}>
        <span class="size-label">${size.label}</span>
        <span class="size-price">${price ? '$' + price : '—'}</span>
        ${size.popular ? '<span class="size-popular">Popular</span>' : ''}
      </button>
    `;
  }).join('');

  // If current size not available, select first available
  if (!product.basePrices[selectorState.size]) {
    const firstAvailable = SIZES.find(s => product.basePrices[s.id]);
    if (firstAvailable) {
      selectorState.size = firstAvailable.id;
      updateSelector();
      return;
    }
  }

  // Update summary
  modal.querySelector('#lead-time').textContent = `${product.leadTime} business days`;
  modal.querySelector('#total-price').textContent = '$' + getPrice(selectorState.product, selectorState.size);

  // Update scale indicator
  const [width] = selectorState.size.split('x').map(Number);
  const scalePercent = Math.min(100, (width / 60) * 100);
  modal.querySelector('.scale-indicator').style.width = scalePercent + '%';
}

// ===== Price Calculations =====
function getPrice(productKey, sizeKey) {
  const product = PRODUCTS[productKey];
  const basePrice = product.basePrices[sizeKey];
  if (!basePrice) return null;
  return Math.round(basePrice * product.markup);
}

function getMinPrice(productKey) {
  const product = PRODUCTS[productKey];
  const minBase = Math.min(...Object.values(product.basePrices));
  return Math.round(minBase * product.markup);
}

// ===== Stripe Payment Links =====
// Configure your Stripe Payment Links here after creating them in the Stripe Dashboard
// Format: STRIPE_LINKS[photoId][product][size] = 'https://buy.stripe.com/xxx'
// Example: STRIPE_LINKS['WOLF7301']['canvas']['24x16'] = 'https://buy.stripe.com/abc123'
const STRIPE_LINKS = {
  // Add your Stripe Payment Links here:
  // 'photo-id': {
  //   'canvas': { '24x16': 'https://buy.stripe.com/xxx', '36x24': 'https://buy.stripe.com/yyy' },
  //   'metal': { '24x16': 'https://buy.stripe.com/zzz' },
  // }
};

// Fallback: Generic payment link or contact form
const FALLBACK_ACTION = 'contact'; // 'contact' or a Stripe link URL

// ===== Handle Purchase =====
function handleBuy() {
  const photo = selectorState.photo;
  const product = PRODUCTS[selectorState.product];
  const size = selectorState.size;
  const price = getPrice(selectorState.product, size);

  // Check if terms are accepted
  const termsAccepted = document.getElementById('terms-agree').checked;
  if (!termsAccepted) {
    alert('Please accept the Terms of Sale to continue.');
    return;
  }

  // Log order for analytics
  const orderData = {
    photoId: photo.id,
    photoTitle: photo.title,
    product: selectorState.product,
    productName: product.name,
    size: size,
    price: price,
    termsAccepted: true,
    timestamp: new Date().toISOString()
  };
  console.log('Order initiated:', orderData);

  // Check for specific Stripe Payment Link
  const stripeLink = STRIPE_LINKS[photo.id]?.[selectorState.product]?.[size];

  if (stripeLink) {
    // Redirect to Stripe Payment Link
    window.location.href = stripeLink;
  } else {
    // Fallback: redirect to contact with order details
    const orderSummary = encodeURIComponent(
      `I would like to order:\n\nPhoto: ${photo.title}\nMaterial: ${product.name}\nSize: ${size}\nPrice: $${price}\n\nPlease send me a payment link.`
    );
    window.location.href = `contact.html?message=${orderSummary}`;
  }
}

// ===== Integration with Lightbox =====
function replaceLightboxBuyButton() {
  // Replace the simple "Buy Print" link with selector trigger
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
        setTimeout(() => openSelector(photo), 100);
      }
    });
  }
}

// ===== Init on DOM Ready =====
document.addEventListener('DOMContentLoaded', () => {
  initProductSelector();

  // Wait for lightbox to init, then replace buy button
  // Use MutationObserver for reliability
  const observer = new MutationObserver(() => {
    replaceLightboxBuyButton();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Also try immediately and after delays
  setTimeout(replaceLightboxBuyButton, 100);
  setTimeout(replaceLightboxBuyButton, 500);
});

// ===== Export for external use =====
window.ProductSelector = {
  open: openSelector,
  close: closeSelector
};
