/**
 * CaFE Uploader — Popup Script
 *
 * Orchestrates the 3-step flow:
 * 1. Folder selection (webkitdirectory file input — gets ALL files reliably)
 * 2. Review (metadata parsing + portfolio sync)
 * 3. Upload (relay images to content script on CaFE)
 */

(() => {
  'use strict';

  // ── State ──────────────────────────────────────────────────

  let imageFiles = new Map();    // filename → File object
  let metadataEntries = [];      // Parsed metadata array
  let portfolioImages = [];      // Already in CaFE portfolio
  let uploadQueue = [];          // Items to upload
  let isUploading = false;

  // ── DOM Elements ───────────────────────────────────────────

  const $ = (id) => document.getElementById(id);
  const statusBadge = $('statusBadge');
  const toastArea = $('toastArea');
  const selectFolderBtn = $('selectFolderBtn');
  const folderInput = $('folderInput');
  const folderInfo = $('folderInfo');
  const imageCount = $('imageCount');
  const metadataFile = $('metadataFile');
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
    // Button triggers the hidden file input
    selectFolderBtn.addEventListener('click', () => folderInput.click());
    folderInput.addEventListener('change', handleFolderSelected);
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

  // ── Step 1: Folder Selection ──────────────────────────────

  async function handleFolderSelected(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
      // Clear previous state
      imageFiles.clear();
      let metaText = null;
      let metaFilename = null;

      // webkitdirectory gives us ALL files with their relative paths
      // File.webkitRelativePath = "FolderName/filename.ext"
      // We only care about top-level files (one path separator)

      for (const file of files) {
        const name = file.name;
        const lower = name.toLowerCase();

        // Only process files directly in the selected folder (not subfolders)
        const parts = file.webkitRelativePath.split('/');
        if (parts.length > 2) continue; // skip subfolder files

        if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
          imageFiles.set(name, file);
        }

        // Find metadata file (prioritize exact names)
        if (!metaText) {
          if (lower === 'cafe_metadata.csv' || lower === 'submission.json') {
            metaText = await file.text();
            metaFilename = name;
          }
        }
      }

      // If no exact match, try any CSV or JSON
      if (!metaText) {
        for (const file of files) {
          const lower = file.name.toLowerCase();
          const parts = file.webkitRelativePath.split('/');
          if (parts.length > 2) continue;

          if (lower.endsWith('.csv') || lower.endsWith('.json')) {
            metaText = await file.text();
            metaFilename = file.name;
            break;
          }
        }
      }

      console.log('[CaFE Uploader] Folder scan:', {
        totalFiles: files.length,
        images: imageFiles.size,
        metadataFile: metaFilename,
        fileNames: files.map(f => f.name),
      });

      // Update UI
      folderInfo.style.display = 'block';
      imageCount.textContent = imageFiles.size;
      metadataFile.textContent = metaFilename || 'Not found';

      if (imageFiles.size === 0) {
        showToast('No JPEG images found in folder', 'warning');
        return;
      }

      if (!metaText) {
        showToast('No metadata file found (cafe_metadata.csv or submission.json)', 'warning');
        return;
      }

      // Parse metadata
      metadataEntries = MetadataParser.parse(metaText, metaFilename);
      metadataEntries.forEach(e => MetadataParser.validate(e));

      // Match metadata to actual image files
      metadataEntries = metadataEntries.filter(entry => {
        if (imageFiles.has(entry.file)) return true;
        // Fuzzy match (handle path prefixes like "001_Wolf 183.jpg" → "Wolf 183.jpg")
        for (const [fname] of imageFiles) {
          if (fname.includes(entry.file) || entry.file.includes(fname)) {
            entry._matchedFile = fname;
            return true;
          }
        }
        entry._errors.push('Image file not found in folder');
        entry._valid = false;
        return true; // Keep for display, mark as invalid
      });

      showToast(`Found ${metadataEntries.length} images with metadata`, 'success');

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
      // Check if already in CaFE
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

    entries.forEach((entry, idx) => {
      const card = document.createElement('div');
      card.className = 'image-card';
      if (entry._inPortfolio) card.classList.add('uploaded');

      // Create thumbnail from file
      const img = document.createElement('img');
      img.alt = entry.title;
      img.style.background = '#2a2a3a';

      // Load thumbnail — imageFiles now stores File objects directly
      const fname = entry._matchedFile || entry.file;
      const file = imageFiles.get(fname);
      if (file) {
        img.src = URL.createObjectURL(file);
      }

      card.appendChild(img);

      // Title label
      const label = document.createElement('div');
      label.className = 'card-label';
      label.textContent = entry.title;
      card.appendChild(label);

      // Status icon
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

      // Update status
      statusEl.textContent = 'Uploading';
      statusEl.className = 'qi-status uploading';

      try {
        // Read File object into ArrayBuffer
        const fname = entry._matchedFile || entry.file;
        const file = imageFiles.get(fname);
        if (!file) throw new Error('File not found');

        const arrayBuffer = await file.arrayBuffer();

        // Send to content script for upload
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

      // Update progress
      const done = completed + failed;
      progressFill.style.width = `${(done / total) * 100}%`;
      progressText.textContent = `${done} / ${total}${failed > 0 ? ` (${failed} failed)` : ''}`;

      // Brief delay between uploads to avoid overwhelming CaFE
      if (i < uploadQueue.length - 1) {
        await sleep(1500);
      }
    }

    // Done
    isUploading = false;

    if (failed === 0) {
      showToast(`All ${completed} images uploaded successfully!`, 'success');
      uploadAllBtn.textContent = 'All Done';
    } else {
      showToast(`${completed} uploaded, ${failed} failed`, 'warning');
      uploadAllBtn.textContent = `${completed}/${total} Done`;
      retryBtn.style.display = 'block';
    }

    // Update stats
    statExisting.textContent = parseInt(statExisting.textContent) + completed;
    statNew.textContent = Math.max(0, parseInt(statNew.textContent) - completed);
  }

  async function handleRetryFailed() {
    const failedEntries = uploadQueue.filter(e => e._error && !e._uploaded);
    if (failedEntries.length === 0) return;

    // Reset failed entries
    failedEntries.forEach(entry => {
      entry._error = null;
    });

    // Re-render and re-upload
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

    // Auto-dismiss after 5s
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
