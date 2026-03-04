/**
 * CaFE Uploader — Background Service Worker
 *
 * Coordinates communication between popup and content script.
 * Manages upload queue state and CaFE tab detection.
 */

// ── State ──────────────────────────────────────────────────────

let cafeTabId = null;

// ── Message Routing ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Content script reporting page status
  if (msg.action === 'pageStatus') {
    if (sender.tab) {
      cafeTabId = sender.tab.id;
      // Store for popup to read
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

  // Popup asking to relay message to content script
  if (msg.action === 'relayToContent') {
    relayToContent(msg.payload).then(sendResponse).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
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

    // Try to reuse existing tab
    if (cafeTabId) {
      try {
        await chrome.tabs.update(cafeTabId, { url, active: true });
        return { success: true, tabId: cafeTabId };
      } catch {
        cafeTabId = null;
      }
    }

    // Create new tab
    const tab = await chrome.tabs.create({ url });
    cafeTabId = tab.id;
    return { success: true, tabId: tab.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Content Script Relay ───────────────────────────────────────

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
    // Tab might have closed or navigated away
    cafeTabId = null;
    throw new Error(`Could not reach CaFE tab: ${err.message}`);
  }
}

// ── Tab Lifecycle ──────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === cafeTabId) {
    cafeTabId = null;
    chrome.storage.local.remove('cafeTab');
  }
});
