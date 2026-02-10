import React, { useState, useEffect, useCallback, useRef } from 'react';
import '../styles/Pages.css';

/**
 * PhotoThumb — lazy-loaded thumbnail with drag handle
 */
function PhotoThumb({ photo, index, isDragging, onDragStart, onDragOver, onDragEnd, onDrop }) {
  const [thumb, setThumb] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (photo.path && window.electronAPI?.getThumbnail) {
      window.electronAPI.getThumbnail(photo.path).then(data => {
        if (!cancelled && data) setThumb(data);
      });
    }
    return () => { cancelled = true; };
  }, [photo.path]);

  const orientation = photo.dimensions?.orientation || 'landscape';
  const isWide = orientation === 'panorama' || (photo.dimensions?.aspectRatio > 1.8);

  return (
    <div
      className={`gallery-thumb ${isDragging ? 'dragging' : ''} ${isWide ? 'wide' : ''}`}
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={onDragEnd}
      onDrop={(e) => onDrop(e, index)}
      style={{
        gridColumn: isWide ? 'span 2' : 'span 1',
      }}
    >
      <div className="thumb-number">{index + 1}</div>
      <div className="thumb-image-wrap">
        {thumb ? (
          <img src={thumb} alt={photo.title} draggable={false} />
        ) : (
          <div className="thumb-placeholder">Loading...</div>
        )}
      </div>
      <div className="thumb-info">
        <span className="thumb-title">{photo.title || photo.filename}</span>
        {photo.dimensions && (
          <span className="thumb-meta">
            {photo.dimensions.orientation} &middot; {photo.dimensions.megapixels}MP
          </span>
        )}
      </div>
      <div className="thumb-drag-handle" title="Drag to reorder">⠿</div>
    </div>
  );
}

/**
 * PortfolioCard — sidebar entry for a portfolio
 */
