/**
 * ARCHIVE-35 CART UI
 *
 * Manages the cart slide-out panel and interactions.
 * - Cart icon with badge in header
 * - Slide-out panel from right side
 * - Toast notifications
 */

class CartUI {
  constructor() {
    this.isOpen = false;
    this.init();
  }

  init() {
    this.createCartIcon();
    this.createCartPanel();
    this.setupEventListeners();
    this.updateBadge();
  }

  /**
   * Create cart icon in header
   */
  createCartIcon() {
    const nav = document.querySelector('.nav');
    if (!nav) {
      console.warn('Cart UI: .nav element not found');
      return;
    }

    // Create cart button
    const cartBtn = document.createElement('button');
    cartBtn.className = 'cart-icon-btn';
    cartBtn.id = 'cart-icon-btn';
    cartBtn.setAttribute('aria-label', 'Shopping cart');

    // SVG shopping bag icon
    cartBtn.innerHTML = `
      <svg class="cart-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M9 3H5a2 2 0 00-2 2v1h18V5a2 2 0 00-2-2h-4"/>
        <path d="M9 3v2h6V3M5 6h14v11a2 2 0 01-2 2H7a2 2 0 01-2-2V6z"/>
        <circle cx="9" cy="14" r="1.5" fill="currentColor"/>
        <circle cx="15" cy="14" r="1.5" fill="currentColor"/>
      </svg>
      <span class="cart-badge" id="cart-badge">0</span>
    `;

    // Insert after nav, or at the end if nav is last
    nav.parentNode.insertBefore(cartBtn, nav.nextSibling);

    cartBtn.addEventListener('click', () => this.togglePanel());
  }

  /**
   * Create cart slide-out panel
   */
  createCartPanel() {
    const panel = document.createElement('div');
    panel.className = 'cart-panel';
    panel.id = 'cart-panel';

    panel.innerHTML = `
      <div class="cart-panel-content">
        <div class="cart-panel-header">
          <h2>Shopping Cart</h2>
          <button class="cart-close-btn" aria-label="Close cart">&times;</button>
        </div>

        <div class="cart-panel-body">
          <div class="cart-empty-state" id="cart-empty">
            <p>Your cart is empty</p>
            <p class="cart-empty-hint">Start adding prints to get started</p>
          </div>

          <div class="cart-items" id="cart-items">
            <!-- Items populated here -->
          </div>
        </div>

        <div class="cart-panel-footer">
          <div class="cart-total">
            <span>Subtotal:</span>
            <span id="cart-total-price">$0</span>
          </div>
          <button class="cart-checkout-btn" id="cart-checkout-btn">
            Proceed to Checkout
          </button>
          <button class="cart-continue-shopping-btn" id="cart-continue-btn">
            Continue Shopping
          </button>
        </div>
      </div>

      <div class="cart-panel-overlay" id="cart-overlay"></div>
    `;

    document.body.appendChild(panel);

    // Setup event listeners
    const closeBtn = panel.querySelector('.cart-close-btn');
    const continueBtn = panel.querySelector('#cart-continue-btn');
    const overlay = panel.querySelector('#cart-overlay');

    closeBtn.addEventListener('click', () => this.closePanel());
    continueBtn.addEventListener('click', () => this.closePanel());
    overlay.addEventListener('click', () => this.closePanel());
  }

  /**
   * Toggle cart panel visibility
   */
  togglePanel() {
    if (this.isOpen) {
      this.closePanel();
    } else {
      this.openPanel();
    }
  }

  /**
   * Open cart panel
   */
  openPanel() {
    const panel = document.getElementById('cart-panel');
    if (!panel) return;

    this.isOpen = true;
    panel.classList.add('open');
    document.body.style.overflow = 'hidden';
    this.renderCart();
  }

  /**
   * Close cart panel
   */
  closePanel() {
    const panel = document.getElementById('cart-panel');
    if (!panel) return;

    this.isOpen = false;
    panel.classList.remove('open');
    document.body.style.overflow = '';
  }

