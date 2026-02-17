/**
 * ARCHIVE-35 Auth UI
 *
 * Adds account icon to the header nav.
 * Checks session state and updates icon accordingly.
 * - Logged out: shows person icon → links to login
 * - Logged in: shows person icon with dot → links to account
 */

(function() {
  'use strict';

  let authState = { loggedIn: false, email: '', name: '' };

  /**
   * Check session status
   */
  async function checkSession() {
    try {
      const resp = await fetch('/api/auth/session', { credentials: 'include' });
      if (resp.ok) {
        authState = await resp.json();
      }
    } catch (e) {
      // Silent fail — default to logged out
    }
    updateAuthIcon();
  }

  /**
   * Create and insert the account icon into the header
   */
  function createAuthIcon() {
    const nav = document.querySelector('.nav');
    if (!nav) return;

    const btn = document.createElement('a');
    btn.className = 'account-icon-btn';
    btn.id = 'account-icon-btn';
    btn.setAttribute('aria-label', 'My Account');
    btn.href = '/login.html'; // Default to login

    btn.innerHTML = `
      <svg class="account-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
      <span class="account-dot" id="account-dot" style="display:none;"></span>
    `;

    // Insert after the cart icon if it exists, otherwise after nav
    const cartBtn = document.getElementById('cart-icon-btn');
    if (cartBtn) {
      cartBtn.parentNode.insertBefore(btn, cartBtn.nextSibling);
    } else {
      nav.parentNode.insertBefore(btn, nav.nextSibling);
    }
  }

  /**
   * Update icon based on auth state
   */
  function updateAuthIcon() {
    const btn = document.getElementById('account-icon-btn');
    const dot = document.getElementById('account-dot');
    if (!btn) return;

    if (authState.loggedIn) {
      btn.href = '/account.html';
      btn.setAttribute('aria-label', `Account: ${authState.email}`);
      if (dot) dot.style.display = 'block';
    } else {
      btn.href = '/login.html';
      btn.setAttribute('aria-label', 'Sign In');
      if (dot) dot.style.display = 'none';
    }
  }

  /**
   * Expose auth state for other modules (e.g., cart-ui checkout)
   */
  window.getAuthState = function() {
    return authState;
  };

  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    createAuthIcon();
    checkSession();
  });

})();
