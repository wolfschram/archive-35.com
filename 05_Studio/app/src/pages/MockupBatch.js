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
    } catch (err) { console.error('Failed to load data:', err); }
  };

  const loadPhotos = async (galleryName) => {
    setSelectedGallery(galleryName);
    setSelectedPhotos(new Set());
    try {
      const result = await window.electronAPI.mockupApiCall(`/galleries/${encodeURIComponent(galleryName)}`);
      setPhotos(result?.data?.photos || []);
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
          printSize
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

          <div style={{ maxHeight: '300px', overflowY: 'auto', background: '#222', borderRadius: '6px' }}>
            {photos.map(photo => (
              <label
                key={photo.filename}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px',
                  cursor: 'pointer', borderBottom: '1px solid #2a2a2a',
                  background: selectedPhotos.has(photo.path) ? '#1a3a5c' : 'transparent'
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedPhotos.has(photo.path)}
                  onChange={() => togglePhoto(photo)}
                  style={{ accentColor: '#4a9eff' }}
                />
                <span style={{ color: selectedPhotos.has(photo.path) ? '#fff' : '#aaa', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {photo.filename}
                </span>
              </label>
            ))}
          </div>
          <p style={{ color: '#4a9eff', fontSize: '12px', marginTop: '4px' }}>{selectedPhotos.size} selected</p>
        </div>

        {/* Templates + Platforms Column */}
        <div style={{ width: '260px', flexShrink: 0 }}>
          <label style={labelStyle}>Templates</label>
          <div style={{ marginBottom: '16px' }}>
            {templates.map(t => (
              <label
                key={t.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px',
                  cursor: 'pointer', background: selectedTemplates.has(t.id) ? '#1a3a5c' : '#2a2a2a',
                  borderRadius: '4px', marginBottom: '4px', border: '1px solid',
                  borderColor: selectedTemplates.has(t.id) ? '#4a9eff' : '#333'
                }}
              >
                <input type="checkbox" checked={selectedTemplates.has(t.id)} onChange={() => toggleTemplate(t.id)} style={{ accentColor: '#4a9eff' }} />
                <span style={{ color: selectedTemplates.has(t.id) ? '#fff' : '#aaa', fontSize: '13px' }}>{t.name}</span>
              </label>
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
            <p style={{ color: '#ccc', fontSize: '13px', margin: '0 0 4px' }}>
              {selectedPhotos.size} photo{selectedPhotos.size !== 1 ? 's' : ''} × {selectedTemplates.size} template{selectedTemplates.size !== 1 ? 's' : ''} × {selectedPlatforms.size} platform{selectedPlatforms.size !== 1 ? 's' : ''}
            </p>
            <p style={{ color: '#4a9eff', fontSize: '18px', fontWeight: 700, margin: 0 }}>
              = {totalImages} image{totalImages !== 1 ? 's' : ''}
            </p>
          </div>

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
const labelStyle = { display: 'block', fontSize: '11px', color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' };

export default MockupBatch;
