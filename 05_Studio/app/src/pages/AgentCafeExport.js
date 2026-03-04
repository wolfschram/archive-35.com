import React, { useState, useEffect, useCallback } from 'react';
import useAgentApi from '../hooks/useAgentApi';

/**
 * AgentCafeExport — CaFE (CallForEntry.org) submission management.
 * Manages photo submissions to art competition calls with metadata validation.
 *
 * SHARED ZONE: Changes here must be tested in both Studio and Agent tabs.
 */
function AgentCafeExport() {
  const { get, post, loading, error, setError } = useAgentApi();

  // ── Tab navigation ───────────────────────────────────────
  const [activeTab, setActiveTab] = useState('galleries'); // 'galleries' | 'submissions' | 'history'
  const [viewStack, setViewStack] = useState(['galleries']); // Stack for gallery detail navigation

  // ── Data state ───────────────────────────────────────────
  const [galleries, setGalleries] = useState([]);
  const [galleryPhotos, setGalleryPhotos] = useState({}); // {collectionName: [photos]}
  const [submissions, setSubmissions] = useState([]);
  const [exportHistory, setExportHistory] = useState([]);

  // ── Submission rack state ────────────────────────────────
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [photoMetadata, setPhotoMetadata] = useState({}); // {photoId: {title, description, alt_text, ...}}
  const [rackCollapsed, setRackCollapsed] = useState(false);

  // ── UI state ─────────────────────────────────────────────
  const [currentGallery, setCurrentGallery] = useState(null); // For detail view
  const [expandedSubmission, setExpandedSubmission] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [copiedSubmissionId, setCopiedSubmissionId] = useState(null);

  // ── CaFE field constraints ───────────────────────────────
  const CAFE_LIMITS = {
    title: 60,
    alt_text: 125,
    medium: 60,
    description: 300,
  };

  // ── Load data ────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [galleriesData, submissionsData] = await Promise.all([
        get('/cafe/galleries').catch(() => ({ galleries: [] })),
        get('/cafe/submissions').catch(() => ({ items: [] })),
      ]);
      setGalleries(galleriesData.galleries || []);
      setSubmissions(submissionsData.items || []);
      setError(null);
    } catch {
      // error shown via hook
    }
  }, [get, setError]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load photos for a specific gallery
  const loadGalleryPhotos = useCallback(
    async (collectionName) => {
      try {
        const result = await get(`/cafe/photos?collection=${collectionName}`);
        setGalleryPhotos((prev) => ({
          ...prev,
          [collectionName]: result.photos || [],
        }));
      } catch {
        // error shown via hook
      }
    },
    [get]
  );

  // ── Navigation helpers ───────────────────────────────────

  const enterGalleryDetail = (gallery) => {
    setCurrentGallery(gallery);
    setViewStack((prev) => [...prev, 'gallery-detail']);
    loadGalleryPhotos(gallery.name);
  };

  const backToGalleryList = () => {
    setCurrentGallery(null);
    setViewStack((prev) => prev.slice(0, -1));
  };

  // ── Character Counter Component ──────────────────────────

  const CharCounter = ({ value, limit }) => {
    const len = (value || '').length;
    const percent = limit ? (len / limit) * 100 : 0;
    let color = 'var(--success)';
    if (percent >= 100) color = 'var(--danger)';
    else if (percent >= 80) color = '#eab308';

    return (
      <span style={{
        fontSize: '11px',
        color,
        fontWeight: percent >= 80 ? 600 : 400,
      }}>
        {len}/{limit}
      </span>
    );
  };

  // ── Validation helpers ───────────────────────────────────

  const validatePhoto = (photo) => {
    const meta = photoMetadata[photo.id] || {};
    const title = meta.title || photo.title || '';
    const desc = meta.description || photo.description || '';
    const altText = meta.alt_text || photo.alt_text || '';

    return {
      title: title.length > 0 && title.length <= CAFE_LIMITS.title,
      description: desc.length > 0 && desc.length <= CAFE_LIMITS.description,
      alt_text: altText.length > 0 && altText.length <= CAFE_LIMITS.alt_text,
    };
  };

  const isPhotoValid = (photo) => {
    const validation = validatePhoto(photo);
    return Object.values(validation).every((v) => v === true);
  };

  const getValidationStatus = (photo) => {
    const validation = validatePhoto(photo);
    if (!validation.title) return 'title';
    if (!validation.description) return 'description';
    if (!validation.alt_text) return 'alt_text';
    return 'valid';
  };

  // ── Handlers ─────────────────────────────────────────────

  const handleTogglePhoto = (photo) => {
    setSelectedPhotos((prev) => {
      const next = new Set(prev);
      if (next.has(photo.id)) {
        next.delete(photo.id);
        const newMeta = { ...photoMetadata };
        delete newMeta[photo.id];
        setPhotoMetadata(newMeta);
      } else if (next.size < 10) {
        next.add(photo.id);
        // Pre-populate metadata from photo
        setPhotoMetadata((prev) => ({
          ...prev,
          [photo.id]: {
            title: photo.title || '',
            description: photo.description || '',
            alt_text: photo.alt_text || '',
          },
        }));
      }
      return next;
    });
  };

  const handleMetadataChange = (photoId, field, value) => {
    setPhotoMetadata((prev) => ({
      ...prev,
      [photoId]: { ...prev[photoId], [field]: value },
    }));
  };

  const handleGenerateExport = async () => {
    if (selectedPhotos.size === 0) {
      setActionMsg({ type: 'error', text: 'Select at least one photo for submission' });
      return;
    }

    // Validate all selected photos
    const allPhotos = Object.values(galleryPhotos).flat();
    const invalidPhotos = Array.from(selectedPhotos).filter((id) => {
      const photo = allPhotos.find((p) => p.id === id);
      return !isPhotoValid(photo);
    });

    if (invalidPhotos.length > 0) {
      setActionMsg({
        type: 'error',
        text: `${invalidPhotos.length} photo(s) have incomplete metadata. Fill in title, description, and alt text.`,
      });
      return;
    }

    setExporting(true);
    setActionMsg(null);

    try {
      const exportData = {
        photo_ids: Array.from(selectedPhotos),
        metadata_overrides: photoMetadata,
        gallery_source: currentGallery?.name || 'mixed',
      };
      const result = await post('/cafe/export', exportData);
      setActionMsg({
        type: 'success',
        text: `Export created: ${result.folder_name || 'CaFE_Ready'}`,
      });
      setSelectedPhotos(new Set());
      setPhotoMetadata({});
      setActiveTab('submissions');
      loadData();
    } catch (err) {
      setActionMsg({ type: 'error', text: `Export failed: ${err.message || err}` });
    } finally {
      setExporting(false);
    }
  };

  const handleExportFolder = async (submissionId) => {
    try {
      await post(`/cafe/export-folder/${submissionId}`);
      setActionMsg({ type: 'success', text: 'Folder exported successfully' });
      loadData();
    } catch (err) {
      setActionMsg({ type: 'error', text: `Export failed: ${err.message || err}` });
    }
  };

  const handleCopyMetadata = (submission) => {
    const metaText =
      submission.images
        ?.map(
          (img) =>
            `${img.title}\n` +
            `Alt: ${img.alt_text || '(none)'}\n` +
            `Desc: ${img.description || '(none)'}\n`
        )
        .join('\n---\n') || 'No metadata';

    navigator.clipboard
      .writeText(metaText)
      .then(() => {
        setCopiedSubmissionId(submission.id);
        setActionMsg({ type: 'success', text: 'Metadata copied to clipboard' });
        setTimeout(() => setCopiedSubmissionId(null), 3000);
      })
      .catch(() => {
        setActionMsg({ type: 'error', text: 'Copy failed' });
      });
  };

  // ── Stats ────────────────────────────────────────────────

  const allPhotos = Object.values(galleryPhotos).flat();
  const validPhotoCount = allPhotos.filter(isPhotoValid).length;

  // ── Render: Submission Rack (sticky, always visible) ─────

  const SubmissionRack = () => (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        backgroundColor: 'var(--bg-primary)',
        borderBottom: '1px solid var(--glass-border)',
        padding: '16px 20px',
        marginBottom: '16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: selectedPhotos.size > 0 && !rackCollapsed ? '12px' : '0',
          cursor: 'pointer',
        }}
        onClick={() => setRackCollapsed(!rackCollapsed)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>📦 Submission Rack</h3>
          <span
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              fontWeight: 600,
            }}
          >
            {selectedPhotos.size} / 10 selected
          </span>
        </div>
        <span
          style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            transform: rackCollapsed ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s',
          }}
        >
          {rackCollapsed ? '▼' : '▲'}
        </span>
      </div>

      {!rackCollapsed && selectedPhotos.size > 0 && (
        <div>
          {/* Horizontal thumbnail scroll */}
          <div
            style={{
              display: 'flex',
              gap: '12px',
              overflowX: 'auto',
              marginBottom: '16px',
              paddingBottom: '8px',
            }}
          >
            {Array.from(selectedPhotos).map((photoId) => {
              const photo = allPhotos.find((p) => p.id === photoId);
              if (!photo) return null;
              const thumbUrl = `https://archive-35.com/images/${photo.collection}/${photo.filename.replace(
                /\.[^/.]+$/,
                ''
              )}-thumb.jpg`;

              return (
                <div
                  key={photoId}
                  style={{
                    position: 'relative',
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={thumbUrl}
                    alt={photo.title}
                    style={{
                      width: '80px',
                      height: '80px',
                      objectFit: 'cover',
                      borderRadius: '6px',
                      border: '2px solid #7c5cbf',
                    }}
                    onError={(e) => {
                      e.target.src =
                        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect fill="%23333" width="80" height="80"/%3E%3C/svg%3E';
                    }}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTogglePhoto(photo);
                    }}
                    style={{
                      position: 'absolute',
                      top: '-8px',
                      right: '-8px',
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--danger)',
                      border: 'none',
                      color: 'white',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '14px',
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {/* Metadata editor */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '12px',
              marginBottom: '16px',
            }}
          >
            {Array.from(selectedPhotos).map((photoId) => {
              const photo = allPhotos.find((p) => p.id === photoId);
              if (!photo) return null;
              const meta = photoMetadata[photoId] || {};
              const title = meta.title || '';
              const desc = meta.description || '';
              const altText = meta.alt_text || '';
              const status = getValidationStatus(photo);

              return (
                <div
                  key={photoId}
                  style={{
                    padding: '12px',
                    background: 'var(--bg-tertiary)',
                    border: `1px solid ${status === 'valid' ? 'var(--success)' : 'var(--glass-border)'}`,
                    borderRadius: '6px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      marginBottom: '8px',
                      color: 'var(--text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {photo.title}
                  </div>

                  {/* Title input */}
                  <div style={{ marginBottom: '8px' }}>
                    <label
                      style={{
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '4px',
                      }}
                    >
                      <span>Title</span>
                      <CharCounter value={title} limit={CAFE_LIMITS.title} />
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => handleMetadataChange(photoId, 'title', e.target.value)}
                      maxLength={CAFE_LIMITS.title}
                      placeholder="Required"
                      style={{
                        width: '100%',
                        padding: '6px',
                        fontSize: '12px',
                        background: 'var(--bg-primary)',
                        border: `1px solid ${title.length === 0 ? '#eab308' : 'var(--glass-border)'}`,
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {/* Alt text input */}
                  <div style={{ marginBottom: '8px' }}>
                    <label
                      style={{
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '4px',
                      }}
                    >
                      <span>Alt Text</span>
                      <CharCounter value={altText} limit={CAFE_LIMITS.alt_text} />
                    </label>
                    <input
                      type="text"
                      value={altText}
                      onChange={(e) => handleMetadataChange(photoId, 'alt_text', e.target.value)}
                      maxLength={CAFE_LIMITS.alt_text}
                      placeholder="Required"
                      style={{
                        width: '100%',
                        padding: '6px',
                        fontSize: '12px',
                        background: 'var(--bg-primary)',
                        border: `1px solid ${altText.length === 0 ? '#eab308' : 'var(--glass-border)'}`,
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {/* Description textarea */}
                  <div>
                    <label
                      style={{
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '4px',
                      }}
                    >
                      <span>Description</span>
                      <CharCounter value={desc} limit={CAFE_LIMITS.description} />
                    </label>
                    <textarea
                      value={desc}
                      onChange={(e) => handleMetadataChange(photoId, 'description', e.target.value)}
                      maxLength={CAFE_LIMITS.description}
                      placeholder="Required"
                      style={{
                        width: '100%',
                        padding: '6px',
                        fontSize: '12px',
                        minHeight: '60px',
                        background: 'var(--bg-primary)',
                        border: `1px solid ${desc.length === 0 ? '#eab308' : 'var(--glass-border)'}`,
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        boxSizing: 'border-box',
                        fontFamily: 'inherit',
                        resize: 'vertical',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Generate export button */}
          <button
            onClick={handleGenerateExport}
            disabled={exporting || selectedPhotos.size === 0}
            style={{
              width: '100%',
              padding: '12px 20px',
              fontSize: '13px',
              fontWeight: 600,
              background:
                selectedPhotos.size > 0 ? 'rgba(124, 92, 191, 0.15)' : 'rgba(128, 128, 128, 0.1)',
              border: `1px solid ${selectedPhotos.size > 0 ? '#7c5cbf' : 'var(--text-muted)'}`,
              borderRadius: 'var(--radius-sm)',
              color: selectedPhotos.size > 0 ? '#7c5cbf' : 'var(--text-muted)',
              cursor: selectedPhotos.size > 0 ? 'pointer' : 'not-allowed',
              opacity: exporting ? 0.6 : 1,
            }}
          >
            {exporting ? 'Generating...' : `Generate Export (${selectedPhotos.size} image${selectedPhotos.size !== 1 ? 's' : ''})`}
          </button>
        </div>
      )}
    </div>
  );

  // ── Render: Tab bar ──────────────────────────────────────

  const TabBar = () => (
    <div
      style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '20px',
        borderBottom: '1px solid var(--glass-border)',
      }}
    >
      {[
        { id: 'galleries', label: '📁 Galleries' },
        { id: 'submissions', label: '📦 Submissions' },
        { id: 'history', label: '📋 History' },
      ].map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          style={{
            padding: '12px 20px',
            fontSize: '13px',
            fontWeight: 600,
            background: 'transparent',
            border: 'none',
            borderBottom: activeTab === tab.id ? '2px solid #7c5cbf' : '2px solid transparent',
            color: activeTab === tab.id ? '#7c5cbf' : 'var(--text-muted)',
            cursor: 'pointer',
            transition: 'color 0.2s',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  // ── Render: Galleries tab ────────────────────────────────

  const GalleriesTab = () => {
    if (currentGallery) {
      // Detail view
      const photos = galleryPhotos[currentGallery.name] || [];
      return (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <button
              onClick={backToGalleryList}
              style={{
                padding: '8px 12px',
                fontSize: '13px',
                background: 'rgba(124, 92, 191, 0.15)',
                border: '1px solid #7c5cbf',
                borderRadius: 'var(--radius-sm)',
                color: '#7c5cbf',
                cursor: 'pointer',
              }}
            >
              ← Back
            </button>
            <div>
              <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 600 }}>
                {currentGallery.display_name || currentGallery.name}
              </h3>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                {photos.length} photos
              </p>
            </div>
          </div>

          {/* Photo grid */}
          {photos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
              No photos in this gallery yet.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: '12px',
              }}
            >
              {photos.map((photo) => {
                const isSelected = selectedPhotos.has(photo.id);
                const status = getValidationStatus(photo);
                const thumbUrl = `https://archive-35.com/images/${photo.collection}/${photo.filename.replace(
                  /\.[^/.]+$/,
                  ''
                )}-thumb.jpg`;

                return (
                  <div
                    key={photo.id}
                    onClick={() => handleTogglePhoto(photo)}
                    style={{
                      position: 'relative',
                      cursor: 'pointer',
                      border: isSelected ? '3px solid #7c5cbf' : '1px solid var(--glass-border)',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      backgroundColor: 'var(--bg-tertiary)',
                      transition: 'transform 0.15s',
                      transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                    }}
                  >
                    <img
                      src={thumbUrl}
                      alt={photo.title}
                      style={{
                        width: '100%',
                        aspectRatio: '1',
                        objectFit: 'cover',
                      }}
                      onError={(e) => {
                        e.target.src =
                          'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="140" height="140"%3E%3Crect fill="%23333" width="140" height="140"/%3E%3C/svg%3E';
                      }}
                    />

                    {/* Selection checkmark */}
                    {isSelected && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          backgroundColor: '#7c5cbf',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontSize: '14px',
                          fontWeight: 600,
                        }}
                      >
                        ✓
                      </div>
                    )}

                    {/* Validation badge */}
                    {status !== 'valid' && (
                      <div
                        style={{
                          position: 'absolute',
                          bottom: '0',
                          left: '0',
                          right: '0',
                          background: 'rgba(234, 179, 8, 0.8)',
                          color: 'white',
                          fontSize: '9px',
                          padding: '3px',
                          textAlign: 'center',
                          fontWeight: 600,
                        }}
                      >
                        {status === 'title' && 'Missing title'}
                        {status === 'description' && 'Missing desc'}
                        {status === 'alt_text' && 'Missing alt'}
                      </div>
                    )}

                    {/* Info overlay */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: status !== 'valid' ? '20px' : '0',
                        left: '0',
                        right: '0',
                        padding: '8px',
                        background: 'rgba(0, 0, 0, 0.6)',
                        color: 'white',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '10px',
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {photo.title}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // List view
    return (
      <div>
        {galleries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
            No galleries available. Import photos first.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '16px',
            }}
          >
            {galleries.map((gallery) => (
              <div
                key={gallery.name}
                onClick={() => enterGalleryDetail(gallery)}
                className="glass-card"
                style={{
                  cursor: 'pointer',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  transform: 'scale(1)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.02)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600 }}>
                  {gallery.display_name || gallery.name}
                </h3>
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '28px', fontWeight: 600, color: '#7c5cbf' }}>
                    {gallery.photo_count || 0}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>photos</div>
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    padding: '8px',
                    background: gallery.has_metadata
                      ? 'rgba(74, 222, 128, 0.1)'
                      : gallery.photo_count > 0
                        ? 'rgba(234, 179, 8, 0.1)'
                        : 'rgba(248, 113, 113, 0.1)',
                    color: gallery.has_metadata
                      ? 'var(--success)'
                      : gallery.photo_count > 0
                        ? '#eab308'
                        : 'var(--danger)',
                    borderRadius: 'var(--radius-sm)',
                    textAlign: 'center',
                    fontWeight: 600,
                  }}
                >
                  {gallery.has_metadata && '✓ All validated'}
                  {!gallery.has_metadata && gallery.photo_count > 0 && '⚠ Needs review'}
                  {gallery.photo_count === 0 && '✕ No photos'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Render: Submissions tab ──────────────────────────────

  const SubmissionsTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {submissions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
          No submissions yet. Use Galleries tab to create one.
        </div>
      ) : (
        submissions.map((submission) => {
          const isExpanded = expandedSubmission === submission.id;
          return (
            <div key={submission.id} className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                  cursor: 'pointer',
                  borderBottom: isExpanded ? '1px solid var(--glass-border)' : 'none',
                }}
                onClick={() => setExpandedSubmission(isExpanded ? null : submission.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span
                    style={{
                      padding: '4px 10px',
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderRadius: '20px',
                      background: 'rgba(124, 92, 191, 0.12)',
                      color: '#7c5cbf',
                    }}
                  >
                    CaFE
                  </span>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {submission.call_name || 'Untitled'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {submission.images?.length || 0} images
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {new Date(submission.exported_at).toLocaleDateString()}
                  </span>
                  <span
                    style={{
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      transform: isExpanded ? 'rotate(180deg)' : 'none',
                      transition: 'transform 0.2s',
                    }}
                  >
                    ▼
                  </span>
                </div>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div style={{ padding: '20px' }}>
                  {submission.images && submission.images.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.1em',
                          marginBottom: '12px',
                        }}
                      >
                        Images ({submission.images.length})
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                          gap: '12px',
                        }}
                      >
                        {submission.images.map((img, idx) => (
                          <div
                            key={idx}
                            style={{
                              border: '1px solid var(--glass-border)',
                              borderRadius: '8px',
                              overflow: 'hidden',
                            }}
                          >
                            <img
                              src={img.thumbnail_url}
                              alt={img.title}
                              style={{
                                width: '100%',
                                height: '80px',
                                objectFit: 'cover',
                                backgroundColor: 'var(--bg-tertiary)',
                              }}
                              onError={(e) => {
                                e.target.src =
                                  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="80"%3E%3Crect fill="%23333" width="100" height="80"/%3E%3C/svg%3E';
                              }}
                            />
                            <div
                              style={{
                                padding: '8px',
                                fontSize: '10px',
                                color: 'var(--text-muted)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {img.title}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      flexWrap: 'wrap',
                      paddingTop: '16px',
                      borderTop: '1px solid var(--glass-border)',
                    }}
                  >
                    <button
                      onClick={() => handleExportFolder(submission.id)}
                      style={{
                        padding: '8px 20px',
                        fontSize: '13px',
                        fontWeight: 600,
                        background: 'rgba(124, 92, 191, 0.15)',
                        border: '1px solid #7c5cbf',
                        borderRadius: 'var(--radius-sm)',
                        color: '#7c5cbf',
                        cursor: 'pointer',
                      }}
                    >
                      Export Folder
                    </button>
                    <button
                      onClick={() => handleCopyMetadata(submission)}
                      style={{
                        padding: '8px 20px',
                        fontSize: '13px',
                        fontWeight: 600,
                        background:
                          copiedSubmissionId === submission.id
                            ? 'rgba(74, 222, 128, 0.15)'
                            : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${
                          copiedSubmissionId === submission.id
                            ? 'var(--success)'
                            : 'var(--glass-border)'
                        }`,
                        borderRadius: 'var(--radius-sm)',
                        color:
                          copiedSubmissionId === submission.id
                            ? 'var(--success)'
                            : 'var(--text-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      {copiedSubmissionId === submission.id ? '✓ Copied' : 'Copy Metadata'}
                    </button>
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        marginLeft: 'auto',
                      }}
                    >
                      {new Date(submission.exported_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  // ── Render: History tab ──────────────────────────────────

  const HistoryTab = () => (
    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '48px' }}>
      Export history coming soon.
    </div>
  );

  // ── Main render ──────────────────────────────────────────

  return (
    <div className="page">
      <header className="page-header">
        <h2>CaFE Submissions</h2>
        <p className="page-subtitle">Manage art competition submissions to CallForEntry.org</p>
      </header>

      {/* Action message toast */}
      {actionMsg && (
        <div
          style={{
            marginBottom: '16px',
            padding: '10px 16px',
            background:
              actionMsg.type === 'success'
                ? 'rgba(74, 222, 128, 0.1)'
                : 'rgba(248, 113, 113, 0.1)',
            border: `1px solid ${
              actionMsg.type === 'success' ? 'var(--success)' : 'var(--danger)'
            }`,
            borderRadius: 'var(--radius-sm)',
            color: actionMsg.type === 'success' ? 'var(--success)' : 'var(--danger)',
            fontSize: '13px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{actionMsg.text}</span>
          <span
            onClick={() => setActionMsg(null)}
            style={{ cursor: 'pointer', fontSize: '16px' }}
          >
            ×
          </span>
        </div>
      )}

      {/* Sticky submission rack */}
      <SubmissionRack />

      {/* Tab bar */}
      <TabBar />

      {/* Tab content */}
      <div>
        {activeTab === 'galleries' && <GalleriesTab />}
        {activeTab === 'submissions' && <SubmissionsTab />}
        {activeTab === 'history' && <HistoryTab />}
      </div>

      {/* Global error message */}
      {error && (
        <div
          style={{
            marginTop: '16px',
            padding: '12px',
            background: 'rgba(248, 113, 113, 0.1)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--danger)',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

export default AgentCafeExport;
