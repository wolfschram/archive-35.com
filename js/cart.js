/**
 * ARCHIVE-35 SHOPPING CART
 *
 * Manages shopping cart state and operations.
 * - Cart data persists in localStorage
 * - Emits custom events when cart changes
 * - Works with Stripe Checkout for multi-item purchases
 */

class ShoppingCart {
  constructor() {
    this.storageKey = 'archive35_cart';
    this.cart = this.loadCart();
    this.setupEventListeners();
  }

  /**
   * Load cart from localStorage
   */
  loadCart() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Error loading cart:', e);
      return [];
    }
  }

  /**
   * Save cart to localStorage and emit change event
   */
  saveCart() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.cart));
      this.emitChange();
    } catch (e) {
      console.error('Error saving cart:', e);
    }
  }

  /**
   * Add item to cart
   * @param {Object} item - { photoId, title, material, size, price, thumbnail, stripePrice }
   */
  addToCart(item) {
    // Validate required fields
    if (!item.photoId || !item.title || !item.material || !item.size || !item.price) {
      console.error('Invalid cart item:', item);
      return false;
    }

    // Auth gate — require login before adding to cart
    const auth = typeof window.getAuthState === 'function' ? window.getAuthState() : null;
    const riedelUser = (() => {
      try { return JSON.parse(localStorage.getItem('riedel_user') || 'null'); } catch { return null; }
    })();
    const isLoggedIn = (auth && auth.email) || (riedelUser && riedelUser.email);

    if (!isLoggedIn) {
      // Store pending item, then trigger login
      this._pendingCartItem = item;
      this._showAuthGate();
      return false;
    }

    return this._doAddToCart(item);
  }

  /**
   * Internal add — called after auth is confirmed
   */
  _doAddToCart(item) {
    // Validate metadata for checkout integrity
    if (!item.metadata) {
      console.warn('[ARCHIVE-35] Cart item missing metadata object — checkout may have incomplete fulfillment data:', item.photoId);
    } else {
      const required = ['photoId', 'material', 'width', 'height'];
      const missing = required.filter(f => !item.metadata[f]);
      if (missing.length > 0) {
        console.warn('[ARCHIVE-35] Cart item metadata incomplete:', missing.join(', '), 'for', item.photoId);
      }
    }

    // Add to cart array
    const cartItem = {
      id: this.generateItemId(),
      ...item,
      addedAt: new Date().toISOString()
    };
    this.cart.push(cartItem);

    this.saveCart();
    this.fireCartEvent('cart_add', cartItem);

    // Track event
    if (window.A35Track) {
      window.A35Track.event('cart_add', {
        photoId: item.photoId,
        title: item.title,
        material: item.material,
        size: item.size,
        price: item.price,
        frame: item.metadata?.frame || '',
        border: item.metadata?.mat || ''
      });
    }

    return true;
  }

  /**
   * Show auth gate modal — name + email, then auto-add pending item
   */
  _showAuthGate() {
    // Remove existing modal if any
    const existing = document.getElementById('a35-auth-gate');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'a35-auth-gate';
    modal.innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;" id="a35-auth-overlay">
        <div style="background:#111;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:32px;max-width:400px;width:90%;text-align:center;">
          <h3 style="color:#fcfcfc;margin:0 0 8px;font-size:18px;font-weight:400;">Sign in to continue</h3>
          <p style="color:#888;font-size:13px;margin:0 0 24px;line-height:1.5;">Enter your name and email to add items to your cart. We'll send you a magic link to verify.</p>
          <input type="text" id="a35-auth-name" placeholder="Your name" style="width:100%;box-sizing:border-box;padding:12px 16px;background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#fff;font-size:14px;margin-bottom:12px;outline:none;" />
          <input type="email" id="a35-auth-email" placeholder="Your email" style="width:100%;box-sizing:border-box;padding:12px 16px;background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#fff;font-size:14px;margin-bottom:16px;outline:none;" />
          <div id="a35-auth-error" style="color:#e55;font-size:12px;margin-bottom:12px;display:none;"></div>
          <button id="a35-auth-submit" style="width:100%;padding:14px;background:#e8b84d;color:#0a0a0a;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;letter-spacing:0.03em;">Continue</button>
          <button id="a35-auth-cancel" style="width:100%;padding:10px;background:transparent;color:#666;border:none;font-size:12px;cursor:pointer;margin-top:8px;">Cancel</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    const self = this;
    const overlay = document.getElementById('a35-auth-overlay');
    const submitBtn = document.getElementById('a35-auth-submit');
    const cancelBtn = document.getElementById('a35-auth-cancel');
    const nameInput = document.getElementById('a35-auth-name');
    const emailInput = document.getElementById('a35-auth-email');
    const errorEl = document.getElementById('a35-auth-error');

    cancelBtn.addEventListener('click', () => {
      self._pendingCartItem = null;
      modal.remove();
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        self._pendingCartItem = null;
        modal.remove();
      }
    });

    submitBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const email = emailInput.value.trim();

      if (!name) {
        errorEl.textContent = 'Please enter your name.';
        errorEl.style.display = '';
        nameInput.focus();
        return;
      }
      if (!email || !email.includes('@')) {
        errorEl.textContent = 'Please enter a valid email address.';
        errorEl.style.display = '';
        emailInput.focus();
        return;
      }

      errorEl.style.display = 'none';
      submitBtn.textContent = 'Sending link...';
      submitBtn.disabled = true;

      try {
        const apiBase = 'https://archive-35-com.pages.dev';
        const resp = await fetch(apiBase + '/api/auth/send-magic-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, name })
        });

        if (resp.ok) {
          // Store identity locally so cart works immediately
          // (magic link verifies later, but we trust the email for cart purposes)
          localStorage.setItem('a35_user', JSON.stringify({ name, email, ts: Date.now() }));

          // Make auth state available globally
          if (!window._a35AuthOverride) {
            window._a35AuthOverride = { name, email };
            const origGetAuth = window.getAuthState;
            window.getAuthState = function() {
              const real = origGetAuth ? origGetAuth() : {};
              if (real && real.email) return real;
              return window._a35AuthOverride || {};
            };
          } else {
            window._a35AuthOverride = { name, email };
          }

          // Auto-add the pending item
          if (self._pendingCartItem) {
            const pending = self._pendingCartItem;
            self._pendingCartItem = null;
            self._doAddToCart(pending);

            if (window.cartUI && window.cartUI.showToast) {
              window.cartUI.showToast('Added "' + pending.title + '" to cart');
            }
          }

          // Show success message
          submitBtn.textContent = 'Check your email for the login link';
          submitBtn.style.background = '#4a9';
          setTimeout(() => modal.remove(), 2500);
        } else {
          errorEl.textContent = 'Something went wrong. Please try again.';
          errorEl.style.display = '';
          submitBtn.textContent = 'Continue';
          submitBtn.disabled = false;
        }
      } catch (err) {
        errorEl.textContent = 'Connection error. Please try again.';
        errorEl.style.display = '';
        submitBtn.textContent = 'Continue';
        submitBtn.disabled = false;
      }
    });

    nameInput.focus();
  }

  /**
   * Remove item from cart by index
   */
  removeFromCart(index) {
    if (index >= 0 && index < this.cart.length) {
      const removed = this.cart[index];
      this.cart.splice(index, 1);
      this.saveCart();
      this.fireCartEvent('cart_remove', removed);
      if (window.A35Track) {
        window.A35Track.event('cart_remove', { photoId: removed.photoId, title: removed.title });
      }
      return true;
    }
    return false;
  }

  /**
   * Get all cart items
   */
  getCart() {
    return [...this.cart];
  }

  /**
   * Get number of items in cart
   */
  getCartCount() {
    return this.cart.length;
  }

  /**
   * Get total cart price
   */
  getCartTotal() {
    return this.cart.reduce((sum, item) => sum + (item.price || 0), 0);
  }

  /**
   * Clear entire cart
   */
  clearCart() {
    this.fireCartEvent('cart_clear', null);
    this.cart = [];
    this.saveCart();
  }

  /**
   * Check if cart is empty
   */
  isEmpty() {
    return this.cart.length === 0;
  }

  /**
   * Generate unique item ID
   */
  generateItemId() {
    return `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Fire cart event to /api/cart-event (non-blocking)
   * @param {string} eventType - cart_add, cart_remove, cart_clear, cart_abandoned
   * @param {Object} item - the cart item involved (optional)
   */
  fireCartEvent(eventType, item) {
    try {
      // Get Riedel user identity if available
      const riedelUser = (() => {
        try { return JSON.parse(localStorage.getItem('riedel_user') || 'null'); } catch { return null; }
      })();
      const authState = typeof window.getAuthState === 'function' ? window.getAuthState() : {};

      const payload = {
        eventType: eventType,
        timestamp: new Date().toISOString(),
        sessionId: this._sessionId || (this._sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)),
        userName: (riedelUser && riedelUser.name) || authState.name || '',
        userEmail: (riedelUser && riedelUser.email) || authState.email || '',
        photoTitle: (item && item.title) || '',
        photoId: (item && (item.photoId || (item.metadata && item.metadata.photoId))) || '',
        photoFilename: (item && item.metadata && item.metadata.photoFilename) || '',
        collection: (item && item.metadata && item.metadata.collection) || '',
        material: (item && item.material) || '',
        size: (item && item.size) || '',
        options: item && item.metadata ? [
          item.metadata.subtype || '',
          item.metadata.frame || '',
          item.metadata.mounting || '',
        ].filter(Boolean).join(', ') : '',
        scene: (item && item.metadata && item.metadata.scene) || '',
        zone: (item && item.metadata && item.metadata.zone) || '',
        price: (item && item.price) || '',
        cartTotal: this.getCartTotal(),
        cartCount: this.getCartCount(),
        pageUrl: window.location.pathname,
      };

      fetch('/api/cart-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {}); // Fire and forget
    } catch (e) {
      // Never block cart operations
    }
  }

  /**
   * Emit custom change event
   */
  emitChange() {
    const event = new CustomEvent('cartChanged', {
      detail: {
        cart: this.getCart(),
        count: this.getCartCount(),
        total: this.getCartTotal()
      }
    });
    document.dispatchEvent(event);
  }

  /**
   * Setup global event listeners
   */
  setupEventListeners() {
    // Sync cart across tabs/windows
    window.addEventListener('storage', (e) => {
      if (e.key === this.storageKey) {
        this.cart = this.loadCart();
        this.emitChange();
      }
    });
  }
}

// Initialize global cart instance
window.cart = new ShoppingCart();

// Expose for external use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ShoppingCart;
}
