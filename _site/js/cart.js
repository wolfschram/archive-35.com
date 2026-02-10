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

    // Add to cart array
    this.cart.push({
      id: this.generateItemId(),
      ...item,
      addedAt: new Date().toISOString()
    });

    this.saveCart();
    return true;
  }

  /**
   * Remove item from cart by index
   */
  removeFromCart(index) {
    if (index >= 0 && index < this.cart.length) {
      this.cart.splice(index, 1);
      this.saveCart();
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
