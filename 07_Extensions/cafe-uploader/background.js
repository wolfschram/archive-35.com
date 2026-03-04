/**
 * CaFE Uploader — Background Service Worker
 *
 * Coordinates communication between popup and content script.
 * Uses chrome.scripting.executeScript with world:'MAIN' for uploads
 * to run in the page's JavaScript context (not the isolated content script world).
 *
 * Upload strategy:
 * 1. Fill DOM fields + set file via DataTransfer
 * 2. Call validateForm() which sets hidden fields and calls form.submit()
 * 3. Native form submission includes DataTransfer files
 * 4. Background watches tab URL change: media_preview.php = success
 * 5. Navigate back to media_upload.php for next image
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

// ── Upload to Page ─────────────────────────────────────────────
//
// This is the main upload orchestrator. It:
// 1. Ensures the tab is on media_upload.php
// 2. Injects a script to fill the form and trigger submission
// 3. Watches the tab URL to detect success (redirect to media_preview.php)
// 4. Navigates back to media_upload.php for the next image

async function uploadToPage(metadata, imageBase64, filename) {
  if (!cafeTabId) {
    const result = await findCafeTab();
    if (!result.found) {
      throw new Error('No CaFE tab found. Open artist.callforentry.org first.');
    }
  }

  try {
    // 1. Ensure tab is on media_upload.php
    const tab = await chrome.tabs.get(cafeTabId);
    if (!tab.url.includes('media_upload.php')) {
      await chrome.tabs.update(cafeTabId, { url: 'https://artist.callforentry.org/media_upload.php' });
      await waitForTabLoad(cafeTabId, 15000);
    }

    // 2. Inject script to fill form and submit
    //    This returns BEFORE the page navigates (it just fills + clicks submit)
    const results = await chrome.scripting.executeScript({
      target: { tabId: cafeTabId },
      world: 'MAIN',
      args: [metadata, imageBase64, filename],
      func: fillFormAndSubmit,
    });

    const fillResult = results?.[0]?.result;
    if (fillResult && !fillResult.submitted) {
      // validateForm returned false — form wasn't submitted
      return { success: false, error: fillResult.error || 'Form validation failed' };
    }

    // 3. Watch for the tab to navigate after form submission
    //    Success = redirect to media_preview.php
    //    Failure = stays on media_upload.php (with errors)
    const navResult = await waitForNavigation(cafeTabId, 30000);

    if (navResult.url && navResult.url.includes('media_preview')) {
      // SUCCESS! Image was uploaded
      console.log(`[BG] Upload success: "${metadata.title}"`);

      // 4. Navigate back to media_upload.php for the next image
      await chrome.tabs.update(cafeTabId, { url: 'https://artist.callforentry.org/media_upload.php' });
      await waitForTabLoad(cafeTabId, 15000);

      return { success: true, title: metadata.title };
    }

    if (navResult.url && navResult.url.includes('media_upload.php')) {
      // Page reloaded to upload form — likely an error
      // Try to extract the error from the page
      try {
        const errResults = await chrome.scripting.executeScript({
          target: { tabId: cafeTabId },
          world: 'MAIN',
          func: () => {
            // Look for visible error messages (not the always-hidden "maximum number" template)
            const alerts = document.querySelectorAll('.alert-danger');
            for (const alert of alerts) {
              const parent = alert.parentElement;
              const parentHidden = parent && window.getComputedStyle(parent).display === 'none';
              if (!parentHidden) {
                const text = alert.textContent.trim();
                if (text) return text.substring(0, 200);
              }
            }
            // Check for validation error text
            const errs = [];
            document.querySelectorAll('.text-danger').forEach(el => {
              if (el.offsetParent !== null && el.textContent.trim()) {
                errs.push(el.textContent.trim());
              }
            });
            return errs.length > 0 ? errs.join('; ').substring(0, 200) : null;
          },
        });
        const errText = errResults?.[0]?.result;
        return { success: false, error: errText || 'Upload rejected by server' };
      } catch {
        return { success: false, error: 'Upload rejected by server' };
      }
    }

    if (navResult.timeout) {
      return { success: false, error: 'Upload timed out — page did not respond' };
    }

    return { success: false, error: `Unexpected navigation: ${navResult.url}` };

  } catch (err) {
    return { success: false, error: `Upload failed: ${err.message}` };
  }
}

/**
 * This function runs in the PAGE's JavaScript context (world: 'MAIN').
 * It fills the form, sets the file, and triggers validateForm() which
 * calls form.submit() natively. The function returns IMMEDIATELY after
 * triggering submission — it does NOT wait for the page to navigate.
 *
 * The background script watches the tab URL to detect success/failure.
 */
function fillFormAndSubmit(metadata, imageBase64, filename) {
  const UNITS = { 'Inches': '1', 'Feet': '2', 'Centimeter': '3', 'Meters': '4' };
  const DISCIPLINES = { 'Photography': '28', 'Digital Media': '7', 'Mixed Media': '23' };

  try {
    if (!window.location.href.includes('media_upload.php')) {
      return { submitted: false, error: 'Not on media_upload.php' };
    }

    console.log(`[CaFE Page] Upload: "${metadata.title}" (${filename})`);

    const form = document.querySelector('#uploadForm');
    if (!form) return { submitted: false, error: 'Form #uploadForm not found' };

    // 1. Convert base64 → File and set on file input via DataTransfer
    const byteChars = atob(imageBase64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([byteArray], { type: 'image/jpeg' });
    const file = new File([blob], filename, { type: 'image/jpeg' });

    const fileInput = form.querySelector('#mediaFile');
    if (!fileInput) return { submitted: false, error: 'File input #mediaFile not found' };

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

    // 3. Trigger validateForm — this sets mediaFileName, MAX_FILE_SIZE,
    //    then calls form.submit() natively. The page will navigate.
    const valid = validateForm(jQuery('#uploadForm'));

    if (!valid) {
      // Collect visible errors
      const errors = [];
      form.querySelectorAll('.text-danger').forEach(el => {
        if (el.offsetParent !== null && el.textContent.trim()) {
          errors.push(el.textContent.trim());
        }
      });
      const errMsg = errors.filter(e => e !== 'required field').join('; ') || 'Form validation failed';
      console.error(`[CaFE Page] Validation failed: ${errMsg}`);
      return { submitted: false, error: errMsg.substring(0, 200) };
    }

    // validateForm returned true — form.submit() was called,
    // page will navigate shortly. Return immediately.
    console.log('[CaFE Page] Form submitted, waiting for navigation...');
    return { submitted: true };

  } catch (err) {
    console.error('[CaFE Page] Error:', err);
    return { submitted: false, error: err.message };
  }
}

// ── Tab Helpers ───────────────────────────────────────────────

/**
 * Wait for the tab to finish loading after a URL change.
 */
function waitForTabLoad(tabId, maxWait = 10000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, maxWait);

    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        // Extra delay for JS initialization
        setTimeout(resolve, 1000);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Wait for the tab to navigate to a new URL after form submission.
 * Returns { url } on navigation or { timeout: true } on timeout.
 */
function waitForNavigation(tabId, maxWait = 30000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve({ timeout: true });
    }, maxWait);

    const listener = (id, changeInfo) => {
      if (id !== tabId) return;

      // Wait for the page to fully load after navigation
      if (changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        // Get the final URL
        chrome.tabs.get(tabId).then(tab => {
          setTimeout(() => resolve({ url: tab.url }), 500);
        }).catch(() => resolve({ timeout: true }));
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