function PortfolioCard({ portfolio, isActive, onClick, index, onDragStart, onDragOver, onDrop, onDragEnd, isDragging }) {
  return (
    <div
      className={`portfolio-sidebar-item ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={onClick}
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
      onDragEnd={onDragEnd}
    >
      <span className="portfolio-drag">⠿</span>
      <div className="portfolio-info">
        <span className="portfolio-name">{portfolio.name}</span>
        <span className="portfolio-count">{portfolio.photoCount} photos</span>
      </div>
      {portfolio.country && (
        <span className="portfolio-country">{portfolio.country}</span>
      )}
    </div>
  );
}

function GalleryPreview() {
  // Portfolio list state
  const [portfolios, setPortfolios] = useState([]);
  const [portfolioOrder, setPortfolioOrder] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePortfolioId, setActivePortfolioId] = useState(null);

  // Photo state for active portfolio
  const [photos, setPhotos] = useState([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

  // Drag state for photos
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // Drag state for portfolio order
  const [portfolioDragIndex, setPortfolioDragIndex] = useState(null);
  const [portfolioDragOverIndex, setPortfolioDragOverIndex] = useState(null);
  const [portfolioOrderChanged, setPortfolioOrderChanged] = useState(false);

  // Load portfolios and portfolio order on mount
  useEffect(() => {
    loadPortfolios();
  }, []);

  const loadPortfolios = async () => {
    setLoading(true);
    try {
      const [portfolioData, orderData] = await Promise.all([
        window.electronAPI.getPortfolios(),
        window.electronAPI.getPortfolioOrder()
      ]);

      // Sort portfolios according to saved order
      if (orderData && orderData.length > 0) {
        const orderMap = {};
        orderData.forEach((name, idx) => { orderMap[name] = idx; });
        portfolioData.sort((a, b) => {
          const aIdx = orderMap[a.folderName] ?? 999;
          const bIdx = orderMap[b.folderName] ?? 999;
          return aIdx - bIdx;
        });
        setPortfolioOrder(orderData);
      } else {
        setPortfolioOrder(portfolioData.map(p => p.folderName));
      }

      setPortfolios(portfolioData);
      if (portfolioData.length > 0 && !activePortfolioId) {
        loadPhotos(portfolioData[0].id);
        setActivePortfolioId(portfolioData[0].id);
      }
    } catch (err) {
      console.error('Failed to load portfolios:', err);
    }
    setLoading(false);
  };

  const loadPhotos = async (portfolioId) => {
    setLoadingPhotos(true);
    setHasChanges(false);
    setSaveMessage(null);
    try {
      const data = await window.electronAPI.getPortfolioPhotos(portfolioId);
      setPhotos(data);
    } catch (err) {
      console.error('Failed to load photos:', err);
      setPhotos([]);
    }
    setLoadingPhotos(false);
  };

  const handlePortfolioClick = (portfolio) => {
    if (portfolio.id === activePortfolioId) return;
    if (hasChanges) {
      const discard = window.confirm('You have unsaved photo order changes. Discard them?');
      if (!discard) return;
    }
    setActivePortfolioId(portfolio.id);
    loadPhotos(portfolio.id);
  };

  // === Photo drag-and-drop ===
  const handlePhotoDragStart = useCallback((e, index) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  }, []);

  const handlePhotoDragOver = useCallback((e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, []);

  const handlePhotoDrop = useCallback((e, dropIndex) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    setPhotos(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(dragIndex, 1);
      updated.splice(dropIndex, 0, moved);
      return updated;
    });
    setHasChanges(true);
    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragIndex]);

  const handlePhotoDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  // === Portfolio drag-and-drop ===
  const handlePortfolioDragStart = useCallback((e, index) => {
    setPortfolioDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  }, []);

  const handlePortfolioDragOver = useCallback((e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setPortfolioDragOverIndex(index);
  }, []);

  const handlePortfolioDrop = useCallback((e, dropIndex) => {
    e.preventDefault();
    if (portfolioDragIndex === null || portfolioDragIndex === dropIndex) {
      setPortfolioDragIndex(null);
      setPortfolioDragOverIndex(null);
      return;
    }
    setPortfolios(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(portfolioDragIndex, 1);
      updated.splice(dropIndex, 0, moved);
      return updated;
    });
    setPortfolioOrderChanged(true);
    setPortfolioDragIndex(null);
    setPortfolioDragOverIndex(null);
  }, [portfolioDragIndex]);

  const handlePortfolioDragEnd = useCallback(() => {
    setPortfolioDragIndex(null);
    setPortfolioDragOverIndex(null);
  }, []);

  // === Save handlers ===
  const savePhotoOrder = async () => {
    if (!activePortfolioId || !hasChanges) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const orderedFilenames = photos.map(p => p.filename);
      const result = await window.electronAPI.reorderPhotos({
        portfolioId: activePortfolioId,
        orderedFilenames
      });
      if (result.success) {
        setHasChanges(false);
        setSaveMessage({ type: 'success', text: `Photo order saved (${result.count} photos)` });
      } else {
        setSaveMessage({ type: 'error', text: result.error || 'Save failed' });
      }
    } catch (err) {
      setSaveMessage({ type: 'error', text: err.message });
    }
    setSaving(false);
    setTimeout(() => setSaveMessage(null), 4000);
  };

  const savePortfolioOrder = async () => {
    try {
      const orderedFolderNames = portfolios.map(p => p.folderName);
      const result = await window.electronAPI.savePortfolioOrder({ orderedFolderNames });
      if (result.success) {
        setPortfolioOrderChanged(false);
        setSaveMessage({ type: 'success', text: 'Portfolio order saved' });
      } else {
        setSaveMessage({ type: 'error', text: result.error });
      }
    } catch (err) {
      setSaveMessage({ type: 'error', text: err.message });
    }
    setTimeout(() => setSaveMessage(null), 4000);
  };

  // Move photo with arrow buttons (accessibility + quick reorder)
  const movePhoto = (fromIndex, direction) => {
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= photos.length) return;
    setPhotos(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
    setHasChanges(true);
  };

  const activePortfolio = portfolios.find(p => p.id === activePortfolioId);
  const totalPhotos = portfolios.reduce((sum, p) => sum + p.photoCount, 0);

  return (
    <div className="page" style={{ maxWidth: '1400px' }}>
      <header className="page-header">
        <h2>Gallery Preview</h2>
        <p className="page-subtitle">
          Preview and reorder photos within portfolios &middot; {portfolios.length} portfolios &middot; {totalPhotos} total photos
        </p>
      </header>

      <div style={{ display: 'flex', gap: '24px', minHeight: 'calc(100vh - 200px)' }}>
        {/* Portfolio sidebar */}
        <div style={{
          width: '260px',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
            padding: '0 4px',
          }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Portfolios
            </span>
            {portfolioOrderChanged && (
              <button
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '4px 10px' }}
                onClick={savePortfolioOrder}
              >
                Save Order
              </button>
            )}
          </div>

          {loading ? (
            <div style={{ padding: '20px', color: 'var(--text-muted)', fontSize: '13px' }}>Loading portfolios...</div>
          ) : (
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {portfolios.map((portfolio, idx) => (
                <PortfolioCard
                  key={portfolio.id}
                  portfolio={portfolio}
                  index={idx}
                  isActive={portfolio.id === activePortfolioId}
                  onClick={() => handlePortfolioClick(portfolio)}
                  onDragStart={handlePortfolioDragStart}
                  onDragOver={handlePortfolioDragOver}
                  onDrop={handlePortfolioDrop}
                  onDragEnd={handlePortfolioDragEnd}
                  isDragging={portfolioDragIndex === idx}
                />
              ))}
            </div>
          )}
        </div>

        {/* Photo grid */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Portfolio header */}
          {activePortfolio && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
              padding: '12px 16px',
              background: 'var(--glass-bg)',
              border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius-md)',
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px' }}>{activePortfolio.name}</h3>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  {photos.length} photos
                  {activePortfolio.location && ` \u00b7 ${activePortfolio.location}`}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {saveMessage && (
                  <span style={{
                    fontSize: '12px',
                    color: saveMessage.type === 'success' ? '#22c55e' : '#ef4444',
                    fontWeight: 500,
                  }}>
                    {saveMessage.text}
                  </span>
                )}
                {hasChanges && (
                  <button
                    className="btn btn-primary"
                    onClick={savePhotoOrder}
                    disabled={saving}
                    style={{ fontSize: '13px', padding: '8px 16px' }}
                  >
                    {saving ? 'Saving...' : 'Save Photo Order'}
                  </button>
                )}
              </div>
            </div>
          )}

          {loadingPhotos ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '300px',
              color: 'var(--text-muted)',
              fontSize: '14px',
            }}>
              Loading photos...
            </div>
          ) : photos.length === 0 ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '300px',
              color: 'var(--text-muted)',
              fontSize: '14px',
            }}>
              {activePortfolioId ? 'No photos in this portfolio' : 'Select a portfolio to preview'}
            </div>
          ) : (
            <div className="gallery-grid">
              {photos.map((photo, idx) => (
                <PhotoThumb
                  key={photo.filename}
                  photo={photo}
                  index={idx}
                  isDragging={dragIndex === idx}
                  onDragStart={handlePhotoDragStart}
                  onDragOver={handlePhotoDragOver}
                  onDrop={handlePhotoDrop}
                  onDragEnd={handlePhotoDragEnd}
                />
              ))}
            </div>
          )}

          {/* Quick reorder hint */}
          {photos.length > 0 && (
            <div style={{
              marginTop: '16px',
              padding: '10px 16px',
              fontSize: '12px',
              color: 'var(--text-muted)',
              borderTop: '1px solid var(--glass-border)',
            }}>
              Drag photos to reorder &middot; Changes are saved to _photos.json
              {hasChanges && (
                <span style={{ color: '#fbbf24', marginLeft: '8px', fontWeight: 600 }}>
                  Unsaved changes
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default GalleryPreview;
