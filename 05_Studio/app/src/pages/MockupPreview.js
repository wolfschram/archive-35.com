import React, { useState, useEffect, useCallback } from 'react';

/**
 * MockupPreview — Tab 2: Live Preview Lab
 *
 * Three-panel layout:
 *   LEFT (280px): Gallery selector + compatible photo grid with thumbnails (2 columns)
 *   CENTER: Live mockup preview canvas
 *   RIGHT (250px): Template selector + room thumbnail + print/platform controls + export section
 *
 * Features:
 *   - Photo compatibility filtering by aspect ratio (green zone AR ± 15%)
 *   - Lazy-loaded thumbnail previews
 *   - Room template preview
 *   - Export buttons (Save to Mockups, Etsy, Pinterest, Instagram)
 */
function MockupPreview() {
  // Data
  const [galleries, setGalleries] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [templateThumbnails, setTemplateThumbnails] = useState({});
  const [photoThumbnails, setPhotoThumbnails] = useState({});

  // Selections
  const [selectedGallery, setSelectedGallery] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [printSize, setPrintSize] = useState('24x36');
  const [platform, setPlatform] = useState('');

  // Compatibility & filtering
  const [compatiblePhotos, setCompatiblePhotos] = useState([]);
  const [incompatiblePhotos, setIncompatiblePhotos] = useState([]);
  const [showIncompatible, setShowIncompatible] = useState(false);

  // Preview
  const [previewUrl, setPreviewUrl] = useState(null);
  const [renderTime, setRenderTime] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');

  // Service
  const [serviceOnline, setServiceOnline] = useState(false);
  const [initLoading, setInitLoading] = useState(true);

  useEffect(() => {
    initializeService();
  }, []);

  const initializeService = async () => {
    try {
      const status = await window.electronAPI.mockupStatus();
      setServiceOnline(status.online);
      if (status.online) {
        await loadData();
      }
    } catch {
      setServiceOnline(false);
    }
    setInitLoading(false);
  };

  const loadData = async () => {
    try {
      const [templResult, galResult] = await Promise.all([
        window.electronAPI.mockupGetTemplates(),
        window.electronAPI.mockupApiCall('/galleries')
      ]);

      const templs = templResult?.data?.templates || [];
      setTemplates(templs);
      if (templs.length > 0) setSelectedTemplate(templs[0].id);

      const gals = galResult?.data?.galleries || [];
      setGalleries(gals);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  };

  // Load template thumbnail
  const loadTemplateThumbnail = useCallback(async (templateId) => {
    if (templateThumbnails[templateId]) return;
    try {
      const result = await window.electronAPI.mockupApiCall(`/templates/${templateId}/thumbnail`);
      if (result?.data && typeof result.data === 'string') {
        setTemplateThumbnails(prev => ({ ...prev, [templateId]: result.data }));
      }
    } catch (err) {
      console.error(`Failed to load template thumbnail for ${templateId}:`, err);
    }
  }, [templateThumbnails]);

  // Load photo thumbnail
  const loadPhotoThumbnail = useCallback(async (photoPath, filename) => {
    if (photoThumbnails[photoPath]) return;
    try {
      const result = await window.electronAPI.mockupApiCall(`/thumbnail?path=${encodeURIComponent(photoPath)}`);
      if (result?.data && typeof result.data === 'string') {
        setPhotoThumbnails(prev => ({ ...prev, [photoPath]: result.data }));
      }
    } catch (err) {
      console.error(`Failed to load thumbnail for ${filename}:`, err);
    }
  }, [photoThumbnails]);

  // Compute photo compatibility based on template green zone AR
  const computeCompatibility = useCallback((photosList, template) => {
    if (!template || !photosList.length) {
      setCompatiblePhotos([]);
      setIncompatiblePhotos(photosList);
      return;
    }

    // Get template green zone aspect ratio
    const templateAR = template.greenZoneAR || (template.dimensions?.width / template.dimensions?.height) || 1.5;
    const tolerance = 0.15; // ±15%
    const minAR = templateAR * (1 - tolerance);
    const maxAR = templateAR * (1 + tolerance);

    const compatible = [];
    const incompatible = [];

    photosList.forEach(photo => {
      const photoAR = photo.width / photo.height;
      if (photoAR >= minAR && photoAR <= maxAR) {
        compatible.push(photo);
      } else {
        incompatible.push(photo);
      }
    });

    setCompatiblePhotos(compatible);
    setIncompatiblePhotos(incompatible);
  }, []);

  const loadPhotos = async (galleryName) => {
    setSelectedGallery(galleryName);
    setPhotos([]);
    setCompatiblePhotos([]);
    setIncompatiblePhotos([]);
    setSelectedPhoto(null);
    try {
      const result = await window.electronAPI.mockupApiCall(`/galleries/${encodeURIComponent(galleryName)}`);
      const photosList = result?.data?.photos || [];
      setPhotos(photosList);

      // Compute compatibility with current template
      const currentTemplate = templates.find(t => t.id === selectedTemplate);
      computeCompatibility(photosList, currentTemplate);
    } catch (err) {
      console.error('Failed to load photos:', err);
    }
  };

  // Recompute compatibility when template changes
  useEffect(() => {
    if (photos.length > 0) {
      const currentTemplate = templates.find(t => t.id === selectedTemplate);
      computeCompatibility(photos, currentTemplate);
    }
    // Load template thumbnail
    if (selectedTemplate) {
      loadTemplateThumbnail(selectedTemplate);
    }
  }, [selectedTemplate, templates, photos, computeCompatibility, loadTemplateThumbnail]);

  const generatePreview = useCallback(async () => {
    if (!selectedTemplate || !selectedPhoto) return;
    setLoading(true);
    setPreviewUrl(null);
    setRenderTime(null);

    try {
      const config = {
        templateId: selectedTemplate,
        photoPath: selectedPhoto.path,
        printSize
      };
      if (platform) config.platform = platform;

      const result = await window.electronAPI.mockupPreview(config);

      if (result?.data && typeof result.data === 'string' && result.data.startsWith('data:')) {
        setPreviewUrl(result.data);
        setRenderTime(result.renderTimeMs);
      }
    } catch (err) {
      console.error('Preview failed:', err);
    }
    setLoading(false);
  }, [selectedTemplate, selectedPhoto, printSize, platform]);

  // Auto-generate when selections change
  useEffect(() => {
    if (selectedTemplate && selectedPhoto && serviceOnline) {
      generatePreview();
    }
  }, [selectedTemplate, selectedPhoto, printSize, platform, serviceOnline, generatePreview]);

  // Export preview to mockups folder (and optionally queue to Agent for social posting)
  const handleExport = async (exportPlatform = platform, queueToAgent = false) => {
    if (!selectedTemplate || !selectedPhoto || !previewUrl) {
      setExportStatus('error');
      setTimeout(() => setExportStatus(''), 2000);
      return;
    }

    setExporting(true);
    setExportStatus('');

    try {
      const config = {
        templateId: selectedTemplate,
        photoPath: selectedPhoto.path,
        printSize,
        platform: exportPlatform || '',
        queueToAgent
      };

      const result = await window.electronAPI.mockupApiCall('/mockups/save', {
        method: 'POST',
        body: JSON.stringify(config)
      });

      if (result?.data?.filename) {
        setExportStatus(queueToAgent && result?.data?.agentQueued ? 'queued' : 'success');
        setTimeout(() => setExportStatus(''), 3000);
      } else {
        setExportStatus('error');
        setTimeout(() => setExportStatus(''), 2000);
      }
    } catch (err) {
      console.error('Export failed:', err);
      setExportStatus('error');
      setTimeout(() => setExportStatus(''), 2000);
    }

    setExporting(false);
  };

  const currentTemplate = templates.find(t => t.id === selectedTemplate);

  if (initLoading) {
    return <div className="page-container"><p style={{ color: '#999' }}>Loading...</p></div>;
  }

  if (!serviceOnline) {
    return (
      <div className="page-container">
        <div className="page-header"><h2>Preview Lab</h2></div>
        <div style={{ background: '#2a2a2a', padding: '24px', borderRadius: '8px', marginTop: '16px' }}>
          <p style={{ color: '#ff6b6b', margin: '0 0 8px', fontWeight: 600 }}>Mockup Service Offline</p>
          <button onClick={async () => { await window.electronAPI.mockupStart(); initializeService(); }} style={btnPrimary}>
            Start Service
          </button>
        </div>
      </div>
    );
  }

  const photosToShow = showIncompatible ? [...compatiblePhotos, ...incompatiblePhotos] : compatiblePhotos;

  return (
    <div className="page-container" style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <h2>Preview Lab</h2>
        <p className="page-subtitle" style={{ color: '#999', margin: '4px 0 0', fontSize: '13px' }}>
          Select a photo and template to see a live mockup preview
        </p>
      </div>

      <div style={{ display: 'flex', gap: '12px', flex: 1, marginTop: '12px', minHeight: 0, overflow: 'hidden' }}>

        {/* LEFT: Gallery + Compatible Photo Grid */}
        <div style={{ width: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#1a1a1a', borderRadius: '8px', padding: '10px' }}>
          {/* Gallery selector */}
          <div>
            <label style={labelStyle}>Gallery</label>
            <select
              value={selectedGallery}
              onChange={e => loadPhotos(e.target.value)}
              style={selectStyle}
            >
              <option value="">Select Gallery...</option>
              {galleries.map(g => (
                <option key={g.name} value={g.name}>{g.name} ({g.photoCount})</option>
              ))}
            </select>
          </div>

          {/* Compatibility info */}
          {selectedGallery && (
            <div style={{ marginTop: '10px', padding: '8px', background: '#222', borderRadius: '4px' }}>
              <p style={{ color: '#4a9eff', fontSize: '12px', margin: '0', fontWeight: 500 }}>
                {compatiblePhotos.length} of {photos.length} compatible
              </p>
              {incompatiblePhotos.length > 0 && (
                <button
                  onClick={() => setShowIncompatible(!showIncompatible)}
                  style={{
                    marginTop: '6px', padding: '4px 8px', background: '#333', border: '1px solid #444',
                    borderRadius: '3px', color: '#999', cursor: 'pointer', fontSize: '11px',
                    width: '100%'
                  }}
                >
                  {showIncompatible ? '✓ Hide incompatible' : 'Show incompatible'}
                </button>
              )}
            </div>
          )}

          {/* Photo thumbnail grid */}
          <div style={{ flex: 1, overflowY: 'auto', marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', alignContent: 'start' }}>
            {selectedGallery && photos.length === 0 && (
              <p style={{ gridColumn: '1 / -1', color: '#666', fontSize: '12px', textAlign: 'center', padding: '16px' }}>
                Loading photos...
              </p>
            )}

            {/* Compatible photos */}
            {compatiblePhotos.map(photo => {
              const thumb = photoThumbnails[photo.path];
              if (!thumb) {
                loadPhotoThumbnail(photo.path, photo.filename);
              }
              return (
                <button
                  key={photo.filename}
                  onClick={() => setSelectedPhoto(photo)}
                  onMouseEnter={() => loadPhotoThumbnail(photo.path, photo.filename)}
                  style={{
                    padding: 0, border: selectedPhoto?.filename === photo.filename ? '2px solid #4a9eff' : '2px solid transparent',
                    background: selectedPhoto?.filename === photo.filename ? '#1a3a5c' : '#222',
                    borderRadius: '4px', cursor: 'pointer', overflow: 'hidden',
                    height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s'
                  }}
                  title={photo.filename}
                >
                  {thumb ? (
                    <img src={thumb} alt={photo.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: '20px' }}>📷</span>
                  )}
                </button>
              );
            })}

            {/* Incompatible photos (grayed out) */}
            {showIncompatible && incompatiblePhotos.map(photo => {
              const thumb = photoThumbnails[photo.path];
              if (!thumb) {
                loadPhotoThumbnail(photo.path, photo.filename);
              }
              return (
                <button
                  key={photo.filename}
                  onClick={() => setSelectedPhoto(photo)}
                  style={{
                    padding: 0, border: '2px solid #333',
                    background: '#222', borderRadius: '4px', cursor: 'not-allowed', overflow: 'hidden',
                    height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: 0.4
                  }}
                  disabled
                  title={`${photo.filename} — incompatible aspect ratio`}
                >
                  {thumb ? (
                    <img src={thumb} alt={photo.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: '20px' }}>📷</span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedGallery && photos.length > 0 && (
            <p style={{ color: '#555', fontSize: '11px', marginTop: '8px', textAlign: 'center' }}>
              {photosToShow.length} shown
            </p>
          )}
        </div>

        {/* CENTER: Preview Canvas */}
        <div style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: '#1a1a1a', borderRadius: '8px', position: 'relative', overflow: 'hidden'
        }}>
          {loading && (
            <div style={{ position: 'absolute', top: '12px', right: '12px', padding: '4px 10px', background: '#333', borderRadius: '4px', fontSize: '12px', color: '#4a9eff', zIndex: 1 }}>
              Compositing...
            </div>
          )}

          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Mockup preview"
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px' }}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <p style={{ fontSize: '48px', margin: '0 0 12px' }}>🖼️</p>
              <p style={{ color: '#555', fontSize: '14px' }}>
                {!selectedGallery ? 'Select a gallery to browse photos' :
                 !selectedPhoto ? 'Click a photo to preview it' :
                 'Generating preview...'}
              </p>
            </div>
          )}

          {renderTime && (
            <div style={{ position: 'absolute', bottom: '12px', left: '12px', padding: '4px 10px', background: '#222', borderRadius: '4px', fontSize: '11px', color: '#666' }}>
              {renderTime}ms
              {platform && <span> — {platform}</span>}
            </div>
          )}
        </div>

        {/* RIGHT: Template + Controls + Export */}
        <div style={{ width: '200px', flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', background: '#1a1a1a', borderRadius: '8px', padding: '10px' }}>
          {/* Template selector */}
          <div style={{ marginBottom: '10px' }}>
            <label style={labelStyle}>Template</label>
            <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} style={selectStyle}>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {currentTemplate && (
              <p style={{ color: '#666', fontSize: '10px', margin: '3px 0 0' }}>
                {currentTemplate.dimensions?.width}×{currentTemplate.dimensions?.height} — AR {currentTemplate.greenZoneAR?.toFixed(2) || '?'}
              </p>
            )}
          </div>

          {/* Room thumbnail preview */}
          {selectedTemplate && templateThumbnails[selectedTemplate] && (
            <div style={{ marginBottom: '10px', borderRadius: '6px', overflow: 'hidden', background: '#222', border: '1px solid #333' }}>
              <img
                src={templateThumbnails[selectedTemplate]}
                alt={currentTemplate?.name}
                style={{ width: '100%', height: 'auto', objectFit: 'contain' }}
              />
            </div>
          )}

          {/* Print size */}
          <div style={{ marginBottom: '10px' }}>
            <label style={labelStyle}>Print Size</label>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {(currentTemplate?.printSizes || ['16x24', '20x30', '24x36']).map(size => (
                <button
                  key={size}
                  onClick={() => setPrintSize(size)}
                  style={{
                    padding: '4px 10px', border: '1px solid',
                    borderColor: printSize === size ? '#4a9eff' : '#444',
                    background: printSize === size ? '#1a3a5c' : '#2a2a2a',
                    borderRadius: '3px', color: printSize === size ? '#fff' : '#999',
                    cursor: 'pointer', fontSize: '11px'
                  }}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          {/* Platform crop */}
          <div style={{ marginBottom: '10px' }}>
            <label style={labelStyle}>Platform Crop</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {[
                { id: '', label: 'Full (no crop)' },
                { id: 'etsy', label: 'Etsy — 1:1' },
                { id: 'pinterest', label: 'Pinterest — 2:3' },
                { id: 'instagram', label: 'Instagram — 4:5' }
              ].map(p => (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  style={{
                    padding: '5px 10px', border: '1px solid',
                    borderColor: platform === p.id ? '#4a9eff' : '#333',
                    background: platform === p.id ? '#1a3a5c' : '#2a2a2a',
                    borderRadius: '3px', color: platform === p.id ? '#fff' : '#999',
                    cursor: 'pointer', fontSize: '11px', textAlign: 'left'
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Export section */}
          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #333' }}>
            <label style={labelStyle}>Export</label>

            {/* Save + Queue to Agent (generates AI caption automatically) */}
            <button
              onClick={() => handleExport(platform || 'instagram', true)}
              disabled={!selectedPhoto || !selectedTemplate || loading || exporting}
              style={{
                ...btnPrimary,
                width: '100%',
                opacity: (!selectedPhoto || !selectedTemplate || loading || exporting) ? 0.5 : 1,
                marginBottom: '6px',
                background: exportStatus === 'queued' ? '#4a9e4a' : (exportStatus === 'error' ? '#ff6b6b' : '#e1306c')
              }}
            >
              {exporting ? 'Exporting...' : (exportStatus === 'queued' ? '✓ Queued!' : 'Queue to Agent')}
            </button>

            {/* Save only (no agent queue) */}
            <button
              onClick={() => handleExport()}
              disabled={!selectedPhoto || !selectedTemplate || loading || exporting}
              style={{
                ...btnPrimary,
                width: '100%',
                opacity: (!selectedPhoto || !selectedTemplate || loading || exporting) ? 0.5 : 1,
                marginBottom: '6px',
                background: exportStatus === 'success' ? '#4a9e4a' : (exportStatus === 'error' ? '#ff6b6b' : '#4a9eff')
              }}
            >
              {exportStatus === 'success' ? '✓ Saved!' : 'Save Only'}
            </button>

            {/* Platform-specific quick export + queue */}
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {['etsy', 'pinterest', 'instagram'].map(p => (
                <button
                  key={p}
                  onClick={() => handleExport(p, true)}
                  disabled={!selectedPhoto || !selectedTemplate || loading || exporting}
                  title={`Export for ${p} + queue to Agent`}
                  style={{
                    flex: '1 1 30%', padding: '5px 6px', border: '1px solid #333',
                    background: '#2a2a2a', borderRadius: '3px', color: '#999',
                    cursor: 'pointer', fontSize: '10px', opacity: (!selectedPhoto || !selectedTemplate) ? 0.5 : 1
                  }}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Selected photo info */}
          {selectedPhoto && (
            <div style={{ marginTop: '12px', padding: '10px', background: '#222', borderRadius: '6px', marginBottom: 0 }}>
              <label style={labelStyle}>Selected Photo</label>
              <p style={{ color: '#ccc', fontSize: '11px', margin: '0', wordBreak: 'break-all' }}>
                {selectedPhoto.filename}
              </p>
              <p style={{ color: '#666', fontSize: '10px', margin: '3px 0 0' }}>
                {selectedGallery}
              </p>
            </div>
          )}

          {/* Flexibility spacer for overflow */}
          <div style={{ flex: 1 }} />
        </div>
      </div>
    </div>
  );
}

const btnPrimary = {
  padding: '8px 14px', background: '#4a9eff', border: 'none',
  borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 500
};

const selectStyle = {
  width: '100%', padding: '8px', background: '#2a2a2a', border: '1px solid #3a3a3a',
  borderRadius: '4px', color: '#ccc', fontSize: '12px', cursor: 'pointer'
};

const labelStyle = {
  display: 'block', fontSize: '10px', color: '#777', textTransform: 'uppercase',
  letterSpacing: '0.5px', marginBottom: '6px', fontWeight: 600
};

export default MockupPreview;
