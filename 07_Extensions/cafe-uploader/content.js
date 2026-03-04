/**
 * CaFE Content Script — Runs on artist.callforentry.org pages.
 *
 * Upload approach (research-backed):
 * 1. Receives image as base64 string via Chrome messaging
 * 2. Converts base64 → Blob → File
 * 3. Extracts ALL hidden form fields from the live page DOM
 * 4. Builds FormData with exact CaFE field names
 * 5. POSTs via fetch() with credentials (page cookies) — NO Content-Type header
 *
 * Critical: Do NOT set Content-Type header on fetch — browser must set
 * the multipart boundary automatically. This was the cause of previous failures.
 *
 * CaFE form fields (from DOM inspection March 2026):
 *   Hidden: pf_fk, pf_secret, sample_type, newUpdateMedia, fd_id, secret,
 *           media_type, APC_UPLOAD_PROGRESS, postback_url, MAX_FILE_SIZE,
 *           storage_bytes, updateApplications
 *   File:   mediaFile
 *   Text:   imageTitle, imageAltText, imageMedium, imageDescription
 *   Text:   imageHeight, imageWidth, imageDepth
 *   Select: imageHeightDimensions, imageWidthDimensions, imageDepthDimensions
 *           (1=Inches, 2=Feet, 3=cm, 4=m)
 *   Select: imageForSale (1=Yes, 0=No)
 *   Text:   imagePrice, imageYearCompleted
 *   Select: primaryDiscipline (28=Photography)
 *   Select: publicArt (0=No, 1=Yes)
 *   Text:   publicArtLocation, publicArtProgram
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

  // ── Image Upload via fetch POST ────────────────────────────

  async function uploadImage(metadata, imageBase64, filename) {
    try {
      if (!window.location.href.includes('media_upload.php')) {
        return { success: false, error: 'Not on media_upload.php' };
      }

      console.log(`[CaFE Upload] Starting: "${metadata.title}" (${filename})`);

      // 1. Convert base64 → Blob → File
      const byteChars = atob(imageBase64);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: 'image/jpeg' });
      const file = new File([blob], filename, { type: 'image/jpeg' });

      console.log(`[CaFE Upload] File created: ${(file.size / 1024).toFixed(0)} KB`);

      // 2. Extract ALL hidden fields from the live page form
      const form = document.querySelector('form');
      if (!form) {
        return { success: false, error: 'No form found on page' };
      }

      const formData = new FormData();

      // Copy all hidden fields from the real form
      const hiddenInputs = form.querySelectorAll('input[type="hidden"]');
      hiddenInputs.forEach(input => {
        if (input.name) {
          formData.append(input.name, input.value);
        }
      });

      console.log(`[CaFE Upload] Hidden fields: ${[...hiddenInputs].map(i => i.name).join(', ')}`);

      // 3. Set the file
      formData.append('mediaFile', file, filename);

      // 4. Set metadata fields with exact CaFE field names
      formData.set('sample_type', 'image');
      formData.set('newUpdateMedia', 'new');

      formData.append('imageTitle', metadata.title || '');
      formData.append('imageAltText', metadata.alt_text || '');
      formData.append('imageMedium', metadata.medium || 'Digital photograph, archival pigment print');
      formData.append('imageDescription', metadata.description || '');

      formData.append('imageHeight', String(metadata.height || 20));
      formData.append('imageWidth', String(metadata.width || 30));
      formData.append('imageDepth', String(metadata.depth || 0.1));

      const unitVal = UNITS[metadata.units] || '1';
      formData.append('imageHeightDimensions', unitVal);
      formData.append('imageWidthDimensions', unitVal);
      formData.append('imageDepthDimensions', unitVal);

      const forSaleVal = (metadata.for_sale === 'Yes' || metadata.for_sale === true) ? '1' : '0';
      formData.append('imageForSale', forSaleVal);
      if (metadata.price) formData.append('imagePrice', String(metadata.price));
      formData.append('imageYearCompleted', String(metadata.year || new Date().getFullYear()));

      formData.append('primaryDiscipline', DISCIPLINES[metadata.discipline] || '28');

      const publicArtVal = (metadata.public_art === 'Yes') ? '1' : '0';
      formData.append('publicArt', publicArtVal);

      console.log('[CaFE Upload] FormData built, POSTing...');

      // 5. POST via fetch — CRITICAL: do NOT set Content-Type header!
      //    Browser must set it with the multipart boundary automatically.
      const response = await fetch('https://artist.callforentry.org/media_upload.php', {
        method: 'POST',
        body: formData,
        credentials: 'include',
        // NO headers — let browser handle Content-Type with boundary
      });

      console.log(`[CaFE Upload] Response: ${response.status} ${response.statusText}, redirected: ${response.redirected}`);

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const responseText = await response.text();

      // 6. Check for success
      // CaFE typically shows success messages or redirects to portfolio
      const isSuccess = response.redirected
        || responseText.includes('portfolio.php')
        || responseText.includes('successfully')
        || responseText.includes('has been added')
        || responseText.includes('Your image has been');

      // Check for known error patterns
      const errorPatterns = [
        /class="alert-danger[^"]*"[^>]*>([\s\S]*?)<\/div/i,
        /class="error[^"]*"[^>]*>([^<]+)/i,
        /File size exceeds/i,
        /minimum of 1200 pixels/i,
        /already exists/i,
      ];

      for (const pattern of errorPatterns) {
        const match = responseText.match(pattern);
        if (match) {
          const errMsg = (match[1] || match[0]).replace(/<[^>]+>/g, '').trim();
          console.error(`[CaFE Upload] Error found in response: ${errMsg}`);
          return { success: false, error: errMsg.substring(0, 200) };
        }
      }

      if (isSuccess) {
        console.log(`[CaFE Upload] Success: "${metadata.title}"`);
        return { success: true, title: metadata.title };
      }

      // Ambiguous — might have worked
      console.warn('[CaFE Upload] Ambiguous response — checking for form presence');
      // If the response still shows the upload form, it probably failed
      if (responseText.includes('media_upload.php') && responseText.includes('Choose File')) {
        return { success: false, error: 'Upload form still shown — check CaFE for details' };
      }

      return { success: true, note: 'Upload completed — verify in portfolio' };

    } catch (err) {
      console.error('[CaFE Upload] Exception:', err);
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