  /**
   * Render cart items
   */
  renderCart() {
    const itemsContainer = document.getElementById('cart-items');
    const emptyState = document.getElementById('cart-empty');
    const checkoutBtn = document.getElementById('cart-checkout-btn');

    if (!itemsContainer) return;

    const items = window.cart.getCart();

    if (items.length === 0) {
      itemsContainer.innerHTML = '';
      emptyState.style.display = 'flex';
      checkoutBtn.disabled = true;
      return;
    }

    emptyState.style.display = 'none';
    checkoutBtn.disabled = false;

    itemsContainer.innerHTML = items
      .map((item, index) => this.createItemElement(item, index))
      .join('');

    // Add remove buttons event listeners
    itemsContainer.querySelectorAll('.cart-item-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.currentTarget.dataset.index);
        window.cart.removeFromCart(index);
        this.renderCart();
      });
    });

    this.updateTotal();
  }

  /**
   * Create HTML for a cart item
   */
  createItemElement(item, index) {
    const priceStr = `$${item.price.toFixed(2)}`;

    return `
      <div class="cart-item">
        <div class="cart-item-thumbnail">
          <img src="${item.thumbnail}" alt="${item.title}">
        </div>
        <div class="cart-item-details">
          <h4 class="cart-item-title">${this.escapeHtml(item.title)}</h4>
          <p class="cart-item-specs">
            ${this.escapeHtml(item.material)} • ${item.size}"
          </p>
          <p class="cart-item-price">${priceStr}</p>
        </div>
        <button class="cart-item-remove" data-index="${index}" aria-label="Remove item">
          &times;
        </button>
      </div>
    `;
  }

  /**
   * Update cart badge count
   */
  updateBadge() {
    const badge = document.getElementById('cart-badge');
    if (!badge) return;

    const count = window.cart.getCartCount();
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  }

  /**
   * Update total price display
   */
  updateTotal() {
    const totalEl = document.getElementById('cart-total-price');
    if (!totalEl) return;

    const total = window.cart.getCartTotal();
    totalEl.textContent = `$${total.toFixed(2)}`;
  }

  /**
   * Show toast notification
   */
  showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'cart-toast';
    toast.textContent = message;

    document.body.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Listen for cart changes
    document.addEventListener('cartChanged', (e) => {
      this.updateBadge();
      if (this.isOpen) {
        this.renderCart();
      }
    });

    // Checkout button
    document.addEventListener('click', (e) => {
      if (e.target.id === 'cart-checkout-btn') {
        this.handleCheckout();
      }
    });
  }

  /**
   * Handle checkout with Stripe
   */
  handleCheckout() {
    const items = window.cart.getCart();

    if (items.length === 0) {
      this.showToast('Your cart is empty');
      return;
    }

    // Build line items with dynamic price_data (server-side checkout)
    const lineItems = items.map((item) => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${item.title} - ${item.material}`,
          description: `${item.size} Print`,
          metadata: item.metadata || {}
        },
        unit_amount: Math.round(item.price * 100)
      },
      quantity: 1
    }));

    // Build Pictorem metadata with robust fallbacks (never null)
    const firstItem = items[0];
    const meta = firstItem.metadata || {};

    // Parse size string (e.g., "24 × 16") for fallback dimensions
    let fallbackWidth = 0, fallbackHeight = 0;
    if (firstItem.size) {
      const sizeParts = firstItem.size.replace(/["\s]/g, '').split(/[x×]/i);
      if (sizeParts.length === 2) {
        fallbackWidth = parseInt(sizeParts[0]) || 0;
        fallbackHeight = parseInt(sizeParts[1]) || 0;
      }
    }

    const pictorem = {
      photoId: meta.photoId || firstItem.photoId || 'unknown',
      photoTitle: firstItem.title || 'Untitled',
      photoFilename: meta.photoFilename || meta.photoId || firstItem.photoId || 'unknown',
      collection: meta.collection || '',
      material: meta.material || firstItem.material || '',
      dimensions: {
        width: parseInt(meta.width) || fallbackWidth,
        height: parseInt(meta.height) || fallbackHeight,
        originalWidth: parseInt(meta.originalPhotoWidth) || 0,
        originalHeight: parseInt(meta.originalPhotoHeight) || 0,
        dpi: parseInt(meta.dpi) || 0
      }
    };

    // Pre-checkout validation — log warnings for missing critical fields
    const missingFields = [];
    if (!pictorem.photoId || pictorem.photoId === 'unknown') missingFields.push('photoId');
    if (!pictorem.material) missingFields.push('material');
    if (!pictorem.dimensions.width) missingFields.push('printWidth');
    if (!pictorem.dimensions.height) missingFields.push('printHeight');
    if (missingFields.length > 0) {
      console.warn('[ARCHIVE-35] Checkout metadata incomplete:', missingFields.join(', '), pictorem);
    } else {
      console.log('[ARCHIVE-35] Checkout metadata validated OK:', pictorem.photoId, pictorem.material);
    }

    const checkoutBtn = document.getElementById('cart-checkout-btn');
    if (checkoutBtn) {
      checkoutBtn.disabled = true;
      checkoutBtn.textContent = 'Processing...';
    }

    // Detect test mode from Stripe public key prefix
    const isTestMode = window.STRIPE_PUBLIC_KEY && window.STRIPE_PUBLIC_KEY.startsWith('pk_test_');
    if (isTestMode) {
      console.log('[ARCHIVE-35] Cart checkout: test mode detected');
    }

    // Use server-side checkout via create-checkout-session API
    const apiBase = 'https://archive-35-com.pages.dev';
    fetch(`${apiBase}/api/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lineItems,
        successUrl: `${window.location.origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: window.location.href,
        pictorem,
        testMode: isTestMode || undefined
      })
    })
      .then((res) => {
        if (!res.ok) throw new Error('Checkout endpoint not available');
        return res.json();
      })
      .then((data) => {
        if (data.mode) {
          console.log(`[ARCHIVE-35] Checkout session created in ${data.mode.toUpperCase()} mode`);
        }
        if (data.url) {
          window.location.href = data.url;
        } else if (data.sessionId && window.Stripe && window.STRIPE_PUBLIC_KEY) {
          window.Stripe(window.STRIPE_PUBLIC_KEY).redirectToCheckout({ sessionId: data.sessionId });
        } else {
          throw new Error('No checkout URL returned');
        }
      })
      .catch((error) => {
        console.error('Stripe checkout error:', error);
        this.showToast('Checkout failed. Please try again.');
        if (checkoutBtn) {
          checkoutBtn.disabled = false;
          checkoutBtn.textContent = 'Proceed to Checkout';
        }
      });
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
}

// Initialize cart UI when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.cartUI = new CartUI();
});
