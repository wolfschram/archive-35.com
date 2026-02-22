import React, { useState, useEffect, useCallback } from 'react';

/**
 * MockupPreview — Tab 2: Live Preview Lab
 *
 * Three-panel layout: gallery/photo browser (left), live mockup preview (center),
 * template + print size controls (right). Generates composited previews via the
 * mockup service on port 8036.
 */
function MockupPreview() {
  // Data
  const [galleries, setGalleries] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [templates, setTemplates] = useState([]);

  // Selections
  const [selectedGallery, setSelectedGallery] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [printSize, setPrintSize] = useState('24x36');
  const [platform, setPlatform] = useState('');

  // Preview
  const [previewUrl, setPreviewUrl] = useState(null);
  const [renderTime, setRenderTime] = useState(null);
  const [loading, setLoading] = useState(false);

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

  const loadPhotos = async (galleryName) => {
    setSelectedGallery(galleryName);
    setPhotos([]);
    setSelectedPhoto(null);
    try {
      const result = await window.electronAPI.mockupApiCall(`/galleries/${encodeURIComponent(galleryName)}`);
      setPhotos(result?.data?.photos || []);
    } catch (err) {
      console.error('Failed to load photos:', err);
    }
  };

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
  }, [selectedTemplate, selectedPhoto, printSize, platform]);

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

  return (
    <div className="page-container" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <h2>Preview Lab</h2>
        <p className="page-subtitle" style={{ color: '#999', margin: '4px 0 0', fontSize: '13px' }}>
          Select a photo and template to see a live mockup preview
        </p>
      </div>

      <div style={{ display: 'flex', gap: '16px', flex: 1, marginTop: '12px', minHeight: 0, overflow: 'hidden' }}>

        {/* LEFT: Gallery + Photo Browser */}
        <div style={{ width: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Gallery selector */}
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

          {/* Photo list */}
          <div style={{ flex: 1, overflowY: 'auto', marginTop: '8px', background: '#222', borderRadius: '6px' }}>
            {photos.length === 0 && selectedGallery && (
              <p style={{ color: '#666', fontSize: '12px', textAlign: 'center', padding: '16px' }}>Loading photos...</p>
            )}
            {photos.map(photo => (
              <button
                key={photo.filename}
                onClick={() => setSelectedPhoto(photo)}
                style={{
                  display: 'block', width: '100%', padding: '8px 10px', border: 'none',
                  background: selectedPhoto?.filename === photo.filename ? '#1a3a5c' : 'transparent',
                  color: selectedPhoto?.filename === photo.filename ? '#fff' : '#aaa',
                  textAlign: 'left', cursor: 'pointer', fontSize: '12px',
                  borderBottom: '1px solid #2a2a2a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                }}
                title={photo.filename}
              >
                {photo.filename}
                <span style={{ display: 'block', fontSize: '10px', color: '#666' }}>{photo.sizeMB} MB</span>
              </button>
            ))}
          </div>

          <p style={{ color: '#555', fontSize: '11px', marginTop: '6px', textAlign: 'center' }}>
            {photos.length} photo{photos.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* CENTER: Preview Canvas */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
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

        {/* RIGHT: Controls */}
        <div style={{ width: '220px', flexShrink: 0, overflowY: 'auto' }}>
          {/* Template selector */}
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Template</label>
            <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} style={selectStyle}>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {currentTemplate && (
              <p style={{ color: '#666', fontSize: '11px', margin: '4px 0 0' }}>
                {currentTemplate.dimensions?.width}×{currentTemplate.dimensions?.height} — {currentTemplate.zoneCount} zone
              </p>
            )}
          </div>

          {/* Print size */}
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Print Size</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {(currentTemplate?.printSizes || ['16x24', '20x30', '24x36']).map(size => (
                <button
                  key={size}
                  onClick={() => setPrintSize(size)}
                  style={{
                    padding: '4px 10px', border: '1px solid',
                    borderColor: printSize === size ? '#4a9eff' : '#444',
                    background: printSize === size ? '#1a3a5c' : '#2a2a2a',
                    borderRadius: '4px', color: printSize === size ? '#fff' : '#999',
                    cursor: 'pointer', fontSize: '12px'
                  }}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          {/* Platform preview */}
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Platform Crop</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {[
                { id: '', label: 'Full (no crop)' },
                { id: 'etsy', label: 'Etsy — 1:1 square' },
                { id: 'pinterest', label: 'Pinterest — 2:3' },
                { id: 'web-full', label: 'Web — 2000px' },
                { id: 'web-thumb', label: 'Web — 400px thumb' }
              ].map(p => (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  style={{
                    padding: '6px 10px', border: '1px solid',
                    borderColor: platform === p.id ? '#4a9eff' : '#333',
                    background: platform === p.id ? '#1a3a5c' : '#2a2a2a',
                    borderRadius: '4px', color: platform === p.id ? '#fff' : '#999',
                    cursor: 'pointer', fontSize: '12px', textAlign: 'left'
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Regenerate */}
          <button
            onClick={generatePreview}
            disabled={!selectedPhoto || !selectedTemplate || loading}
            style={{ ...btnPrimary, width: '100%', opacity: (!selectedPhoto || loading) ? 0.5 : 1 }}
          >
            {loading ? 'Rendering...' : 'Regenerate'}
          </button>

          {/* Photo info */}
          {selectedPhoto && (
            <div style={{ marginTop: '16px', padding: '10px', background: '#222', borderRadius: '6px' }}>
              <label style={labelStyle}>Selected Photo</label>
              <p style={{ color: '#ccc', fontSize: '12px', margin: '0', wordBreak: 'break-all' }}>
                {selectedPhoto.filename}
              </p>
              <p style={{ color: '#666', fontSize: '11px', margin: '4px 0 0' }}>
                {selectedPhoto.sizeMB} MB — {selectedGallery}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const btnPrimary = {
  padding: '8px 16px', background: '#4a9eff', border: 'none',
  borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 500
};
const selectStyle = {
  width: '100%', padding: '8px', background: '#2a2a2a', border: '1px solid #3a3a3a',
  borderRadius: '4px', color: '#ccc', fontSize: '13px'
};
const labelStyle = {
  display: 'block', fontSize: '11px', color: '#777', textTransform: 'uppercase',
  letterSpacing: '0.5px', marginBottom: '6px'
};

export default MockupPreview;
