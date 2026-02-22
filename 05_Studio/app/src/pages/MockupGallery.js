import React, { useState, useEffect } from 'react';

/**
 * MockupGallery — Tab 4: Generated Mockups Browser
 *
 * Filterable grid of all generated mockup images with metadata,
 * status indicators, and platform labels. Reads from mockups/ directory.
 */
function MockupGallery() {
  const [mockups, setMockups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [serviceOnline, setServiceOnline] = useState(false);

  // Filters
  const [filterGallery, setFilterGallery] = useState('');
  const [filterPlatform, setFilterPlatform] = useState('');
  const [galleries, setGalleries] = useState([]);

  // Preview
  const [selectedMockup, setSelectedMockup] = useState(null);

  useEffect(() => {
    initializeService();
  }, []);

  const initializeService = async () => {
    try {
      const status = await window.electronAPI.mockupStatus();
      setServiceOnline(status.online);
      if (status.online) await loadData();
    } catch { setServiceOnline(false); }
    setLoading(false);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      let url = '/mockups';
      const params = [];
      if (filterGallery) params.push(`gallery=${encodeURIComponent(filterGallery)}`);
      if (filterPlatform) params.push(`platform=${encodeURIComponent(filterPlatform)}`);
      if (params.length) url += '?' + params.join('&');

      const [mockResult, galResult] = await Promise.all([
        window.electronAPI.mockupApiCall(url),
        window.electronAPI.mockupApiCall('/galleries')
      ]);

      setMockups(mockResult?.data?.mockups || []);
      setGalleries(galResult?.data?.galleries || []);
    } catch (err) {
      console.error('Failed to load mockups:', err);
    }
    setLoading(false);
  };

  // Reload when filters change
  useEffect(() => {
    if (serviceOnline) loadData();
  }, [filterGallery, filterPlatform]);

  const platformColors = {
    'etsy': { bg: '#2a3a1a', color: '#89b356', label: 'Etsy' },
    'pinterest': { bg: '#3a1a1a', color: '#e06060', label: 'Pinterest' },
    'web-full': { bg: '#1a2a3a', color: '#5599cc', label: 'Web Full' },
    'web-thumb': { bg: '#2a2a3a', color: '#8888cc', label: 'Web Thumb' },
    'unknown': { bg: '#2a2a2a', color: '#888', label: 'Unknown' }
  };

  const uniqueGalleries = [...new Set(mockups.map(m => m.gallery))].sort();
  const uniquePlatforms = [...new Set(mockups.map(m => m.platform))].sort();

  if (!serviceOnline && !loading) {
    return (
      <div className="page-container">
        <div className="page-header"><h2>Mockup Gallery</h2></div>
        <div style={{ background: '#2a2a2a', padding: '24px', borderRadius: '8px', marginTop: '16px' }}>
          <p style={{ color: '#ff6b6b', fontWeight: 600 }}>Mockup Service Offline</p>
          <button onClick={async () => { await window.electronAPI.mockupStart(); initializeService(); }} style={btnPrimary}>Start Service</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>Mockup Gallery</h2>
          <p className="page-subtitle" style={{ color: '#999', margin: '4px 0 0', fontSize: '13px' }}>
            {loading ? 'Loading...' : `${mockups.length} generated mockup${mockups.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button onClick={loadData} style={{ padding: '6px 14px', background: '#333', border: '1px solid #444', borderRadius: '4px', color: '#ccc', cursor: 'pointer', fontSize: '13px' }}>
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
        <div>
          <label style={labelStyle}>Gallery</label>
          <select value={filterGallery} onChange={e => setFilterGallery(e.target.value)} style={selectStyle}>
            <option value="">All Galleries</option>
            {uniqueGalleries.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Platform</label>
          <select value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)} style={selectStyle}>
            <option value="">All Platforms</option>
            {uniquePlatforms.map(p => <option key={p} value={p}>{platformColors[p]?.label || p}</option>)}
          </select>
        </div>
      </div>

      {/* Mockup Grid */}
      {mockups.length === 0 && !loading ? (
        <div style={{ background: '#2a2a2a', borderRadius: '8px', padding: '40px', textAlign: 'center', marginTop: '16px', border: '1px dashed #3a3a3a' }}>
          <p style={{ fontSize: '48px', margin: '0 0 12px' }}>📸</p>
          <h3 style={{ margin: '0 0 8px', color: '#ccc' }}>No mockups generated yet</h3>
          <p style={{ color: '#888', maxWidth: '400px', margin: '0 auto' }}>
            Go to the Batch tab to generate mockup images from your photos and templates.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '16px', marginTop: '16px' }}>
          {/* Grid */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
              {mockups.map((m, i) => {
                const pColor = platformColors[m.platform] || platformColors.unknown;
                return (
                  <div
                    key={i}
                    onClick={() => setSelectedMockup(m)}
                    style={{
                      background: selectedMockup === m ? '#1a3a5c' : '#2a2a2a',
                      borderRadius: '6px', padding: '10px', cursor: 'pointer',
                      border: selectedMockup === m ? '1px solid #4a9eff' : '1px solid #333',
                      transition: 'border-color 0.15s'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <span style={{ color: '#ccc', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {m.photoSlug}
                      </span>
                      <span style={{
                        padding: '1px 6px', borderRadius: '8px', fontSize: '10px', fontWeight: 600,
                        background: pColor.bg, color: pColor.color, flexShrink: 0, marginLeft: '6px'
                      }}>
                        {pColor.label}
                      </span>
                    </div>
                    <p style={{ color: '#777', fontSize: '11px', margin: 0 }}>
                      {m.gallery} — {(m.sizeBytes / 1024).toFixed(0)} KB
                    </p>
                    <p style={{ color: '#555', fontSize: '10px', margin: '2px 0 0' }}>
                      {new Date(m.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detail Panel */}
          {selectedMockup && (
            <div style={{ width: '300px', flexShrink: 0, background: '#2a2a2a', borderRadius: '8px', padding: '16px' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: '14px', color: '#eee' }}>
                {selectedMockup.filename}
              </h3>

              <div style={{ marginBottom: '10px' }}>
                <label style={labelStyle}>Gallery</label>
                <p style={valueStyle}>{selectedMockup.gallery}</p>
              </div>

              <div style={{ marginBottom: '10px' }}>
                <label style={labelStyle}>Photo</label>
                <p style={valueStyle}>{selectedMockup.photoSlug}</p>
              </div>

              <div style={{ marginBottom: '10px' }}>
                <label style={labelStyle}>Platform</label>
                <p style={valueStyle}>{platformColors[selectedMockup.platform]?.label || selectedMockup.platform}</p>
              </div>

              <div style={{ marginBottom: '10px' }}>
                <label style={labelStyle}>File Size</label>
                <p style={valueStyle}>{(selectedMockup.sizeBytes / 1024).toFixed(0)} KB</p>
              </div>

              <div style={{ marginBottom: '10px' }}>
                <label style={labelStyle}>Created</label>
                <p style={valueStyle}>{new Date(selectedMockup.createdAt).toLocaleString()}</p>
              </div>

              <div style={{ marginBottom: '10px' }}>
                <label style={labelStyle}>Path</label>
                <p style={{ ...valueStyle, fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {selectedMockup.path}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const btnPrimary = { padding: '8px 16px', background: '#4a9eff', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 500 };
const selectStyle = { padding: '6px 10px', background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: '4px', color: '#ccc', fontSize: '13px', minWidth: '150px' };
const labelStyle = { display: 'block', fontSize: '11px', color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' };
const valueStyle = { color: '#ccc', fontSize: '13px', margin: 0 };

export default MockupGallery;
