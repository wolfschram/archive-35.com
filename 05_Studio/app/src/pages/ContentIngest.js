import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

function ContentIngest() {
  const [files, setFiles] = useState([]);
  const [galleryMode, setGalleryMode] = useState('new'); // 'new' or 'existing'
  const [galleryName, setGalleryName] = useState('');
  const [location, setLocation] = useState('');
  const [dateRange, setDateRange] = useState('');
  const [existingPortfolios, setExistingPortfolios] = useState([]);
  const [selectedPortfolio, setSelectedPortfolio] = useState('');
  const [processing, setProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState(null);

  // Review step state
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewData, setReviewData] = useState([]);
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0);

  // Load existing portfolios on mount
  useEffect(() => {
    loadPortfolios();
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
    setProcessStatus({ step: 1, message: 'Extracting EXIF metadata...' });

    try {
      if (window.electronAPI) {
        // Call API to extract EXIF and generate AI descriptions
        const result = await window.electronAPI.analyzePhotos({ files });

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
          timeOfDay: 'unknown',  // This is what we want user to verify!
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
    setProcessStatus({ step: 3, message: 'Resizing for web...' });

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.finalizeIngest({
          photos: reviewData,
          mode: galleryMode,
          portfolioId: galleryMode === 'existing' ? selectedPortfolio : null,
          newGallery: galleryMode === 'new' ? {
            name: galleryName,
            location: location,
            dateRange: dateRange
          } : null
        });

        if (result.success) {
          setProcessStatus({ step: 5, message: '✅ Import complete!', success: true });
          resetForm();
          loadPortfolios();
        } else {
          setProcessStatus({ step: 0, message: result.error, error: true });
        }
      } else {
        // Demo finalization
        await new Promise(resolve => setTimeout(resolve, 600));
        setProcessStatus({ step: 4, message: 'Creating gallery files...' });
        await new Promise(resolve => setTimeout(resolve, 600));
        setProcessStatus({ step: 5, message: '✅ Import complete!', success: true });
        resetForm();
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
    setLocation('');
    setDateRange('');
    setSelectedPortfolio('');
    setReviewMode(false);
    setReviewData([]);
    setCurrentReviewIndex(0);
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
            <p style={{ marginTop: '8px', color: 'var(--warning)' }}>
              ⚠️ <strong>Important:</strong> AI often confuses sunrise/sunset. Please verify time of day!
            </p>
          </div>

          {/* Photo Review Card */}
          {currentPhoto && (
            <div className="glass-card full-width">
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                {/* Photo preview */}
                <div style={{ flex: '0 0 200px' }}>
                  <div className="photo-placeholder large" style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                    📷
                  </div>
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
                    <label style={{ color: 'var(--warning)' }}>⚠️ Time of Day (VERIFY!)</label>
                    <select
                      value={currentPhoto.timeOfDay}
                      onChange={e => updateReviewItem(currentReviewIndex, 'timeOfDay', e.target.value)}
                      style={{ width: '100%', padding: '10px', background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}
                    >
                      <option value="unknown">-- Please Select --</option>
                      <option value="sunrise">🌅 Sunrise</option>
                      <option value="morning">☀️ Morning</option>
                      <option value="midday">🌞 Midday</option>
                      <option value="afternoon">🌤️ Afternoon</option>
                      <option value="golden-hour">🌇 Golden Hour</option>
                      <option value="sunset">🌆 Sunset</option>
                      <option value="twilight">🌃 Twilight</option>
                      <option value="night">🌙 Night</option>
                      <option value="blue-hour">💙 Blue Hour</option>
                    </select>
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
                  <label>Location</label>
                  <input
                    type="text"
                    placeholder="e.g., Wyoming, USA"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Date Range</label>
                  <input
                    type="text"
                    placeholder="e.g., January 26-30, 2026"
                    value={dateRange}
                    onChange={(e) => setDateRange(e.target.value)}
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
          </div>
        </div>
      )}
    </div>
  );
}

export default ContentIngest;
