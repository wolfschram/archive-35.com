/**
 * CaFE Content Script — Runs on artist.callforentry.org pages.
 *
 * Handles: ping (connection check) and portfolio scraping.
 * Upload is handled by background.js via chrome.scripting.executeScript
 * with world:'MAIN' to run in the page's own JavaScript context.
 */

(() => {
  'use strict';

  // ── Message Handler ──────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'scrapePortfolio') {
      scrapePortfolio().then(sendResponse);
      return true;
    }

    if (msg.action === 'ping') {
      sendResponse({
        alive: true,
        url: window.location.href,
        onUploadPage: window.location.href.includes('media_upload.php'),
      });
      return false;
    }
  });

  // ── Portfolio Scraping ───────────────────────────────────────

  async function scrapePortfolio() {
    try {
      if (!window.location.href.includes('portfolio.php')) {
        return { success: false, error: 'Not on portfolio page' };
      }

      const images = [];
      const rows = document.querySelectorAll('tr, .portfolio-image, .media-item, [data-media-id]');
      rows.forEach(el => {
        const title = el.querySelector('.media-title, td:nth-child(2), .pf-title')?.textContent?.trim()
          || el.getAttribute('data-title') || '';
        const thumb = el.querySelector('img')?.src || '';
        if (title || thumb) images.push({ title, thumbnail: thumb });
      });

      if (images.length === 0) {
        document.querySelectorAll('img').forEach(img => {
          if (img.src.includes('media_') || img.src.includes('pf_')) {
            images.push({ title: img.alt || '', thumbnail: img.src });
          }
        });
      }

      return { success: true, images, pageUrl: window.location.href };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── Page Status Report ─────────────────────────────────────

  chrome.runtime.sendMessage({
    action: 'pageStatus',
    page: window.location.href.includes('portfolio.php') ? 'portfolio'
      : window.location.href.includes('media_upload.php') ? 'upload' : 'other',
    url: window.location.href,
  }).catch(() => {});

})();
