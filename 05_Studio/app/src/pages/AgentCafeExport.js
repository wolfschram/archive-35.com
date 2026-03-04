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
  const [viewMode, setViewMode] = useState('submissions'); // 'submissions' | 'browser'
  const [submissions, setSubmissions] = useState([]);
  const [allPhotos, setAllPhotos] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [photoMetadata, setPhotoMetadata] = useState({}); // {photoId: {title, description}}
  const [actionMsg, setActionMsg] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [copiedSubmissionId, setCopiedSubmissionId] = useState(null);

  // CaFE field constraints
  const CAFE_LIMITS = {
    title: 60,
    alt_text: 125,
    medium: 60,
    description: 300,
    height: null, // numeric in inches
    width: null,
    depth: null,
  };

  // Load submissions and available photos
  const loadData = useCallback(async () => {
    try {
      const [submissionsData, photosData] = await Promise.all([
        get('/cafe/submissions').catch(() => ({ items: [] })),
        get('/photos').catch(() => ({ photos: [] })),
      ]);
      setSubmissions(submissionsData.items || []);
      setAllPhotos(photosData.photos || []);
      setError(null);
    } catch { /* error shown via hook */ }
  }, [get, setError]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Character Counter Component ──────────────────────────────

  const CharCounter = ({ value, limit, hideIfOk }) => {
    const len = (value || '').length;
    const percent = limit ? (len / limit) * 100 : 0;
    let color = 'var(--success)';
    if (percent >= 100) color = 'var(--danger)';
    else if (percent >= 80) color = '#eab308';

    return (
      <span style={{
        fontSize: '11px',
        color: color,
        fontWeight: percent >= 80 ? 600 : 400,
      }}>
        {len}/{limit}
      </span>
    );
  };

  // ── Validation helper ────────────────────────────────────────

  const validatePhoto = (photo) => {
    const meta = photoMetadata[photo.id] || {};
    const title = meta.title || photo.title || '';
    const desc = meta.description || photo.description || '';
    const alt = photo.alt_text || '';
    const fileSize = photo.file_size_bytes || 0;

    return {
      title: title.length <= CAFE_LIMITS.title,
      description: desc.length <= CAFE_LIMITS.description,
      alt_text: alt.length <= CAFE_LIMITS.alt_text,
      file_size: fileSize <= 5 * 1024 * 1024,
    };
  };

  const isPhotoValid = (photo) => {
    const validation = validatePhoto(photo);
    return Object.values(validation).every(v => v === true);
  };

  // ── Handlers ─────────────────────────────────────────────────

  const handleTogglePhoto = (photoId) => {
    setSelectedPhotos(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else if (next.size < 10) next.add(photoId);
      return next;
    });
  };

  const handleMetadataChange = (photoId, field, value) => {
    setPhotoMetadata(prev => ({
      ...prev,
      [photoId]: { ...prev[photoId], [field]: value },
    }));
  };

  const handleGenerateExport = async () => {
    if (selectedPhotos.size === 0) {
      setActionMsg({ type: 'error', text: 'Select at least one photo for submission' });
      return;
    }

    setExporting(true);
    setActionMsg(null);

    try {
      const exportData = {
        photo_ids: Array.from(selectedPhotos),
        metadata_overrides: photoMetadata,
      };
      const result = await post('/cafe/export', exportData);
      setActionMsg({
        type: 'success',
        text: `Export generated: ${result.folder_name}`,
      });
      setSelectedPhotos(new Set());
      setPhotoMetadata({});
      setViewMode('submissions');
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
    const metaText = submission.images?.map(img => (
      `${img.title}\n` +
      `Alt: ${img.alt_text || '(none)'}\n` +
      `Desc: ${img.description || '(none)'}\n`
    )).join('\n---\n') || 'No metadata';

    navigator.clipboard.writeText(metaText).then(() => {
      setCopiedSubmissionId(submission.id);
      setActionMsg({ type: 'success', text: 'Metadata copied to clipboard' });
      setTimeout(() => setCopiedSubmissionId(null), 3000);
    }).catch(() => {
      setActionMsg({ type: 'error', text: 'Copy failed' });
    });
  };

  // ── Stats calculation ────────────────────────────────────────

  const validPhotoCount = allPhotos.filter(isPhotoValid).length;
  const portfolioSize = submissions.reduce((acc, sub) => acc + (sub.images?.length || 0), 0);

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="page">
      <header className="page-header">
        <h2>CaFE Submissions</h2>
        <p className="page-subtitle">
          Manage art competition submissions to CallForEntry.org
        </p>
      </header>

      {/* Action message toast */}
      {actionMsg && (
        <div style={{
          marginBottom: '16px', padding: '10px 16px',
          background: actionMsg.type === 'success' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)',
          border: `1px solid ${actionMsg.type === 'success' ? 'var(--success)' : 'var(--danger)'}`,
          borderRadius: 'var(--radius-sm)',
          color: actionMsg.type === 'success' ? 'var(--success)' : 'var(--danger)',
          fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{actionMsg.text}</span>
          <span onClick={() => setActionMsg(null)} style={{ cursor: 'pointer', fontSize: '16px' }}>×</span>
        </div>
      )}

      {/* View mode toggle */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {['submissions', 'browser'].map(mode => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            style={{
              padding: '8px 20px', fontSize: '13px', fontWeight: 600,
              background: viewMode === mode ? 'rgba(124, 92, 191, 0.15)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${viewMode === mode ? '#7c5cbf' : 'var(--glass-border)'}`,
              borderRadius: '8px',
              color: viewMode === mode ? '#7c5cbf' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {mode === 'submissions' ? 'Submissions' : 'Photo Browser'}
          </button>
        ))}
      </div>

      {/* Summary stats */}
      <div className="card-grid" style={{ marginBottom: '24px' }}>
        <div className="glass-card">
          <h3>🏛️ Submissions</h3>
          <div style={{ fontSize: '36px', fontWeight: 600, color: '#7c5cbf' }}>
            {submissions.length}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Active calls</div>
        </div>
        <div className="glass-card">
          <h3>📸 Portfolio</h3>
          <div style={{ fontSize: '36px', fontWeight: 600, color: '#7c5cbf' }}>
            {portfolioSize} / 200
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Images submitted</div>
        </div>
        <div className="glass-card">
          <h3>📐 Selected</h3>
          <div style={{ fontSize: '36px', fontWeight: 600, color: '#7c5cbf' }}>
            {selectedPhotos.size} / 10
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>For new submission</div>
        </div>
        <div className="glass-card">
          <h3>✅ Ready</h3>
          <div style={{ fontSize: '36px', fontWeight: 600, color: '#7c5cbf' }}>
            {validPhotoCount}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Pass validation</div>
        </div>
      </div>

      {/* ────────── SUBMISSIONS VIEW ────────── */}
      {viewMode === 'submissions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {submissions.map(submission => {
            const isExpanded = expanded === submission.id;
            return (
              <div key={submission.id} className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Header */}
                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '16px 20px', cursor: 'pointer',
                    borderBottom: isExpanded ? '1px solid var(--glass-border)' : 'none',
                  }}
                  onClick={() => setExpanded(isExpanded ? null : submission.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      padding: '4px 10px', fontSize: '11px', fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      borderRadius: '20px', background: 'rgba(124, 92, 191, 0.12)', color: '#7c5cbf',
                    }}>CaFE</span>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {submission.call_name}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      fontSize: '12px', color: 'var(--text-muted)',
                    }}>
                      {submission.images?.length || 0} images
                    </span>
                    <span style={{
                      fontSize: '12px', color: 'var(--text-muted)',
                    }}>
                      {new Date(submission.exported_at).toLocaleDateString()}
                    </span>
                    <span style={{
                      fontSize: '14px', color: 'var(--text-muted)',
                      transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s',
                    }}>{'\u25BC'}</span>
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div style={{ padding: '20px' }}>
                    {/* Image grid */}
                    {submission.images && submission.images.length > 0 && (
                      <div style={{ marginBottom: '16px' }}>
                        <div style={{
                          fontSize: '11px', color: 'var(--text-secondary)',
                          textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px',
                        }}>
                          Images ({submission.images.length})
                        </div>
                        <div style={{
                          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '12px',
                        }}>
                          {submission.images.map((img, idx) => (
                            <div key={idx} style={{
                              border: '1px solid var(--glass-border)', borderRadius: '8px', overflow: 'hidden',
                            }}>
                              <img
                                src={img.thumbnail_url}
                                alt={img.title}
                                style={{
                                  width: '100%', height: '80px', objectFit: 'cover',
                                  backgroundColor: 'var(--bg-tertiary)',
                                }}
                              />
                              <div style={{
                                padding: '8px', fontSize: '10px', color: 'var(--text-muted)',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              }}>
                                {img.title}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Metadata preview */}
                    {submission.images && submission.images.length > 0 && (
                      <div style={{
                        marginBottom: '16px', padding: '16px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-sm)',
                        fontSize: '12px',
                      }}>
                        <div style={{
                          fontSize: '11px', color: 'var(--text-secondary)',
                          textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px', fontWeight: 600,
                        }}>
                          Field Validation
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {submission.images.slice(0, 3).map((img, idx) => (
                            <div key={idx} style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              paddingBottom: '6px', borderBottom: idx < 2 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                            }}>
                              <span style={{ color: 'var(--text-muted)' }}>
                                {img.title.substring(0, 30)}...
                              </span>
                              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                  Title: {img.title?.length || 0}/{CAFE_LIMITS.title}
                                </span>
                                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                  Desc: {img.description?.length || 0}/{CAFE_LIMITS.description}
                                </span>
                              </div>
                            </div>
                          ))}
                          {submission.images.length > 3 && (
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                              + {submission.images.length - 3} more images
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
                      paddingTop: '16px', borderTop: '1px solid var(--glass-border)',
                    }}>
                      <button
                        onClick={() => handleExportFolder(submission.id)}
                        style={{
                          padding: '8px 20px', fontSize: '13px', fontWeight: 600,
                          background: 'rgba(124, 92, 191, 0.15)', border: '1px solid #7c5cbf',
                          borderRadius: 'var(--radius-sm)', color: '#7c5cbf', cursor: 'pointer',
                        }}
                      >
                        Export Folder
                      </button>
                      <button
                        onClick={() => handleCopyMetadata(submission)}
                        style={{
                          padding: '8px 20px', fontSize: '13px', fontWeight: 600,
                          background: copiedSubmissionId === submission.id
                            ? 'rgba(74, 222, 128, 0.15)' : 'rgba(255,255,255,0.05)',
                          border: `1px solid ${copiedSubmissionId === submission.id ? 'var(--success)' : 'var(--glass-border)'}`,
                          borderRadius: 'var(--radius-sm)',
                          color: copiedSubmissionId === submission.id ? 'var(--success)' : 'var(--text-muted)',
                          cursor: 'pointer',
                        }}
                      >
                        {copiedSubmissionId === submission.id ? '✓ Copied' : 'Copy Metadata'}
                      </button>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        Exported: {new Date(submission.exported_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {submissions.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
              No CaFE submissions yet. Use Photo Browser to create a new submission.
            </div>
          )}
        </div>
      )}

      {/* ────────── PHOTO BROWSER VIEW ────────── */}
      {viewMode === 'browser' && (
        <div>
          {/* Photo grid */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{
              fontSize: '11px', color: 'var(--text-secondary)',
              textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px',
            }}>
              Available Photos ({allPhotos.length})
            </div>
            {allPhotos.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                No photos available. Import photos from the Photo Import tab.
              </div>
            ) : (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px',
              }}>
                {allPhotos.map(photo => {
                  const isSelected = selectedPhotos.has(photo.id);
                  const isValid = isPhotoValid(photo);
                  const thumbUrl = `https://archive-35.com/images/${photo.collection}/${photo.filename.replace(/\.[^/.]+$/, '')}-thumb.jpg`;

                  return (
                    <div
                      key={photo.id}
                      onClick={() => handleTogglePhoto(photo.id)}
                      style={{
                        position: 'relative', cursor: 'pointer',
                        border: isSelected ? '3px solid #7c5cbf' : '1px solid var(--glass-border)',
                        borderRadius: '8px', overflow: 'hidden',
                        backgroundColor: 'var(--bg-tertiary)',
                      }}
                    >
                      <img
                        src={thumbUrl}
                        alt={photo.title}
                        style={{
                          width: '100%', aspectRatio: '1', objectFit: 'cover',
                        }}
                        onError={(e) => {
                          e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="160"%3E%3Crect fill="%23333" width="160" height="160"/%3E%3C/svg%3E';
                        }}
                      />

                      {/* Selection checkmark */}
                      {isSelected && (
                        <div style={{
                          position: 'absolute', top: '8px', right: '8px',
                          width: '24px', height: '24px', borderRadius: '50%',
                          backgroundColor: '#7c5cbf', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'white', fontSize: '14px', fontWeight: 600,
                        }}>
                          ✓
                        </div>
                      )}

                      {/* Validity indicator */}
                      {!isValid && (
                        <div style={{
                          position: 'absolute', bottom: '0', left: '0', right: '0',
                          background: 'rgba(239, 68, 68, 0.8)', color: 'white',
                          fontSize: '10px', padding: '4px', textAlign: 'center',
                          fontWeight: 600,
                        }}>
                          Invalid
                        </div>
                      )}

                      {/* Info overlay */}
                      <div style={{
                        position: 'absolute', bottom: '0', left: '0', right: '0',
                        padding: '8px', background: 'rgba(0, 0, 0, 0.6)', color: 'white',
                      }}>
                        <div style={{
                          fontSize: '10px', fontWeight: 600,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {photo.title}
                        </div>
                        <div style={{
                          fontSize: '9px', color: 'rgba(255,255,255,0.7)',
                        }}>
                          {photo.collection} • {photo.year}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Submission rack (always visible in browser view) */}
          {allPhotos.length > 0 && (
            <div className="glass-card" style={{ padding: '20px' }}>
              <div style={{
                fontSize: '11px', color: 'var(--text-secondary)',
                textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '16px',
              }}>
                Submission Rack ({selectedPhotos.size} / 10)
              </div>

              {selectedPhotos.size === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                  Select up to 10 photos above to create a new submission
                </div>
              ) : (
                <div>
                  {/* Selected photos horizontal scroll */}
                  <div style={{
                    display: 'flex', gap: '12px', overflowX: 'auto', marginBottom: '20px', paddingBottom: '8px',
                  }}>
                    {Array.from(selectedPhotos).map(photoId => {
                      const photo = allPhotos.find(p => p.id === photoId);
                      if (!photo) return null;
                      const thumbUrl = `https://archive-35.com/images/${photo.collection}/${photo.filename.replace(/\.[^/.]+$/, '')}-thumb.jpg`;

                      return (
                        <div key={photoId} style={{
                          position: 'relative', flexShrink: 0,
                        }}>
                          <img
                            src={thumbUrl}
                            alt={photo.title}
                            style={{
                              width: '80px', height: '80px', objectFit: 'cover', borderRadius: '6px',
                              border: '2px solid #7c5cbf',
                            }}
                          />
                          <button
                            onClick={() => handleTogglePhoto(photoId)}
                            style={{
                              position: 'absolute', top: '-8px', right: '-8px',
                              width: '24px', height: '24px', borderRadius: '50%',
                              backgroundColor: 'var(--danger)', border: 'none', color: 'white',
                              cursor: 'pointer', fontWeight: 600, fontSize: '14px',
                            }}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Metadata overrides */}
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px',
                    paddingTop: '16px', borderTop: '1px solid var(--glass-border)',
                  }}>
                    {Array.from(selectedPhotos).map(photoId => {
                      const photo = allPhotos.find(p => p.id === photoId);
                      if (!photo) return null;
                      const meta = photoMetadata[photoId] || {};
                      const title = meta.title || photo.title || '';
                      const desc = meta.description || photo.description || '';

                      return (
                        <div key={photoId} style={{
                          padding: '12px', background: 'var(--bg-primary)',
                          border: '1px solid var(--glass-border)', borderRadius: '6px',
                        }}>
                          <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>
                            {photo.title}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div>
                              <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                                Title <CharCounter value={title} limit={CAFE_LIMITS.title} />
                              </label>
                              <input
                                type="text"
                                value={title}
                                onChange={(e) => handleMetadataChange(photoId, 'title', e.target.value)}
                                maxLength={CAFE_LIMITS.title}
                                style={{
                                  width: '100%', padding: '6px', fontSize: '12px',
                                  background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)',
                                  borderRadius: '4px', color: 'var(--text-primary)', boxSizing: 'border-box',
                                }}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                                Description <CharCounter value={desc} limit={CAFE_LIMITS.description} />
                              </label>
                              <textarea
                                value={desc}
                                onChange={(e) => handleMetadataChange(photoId, 'description', e.target.value)}
                                maxLength={CAFE_LIMITS.description}
                                style={{
                                  width: '100%', padding: '6px', fontSize: '12px', minHeight: '60px',
                                  background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)',
                                  borderRadius: '4px', color: 'var(--text-primary)', boxSizing: 'border-box',
                                  fontFamily: 'inherit', resize: 'vertical',
                                }}
                              />
                            </div>
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
                      width: '100%', padding: '12px 20px', fontSize: '13px', fontWeight: 600,
                      background: selectedPhotos.size > 0 ? 'rgba(124, 92, 191, 0.15)' : 'rgba(128, 128, 128, 0.1)',
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
          )}
        </div>
      )}

      {error && (
        <div style={{
          marginTop: '16px', padding: '12px',
          background: 'rgba(248, 113, 113, 0.1)',
          border: '1px solid var(--danger)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--danger)', fontSize: '13px',
        }}>{error}</div>
      )}
    </div>
  );
}

export default AgentCafeExport;
