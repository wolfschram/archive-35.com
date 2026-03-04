/**
 * CaFE Content Script — Runs on artist.callforentry.org pages.
 *
 * Upload approach: Fill the actual CaFE form fields + click the real
 * "Add to My Portfolio" button. This uses CaFE's own upload JavaScript,
 * which is much more reliable than trying to replicate it via fetch().
 */

(() => {
  'use strict';

  // Track if an upload is currently in progress
  let uploadInProgress = false;

  // ── Message Handler ──────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'scrapePortfolio') {
      scrapePortfolio().then(sendResponse);
      return true;
    }

    if (msg.action === 'uploadImage') {
      uploadImage(msg.metadata, msg.imageData, msg.filename)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (msg.action === 'ping') {
      sendResponse({
        alive: true,
        url: window.location.href,
        onUploadPage: window.location.href.includes('media_upload.php'),
        uploadInProgress,
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

      // CaFE portfolio shows images in a table or grid
      const rows = document.querySelectorAll('tr, .portfolio-image, .media-item, [data-media-id]');
      rows.forEach(el => {
        const title = el.querySelector('.media-title, td:nth-child(2), .pf-title')?.textContent?.trim()
          || el.getAttribute('data-title') || '';
        const thumb = el.querySelector('img')?.src || '';
        const mediaId = el.getAttribute('data-media-id') || '';

        if (title || thumb) {
          images.push({ title, thumbnail: thumb, mediaId });
        }
      });

      // Fallback: scan all images
      if (images.length === 0) {
        document.querySelectorAll('img').forEach(img => {
          if (img.src.includes('media_') || img.src.includes('portfolio') || img.src.includes('pf_')) {
            images.push({
              title: img.alt || '',
              thumbnail: img.src,
              mediaId: '',
            });
          }
        });
      }

      return { success: true, images, pageUrl: window.location.href };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── Image Upload (Form-Fill + Button-Click) ────────────────

  async function uploadImage(metadata, imageArrayData, filename) {
    try {
      // Must be on the upload page
      if (!window.location.href.includes('media_upload.php')) {
        return { success: false, error: 'Not on media_upload.php — navigate there first' };
      }

      if (uploadInProgress) {
        return { success: false, error: 'Another upload is still in progress' };
      }

      uploadInProgress = true;

      // Convert array data back to Blob
      const blob = new Blob([new Uint8Array(imageArrayData)], { type: 'image/jpeg' });

      console.log(`[CaFE Upload] Starting: "${metadata.title}" (${filename}, ${(blob.size / 1024).toFixed(0)} KB)`);

      // Fill the form using CafeFormMapper
      CafeFormMapper.fillForm(metadata, blob, filename);

      // Brief pause to let CaFE's JS process the file input change
      await sleep(500);

      // Click CaFE's "Add to My Portfolio" button and wait for result
      const result = await waitForUploadComplete();

      uploadInProgress = false;

      console.log(`[CaFE Upload] Result for "${metadata.title}":`, result);
      return result;

    } catch (err) {
      uploadInProgress = false;
      console.error(`[CaFE Upload] Error:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Click the upload button and wait for the upload to complete.
   * Watches for:
   * - Page reload (success — CaFE reloads after upload)
   * - Success text in DOM
   * - Error messages in DOM
   * - Progress bar changes
   */
  function waitForUploadComplete() {
    return new Promise((resolve) => {
      const btn = document.getElementById('imageUploadButton');
      if (!btn) {
        resolve({ success: false, error: 'Upload button not found on page' });
        return;
      }

      let resolved = false;
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        if (observer) observer.disconnect();
        resolve(result);
      };

      // Timeout after 60s (large files can take a while)
      const timeout = setTimeout(() => {
        done({ success: true, note: 'Upload timed out but may have succeeded — check portfolio' });
      }, 60000);

      // Watch for DOM changes indicating success or error
      const observer = new MutationObserver(() => {
        const body = document.body.innerText;

        // CaFE error patterns
        const alertEl = document.querySelector('.alert-danger, .alert-warning, .error-message');
        if (alertEl && alertEl.textContent.trim()) {
          const errText = alertEl.textContent.trim();
          if (errText.length > 5 && !errText.includes('timeout')) {
            done({ success: false, error: errText.substring(0, 200) });
            return;
          }
        }

        // Success: page reloaded or shows success message
        if (body.includes('has been added') || body.includes('successfully uploaded')) {
          done({ success: true });
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      // Also handle page navigation (CaFE reloads after successful upload)
      const beforeUnload = () => {
        window.removeEventListener('beforeunload', beforeUnload);
        // Page is reloading — this usually means success
        done({ success: true, note: 'Page reloaded after upload' });
      };
      window.addEventListener('beforeunload', beforeUnload);

      // Click the button!
      console.log('[CaFE Upload] Clicking "Add to My Portfolio"...');
      btn.click();
    });
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ── Page Status Report ─────────────────────────────────────

  chrome.runtime.sendMessage({
    action: 'pageStatus',
    page: window.location.href.includes('portfolio.php') ? 'portfolio'
      : window.location.href.includes('media_upload.php') ? 'upload'
      : 'cafe-other',
    url: window.location.href,
  }).catch(() => {});

})();
