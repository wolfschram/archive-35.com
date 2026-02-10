import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

// Thumbnail component that loads via IPC
function PhotoThumb({ filePath }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (filePath && window.electronAPI?.getThumbnail) {
      window.electronAPI.getThumbnail(filePath).then(dataUrl => {
        if (dataUrl) setSrc(dataUrl);
      });
    }
  }, [filePath]);
  return src
    ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    : <div className="photo-placeholder">⏳</div>;
}

// Helper to format location (handles both string and object formats)
const formatLocation = (location) => {
  if (!location) return '';
  if (typeof location === 'string') return location;
  if (typeof location === 'object') {
    // Handle object format: {country, region, place, coordinates}
    const parts = [location.place, location.region, location.country].filter(Boolean);
    return parts.join(', ');
  }
  return String(location);
};

function ContentManagement() {
  const [portfolios, setPortfolios] = useState([]);
  const [selectedPortfolio, setSelectedPortfolio] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deleteQueue, setDeleteQueue] = useState([]);

  // Portfolio rename state
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');

  // Edit mode state
  const [editingPhoto, setEditingPhoto] = useState(null);
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    location: '',
    tags: '',
    timeOfDay: '',
    notes: ''
  });

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
    setEditingPhoto(null);
    try {
      if (window.electronAPI) {
        const data = await window.electronAPI.getPortfolioPhotos(portfolioId);
        setPhotos(data || []);
      } else {
        // Demo data for development
        setPhotos([
          { id: 'gt-001', filename: 'WOLF6535-Pano.jpg', title: 'Teton Range Panorama', description: 'Panoramic view of the Teton Range', location: 'Grand Teton National Park, Wyoming', tags: ['landscape', 'mountains', 'panorama'], timeOfDay: 'sunrise', inWebsite: true },
          { id: 'gt-002', filename: 'WOLF6675.jpg', title: 'Morning Light on the Tetons', description: 'Golden light hitting peaks', location: 'Grand Teton National Park, Wyoming', tags: ['landscape', 'mountains', 'sunrise'], timeOfDay: 'sunrise', inWebsite: true },
          { id: 'gt-003', filename: 'WOLF6679.jpg', title: 'Cathedral Group', description: 'The iconic Cathedral Group peaks', location: 'Grand Teton National Park, Wyoming', tags: ['landscape', 'mountains'], timeOfDay: 'morning', inWebsite: true },
        ]);
      }
    } catch (err) {
      console.error('Failed to load photos:', err);
    }
    setLoading(false);
  };

  const togglePhotoSelection = (photoId, e) => {
    if (e.target.closest('.edit-btn')) return;

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

  // ===== EDIT METADATA =====
  const openEditModal = (photo, e) => {
    e.stopPropagation();
    setEditingPhoto(photo);
    setEditForm({
      title: photo.title || '',
      description: photo.description || '',
      location: formatLocation(photo.location) || '',  // FIX: format location object
      tags: (photo.tags || []).join(', '),
      timeOfDay: photo.timeOfDay || '',
      notes: photo.notes || ''
    });
  };

  const closeEditModal = () => {
    setEditingPhoto(null);
    setEditForm({ title: '', description: '', location: '', tags: '', timeOfDay: '', notes: '' });
  };

  const handleEditChange = (field, value) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

  const saveMetadata = async () => {
    if (!editingPhoto) return;

    const updatedData = {
      ...editForm,
      tags: editForm.tags.split(',').map(t => t.trim()).filter(t => t)
    };

    setLoading(true);
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.updatePhotoMetadata({
          portfolioId: selectedPortfolio,
          photoId: editingPhoto.id,
          metadata: updatedData
        });

        if (result.success) {
          setPhotos(prev => prev.map(p =>
            p.id === editingPhoto.id ? { ...p, ...updatedData } : p
          ));
          closeEditModal();
          alert('✅ Metadata saved successfully!');
        }
      } else {
        // Demo: just update local state
        setPhotos(prev => prev.map(p =>
          p.id === editingPhoto.id ? { ...p, ...updatedData } : p
        ));
        closeEditModal();
        alert('Demo mode: Metadata would be saved to:\n• photos.json\n• _gallery.json\n• EXIF (optional)');
      }
    } catch (err) {
      console.error('Failed to save metadata:', err);
      alert('Failed to save. Check console for details.');
    }
    setLoading(false);
  };

  const handleSoftDelete = async () => {
    if (selectedPhotos.length === 0) return;

    const confirmed = window.confirm(
      `Move ${selectedPhotos.length} photo(s) to _files_to_delete folder?\n\n` +
      `This will:\n` +
      `• Move originals to _files_to_delete/\n` +
      `• Remove from website\n` +
      `• Delete from R2 bucket (Pictorem fulfillment)\n` +
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
          await loadPhotos(selectedPortfolio);
        }
      } else {
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

  // ===== ADD PHOTOS =====
  const handleAddPhotos = async () => {
    if (!selectedPortfolio) {
      alert('Please select a portfolio first');
      return;
    }

    try {
      if (window.electronAPI) {
        const selectedFiles = await window.electronAPI.selectFiles();
        if (!selectedFiles || selectedFiles.length === 0) return;

        const portfolio = portfolios.find(p => p.id === selectedPortfolio);
        const confirmed = window.confirm(
          `Add ${selectedFiles.length} photo(s) to "${portfolio?.name}"?\n\n` +
          `This will:\n` +
          `• Analyze with AI for metadata\n` +
          `• Create web-optimized versions\n` +
          `• Sign with C2PA credentials\n` +
          `• Upload originals to R2\n\n` +
          `You'll be taken to Content Ingestion to review.`
        );

        if (confirmed) {
          // Navigate to ingest page
          window.location.hash = '#ingest';
          // Note: User will need to select the portfolio again in ingest
          alert('Go to Content Ingestion, select this portfolio, and add your photos.');
        }
      } else {
        alert('Demo mode: File picker would open here');
      }
    } catch (err) {
      console.error('Add photos failed:', err);
      alert('Failed to add photos. Check console for details.');
    }
  };

  // ===== REPLACE PHOTO =====
  const handleReplacePhoto = async (photo, e) => {
    e.stopPropagation();

    try {
      if (window.electronAPI) {
        const selectedFiles = await window.electronAPI.selectFiles();
        if (!selectedFiles || selectedFiles.length === 0) return;

        const newFilePath = selectedFiles[0];
        const confirmed = window.confirm(
          `Replace "${photo.title || photo.filename}" with the new image?\n\n` +
          `This will:\n` +
          `• Replace the original file\n` +
          `• Regenerate web-optimized versions\n` +
          `• Update C2PA credentials\n` +
          `• Upload new version to R2\n` +
          `• Preserve all metadata\n\n` +
          `This action cannot be undone.`
        );

        if (!confirmed) return;

        setLoading(true);
        const result = await window.electronAPI.replacePhoto({
          portfolioId: selectedPortfolio,
          photoId: photo.id,
          newFilePath
        });

        if (result.success) {
          alert('✅ Photo replaced successfully!');
          await loadPhotos(selectedPortfolio);
        } else {
          alert(`❌ Failed to replace photo: ${result.error}`);
        }
      } else {
        alert('Demo mode: Replace function would process the new file');
      }
    } catch (err) {
      console.error('Replace photo failed:', err);
      alert('Failed to replace photo. Check console for details.');
    }
    setLoading(false);
  };

  // ===== RENAME PORTFOLIO =====
  const startRename = (portfolio, e) => {
    e.stopPropagation();
    setRenamingId(portfolio.id);
    setRenameValue(portfolio.name);
    setRenameError('');
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
    setRenameError('');
  };

  const confirmRename = async (portfolioId) => {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenameError('Name cannot be empty'); return; }
    if (/[<>:"/\\|?*]/.test(trimmed)) { setRenameError('Invalid characters in name'); return; }

    const original = portfolios.find(p => p.id === portfolioId);
    if (original && original.name === trimmed) { cancelRename(); return; }

    setLoading(true);
    setRenameError('');
    try {
      if (window.electronAPI && window.electronAPI.renamePortfolio) {
        const result = await window.electronAPI.renamePortfolio({
          portfolioId,
          newName: trimmed
        });
        if (result.success) {
          // Update selected portfolio if it was the renamed one
          if (selectedPortfolio === portfolioId) {
            setSelectedPortfolio(result.newId);
          }
          await loadPortfolios();
          cancelRename();
        } else {
          setRenameError(result.error || 'Rename failed');
        }
      } else {
        // Demo mode
        setPortfolios(prev => prev.map(p =>
          p.id === portfolioId ? { ...p, name: trimmed, id: trimmed.toLowerCase().replace(/\s+/g, '_') } : p
        ));
        cancelRename();
      }
    } catch (err) {
      console.error('Rename failed:', err);
      setRenameError('Rename failed: ' + err.message);
    }
    setLoading(false);
  };

  const handleRenameKeyDown = (e, portfolioId) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmRename(portfolioId); }
    else if (e.key === 'Escape') cancelRename();
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
              <div
                key={portfolio.id}
                className={`portfolio-item ${selectedPortfolio === portfolio.id ? 'selected' : ''}`}
                onClick={() => { if (renamingId !== portfolio.id) loadPhotos(portfolio.id); }}
              >
                {renamingId === portfolio.id ? (
                  <div className="portfolio-rename-row" onClick={e => e.stopPropagation()}>
                    <input
                      type="text"
                      className="portfolio-rename-input"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => handleRenameKeyDown(e, portfolio.id)}
                      onBlur={() => confirmRename(portfolio.id)}
                      autoFocus
                    />
                    {renameError && <span className="rename-error">{renameError}</span>}
                  </div>
                ) : (
                  <>
                    <span className="portfolio-name">{portfolio.name}</span>
                    <button
                      className="rename-btn"
                      onClick={(e) => startRename(portfolio, e)}
                      title="Rename portfolio"
                    >
                      ✏️
                    </button>
                  </>
                )}
                <span className="portfolio-meta">
                  {portfolio.photoCount} photos • {formatLocation(portfolio.location)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions Panel */}
        <div className="glass-card">
          <h3>Actions</h3>
          <p>Manage selected photos ({selectedPhotos.length} selected)</p>

          <div className="button-group vertical">
            <button
              className="btn btn-primary"
              onClick={handleAddPhotos}
              disabled={!selectedPortfolio || loading}
            >
              ➕ Add Photos
            </button>

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
            <strong>Tip:</strong> Click the ✏️ button on any photo to edit its title, description, and other metadata.
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
                    onClick={(e) => togglePhotoSelection(photo.id, e)}
                  >
                    <div className="photo-thumb">
                      <PhotoThumb filePath={photo.path} />
                      {selectedPhotos.includes(photo.id) && (
                        <div className="photo-check">✓</div>
                      )}
                      <div className="photo-actions">
                        <button
                          className="edit-btn"
                          onClick={(e) => openEditModal(photo, e)}
                          title="Edit metadata"
                        >
                          ✏️
                        </button>
                        <button
                          className="replace-btn"
                          onClick={(e) => handleReplacePhoto(photo, e)}
                          title="Replace with new image"
                        >
                          🔄
                        </button>
                      </div>
                    </div>
                    <div className="photo-info">
                      <span className="photo-title">{photo.title || photo.filename}</span>
                      <span className="photo-time-badge">{photo.timeOfDay || '?'}</span>
                      <div className="photo-status">
                        {photo.inWebsite && <span className="status-badge website">Web</span>}
                        {photo.inPictorem && <span className="status-badge pictorem">Pictorem</span>}
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

      {/* ===== EDIT METADATA MODAL ===== */}
      {editingPhoto && (
        <div className="modal-overlay" onClick={closeEditModal}>
          <div className="modal-content edit-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Photo Metadata</h3>
              <button className="modal-close" onClick={closeEditModal}>×</button>
            </div>

            <div className="modal-body">
              <div className="edit-photo-preview">
                <div className="photo-placeholder large">📷</div>
                <span className="filename">{editingPhoto.filename}</span>
              </div>

              <div className="form-group">
                <label>Title</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={e => handleEditChange('title', e.target.value)}
                  placeholder="e.g., Teton Sunrise Panorama"
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={editForm.description}
                  onChange={e => handleEditChange('description', e.target.value)}
                  placeholder="Describe the scene..."
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label>Time of Day</label>
                <select
                  value={editForm.timeOfDay}
                  onChange={e => handleEditChange('timeOfDay', e.target.value)}
                >
                  <option value="">-- Select --</option>
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
                <small className="help-text">⚠️ AI often confuses sunrise/sunset - please verify!</small>
              </div>

              <div className="form-group">
                <label>Location</label>
                <input
                  type="text"
                  value={editForm.location}
                  onChange={e => handleEditChange('location', e.target.value)}
                  placeholder="e.g., Grand Teton National Park, Wyoming"
                />
              </div>

              <div className="form-group">
                <label>Tags (comma-separated)</label>
                <input
                  type="text"
                  value={editForm.tags}
                  onChange={e => handleEditChange('tags', e.target.value)}
                  placeholder="landscape, mountains, sunrise, panorama"
                />
              </div>

              <div className="form-group">
                <label>Notes (internal only)</label>
                <textarea
                  value={editForm.notes}
                  onChange={e => handleEditChange('notes', e.target.value)}
                  placeholder="Personal notes, corrections, reminders..."
                  rows={2}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeEditModal}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveMetadata} disabled={loading}>
                {loading ? 'Saving...' : '💾 Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ContentManagement;
