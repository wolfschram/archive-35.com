import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

// Platform photo requirements
const PHOTO_COUNTS = { portrait: 8, square: 10, widescreen: 14 };

function Compositor() {
  const [step, setStep] = useState(1);
  const [galleries, setGalleries] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [platforms, setPlatforms] = useState({});
  const [config, setConfig] = useState(null);
  const [selectedGallery, setSelectedGallery] = useState(null);
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState([]);
  const [thumbnails, setThumbnails] = useState({});
  const [progress, setProgress] = useState(null);
  const [renderResults, setRenderResults] = useState(null);
  const [postContent, setPostContent] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;
    const c1 = window.electronAPI.onCompositeProgress((data) => {
      setProgress(prev => ({ ...prev, ...data, phase: 'compositing' }));
    });
    const c2 = window.electronAPI.onRenderProgress((data) => {
      setProgress(prev => ({ ...prev, renderTime: data.time, platform: data.platform, phase: 'rendering' }));
    });
    const c3 = window.electronAPI.onMultiRenderStatus((data) => {
      setProgress(prev => ({ ...prev, ...data }));
    });
    return () => { c1(); c2(); c3(); };
  }, []);

  async function loadData() {
    if (!window.electronAPI) return;
    const [galResult, tplResult, platDefs, cfg] = await Promise.all([
      window.electronAPI.scanGalleries(),
      window.electronAPI.scanTemplates(),
      window.electronAPI.getPlatforms(),
      window.electronAPI.getConfig(),
    ]);
    if (!galResult.error) setGalleries(galResult.galleries || []);
    if (!tplResult.error) setTemplates(tplResult.templates || []);
    setPlatforms(platDefs || {});
    setConfig(cfg);

    // Auto-select enabled platforms
    if (cfg?.platforms) {
      const enabled = Object.keys(cfg.platforms).filter(k => cfg.platforms[k]?.enabled);
      setSelectedPlatforms(enabled);
    }
  }

  async function pickGallery(gallery) {
    setSelectedGallery(gallery);
    setStep(2);
    const maxPhotos = Math.max(...Object.values(PHOTO_COUNTS));
    const shuffled = [...gallery.photos].sort(() => Math.random() - 0.5);
    setSelectedPhotos(shuffled.slice(0, Math.min(maxPhotos, shuffled.length)));

    // Load thumbnails
    for (const photo of gallery.photos.slice(0, 40)) {
      const thumb = await window.electronAPI.getPhotoThumbnail(photo.path);
      if (thumb) setThumbnails(prev => ({ ...prev, [photo.path]: thumb }));
    }
  }

  function togglePhoto(photo) {
    setSelectedPhotos(prev => {
      const exists = prev.find(p => p.path === photo.path);
      if (exists) return prev.filter(p => p.path !== photo.path);
      return [...prev, photo];
    });
  }

  function randomize() {
    if (!selectedGallery) return;
    const count = selectedPhotos.length || 14;
    const shuffled = [...selectedGallery.photos].sort(() => Math.random() - 0.5);
    setSelectedPhotos(shuffled.slice(0, count));
  }

  function togglePlatform(key) {
    setSelectedPlatforms(prev =>
      prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]
    );
  }

  async function previewPost() {
    if (!selectedGallery || !window.electronAPI) return;
    const content = await window.electronAPI.generateAllPostContent({ gallery: selectedGallery });
    setPostContent(content);
  }

  async function startRender() {
    if (!selectedGallery || selectedPhotos.length === 0 || selectedPlatforms.length === 0) return;
    setStep(4);
    setLoading(true);
    setRenderResults(null);
    setProgress({ percent: 0, phase: 'starting' });

    const result = await window.electronAPI.renderAllPlatforms({
      gallery: selectedGallery,
      photos: selectedPhotos,
      enabledPlatforms: selectedPlatforms,
    });

    setRenderResults(result);
    setLoading(false);
    setProgress({ percent: 100, phase: 'done' });

    // Add successful renders to queue
    if (result.results) {
      const queue = await window.electronAPI.getRenderQueue();
      const newItems = Object.entries(result.results)
        .filter(([_, r]) => r.success)
        .map(([platformKey, r]) => ({
          id: Date.now() + Math.random(),
          gallery: selectedGallery.name,
          platform: platformKey,
          platformLabel: platforms[platformKey]?.label || platformKey,
          photoCount: selectedPhotos.length,
          videoPath: r.outputPath,
          created: new Date().toISOString(),
          status: 'rendered',
        }));
      queue.queue = [...(queue.queue || []), ...newItems];
      await window.electronAPI.saveRenderQueue(queue);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h2>Compositor</h2>
        <p className="page-subtitle">
          {step === 1 && 'Step 1: Select a gallery'}
          {step === 2 && `Step 2: Pick photos from ${selectedGallery?.name}`}
          {step === 3 && 'Step 3: Choose platforms & render'}
          {step === 4 && 'Step 4: Rendering...'}
        </p>
      </header>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[1, 2, 3, 4].map(s => (
          <div key={s} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: s <= step ? 'var(--accent)' : 'var(--glass-border)',
            transition: 'all 0.3s ease'
          }} />
        ))}
      </div>

      {/* Step 1: Gallery selection */}
      {step === 1 && (
        <div className="gallery-grid">
          {galleries.length === 0 ? (
            <div className="empty-state">No galleries found. Configure Photography path in Settings.</div>
          ) : galleries.map(g => (
            <div key={g.name} className="gallery-card" onClick={() => pickGallery(g)}>
              <div className="gallery-thumb"><span>{g.hasMetadata ? '\u2605' : '\u{1F5BC}'}</span></div>
              <div className="gallery-info">
                <div className="gallery-name">{g.name.replace(/_/g, ' ')}</div>
                <div className="gallery-count">
                  {g.photoCount} photos
                  {g.metadata?.location && ` \u00B7 ${g.metadata.location}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Step 2: Photo selection */}
      {step === 2 && selectedGallery && (
        <div>
          <div className="glass-card full-width">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3>{selectedPhotos.length} photos selected</h3>
              <div className="button-group" style={{ margin: 0 }}>
                <button className="btn btn-secondary" onClick={randomize}>Shuffle</button>
                <button className="btn btn-secondary" onClick={() => { setStep(1); setSelectedGallery(null); setSelectedPhotos([]); }}>
                  \u2190 Back
                </button>
                <button className="btn btn-primary" onClick={() => { setStep(3); previewPost(); }} disabled={selectedPhotos.length < 8}>
                  Next: Platforms \u2192
                </button>
              </div>
            </div>

            <div className="info-box" style={{ marginBottom: 16 }}>
              Portrait: 8 photos \u00B7 Square: 10 photos \u00B7 Widescreen: 14 photos \u00B7 Last photo = hero
            </div>

            {selectedGallery.metadata && (
              <div className="info-box" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
                <strong>gallery.json:</strong> {selectedGallery.metadata.location || ''}
                {selectedGallery.metadata.description && ` \u2014 ${selectedGallery.metadata.description}`}
              </div>
            )}

            <div className="photo-select-grid">
              {selectedGallery.photos.map((photo, i) => (
                <div
                  key={i}
                  className={`photo-select-item ${selectedPhotos.find(p => p.path === photo.path) ? 'selected' : ''}`}
                  onClick={() => togglePhoto(photo)}
                >
                  {thumbnails[photo.path] ? (
                    <img src={thumbnails[photo.path]} alt={photo.filename} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 10 }}>
                      {photo.filename.substring(0, 10)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Platform selection & post preview */}
      {step === 3 && (
        <div className="card-grid">
          <div className="glass-card full-width">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3>Select Platforms ({selectedPlatforms.length})</h3>
              <div className="button-group" style={{ margin: 0 }}>
                <button className="btn btn-secondary" onClick={() => setStep(2)}>\u2190 Back</button>
                <button className="btn btn-secondary" onClick={() => {
                  const allKeys = Object.keys(platforms);
                  setSelectedPlatforms(prev => prev.length === allKeys.length ? [] : allKeys);
                }}>
                  {selectedPlatforms.length === Object.keys(platforms).length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {Object.entries(platforms).map(([key, platform]) => (
                <div
                  key={key}
                  className={`gallery-card ${selectedPlatforms.includes(key) ? 'selected' : ''}`}
                  onClick={() => togglePlatform(key)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="gallery-info" style={{ width: '100%' }}>
                    <div className="gallery-name">{platform.label}</div>
                    <div className="gallery-count">
                      {platform.width}\u00D7{platform.height} \u00B7 {platform.duration}s \u00B7 {platform.photoCount} photos
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {platform.supportsLinks ? 'Links supported' : 'No links (watermark URL)'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Post content preview */}
          {postContent && (
            <div className="glass-card full-width">
              <h3>Post Content Preview</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                {Object.entries(postContent)
                  .filter(([key]) => selectedPlatforms.includes(key))
                  .map(([key, content]) => (
                  <div key={key} className="glass-card" style={{ margin: 0 }}>
                    <h4 style={{ color: 'var(--accent)', fontSize: 13, marginBottom: 8 }}>{content.platformLabel}</h4>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', marginBottom: 8 }}>
                      {content.caption}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                      {content.hashtagString}
                    </p>
                    {content.link && (
                      <p style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4 }}>
                        {content.link}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Render button */}
          <div className="glass-card full-width">
            <button
              className="btn btn-primary btn-large"
              onClick={startRender}
              disabled={selectedPlatforms.length === 0}
              style={{ width: '100%' }}
            >
              Render {selectedPlatforms.length} Platform{selectedPlatforms.length !== 1 ? 's' : ''}: {selectedGallery?.name}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Rendering */}
      {step === 4 && (
        <div className="glass-card full-width">
          <h3>{progress?.phase === 'done' ? 'Render Complete' : 'Rendering...'}</h3>

          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress?.percent || 0}%` }} />
          </div>

          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
            {progress?.phase === 'compositing' && `Compositing frames for ${progress?.template || ''}... ${progress?.percent || 0}%`}
            {progress?.phase === 'rendering' && `Encoding ${progress?.platform || ''} video... ${progress?.renderTime || ''}`}
            {progress?.phase === 'starting' && 'Starting render pipeline...'}
            {progress?.phase === 'done' && 'All videos ready.'}
          </p>

          {renderResults?.error && (
            <div className="status-message error">{renderResults.error}</div>
          )}

          {renderResults?.results && (
            <div style={{ marginTop: 20 }}>
              <h4 style={{ marginBottom: 12 }}>Results</h4>
              <div className="queue-list">
                {Object.entries(renderResults.results).map(([key, result]) => (
                  <div key={key} className="queue-item">
                    <div className="queue-item-info" style={{ flex: 1 }}>
                      <div className="queue-item-title">{platforms[key]?.label || key}</div>
                      <div className="queue-item-meta">
                        {result.success
                          ? result.outputPath?.split('/').pop()
                          : result.error}
                      </div>
                    </div>
                    <span className={`status-badge ${result.success ? 'online' : 'error'}`}>
                      {result.success ? 'Done' : 'Failed'}
                    </span>
                    {result.success && result.outputPath && (
                      <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }}
                        onClick={() => window.electronAPI.openInFinder(result.outputPath)}>
                        Finder
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="button-group" style={{ marginTop: 20 }}>
                <button className="btn btn-primary" onClick={() => {
                  setStep(1); setSelectedGallery(null); setSelectedPhotos([]);
                  setRenderResults(null); setProgress(null); setPostContent(null);
                }}>
                  New Video
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Compositor;
