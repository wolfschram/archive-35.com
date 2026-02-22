import React, { useState, useEffect } from 'react';

/**
 * MockupPreview — Tab 2: Live Preview Lab
 *
 * Real-time mockup preview: select a photo, template, and print size,
 * see the composited result immediately.
 *
 * Phase 4 will add: PixiJS canvas, side-by-side comparison, frame styles.
 */
function MockupPreview() {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [photoPath, setPhotoPath] = useState('');
  const [printSize, setPrintSize] = useState('24x36');
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [renderTime, setRenderTime] = useState(null);
  const [serviceOnline, setServiceOnline] = useState(false);

  useEffect(() => {
    checkServiceAndLoad();
  }, []);

  const checkServiceAndLoad = async () => {
    try {
      const status = await window.electronAPI.mockupStatus();
      setServiceOnline(status.online);
      if (status.online) {
        const result = await window.electronAPI.mockupGetTemplates();
        if (result?.data?.templates) {
          setTemplates(result.data.templates);
          if (result.data.templates.length > 0) {
            setSelectedTemplate(result.data.templates[0].id);
          }
        }
      }
    } catch {
      setServiceOnline(false);
    }
  };

  const generatePreview = async () => {
    if (!selectedTemplate || !photoPath) return;
    setLoading(true);
    setPreviewUrl(null);

    try {
      const result = await window.electronAPI.mockupPreview({
        templateId: selectedTemplate,
        photoPath: photoPath,
        printSize: printSize
      });

      if (result?.data && typeof result.data === 'string' && result.data.startsWith('data:')) {
        setPreviewUrl(result.data);
        setRenderTime(result.renderTimeMs);
      }
    } catch (err) {
      console.error('Preview failed:', err);
    }
    setLoading(false);
  };

  if (!serviceOnline) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h2>Preview Lab</h2>
        </div>
        <p style={{ color: '#ff6b6b', marginTop: '16px' }}>Mockup service offline.</p>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>Preview Lab</h2>
        <p className="page-subtitle">
          Generate mockup previews — select photo, template, and print size
        </p>
      </div>

      <div style={{ display: 'flex', gap: '24px', marginTop: '16px' }}>
        {/* Controls */}
        <div style={{ width: '300px', flexShrink: 0 }}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: '#999' }}>Template</label>
            <select
              value={selectedTemplate}
              onChange={e => setSelectedTemplate(e.target.value)}
              style={{ width: '100%', padding: '8px', background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: '4px', color: '#fff' }}
            >
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: '#999' }}>Photo Path (relative to repo)</label>
            <input
              type="text"
              value={photoPath}
              onChange={e => setPhotoPath(e.target.value)}
              placeholder="photography/Iceland/WOLF2901-Pano.jpg"
              style={{ width: '100%', padding: '8px', background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: '4px', color: '#fff' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: '#999' }}>Print Size</label>
            <select
              value={printSize}
              onChange={e => setPrintSize(e.target.value)}
              style={{ width: '100%', padding: '8px', background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: '4px', color: '#fff' }}
            >
              <option value="16x24">16x24</option>
              <option value="20x30">20x30</option>
              <option value="24x36">24x36</option>
            </select>
          </div>

          <button
            onClick={generatePreview}
            disabled={loading || !selectedTemplate || !photoPath}
            style={{
              width: '100%', padding: '12px', background: '#4a9eff',
              border: 'none', borderRadius: '4px', color: '#fff',
              cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1
            }}
          >
            {loading ? 'Generating...' : 'Generate Preview'}
          </button>

          {renderTime && (
            <p style={{ color: '#666', fontSize: '12px', marginTop: '8px' }}>
              Rendered in {renderTime}ms
            </p>
          )}
        </div>

        {/* Preview Area */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px', background: '#1a1a1a', borderRadius: '8px' }}>
          {previewUrl ? (
            <img src={previewUrl} alt="Mockup preview" style={{ maxWidth: '100%', maxHeight: '600px', borderRadius: '4px' }} />
          ) : (
            <p style={{ color: '#555' }}>
              {loading ? 'Compositing...' : 'Select a photo and click Generate'}
            </p>
          )}
        </div>
      </div>

      <p style={{ color: '#666', fontSize: '13px', marginTop: '24px' }}>
        Full PixiJS real-time canvas with photo browser and side-by-side comparison coming in Phase 4.
      </p>
    </div>
  );
}

export default MockupPreview;
