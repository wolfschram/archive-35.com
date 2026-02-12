import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

function GalleryBrowser() {
  const [galleries, setGalleries] = useState([]);
  const [selectedGallery, setSelectedGallery] = useState(null);
  const [thumbnails, setThumbnails] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    scanGalleries();
  }, []);

  async function scanGalleries() {
    if (!window.electronAPI) return;
    setLoading(true);
    setError(null);

    const result = await window.electronAPI.scanGalleries();
    if (result.error) {
      setError(result.error);
    } else {
      setGalleries(result.galleries || []);
      // Load first thumbnail for each gallery
      for (const gallery of (result.galleries || []).slice(0, 30)) {
        if (gallery.photos.length > 0) {
          const thumb = await window.electronAPI.getPhotoThumbnail(gallery.photos[0].path);
          if (thumb) {
            setThumbnails(prev => ({ ...prev, [gallery.name]: thumb }));
          }
        }
      }
    }
    setLoading(false);
  }

  async function selectGallery(gallery) {
    setSelectedGallery(gallery);
    // Load thumbnails for all photos in selected gallery
    for (const photo of gallery.photos.slice(0, 50)) {
      if (!thumbnails[photo.path]) {
        const thumb = await window.electronAPI.getPhotoThumbnail(photo.path);
        if (thumb) {
          setThumbnails(prev => ({ ...prev, [photo.path]: thumb }));
        }
      }
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h2>Galleries</h2>
        <p className="page-subtitle">
          {selectedGallery
            ? `${selectedGallery.name} — ${selectedGallery.photoCount} photos`
            : `${galleries.length} collections available`}
        </p>
      </header>

      {error && (
        <div className="status-message error">{error}</div>
      )}

      {selectedGallery ? (
        <div>
          <button className="btn btn-secondary" onClick={() => setSelectedGallery(null)} style={{ marginBottom: 20 }}>
            ← Back to Galleries
          </button>

          <div className="glass-card full-width">
            <h3>{selectedGallery.name}</h3>
            <p>{selectedGallery.photoCount} photos &middot; {selectedGallery.path}</p>

            <div className="photo-select-grid">
              {selectedGallery.photos.map((photo, i) => (
                <div key={i} className="photo-select-item">
                  {thumbnails[photo.path] ? (
                    <img src={thumbnails[photo.path]} alt={photo.filename} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                      {photo.filename.split('.')[0].substring(0, 8)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="button-group" style={{ marginBottom: 20 }}>
            <button className="btn btn-primary" onClick={scanGalleries} disabled={loading}>
              {loading ? 'Scanning...' : 'Rescan Galleries'}
            </button>
          </div>

          {loading ? (
            <div className="empty-state">Scanning photography folders...</div>
          ) : galleries.length === 0 ? (
            <div className="empty-state">
              No galleries found. Configure the Photography path in Settings.
            </div>
          ) : (
            <div className="gallery-grid">
              {galleries.map((gallery) => (
                <div
                  key={gallery.name}
                  className="gallery-card"
                  onClick={() => selectGallery(gallery)}
                >
                  <div className="gallery-thumb">
                    {thumbnails[gallery.name] ? (
                      <img src={thumbnails[gallery.name]} alt={gallery.name} />
                    ) : (
                      <span>🖼️</span>
                    )}
                  </div>
                  <div className="gallery-info">
                    <div className="gallery-name">{gallery.name.replace(/_/g, ' ')}</div>
                    <div className="gallery-count">{gallery.photoCount} photos</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default GalleryBrowser;
