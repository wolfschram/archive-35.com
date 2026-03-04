/**
 * CaFE Content Script — Runs on artist.callforentry.org pages.
 *
 * Upload approach: DOM fill + native button click
 * 1. Receives image as base64 string via Chrome messaging
 * 2. Converts base64 → File, sets it on the file input via DataTransfer API
 * 3. Fills all form fields (text inputs, selects) in the DOM
 * 4. Clicks CaFE's own "Add to My Portfolio" button
 * 5. CaFE's own JS (validateForm + jQuery submit) handles the actual POST
 * 6. Page reloads after successful upload — popup detects via ping
 *
 * Why DOM fill instead of fetch POST:
 * - CaFE's imageUploadButton calls validateForm(jQuery("#uploadForm"))
 * - validateForm does client-side validation then submits the form
 * - fetch POST bypasses this, and CaFE's server may reject raw POSTs
 * - DOM approach uses the site's own submission pipeline
 */

(() => {
  'use strict';

  const UNITS = { 'Inches': '1', 'Feet': '2', 'Centimeter': '3', 'Meters': '4' };
  const DISCIPLINES = { 'Photography': '28', 'Digital Media': '7', 'Mixed Media': '23' };

  // ── Message Handler ──────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'scrapePortfolio') {
      scrapePortfolio().then(sendResponse);
      return true;
    }

    if (msg.action === 'uploadImage') {
      uploadImage(msg.metadata, msg.imageBase64, msg.filename)
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
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

  // ── Image Upload via DOM fill + native button click ──────────

  async function uploadImage(metadata, imageBase64, filename) {
    try {
      if (!window.location.href.includes('media_upload.php')) {
        return { success: false, error: 'Not on media_upload.php' };
      }

      console.log(`[CaFE Upload] Starting: "${metadata.title}" (${filename})`);

      // 0. Pre-flight: check for CaFE error alerts (e.g. portfolio full)
      const preflightAlert = checkForAlerts();
      if (preflightAlert) {
        console.error(`[CaFE Upload] Blocked by alert: ${preflightAlert}`);
        return { success: false, error: preflightAlert };
      }

      // 1. Convert base64 → File
      const byteChars = atob(imageBase64);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: 'image/jpeg' });
      const file = new File([blob], filename, { type: 'image/jpeg' });

      console.log(`[CaFE Upload] File created: ${(file.size / 1024).toFixed(0)} KB`);

      // 2. Set the file on the file input using DataTransfer API
      const fileInput = document.querySelector('#mediaFile');
      if (!fileInput) {
        return { success: false, error: 'File input #mediaFile not found' };
      }

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      // Dispatch change event so CaFE's JS recognizes the file
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`[CaFE Upload] File set on input: ${fileInput.files[0]?.name}`);

      // Small delay for CaFE's JS to process the file change
      await sleep(300);

      // 3. Set media type to Image
      setSelectValue('mediaTypeRadio', 'image');

      // 4. Ensure hidden fields are correct
      setHiddenValue('sample_type', 'image');
      setHiddenValue('newUpdateMedia', 'new');

      // 5. Fill text fields
      setInputValue('imageTitle', metadata.title || '');
      setInputValue('imageAltText', metadata.alt_text || '');
      setInputValue('imageMedium', metadata.medium || 'Digital photograph, archival pigment print');
      setInputValue('imageDescription', metadata.description || '');

      // 6. Fill dimension fields
      setInputValue('imageHeight', String(metadata.height || 20));
      setInputValue('imageWidth', String(metadata.width || 30));
      setInputValue('imageDepth', String(metadata.depth || 0.1));

      const unitVal = UNITS[metadata.units] || '1';
      setSelectValue('imageHeightDimensions', unitVal);
      setSelectValue('imageWidthDimensions', unitVal);
      setSelectValue('imageDepthDimensions', unitVal);

      // 7. Fill sale/price/year fields
      const forSaleVal = (metadata.for_sale === 'Yes' || metadata.for_sale === true) ? '1' : '0';
      setSelectValue('imageForSale', forSaleVal);
      if (metadata.price) setInputValue('imagePrice', String(metadata.price));
      setInputValue('imageYearCompleted', String(metadata.year || new Date().getFullYear()));

      // 8. Fill discipline
      setSelectValue('primaryDiscipline', DISCIPLINES[metadata.discipline] || '28');

      // 9. Public art
      const publicArtVal = (metadata.public_art === 'Yes') ? '1' : '0';
      setSelectValue('publicArt', publicArtVal);

      console.log('[CaFE Upload] All fields filled, clicking upload button...');

      // Small delay before clicking
      await sleep(200);

      // 10. Hook into form submit to confirm it actually fires
      const form = document.querySelector('#uploadForm');
      let formSubmitted = false;
      const submitHandler = () => { formSubmitted = true; };
      if (form) form.addEventListener('submit', submitHandler, { once: true });

      // 11. Click CaFE's own upload button — this triggers validateForm()
      const uploadBtn = document.querySelector('#imageUploadButton');
      if (!uploadBtn) {
        return { success: false, error: 'Upload button #imageUploadButton not found' };
      }

      uploadBtn.click();
      console.log('[CaFE Upload] Button clicked — CaFE is handling submission');

      // 12. Give validateForm a moment to run and potentially submit
      await sleep(500);

      // 13. Check if form submitted or if validation errors appeared
      if (formSubmitted) {
        // Form submitted! Return success IMMEDIATELY — do NOT wait for page
        // reload, because the reload kills this content script and the
        // sendResponse callback becomes invalid.
        console.log(`[CaFE Upload] Form submitted: "${metadata.title}"`);
        return { success: true, title: metadata.title };
      }

      // Form didn't submit — check for validation errors
      const errorLabels = document.querySelectorAll('.error, .text-danger, [style*="color: red"], .required-error');
      const visibleErrors = [];
      for (const el of errorLabels) {
        if (isElementVisible(el) && el.textContent.trim().length > 3) {
          visibleErrors.push(el.textContent.trim());
        }
      }

      if (visibleErrors.length > 0) {
        const errMsg = visibleErrors.slice(0, 3).join('; ');
        console.error(`[CaFE Upload] Validation errors: ${errMsg}`);
        return { success: false, error: `Validation: ${errMsg.substring(0, 200)}` };
      }

      // No submit, no errors visible — might still be processing
      // Wait a bit more and check again
      await sleep(2000);

      if (formSubmitted) {
        console.log(`[CaFE Upload] Form submitted (delayed): "${metadata.title}"`);
        return { success: true, title: metadata.title };
      }

      return { success: false, error: 'Form did not submit — unknown validation issue' };

    } catch (err) {
      console.error('[CaFE Upload] Exception:', err);
      return { success: false, error: err.message };
    }
  }

  // ── DOM Helpers ──────────────────────────────────────────────

  function setInputValue(nameOrId, value) {
    const el = document.querySelector(`#${nameOrId}`) || document.querySelector(`[name="${nameOrId}"]`);
    if (el) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      console.warn(`[CaFE Upload] Field not found: ${nameOrId}`);
    }
  }

  function setSelectValue(nameOrId, value) {
    const el = document.querySelector(`#${nameOrId}`) || document.querySelector(`select[name="${nameOrId}"]`);
    if (el) {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      console.warn(`[CaFE Upload] Select not found: ${nameOrId}`);
    }
  }

  function checkForAlerts() {
    const selectors = '.alert-danger, .alert.alert-danger, .error-message';
    const alerts = document.querySelectorAll(selectors);
    for (const alert of alerts) {
      // Only check VISIBLE alerts — CaFE has hidden alert divs in the DOM
      // (e.g. #upload_limit_warning parent is display:none when not at limit)
      if (!isElementVisible(alert)) continue;
      const text = alert.textContent.trim();
      if (text && text.length > 5) return text.substring(0, 200);
    }
    return null;
  }

  function isElementVisible(el) {
    // Walk up the DOM tree — if ANY ancestor is hidden, the element is hidden
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      el = el.parentElement;
    }
    return true;
  }

  function setHiddenValue(nameOrId, value) {
    const el = document.querySelector(`#${nameOrId}`) || document.querySelector(`input[name="${nameOrId}"]`);
    if (el) el.value = value;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Page Status Report ─────────────────────────────────────

  chrome.runtime.sendMessage({
    action: 'pageStatus',
    page: window.location.href.includes('portfolio.php') ? 'portfolio'
      : window.location.href.includes('media_upload.php') ? 'upload' : 'other',
    url: window.location.href,
  }).catch(() => {});

})();
