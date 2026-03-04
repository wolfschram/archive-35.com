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
    const results = await chrome.scripting.executeScript({
      target: { tabId: cafeTabId },
      world: 'MAIN',
      args: [metadata, imageBase64, filename],
      func: pageContextUpload,
    });

    // executeScript returns an array of results (one per frame)
    const result = results?.[0]?.result;
    return result || { success: false, error: 'No result from page script' };
  } catch (err) {
    return { success: false, error: `Script execution failed: ${err.message}` };
  }
}

/**
 * This function runs in the PAGE's JavaScript context (world: 'MAIN').
 * It has access to jQuery, CaFE's validateForm(), and native DOM events.
 * Arguments are passed via chrome.scripting.executeScript args.
 */
function pageContextUpload(metadata, imageBase64, filename) {
  const UNITS = { 'Inches': '1', 'Feet': '2', 'Centimeter': '3', 'Meters': '4' };
  const DISCIPLINES = { 'Photography': '28', 'Digital Media': '7', 'Mixed Media': '23' };

  try {
    // Check we're on the upload page
    if (!window.location.href.includes('media_upload.php')) {
      return { success: false, error: 'Not on media_upload.php' };
    }

    console.log(`[CaFE Page] Upload: "${metadata.title}" (${filename})`);

    // 1. Convert base64 → File
    const byteChars = atob(imageBase64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([byteArray], { type: 'image/jpeg' });
    const file = new File([blob], filename, { type: 'image/jpeg' });

    console.log(`[CaFE Page] File: ${(file.size / 1024).toFixed(0)} KB`);

    // 2. Set file on input
    const fileInput = document.querySelector('#mediaFile');
    if (!fileInput) return { success: false, error: 'File input #mediaFile not found' };

    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    console.log(`[CaFE Page] File set: ${fileInput.files[0]?.name}`);

    // 3. Fill form fields
    function setVal(id, val) {
      const el = document.getElementById(id) || document.querySelector(`[name="${id}"]`);
      if (el) {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    setVal('mediaTypeRadio', 'image');
    setVal('imageTitle', metadata.title || '');
    setVal('imageAltText', metadata.alt_text || '');
    setVal('imageMedium', metadata.medium || 'Digital photograph, archival pigment print');
    setVal('imageDescription', metadata.description || '');
    setVal('imageHeight', String(metadata.height || 20));
    setVal('imageWidth', String(metadata.width || 30));
    setVal('imageDepth', String(metadata.depth || 0.1));

    const unitVal = UNITS[metadata.units] || '1';
    setVal('imageHeightDimensions', unitVal);
    setVal('imageWidthDimensions', unitVal);
    setVal('imageDepthDimensions', unitVal);

    const forSaleVal = (metadata.for_sale === 'Yes' || metadata.for_sale === true) ? '1' : '0';
    setVal('imageForSale', forSaleVal);
    if (metadata.price) setVal('imagePrice', String(metadata.price));
    setVal('imageYearCompleted', String(metadata.year || new Date().getFullYear()));
    setVal('primaryDiscipline', DISCIPLINES[metadata.discipline] || '28');
    setVal('publicArt', (metadata.public_art === 'Yes') ? '1' : '0');

    // Set hidden fields
    const sampleType = document.getElementById('sample_type');
    if (sampleType) sampleType.value = 'image';
    const newUpdate = document.getElementById('newUpdateMedia');
    if (newUpdate) newUpdate.value = 'new';

    console.log('[CaFE Page] All fields filled');

    // 4. Hook form submit
    const form = document.querySelector('#uploadForm');
    let formSubmitted = false;
    if (form) {
      form.addEventListener('submit', () => { formSubmitted = true; }, { once: true });
    }

    // 5. Click upload button
    const btn = document.querySelector('#imageUploadButton');
    if (!btn) return { success: false, error: 'Upload button not found' };

    btn.click();
    console.log('[CaFE Page] Button clicked');

    // Note: We can't await here since this must return synchronously.
    // The form submission is synchronous — if validateForm passes, it submits immediately.
    // We check formSubmitted right after click.

    if (formSubmitted) {
      console.log(`[CaFE Page] Form submitted: "${metadata.title}"`);
      return { success: true, title: metadata.title };
    }

    // If not submitted yet, maybe validateForm hasn't run.
    // Return a pending state — the popup will verify via page reload.
    return { success: true, title: metadata.title, note: 'Button clicked, form processing' };

  } catch (err) {
    console.error('[CaFE Page] Error:', err);
    return { success: false, error: err.message };
  }
}

// ── Tab Lifecycle ──────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === cafeTabId) {
    cafeTabId = null;
    chrome.storage.local.remove('cafeTab');
  }
});
