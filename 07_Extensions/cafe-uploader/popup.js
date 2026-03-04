/**
 * CaFE Uploader — Popup Script
 *
 * Flow:
 * 1. Select images (multi-file JPG picker) + select metadata (CSV/JSON picker)
 * 2. Review (thumbnails, portfolio sync, stats)
 * 3. Upload to CaFE via content script
 */

(() => {
  'use strict';

  // ── State ──────────────────────────────────────────────────

  let imageFiles = new Map();    // filename → File object
  let metadataEntries = [];      // Parsed metadata array
  let metaText = null;           // Raw metadata text
  let metaFilename = null;       // Metadata filename
  let portfolioImages = [];      // Already in CaFE portfolio
  let uploadQueue = [];          // Items to upload
  let isUploading = false;

  // ── DOM Elements ───────────────────────────────────────────

  const $ = (id) => document.getElementById(id);
  const statusBadge = $('statusBadge');
  const toastArea = $('toastArea');
  const imageInput = $('imageInput');
  const metaInput = $('metaInput');
  const imageStatus = $('imageStatus');
  const metaStatus = $('metaStatus');
  const step2 = $('step2');
  const imageGrid = $('imageGrid');
  const queueList = $('queueList');
  const progressArea = $('progressArea');
  const progressFill = $('progressFill');
  const progressText = $('progressText');
  const uploadAllBtn = $('uploadAllBtn');
  const retryBtn = $('retryBtn');
  const statTotal = $('statTotal');
  const statExisting = $('statExisting');
  const statNew = $('statNew');
  const statIssues = $('statIssues');
  const statIssuesCard = $('statIssuesCard');

  // ── Init ───────────────────────────────────────────────────

  async function init() {
    // Image picker
    $('selectImagesBtn').addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', handleImagesSelected);

    // Metadata picker
    $('selectMetaBtn').addEventListener('click', () => metaInput.click());
    metaInput.addEventListener('change', handleMetaSelected);

    // Upload
    uploadAllBtn.addEventListener('click', handleUploadAll);
    retryBtn.addEventListener('click', handleRetryFailed);

    // Check CaFE connection
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

  // ── Step 1a: Image Selection ──────────────────────────────

  function handleImagesSelected(e) {
    const files = Array.from(e.target.files || []);
    imageFiles.clear();

    for (const file of files) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
        imageFiles.set(file.name, file);
      }
    }

    imageStatus.textContent = imageFiles.size > 0
      ? `✅ ${imageFiles.size} JPEGs loaded`
      : '⚠️ No JPEGs found';
    imageStatus.className = imageFiles.size > 0 ? 'file-status success' : 'file-status warning';

    console.log('[CaFE] Images loaded:', [...imageFiles.keys()]);
    tryProceed();
  }

  // ── Step 1b: Metadata Selection ───────────────────────────

  async function handleMetaSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      metaText = await file.text();
      metaFilename = file.name;

      metaStatus.textContent = `✅ ${file.name} loaded`;
      metaStatus.className = 'file-status success';

      console.log('[CaFE] Metadata loaded:', file.name, `(${metaText.length} chars)`);
      tryProceed();
    } catch (err) {
      metaStatus.textContent = `⚠️ Error: ${err.message}`;
      metaStatus.className = 'file-status warning';
    }
  }

  // ── Auto-proceed when both are loaded ─────────────────────

  async function tryProceed() {
    if (imageFiles.size === 0 || !metaText) return;

    try {
      // Parse metadata
      metadataEntries = MetadataParser.parse(metaText, metaFilename);
      metadataEntries.forEach(e => MetadataParser.validate(e));

      // Match metadata to actual image files
      metadataEntries = metadataEntries.filter(entry => {
        if (imageFiles.has(entry.file)) return true;
        // Fuzzy match
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

      showToast(`Matched ${metadataEntries.filter(e => e._valid).length} of ${metadataEntries.length} images`, 'success');

      // Move to Step 2
      await showReview();
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  }

  // ── Step 2: Review ────────────────────────────────────────

  async function showReview() {
    step2.style.display = 'block';

    // Try to sync with CaFE portfolio
    await syncPortfolio();

    // Classify entries
    const newEntries = [];
    const existingEntries = [];
    const issueEntries = [];

    metadataEntries.forEach(entry => {
      const inPortfolio = portfolioImages.some(p =>
        p.title.toLowerCase().trim() === entry.title.toLowerCase().trim()
      );

      entry._inPortfolio = inPortfolio;

      if (!entry._valid) {
        issueEntries.push(entry);
      } else if (inPortfolio) {
        existingEntries.push(entry);
      } else {
        newEntries.push(entry);
      }
    });

    // Update stats
    statTotal.textContent = metadataEntries.length;
    statExisting.textContent = existingEntries.length;
    statNew.textContent = newEntries.length;

    if (issueEntries.length > 0) {
      statIssuesCard.style.display = 'block';
      statIssues.textContent = issueEntries.length;
    }

    // Build image grid
    renderImageGrid(metadataEntries);

    // Build upload queue (only new + valid)
    uploadQueue = newEntries;
    renderQueue();

    // Enable upload button
    uploadAllBtn.disabled = uploadQueue.length === 0;
    uploadAllBtn.textContent = uploadQueue.length > 0
      ? `Upload ${uploadQueue.length} New`
      : 'Nothing to Upload';
  }

  async function syncPortfolio() {
    try {
      const connected = await checkCafeConnection();
      if (!connected) {
        portfolioImages = [];
        return;
      }

      const result = await sendToBackground({
        action: 'relayToContent',
        payload: { action: 'scrapePortfolio' },
      });

      if (result?.success) {
        portfolioImages = result.images || [];
      } else {
        portfolioImages = [];
      }
    } catch {
      portfolioImages = [];
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
      if (file) {
        img.src = URL.createObjectURL(file);
      }

      card.appendChild(img);

      const label = document.createElement('div');
      label.className = 'card-label';
      label.textContent = entry.title;
      card.appendChild(label);

      if (entry._inPortfolio) {
        const status = document.createElement('div');
        status.className = 'card-status';
        status.textContent = '✅';
        status.title = 'Already in CaFE portfolio';
        card.appendChild(status);
      } else if (!entry._valid) {
        const status = document.createElement('div');
        status.className = 'card-status';
        status.textContent = '⚠️';
        status.title = entry._errors.join(', ');
        card.appendChild(status);
      }

      imageGrid.appendChild(card);
    });
  }

  function renderQueue() {
    queueList.innerHTML = '';

    uploadQueue.forEach((entry, idx) => {
      const item = document.createElement('div');
      item.className = 'queue-item';
      item.id = `qi-${idx}`;

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

    uploadAllBtn.disabled = true;
    uploadAllBtn.textContent = 'Uploading...';
    progressArea.style.display = 'block';

    const total = uploadQueue.length;
    let completed = 0;
    let failed = 0;

    for (let i = 0; i < uploadQueue.length; i++) {
      const entry = uploadQueue[i];
      const statusEl = document.getElementById(`qis-${i}`);

      statusEl.textContent = 'Uploading';
      statusEl.className = 'qi-status uploading';

      try {
        const fname = entry._matchedFile || entry.file;
        const file = imageFiles.get(fname);
        if (!file) throw new Error('File not found');

        const arrayBuffer = await file.arrayBuffer();

        const result = await sendToBackground({
          action: 'relayToContent',
          payload: {
            action: 'uploadImage',
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
              file: fname,
            },
            imageData: Array.from(new Uint8Array(arrayBuffer)),
            filename: fname,
          },
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
        entry._error = err.message;
        failed++;
      }

      const done = completed + failed;
      progressFill.style.width = `${(done / total) * 100}%`;
      progressText.textContent = `${done} / ${total}${failed > 0 ? ` (${failed} failed)` : ''}`;

      if (i < uploadQueue.length - 1) {
        await sleep(1500);
      }
    }

    isUploading = false;

    if (failed === 0) {
      showToast(`All ${completed} images uploaded successfully!`, 'success');
      uploadAllBtn.textContent = 'All Done';
    } else {
      showToast(`${completed} uploaded, ${failed} failed`, 'warning');
      uploadAllBtn.textContent = `${completed}/${total} Done`;
      retryBtn.style.display = 'block';
    }

    statExisting.textContent = parseInt(statExisting.textContent) + completed;
    statNew.textContent = Math.max(0, parseInt(statNew.textContent) - completed);
  }

  async function handleRetryFailed() {
    const failedEntries = uploadQueue.filter(e => e._error && !e._uploaded);
    if (failedEntries.length === 0) return;

    failedEntries.forEach(entry => { entry._error = null; });
    uploadQueue = failedEntries;
    renderQueue();
    await handleUploadAll();
  }

  // ── Messaging Helpers ─────────────────────────────────────

  function sendToBackground(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // ── UI Helpers ────────────────────────────────────────────

  function showToast(text, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = text;
    toastArea.innerHTML = '';
    toastArea.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 5000);
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ── Start ─────────────────────────────────────────────────

  init();

})();
