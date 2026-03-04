/**
 * CaFE Content Script — Runs on artist.callforentry.org pages.
 *
 * Upload approach: Inject into PAGE context via <script> tag
 *
 * WHY: Content scripts run in an isolated JavaScript world. Setting
 * fileInput.files via DataTransfer works, but CaFE's jQuery event
 * handlers don't fire because the change event isn't trusted.
 * When we tested from DevTools console (page context), it worked.
 * Solution: inject code into the page's own world.
 *
 * Flow:
 * 1. Content script receives base64 image + metadata via Chrome messaging
 * 2. Stores data on a hidden DOM element (shared between worlds)
 * 3. Injects a <script> that reads the data and fills the form in page context
 * 4. Page-context script sets file, fills fields, clicks upload button
 * 5. Listens for result via custom DOM event
 */

(() => {
  'use strict';

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

  // ── Upload via page-context injection ────────────────────────

  async function uploadImage(metadata, imageBase64, filename) {
    try {
      if (!window.location.href.includes('media_upload.php')) {
        return { success: false, error: 'Not on media_upload.php' };
      }

      console.log(`[CaFE Upload] Starting: "${metadata.title}" (${filename})`);

      // Store data in a hidden DOM element for the page-context script to read
      let dataEl = document.getElementById('__cafe_upload_data');
      if (!dataEl) {
        dataEl = document.createElement('div');
        dataEl.id = '__cafe_upload_data';
        dataEl.style.display = 'none';
        document.body.appendChild(dataEl);
      }

      dataEl.setAttribute('data-metadata', JSON.stringify(metadata));
      dataEl.setAttribute('data-filename', filename);
      dataEl.setAttribute('data-base64', imageBase64);

      // Create a promise that resolves when the page-context script sends result
      const resultPromise = new Promise((resolve) => {
        const handler = (e) => {
          document.removeEventListener('__cafe_upload_result', handler);
          resolve(e.detail);
        };
        document.addEventListener('__cafe_upload_result', handler);

        // Timeout after 10 seconds
        setTimeout(() => {
          document.removeEventListener('__cafe_upload_result', handler);
          resolve({ success: false, error: 'Upload timed out — no response from page script' });
        }, 10000);
      });

      // Inject script into page context
      const script = document.createElement('script');
      script.textContent = getPageContextScript();
      document.documentElement.appendChild(script);
      script.remove(); // Clean up — it already executed

      // Wait for result
      const result = await resultPromise;
      console.log(`[CaFE Upload] Result:`, result);
      return result;

    } catch (err) {
      console.error('[CaFE Upload] Exception:', err);
      return { success: false, error: err.message };
    }
  }

  // ── Page-context script (runs in page's JS world) ───────────

  function getPageContextScript() {
    return `
(function() {
  try {
    var UNITS = { 'Inches': '1', 'Feet': '2', 'Centimeter': '3', 'Meters': '4' };
    var DISCIPLINES = { 'Photography': '28', 'Digital Media': '7', 'Mixed Media': '23' };

    var dataEl = document.getElementById('__cafe_upload_data');
    if (!dataEl) {
      sendResult({ success: false, error: 'No upload data found' });
      return;
    }

    var metadata = JSON.parse(dataEl.getAttribute('data-metadata'));
    var filename = dataEl.getAttribute('data-filename');
    var imageBase64 = dataEl.getAttribute('data-base64');

    console.log('[CaFE Page] Upload: "' + metadata.title + '" (' + filename + ')');

    // 1. Convert base64 → File
    var byteChars = atob(imageBase64);
    var byteArray = new Uint8Array(byteChars.length);
    for (var i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    var blob = new Blob([byteArray], { type: 'image/jpeg' });
    var file = new File([blob], filename, { type: 'image/jpeg' });

    console.log('[CaFE Page] File: ' + (file.size / 1024).toFixed(0) + ' KB');

    // 2. Set file on input
    var fileInput = document.querySelector('#mediaFile');
    if (!fileInput) {
      sendResult({ success: false, error: 'File input not found' });
      return;
    }

    var dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;

    // Fire native change event — this is in page context so jQuery WILL catch it
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('[CaFE Page] File set: ' + fileInput.files[0].name);

    // 3. Fill form fields
    function setVal(id, val) {
      var el = document.getElementById(id) || document.querySelector('[name="' + id + '"]');
      if (el) {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    setVal('imageTitle', metadata.title || '');
    setVal('imageAltText', metadata.alt_text || '');
    setVal('imageMedium', metadata.medium || 'Digital photograph, archival pigment print');
    setVal('imageDescription', metadata.description || '');
    setVal('imageHeight', String(metadata.height || 20));
    setVal('imageWidth', String(metadata.width || 30));
    setVal('imageDepth', String(metadata.depth || 0.1));

    var unitVal = UNITS[metadata.units] || '1';
    setVal('imageHeightDimensions', unitVal);
    setVal('imageWidthDimensions', unitVal);
    setVal('imageDepthDimensions', unitVal);

    var forSaleVal = (metadata.for_sale === 'Yes' || metadata.for_sale === true) ? '1' : '0';
    setVal('imageForSale', forSaleVal);
    if (metadata.price) setVal('imagePrice', String(metadata.price));
    setVal('imageYearCompleted', String(metadata.year || new Date().getFullYear()));
    setVal('primaryDiscipline', DISCIPLINES[metadata.discipline] || '28');
    setVal('publicArt', (metadata.public_art === 'Yes') ? '1' : '0');

    console.log('[CaFE Page] All fields filled');

    // 4. Hook form submit event
    var form = document.querySelector('#uploadForm');
    var formSubmitted = false;
    if (form) {
      form.addEventListener('submit', function() { formSubmitted = true; }, { once: true });
    }

    // 5. Click upload button (small delay for fields to settle)
    setTimeout(function() {
      var btn = document.querySelector('#imageUploadButton');
      if (!btn) {
        sendResult({ success: false, error: 'Upload button not found' });
        return;
      }

      btn.click();
      console.log('[CaFE Page] Button clicked');

      // 6. Check result after a moment
      setTimeout(function() {
        if (formSubmitted) {
          console.log('[CaFE Page] Form submitted OK');
          sendResult({ success: true, title: metadata.title });
        } else {
          // Check for visible errors
          var errors = [];
          document.querySelectorAll('.text-danger, .error').forEach(function(el) {
            var text = el.textContent.trim();
            if (text.length > 3 && el.offsetParent !== null) errors.push(text);
          });
          if (errors.length > 0) {
            sendResult({ success: false, error: errors.slice(0, 3).join('; ').substring(0, 200) });
          } else {
            sendResult({ success: false, error: 'Form did not submit — unknown issue' });
          }
        }
        // Clean up data element
        dataEl.remove();
      }, 500);
    }, 300);

  } catch(err) {
    sendResult({ success: false, error: err.message });
  }

  function sendResult(result) {
    document.dispatchEvent(new CustomEvent('__cafe_upload_result', { detail: result }));
  }
})();
`;
  }

  // ── Page Status Report ─────────────────────────────────────

  chrome.runtime.sendMessage({
    action: 'pageStatus',
    page: window.location.href.includes('portfolio.php') ? 'portfolio'
      : window.location.href.includes('media_upload.php') ? 'upload' : 'other',
    url: window.location.href,
  }).catch(() => {});

})();
