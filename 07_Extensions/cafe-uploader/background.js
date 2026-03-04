/**
 * CaFE Uploader — Background Service Worker
 *
 * Coordinates communication between popup and content script.
 * Uses chrome.scripting.executeScript with world:'MAIN' for uploads
 * to run in the page's JavaScript context (not the isolated content script world).
 */

// ── State ──────────────────────────────────────────────────────

let cafeTabId = null;

// ── Message Routing ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Content script reporting page status
  if (msg.action === 'pageStatus') {
    if (sender.tab) {
      cafeTabId = sender.tab.id;
      chrome.storage.local.set({
        cafeTab: {
          id: sender.tab.id,
          page: msg.page,
          url: msg.url,
          timestamp: Date.now(),
        },
      });
    }
    return false;
  }

  // Popup asking to find CaFE tab
  if (msg.action === 'findCafeTab') {
    findCafeTab().then(sendResponse);
    return true;
  }

  // Popup asking to relay message to content script (ping, scrapePortfolio)
  if (msg.action === 'relayToContent') {
    relayToContent(msg.payload).then(sendResponse).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  // Popup asking to upload image — runs in PAGE context
  if (msg.action === 'uploadToPage') {
    uploadToPage(msg.metadata, msg.imageBase64, msg.filename)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Popup asking to open CaFE in a tab
  if (msg.action === 'openCafeTab') {
    openCafeTab(msg.url).then(sendResponse);
    return true;
  }
});

// ── Tab Management ─────────────────────────────────────────────

async function findCafeTab() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://artist.callforentry.org/*' });
    if (tabs.length > 0) {
      cafeTabId = tabs[0].id;
      return { found: true, tabId: tabs[0].id, url: tabs[0].url };
    }
    return { found: false };
  } catch (err) {
    return { found: false, error: err.message };
  }
}

