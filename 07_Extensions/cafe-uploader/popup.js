/**
 * CaFE Uploader — Popup Script
 *
 * Flow:
 * 1. Select folder (scans ALL subfolders for images + metadata)
 * 2. Review (thumbnails, portfolio sync, stats)
 * 3. Upload to CaFE via content script (base64 transfer + fetch POST)
 */

(() => {
  'use strict';

  // ── Popup → Tab Promotion ─────────────────────────────────
  // Extension popups auto-close when Chrome navigates tabs (focus loss).
  // For batch uploads, we need the UI to stay open. If running as a popup
  // (not already a tab), reopen as a stable tab and close the popup.
  if (!window.location.search.includes('mode=tab')) {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?mode=tab') });
    window.close();
    return;
  }
  // Running as a tab — apply tab-mode styling
  document.body.classList.add('tab-mode');

  // ── State ──────────────────────────────────────────────────

  let imageFiles = new Map();    // filename → File object
  let metadataEntries = [];      // Parsed metadata array
  let portfolioImages = [];      // Already in CaFE portfolio
  let uploadQueue = [];          // Items to upload
  let isUploading = false;
  let cancelRequested = false;   // Cancel flag

  // ── Keepalive Port ──────────────────────────────────────────
  // Keeps the MV3 service worker alive during long upload sessions.
  // Without this, the service worker dies after ~30s of setTimeout activity.
  let keepAlivePort = null;

  function connectKeepAlive() {
    try {
      keepAlivePort = chrome.runtime.connect({ name: 'keepalive' });
      keepAlivePort.onDisconnect.addListener(() => {
        console.log('[Popup] Keepalive port disconnected, reconnecting...');
        keepAlivePort = null;
        // Reconnect after brief delay (worker may have restarted)
        setTimeout(connectKeepAlive, 1000);
      });
      console.log('[Popup] Keepalive port connected');
    } catch (err) {
      console.error('[Popup] Keepalive connect failed:', err);
      setTimeout(connectKeepAlive, 2000);
    }
  }

  // ── DOM Elements ───────────────────────────────────────────

  const $ = (id) => document.getElementById(id);
  const statusBadge = $('statusBadge');
  const toastArea = $('toastArea');
  const folderInput = $('folderInput');
  const scanResults = $('scanResults');
  const imageStatus = $('imageStatus');
  const metaStatus = $('metaStatus');
  const step2 = $('step2');
  const imageGrid = $('imageGrid');
  const queueList = $('queueList');
  const progressArea = $('progressArea');
  const progressFill = $('progressFill');
  const progressText = $('progressText');
  const uploadAllBtn = $('uploadAllBtn');
  const cancelBtn = $('cancelBtn');
  const retryBtn = $('retryBtn');
  const statTotal = $('statTotal');
  const statExisting = $('statExisting');
  const statNew = $('statNew');
  const statIssues = $('statIssues');
  const statIssuesCard = $('statIssuesCard');

  // ── Init ───────────────────────────────────────────────────

  async function init() {
    // Connect keepalive port FIRST — keeps service worker alive
    connectKeepAlive();

    $('selectFolderBtn').addEventListener('click', () => folderInput.click());
    folderInput.addEventListener('change', handleFolderSelected);
    uploadAllBtn.addEventListener('click', handleUploadAll);
    if (cancelBtn) cancelBtn.addEventListener('click', handleCancel);
    if (retryBtn) retryBtn.addEventListener('click', handleRetryFailed);

    await checkCafeConnection();
  }

  // ── CaFE Connection Check ─────────────────────────────────

  async function checkCafeConnection() {
    statusBadge.textContent = 'Checking...';
    statusBadge.className = 'status-badge checking';

    try {
      const result = await sendToBackground({ action: 'findCafeTab' });
      if (result?.found) {
        statusBadge.textContent = 'Connected';
        statusBadge.className = 'status-badge connected';
        return true;
      }
    } catch {}

    statusBadge.textContent = 'No CaFE Tab';
    statusBadge.className = 'status-badge disconnected';
    return false;
  }

  // ── Step 1: Folder Selection (deep scan) ──────────────────

  async function handleFolderSelected(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
      imageFiles.clear();
      let metaText = null;
      let metaFilename = null;

      const allCsvFiles = [];
      const allJsonFiles = [];

      for (const file of files) {
        const lower = file.name.toLowerCase();

        if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
          imageFiles.set(file.name, file);
        }
        if (lower.endsWith('.csv')) {
          allCsvFiles.push(file);
        }
        if (lower.endsWith('.json') && !lower.startsWith('.')) {
          allJsonFiles.push(file);
        }
      }

      // Find best metadata file — try JSON first, fall back to CSV if empty
      const jsonCandidates = [
        ...allJsonFiles.filter(f => f.name.toLowerCase() === 'submission.json'),
        ...allJsonFiles,
      ];
      const csvCandidates = [
        ...allCsvFiles.filter(f => f.name.toLowerCase() === 'cafe_metadata.csv'),
        ...allCsvFiles.filter(f => f.name.toLowerCase().includes('metadata')),
        ...allCsvFiles.filter(f => f.name.toLowerCase().includes('cafe')),
        ...allCsvFiles,
      ];

      // Try JSON first
      for (const candidate of jsonCandidates) {
        const text = await candidate.text();
        try {
          const parsed = JSON.parse(text);
          const items = Array.isArray(parsed) ? parsed : (parsed.metadata || parsed.images || []);
          if (items.length > 0) {
            metaText = text;
            metaFilename = candidate.name;
            break;
          }
          console.log(`[CaFE] ${candidate.name} is empty, trying next...`);
        } catch { console.log(`[CaFE] ${candidate.name} invalid JSON, skipping`); }
      }

      // Fall back to CSV if no valid JSON
      if (!metaText && csvCandidates.length > 0) {
        metaText = await csvCandidates[0].text();
        metaFilename = csvCandidates[0].name;
      }

      console.log('[CaFE] Folder scan:', {
        totalFiles: files.length,
        images: imageFiles.size,
        csvFiles: allCsvFiles.map(f => f.webkitRelativePath),
        jsonFiles: allJsonFiles.map(f => f.webkitRelativePath),
        metadataFile: metaFilename,
      });

      // Update UI
      scanResults.style.display = 'block';
      imageStatus.textContent = imageFiles.size > 0 ? `📷 ${imageFiles.size} JPEGs found` : '⚠️ No JPEGs found';
      imageStatus.className = imageFiles.size > 0 ? 'file-status success' : 'file-status warning';
      metaStatus.textContent = metaFilename ? `📄 ${metaFilename}` : '⚠️ No metadata file found';
      metaStatus.className = metaFilename ? 'file-status success' : 'file-status warning';

      if (imageFiles.size === 0) { showToast('No JPEG images found', 'warning'); return; }
      if (!metaText) { showToast('No cafe_metadata.csv found', 'warning'); return; }

      // Parse metadata
      metadataEntries = MetadataParser.parse(metaText, metaFilename);
      metadataEntries.forEach(e => MetadataParser.validate(e));

      // Match metadata to image files
      metadataEntries = metadataEntries.filter(entry => {
        if (imageFiles.has(entry.file)) return true;
        for (const [fname] of imageFiles) {
          if (fname.includes(entry.file) || entry.file.includes(fname)) {
            entry._matchedFile = fname;
            return true;
          }
        }
        entry._errors.push('Image file not found');
        entry._valid = false;
        return true;
      });

      showToast(`Matched ${metadataEntries.filter(e => e._valid).length} images with metadata`, 'success');

      // Re-check CaFE connection now (user may have opened CaFE tab since init)
      await checkCafeConnection();
      await showReview();
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  }

  // ── Step 2: Review ────────────────────────────────────────

  async function showReview() {
    step2.style.display = 'block';
    await syncPortfolio();

    const newEntries = [], existingEntries = [], issueEntries = [];

    console.log(`[Popup] Comparing ${metadataEntries.length} local entries against ${portfolioImages.length} portfolio titles`);

    metadataEntries.forEach(entry => {
      const localTitle = entry.title.toLowerCase().trim();
      const inPortfolio = portfolioImages.some(p => {
        const portfolioTitle = p.title.toLowerCase().trim();
        return portfolioTitle === localTitle;
      });
      entry._inPortfolio = inPortfolio;

      console.log(`[Popup]  "${entry.title}" → ${inPortfolio ? '✅ IN PORTFOLIO' : '🆕 NEW'}`);

      if (!entry._valid) issueEntries.push(entry);
      else if (inPortfolio) existingEntries.push(entry);
      else newEntries.push(entry);
    });

    statTotal.textContent = metadataEntries.length;
    statExisting.textContent = existingEntries.length;
    statNew.textContent = newEntries.length;
    if (issueEntries.length > 0) {
      statIssuesCard.style.display = 'block';
      statIssues.textContent = issueEntries.length;
    }

    renderImageGrid(metadataEntries);
    uploadQueue = newEntries;
    renderQueue();

    uploadAllBtn.disabled = uploadQueue.length === 0;
    uploadAllBtn.textContent = uploadQueue.length > 0
      ? `Upload ${uploadQueue.length} New` : 'Nothing to Upload';
  }

  async function syncPortfolio() {
    try {
      // getPortfolioTitles creates its own hidden tab to scrape — it does NOT
      // need a pre-existing CaFE tab. Don't gate on checkCafeConnection().
      showToast('Scanning CaFE portfolio for duplicates...', 'info');
      console.log('[Popup] Starting portfolio sync...');
      const result = await sendToBackground({ action: 'getPortfolioTitles' });
      console.log('[Popup] Portfolio scrape result:', JSON.stringify(result));

      if (result?.success && result.titles?.length > 0) {
        portfolioImages = result.titles.map(t => ({ title: t }));
        console.log(`[Popup] Portfolio titles found (${portfolioImages.length}):`,
          portfolioImages.map(p => p.title));
        showToast(`Found ${portfolioImages.length} images already in CaFE`, 'success');
      } else {
        portfolioImages = [];
        const reason = result?.error || 'No titles found';
        console.warn('[Popup] Portfolio scrape issue:', reason);
        showToast(`Portfolio scan: ${reason}`, 'warning');
      }
    } catch (err) {
      console.error('[Popup] syncPortfolio failed:', err);
      portfolioImages = [];
      showToast(`Portfolio scan failed: ${err.message}`, 'error');
    }
  }

  function renderImageGrid(entries) {
    imageGrid.innerHTML = '';
    entries.forEach((entry) => {
      const card = document.createElement('div');
      card.className = 'image-card';
      if (entry._inPortfolio) card.classList.add('uploaded');

      const img = document.createElement('img');
      img.alt = entry.title;
      img.style.background = '#2a2a3a';
      const fname = entry._matchedFile || entry.file;
      const file = imageFiles.get(fname);
      if (file) img.src = URL.createObjectURL(file);
      card.appendChild(img);

      const label = document.createElement('div');
      label.className = 'card-label';
      label.textContent = entry.title;
      card.appendChild(label);

      if (entry._inPortfolio) {
        const s = document.createElement('div');
        s.className = 'card-status'; s.textContent = '✅'; s.title = 'Already in CaFE';
        card.appendChild(s);
      } else if (!entry._valid) {
        const s = document.createElement('div');
        s.className = 'card-status'; s.textContent = '⚠️'; s.title = entry._errors.join(', ');
        card.appendChild(s);
      }
      imageGrid.appendChild(card);
    });
  }

  function renderQueue() {
    queueList.innerHTML = '';
    uploadQueue.forEach((entry, idx) => {
      const item = document.createElement('div');
      item.className = 'queue-item'; item.id = `qi-${idx}`;
      item.innerHTML = `
        <span class="qi-title">${entry.title}</span>
        <span class="qi-status pending" id="qis-${idx}">Pending</span>
      `;
      queueList.appendChild(item);
    });
  }

  // ── Step 3: Upload ────────────────────────────────────────

  async function handleUploadAll() {
    if (isUploading || uploadQueue.length === 0) return;
    isUploading = true;
    cancelRequested = false;

    uploadAllBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'block';
    progressArea.style.display = 'block';

    const total = uploadQueue.length;
    let completed = 0, failed = 0;

    for (let i = 0; i < uploadQueue.length; i++) {
      // Check cancel
      if (cancelRequested) {
        // Mark remaining as skipped
        for (let j = i; j < uploadQueue.length; j++) {
          const s = document.getElementById(`qis-${j}`);
          if (s) { s.textContent = 'Cancelled'; s.className = 'qi-status failed'; }
        }
        break;
      }

      const entry = uploadQueue[i];
      const statusEl = document.getElementById(`qis-${i}`);
      statusEl.textContent = 'Uploading';
      statusEl.className = 'qi-status uploading';

      try {
        const fname = entry._matchedFile || entry.file;
        const file = imageFiles.get(fname);
        if (!file) throw new Error('File not found');

        // Convert to base64 for reliable Chrome messaging
        const base64 = await fileToBase64(file);

        const result = await sendToBackground({
          action: 'uploadToPage',
          metadata: {
            title: entry.title,
            alt_text: entry.alt_text,
            medium: entry.medium,
            description: entry.description,
            height: entry.height,
            width: entry.width,
            depth: entry.depth,
            units: entry.units,
            for_sale: entry.for_sale,
            price: entry.price,
            year: entry.year,
            discipline: entry.discipline,
            public_art: entry.public_art,
          },
          imageBase64: base64,
          filename: fname,
        });

        if (result?.success) {
          statusEl.textContent = 'Done';
          statusEl.className = 'qi-status done';
          entry._uploaded = true;
          completed++;
        } else {
          throw new Error(result?.error || 'Upload failed');
        }
      } catch (err) {
        statusEl.textContent = 'Failed';
        statusEl.className = 'qi-status failed';
        statusEl.title = err.message; // Hover to see error
        entry._error = err.message;
        failed++;
        // Show the error in toast so user can see it
        showToast(err.message, 'error');

        // If it's a capacity/limit error, stop uploading — all will fail
        if (err.message.includes('maximum') || err.message.includes('limit') || err.message.includes('allowed')) {
          showToast('Portfolio is full — cannot upload more images', 'error');
          for (let j = i + 1; j < uploadQueue.length; j++) {
            const s = document.getElementById(`qis-${j}`);
            if (s) { s.textContent = 'Blocked'; s.className = 'qi-status failed'; }
          }
          break;
        }
      }

      const done = completed + failed;
      progressFill.style.width = `${(done / total) * 100}%`;
      progressText.textContent = `${done} / ${total}${failed > 0 ? ` (${failed} failed)` : ''}`;

      // Brief pause between uploads — background.js already navigated
      // back to media_upload.php and waited for load, so just a small
      // delay for stability.
      if (i < uploadQueue.length - 1 && !cancelRequested) {
        const nextStatus = document.getElementById(`qis-${i + 1}`);
        if (nextStatus) { nextStatus.textContent = 'Preparing...'; nextStatus.className = 'qi-status uploading'; }
        console.log(`[Popup] Upload ${i + 1}/${total} done. Brief pause before #${i + 2}...`);
        await sleep(2000);
      }
    }

    isUploading = false;
    if (cancelBtn) cancelBtn.style.display = 'none';
    uploadAllBtn.style.display = 'block';

    if (cancelRequested) {
      showToast(`Cancelled. ${completed} uploaded before cancel.`, 'warning');
      uploadAllBtn.textContent = `Cancelled (${completed}/${total})`;
      uploadAllBtn.disabled = true;
    } else if (failed === 0) {
      showToast(`All ${completed} images uploaded!`, 'success');
      uploadAllBtn.textContent = 'All Done';
    } else {
      showToast(`${completed} uploaded, ${failed} failed`, 'warning');
      uploadAllBtn.textContent = `${completed}/${total} Done`;
      retryBtn.style.display = 'block';
    }

    statExisting.textContent = parseInt(statExisting.textContent) + completed;
    statNew.textContent = Math.max(0, parseInt(statNew.textContent) - completed);
  }

  function handleCancel() {
    cancelRequested = true;
    if (cancelBtn) cancelBtn.textContent = 'Cancelling...';
    showToast('Cancelling after current upload finishes...', 'warning');
  }

  async function handleRetryFailed() {
    const failedEntries = uploadQueue.filter(e => e._error && !e._uploaded);
    if (failedEntries.length === 0) return;
    failedEntries.forEach(entry => { entry._error = null; });
    uploadQueue = failedEntries;
    renderQueue();
    retryBtn.style.display = 'none';
    await handleUploadAll();
  }

  // ── Helpers ────────────────────────────────────────────────

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // result is "data:image/jpeg;base64,XXXX" — strip the prefix
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  async function waitForContentScript(maxWait = 15000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        const result = await sendToBackground({
          action: 'relayToContent',
          payload: { action: 'ping' },
        });
        if (result?.alive && result?.onUploadPage) {
          await sleep(500);
          return true;
        }
      } catch {}
      await sleep(1000);
    }
    return false;
  }

  function sendToBackground(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });
  }

  function showToast(text, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = text;
    toastArea.innerHTML = '';
    toastArea.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 5000);
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Start ─────────────────────────────────────────────────

  init();

})();
