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
 * It has access to the page's cookies for authenticated fetch requests.
 *
 * Uses fetch POST with FormData instead of native form submission because
 * files set via DataTransfer API are NOT included in native form POSTs
 * (browser security restriction). fetch() with FormData works correctly.
 */
async function pageContextUpload(metadata, imageBase64, filename) {
  const UNITS = { 'Inches': '1', 'Feet': '2', 'Centimeter': '3', 'Meters': '4' };
  const DISCIPLINES = { 'Photography': '28', 'Digital Media': '7', 'Mixed Media': '23' };

  try {
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

    // 2. Build FormData with all hidden fields from the live form
    const form = document.querySelector('#uploadForm');
    if (!form) return { success: false, error: 'Form #uploadForm not found' };

    const formData = new FormData();

    // Copy ALL hidden fields (pf_fk, pf_secret, etc.)
    form.querySelectorAll('input[type="hidden"]').forEach(input => {
      if (input.name) formData.append(input.name, input.value);
    });

    // Override key hidden fields
    formData.set('sample_type', 'image');
    formData.set('newUpdateMedia', 'new');

    // 3. Attach the file
    formData.set('mediaFile', file, filename);

    // 4. Set all metadata fields
    formData.set('imageTitle', metadata.title || '');
    formData.set('imageAltText', metadata.alt_text || '');
    formData.set('imageMedium', metadata.medium || 'Digital photograph, archival pigment print');
    formData.set('imageDescription', metadata.description || '');
    formData.set('imageHeight', String(metadata.height || 20));
    formData.set('imageWidth', String(metadata.width || 30));
    formData.set('imageDepth', String(metadata.depth || 0.1));

    const unitVal = UNITS[metadata.units] || '1';
    formData.set('imageHeightDimensions', unitVal);
    formData.set('imageWidthDimensions', unitVal);
    formData.set('imageDepthDimensions', unitVal);

    const forSaleVal = (metadata.for_sale === 'Yes' || metadata.for_sale === true) ? '1' : '0';
    formData.set('imageForSale', forSaleVal);
    if (metadata.price) formData.set('imagePrice', String(metadata.price));
    formData.set('imageYearCompleted', String(metadata.year || new Date().getFullYear()));
    formData.set('primaryDiscipline', DISCIPLINES[metadata.discipline] || '28');
    formData.set('publicArt', (metadata.public_art === 'Yes') ? '1' : '0');

    console.log('[CaFE Page] FormData built, POSTing via fetch...');

    // 5. POST via fetch — CRITICAL: No Content-Type header!
    //    Browser sets multipart boundary automatically.
    //    Running in page context = cookies are included automatically.
    const response = await fetch('https://artist.callforentry.org/media_upload.php', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    console.log(`[CaFE Page] Response: ${response.status}, redirected: ${response.redirected}`);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const html = await response.text();

    // 6. Check for errors in response
    const errorMatch = html.match(/class="[^"]*alert[- ]danger[^"]*"[^>]*>([\s\S]*?)<\/div/i);
    if (errorMatch) {
      const errText = errorMatch[1].replace(/<[^>]+>/g, '').trim();
      if (errText && !errText.includes('maximum number')) {
        console.error(`[CaFE Page] Server error: ${errText}`);
        return { success: false, error: errText.substring(0, 200) };
      }
    }

    // Check for specific file error
    if (html.includes('Please select a media file')) {
      return { success: false, error: 'Server did not receive the file' };
    }
    if (html.includes('not a jpeg')) {
      return { success: false, error: 'Server rejected file — not recognized as JPEG' };
    }
    if (html.includes('minimum of 1200 pixels')) {
      return { success: false, error: 'Image too small — minimum 1200px on longest side' };
    }

    // Success indicators
    if (html.includes('has been added') || html.includes('successfully') || response.redirected) {
      console.log(`[CaFE Page] SUCCESS: "${metadata.title}"`);
      return { success: true, title: metadata.title };
    }

    // If we see the upload form again without errors, likely success (page reloads to add more)
    if (html.includes('Add Media') && !html.includes('Error adding')) {
      console.log(`[CaFE Page] Likely success (form reloaded clean): "${metadata.title}"`);
      return { success: true, title: metadata.title };
    }

    // Ambiguous
    console.warn('[CaFE Page] Ambiguous response');
    return { success: true, title: metadata.title, note: 'Verify in portfolio' };

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
