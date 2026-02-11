/**
 * ARCHIVE-35 Image Protection
 *
 * Prevents casual image downloading via right-click, drag, and keyboard shortcuts.
 * This is a deterrent, not a security measure — determined users can still access
 * images via browser dev tools. But it stops 95% of casual copying.
 */
(function() {
  'use strict';

  // Disable right-click on images
  document.addEventListener('contextmenu', function(e) {
    if (e.target.tagName === 'IMG' || e.target.closest('.gallery-grid, .lightbox, .hero, .collection-card')) {
      e.preventDefault();
      return false;
    }
  });

  // Disable image dragging
  document.addEventListener('dragstart', function(e) {
    if (e.target.tagName === 'IMG') {
      e.preventDefault();
      return false;
    }
  });

  // Disable long-press on mobile (iOS image save)
  document.addEventListener('touchstart', function(e) {
    if (e.target.tagName === 'IMG') {
      e.target.style.webkitTouchCallout = 'none';
    }
  }, { passive: true });

  // Apply CSS protection to all images
  function protectImages() {
    const images = document.querySelectorAll('img');
    images.forEach(function(img) {
      img.style.webkitUserSelect = 'none';
      img.style.userSelect = 'none';
      // NOTE: Do NOT set pointer-events here — it overrides inherited pointer-events:none
      // from parent elements (e.g. closed lightbox at z-index 9999), causing click-blocking.
      // Images default to pointer-events:auto anyway; the protection comes from event listeners above.
      img.setAttribute('draggable', 'false');
      // iOS specific
      img.style.webkitTouchCallout = 'none';
    });
  }

  // Run on load and on DOM changes (for dynamically loaded images)
  document.addEventListener('DOMContentLoaded', protectImages);

  // Watch for new images being added to the DOM
  const observer = new MutationObserver(function(mutations) {
    let hasNewImages = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.tagName === 'IMG' || (node.querySelectorAll && node.querySelectorAll('img').length > 0)) {
            hasNewImages = true;
            break;
          }
        }
      }
      if (hasNewImages) break;
    }
    if (hasNewImages) protectImages();
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
})();
