import React, { useState, useEffect, useCallback, useRef } from 'react';
import '../styles/Pages.css';
import AutocompleteInput from '../components/AutocompleteInput';
import { COUNTRIES, US_STATES, LOCATIONS } from '../data/locations';

// Thumbnail component that loads via IPC
function PhotoThumb({ filePath, size = 200 }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (filePath && window.electronAPI?.getThumbnail) {
      window.electronAPI.getThumbnail(filePath).then(dataUrl => {
        if (dataUrl) setSrc(dataUrl);
      });
    }
  }, [filePath]);
  return src
    ? <img src={src} alt="" style={{ width: '100%', height: size + 'px', objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />
    : <div style={{ height: size + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', fontSize: '14px' }}>Loading...</div>;
}

function ContentIngest() {
  // ===== MANUAL IMPORT STATE (Select Files / Select Folder path) =====
  const [files, setFiles] = useState([]);
  const [galleryMode, setGalleryMode] = useState('new');
  const [galleryName, setGalleryName] = useState('');
  const [country, setCountry] = useState('');
  const [location, setLocation] = useState('');
  const [existingPortfolios, setExistingPortfolios] = useState([]);
  const [selectedPortfolio, setSelectedPortfolio] = useState('');
  const [processing, setProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState(null);
  const [completionState, setCompletionState] = useState(null);

  // Manual review state
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewData, setReviewData] = useState([]);
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0);

  // ===== SCAN STATE =====
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [scanSelections, setScanSelections] = useState({});

  // ===== BATCH PHASES STATE =====
  // Phase 1: Gallery Configuration
  const [configPhase, setConfigPhase] = useState(false);
  const [configuredGalleries, setConfiguredGalleries] = useState([]);

  // Phase 2: Batch Analysis
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const [batchAnalysisProgress, setBatchAnalysisProgress] = useState(null);

  // Phase 3: Unified Review
  const [unifiedReviewMode, setUnifiedReviewMode] = useState(false);
  const [reviewByGallery, setReviewByGallery] = useState({});

  // Phase 4: Batch Finalize
  const [batchFinalizing, setBatchFinalizing] = useState(false);
  const [batchFinalizeProgress, setBatchFinalizeProgress] = useState(null);

  // Batch completion
  const [batchComplete, setBatchComplete] = useState(null); // { totalPhotos, galleries: [...] }

  // Progress tracking
  const [progress, setProgress] = useState(null);
  const startTimeRef = useRef(null);

  // Load existing portfolios on mount + listen for progress events
  useEffect(() => {
    loadPortfolios();
    if (window.electronAPI?.onIngestProgress) {
      const cleanup = window.electronAPI.onIngestProgress((data) => {
        if (!startTimeRef.current) startTimeRef.current = Date.now();
        setProgress(data);
      });
      return cleanup;
    }
  }, []);

  const loadPortfolios = async () => {
    try {
      if (window.electronAPI) {
        const data = await window.electronAPI.getPortfolios();
        setExistingPortfolios(data || []);
      } else {
        setExistingPortfolios([
          { id: 'grand_teton', name: 'Grand Teton', photoCount: 28, location: 'Wyoming, USA' },
          { id: 'yellowstone', name: 'Yellowstone', photoCount: 0, location: 'Wyoming, USA' },
        ]);
      }
    } catch (err) {
      console.error('Failed to load portfolios:', err);
    }
  };

  // ===================================================================
  // AUTO-SCAN
  // ===================================================================
  const handleScanForNewContent = async () => {
    setScanning(true);
    setScanResults(null);
    setScanSelections({});
    try {
      const result = await window.electronAPI.scanPhotography();
      if (result.success) {
        setScanResults(result);
        const selections = {};
        result.scanResults.forEach(r => {
          if (r.status === 'has-updates' || r.status === 'new-gallery') {
            selections[r.folderName] = {
              selected: true,
              galleryName: r.match ? '' : r.folderName,
              country: '',
              location: ''
            };
          }
        });
        setScanSelections(selections);
      } else {
        setProcessStatus({ step: 0, message: result.error, error: true });
      }
    } catch (err) {
      setProcessStatus({ step: 0, message: err.message, error: true });
    }
    setScanning(false);
  };

  const toggleScanSelection = (folderName) => {
    setScanSelections(prev => ({
      ...prev,
      [folderName]: { ...prev[folderName], selected: !prev[folderName]?.selected }
    }));
  };

  const updateScanGalleryField = (folderName, field, value) => {
    setScanSelections(prev => ({
      ...prev,
      [folderName]: { ...prev[folderName], [field]: value }
    }));
  };

  const closeScan = () => {
    setScanResults(null);
    setScanSelections({});
  };

  // ===================================================================
  // PHASE 1: GALLERY CONFIGURATION
  // ===================================================================
  const handleImportFromScan = () => {
    if (!scanResults) return;
    const selectedFolders = scanResults.scanResults.filter(r =>
      scanSelections[r.folderName]?.selected &&
      (r.counts.new > 0 || r.counts.updated > 0)
    );
    if (selectedFolders.length === 0) return;

    // Build configured galleries from scan selections
    const galleries = selectedFolders.map(folder => {
      const sel = scanSelections[folder.folderName] || {};
      if (folder.match) {
        const pf = folder.match.portfolioFolder;
        const portfolio = existingPortfolios.find(p =>
          p.id === pf || p.name === pf || p.folderName === pf
        );
        return {
          folderName: folder.folderName,
          scanResult: folder,
          config: {
            mode: 'existing',
            portfolioId: portfolio?.id || folder.match.portfolioFolder,
            galleryName: portfolio?.name || folder.match.portfolioFolder,
            country: portfolio?.country || '',
            location: portfolio?.location || ''
          }
        };
      } else {
        return {
          folderName: folder.folderName,
          scanResult: folder,
          config: {
            mode: 'new',
            galleryName: sel.galleryName || folder.folderName,
            country: sel.country || '',
            location: sel.location || ''
          }
        };
      }
    });

    setConfiguredGalleries(galleries);
    setScanResults(null);
    setConfigPhase(true);
  };

  const updateGalleryConfig = (folderName, field, value) => {
    setConfiguredGalleries(prev => prev.map(g =>
      g.folderName === folderName ? { ...g, config: { ...g.config, [field]: value } } : g
    ));
  };

  const allGalleriesConfigured = () => {
    return configuredGalleries.every(g => {
      if (g.config.mode === 'new') return g.config.galleryName?.trim();
      return true; // existing portfolios already have metadata
    });
  };

  // ===================================================================
  // PHASE 2: BATCH ANALYSIS
  // ===================================================================
  const startBatchAnalysis = async () => {
    if (!allGalleriesConfigured()) return;
    setConfigPhase(false);
    setBatchAnalyzing(true);
    setProgress(null);
    startTimeRef.current = Date.now();

    const allResults = {};
    let totalPhotos = 0;
    let analyzedSoFar = 0;
    configuredGalleries.forEach(g => {
      totalPhotos += g.scanResult.counts.new + g.scanResult.counts.updated;
    });

    for (let i = 0; i < configuredGalleries.length; i++) {
      const gallery = configuredGalleries[i];
      const photoCount = gallery.scanResult.counts.new + gallery.scanResult.counts.updated;

      setBatchAnalysisProgress({
        currentIndex: i + 1,
        total: configuredGalleries.length,
        currentName: gallery.config.galleryName || gallery.folderName,
        photosInCurrent: photoCount,
        totalPhotos,
        analyzedSoFar
      });

      try {
        const filePaths = [
          ...gallery.scanResult.newFiles.map(f => f.path),
          ...gallery.scanResult.updatedFiles.map(f => f.path)
        ];

        const galleryContext = {
          name: gallery.config.galleryName,
          country: gallery.config.country,
          location: gallery.config.location
        };

        if (window.electronAPI) {
          const result = await window.electronAPI.analyzePhotos({ files: filePaths, galleryContext });
          allResults[gallery.folderName] = result;
        } else {
          // Demo simulation
          await new Promise(resolve => setTimeout(resolve, 500));
          allResults[gallery.folderName] = {
            success: true,
            photos: filePaths.map((f, idx) => ({
              id: `${gallery.folderName}_${idx}`,
              filename: f.split('/').pop(),
              path: f,
              title: `Photo ${idx + 1}`,
              description: 'Demo AI-generated description.',
              location: gallery.config.location || 'Unknown',
              tags: ['landscape'],
              approved: false
            }))
          };
        }
        analyzedSoFar += photoCount;
      } catch (err) {
        console.error('Analysis failed for', gallery.folderName, err);
        allResults[gallery.folderName] = { success: false, error: err.message };
      }
    }

    // Check for failures
    const failures = Object.entries(allResults).filter(([_, r]) => !r.success);
    if (failures.length > 0) {
      setProcessStatus({
        step: 0,
        message: `Analysis failed for: ${failures.map(([k]) => k).join(', ')}`,
        error: true
      });
      setBatchAnalyzing(false);
      return;
    }

    // Build review-by-gallery structure
    const reviewData = {};
    configuredGalleries.forEach(gallery => {
      const result = allResults[gallery.folderName];
      if (result?.success) {
        reviewData[gallery.folderName] = {
          collapsed: false,
          config: gallery.config,
          scanResult: gallery.scanResult,
          photos: result.photos.map(p => ({ ...p, approved: false }))
        };
      }
    });

    setReviewByGallery(reviewData);
    setBatchAnalyzing(false);
    setUnifiedReviewMode(true);
    setProgress(null);
  };

  // ===================================================================
  // PHASE 3: UNIFIED REVIEW
  // ===================================================================
  const toggleGalleryCollapsed = (folderName) => {
    setReviewByGallery(prev => ({
      ...prev,
      [folderName]: { ...prev[folderName], collapsed: !prev[folderName].collapsed }
    }));
  };

  const updateBatchReviewPhoto = (folderName, photoIndex, field, value) => {
    setReviewByGallery(prev => ({
      ...prev,
      [folderName]: {
        ...prev[folderName],
        photos: prev[folderName].photos.map((p, i) =>
          i === photoIndex ? { ...p, [field]: value } : p
        )
      }
    }));
  };

  const approveAllInGallery = (folderName) => {
    setReviewByGallery(prev => ({
      ...prev,
      [folderName]: {
        ...prev[folderName],
        photos: prev[folderName].photos.map(p => ({ ...p, approved: true }))
      }
    }));
  };

  const getBatchReviewStats = () => {
    let total = 0, approved = 0;
    Object.values(reviewByGallery).forEach(g => {
      g.photos.forEach(p => { total++; if (p.approved) approved++; });
    });
    return { total, approved, pending: total - approved, galleries: Object.keys(reviewByGallery).length };
  };

  const allBatchApproved = () => {
    const stats = getBatchReviewStats();
    return stats.total > 0 && stats.pending === 0;
  };

  // ===================================================================
  // PHASE 4: BATCH FINALIZE
  // ===================================================================
  const startBatchFinalize = async () => {
    if (!allBatchApproved()) return;
    setUnifiedReviewMode(false);
    setBatchFinalizing(true);
    setProgress(null);
    startTimeRef.current = Date.now();

    const galleryEntries = Object.entries(reviewByGallery);
    const results = [];

    for (let i = 0; i < galleryEntries.length; i++) {
      const [folderName, galleryData] = galleryEntries[i];

      setBatchFinalizeProgress({
        currentIndex: i + 1,
        total: galleryEntries.length,
        currentName: galleryData.config.galleryName || folderName,
        photosInCurrent: galleryData.photos.length
      });

      try {
        if (window.electronAPI) {
          const result = await window.electronAPI.finalizeIngest({
            photos: galleryData.photos,
            mode: galleryData.config.mode,
            portfolioId: galleryData.config.mode === 'existing' ? galleryData.config.portfolioId : null,
            newGallery: galleryData.config.mode === 'new' ? {
              name: galleryData.config.galleryName,
              country: galleryData.config.country,
              location: galleryData.config.location
            } : null
          });
          results.push({ folderName, name: galleryData.config.galleryName || folderName, success: result.success, photosImported: galleryData.photos.length, error: result.error });
        } else {
          await new Promise(resolve => setTimeout(resolve, 600));
          results.push({ folderName, name: galleryData.config.galleryName || folderName, success: true, photosImported: galleryData.photos.length });
        }
      } catch (err) {
        results.push({ folderName, name: galleryData.config.galleryName || folderName, success: false, error: err.message, photosImported: 0 });
      }
    }

    const totalImported = results.filter(r => r.success).reduce((sum, r) => sum + r.photosImported, 0);
    const failedCount = results.filter(r => !r.success).length;

    setBatchFinalizing(false);
    setBatchComplete({
      totalPhotos: totalImported,
      totalGalleries: results.length,
      failedGalleries: failedCount,
      galleries: results,
      timestamp: new Date().toLocaleTimeString()
    });

    loadPortfolios();
  };

  // ===================================================================
  // BATCH RESET
  // ===================================================================
  const resetBatch = () => {
    setConfigPhase(false);
    setConfiguredGalleries([]);
    setBatchAnalyzing(false);
    setBatchAnalysisProgress(null);
    setUnifiedReviewMode(false);
    setReviewByGallery({});
    setBatchFinalizing(false);
    setBatchFinalizeProgress(null);
    setBatchComplete(null);
    setProcessStatus(null);
    setProgress(null);
    setScanSelections({});
  };

  // ===================================================================
  // MANUAL IMPORT FUNCTIONS (unchanged)
  // ===================================================================
  const handleSelectFiles = async () => {
    if (window.electronAPI) {
      const selectedFiles = await window.electronAPI.selectFiles();
      setFiles(selectedFiles);
    }
  };

  const handleSelectFolder = async () => {
    if (window.electronAPI) {
      const folder = await window.electronAPI.selectFolder();
      if (folder) console.log('Selected folder:', folder);
    }
  };

  const canProcess = () => {
    if (files.length === 0) return false;
    if (galleryMode === 'new' && !galleryName.trim()) return false;
    if (galleryMode === 'existing' && !selectedPortfolio) return false;
    return true;
  };

  const handleProcess = async () => {
    if (!canProcess()) return;
    setProcessing(true);
    setProgress(null);
    startTimeRef.current = Date.now();
    setProcessStatus({ step: 1, message: 'Extracting EXIF metadata & analyzing with AI...' });

    try {
      if (window.electronAPI) {
        const selectedP = existingPortfolios.find(p => p.id === selectedPortfolio);
        const galleryContext = galleryMode === 'new'
          ? { name: galleryName, country, location }
          : { name: selectedP?.name || '', country: selectedP?.country || '', location: selectedP?.location || '' };
        const result = await window.electronAPI.analyzePhotos({ files, galleryContext });

        if (result.success) {
          setProcessStatus({ step: 2, message: 'AI analysis complete. Please review.' });
          setReviewData(result.photos);
          setCurrentReviewIndex(0);
          setReviewMode(true);
        } else {
          setProcessStatus({ step: 0, message: result.error, error: true });
        }
      } else {
        setProcessStatus({ step: 1, message: 'Extracting EXIF metadata...' });
        await new Promise(resolve => setTimeout(resolve, 600));
        setProcessStatus({ step: 2, message: 'Generating AI descriptions...' });
        await new Promise(resolve => setTimeout(resolve, 800));

        const demoReviewData = files.map((file, i) => ({
          id: `photo_${i}`,
          filename: file.split('/').pop() || `photo_${i}.jpg`,
          path: file,
          title: `Landscape ${i + 1}`,
          description: 'AI-generated description would appear here.',
          location: location || 'Unknown Location',
          tags: ['landscape'],
          approved: false
        }));

        setReviewData(demoReviewData);
        setCurrentReviewIndex(0);
        setReviewMode(true);
        setProcessStatus({ step: 2, message: 'Please review AI-generated metadata below', warning: true });
      }
    } catch (err) {
      console.error('Processing failed:', err);
      setProcessStatus({ step: 0, message: err.message, error: true });
    }
    setProcessing(false);
  };

  const updateReviewItem = (index, field, value) => {
    setReviewData(prev => prev.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const approveAndNext = () => {
    updateReviewItem(currentReviewIndex, 'approved', true);
    if (currentReviewIndex < reviewData.length - 1) {
      setCurrentReviewIndex(prev => prev + 1);
    }
  };

  const allApproved = () => reviewData.length > 0 && reviewData.every(item => item.approved);

  const handleFinalize = async () => {
    if (!allApproved()) { alert('Please approve all photos before finalizing.'); return; }
    setProcessing(true);
    setProgress(null);
    startTimeRef.current = Date.now();
    setProcessStatus({ step: 3, message: 'Resizing for web...' });

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.finalizeIngest({
          photos: reviewData,
          mode: galleryMode,
          portfolioId: galleryMode === 'existing' ? selectedPortfolio : null,
          newGallery: galleryMode === 'new' ? { name: galleryName, country, location } : null
        });
        if (result.success) {
          const gName = galleryMode === 'new' ? galleryName : (existingPortfolios.find(p => p.id === selectedPortfolio)?.name || 'Portfolio');
          setCompletionState({ photosImported: reviewData.length, galleryName: gName, timestamp: new Date().toLocaleTimeString() });
          setProcessStatus({ step: 5, message: 'Import complete!', success: true });
          setProgress({ phase: 'done', current: reviewData.length, total: reviewData.length });
          loadPortfolios();
        } else {
          setProcessStatus({ step: 0, message: result.error, error: true });
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 600));
        setProcessStatus({ step: 4, message: 'Creating gallery files...' });
        await new Promise(resolve => setTimeout(resolve, 600));
        const gName = galleryMode === 'new' ? galleryName : 'Portfolio';
        setCompletionState({ photosImported: reviewData.length, galleryName: gName, timestamp: new Date().toLocaleTimeString() });
        setProcessStatus({ step: 5, message: 'Import complete!', success: true });
        setProgress({ phase: 'done', current: reviewData.length, total: reviewData.length });
      }
    } catch (err) {
      console.error('Finalization failed:', err);
      setProcessStatus({ step: 0, message: err.message, error: true });
    }
    setProcessing(false);
  };

  const resetForm = () => {
    setFiles([]);
    setGalleryName('');
    setCountry('');
    setLocation('');
    setSelectedPortfolio('');
    setReviewMode(false);
    setReviewData([]);
    setCurrentReviewIndex(0);
  };

  const startNewImport = () => {
    resetForm();
    setProcessStatus(null);
    setProgress(null);
    setCompletionState(null);
  };

  const cancelReview = () => {
    if (window.confirm('Cancel import? All AI-generated data will be lost.')) {
      resetForm();
      setProcessStatus(null);
    }
  };

  // Computed values for manual review
  const currentPhoto = reviewData[currentReviewIndex];
  const approvedCount = reviewData.filter(p => p.approved).length;

  // Computed values for batch review
  const batchStats = unifiedReviewMode ? getBatchReviewStats() : null;

  // Determine active phase
  const activeBatchPhase = configPhase ? 'config'
    : batchAnalyzing ? 'analyzing'
    : unifiedReviewMode ? 'review'
    : batchFinalizing ? 'finalizing'
    : batchComplete ? 'complete'
    : null;

  // ===================================================================
  // RENDER
  // ===================================================================
  return (
    <div className="page">
      <header className="page-header">
        <h2>Content Ingestion</h2>
        <p className="page-subtitle">Import and process new photography</p>
      </header>

      {/* ===== SCAN RESULTS VIEW ===== */}
      {scanResults ? (
        <div className="card-grid">
          <div className="glass-card full-width">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Scan Results</h3>
              <button className="btn btn-secondary" onClick={closeScan} style={{ fontSize: '12px', padding: '6px 12px' }}>Close</button>
            </div>
            <div style={{ display: 'flex', gap: '24px', marginTop: '12px', flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center', padding: '12px 16px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--accent)' }}>{scanResults.summary.totalNewPhotos}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>New Photos</div>
              </div>
              <div style={{ textAlign: 'center', padding: '12px 16px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#f59e0b' }}>{scanResults.summary.totalUpdatedPhotos}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Updated</div>
              </div>
              <div style={{ textAlign: 'center', padding: '12px 16px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-muted)' }}>{scanResults.summary.newGalleries}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>New Galleries</div>
              </div>
              <div style={{ textAlign: 'center', padding: '12px 16px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#22c55e' }}>{scanResults.summary.upToDate}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Up to Date</div>
              </div>
            </div>
          </div>

          {scanResults.scanResults.map(folder => {
            const sel = scanSelections[folder.folderName];
            const hasContent = folder.counts.new > 0 || folder.counts.updated > 0;
            const statusColors = {
              'new-gallery': { bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)', label: 'New Gallery', color: '#3b82f6' },
              'has-updates': { bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.3)', label: 'Has Updates', color: '#f59e0b' },
              'up-to-date': { bg: 'rgba(34,197,94,0.05)', border: 'rgba(34,197,94,0.2)', label: 'Up to Date', color: '#22c55e' },
              'empty': { bg: 'var(--bg-tertiary)', border: 'var(--glass-border)', label: 'Empty', color: 'var(--text-muted)' }
            };
            const st = statusColors[folder.status] || statusColors.empty;

            return (
              <div key={folder.folderName} className="glass-card full-width" style={{
                border: `1px solid ${st.border}`, background: st.bg,
                opacity: folder.status === 'empty' ? 0.5 : 1
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {hasContent && (
                    <input type="checkbox" checked={sel?.selected || false}
                      onChange={() => toggleScanSelection(folder.folderName)}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong>{folder.folderName}</strong>
                      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: st.bg, color: st.color, border: `1px solid ${st.border}`, fontWeight: 600 }}>{st.label}</span>
                      {folder.match && (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          {folder.match.method === 'alias' ? '=' : '\u2248'} {folder.match.portfolioFolder}
                          <span style={{ fontSize: '11px', marginLeft: '4px', color: folder.match.confidence >= 90 ? '#22c55e' : '#f59e0b' }}>{folder.match.confidence}%</span>
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {folder.counts.new > 0 && <span style={{ marginRight: '12px' }}>{folder.counts.new} new</span>}
                      {folder.counts.updated > 0 && <span style={{ marginRight: '12px' }}>{folder.counts.updated} updated</span>}
                      {folder.counts.existing > 0 && <span>{folder.counts.existing} existing</span>}
                      {folder.status === 'empty' && <span>No images</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="glass-card full-width">
            <button className="btn btn-primary btn-large" onClick={handleImportFromScan}
              disabled={!Object.values(scanSelections).some(s => s.selected)}
              style={{ width: '100%' }}>
              Import Selected Folders
            </button>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
              Configure all galleries, then batch-analyze and review before finalizing.
            </p>
          </div>
        </div>

      /* ===== PHASE 1: GALLERY CONFIGURATION ===== */
      ) : activeBatchPhase === 'config' ? (
        <div className="card-grid">
          <div className="glass-card full-width">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Configure Galleries</h3>
              <button className="btn btn-secondary" onClick={() => { setConfigPhase(false); setConfiguredGalleries([]); }} style={{ fontSize: '12px', padding: '6px 12px' }}>Cancel</button>
            </div>
            <p style={{ marginTop: '8px', color: 'var(--text-muted)' }}>
              Confirm names and locations for {configuredGalleries.length} galleries before batch analysis.
            </p>
          </div>

          {configuredGalleries.map((gallery, idx) => {
            const photoCount = gallery.scanResult.counts.new + gallery.scanResult.counts.updated;
            const isNew = gallery.config.mode === 'new';

            return (
              <div key={gallery.folderName} className="glass-card full-width" style={{
                border: `1px solid ${isNew ? 'rgba(59,130,246,0.3)' : 'rgba(251,191,36,0.3)'}`,
                background: isNew ? 'rgba(59,130,246,0.05)' : 'rgba(251,191,36,0.05)',
                position: 'relative', zIndex: configuredGalleries.length - idx, overflow: 'visible'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>{idx + 1}.</span>
                    <strong>{gallery.folderName}</strong>
                    <span style={{
                      fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontWeight: 600,
                      background: isNew ? 'rgba(59,130,246,0.1)' : 'rgba(251,191,36,0.1)',
                      color: isNew ? '#3b82f6' : '#f59e0b',
                      border: `1px solid ${isNew ? 'rgba(59,130,246,0.3)' : 'rgba(251,191,36,0.3)'}`
                    }}>{isNew ? 'New Gallery' : 'Update Existing'}</span>
                  </div>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{photoCount} photos</span>
                </div>

                {isNew ? (
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 200px' }}>
                      <AutocompleteInput
                        value={gallery.config.galleryName}
                        onChange={v => updateGalleryConfig(gallery.folderName, 'galleryName', v)}
                        label="Gallery Name *"
                        placeholder={gallery.folderName}
                        suggestions={existingPortfolios.map(p => ({ name: p.name, aliases: [] }))}
                        helpText=""
                        maxSuggestions={4}
                        fuzzyThreshold={4}
                      />
                    </div>
                    <div style={{ flex: '1 1 150px' }}>
                      <AutocompleteInput
                        value={gallery.config.country}
                        onChange={v => updateGalleryConfig(gallery.folderName, 'country', v)}
                        label="Country"
                        placeholder="e.g., USA"
                        suggestions={COUNTRIES}
                        helpText=""
                        maxSuggestions={6}
                        fuzzyThreshold={3}
                      />
                    </div>
                    <div style={{ flex: '1 1 150px' }}>
                      <AutocompleteInput
                        value={gallery.config.location}
                        onChange={v => updateGalleryConfig(gallery.folderName, 'location', v)}
                        label="Location"
                        placeholder="e.g., Death Valley"
                        suggestions={LOCATIONS}
                        helpText=""
                        maxSuggestions={6}
                        fuzzyThreshold={3}
                      />
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Adding to: <strong>{gallery.config.galleryName}</strong>
                    {gallery.scanResult.match && (
                      <span style={{ marginLeft: '8px', fontSize: '11px', color: gallery.scanResult.match.confidence >= 90 ? '#22c55e' : '#f59e0b' }}>
                        ({gallery.scanResult.match.confidence}% match via {gallery.scanResult.match.method})
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="glass-card full-width">
            <button className="btn btn-primary btn-large" onClick={startBatchAnalysis}
              disabled={!allGalleriesConfigured()} style={{ width: '100%' }}>
              Confirm & Analyze All ({configuredGalleries.reduce((s, g) => s + g.scanResult.counts.new + g.scanResult.counts.updated, 0)} photos across {configuredGalleries.length} galleries)
            </button>
            {!allGalleriesConfigured() && (
              <p style={{ fontSize: '12px', color: '#f59e0b', marginTop: '8px' }}>
                Fill in Gallery Name for all new galleries.
              </p>
            )}
          </div>
        </div>

      /* ===== PHASE 2: BATCH ANALYSIS PROGRESS ===== */
      ) : activeBatchPhase === 'analyzing' ? (
        <div className="card-grid">
          <div className="glass-card full-width" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <h3>Batch Analyzing Photos</h3>
            {batchAnalysisProgress && (
              <>
                <p style={{ fontSize: '18px', color: 'var(--accent)', marginTop: '16px' }}>
                  Gallery {batchAnalysisProgress.currentIndex} of {batchAnalysisProgress.total}
                </p>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                  <strong>{batchAnalysisProgress.currentName}</strong> — {batchAnalysisProgress.photosInCurrent} photos
                </p>
                <div style={{ margin: '24px auto', maxWidth: '500px' }}>
                  <div style={{ width: '100%', height: '8px', background: 'var(--bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${(batchAnalysisProgress.currentIndex / batchAnalysisProgress.total) * 100}%`,
                      height: '100%', background: 'linear-gradient(90deg, var(--accent), var(--warning))',
                      borderRadius: '4px', transition: 'width 0.5s ease'
                    }} />
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
                    {batchAnalysisProgress.analyzedSoFar} of {batchAnalysisProgress.totalPhotos} total photos analyzed
                  </p>
                </div>
                {progress && progress.filename && (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{progress.filename}</p>
                )}
              </>
            )}
          </div>
        </div>

      /* ===== PHASE 3: UNIFIED REVIEW ===== */
      ) : activeBatchPhase === 'review' ? (
        <div className="card-grid">
          {/* Stats header */}
          <div className="glass-card full-width">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Review All Photos</h3>
              <span className="status-badge pending">
                {batchStats.approved}/{batchStats.total} Approved
              </span>
            </div>
            <p style={{ marginTop: '8px', color: 'var(--text-muted)' }}>
              {batchStats.galleries} galleries — review and approve metadata from AI analysis.
            </p>
          </div>

          {/* Gallery groups */}
          {Object.entries(reviewByGallery).map(([folderName, galleryData]) => {
            const galleryApproved = galleryData.photos.filter(p => p.approved).length;
            const galleryTotal = galleryData.photos.length;
            const allDone = galleryApproved === galleryTotal;
            const isNew = galleryData.config.mode === 'new';

            return (
              <div key={folderName} className="glass-card full-width" style={{
                border: `1px solid ${allDone ? 'rgba(34,197,94,0.3)' : 'var(--glass-border)'}`,
                background: allDone ? 'rgba(34,197,94,0.03)' : 'var(--bg-secondary)'
              }}>
                {/* Gallery header — click to toggle */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => toggleGalleryCollapsed(folderName)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>{galleryData.collapsed ? '\u25B6' : '\u25BC'}</span>
                    <strong>{galleryData.config.galleryName || folderName}</strong>
                    <span style={{
                      fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontWeight: 600,
                      background: isNew ? 'rgba(59,130,246,0.1)' : 'rgba(251,191,36,0.1)',
                      color: isNew ? '#3b82f6' : '#f59e0b',
                      border: `1px solid ${isNew ? 'rgba(59,130,246,0.3)' : 'rgba(251,191,36,0.3)'}`
                    }}>{isNew ? 'New' : 'Update'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '13px', color: allDone ? '#22c55e' : 'var(--text-muted)' }}>
                      {galleryApproved}/{galleryTotal} {allDone ? '\u2713' : ''}
                    </span>
                    {!allDone && !galleryData.collapsed && (
                      <button className="btn btn-secondary" onClick={e => { e.stopPropagation(); approveAllInGallery(folderName); }}
                        style={{ fontSize: '11px', padding: '4px 10px' }}>
                        Approve All
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded: show photos */}
                {!galleryData.collapsed && (
                  <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {galleryData.photos.map((photo, photoIdx) => (
                      <div key={photo.id || photoIdx} style={{
                        display: 'flex', gap: '16px', padding: '12px',
                        background: photo.approved ? 'rgba(34,197,94,0.05)' : 'var(--bg-tertiary)',
                        borderRadius: 'var(--radius-sm)',
                        border: `1px solid ${photo.approved ? 'rgba(34,197,94,0.2)' : 'var(--glass-border)'}`
                      }}>
                        <div style={{ flex: '0 0 120px' }}>
                          <PhotoThumb filePath={photo.path} size={120} />
                          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', wordBreak: 'break-all' }}>
                            {photo.filename}
                          </p>
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Title</label>
                              <input type="text" value={photo.title || ''} style={{ width: '100%', fontSize: '13px' }}
                                onChange={e => updateBatchReviewPhoto(folderName, photoIdx, 'title', e.target.value)} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Location</label>
                              <input type="text" value={photo.location || ''} style={{ width: '100%', fontSize: '13px' }}
                                onChange={e => updateBatchReviewPhoto(folderName, photoIdx, 'location', e.target.value)} />
                            </div>
                          </div>
                          <div>
                            <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Description</label>
                            <input type="text" value={photo.description || ''} style={{ width: '100%', fontSize: '13px' }}
                              onChange={e => updateBatchReviewPhoto(folderName, photoIdx, 'description', e.target.value)} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Tags</label>
                              <input type="text" value={photo.tags?.join(', ') || ''} style={{ width: '100%', fontSize: '13px' }}
                                onChange={e => updateBatchReviewPhoto(folderName, photoIdx, 'tags', e.target.value.split(',').map(t => t.trim()))} />
                            </div>
                            <div style={{ marginLeft: '12px', flexShrink: 0 }}>
                              {photo.approved ? (
                                <span style={{ color: '#22c55e', fontSize: '13px', fontWeight: 600 }}>{'\u2713'} Approved</span>
                              ) : (
                                <button className="btn btn-primary" onClick={() => updateBatchReviewPhoto(folderName, photoIdx, 'approved', true)}
                                  style={{ fontSize: '12px', padding: '6px 14px' }}>
                                  Approve
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Action bar */}
          <div className="glass-card full-width">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button className="btn btn-secondary" onClick={() => {
                if (window.confirm('Cancel batch import? All AI-generated data will be lost.')) resetBatch();
              }}>Cancel Import</button>
              <button className="btn btn-primary" onClick={startBatchFinalize}
                disabled={!allBatchApproved()}>
                {allBatchApproved()
                  ? `Finalize All (${batchStats.total} photos, ${batchStats.galleries} galleries)`
                  : `${batchStats.pending} photos still need approval`
                }
              </button>
            </div>
          </div>
        </div>

      /* ===== PHASE 4: BATCH FINALIZE PROGRESS ===== */
      ) : activeBatchPhase === 'finalizing' ? (
        <div className="card-grid">
          <div className="glass-card full-width" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <h3>Finalizing Galleries</h3>
            {batchFinalizeProgress && (
              <>
                <p style={{ fontSize: '18px', color: 'var(--accent)', marginTop: '16px' }}>
                  Gallery {batchFinalizeProgress.currentIndex} of {batchFinalizeProgress.total}
                </p>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                  <strong>{batchFinalizeProgress.currentName}</strong> — {batchFinalizeProgress.photosInCurrent} photos
                </p>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Resizing, C2PA signing, R2 upload...
                </p>
                <div style={{ margin: '24px auto', maxWidth: '500px' }}>
                  <div style={{ width: '100%', height: '8px', background: 'var(--bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${(batchFinalizeProgress.currentIndex / batchFinalizeProgress.total) * 100}%`,
                      height: '100%', background: 'linear-gradient(90deg, #22c55e, #16a34a)',
                      borderRadius: '4px', transition: 'width 0.5s ease'
                    }} />
                  </div>
                </div>
                {progress && progress.filename && (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{progress.filename}</p>
                )}
              </>
            )}
          </div>
        </div>

      /* ===== BATCH COMPLETE ===== */
      ) : activeBatchPhase === 'complete' ? (
        <div className="card-grid">
          <div className="glass-card full-width" style={{ textAlign: 'center', padding: '30px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>{'\u2705'}</div>
            <h3 style={{ color: '#22c55e', margin: '0 0 8px' }}>Batch Import Complete</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '16px' }}>
              <strong>{batchComplete.totalPhotos}</strong> photos across <strong>{batchComplete.totalGalleries}</strong> galleries
            </p>
            {batchComplete.failedGalleries > 0 && (
              <p style={{ color: '#ef4444', fontSize: '13px', marginTop: '4px' }}>
                {batchComplete.failedGalleries} gallery(ies) failed
              </p>
            )}
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Completed at {batchComplete.timestamp}
            </p>
          </div>

          {/* Per-gallery results */}
          {batchComplete.galleries.map(g => (
            <div key={g.folderName} className="glass-card full-width" style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px',
              border: `1px solid ${g.success ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.3)'}`,
              background: g.success ? 'rgba(34,197,94,0.03)' : 'rgba(239,68,68,0.05)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: g.success ? '#22c55e' : '#ef4444' }}>{g.success ? '\u2713' : '\u2717'}</span>
                <strong>{g.name}</strong>
              </div>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                {g.success ? `${g.photosImported} photos` : g.error}
              </span>
            </div>
          ))}

          <div className="glass-card full-width" style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Ready to deploy to website
            </p>
            <button className="btn btn-primary" onClick={resetBatch}>Start New Import</button>
          </div>
        </div>

      /* ===== MANUAL SINGLE-PHOTO REVIEW ===== */
      ) : reviewMode ? (
        <div className="card-grid">
          <div className="glass-card full-width">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Review AI-Generated Metadata</h3>
              <span className="status-badge pending">{approvedCount}/{reviewData.length} Approved</span>
            </div>
            <p style={{ marginTop: '8px', color: 'var(--text-muted)' }}>
              Review and edit the AI-generated titles, descriptions, and tags below.
            </p>
          </div>

          {currentPhoto && (
            <div className="glass-card full-width">
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 200px' }}>
                  <PhotoThumb filePath={currentPhoto.path} size={200} />
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px', wordBreak: 'break-all' }}>{currentPhoto.filename}</p>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Photo {currentReviewIndex + 1} of {reviewData.length}</p>
                </div>
                <div style={{ flex: 1, minWidth: '280px' }}>
                  <div className="form-group">
                    <label>Title</label>
                    <input type="text" value={currentPhoto.title} onChange={e => updateReviewItem(currentReviewIndex, 'title', e.target.value)} placeholder="Photo title" />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea value={currentPhoto.description} onChange={e => updateReviewItem(currentReviewIndex, 'description', e.target.value)} placeholder="Photo description" rows={2}
                      style={{ width: '100%', padding: '10px', background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', resize: 'vertical' }} />
                  </div>
                  <div className="form-group">
                    <label>Location</label>
                    <input type="text" value={currentPhoto.location} onChange={e => updateReviewItem(currentReviewIndex, 'location', e.target.value)} placeholder="Photo location" />
                  </div>
                  <div className="form-group">
                    <label>Tags (comma-separated)</label>
                    <input type="text" value={currentPhoto.tags?.join(', ') || ''} onChange={e => updateReviewItem(currentReviewIndex, 'tags', e.target.value.split(',').map(t => t.trim()))} placeholder="landscape, mountains, sunrise" />
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--glass-border)' }}>
                <button className="btn btn-secondary" onClick={() => setCurrentReviewIndex(prev => Math.max(0, prev - 1))} disabled={currentReviewIndex === 0}>← Previous</button>
                <div style={{ display: 'flex', gap: '12px' }}>
                  {currentPhoto.approved ? (
                    <span className="status-badge online">{'\u2713'} Approved</span>
                  ) : (
                    <button className="btn btn-primary" onClick={approveAndNext}>
                      {'\u2713'} Approve {currentReviewIndex < reviewData.length - 1 ? '& Next' : ''}
                    </button>
                  )}
                  {currentReviewIndex < reviewData.length - 1 && (
                    <button className="btn btn-secondary" onClick={() => setCurrentReviewIndex(prev => prev + 1)}>Skip →</button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="glass-card full-width">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button className="btn btn-secondary" onClick={cancelReview}>Cancel Import</button>
              <button className="btn btn-primary" onClick={handleFinalize} disabled={!allApproved() || processing}>
                {processing ? 'Processing...' : `Finalize Import (${approvedCount}/${reviewData.length})`}
              </button>
            </div>
            {!allApproved() && (
              <p style={{ marginTop: '12px', fontSize: '13px', color: 'var(--text-muted)' }}>
                Please approve all {reviewData.length} photos before finalizing.
              </p>
            )}
          </div>
        </div>
      ) : (
        /* ===== NORMAL MODE ===== */
        <div className="card-grid">
          <div className="glass-card">
            <h3>Import Photos</h3>
            <p>Select photos or a folder to import into Archive-35.</p>
            <div className="button-group">
              <button className="btn btn-primary" onClick={handleSelectFiles}>Select Files</button>
              <button className="btn btn-secondary" onClick={handleSelectFolder}>Select Folder</button>
            </div>
            <div style={{ borderTop: '1px solid var(--glass-border)', marginTop: '16px', paddingTop: '16px' }}>
              <button className="btn btn-secondary" onClick={handleScanForNewContent} disabled={scanning} style={{ width: '100%' }}>
                {scanning ? 'Scanning...' : 'Scan for New Content'}
              </button>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>Auto-detect new photos from your Photography folder</p>
            </div>
            {files.length > 0 && (
              <div className="file-list">
                <p>{files.length} files selected</p>
                <ul>
                  {files.slice(0, 5).map((file, i) => (<li key={i}>{file.split('/').pop()}</li>))}
                  {files.length > 5 && <li>...and {files.length - 5} more</li>}
                </ul>
              </div>
            )}
          </div>

          <div className="glass-card">
            <h3>Destination</h3>
            <p>Add to existing portfolio or create new.</p>
            <div className="toggle-group">
              <button className={`toggle-btn ${galleryMode === 'new' ? 'active' : ''}`} onClick={() => setGalleryMode('new')}>New Portfolio</button>
              <button className={`toggle-btn ${galleryMode === 'existing' ? 'active' : ''}`} onClick={() => setGalleryMode('existing')}>Existing Portfolio</button>
            </div>
            {galleryMode === 'new' && (
              <>
                <AutocompleteInput value={galleryName} onChange={setGalleryName} label="Gallery Name *" placeholder="e.g., Grand Teton January 2026"
                  suggestions={existingPortfolios.map(p => ({ name: p.name, aliases: [] }))} helpText="Warns if you're close to an existing portfolio name" maxSuggestions={6} fuzzyThreshold={4} />
                <AutocompleteInput value={country} onChange={setCountry} label="Country *" placeholder="e.g., New Zealand, USA"
                  suggestions={COUNTRIES} helpText="Helps the AI correctly identify locations" maxSuggestions={8} fuzzyThreshold={3} />
                <AutocompleteInput value={location} onChange={setLocation} label="Location (optional)" placeholder="e.g., Rotorua, North Island"
                  suggestions={LOCATIONS} helpText="Search national parks, cities, landmarks" maxSuggestions={8} fuzzyThreshold={3} />
              </>
            )}
            {galleryMode === 'existing' && (
              <div className="form-group">
                <label>Select Portfolio *</label>
                <select value={selectedPortfolio} onChange={e => setSelectedPortfolio(e.target.value)} className="portfolio-select">
                  <option value="">-- Choose a portfolio --</option>
                  {existingPortfolios.map(p => (<option key={p.id} value={p.id}>{p.name} ({p.photoCount} photos)</option>))}
                </select>
                {selectedPortfolio && (
                  <div className="info-box">Adding to: <strong>{existingPortfolios.find(p => p.id === selectedPortfolio)?.name}</strong></div>
                )}
              </div>
            )}
          </div>

          <div className="glass-card full-width">
            <h3>Processing</h3>
            <p>Import process with metadata review step.</p>
            <div className="processing-steps">
              {['Extract EXIF metadata', 'Generate AI descriptions', 'Review & approve metadata', 'Resize for web', 'Create gallery files'].map((label, i) => (
                <div key={i} className={`step ${processStatus?.step > i + 1 ? 'complete' : ''} ${processStatus?.step === i + 1 ? 'active' : ''}`}>
                  <span className="step-number">{i + 1}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            {processStatus?.message && (
              <div className={`status-message ${processStatus.error ? 'error' : ''} ${processStatus.success ? 'success' : ''} ${processStatus.warning ? 'warning' : ''}`}>
                {processStatus.message}
              </div>
            )}
            {progress && (processing || completionState) && (
              <div style={{ margin: '16px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  <span>{completionState ? `Done: ${progress.total} photos processed` : `${progress.phase === 'ai' ? 'AI Analysis' : 'Processing'}: ${progress.current} / ${progress.total}`}</span>
                  <span>{completionState ? `Completed at ${completionState.timestamp}` : (() => {
                    if (!startTimeRef.current || progress.current < 2) return 'Estimating...';
                    const elapsed = (Date.now() - startTimeRef.current) / 1000;
                    const perItem = elapsed / progress.current;
                    const remaining = Math.ceil(perItem * (progress.total - progress.current));
                    return remaining < 60 ? `~${remaining}s remaining` : `~${Math.ceil(remaining / 60)}m remaining`;
                  })()}</span>
                </div>
                <div style={{ width: '100%', height: '8px', background: 'var(--bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${(progress.current / progress.total) * 100}%`, height: '100%',
                    background: completionState ? 'linear-gradient(90deg, #22c55e, #16a34a)' : 'linear-gradient(90deg, var(--accent), var(--warning))',
                    borderRadius: '4px', transition: 'width 0.3s ease'
                  }} />
                </div>
                {!completionState && progress.filename && (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{progress.filename}</p>
                )}
              </div>
            )}
            {completionState && (
              <div style={{ margin: '16px 0', padding: '20px', background: 'linear-gradient(135deg, rgba(34,197,94,0.1), rgba(22,163,106,0.05))', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                <div style={{ fontSize: '36px', marginBottom: '8px' }}>{'\u2705'}</div>
                <h3 style={{ margin: '0 0 8px', color: '#22c55e' }}>Import Complete</h3>
                <p style={{ margin: '0 0 4px', color: 'var(--text-secondary)' }}>
                  <strong>{completionState.photosImported}</strong> photos imported to <strong>{completionState.galleryName}</strong>
                </p>
                <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--text-muted)' }}>Ready to deploy to website</p>
                <button className="btn btn-primary" onClick={startNewImport}>Start New Import</button>
              </div>
            )}
            {!completionState && (
              <>
                <button className="btn btn-primary btn-large" onClick={handleProcess} disabled={!canProcess() || processing}>
                  {processing ? 'Processing...' : `Analyze ${files.length} Photo${files.length !== 1 ? 's' : ''}`}
                </button>
                <p className="card-note" style={{ marginTop: '12px' }}>After AI analysis, you'll review and approve metadata before finalizing.</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ContentIngest;
