import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

function ContentManagement() {
  const [portfolios, setPortfolios] = useState([]);
  const [selectedPortfolio, setSelectedPortfolio] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deleteQueue, setDeleteQueue] = useState([]);

  // Load portfolios on mount
  useEffect(() => {
    loadPortfolios();
  }, []);

  const loadPortfolios = async () => {
    setLoading(true);
    try {
      if (window.electronAPI) {
        const data = await window.electronAPI.getPortfolios();
        setPortfolios(data || []);
      } else {
        // Demo data for development
        setPortfolios([
          { id: 'grand_teton', name: 'Grand Teton', photoCount: 28, location: 'Wyoming, USA' },
          { id: 'yellowstone', name: 'Yellowstone', photoCount: 0, location: 'Wyoming, USA' },
        ]);
      }
    } catch (err) {
      console.error('Failed to load portfolios:', err);
    }
    setLoading(false);
  };

  const loadPhotos = async (portfolioId) => {
    setLoading(true);
    setSelectedPortfolio(portfolioId);
    setSelectedPhotos([]);
    try {
      if (window.electronAPI) {
        const data = await window.electronAPI.getPortfolioPhotos(portfolioId);
        setPhotos(data || []);
      } else {
        // Demo data for development
        setPhotos([
          { id: 'photo_001', filename: 'GT_sunrise_001.jpg', title: 'Teton Sunrise', inWebsite: true, inArtelo: false, inSocialQueue: true },
          { id: 'photo_002', filename: 'GT_reflection_002.jpg', title: 'Mountain Reflection', inWebsite: true, inArtelo: false, inSocialQueue: false },
          { id: 'photo_003', filename: 'GT_wildlife_003.jpg', title: 'Elk at Dawn', inWebsite: true, inArtelo: false, inSocialQueue: true },
        ]);
      }
    } catch (err) {
      console.error('Failed to load photos:', err);
    }
    setLoading(false);
  };

  const togglePhotoSelection = (photoId) => {
    setSelectedPhotos(prev =>
      prev.includes(photoId)
        ? prev.filter(id => id !== photoId)
        : [...prev, photoId]
    );
  };

  const selectAllPhotos = () => {
    if (selectedPhotos.length === photos.length) {
      setSelectedPhotos([]);
    } else {
      setSelectedPhotos(photos.map(p => p.id));
    }
  };

  const handleSoftDelete = async () => {
    if (selectedPhotos.length === 0) return;

    const confirmed = window.confirm(
      `Move ${selectedPhotos.length} photo(s) to _files_to_delete folder?\n\n` +
      `This will:\n` +
      `• Move originals to _files_to_delete/\n` +
      `• Remove from website\n` +
      `• Queue Artelo removal\n` +
      `• Remove from social queue\n\n` +
      `Files are NOT permanently deleted until you empty that folder manually.`
    );

    if (!confirmed) return;

    setLoading(true);
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.softDeletePhotos({
          portfolioId: selectedPortfolio,
          photoIds: selectedPhotos
        });

        if (result.success) {
          setDeleteQueue(prev => [...prev, ...result.movedFiles]);
          // Refresh the photo list
          await loadPhotos(selectedPortfolio);
        }
      } else {
        // Demo: just remove from local state
        setPhotos(prev => prev.filter(p => !selectedPhotos.includes(p.id)));
        setSelectedPhotos([]);
        alert('Demo mode: Photos would be moved to _files_to_delete/');
      }
    } catch (err) {
      console.error('Soft delete failed:', err);
      alert('Failed to move photos. Check console for details.');
    }
    setLoading(false);
  };

  const handleArchive = async () => {
    if (selectedPhotos.length === 0) return;

    const confirmed = window.confirm(
      `Archive ${selectedPhotos.length} photo(s)?\n\n` +
      `This will:\n` +
      `• Move to _archived/ folder\n` +
      `• Preserve all metadata\n` +
      `• Hide from active displays\n\n` +
      `Photos can be restored later.`
    );

    if (!confirmed) return;

    setLoading(true);
    try {
      if (window.electronAPI) {
        await window.electronAPI.archivePhotos({
          portfolioId: selectedPortfolio,
          photoIds: selectedPhotos
        });
        await loadPhotos(selectedPortfolio);
      } else {
        setPhotos(prev => prev.filter(p => !selectedPhotos.includes(p.id)));
        setSelectedPhotos([]);
        alert('Demo mode: Photos would be moved to _archived/');
      }
    } catch (err) {
      console.error('Archive failed:', err);
    }
    setLoading(false);
  };

  return (
    <div className="page">
      <header className="page-header">
        <h2>Content Management</h2>
        <p className="page-subtitle">View, edit, and manage existing portfolio content</p>
      </header>

      <div className="card-grid">
        {/* Portfolio Selector */}
        <div className="glass-card">
          <h3>Portfolios</h3>
          <p>Select a portfolio to manage its photos.</p>

          {loading && !selectedPortfolio && <p className="loading">Loading...</p>}

          <div className="portfolio-list">
            {portfolios.map(portfolio => (
              <button
                key={portfolio.id}
                className={`portfolio-item ${selectedPortfolio === portfolio.id ? 'selected' : ''}`}
                onClick={() => loadPhotos(portfolio.id)}
              >
                <span className="portfolio-name">{portfolio.name}</span>
                <span className="portfolio-meta">
                  {portfolio.photoCount} photos • {portfolio.location}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Actions Panel */}
        <div className="glass-card">
          <h3>Actions</h3>
          <p>Manage selected photos ({selectedPhotos.length} selected)</p>

          <div className="button-group vertical">
            <button
              className="btn btn-secondary"
              onClick={selectAllPhotos}
              disabled={!selectedPortfolio || photos.length === 0}
            >
              {selectedPhotos.length === photos.length ? 'Deselect All' : 'Select All'}
            </button>

            <button
              className="btn btn-warning"
              onClick={handleArchive}
              disabled={selectedPhotos.length === 0 || loading}
            >
              📦 Archive Selected
            </button>

            <button
              className="btn btn-danger"
              onClick={handleSoftDelete}
              disabled={selectedPhotos.length === 0 || loading}
            >
              🗑️ Delete Selected
            </button>
          </div>

          <div className="info-box">
            <strong>Soft Delete:</strong> Files move to <code>_files_to_delete/</code> folder.
            Nothing is permanently deleted until you manually empty that folder.
          </div>
        </div>

        {/* Photo Grid */}
        {selectedPortfolio && (
          <div className="glass-card full-width">
            <h3>Photos in {portfolios.find(p => p.id === selectedPortfolio)?.name}</h3>

            {loading ? (
              <p className="loading">Loading photos...</p>
            ) : photos.length === 0 ? (
              <p className="empty-state">No photos in this portfolio.</p>
            ) : (
              <div className="photo-grid">
                {photos.map(photo => (
                  <div
                    key={photo.id}
                    className={`photo-card ${selectedPhotos.includes(photo.id) ? 'selected' : ''}`}
                    onClick={() => togglePhotoSelection(photo.id)}
                  >
                    <div className="photo-thumb">
                      <div className="photo-placeholder">📷</div>
                      {selectedPhotos.includes(photo.id) && (
                        <div className="photo-check">✓</div>
                      )}
                    </div>
                    <div className="photo-info">
                      <span className="photo-title">{photo.title || photo.filename}</span>
                      <div className="photo-status">
                        {photo.inWebsite && <span className="status-badge website">Web</span>}
                        {photo.inArtelo && <span className="status-badge artelo">Artelo</span>}
                        {photo.inSocialQueue && <span className="status-badge social">Social</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Delete Queue Info */}
        {deleteQueue.length > 0 && (
          <div className="glass-card full-width">
            <h3>Pending Deletion</h3>
            <p>These files have been moved to <code>_files_to_delete/</code>:</p>
            <ul className="delete-queue">
              {deleteQueue.slice(-5).map((file, i) => (
                <li key={i}>{file}</li>
              ))}
              {deleteQueue.length > 5 && <li>...and {deleteQueue.length - 5} more</li>}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default ContentManagement;
