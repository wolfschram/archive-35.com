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
    return true;
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