async function openCafeTab(url) {
  try {
    url = url || 'https://artist.callforentry.org/portfolio.php';
    if (cafeTabId) {
      try {
        await chrome.tabs.update(cafeTabId, { url, active: true });
        return { success: true, tabId: cafeTabId };
      } catch {
        cafeTabId = null;
      }
    }
    const tab = await chrome.tabs.create({ url });
    cafeTabId = tab.id;
    return { success: true, tabId: tab.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Content Script Relay (for ping, scrape — runs in isolated world) ──

async function relayToContent(payload) {
  if (!cafeTabId) {
    const result = await findCafeTab();
    if (!result.found) {
      throw new Error('No CaFE tab found. Open artist.callforentry.org first.');
    }
  }

  try {
    const response = await chrome.tabs.sendMessage(cafeTabId, payload);
    return response;
  } catch (err) {
    cafeTabId = null;
    throw new Error(`Could not reach CaFE tab: ${err.message}`);
  }
}

// ── Upload to Page (runs in MAIN world via chrome.scripting) ──────

async function uploadToPage(metadata, imageBase64, filename) {
  if (!cafeTabId) {
    const result = await findCafeTab();
    if (!result.found) {
      throw new Error('No CaFE tab found. Open artist.callforentry.org first.');
    }
  }

  try {
    // Ensure tab is on media_upload.php before starting
    const tab = await chrome.tabs.get(cafeTabId);
    if (!tab.url.includes('media_upload.php')) {
      await chrome.tabs.update(cafeTabId, { url: 'https://artist.callforentry.org/media_upload.php' });
      // Wait for page to load
      await waitForTabLoad(cafeTabId, 10000);
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: cafeTabId },
      world: 'MAIN',
      args: [metadata, imageBase64, filename],
      func: pageContextUpload,
    });

    // executeScript returns an array of results (one per frame)
    const result = results?.[0]?.result;
    const outcome = result || { success: false, error: 'No result from page script' };

    // After upload, reload the page to get a fresh form for the next image
    if (outcome.success) {
      await chrome.tabs.update(cafeTabId, { url: 'https://artist.callforentry.org/media_upload.php' });
    }

    return outcome;
  } catch (err) {
    return { success: false, error: `Script execution failed: ${err.message}` };
  }
}

/**
 * This function runs in the PAGE's JavaScript context (world: 'MAIN').
 * It has access to the page's DOM, jQuery, validateForm(), and cookies.
 *
 * Strategy: Fill DOM fields → set file via DataTransfer → let validateForm()
 * set hidden fields (mediaFileName, MAX_FILE_SIZE) → intercept the native
 * form submit → capture complete FormData → POST via fetch.
 *
 * This hybrid approach ensures we send exactly what the server expects,
 * including all fields that validateForm() prepares.
 */
async function pageContextUpload(metadata, imageBase64, filename) {
  const UNITS = { 'Inches': '1', 'Feet': '2', 'Centimeter': '3', 'Meters': '4' };
  const DISCIPLINES = { 'Photography': '28', 'Digital Media': '7', 'Mixed Media': '23' };

  try {
    if (!window.location.href.includes('media_upload.php')) {
      return { success: false, error: 'Not on media_upload.php' };
    }

    console.log(`[CaFE Page] Upload: "${metadata.title}" (${filename})`);

    const form = document.querySelector('#uploadForm');
    if (!form) return { success: false, error: 'Form #uploadForm not found' };

    // 1. Convert base64 → File and set on file input via DataTransfer
    const byteChars = atob(imageBase64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([byteArray], { type: 'image/jpeg' });
    const file = new File([blob], filename, { type: 'image/jpeg' });

    const fileInput = form.querySelector('#mediaFile');
    if (!fileInput) return { success: false, error: 'File input #mediaFile not found' };

    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    console.log(`[CaFE Page] File set: ${filename} (${(file.size / 1024).toFixed(0)} KB)`);

    // 2. Fill all metadata fields in the DOM
    const setVal = (id, val) => {
      const el = form.querySelector('#' + id) || form.querySelector('[name="' + id + '"]');
      if (el) { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }
    };

    setVal('imageTitle', metadata.title || '');
    setVal('imageAltText', metadata.alt_text || '');
    setVal('imageMedium', metadata.medium || 'Digital photograph, archival pigment print');
    setVal('imageDescription', metadata.description || '');
    setVal('imageHeight', String(metadata.height || 20));
    setVal('imageWidth', String(metadata.width || 30));
    setVal('imageDepth', String(metadata.depth || 0.1));
    setVal('imageYearCompleted', String(metadata.year || new Date().getFullYear()));

    const unitVal = UNITS[metadata.units] || '1';
    setVal('imageHeightDimensions', unitVal);
    setVal('imageWidthDimensions', unitVal);
    setVal('imageDepthDimensions', unitVal);

    const forSaleVal = (metadata.for_sale === 'Yes' || metadata.for_sale === true) ? '1' : '0';
    setVal('imageForSale', forSaleVal);
    if (metadata.price) setVal('imagePrice', String(metadata.price));
    setVal('primaryDiscipline', DISCIPLINES[metadata.discipline] || '28');
    setVal('publicArt', (metadata.public_art === 'Yes') ? '1' : '0');

    console.log('[CaFE Page] DOM fields filled');

    // 3. Intercept the form submit event so we can capture the
    //    complete FormData (after validateForm sets hidden fields)
    //    and POST via fetch instead of navigating.
    let fetchResult = null;

    const submitInterceptor = async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();

      console.log('[CaFE Page] Form submit intercepted — building FormData');

      // Capture ALL form data including the DataTransfer file and
      // any hidden fields validateForm() set (mediaFileName, MAX_FILE_SIZE)
      const formData = new FormData(form);

      // Verify the file is included
      const capturedFile = formData.get('mediaFile');
      if (!capturedFile || capturedFile.size === 0) {
        console.error('[CaFE Page] File NOT in FormData — falling back to manual set');
        formData.set('mediaFile', file, filename);
      }

      console.log('[CaFE Page] POSTing via fetch...');

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        console.log(`[CaFE Page] Response: ${response.status}, redirected: ${response.redirected}`);

        // Success = redirect to media_preview.php
        if (response.redirected && response.url.includes('media_preview')) {
          fetchResult = { success: true, title: metadata.title };
          return;
        }

        const html = await response.text();

        // Check for the definitive success message
        if (html.includes('was added to your portfolio') || html.includes('has been added')) {
          fetchResult = { success: true, title: metadata.title };
          return;
        }

        // Check for real errors (not template strings)
        if (html.includes('Please select a media file')) {
          fetchResult = { success: false, error: 'Server did not receive the file' };
          return;
        }

        // Fallback: check if we ended up on media_preview.php
        if (response.url.includes('media_preview')) {
          fetchResult = { success: true, title: metadata.title };
          return;
        }

        // If response is the upload form, check for non-template errors
        // The only alert-danger that's always in the template is "maximum number"
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const alerts = doc.querySelectorAll('.alert-danger');
        for (const alert of alerts) {
          const text = alert.textContent.trim();
          if (text && !text.includes('maximum number')) {
            fetchResult = { success: false, error: text.substring(0, 200) };
            return;
          }
        }

        // Check for validation errors that appeared
        const validationErrs = doc.querySelectorAll('.text-danger');
        const realErrors = [];
        validationErrs.forEach(el => {
          const t = el.textContent.trim();
          if (t && t !== 'required field') realErrors.push(t);
        });
        if (realErrors.length > 0) {
          fetchResult = { success: false, error: realErrors.join('; ').substring(0, 200) };
          return;
        }

        fetchResult = { success: false, error: 'Upload did not redirect to preview — likely rejected' };
      } catch (err) {
        fetchResult = { success: false, error: `Fetch failed: ${err.message}` };
      }
    };

    // Add interceptor on capturing phase (runs before jQuery handlers)
    form.addEventListener('submit', submitInterceptor, { capture: true, once: true });

    // 4. Trigger validateForm via the submit button click
    //    validateForm() sets mediaFileName, MAX_FILE_SIZE, then submits the form.
    //    Our interceptor catches the submit and does fetch instead.
    const valid = validateForm(jQuery('#uploadForm'));

    if (!valid) {
      // validateForm returned false — collect visible errors
      form.removeEventListener('submit', submitInterceptor, { capture: true });
      const errors = [];
      form.querySelectorAll('.text-danger').forEach(el => {
        if (el.offsetParent !== null && el.textContent.trim()) {
          errors.push(el.textContent.trim());
        }
      });
      const errMsg = errors.filter(e => e !== 'required field').join('; ') || 'Form validation failed';
      console.error(`[CaFE Page] Validation failed: ${errMsg}`);
      return { success: false, error: errMsg.substring(0, 200) };
    }

    // 5. Wait for the async fetch in the interceptor to complete
    //    (validateForm triggers form.submit synchronously, but our
    //    interceptor's fetch is async)
    const maxWait = 30000;
    const start = Date.now();
    while (!fetchResult && (Date.now() - start) < maxWait) {
      await new Promise(r => setTimeout(r, 200));
    }

    if (!fetchResult) {
      return { success: false, error: 'Upload timed out (30s)' };
    }

    if (fetchResult.success) {
      console.log(`[CaFE Page] SUCCESS: "${metadata.title}"`);
    } else {
      console.error(`[CaFE Page] FAILED: ${fetchResult.error}`);
    }

    return fetchResult;

  } catch (err) {
    console.error('[CaFE Page] Error:', err);
    return { success: false, error: err.message };
  }
}

// ── Tab Helpers ───────────────────────────────────────────────

function waitForTabLoad(tabId, maxWait = 10000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // resolve even on timeout
    }, maxWait);

    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        // Extra delay for JS initialization
        setTimeout(resolve, 500);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ── Tab Lifecycle ──────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === cafeTabId) {
    cafeTabId = null;
    chrome.storage.local.remove('cafeTab');
  }
});
