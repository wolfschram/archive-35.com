import React, { useState, useEffect, useCallback, useRef } from 'react';
import '../styles/Pages.css';

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
  const [files, setFiles] = useState([]);
  const [galleryMode, setGalleryMode] = useState('new'); // 'new' or 'existing'
  const [galleryName, setGalleryName] = useState('');
  const [country, setCountry] = useState('');
  const [location, setLocation] = useState('');
  const [existingPortfolios, setExistingPortfolios] = useState([]);
  const [selectedPortfolio, setSelectedPortfolio] = useState('');
  const [processing, setProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState(null);
  const [completionState, setCompletionState] = useState(null); // { photosImported, galleryName, timestamp }

  // Review step state
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewData, setReviewData] = useState([]);
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0);

  // Progress tracking
  const [progress, setProgress] = useState(null); // { phase, current, total, filename, message }
  const startTimeRef = useRef(null);

  // Load existing portfolios on mount + listen for progress events
  useEffect(() => {
    loadPortfolios();
    if (window.electronAPI?.onIngestProgress) {
      const cleanup = window.electronAPI.onIngestProgress((data) => {
        if (!startTimeRef.current) startTimeRef.current = Date.now();
        setProgress(data);
        setProcessStatus({ step: data.phase === 'ai' ? 1 : 3, message: data.message });
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
        // Demo data for development
        setExistingPortfolios([
          { id: 'grand_teton', name: 'Grand Teton', photoCount: 28, location: 'Wyoming, USA' },
          { id: 'yellowstone', name: 'Yellowstone', photoCount: 0, location: 'Wyoming, USA' },
        ]);
      }
    } catch (err) {
      console.error('Failed to load portfolios:', err);
    }
  };

  const handleSelectFiles = async () => {
    if (window.electronAPI) {
      const selectedFiles = await window.electronAPI.selectFiles();
      setFiles(selectedFiles);
    }
  };

  const handleSelectFolder = async () => {
    if (window.electronAPI) {
      const folder = await window.electronAPI.selectFolder();
      if (folder) {
        console.log('Selected folder:', folder);
      }
    }
  };

  const canProcess = () => {
    if (files.length === 0) return false;
    if (galleryMode === 'new' && !galleryName.trim()) return false;
    if (galleryMode === 'existing' && !selectedPortfolio) return false;
    return true;
  };

  // Step 1: Initial processing (EXIF + AI generation)
  const handleProcess = async () => {
    if (!canProcess()) return;

    setProcessing(true);
    setProgress(null);
    startTimeRef.current = Date.now();
    setProcessStatus({ step: 1, message: 'Extracting EXIF metadata & analyzing with AI...' });

    try {
      if (window.electronAPI) {
        // Call API to extract EXIF and generate AI descriptions
        const galleryContext = galleryMode === 'new'
          ? { name: galleryName, country: country, location: location }
          : { name: existingPortfolios.find(p => p.id === selectedPortfolio)?.name || '', country: '', location: '' };
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
        // Demo: simulate processing and show review
        setProcessStatus({ step: 1, message: 'Extracting EXIF metadata...' });
        await new Promise(resolve => setTimeout(resolve, 600));

        setProcessStatus({ step: 2, message: 'Generating AI descriptions...' });
        await new Promise(resolve => setTimeout(resolve, 800));

        // Demo review data
        const demoReviewData = files.map((file, i) => ({
          id: `photo_${i}`,
          filename: file.split('/').pop() || `photo_${i}.jpg`,
          path: file,
          // AI-generated (simulated)
          title: `Landscape ${i + 1}`,
          description: 'AI-generated description would appear here.',
          location: location || 'Unknown Location',
          tags: ['landscape'],
          approved: false
        }));

        setReviewData(demoReviewData);
        setCurrentReviewIndex(0);
        setReviewMode(true);
        setProcessStatus({ step: 2, message: '⚠️ Please review AI-generated metadata below', warning: true });
      }
    } catch (err) {
      console.error('Processing failed:', err);
      setProcessStatus({ step: 0, message: err.message, error: true });
    }

    setProcessing(false);
  };

  // Update review data for a specific photo
  const updateReviewItem = (index, field, value) => {
    setReviewData(prev => prev.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    ));
  };

  // Mark current photo as approved and move to next
  const approveAndNext = () => {
    updateReviewItem(currentReviewIndex, 'approved', true);
    if (currentReviewIndex < reviewData.length - 1) {
      setCurrentReviewIndex(prev => prev + 1);
    }
  };

  // Check if all photos have been reviewed
  const allApproved = () => {
    return reviewData.length > 0 && reviewData.every(item => item.approved);
  };

  // Step 2: Finalize after review
  const handleFinalize = async () => {
    if (!allApproved()) {
      alert('Please approve all photos before finalizing.');
      return;
    }

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
          newGallery: galleryMode === 'new' ? {
            name: galleryName,
            country: country,
            location: location
          } : null
        });

        if (result.success) {
          const gName = galleryMode === 'new' ? galleryName : (existingPortfolios.find(p => p.id === selectedPortfolio)?.name || 'Portfolio');
          setCompletionState({
            photosImported: reviewData.length,
            galleryName: gName,
            timestamp: new Date().toLocaleTimeString()
          });
          setProcessStatus({ step: 5, message: '✅ Import complete!', success: true });
          setProgress({ phase: 'done', current: reviewData.length, total: reviewData.length });
          loadPortfolios();
        } else {
          setProcessStatus({ step: 0, message: result.error, error: true });
        }
      } else {
        // Demo finalization
        await new Promise(resolve => setTimeout(resolve, 600));
        setProcessStatus({ step: 4, message: 'Creating gallery files...' });
        await new Promise(resolve => setTimeout(resolve, 600));
        const gName = galleryMode === 'new' ? galleryName : 'Portfolio';
        setCompletionState({
          photosImported: reviewData.length,
          galleryName: gName,
          timestamp: new Date().toLocaleTimeString()
        });
        setProcessStatus({ step: 5, message: '✅ Import complete!', success: true });
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

  const currentPhoto = reviewData[currentReviewIndex];
  const approvedCount = reviewData.filter(p => p.approved).length;

  return (
    <div className="page">
      <header className="page-header">
        <h2>Content Ingestion</h2>
        <p className="page-subtitle">Import and process new photography</p>
      </header>

      {/* ===== REVIEW MODE ===== */}
      {reviewMode ? (
        <div className="card-grid">
          {/* Progress indicator */}
          <div className="glass-card full-width">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Review AI-Generated Metadata</h3>
              <span className="status-badge pending">
                {approvedCount}/{reviewData.length} Approved
              </span>
            </div>
            <p style={{ marginTop: '8px', color: 'var(--text-muted)' }}>
              Review and edit the AI-generated titles, descriptions, and tags below.
            </p>
          </div>

          {/* Photo Review Card */}
          {currentPhoto && (
            <div className="glass-card full-width">
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                {/* Photo preview */}
                <div style={{ flex: '0 0 200px' }}>
                  <PhotoThumb filePath={currentPhoto.path} size={200} />
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px', wordBreak: 'break-all' }}>
                    {currentPhoto.filename}
                  </p>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Photo {currentReviewIndex + 1} of {reviewData.length}
                  </p>
                </div>

                {/* Editable fields */}
                <div style={{ flex: 1, minWidth: '280px' }}>
                  <div className="form-group">
                    <label>Title</label>
                    <input
                      type="text"
                      value={currentPhoto.title}
                      onChange={e => updateReviewItem(currentReviewIndex, 'title', e.target.value)}
                      placeholder="Photo title"
                    />
                  </div>

                  <div className="form-group">
                    <label>Description</label>
                    <textarea
                      value={currentPhoto.description}
                      onChange={e => updateReviewItem(currentReviewIndex, 'description', e.target.value)}
                      placeholder="Photo description"
                      rows={2}
                      style={{ width: '100%', padding: '10px', background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', resize: 'vertical' }}
                    />
                  </div>

                  <div className="form-group">
                    <label>Location</label>
                    <input
                      type="text"
                      value={currentPhoto.location}
                      onChange={e => updateReviewItem(currentReviewIndex, 'location', e.target.value)}
                      placeholder="Photo location"
                    />
                  </div>

                  <div className="form-group">
                    <label>Tags (comma-separated)</label>
                    <input
                      type="text"
                      value={currentPhoto.tags?.join(', ') || ''}
                      onChange={e => updateReviewItem(currentReviewIndex, 'tags', e.target.value.split(',').map(t => t.trim()))}
                      placeholder="landscape, mountains, sunrise"
                    />
                  </div>
                </div>
              </div>

              {/* Navigation buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--glass-border)' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setCurrentReviewIndex(prev => Math.max(0, prev - 1))}
                  disabled={currentReviewIndex === 0}
                >
                  ← Previous
                </button>

                <div style={{ display: 'flex', gap: '12px' }}>
                  {currentPhoto.approved ? (
                    <span className="status-badge online">✓ Approved</span>
                  ) : (
                    <button
                      className="btn btn-primary"
                      onClick={approveAndNext}
                    >
                      ✓ Approve {currentReviewIndex < reviewData.length - 1 ? '& Next' : ''}
                    </button>
                  )}

                  {currentReviewIndex < reviewData.length - 1 && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => setCurrentReviewIndex(prev => prev + 1)}
                    >
                      Skip →
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="glass-card full-width">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button className="btn btn-secondary" onClick={cancelReview}>
                Cancel Import
              </button>

              <button
                className="btn btn-primary"
                onClick={handleFinalize}
                disabled={!allApproved() || processing}
              >
                {processing ? 'Processing...' : `✓ Finalize Import (${approvedCount}/${reviewData.length})`}
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
          {/* Import Photos Card */}
          <div className="glass-card">
            <h3>Import Photos</h3>
            <p>Select photos or a folder to import into Archive-35.</p>

            <div className="button-group">
              <button className="btn btn-primary" onClick={handleSelectFiles}>
                Select Files
              </button>
              <button className="btn btn-secondary" onClick={handleSelectFolder}>
                Select Folder
              </button>
            </div>

            {files.length > 0 && (
              <div className="file-list">
                <p>{files.length} files selected</p>
                <ul>
                  {files.slice(0, 5).map((file, i) => (
                    <li key={i}>{file.split('/').pop()}</li>
                  ))}
                  {files.length > 5 && <li>...and {files.length - 5} more</li>}
                </ul>
              </div>
            )}
          </div>

          {/* Gallery Selection Card */}
          <div className="glass-card">
            <h3>Destination</h3>
            <p>Add to existing portfolio or create new.</p>

            {/* Toggle: New vs Existing */}
            <div className="toggle-group">
              <button
                className={`toggle-btn ${galleryMode === 'new' ? 'active' : ''}`}
                onClick={() => setGalleryMode('new')}
              >
                ➕ New Portfolio
              </button>
              <button
                className={`toggle-btn ${galleryMode === 'existing' ? 'active' : ''}`}
                onClick={() => setGalleryMode('existing')}
              >
                📁 Existing Portfolio
              </button>
            </div>

            {/* New Portfolio Form */}
            {galleryMode === 'new' && (
              <>
                <div className="form-group">
                  <label>Gallery Name *</label>
                  <input
                    type="text"
                    placeholder="e.g., Grand Teton January 2026"
                    value={galleryName}
                    onChange={(e) => setGalleryName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Country *</label>
                  <input
                    type="text"
                    placeholder="e.g., New Zealand, USA"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Helps the AI correctly identify locations in your photos</span>
                </div>

                <div className="form-group">
                  <label>Location (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g., Rotorua, North Island"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </div>


              </>
            )}

            {/* Existing Portfolio Selector */}
            {galleryMode === 'existing' && (
              <div className="form-group">
                <label>Select Portfolio *</label>
                <select
                  value={selectedPortfolio}
                  onChange={(e) => setSelectedPortfolio(e.target.value)}
                  className="portfolio-select"
                >
                  <option value="">-- Choose a portfolio --</option>
                  {existingPortfolios.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.photoCount} photos)
                    </option>
                  ))}
                </select>

                {selectedPortfolio && (
                  <div className="info-box">
                    Adding to: <strong>{existingPortfolios.find(p => p.id === selectedPortfolio)?.name}</strong>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Processing Card */}
          <div className="glass-card full-width">
            <h3>Processing</h3>
            <p>Import process with metadata review step.</p>

            <div className="processing-steps">
              {[
                'Extract EXIF metadata',
                'Generate AI descriptions',
                '⭐ Review & approve metadata',
                'Resize for web',
                'Create gallery files'
              ].map((label, i) => (
                <div
                  key={i}
                  className={`step ${processStatus?.step > i + 1 ? 'complete' : ''} ${processStatus?.step === i + 1 ? 'active' : ''}`}
                >
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

            {/* Progress Bar — visible during processing AND after completion */}
            {progress && (processing || completionState) && (
              <div style={{ margin: '16px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  <span>
                    {completionState
                      ? `Done: ${progress.total} photos processed`
                      : `${progress.phase === 'ai' ? 'AI Analysis' : 'Processing & Resizing'}: ${progress.current} / ${progress.total}`
                    }
                  </span>
                  <span>
                    {completionState
                      ? `Completed at ${completionState.timestamp}`
                      : (() => {
                          if (!startTimeRef.current || progress.current < 2) return 'Estimating...';
                          const elapsed = (Date.now() - startTimeRef.current) / 1000;
                          const perItem = elapsed / progress.current;
                          const remaining = Math.ceil(perItem * (progress.total - progress.current));
                          if (remaining < 60) return `~${remaining}s remaining`;
                          return `~${Math.ceil(remaining / 60)}m remaining`;
                        })()
                    }
                  </span>
                </div>
                <div style={{ width: '100%', height: '8px', background: 'var(--bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${(progress.current / progress.total) * 100}%`,
                    height: '100%',
                    background: completionState
                      ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                      : 'linear-gradient(90deg, var(--accent), var(--warning))',
                    borderRadius: '4px',
                    transition: 'width 0.3s ease'
                  }} />
                </div>
                {!completionState && progress.filename && (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{progress.filename}</p>
                )}
              </div>
            )}

            {/* Completion Summary Card */}
            {completionState && (
              <div style={{
                margin: '16px 0',
                padding: '20px',
                background: 'linear-gradient(135deg, rgba(34,197,94,0.1), rgba(22,163,106,0.05))',
                border: '1px solid rgba(34,197,94,0.3)',
                borderRadius: 'var(--radius-md)',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '36px', marginBottom: '8px' }}>\u2705</div>
                <h3 style={{ margin: '0 0 8px', color: '#22c55e' }}>Import Complete</h3>
                <p style={{ margin: '0 0 4px', color: 'var(--text-secondary)' }}>
                  <strong>{completionState.photosImported}</strong> photos imported to <strong>{completionState.galleryName}</strong>
                </p>
                <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  Ready to deploy to website
                </p>
                <button className="btn btn-primary" onClick={startNewImport}>
                  Start New Import
                </button>
              </div>
            )}

            {!completionState && (
              <>
                <button
                  className="btn btn-primary btn-large"
                  onClick={handleProcess}
                  disabled={!canProcess() || processing}
                >
                  {processing ? 'Processing...' : `Analyze ${files.length} Photo${files.length !== 1 ? 's' : ''}`}
                </button>

                <p className="card-note" style={{ marginTop: '12px' }}>
                  After AI analysis, you'll review and approve metadata before finalizing.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ContentIngest;
