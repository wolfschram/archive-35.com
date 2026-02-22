import React, { useState, useEffect, useCallback } from 'react';

/**
 * MockupTemplates — Tab 1: Room Template Manager
 *
 * Manages room templates: grid view with details, placement zone visualization,
 * sample preview generation, and template metadata display.
 */

const CATEGORIES = ['living-room', 'bedroom', 'office', 'dining', 'gallery-wall', 'custom'];

function MockupTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [serviceOnline, setServiceOnline] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [samplePreview, setSamplePreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    checkService();
  }, []);

  const checkService = async () => {
    try {
      const status = await window.electronAPI.mockupStatus();
      setServiceOnline(status.online);
      if (status.online) {
        await loadTemplates();
      }
    } catch {
      setServiceOnline(false);
    }
    setLoading(false);
  };

  const startService = async () => {
    await window.electronAPI.mockupStart();
    await checkService();
  };

  const loadTemplates = async () => {
    try {
      const result = await window.electronAPI.mockupGetTemplates();
      if (result?.data?.templates) {
        setTemplates(result.data.templates);
      }
    } catch (err) {
      console.error('Failed to load templates:', err);
    }
  };

  const generateSamplePreview = async (template) => {
    setPreviewLoading(true);
    setSamplePreview(null);
    try {
      // Get a random photo from a gallery for the sample
      const galResult = await window.electronAPI.mockupApiCall('/galleries');
      const galleries = galResult?.data?.galleries || [];
      if (galleries.length === 0) return;

      // Pick a gallery with photos
      const gallery = galleries.find(g => g.photoCount > 0) || galleries[0];
      const photosResult = await window.electronAPI.mockupApiCall(`/galleries/${encodeURIComponent(gallery.name)}`);
      const photos = photosResult?.data?.photos || [];
      if (photos.length === 0) return;

      const samplePhoto = photos[Math.floor(Math.random() * photos.length)];

      const result = await window.electronAPI.mockupPreview({
        templateId: template.id,
        photoPath: samplePhoto.path,
        printSize: template.printSizes?.[Math.floor(template.printSizes.length / 2)] || '24x36'
      });

      if (result?.data && typeof result.data === 'string' && result.data.startsWith('data:')) {
        setSamplePreview(result.data);
      }
    } catch (err) {
      console.error('Failed to generate sample preview:', err);
    }
    setPreviewLoading(false);
  };

  if (loading) {
    return <div className="page-container"><p style={{ color: '#999' }}>Loading...</p></div>;
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>Room Templates</h2>
          <p className="page-subtitle" style={{ color: '#999', margin: '4px 0 0' }}>
            {serviceOnline
              ? `${templates.length} template${templates.length !== 1 ? 's' : ''} loaded`
              : 'Service offline'}
          </p>
        </div>
        {serviceOnline && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={loadTemplates}
              style={{ padding: '6px 14px', background: '#333', border: '1px solid #444', borderRadius: '4px', color: '#ccc', cursor: 'pointer', fontSize: '13px' }}
            >
              Refresh
            </button>
          </div>
        )}
      </div>

      {!serviceOnline ? (
        <div style={{ background: '#2a2a2a', padding: '24px', borderRadius: '8px', marginTop: '16px' }}>
          <p style={{ color: '#ff6b6b', margin: '0 0 8px', fontWeight: 600 }}>Mockup Service Offline</p>
          <p style={{ color: '#999', fontSize: '14px', margin: '0 0 12px' }}>
            The compositing service should auto-start with Studio. If it crashed, click below to restart.
          </p>
          <button onClick={startService} style={btnPrimary}>Start Service</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '24px', marginTop: '16px' }}>
          {/* Template Grid */}
          <div style={{ flex: 1 }}>
            {templates.length === 0 ? (
              <div style={{ background: '#2a2a2a', borderRadius: '8px', padding: '40px', textAlign: 'center' }}>
                <p style={{ fontSize: '36px', margin: '0 0 12px' }}>🏠</p>
                <p style={{ color: '#999' }}>No room templates yet.</p>
                <p style={{ color: '#666', fontSize: '13px' }}>Import room photos and define placement zones to get started.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                {templates.map(t => (
                  <div
                    key={t.id}
                    onClick={() => { setSelectedTemplate(t); setSamplePreview(null); }}
                    style={{
                      background: selectedTemplate?.id === t.id ? '#1a3a5c' : '#2a2a2a',
                      borderRadius: '8px',
                      padding: '16px',
                      border: selectedTemplate?.id === t.id ? '1px solid #4a9eff' : '1px solid #3a3a3a',
                      cursor: 'pointer',
                      transition: 'border-color 0.15s'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <h3 style={{ margin: '0 0 8px', fontSize: '15px', color: '#eee' }}>{t.name}</h3>
                      <span style={{
                        padding: '2px 8px', background: '#333', borderRadius: '10px',
                        fontSize: '11px', color: '#888', textTransform: 'capitalize'
                      }}>
                        {t.category?.replace('-', ' ')}
                      </span>
                    </div>
                    <p style={{ color: '#888', fontSize: '13px', margin: '0 0 4px' }}>
                      {t.dimensions?.width}×{t.dimensions?.height}px — {t.zoneCount} zone{t.zoneCount !== 1 ? 's' : ''}
                    </p>
                    <p style={{ color: '#777', fontSize: '12px', margin: 0 }}>
                      Sizes: {t.printSizes?.join(', ')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Detail Panel */}
          {selectedTemplate && (
            <div style={{ width: '340px', flexShrink: 0, background: '#2a2a2a', borderRadius: '8px', padding: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px' }}>{selectedTemplate.name}</h3>

              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Template ID</label>
                <p style={valueStyle}>{selectedTemplate.id}</p>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Category</label>
                <p style={valueStyle}>{selectedTemplate.category?.replace('-', ' ')}</p>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Dimensions</label>
                <p style={valueStyle}>{selectedTemplate.dimensions?.width}×{selectedTemplate.dimensions?.height}px</p>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Print Sizes</label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {selectedTemplate.printSizes?.map(s => (
                    <span key={s} style={{ padding: '2px 8px', background: '#333', borderRadius: '4px', fontSize: '12px', color: '#aaa' }}>{s}</span>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Wall Color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '20px', height: '20px', borderRadius: '4px', background: selectedTemplate.wallColor || '#ccc', border: '1px solid #555' }} />
                  <span style={valueStyle}>{selectedTemplate.wallColor || '—'}</span>
                </div>
              </div>

              {selectedTemplate.placementZones?.map((zone, i) => (
                <div key={i} style={{ marginBottom: '12px', padding: '10px', background: '#222', borderRadius: '6px' }}>
                  <label style={labelStyle}>Zone: {zone.id || `Zone ${i + 1}`}</label>
                  <p style={{ ...valueStyle, fontSize: '11px', fontFamily: 'monospace' }}>
                    TL: [{zone.corners?.topLeft?.join(', ')}] &nbsp;
                    TR: [{zone.corners?.topRight?.join(', ')}]<br />
                    BL: [{zone.corners?.bottomLeft?.join(', ')}] &nbsp;
                    BR: [{zone.corners?.bottomRight?.join(', ')}]
                  </p>
                  <p style={{ ...valueStyle, fontSize: '12px' }}>
                    Max: {zone.maxWidth}"×{zone.maxHeight}" — Light: {zone.lightAngle}° @ {zone.lightIntensity}
                  </p>
                </div>
              ))}

              <button
                onClick={() => generateSamplePreview(selectedTemplate)}
                disabled={previewLoading}
                style={{ ...btnPrimary, width: '100%', marginTop: '8px' }}
              >
                {previewLoading ? 'Generating...' : 'Generate Sample Preview'}
              </button>

              {samplePreview && (
                <div style={{ marginTop: '12px' }}>
                  <img src={samplePreview} alt="Sample mockup" style={{ width: '100%', borderRadius: '6px' }} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const btnPrimary = {
  padding: '8px 16px', background: '#4a9eff', border: 'none',
  borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 500
};
const labelStyle = { display: 'block', fontSize: '11px', color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' };
const valueStyle = { color: '#ccc', fontSize: '13px', margin: 0 };

export default MockupTemplates;
