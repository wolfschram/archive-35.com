/**
 * CaFE Content Script — Runs on artist.callforentry.org pages.
 *
 * Two responsibilities:
 * 1. Portfolio scraping (on portfolio.php) — what's already uploaded
 * 2. Upload execution (receives image data via messaging) — submit to CaFE
 */

(() => {
  'use strict';

  // ── Message Handler ──────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'scrapePortfolio') {
      scrapePortfolio().then(sendResponse);
      return true; // async response
    }

    if (msg.action === 'uploadImage') {
      uploadImage(msg.metadata, msg.imageData, msg.filename)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; // async response
    }

    if (msg.action === 'getHiddenFields') {
      const fields = CafeFormMapper.extractHiddenFields();
      sendResponse({ success: true, fields });
      return false;
    }

    if (msg.action === 'ping') {
      sendResponse({ alive: true, url: window.location.href });
      return false;
    }
  });

  // ── Portfolio Scraping ───────────────────────────────────────

  async function scrapePortfolio() {
    try {
      // Check if we're on the portfolio page
      if (!window.location.href.includes('portfolio.php')) {
        return { success: false, error: 'Not on portfolio page' };
      }

      const images = [];

      // CaFE portfolio page structure: look for image entries
      // Try multiple selectors since CaFE's DOM may vary
      const selectors = [
        '.portfolio-image',
        '.media-item',
        'table.portfolio tr',
        '.pf-image-row',
        '[data-media-id]',
      ];

      for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        if (elements.length > 0) {
          elements.forEach(el => {
            const title = el.querySelector('.media-title, .pf-title, td:nth-child(2)')?.textContent?.trim()
              || el.getAttribute('data-title')
              || '';
            const thumb = el.querySelector('img')?.src || '';
            const mediaId = el.getAttribute('data-media-id')
              || el.querySelector('[name="media_id"]')?.value
              || '';

            if (title || thumb) {
              images.push({ title, thumbnail: thumb, mediaId });
            }
          });
          break; // Use first matching selector
        }
      }

      // Fallback: scan all images on the page
      if (images.length === 0) {
        document.querySelectorAll('img').forEach(img => {
          const src = img.src || '';
          const alt = img.alt || '';
          // Portfolio images typically have specific URL patterns
          if (src.includes('media_') || src.includes('portfolio') || src.includes('pf_')) {
            const title = alt || img.closest('tr, .media-item, div')?.querySelector('td:nth-child(2), .title')?.textContent?.trim() || '';
            images.push({ title, thumbnail: src, mediaId: '' });
          }
        });
      }

      // Also check for the "X of 200" counter
      const counterText = document.body.textContent;
      const counterMatch = counterText.match(/(\d+)\s+of\s+200\s+image/i);
      const totalUploaded = counterMatch ? parseInt(counterMatch[1]) : images.length;

      return {
        success: true,
        images,
        totalUploaded,
        pageUrl: window.location.href,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── Image Upload ─────────────────────────────────────────────

  async function uploadImage(metadata, imageArrayBuffer, filename) {
    try {
      // Navigate to upload page if not there
      const uploadUrl = 'https://artist.callforentry.org/media_upload.php';

      // We need to be on the upload page to get hidden fields
      // If we're not there, we'll use fetch directly
      const hiddenFields = CafeFormMapper.extractHiddenFields();

      if (!hiddenFields.pf_fk) {
        // Try to fetch the upload page to get hidden fields
        const pageResp = await fetch(uploadUrl, { credentials: 'include' });
        if (!pageResp.ok) {
          return { success: false, error: `CaFE returned ${pageResp.status} — are you logged in?` };
        }
        const pageHtml = await pageResp.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(pageHtml, 'text/html');

        const pfFk = doc.querySelector('[name="pf_fk"]');
        const pfSecret = doc.querySelector('[name="pf_secret"]');
        if (pfFk) hiddenFields.pf_fk = pfFk.value;
        if (pfSecret) hiddenFields.pf_secret = pfSecret.value;
      }

      if (!hiddenFields.pf_fk) {
        return { success: false, error: 'Could not find form security tokens. Are you logged in to CaFE?' };
      }

      // Convert ArrayBuffer to File
      const blob = new Blob([new Uint8Array(imageArrayBuffer)], { type: 'image/jpeg' });
      const file = new File([blob], filename, { type: 'image/jpeg' });

      // Build FormData using the mapper
      const formData = CafeFormMapper.buildFormData(metadata, file, hiddenFields);

      // Submit via fetch (uses page's auth cookies)
      const response = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Upload failed: HTTP ${response.status}`,
        };
      }

      // Check response for success indicators
      const responseText = await response.text();

      // CaFE typically redirects to portfolio on success
      const isSuccess = responseText.includes('portfolio.php')
        || responseText.includes('successfully')
        || responseText.includes('added')
        || response.redirected;

      if (isSuccess) {
        return {
          success: true,
          title: metadata.title,
          filename: filename,
        };
      }

      // Check for error messages in response
      const errorMatch = responseText.match(/class="error[^"]*"[^>]*>([^<]+)/i)
        || responseText.match(/alert[^>]*>([^<]+)/i);

      return {
        success: false,
        error: errorMatch ? errorMatch[1].trim() : 'Upload may have failed — check CaFE portfolio',
      };

    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── Auto-detect page and report status ───────────────────────

  function reportPageStatus() {
    const url = window.location.href;
    let page = 'unknown';

    if (url.includes('portfolio.php')) page = 'portfolio';
    else if (url.includes('media_upload.php')) page = 'upload';
    else if (url.includes('callforentry.org')) page = 'cafe-other';

    chrome.runtime.sendMessage({
      action: 'pageStatus',
      page,
      url,
    }).catch(() => {}); // Ignore if popup not open
  }

  // Report on load
  reportPageStatus();

})();
