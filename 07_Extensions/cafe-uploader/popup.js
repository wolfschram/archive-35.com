/**
 * CaFE Uploader — Popup Script
 *
 * Orchestrates the 3-step flow:
 * 1. Folder selection (File System Access API)
 * 2. Review (metadata parsing + portfolio sync)
 * 3. Upload (relay images to content script)
 */

(() => {
  'use strict';

  // ── State ──────────────────────────────────────────────────

  let folderHandle = null;       // FileSystemDirectoryHandle
  let imageFiles = new Map();    // filename → FileSystemFileHandle
  let metadataEntries = [];      // Parsed metadata array
  let portfolioImages = [];      // Already in CaFE portfolio
  let uploadQueue = [];          // Items to upload
  let isUploading = false;

  // ── DOM Elements ───────────────────────────────────────────

  const $ = (id) => document.getElementById(id);
  const statusBadge = $('statusBadge');
  const toastArea = $('toastArea');
  const selectFolderBtn = $('selectFolderBtn');
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
    selectFolderBtn.addEventListener('click', handleSelectFolder);
    uploadAllBtn.addEventListener('click', handleUploadAll);
    retryBtn.addEventListener('click', handleRetryFailed);

    // Fallback: manual metadata file picker
    const selectMetaBtn = $('selectMetaBtn');
    const metaFileInput = $('metaFileInput');
    if (selectMetaBtn && metaFileInput) {
      selectMetaBtn.addEventListener('click', () => metaFileInput.click());
      metaFileInput.addEventListener('change', handleManualMetaFile);
    }

    // Check CaFE connection
    await checkCafeConnection();
  }

  /**
   * Fallback handler: user manually picks the CSV/JSON metadata file
   * when showDirectoryPicker() didn't return it.
   */
  async function handleManualMetaFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const metaText = await file.text();
      const metaFilename = file.name;

      console.log('[CaFE Uploader] Manual metadata file:', metaFilename, `(${metaText.length} chars)`);

      // Update UI
      metadataFile.textContent = metaFilename;
      $('metaFallback').style.display = 'none';

      // Parse metadata
      metadataEntries = MetadataParser.parse(metaText, metaFilename);
      metadataEntries.forEach(e => MetadataParser.validate(e));

      // Match metadata to actual image files
      metadataEntries = metadataEntries.filter(entry => {
        if (imageFiles.has(entry.file)) return true;
        for (const [fname] of imageFiles) {
          if (fname.includes(entry.file) || entry.file.includes(fname)) {
            entry._matchedFile = fname;
            return true;
          }
        }
        entry._errors.push('Image file not found in folder');
        entry._valid = false;
        return true;
      });

      showToast(`Found ${metadataEntries.length} images with metadata`, 'success');

      // Move to Step 2
      await showReview();

    } catch (err) {
      showToast(`Error reading metadata: ${err.message}`, 'error');
    }
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

  async function handleSelectFolder() {
    try {
      // File System Access API — opens OS folder picker
      folderHandle = await window.showDirectoryPicker({
        mode: 'read',
      });

      // Scan for JPEGs and metadata files
      imageFiles.clear();
      let metaText = null;
      let metaFilename = null;
      const allFiles = [];       // Debug: track all files found
      const csvFiles = [];       // All CSV files found
      const jsonFiles = [];      // All JSON files found

      for await (const [name, handle] of folderHandle.entries()) {
        if (handle.kind !== 'file') continue;
        const lower = name.toLowerCase().trim();
        allFiles.push(name);

        if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
          imageFiles.set(name, handle);
        }

        // Collect all CSV and JSON files for flexible matching
        if (lower.endsWith('.csv')) {
          csvFiles.push({ name, handle });
        }
        if (lower.endsWith('.json')) {
          jsonFiles.push({ name, handle });
        }
      }

      // Find metadata file — prioritize exact names, then fall back to any CSV/JSON
      const metaCandidates = [
        // Priority 1: exact matches
        ...csvFiles.filter(f => f.name.toLowerCase().trim() === 'cafe_metadata.csv'),
        ...jsonFiles.filter(f => f.name.toLowerCase().trim() === 'submission.json'),
        // Priority 2: any file with "metadata" or "cafe" in name
        ...csvFiles.filter(f => {
          const n = f.name.toLowerCase();
          return n.includes('metadata') || n.includes('cafe');
        }),
        ...jsonFiles.filter(f => {
          const n = f.name.toLowerCase();
          return n.includes('submission') || n.includes('cafe');
        }),
        // Priority 3: any CSV file at all (likely the metadata)
        ...csvFiles,
      ];

      if (metaCandidates.length > 0) {
        const best = metaCandidates[0];
        const file = await best.handle.getFile();
        metaText = await file.text();
        metaFilename = best.name;
      }

      console.log('[CaFE Uploader] Folder scan:', {
        totalFiles: allFiles.length,
        images: imageFiles.size,
        csvFiles: csvFiles.map(f => f.name),
        jsonFiles: jsonFiles.map(f => f.name),
        metadataFile: metaFilename,
        allFiles,
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
        // Show fallback button to manually pick the CSV file
        const metaFallback = $('metaFallback');
        if (metaFallback) metaFallback.style.display = 'block';
        showToast('Metadata file not auto-detected. Click below to select it manually.', 'warning');
        return;
      }

      // Parse metadata
      metadataEntries = MetadataParser.parse(metaText, metaFilename);
      metadataEntries.forEach(e => MetadataParser.validate(e));

      // Match metadata to actual files
      metadataEntries = metadataEntries.filter(entry => {
        // Check if file exists (exact match or fuzzy)
        if (imageFiles.has(entry.file)) return true;
        // Try without path prefix (e.g., "001_Wolf 183.jpg" → "Wolf 183.jpg")
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
      if (err.name === 'AbortError') return; // User cancelled picker
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

      // Load thumbnail async
      const fname = entry._matchedFile || entry.file;
      const fh = imageFiles.get(fname);
      if (fh) {
        fh.getFile().then(file => {
          img.src = URL.createObjectURL(file);
        });
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
        // Read file into ArrayBuffer
        const fname = entry._matchedFile || entry.file;
        const fileHandle = imageFiles.get(fname);
        if (!fileHandle) throw new Error('File not found');

        const file = await fileHandle.getFile();
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
