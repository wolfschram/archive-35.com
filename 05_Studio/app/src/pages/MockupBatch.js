import React, { useState, useEffect, useRef } from 'react';

/**
 * MockupBatch — Tab 3: Batch Compositing Queue
 *
 * Multi-select photos and templates, choose target platforms,
 * start batch jobs, monitor progress with real-time updates.
 */
function MockupBatch() {
  // Data
  const [galleries, setGalleries] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [photoThumbnails, setPhotoThumbnails] = useState({});
  const [templateThumbnails, setTemplateThumbnails] = useState({});

  // Selections
  const [selectedGallery, setSelectedGallery] = useState('');
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [selectedTemplates, setSelectedTemplates] = useState(new Set());
  const [selectedPlatforms, setSelectedPlatforms] = useState(new Set(['etsy', 'pinterest', 'web-full']));
  const [printSize, setPrintSize] = useState('24x36');

  // Jobs
  const [activeJob, setActiveJob] = useState(null);
  const [jobHistory, setJobHistory] = useState([]);
  const pollRef = useRef(null);

  // Service
  const [serviceOnline, setServiceOnline] = useState(false);
  const [initLoading, setInitLoading] = useState(true);

  useEffect(() => {
    initializeService();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const initializeService = async () => {
    try {
      const status = await window.electronAPI.mockupStatus();
      setServiceOnline(status.online);
      if (status.online) await loadData();
    } catch { setServiceOnline(false); }
    setInitLoading(false);
  };

  const loadData = async () => {
    try {
      const [templResult, galResult, jobsResult] = await Promise.all([
        window.electronAPI.mockupGetTemplates(),
        window.electronAPI.mockupApiCall('/galleries'),
        window.electronAPI.mockupApiCall('/composite/jobs')
      ]);
      setTemplates(templResult?.data?.templates || []);
      setGalleries(galResult?.data?.galleries || []);
      setJobHistory(jobsResult?.data?.jobs || []);

      // Load template thumbnails
      const templates_data = templResult?.data?.templates || [];
      const thumbs = {};
      for (const t of templates_data) {
        try {
          const result = await window.electronAPI.mockupApiCall(`/templates/${t.id}/thumbnail?size=150`);
          if (result?.data) {
            thumbs[t.id] = result.data;
          }
        } catch (err) {
          console.error(`Failed to load template thumbnail for ${t.id}:`, err);
        }
      }
      setTemplateThumbnails(thumbs);
    } catch (err) { console.error('Failed to load data:', err); }
  };

  const loadPhotos = async (galleryName) => {
    setSelectedGallery(galleryName);
    setSelectedPhotos(new Set());
    setPhotoThumbnails({});
    try {
      const result = await window.electronAPI.mockupApiCall(`/galleries/${encodeURIComponent(galleryName)}`);
      const photos_data = result?.data?.photos || [];
      setPhotos(photos_data);

      // Load photo thumbnails
      const thumbs = {};
      for (const p of photos_data) {
        try {
          const thumbResult = await window.electronAPI.mockupApiCall(`/thumbnail?path=${encodeURIComponent(p.path)}&size=120`);
          if (thumbResult?.data) {
            thumbs[p.path] = thumbResult.data;
          }
        } catch (err) {
          console.error(`Failed to load photo thumbnail for ${p.path}:`, err);
        }
      }
      setPhotoThumbnails(thumbs);
    } catch { setPhotos([]); }
  };

  const togglePhoto = (photo) => {
    setSelectedPhotos(prev => {
      const next = new Set(prev);
      next.has(photo.path) ? next.delete(photo.path) : next.add(photo.path);
      return next;
    });
  };

  const selectAllPhotos = () => {
    setSelectedPhotos(new Set(photos.map(p => p.path)));
  };

  const toggleTemplate = (id) => {
    setSelectedTemplates(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const togglePlatform = (id) => {
    setSelectedPlatforms(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const [queueToAgent, setQueueToAgent] = useState(true); // Default ON — queue to agent for posting
  const totalImages = selectedPhotos.size * selectedTemplates.size * selectedPlatforms.size;

  const startBatch = async () => {
    if (totalImages === 0) return;
    try {
      const result = await window.electronAPI.mockupApiCall('/composite/batch', {
        method: 'POST',
        body: {
          photoPaths: Array.from(selectedPhotos),
          templateIds: Array.from(selectedTemplates),
          platforms: Array.from(selectedPlatforms),
          printSize,
          queueToAgent
        }
      });
      const job = result?.data;
      if (job?.jobId) {
        setActiveJob(job);
        startPolling(job.jobId);
      }
    } catch (err) {
      console.error('Failed to start batch:', err);
    }
  };

  const startPolling = (jobId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const result = await window.electronAPI.mockupApiCall(`/composite/status/${jobId}`);
        const status = result?.data;
        if (status) {
          setActiveJob(status);
          if (status.status !== 'running') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            // Refresh job history
            const jobsResult = await window.electronAPI.mockupApiCall('/composite/jobs');
            setJobHistory(jobsResult?.data?.jobs || []);
          }
        }
      } catch { /* ignore polling errors */ }
    }, 1000);
  };

  const cancelBatch = async () => {
    if (!activeJob?.jobId) return;
    await window.electronAPI.mockupApiCall(`/composite/cancel/${activeJob.jobId}`, { method: 'POST' });
  };

  if (initLoading) return <div className="page-container"><p style={{ color: '#999' }}>Loading...</p></div>;

  if (!serviceOnline) {
    return (
      <div className="page-container">
        <div className="page-header"><h2>Batch Queue</h2></div>
        <div style={{ background: '#2a2a2a', padding: '24px', borderRadius: '8px', marginTop: '16px' }}>
          <p style={{ color: '#ff6b6b', fontWeight: 600 }}>Mockup Service Offline</p>
          <button onClick={async () => { await window.electronAPI.mockupStart(); initializeService(); }} style={btnPrimary}>Start Service</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>Batch Queue</h2>
        <p className="page-subtitle" style={{ color: '#999', margin: '4px 0 0', fontSize: '13px' }}>
          Generate mockup images in bulk for Pinterest, Etsy, and Website
        </p>
      </div>

      {/* Active Job Progress */}
      {activeJob && activeJob.status === 'running' && (
        <div style={{ background: '#1a3a5c', padding: '16px', borderRadius: '8px', marginTop: '12px', border: '1px solid #2a5a8c' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ color: '#4a9eff', fontWeight: 600, fontSize: '14px' }}>
              Batch Running — {activeJob.completed}/{activeJob.totalImages}
            </span>
            <button onClick={cancelBatch} style={{ padding: '4px 12px', background: '#ff4444', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px' }}>
              Cancel
            </button>
          </div>
          <div style={{ background: '#0a1a2c', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${activeJob.progress}%`, background: '#4a9eff', borderRadius: '4px', transition: 'width 0.3s' }} />
          </div>
          <p style={{ color: '#6aa', fontSize: '11px', margin: '6px 0 0' }}>
            {activeJob.progress}% — {activeJob.failed > 0 ? `${activeJob.failed} failed` : 'no errors'}
          </p>
        </div>
      )}

      {activeJob && activeJob.status === 'completed' && (
        <div style={{ background: '#1a3a2c', padding: '12px 16px', borderRadius: '8px', marginTop: '12px', border: '1px solid #2a6a4c' }}>
          <span style={{ color: '#5cb85c', fontWeight: 600 }}>
            Batch Complete — {activeJob.completed - activeJob.failed} images generated
          </span>
          {activeJob.failed > 0 && <span style={{ color: '#ff6b6b', marginLeft: '12px' }}>({activeJob.failed} failed)</span>}
          <span style={{ color: '#666', marginLeft: '12px', fontSize: '12px' }}>
            {(activeJob.durationMs / 1000).toFixed(1)}s
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>

        {/* Photos Column */}
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Photos</label>
          <select value={selectedGallery} onChange={e => loadPhotos(e.target.value)} style={{ ...selectStyle, marginBottom: '8px' }}>
            <option value="">Select Gallery...</option>
            {galleries.map(g => <option key={g.name} value={g.name}>{g.name} ({g.photoCount})</option>)}
          </select>

          {photos.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <button onClick={selectAllPhotos} style={btnSmall}>Select All ({photos.length})</button>
              <button onClick={() => setSelectedPhotos(new Set())} style={btnSmall}>Clear</button>
            </div>
          )}

          <div style={{ maxHeight: '400px', overflowY: 'auto', background: '#222', borderRadius: '6px', padding: '8px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {photos.map(photo => (
                <div
                  key={photo.path}
                  onClick={() => togglePhoto(photo)}
                  style={{
                    position: 'relative',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    border: selectedPhotos.has(photo.path) ? '2px solid #4a9eff' : '1px solid #333',
                    background: '#1a1a1a',
                    aspectRatio: '1/1'
                  }}
                >
                  {photoThumbnails[photo.path] ? (
                    <img
                      src={photoThumbnails[photo.path]}
                      alt={photo.filename}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: '#666', fontSize: '10px' }}>Loading...</span>
                    </div>
                  )}
                  <input
                    type="checkbox"
                    checked={selectedPhotos.has(photo.path)}
                    onChange={() => togglePhoto(photo)}
                    style={{
                      position: 'absolute',
                      top: '4px',
                      left: '4px',
                      accentColor: '#4a9eff',
                      cursor: 'pointer'
                    }}
                    onClick={e => e.stopPropagation()}
                  />
                </div>
              ))}
            </div>
          </div>
          <p style={{ color: '#4a9eff', fontSize: '12px', marginTop: '8px', fontWeight: 500 }}>
            {selectedPhotos.size} selected
          </p>
        </div>

        {/* Templates + Platforms Column */}
        <div style={{ width: '340px', flexShrink: 0 }}>
          <label style={labelStyle}>Templates</label>
          <div style={{ marginBottom: '16px', maxHeight: '300px', overflowY: 'auto' }}>
            {templates.map(t => (
              <div
                key={t.id}
                onClick={() => toggleTemplate(t.id)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '8px',
                  cursor: 'pointer', background: selectedTemplates.has(t.id) ? '#1a3a5c' : '#2a2a2a',
                  borderRadius: '4px', marginBottom: '8px', border: '1px solid',
                  borderColor: selectedTemplates.has(t.id) ? '#4a9eff' : '#333',
                  transition: 'all 0.15s'
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedTemplates.has(t.id)}
                  onChange={() => toggleTemplate(t.id)}
                  style={{ accentColor: '#4a9eff', marginTop: '2px', flexShrink: 0 }}
                  onClick={e => e.stopPropagation()}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    {templateThumbnails[t.id] ? (
                      <img
                        src={templateThumbnails[t.id]}
                        alt={t.name}
                        style={{
                          width: '60px',
                          height: '60px',
                          objectFit: 'cover',
                          borderRadius: '3px',
                          flexShrink: 0
                        }}
                      />
                    ) : (
                      <div style={{
                        width: '60px',
                        height: '60px',
                        background: '#333',
                        borderRadius: '3px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <span style={{ color: '#666', fontSize: '9px' }}>No img</span>
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ color: selectedTemplates.has(t.id) ? '#fff' : '#aaa', fontSize: '12px', margin: '0 0 4px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.name}
                      </p>
                      <p style={{ color: '#666', fontSize: '10px', margin: 0 }}>
                        {t.zoneAr && `AR ${t.zoneAr}`}
                      </p>
                      {t.category && <p style={{ color: '#555', fontSize: '10px', margin: '2px 0 0' }}>{t.category}</p>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <label style={labelStyle}>Platforms</label>
          <div style={{ marginBottom: '16px' }}>
            {[
              { id: 'etsy', label: 'Etsy (2000×2000 1:1)' },
              { id: 'pinterest', label: 'Pinterest (1000×1500 2:3)' },
              { id: 'web-full', label: 'Website Full (2000px)' },
              { id: 'web-thumb', label: 'Website Thumb (400px)' }
            ].map(p => (
              <label
                key={p.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px',
                  cursor: 'pointer', background: selectedPlatforms.has(p.id) ? '#1a3a5c' : '#2a2a2a',
                  borderRadius: '4px', marginBottom: '4px', border: '1px solid',
                  borderColor: selectedPlatforms.has(p.id) ? '#4a9eff' : '#333'
                }}
              >
                <input type="checkbox" checked={selectedPlatforms.has(p.id)} onChange={() => togglePlatform(p.id)} style={{ accentColor: '#4a9eff' }} />
                <span style={{ color: selectedPlatforms.has(p.id) ? '#fff' : '#aaa', fontSize: '12px' }}>{p.label}</span>
              </label>
            ))}
          </div>

          <label style={labelStyle}>Print Size</label>
          <select value={printSize} onChange={e => setPrintSize(e.target.value)} style={{ ...selectStyle, marginBottom: '16px' }}>
            <option value="16x24">16×24</option>
            <option value="20x30">20×30</option>
            <option value="24x36">24×36</option>
          </select>

          {/* Summary + Start */}
          <div style={{ background: '#222', padding: '12px', borderRadius: '6px', marginBottom: '12px' }}>
            <p style={{ color: '#ccc', fontSize: '12px', margin: '0 0 4px' }}>
              {selectedPhotos.size} photo{selectedPhotos.size !== 1 ? 's' : ''} × {selectedTemplates.size} template{selectedTemplates.size !== 1 ? 's' : ''} × {selectedPlatforms.size} platform{selectedPlatforms.size !== 1 ? 's' : ''}
            </p>
            <p style={{ color: '#4a9eff', fontSize: '18px', fontWeight: 700, margin: 0 }}>
              = {totalImages} image{totalImages !== 1 ? 's' : ''}
            </p>
          </div>

          <button
            onClick={() => setQueueToAgent(!queueToAgent)}
            style={{
              width: '100%', padding: '8px 12px', marginBottom: '8px',
              background: queueToAgent ? 'rgba(225, 48, 108, 0.15)' : '#222',
              border: `1px solid ${queueToAgent ? '#e1306c' : '#444'}`,
              borderRadius: '4px', color: queueToAgent ? '#e1306c' : '#666',
              cursor: 'pointer', fontSize: '12px', textAlign: 'left'
            }}
          >
            {queueToAgent ? '✓ Queue to Agent (AI captions + social posting)' : '○ Save files only (no agent queue)'}
          </button>
          <button
            onClick={startBatch}
            disabled={totalImages === 0 || (activeJob?.status === 'running')}
            style={{ ...btnPrimary, width: '100%', padding: '10px', fontSize: '14px', opacity: totalImages === 0 ? 0.4 : 1 }}
          >
            {activeJob?.status === 'running' ? 'Batch Running...' : `Start Batch (${totalImages} images)`}
          </button>
        </div>
      </div>

      {/* Job History */}
      {jobHistory.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <label style={labelStyle}>Job History</label>
          <div style={{ background: '#222', borderRadius: '6px', overflow: 'hidden' }}>
            {jobHistory.map(job => (
              <div key={job.jobId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #2a2a2a' }}>
                <div>
                  <span style={{ color: '#ccc', fontSize: '13px' }}>{job.jobId}</span>
                  <span style={{ marginLeft: '10px', fontSize: '11px', color: '#666' }}>
                    {job.totalImages} images — {(job.durationMs / 1000).toFixed(1)}s
                  </span>
                </div>
                <span style={{
                  padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                  background: job.status === 'completed' ? '#1a3a2c' : job.status === 'running' ? '#1a3a5c' : '#3a2a2a',
                  color: job.status === 'completed' ? '#5cb85c' : job.status === 'running' ? '#4a9eff' : '#ff6b6b'
                }}>
                  {job.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const btnPrimary = { padding: '8px 16px', background: '#4a9eff', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 500 };
const btnSmall = { padding: '4px 10px', background: '#333', border: '1px solid #444', borderRadius: '4px', color: '#aaa', cursor: 'pointer', fontSize: '11px' };
const selectStyle = { width: '100%', padding: '8px', background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: '4px', color: '#ccc', fontSize: '13px' };
const labelStyle = { display: 'block', fontSize: '11px', color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', fontWeight: 600 };

export default MockupBatch;
