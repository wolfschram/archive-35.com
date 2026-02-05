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

  const handleProcess = async () => {
    if (!canProcess()) return;

    setProcessing(true);
    setProcessStatus({ step: 1, message: 'Extracting EXIF metadata...' });

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.processIngest({
          files,
          mode: galleryMode,
          portfolioId: galleryMode === 'existing' ? selectedPortfolio : null,
          newGallery: galleryMode === 'new' ? {
            name: galleryName,
            location: location,
            dateRange: dateRange
          } : null
        });

        if (result.success) {
          setProcessStatus({ step: 5, message: 'Complete!', success: true });
          setFiles([]);
          setGalleryName('');
          setLocation('');
          setDateRange('');
          setSelectedPortfolio('');
          loadPortfolios(); // Refresh list
        } else {
          setProcessStatus({ step: 0, message: result.error, error: true });
        }
      } else {
        // Demo: simulate processing steps
        for (let step = 1; step <= 4; step++) {
          const messages = [
            'Extracting EXIF metadata...',
            'Generating AI descriptions...',
            'Resizing for web...',
            'Creating gallery files...'
          ];
          setProcessStatus({ step, message: messages[step - 1] });
          await new Promise(resolve => setTimeout(resolve, 800));
        }
        setProcessStatus({ step: 5, message: 'Complete!', success: true });
      }
    } catch (err) {
      console.error('Processing failed:', err);
      setProcessStatus({ step: 0, message: err.message, error: true });
    }

    setProcessing(false);
  };

  return (
    <div className="page">
      <header className="page-header">
        <h2>Content Ingestion</h2>
        <p className="page-subtitle">Import and process new photography</p>
      </header>

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
          <p>Review and process selected content.</p>

          <div className="processing-steps">
            {[
              'Extract EXIF metadata',
              'Generate AI descriptions',
              'Resize for web',
              'Create gallery files'
            ].map((label, i) => (
              <div
                key={i}
                className={`step ${processStatus?.step > i ? 'complete' : ''} ${processStatus?.step === i + 1 ? 'active' : ''}`}
              >
                <span className="step-number">{i + 1}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>

          {processStatus?.message && (
            <div className={`status-message ${processStatus.error ? 'error' : ''} ${processStatus.success ? 'success' : ''}`}>
              {processStatus.message}
            </div>
          )}

          <button
            className="btn btn-primary btn-large"
            onClick={handleProcess}
            disabled={!canProcess() || processing}
          >
            {processing ? 'Processing...' : `Process ${files.length} Photo${files.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ContentIngest;
