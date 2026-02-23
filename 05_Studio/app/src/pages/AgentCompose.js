import React, { useState, useEffect, useCallback, useMemo } from 'react';
import useAgentApi from '../hooks/useAgentApi';

/**
 * AgentCompose — Central content creation hub.
 *
 * Flow:
 *   1. Select Images (mockups from gallery, original photos, or both)
 *   2. Compose (write/generate captions, choose platforms)
 *   3. Preview (see how it looks on each platform)
 *   4. Publish (manual copy OR API post)
 *
 * Sources:
 *   - Mockup Gallery (mockups/social/ — pre-rendered room mockups)
 *   - Original Photos (Agent DB — imported photography)
 */

const AGENT_BASE = 'http://127.0.0.1:8035';

const PLATFORMS = {
  instagram: { label: 'Instagram', icon: '📷', color: '#e1306c', bg: 'rgba(225, 48, 108, 0.12)' },
  pinterest: { label: 'Pinterest', icon: '📌', color: '#e60023', bg: 'rgba(230, 0, 35, 0.12)' },
  etsy:      { label: 'Etsy',      icon: '🏷️', color: '#f1641e', bg: 'rgba(241, 100, 30, 0.12)' },
};

function AgentCompose() {
  const { get, post, loading, error, setError } = useAgentApi();

  // ── Source tab ──
  const [sourceTab, setSourceTab] = useState('mockups'); // 'mockups' | 'photos'

  // ── Mockups ──
  const [mockups, setMockups] = useState([]);
  const [mockupFilter, setMockupFilter] = useState('');

  // ── Photos ──
  const [collections, setCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [photos, setPhotos] = useState([]);

  // ── Selected images (can be multiple) ──
  const [selectedImages, setSelectedImages] = useState([]);
  // Each: { type: 'mockup'|'photo', src, thumb, filename, platforms?, photoId? }

  // ── Composition ──
  const [targetPlatforms, setTargetPlatforms] = useState(new Set(['instagram']));
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState('');
  const [title, setTitle] = useState('');
  const [generating, setGenerating] = useState(false);

  // ── Preview & Publish ──
  const [step, setStep] = useState(1); // 1=select, 2=compose, 3=preview, 4=published
  const [publishing, setPublishing] = useState(false);
  const [publishResults, setPublishResults] = useState({});

  // ── Load data ──
  useEffect(() => {
    const load = async () => {
      try {
        const [mockupData, collData] = await Promise.all([
          get('/mockups/list').catch(() => ({ items: [] })),
          get('/photos/collections/list').catch(() => ({ collections: [] })),
        ]);
        setMockups(mockupData?.items || []);
        const cols = (collData?.collections || []).map(c => typeof c === 'string' ? c : c.name).filter(Boolean);
        setCollections(cols);
      } catch {}
    };
    load();
  }, []);

  // Load photos when collection changes
  useEffect(() => {
    if (!selectedCollection) { setPhotos([]); return; }
    const loadPhotos = async () => {
      try {
        const data = await get(`/photos?collection=${encodeURIComponent(selectedCollection)}&limit=200`);
        setPhotos(data?.items || data?.photos || []);
      } catch {}
    };
    loadPhotos();
  }, [selectedCollection]);

  // ── Filtered mockups ──
  const filteredMockups = useMemo(() => {
    if (!mockupFilter) return mockups;
    const q = mockupFilter.toLowerCase();
    return mockups.filter(m => m.base.toLowerCase().includes(q));
  }, [mockups, mockupFilter]);

  // ── Image selection handlers ──
  const toggleMockupImage = useCallback((mockup) => {
    // Use instagram variant as preview, or full, or first available
    const previewPlatform = mockup.platforms.instagram || mockup.platforms.full || mockup.platforms.pinterest || Object.values(mockup.platforms)[0];
    const entry = {
      type: 'mockup',
      src: `${AGENT_BASE}/mockups/image/${previewPlatform}`,
      thumb: `${AGENT_BASE}/mockups/image/${previewPlatform}`,
      filename: mockup.base,
      platforms: mockup.platforms,
      // Build platform-specific URLs
      platformUrls: Object.fromEntries(
        Object.entries(mockup.platforms).map(([p, f]) => [p, `${AGENT_BASE}/mockups/image/${f}`])
      ),
    };

    setSelectedImages(prev => {
      const exists = prev.findIndex(i => i.filename === mockup.base);
      if (exists >= 0) return prev.filter((_, idx) => idx !== exists);
      return [...prev, entry];
    });
  }, []);

  const togglePhotoImage = useCallback((photo) => {
    const collection = (photo.collection || '').toLowerCase();
    const baseName = (photo.filename || '').replace(/\.[^.]+$/, '');
    const entry = {
      type: 'photo',
      src: `${AGENT_BASE}/photos/${photo.id}/thumbnail?size=400`,
      thumb: `${AGENT_BASE}/photos/${photo.id}/thumbnail?size=200`,
      filename: photo.filename,
      photoId: photo.id,
      collection: photo.collection,
      fullUrl: `https://archive-35.com/images/${collection}/${baseName}-full.jpg`,
      exif: photo.exif_json,
    };

    setSelectedImages(prev => {
      const exists = prev.findIndex(i => i.photoId === photo.id);
      if (exists >= 0) return prev.filter((_, idx) => idx !== exists);
      return [...prev, entry];
    });
  }, []);

  const removeImage = useCallback((idx) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const isSelected = useCallback((identifier) => {
    return selectedImages.some(i => i.filename === identifier || i.photoId === identifier);
  }, [selectedImages]);

  // ── AI caption generation ──
  const handleGenerate = async () => {
    if (selectedImages.length === 0) return;
    setGenerating(true);
    try {
      const firstImg = selectedImages[0];
      const platform = Array.from(targetPlatforms)[0] || 'instagram';

      if (firstImg.photoId) {
        const data = await post('/content/generate-draft', {
          photo_id: firstImg.photoId,
          platform,
        });
        if (data?.body) setCaption(data.body);
        if (data?.tags) setTags(Array.isArray(data.tags) ? data.tags.join(', ') : data.tags);
        if (data?.title) setTitle(data.title || '');
      } else {
        // Mockup — generate from filename context
        const parts = firstImg.filename.split('_');
        const gallery = parts[0]?.replace(/-/g, ' ') || '';
        const template = parts.slice(2).join(' ').replace(/-/g, ' ') || '';

        const data = await post('/content/generate-draft', {
          photo_id: '__mockup__',
          platform,
          context: { gallery, template, filename: firstImg.filename },
        });
        if (data?.body) setCaption(data.body);
        if (data?.tags) setTags(Array.isArray(data.tags) ? data.tags.join(', ') : data.tags);
        if (data?.title) setTitle(data.title || '');
      }
    } catch (err) {
      setError?.(err.message || 'Failed to generate caption');
    } finally {
      setGenerating(false);
    }
  };

  // ── Platform toggle ──
  const togglePlatform = (p) => {
    setTargetPlatforms(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  };

  // ── Publish ──
  const handlePublish = async () => {
    if (selectedImages.length === 0 || !caption.trim() || targetPlatforms.size === 0) return;
    setPublishing(true);
    setPublishResults({});

    const results = {};
    const firstImg = selectedImages[0];

    // Build full caption with tags
    let fullCaption = caption.trim();
    if (tags.trim()) {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      const hashTags = tagList.map(t => t.startsWith('#') ? t : `#${t.replace(/\s+/g, '')}`);
      fullCaption += '\n\n' + hashTags.join(' ');
    }

    for (const platform of targetPlatforms) {
      try {
        if (platform === 'instagram') {
          // Instagram needs a public URL
          const imageUrl = firstImg.fullUrl || firstImg.src;
          // Append "Link in bio" CTA if not already present
          let igCaption = fullCaption;
          if (!igCaption.toLowerCase().includes('link in bio')) {
            igCaption += '\n\n\ud83d\uddbc\ufe0f Prints & licensing \u2192 Link in bio';
          }
          const result = await post('/instagram/publish', {
            image_url: imageUrl,
            caption: igCaption,
          });
          results[platform] = result;
        } else if (platform === 'pinterest') {
          const imageUrl = firstImg.fullUrl || firstImg.src;
          const result = await post('/pinterest/pins/create', {
            title: (title || firstImg.filename || '').slice(0, 100),
            description: fullCaption.slice(0, 500),
            image_url: imageUrl,
            link: `https://archive-35.com/gallery.html${firstImg.collection ? '#collection=' + encodeURIComponent(firstImg.collection) : ''}`,
            alt_text: `${title || firstImg.filename} — fine art photography by Wolf Schram`,
          });
          results[platform] = result;
        } else if (platform === 'etsy') {
          // Save to content queue for manual listing
          const result = await post('/content/create-manual', {
            photo_id: firstImg.photoId || firstImg.filename,
            platform: 'etsy',
            body: fullCaption,
            title: title || firstImg.filename,
            tags: tags.split(',').map(t => t.trim()).filter(Boolean),
          });
          results[platform] = { success: true, message: 'Saved to Etsy queue — use Copy for Manual Listing', ...result };
        }
      } catch (err) {
        results[platform] = { error: err.message || 'Failed' };
      }
    }

    setPublishResults(results);
    setStep(4);
    setPublishing(false);
  };

  // ── Copy for manual Etsy ──
  const handleCopyEtsy = () => {
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    const text = [
      `TITLE: ${title || selectedImages[0]?.filename || ''}`,
      '',
      'DESCRIPTION:',
      caption,
      '',
      'TAGS (paste into Etsy tag field):',
      tagList.join(', '),
      '',
      selectedImages.map(img => `IMAGE: ${img.fullUrl || img.src}`).join('\n'),
      '',
      '→ Go to: https://www.etsy.com/your/shops/me/tools/listings/create',
    ].join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setPublishResults(prev => ({ ...prev, etsy_copied: true }));
    });
  };

  // ── Render helpers ──
  const stepLabels = [
    { n: 1, label: 'Select Images' },
    { n: 2, label: 'Compose' },
    { n: 3, label: 'Preview' },
    { n: 4, label: 'Published' },
  ];

  return (
    <div className="page">
      <header className="page-header">
        <h2>Compose Post</h2>
        <p className="page-subtitle">
          Select mockups + photos → compose → preview → publish to any platform
        </p>
      </header>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', alignItems: 'center' }}>
        {stepLabels.map(({ n, label }) => (
          <React.Fragment key={n}>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                cursor: n < step ? 'pointer' : 'default', opacity: step >= n ? 1 : 0.4,
              }}
              onClick={() => n < step && setStep(n)}
            >
              <span style={{
                width: '24px', height: '24px', borderRadius: '50%',
                background: step >= n ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                color: step >= n ? '#fff' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '12px', fontWeight: 600,
              }}>{step > n ? '\u2713' : n}</span>
              <span style={{
                fontSize: '13px', color: step >= n ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: step === n ? 600 : 400,
              }}>{label}</span>
            </div>
            {n < 4 && <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>→</span>}
          </React.Fragment>
        ))}
      </div>

      {error && (
        <div style={{
          padding: '12px 16px', marginBottom: '16px',
          background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '8px', color: '#ef4444', fontSize: '13px',
        }}>{error}</div>
      )}

      {/* Selected images strip (always visible in steps 1-3) */}
      {step <= 3 && selectedImages.length > 0 && (
        <div className="glass-card" style={{ marginBottom: '20px', padding: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Selected ({selectedImages.length})
            </span>
            {step === 1 && (
              <button onClick={() => setStep(2)} style={{
                padding: '6px 16px', fontSize: '12px', fontWeight: 600,
                background: 'rgba(212, 165, 116, 0.15)', border: '1px solid var(--accent)',
                borderRadius: '6px', color: 'var(--accent)', cursor: 'pointer',
              }}>Next: Compose →</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
            {selectedImages.map((img, idx) => (
              <div key={idx} style={{ position: 'relative', flexShrink: 0 }}>
                <img src={img.thumb || img.src} alt="" style={{
                  width: '80px', height: '60px', objectFit: 'cover', borderRadius: '6px',
                  border: '2px solid var(--accent)',
                }} />
                <button onClick={() => removeImage(idx)} style={{
                  position: 'absolute', top: '-6px', right: '-6px',
                  width: '18px', height: '18px', borderRadius: '50%',
                  background: '#ef4444', color: '#fff', border: 'none',
                  fontSize: '11px', cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                }}>×</button>
                <div style={{
                  position: 'absolute', bottom: '2px', left: '2px',
                  padding: '1px 4px', borderRadius: '3px', fontSize: '8px',
                  background: img.type === 'mockup' ? 'rgba(212, 165, 116, 0.9)' : 'rgba(99, 102, 241, 0.9)',
                  color: '#fff',
                }}>{img.type === 'mockup' ? 'MOCKUP' : 'PHOTO'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════ STEP 1: SELECT IMAGES ══════════ */}
      {step === 1 && (
        <div>
          {/* Source tabs */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            {[
              { id: 'mockups', label: `Mockups (${mockups.length})`, icon: '🖼️' },
              { id: 'photos', label: 'Original Photos', icon: '📷' },
            ].map(tab => (
              <button key={tab.id} onClick={() => setSourceTab(tab.id)} style={{
                padding: '10px 20px', fontSize: '13px', fontWeight: 600,
                background: sourceTab === tab.id ? 'rgba(212, 165, 116, 0.15)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${sourceTab === tab.id ? 'var(--accent)' : 'var(--glass-border)'}`,
                borderRadius: '8px', color: sourceTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer',
              }}>{tab.icon} {tab.label}</button>
            ))}
          </div>

          {/* Mockups grid */}
          {sourceTab === 'mockups' && (
            <div>
              <input
                type="text" placeholder="Filter mockups... (e.g. iceland, gallery-dark)"
                value={mockupFilter} onChange={(e) => setMockupFilter(e.target.value)}
                style={{
                  width: '100%', padding: '10px 14px', fontSize: '13px', marginBottom: '12px',
                  background: 'var(--bg-primary)', border: '1px solid var(--glass-border)',
                  borderRadius: '6px', color: 'var(--text)', boxSizing: 'border-box',
                }}
              />
              {filteredMockups.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                  {loading ? 'Loading mockups...' : 'No mockups found. Generate some in the Mockup tab first.'}
                </div>
              ) : (
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px',
                }}>
                  {filteredMockups.map(mockup => {
                    const previewFile = mockup.platforms.instagram || mockup.platforms.full || Object.values(mockup.platforms)[0];
                    const selected = isSelected(mockup.base);
                    return (
                      <div key={mockup.base} onClick={() => toggleMockupImage(mockup)} style={{
                        cursor: 'pointer', borderRadius: '8px', overflow: 'hidden',
                        border: `2px solid ${selected ? 'var(--accent)' : 'transparent'}`,
                        background: selected ? 'rgba(212, 165, 116, 0.06)' : 'rgba(255,255,255,0.02)',
                        transition: 'border-color 0.2s',
                      }}>
                        <img src={`${AGENT_BASE}/mockups/image/${previewFile}`} alt={mockup.base}
                          loading="lazy" style={{ width: '100%', height: '140px', objectFit: 'cover' }}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                        <div style={{ padding: '8px' }}>
                          <div style={{
                            fontSize: '11px', color: 'var(--text-primary)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>{mockup.base.replace(/_/g, ' / ')}</div>
                          <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                            {Object.keys(mockup.platforms).map(p => (
                              <span key={p} style={{
                                fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
                                background: PLATFORMS[p]?.bg || 'rgba(255,255,255,0.05)',
                                color: PLATFORMS[p]?.color || 'var(--text-muted)',
                              }}>{p}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Photos grid */}
          {sourceTab === 'photos' && (
            <div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
                <select value={selectedCollection} onChange={(e) => setSelectedCollection(e.target.value)}
                  style={{
                    padding: '8px 12px', fontSize: '13px', background: 'var(--bg-primary)',
                    color: 'var(--text-primary)', border: '1px solid var(--glass-border)',
                    borderRadius: '6px', minWidth: '200px',
                  }}>
                  <option value="">Choose collection...</option>
                  {collections.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                </select>
                {photos.length > 0 && (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{photos.length} photos</span>
                )}
              </div>

              {photos.length > 0 && (
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px',
                }}>
                  {photos.map(photo => {
                    const selected = isSelected(photo.id);
                    return (
                      <div key={photo.id} onClick={() => togglePhotoImage(photo)} style={{
                        cursor: 'pointer', borderRadius: '8px', overflow: 'hidden',
                        border: `2px solid ${selected ? 'var(--accent)' : 'transparent'}`,
                        aspectRatio: '1', background: 'rgba(255,255,255,0.03)',
                        transition: 'border-color 0.2s',
                      }}>
                        <img src={`${AGENT_BASE}/photos/${photo.id}/thumbnail?size=200`}
                          alt={photo.filename} loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════ STEP 2: COMPOSE ══════════ */}
      {step === 2 && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '24px' }}>
          {/* Left: Image preview stack */}
          <div>
            {selectedImages.map((img, idx) => (
              <div key={idx} className="glass-card" style={{ padding: '8px', marginBottom: '8px' }}>
                <img src={img.src} alt={img.filename} style={{
                  width: '100%', borderRadius: '6px', objectFit: 'contain', maxHeight: '250px',
                }} onError={(e) => { e.target.style.display = 'none'; }} />
                <div style={{ padding: '6px 4px 2px', fontSize: '12px', color: 'var(--text-primary)' }}>
                  {img.filename}
                  <span style={{
                    marginLeft: '6px', fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
                    background: img.type === 'mockup' ? 'rgba(212, 165, 116, 0.2)' : 'rgba(99, 102, 241, 0.2)',
                    color: img.type === 'mockup' ? 'var(--accent)' : '#6366f1',
                  }}>{img.type}</span>
                </div>
              </div>
            ))}
            <button onClick={() => setStep(1)} style={{
              width: '100%', padding: '8px', fontSize: '12px',
              background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)',
              borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer',
            }}>← Add More Images</button>
          </div>

          {/* Right: Compose form */}
          <div>
            {/* Platform selector (multi-select) */}
            <div className="glass-card" style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>
                Publish to (select all that apply)
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {Object.entries(PLATFORMS).map(([key, cfg]) => {
                  const active = targetPlatforms.has(key);
                  return (
                    <button key={key} onClick={() => togglePlatform(key)} style={{
                      padding: '10px 20px', fontSize: '13px', fontWeight: 600,
                      background: active ? cfg.bg : 'rgba(255,255,255,0.03)',
                      border: `2px solid ${active ? cfg.color : 'var(--glass-border)'}`,
                      borderRadius: '8px', color: active ? cfg.color : 'var(--text-muted)',
                      cursor: 'pointer', transition: 'all 0.2s',
                    }}>{cfg.icon} {cfg.label}</button>
                  );
                })}
              </div>
            </div>

            {/* Caption */}
            <div className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '14px' }}>
                  {targetPlatforms.has('etsy') ? 'Listing / Caption' : 'Caption'}
                </h3>
                <button onClick={handleGenerate} disabled={generating || loading} style={{
                  padding: '6px 14px', fontSize: '12px', fontWeight: 600,
                  background: 'rgba(212, 165, 116, 0.12)', border: '1px solid var(--accent)',
                  borderRadius: '6px', color: 'var(--accent)', cursor: generating ? 'wait' : 'pointer',
                  opacity: generating ? 0.6 : 1,
                }}>{generating ? 'Generating...' : '✨ AI Generate'}</button>
              </div>

              {/* Title (for Etsy/Pinterest) */}
              {(targetPlatforms.has('etsy') || targetPlatforms.has('pinterest')) && (
                <input type="text" placeholder="Title..." value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px', fontSize: '14px',
                    background: 'var(--bg-primary)', color: 'var(--text-primary)',
                    border: '1px solid var(--glass-border)', borderRadius: '6px',
                    marginBottom: '12px', boxSizing: 'border-box',
                  }}
                />
              )}

              <textarea value={caption} onChange={(e) => setCaption(e.target.value)}
                placeholder="Write your caption / description..."
                rows={8} style={{
                  width: '100%', padding: '12px', fontSize: '14px',
                  background: 'var(--bg-primary)', color: 'var(--text-primary)',
                  border: '1px solid var(--glass-border)', borderRadius: '6px',
                  resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6, boxSizing: 'border-box',
                }}
              />

              <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)', textAlign: 'right' }}>
                {caption.length} chars
                {targetPlatforms.has('instagram') && caption.length > 2200 && (
                  <span style={{ color: '#ef4444', marginLeft: '8px' }}>(IG max 2,200)</span>
                )}
              </div>

              {/* Tags */}
              <div style={{ marginTop: '12px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Tags / Hashtags
                </label>
                <input type="text" value={tags} onChange={(e) => setTags(e.target.value)}
                  placeholder="photography, fineart, landscape, wallart..."
                  style={{
                    width: '100%', padding: '8px 12px', fontSize: '13px',
                    background: 'var(--bg-primary)', color: 'var(--text-primary)',
                    border: '1px solid var(--glass-border)', borderRadius: '6px', boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Actions */}
              <div style={{ marginTop: '20px', display: 'flex', gap: '12px' }}>
                <button onClick={() => setStep(3)} disabled={!caption.trim() || targetPlatforms.size === 0}
                  style={{
                    padding: '10px 24px', fontSize: '14px', fontWeight: 600,
                    background: 'rgba(212, 165, 116, 0.15)', border: '1px solid var(--accent)',
                    borderRadius: '8px', color: 'var(--accent)',
                    cursor: caption.trim() && targetPlatforms.size > 0 ? 'pointer' : 'not-allowed',
                    opacity: !caption.trim() || targetPlatforms.size === 0 ? 0.5 : 1,
                  }}>Preview →</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ STEP 3: PREVIEW ══════════ */}
      {step === 3 && (
        <div>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
            {Array.from(targetPlatforms).map(platform => {
              const cfg = PLATFORMS[platform];
              const img = selectedImages[0];
              // Use platform-specific mockup if available
              const imgSrc = img?.platformUrls?.[platform] || img?.src;
              const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);

              return (
                <div key={platform} style={{
                  flex: '1 1 340px', maxWidth: '400px',
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${cfg.color}30`,
                  borderRadius: '12px', overflow: 'hidden',
                }}>
                  {/* Platform header */}
                  <div style={{
                    padding: '10px 16px', background: cfg.bg,
                    display: 'flex', alignItems: 'center', gap: '8px',
                    borderBottom: `1px solid ${cfg.color}30`,
                  }}>
                    <span style={{ fontSize: '16px' }}>{cfg.icon}</span>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
                    {platform === 'etsy' && (
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: 'auto' }}>Manual</span>
                    )}
                    {platform === 'instagram' && (
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: 'auto' }}>Dev Mode</span>
                    )}
                    {platform === 'pinterest' && (
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: 'auto' }}>Trial</span>
                    )}
                  </div>

                  {/* Account row — logo + username */}
                  <div style={{
                    padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <img
                      src="https://archive-35.com/logos/archive35-social-profile.svg"
                      alt="Archive-35"
                      style={{
                        width: '36px', height: '36px', borderRadius: '50%',
                        border: '2px solid var(--accent)',
                      }}
                    />
                    <div>
                      <div style={{
                        fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)',
                        letterSpacing: '0.5px',
                      }}>
                        {platform === 'instagram' ? 'archive35photo' : 'ARCHIVE-35'}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        {platform === 'instagram' ? 'Fine Art Photography' : 'archive-35.com'}
                      </div>
                    </div>
                  </div>

                  {/* Image preview */}
                  <img src={imgSrc} alt="" style={{
                    width: '100%',
                    height: platform === 'pinterest' ? '260px' : '220px',
                    objectFit: 'cover',
                  }} onError={(e) => { e.target.style.background = '#1a1a2e'; }} />

                  {/* Content preview */}
                  <div style={{ padding: '14px 16px' }}>
                    {(platform === 'etsy' || platform === 'pinterest') && title && (
                      <div style={{
                        fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)',
                        marginBottom: '8px',
                      }}>{title}</div>
                    )}
                    <div style={{
                      fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5,
                      maxHeight: '100px', overflow: 'hidden',
                    }}>
                      {caption.length > 200 ? caption.substring(0, 200) + '...' : caption}
                    </div>
                    {tagList.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                        {tagList.slice(0, platform === 'etsy' ? 13 : 6).map((tag, i) => (
                          <span key={i} style={{
                            fontSize: '10px', padding: '2px 8px', borderRadius: '10px',
                            background: cfg.bg, color: cfg.color,
                          }}>{platform === 'instagram' ? `#${tag.replace(/^#/, '')}` : tag}</span>
                        ))}
                        {tagList.length > (platform === 'etsy' ? 13 : 6) && (
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                            +{tagList.length - (platform === 'etsy' ? 13 : 6)} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Multi-image strip */}
          {selectedImages.length > 1 && (
            <div className="glass-card" style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                Additional images in this post
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {selectedImages.slice(1).map((img, idx) => (
                  <img key={idx} src={img.thumb || img.src} alt="" style={{
                    width: '80px', height: '60px', objectFit: 'cover', borderRadius: '6px',
                    border: '1px solid var(--glass-border)',
                  }} />
                ))}
              </div>
            </div>
          )}

          {/* Publish actions */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button onClick={() => setStep(2)} style={{
              padding: '10px 20px', fontSize: '13px',
              background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)',
              borderRadius: '8px', color: 'var(--text-muted)', cursor: 'pointer',
            }}>← Edit</button>

            <button onClick={handlePublish} disabled={publishing} style={{
              padding: '12px 32px', fontSize: '14px', fontWeight: 700,
              background: 'rgba(212, 165, 116, 0.2)', border: '2px solid var(--accent)',
              borderRadius: '8px', color: 'var(--accent)',
              cursor: publishing ? 'wait' : 'pointer', opacity: publishing ? 0.6 : 1,
            }}>
              {publishing ? 'Publishing...' : `Publish to ${Array.from(targetPlatforms).map(p => PLATFORMS[p]?.label).join(' + ')}`}
            </button>

            {targetPlatforms.has('etsy') && (
              <button onClick={handleCopyEtsy} style={{
                padding: '10px 20px', fontSize: '13px', fontWeight: 600,
                background: 'rgba(59, 130, 246, 0.12)', border: '1px solid rgba(59, 130, 246, 0.4)',
                borderRadius: '8px', color: '#3b82f6', cursor: 'pointer',
              }}>
                {publishResults.etsy_copied ? 'Copied!' : 'Copy for Etsy (Manual)'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ══════════ STEP 4: PUBLISHED ══════════ */}
      {step === 4 && (
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
            {Object.entries(publishResults).filter(([k]) => k !== 'etsy_copied').map(([platform, result]) => {
              const cfg = PLATFORMS[platform] || {};
              const success = !result.error;
              return (
                <div key={platform} className="glass-card" style={{
                  borderLeft: `4px solid ${success ? 'var(--success)' : 'var(--danger)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '18px' }}>{success ? '✅' : '❌'}</span>
                    <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {cfg.label || platform}
                    </span>
                    <span style={{
                      fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                      background: success ? 'rgba(74, 222, 128, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: success ? 'var(--success)' : 'var(--danger)',
                    }}>{success ? 'Published' : 'Failed'}</span>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    {result.error || result.message || (result.id ? `ID: ${result.id}` : 'Saved')}
                  </div>
                  {platform === 'etsy' && success && (
                    <div style={{ marginTop: '8px' }}>
                      <a href="https://www.etsy.com/your/shops/me/tools/listings/create"
                        target="_blank" rel="noopener noreferrer"
                        onClick={(e) => {
                          e.preventDefault();
                          if (window.electronAPI?.openExternal) {
                            window.electronAPI.openExternal('https://www.etsy.com/your/shops/me/tools/listings/create');
                          } else {
                            window.open('https://www.etsy.com/your/shops/me/tools/listings/create', '_blank');
                          }
                        }}
                        style={{
                          fontSize: '12px', color: '#f1641e', textDecoration: 'none',
                        }}>
                        → Open Etsy Manual Listing Page
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={() => {
              setStep(1);
              setSelectedImages([]);
              setCaption('');
              setTags('');
              setTitle('');
              setPublishResults({});
            }} style={{
              padding: '10px 24px', fontSize: '14px', fontWeight: 600,
              background: 'rgba(212, 165, 116, 0.15)', border: '1px solid var(--accent)',
              borderRadius: '8px', color: 'var(--accent)', cursor: 'pointer',
            }}>Create Another Post</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AgentCompose;
