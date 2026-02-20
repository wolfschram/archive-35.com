import React, { useState, useEffect, useCallback } from 'react';
import useAgentApi from '../hooks/useAgentApi';

/**
 * AgentCompose — Create and publish custom posts for any platform.
 *
 * Flow: Pick photo → Choose platform → Write/generate caption → Preview → Publish
 */
function AgentCompose() {
  const { get, post, loading, error, setError } = useAgentApi();

  // Photo selection
  const [collections, setCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [photos, setPhotos] = useState([]);
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  // Post composition
  const [platform, setPlatform] = useState('instagram');
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState('');
  const [title, setTitle] = useState(''); // Etsy only
  const [generating, setGenerating] = useState(false);

  // Publishing
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState(null);

  // Step tracking
  const [step, setStep] = useState(1); // 1=pick photo, 2=compose, 3=preview

  // Load collections on mount
  useEffect(() => {
    const loadCollections = async () => {
      try {
        const data = await get('/photos/collections/list');
        // API returns [{name, count}] objects
        const cols = (data.collections || []).map(c => typeof c === 'string' ? c : c.name).filter(Boolean);
        setCollections(cols);
      } catch { /* hook shows error */ }
    };
    loadCollections();
  }, []);

  // Load photos when collection changes
  useEffect(() => {
    if (!selectedCollection) {
      setPhotos([]);
      return;
    }
    const loadPhotos = async () => {
      try {
        const data = await get(`/photos?collection=${encodeURIComponent(selectedCollection)}&limit=200`);
        setPhotos(data.items || data.photos || []);
      } catch { /* hook shows error */ }
    };
    loadPhotos();
  }, [selectedCollection]);

  const handlePhotoSelect = useCallback((photo) => {
    setSelectedPhoto(photo);
    setStep(2);
    setCaption('');
    setTags('');
    setTitle('');
    setPublishResult(null);
  }, []);

  const handleGenerateCaption = async () => {
    if (!selectedPhoto) return;
    setGenerating(true);
    try {
      const data = await post('/content/generate-draft', {
        photo_id: selectedPhoto.id,
        platform: platform,
      });
      if (data.body) setCaption(data.body);
      if (data.tags) setTags(Array.isArray(data.tags) ? data.tags.join(', ') : data.tags);
      if (data.title) setTitle(data.title);
    } catch (err) {
      setError?.(err.message || 'Failed to generate caption');
    } finally {
      setGenerating(false);
    }
  };

  const handlePublish = async () => {
    if (!selectedPhoto || !caption.trim()) return;
    setPublishing(true);
    setPublishResult(null);
    try {
      // Build the image URL from the photo's filename and collection
      const collection = (selectedPhoto.collection || '').toLowerCase();
      const filename = selectedPhoto.filename || '';
      // Get base name without extension, add -full suffix
      const baseName = filename.replace(/\.[^.]+$/, '');
      const imageUrl = `https://archive-35.com/images/${collection}/${baseName}-full.jpg`;

      // Build full caption with tags
      let fullCaption = caption.trim();
      if (tags.trim()) {
        const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
        const hashTags = tagList.map(t => t.startsWith('#') ? t : `#${t.replace(/\s+/g, '')}`);
        fullCaption += '\n\n' + hashTags.join(' ');
      }

      if (platform === 'instagram') {
        const result = await post('/instagram/publish', {
          image_url: imageUrl,
          caption: fullCaption,
          photo_id: selectedPhoto.id,
        });
        setPublishResult(result);
      } else {
        // For Pinterest/Etsy — store as approved content for now
        const result = await post('/content/create-manual', {
          photo_id: selectedPhoto.id,
          platform: platform,
          body: fullCaption,
          title: title || '',
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        });
        setPublishResult({ success: true, message: `Saved to ${platform} queue`, ...result });
      }
      setStep(3);
    } catch (err) {
      setPublishResult({ success: false, error: err.message || 'Publish failed' });
    } finally {
      setPublishing(false);
    }
  };

  const platformConfig = {
    instagram: { label: 'Instagram', icon: '📷', color: '#e1306c', bg: 'rgba(225, 48, 108, 0.12)' },
    pinterest: { label: 'Pinterest', icon: '📌', color: '#e60023', bg: 'rgba(230, 0, 35, 0.12)' },
    etsy: { label: 'Etsy', icon: '🏷️', color: '#f1641e', bg: 'rgba(241, 100, 30, 0.12)' },
  };

  const pc = platformConfig[platform] || platformConfig.instagram;

  // Get EXIF info for selected photo
  const getExifSummary = () => {
    if (!selectedPhoto?.exif_json) return null;
    try {
      const exif = JSON.parse(selectedPhoto.exif_json);
      const parts = [];
      if (exif.Model) parts.push(exif.Model);
      if (exif.LensModel) parts.push(exif.LensModel);
      if (exif.DateTimeOriginal) {
        const d = exif.DateTimeOriginal.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
        parts.push(d);
      }
      if (exif.ISOSpeedRatings) parts.push(`ISO ${exif.ISOSpeedRatings}`);
      if (exif.FocalLength) parts.push(`${exif.FocalLength}mm`);
      return parts.join(' · ');
    } catch { return null; }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h2>Compose Post</h2>
        <p className="page-subtitle">
          Create custom posts for Instagram, Pinterest, or Etsy
        </p>
      </header>

      {/* Step indicator */}
      <div style={{
        display: 'flex', gap: '8px', marginBottom: '24px', alignItems: 'center',
      }}>
        {[
          { n: 1, label: 'Select Photo' },
          { n: 2, label: 'Compose' },
          { n: 3, label: 'Published' },
        ].map(({ n, label }) => (
          <React.Fragment key={n}>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                cursor: n < step ? 'pointer' : 'default',
                opacity: step >= n ? 1 : 0.4,
              }}
              onClick={() => n < step && setStep(n)}
            >
              <span style={{
                width: '24px', height: '24px', borderRadius: '50%',
                background: step >= n ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                color: step >= n ? '#fff' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '12px', fontWeight: 600,
              }}>
                {step > n ? '\u2713' : n}
              </span>
              <span style={{
                fontSize: '13px',
                color: step >= n ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: step === n ? 600 : 400,
              }}>
                {label}
              </span>
            </div>
            {n < 3 && <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>→</span>}
          </React.Fragment>
        ))}
      </div>

      {/* Error Banner */}
      {error && (
        <div style={{
          padding: '12px 16px', marginBottom: '16px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '8px', color: '#ef4444', fontSize: '13px',
        }}>
          {error}
        </div>
      )}

      {/* STEP 1: Photo Selection */}
      {step === 1 && (
        <div>
          {/* Collection picker */}
          <div className="glass-card" style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{
                fontSize: '11px', color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.1em',
              }}>
                Collection
              </span>
              <select
                value={selectedCollection}
                onChange={(e) => setSelectedCollection(e.target.value)}
                style={{
                  padding: '6px 12px', fontSize: '13px',
                  background: 'var(--bg-primary)', color: 'var(--text-primary)',
                  border: '1px solid var(--glass-border)', borderRadius: '6px',
                  minWidth: '200px',
                }}
              >
                <option value="">Choose a collection...</option>
                {collections.map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {photos.length > 0 ? `${photos.length} photos` : ''}
              </span>
            </div>
          </div>

          {/* Photo grid */}
          {photos.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: '8px',
            }}>
              {photos.map(photo => (
                <div
                  key={photo.id}
                  onClick={() => handlePhotoSelect(photo)}
                  style={{
                    cursor: 'pointer',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    border: selectedPhoto?.id === photo.id
                      ? '2px solid var(--accent)'
                      : '2px solid transparent',
                    transition: 'border-color 0.2s, transform 0.2s',
                    aspectRatio: '1',
                    background: 'rgba(255,255,255,0.03)',
                  }}
                  onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.03)'}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                  <img
                    src={`http://127.0.0.1:8035/photos/${photo.id}/thumbnail?size=200`}
                    alt={photo.filename}
                    loading="lazy"
                    style={{
                      width: '100%', height: '100%',
                      objectFit: 'cover',
                    }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.parentElement.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:11px;padding:8px;text-align:center">${photo.filename}</div>`;
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          {selectedCollection && photos.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
              No photos in this collection
            </div>
          )}
        </div>
      )}

      {/* STEP 2: Compose */}
      {step === 2 && selectedPhoto && (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '24px' }}>
          {/* Left: Photo preview + metadata */}
          <div>
            <div className="glass-card" style={{ padding: '8px' }}>
              <img
                src={`http://127.0.0.1:8035/photos/${selectedPhoto.id}/thumbnail?size=400`}
                alt={selectedPhoto.filename}
                style={{
                  width: '100%', borderRadius: '6px',
                  objectFit: 'contain', maxHeight: '300px',
                }}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
              <div style={{ padding: '8px 4px 4px' }}>
                <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                  {selectedPhoto.filename}
                </div>
                {selectedPhoto.collection && (
                  <div style={{
                    display: 'inline-block', marginTop: '4px',
                    fontSize: '10px', padding: '2px 8px',
                    background: 'rgba(212, 165, 116, 0.15)',
                    color: 'var(--accent)', borderRadius: '10px',
                  }}>
                    {selectedPhoto.collection.replace(/_/g, ' ')}
                  </div>
                )}
                {getExifSummary() && (
                  <div style={{
                    marginTop: '8px', fontSize: '11px',
                    color: 'var(--text-muted)', lineHeight: 1.5,
                  }}>
                    {getExifSummary()}
                  </div>
                )}
              </div>
            </div>

            <button
              className="btn btn-secondary"
              style={{ width: '100%', marginTop: '8px', fontSize: '12px' }}
              onClick={() => { setStep(1); setSelectedPhoto(null); }}
            >
              ← Change Photo
            </button>
          </div>

          {/* Right: Compose form */}
          <div>
            {/* Platform selector */}
            <div className="glass-card" style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                {Object.entries(platformConfig).map(([key, cfg]) => (
                  <button
                    key={key}
                    className={`btn ${platform === key ? 'btn-primary' : 'btn-secondary'}`}
                    style={{
                      padding: '8px 16px', fontSize: '13px',
                      background: platform === key ? cfg.bg : undefined,
                      color: platform === key ? cfg.color : undefined,
                      borderColor: platform === key ? cfg.color : undefined,
                    }}
                    onClick={() => setPlatform(key)}
                  >
                    {cfg.icon} {cfg.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Caption input */}
            <div className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '14px' }}>
                  {platform === 'etsy' ? 'Listing Description' : 'Caption'}
                </h3>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '4px 12px', fontSize: '11px' }}
                  onClick={handleGenerateCaption}
                  disabled={generating || loading}
                >
                  {generating ? 'Generating...' : '✨ AI Generate'}
                </button>
              </div>

              {/* Etsy title field */}
              {platform === 'etsy' && (
                <input
                  type="text"
                  placeholder="Listing title..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px', fontSize: '14px',
                    background: 'var(--bg-primary)', color: 'var(--text-primary)',
                    border: '1px solid var(--glass-border)', borderRadius: '6px',
                    marginBottom: '12px', boxSizing: 'border-box',
                  }}
                />
              )}

              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder={`Write your ${pc.label} ${platform === 'etsy' ? 'description' : 'caption'}...`}
                rows={8}
                style={{
                  width: '100%', padding: '12px', fontSize: '14px',
                  background: 'var(--bg-primary)', color: 'var(--text-primary)',
                  border: '1px solid var(--glass-border)', borderRadius: '6px',
                  resize: 'vertical', fontFamily: 'inherit',
                  lineHeight: 1.6, boxSizing: 'border-box',
                }}
              />

              <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)', textAlign: 'right' }}>
                {caption.length} characters
                {platform === 'instagram' && caption.length > 2200 && (
                  <span style={{ color: '#ef4444', marginLeft: '8px' }}>
                    (max 2,200)
                  </span>
                )}
              </div>

              {/* Tags */}
              <div style={{ marginTop: '12px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Tags / Hashtags (comma-separated)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder={platform === 'etsy' ? 'tag1, tag2, tag3 (max 13)' : '#photography, #fineart, #landscape'}
                  style={{
                    width: '100%', padding: '8px 12px', fontSize: '13px',
                    background: 'var(--bg-primary)', color: 'var(--text-primary)',
                    border: '1px solid var(--glass-border)', borderRadius: '6px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Publish button */}
              <div style={{ marginTop: '20px', display: 'flex', gap: '12px' }}>
                <button
                  className="btn btn-primary"
                  style={{
                    padding: '10px 24px', fontSize: '14px',
                    background: pc.color, borderColor: pc.color,
                    opacity: (!caption.trim() || publishing) ? 0.5 : 1,
                  }}
                  onClick={handlePublish}
                  disabled={!caption.trim() || publishing}
                >
                  {publishing
                    ? 'Publishing...'
                    : platform === 'instagram'
                      ? `${pc.icon} Publish to Instagram`
                      : `${pc.icon} Save to ${pc.label} Queue`
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: Published */}
      {step === 3 && publishResult && (
        <div className="glass-card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          {publishResult.success ? (
            <>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>
                {platform === 'instagram' ? '🎉' : '✅'}
              </div>
              <h3 style={{ color: 'var(--success, #22c55e)', marginBottom: '8px' }}>
                {platform === 'instagram' ? 'Published to Instagram!' : `Saved to ${platformConfig[platform]?.label} Queue`}
              </h3>
              {publishResult.media_id && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                  Media ID: {publishResult.media_id}
                </div>
              )}
              {publishResult.permalink && (
                <a
                  href={publishResult.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.preventDefault();
                    if (window.electronAPI?.openExternal) {
                      window.electronAPI.openExternal(publishResult.permalink);
                    } else {
                      window.open(publishResult.permalink, '_blank');
                    }
                  }}
                  style={{
                    display: 'inline-block',
                    padding: '8px 20px',
                    background: pc.bg,
                    color: pc.color,
                    borderRadius: '8px',
                    textDecoration: 'none',
                    fontSize: '13px',
                    marginBottom: '24px',
                  }}
                >
                  View on {platformConfig[platform]?.label} →
                </a>
              )}
              <div>
                <button
                  className="btn btn-primary"
                  style={{ marginRight: '12px' }}
                  onClick={() => {
                    setStep(1);
                    setSelectedPhoto(null);
                    setCaption('');
                    setTags('');
                    setTitle('');
                    setPublishResult(null);
                  }}
                >
                  Create Another Post
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>❌</div>
              <h3 style={{ color: 'var(--danger, #ef4444)', marginBottom: '8px' }}>
                Publish Failed
              </h3>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '24px' }}>
                {publishResult.error || 'Unknown error'}
              </div>
              <button
                className="btn btn-primary"
                onClick={() => setStep(2)}
              >
                ← Back to Edit
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default AgentCompose;
