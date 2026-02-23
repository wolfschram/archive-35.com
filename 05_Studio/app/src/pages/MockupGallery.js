import React, { useState, useEffect } from 'react';

/**
 * MockupGallery — Tab 4: Generated Mockups Browser
 *
 * Filterable grid of all generated mockup images with metadata,
 * status indicators, and platform labels. Reads from mockups/ directory.
 * Each card shows thumbnail preview with details below.
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
  const [thumbnails, setThumbnails] = useState({});
  const [detailImage, setDetailImage] = useState(null);

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
    setThumbnails({});
    setDetailImage(null);
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

      const mockups_data = mockResult?.data?.mockups || [];
      setMockups(mockups_data);
      setGalleries(galResult?.data?.galleries || []);

      // Load thumbnails for all mockups
      const thumbs = {};
      for (const m of mockups_data) {
        try {
          const result = await window.electronAPI.mockupApiCall(`/thumbnail?path=${encodeURIComponent(m.path)}&size=300`);
          if (result?.data) {
            thumbs[m.path] = result.data;
          }
        } catch (err) {
          console.error(`Failed to load mockup thumbnail for ${m.path}:`, err);
        }
      }
      setThumbnails(thumbs);
    } catch (err) {
      console.error('Failed to load mockups:', err);
    }
    setLoading(false);
  };

  // Reload when filters change
  useEffect(() => {
    if (serviceOnline) loadData();
  }, [filterGallery, filterPlatform]);

  // Load detail image when mockup is selected
  useEffect(() => {
    if (selectedMockup && !detailImage) {
      const loadDetailImage = async () => {
        try {
          const result = await window.electronAPI.mockupApiCall(`/thumbnail?path=${encodeURIComponent(selectedMockup.path)}&size=600`);
          if (result?.data) {
            setDetailImage(result.data);
          }
        } catch (err) {
          console.error('Failed to load detail image:', err);
        }
      };
      loadDetailImage();
    } else if (!selectedMockup) {
      setDetailImage(null);
    }
  }, [selectedMockup, detailImage]);

  const platformColors = {
    'etsy': { bg: '#2a3a1a', color: '#89b356', label: 'Etsy' },
    'pinterest': { bg: '#3a1a1a', color: '#e06060', label: 'Pinterest' },
    'web-full': { bg: '#1a2a3a', color: '#5599cc', label: 'Web Full' },
    'web-thumb': { bg: '#2a2a3a', color: '#8888cc', label: 'Web Thumb' },
    'unknown': { bg: '#2a2a2a', color: '#888', label: 'Unknown' }
  };

  const uniqueGalleries = [...new Set(mockups.map(m => m.gallery))].sort();
  const uniquePlatforms = [...new Set(mockups.map(m => m.platform))].sort();

  const openInFinder = (mockup) => {
    if (window.electronAPI?.openInFinder) {
      window.electronAPI.openInFinder(mockup.path);
    }
  };

  const sendToAgentQueue = async (mockup) => {
    try {
      await window.electronAPI.mockupApiCall('/agent/queue', {
        method: 'POST',
        body: { mockupPath: mockup.path }
      });
      console.log('Sent to Agent queue:', mockup.path);
    } catch (err) {
      console.error('Failed to send to Agent queue:', err);
    }
  };

  const exportForPlatform = async (mockup, platform) => {
    try {
      await window.electronAPI.mockupApiCall(`/mockups/export/${encodeURIComponent(mockup.filename)}/${platform}`, {
        method: 'POST'
      });
      console.log(`Exported ${mockup.filename} for ${platform}`);
    } catch (err) {
      console.error(`Failed to export for ${platform}:`, err);
    }
  };

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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
              {mockups.map((m, i) => {
                const pColor = platformColors[m.platform] || platformColors.unknown;
                return (
                  <div
                    key={i}
                    onClick={() => setSelectedMockup(m)}
                    style={{
                      background: selectedMockup === m ? '#1a3a5c' : '#2a2a2a',
                      borderRadius: '8px', overflow: 'hidden', cursor: 'pointer',
                      border: selectedMockup === m ? '2px solid #4a9eff' : '1px solid #333',
                      transition: 'all 0.15s'
                    }}
                  >
                    <div style={{
                      height: '200px',
                      background: '#1a1a1a',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden'
                    }}>
                      {thumbnails[m.path] ? (
                        <img
                          src={thumbnails[m.path]}
                          alt={m.filename}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <span style={{ color: '#666', fontSize: '12px' }}>Loading...</span>
                      )}
                    </div>

                    <div style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px', marginBottom: '6px' }}>
                        <span style={{ color: '#ccc', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontWeight: 500 }}>
                          {m.photoSlug}
                        </span>
                        <span style={{
                          padding: '2px 6px', borderRadius: '6px', fontSize: '10px', fontWeight: 600,
                          background: pColor.bg, color: pColor.color, flexShrink: 0, whiteSpace: 'nowrap'
                        }}>
                          {pColor.label}
                        </span>
                      </div>
                      <p style={{ color: '#777', fontSize: '11px', margin: '0 0 4px' }}>
                        {m.gallery}
                      </p>
                      <p style={{ color: '#666', fontSize: '10px', margin: 0 }}>
                        {(m.sizeBytes / 1024).toFixed(0)} KB — {new Date(m.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detail Panel */}
          {selectedMockup && (
            <div style={{ width: '340px', flexShrink: 0, background: '#2a2a2a', borderRadius: '8px', padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {/* Image Preview */}
              <div style={{
                height: '280px',
                background: '#1a1a1a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderBottom: '1px solid #333'
              }}>
                {detailImage ? (
                  <img
                    src={detailImage}
                    alt={selectedMockup.filename}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <span style={{ color: '#666' }}>Loading preview...</span>
                )}
              </div>

              {/* Metadata */}
              <div style={{ padding: '16px', flex: 1, overflow: 'auto' }}>
                <h3 style={{ margin: '0 0 12px', fontSize: '13px', color: '#eee', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

                <div style={{ marginBottom: '16px' }}>
                  <label style={labelStyle}>Path</label>
                  <p style={{ ...valueStyle, fontSize: '10px', fontFamily: 'monospace', wordBreak: 'break-all', maxHeight: '60px', overflowY: 'auto' }}>
                    {selectedMockup.path}
                  </p>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button
                    onClick={() => openInFinder(selectedMockup)}
                    style={{
                      padding: '8px 12px',
                      background: '#333',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#aaa',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 500,
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={e => { e.target.style.background = '#3a3a3a'; e.target.style.color = '#ccc'; }}
                    onMouseLeave={e => { e.target.style.background = '#333'; e.target.style.color = '#aaa'; }}
                  >
                    Open in Finder
                  </button>

                  <button
                    onClick={() => sendToAgentQueue(selectedMockup)}
                    style={{
                      padding: '8px 12px',
                      background: '#2a3a5c',
                      border: '1px solid #3a5a8c',
                      borderRadius: '4px',
                      color: '#7ab8ff',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 500,
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={e => { e.target.style.background = '#3a4a6c'; e.target.style.color = '#9acfff'; }}
                    onMouseLeave={e => { e.target.style.background = '#2a3a5c'; e.target.style.color = '#7ab8ff'; }}
                  >
                    Send to Agent Queue
                  </button>

                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        exportForPlatform(selectedMockup, e.target.value);
                        e.target.value = '';
                      }
                    }}
                    style={{
                      padding: '8px 12px',
                      background: '#333',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#aaa',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    <option value="">Export for Platform...</option>
                    <option value="etsy">Export for Etsy</option>
                    <option value="pinterest">Export for Pinterest</option>
                    <option value="web-full">Export for Web Full</option>
                    <option value="web-thumb">Export for Web Thumb</option>
                  </select>
                </div>
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
const labelStyle = { display: 'block', fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px', fontWeight: 600 };
const valueStyle = { color: '#ddd', fontSize: '12px', margin: 0 };

export default MockupGallery;
