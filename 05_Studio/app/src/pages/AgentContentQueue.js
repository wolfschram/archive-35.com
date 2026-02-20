import React, { useState, useEffect } from 'react';
import useAgentApi from '../hooks/useAgentApi';
import PinterestPreview from '../components/PinterestPreview';
import InstagramPreview from '../components/InstagramPreview';
import EtsyPreview from '../components/EtsyPreview';

/**
 * AgentContentQueue — Approve/reject/edit AI-generated content.
 * Dual-view mode: Card View (text-only) or Preview View (platform-specific previews).
 */
function AgentContentQueue() {
  const { get, post, loading, error } = useAgentApi();
  const [items, setItems] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [platformFilter, setPlatformFilter] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [viewMode, setViewMode] = useState('card'); // 'card' or 'preview'

  const loadContent = async () => {
    try {
      let params = `?limit=50`;
      if (statusFilter) params += `&status=${statusFilter}`;
      if (platformFilter) params += `&platform=${platformFilter}`;
      const data = await get(`/content${params}`);
      setItems(data.items || []);
    } catch { /* error shown via hook */ }
  };

  useEffect(() => { loadContent(); }, [statusFilter, platformFilter]);

  const handleAction = async (contentId, action) => {
    try {
      await post(`/content/${contentId}/${action}`);
      await loadContent();
    } catch (err) {
      console.error(`${action} failed:`, err);
    }
  };

  const platformColors = {
    pinterest: { bg: 'rgba(230, 0, 35, 0.12)', color: '#e60023' },
    instagram: { bg: 'rgba(225, 48, 108, 0.12)', color: '#e1306c' },
    etsy: { bg: 'rgba(241, 100, 30, 0.12)', color: '#f1641e' },
  };

  return (
    <div className="page">
      <header className="page-header">
        <h2>Content Queue</h2>
        <p className="page-subtitle">
          Review and approve AI-generated content before posting
        </p>
      </header>

      {/* Filters and view mode toggle */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <span style={{
              fontSize: '11px', color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.1em',
              alignSelf: 'center',
            }}>
              Status
            </span>
            {['pending', 'approved', 'rejected', 'posted', ''].map(s => (
              <button
                key={s || 'all'}
                className={`btn ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '6px 12px', fontSize: '11px' }}
                onClick={() => setStatusFilter(s)}
              >
                {s || 'All'}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <span style={{
              fontSize: '11px', color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.1em',
              alignSelf: 'center',
            }}>
              Platform
            </span>
            {['', 'pinterest', 'instagram', 'etsy'].map(p => (
              <button
                key={p || 'all'}
                className={`btn ${platformFilter === p ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '6px 12px', fontSize: '11px' }}
                onClick={() => setPlatformFilter(p)}
              >
                {p || 'All'}
              </button>
            ))}
          </div>
        </div>

        {/* View Mode Toggle */}
        <div style={{ display: 'flex', gap: '6px', background: 'var(--glass-bg)', padding: '4px', borderRadius: '20px', border: '1px solid var(--glass-border)' }}>
          <button
            className={`btn ${viewMode === 'card' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '6px 12px', fontSize: '11px' }}
            onClick={() => setViewMode('card')}
          >
            📋 Card
          </button>
          <button
            className={`btn ${viewMode === 'preview' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '6px 12px', fontSize: '11px' }}
            onClick={() => setViewMode('preview')}
          >
            👁️ Preview
          </button>
        </div>
      </div>

      {/* Content rendering based on view mode */}
      {viewMode === 'card' ? (
        /* CARD VIEW — Text-only cards */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {items.map(item => {
            const pc = platformColors[item.platform] || { bg: 'var(--glass-bg)', color: 'var(--text-secondary)' };
            const isExpanded = expanded === item.id;

            return (
              <div
                key={item.id}
                className="glass-card"
                style={{ padding: '0', overflow: 'hidden' }}
              >
                {/* Card header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 20px',
                    cursor: 'pointer',
                    borderBottom: isExpanded ? '1px solid var(--glass-border)' : 'none',
                  }}
                  onClick={() => setExpanded(isExpanded ? null : item.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      padding: '4px 10px',
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderRadius: '20px',
                      background: pc.bg,
                      color: pc.color,
                    }}>
                      {item.platform}
                    </span>
                    <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                      {item.filename}
                    </span>
                    {item.collection && (
                      <span style={{
                        fontSize: '10px', padding: '2px 6px',
                        background: 'rgba(212, 165, 116, 0.15)',
                        color: 'var(--accent)', borderRadius: '10px',
                      }}>
                        {item.collection}
                      </span>
                    )}
                    <span style={{
                      fontSize: '10px', color: 'var(--text-muted)',
                    }}>
                      v{item.variant}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className={`status-badge ${
                      item.status === 'approved' ? 'online' :
                      item.status === 'pending' ? 'pending' :
                      item.status === 'posted' ? 'website' : 'not-created'
                    }`}>
                      {item.status}
                    </span>
                    <span style={{
                      fontSize: '14px', color: 'var(--text-muted)',
                      transform: isExpanded ? 'rotate(180deg)' : 'none',
                      transition: 'transform 0.2s',
                    }}>
                      {'\u25BC'}
                    </span>
                  </div>
                </div>

                {/* Expanded body */}
                {isExpanded && (
                  <div style={{ padding: '20px' }}>
                    {/* Photo thumbnail + metadata row */}
                    <div style={{
                      display: 'flex',
                      gap: '16px',
                      marginBottom: '16px',
                      alignItems: 'flex-start',
                    }}>
                      {item.thumbnail_url && (
                        <img
                          src={`http://127.0.0.1:8035${item.thumbnail_url}`}
                          alt={item.filename || 'Photo'}
                          style={{
                            width: '120px',
                            height: '120px',
                            borderRadius: '8px',
                            border: '1px solid var(--glass-border)',
                            objectFit: 'cover',
                            flexShrink: 0,
                          }}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: '15px',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          marginBottom: '4px',
                        }}>
                          {item.title || item.collection?.replace(/_/g, ' ') || item.filename}
                        </div>
                        {item.collection && (
                          <div style={{
                            fontSize: '12px',
                            color: 'var(--accent)',
                            marginBottom: '4px',
                          }}>
                            {item.collection.replace(/_/g, ' ')}
                          </div>
                        )}
                        <div style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                        }}>
                          {item.filename} · v{item.variant}
                        </div>
                      </div>
                    </div>

                    {/* Provenance */}
                    {item.provenance && (
                      <div style={{
                        padding: '12px',
                        background: 'rgba(212, 165, 116, 0.06)',
                        border: '1px solid rgba(212, 165, 116, 0.15)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '13px',
                        color: 'var(--text-secondary)',
                        fontStyle: 'italic',
                        marginBottom: '16px',
                        lineHeight: 1.5,
                      }}>
                        {item.provenance}
                      </div>
                    )}

                    {/* Generated content */}
                    <div style={{
                      padding: '16px',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px',
                      color: 'var(--text-primary)',
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      marginBottom: '16px',
                      maxHeight: '300px',
                      overflowY: 'auto',
                    }}>
                      {item.body}
                    </div>

                    {/* Tags */}
                    {item.tags && (
                      <div style={{
                        display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '16px',
                      }}>
                        {(() => {
                          try { return JSON.parse(item.tags); } catch { return []; }
                        })().map((tag, i) => (
                          <span key={i} style={{
                            fontSize: '10px', padding: '2px 8px',
                            background: 'var(--glass-bg)',
                            border: '1px solid var(--glass-border)',
                            borderRadius: '10px', color: 'var(--text-secondary)',
                          }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Action buttons */}
                    {item.status === 'pending' && (
                      <div className="button-group">
                        <button
                          className="btn btn-primary"
                          onClick={() => handleAction(item.id, 'approve')}
                          disabled={loading}
                        >
                          {'\u2713'} {item.platform === 'instagram' ? 'Approve & Publish' : 'Approve'}
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={() => handleAction(item.id, 'reject')}
                          disabled={loading}
                        >
                          {'\u2717'} Reject
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={() => handleAction(item.id, 'defer')}
                          disabled={loading}
                        >
                          Defer
                        </button>
                      </div>
                    )}

                    <div style={{
                      fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px',
                    }}>
                      Created: {new Date(item.created_at).toLocaleString()}
                      {item.expires_at && ` · Expires: ${new Date(item.expires_at).toLocaleString()}`}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {items.length === 0 && !loading && (
            <div style={{
              textAlign: 'center', padding: '48px', color: 'var(--text-muted)',
            }}>
              No content items matching filters
            </div>
          )}
        </div>
      ) : (
        /* PREVIEW VIEW — Platform-specific previews */
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'flex-start' }}>
          {items.map(item => {
            const thumbnailUrl = item.thumbnail_url
              ? `http://127.0.0.1:8035${item.thumbnail_url}`
              : null;

            return (
              <div key={item.id}>
                {item.platform === 'pinterest' && (
                  <PinterestPreview
                    content={item}
                    thumbnailUrl={thumbnailUrl}
                    onApprove={(id) => handleAction(id, 'approve')}
                    onReject={(id) => handleAction(id, 'reject')}
                    onDefer={(id) => handleAction(id, 'defer')}
                  />
                )}
                {item.platform === 'instagram' && (
                  <InstagramPreview
                    content={item}
                    thumbnailUrl={thumbnailUrl}
                    onApprove={(id) => handleAction(id, 'approve')}
                    onReject={(id) => handleAction(id, 'reject')}
                    onDefer={(id) => handleAction(id, 'defer')}
                  />
                )}
                {item.platform === 'etsy' && (
                  <EtsyPreview
                    content={item}
                    thumbnailUrl={thumbnailUrl}
                    onApprove={(id) => handleAction(id, 'approve')}
                    onReject={(id) => handleAction(id, 'reject')}
                    onDefer={(id) => handleAction(id, 'defer')}
                  />
                )}
              </div>
            );
          })}

          {items.length === 0 && !loading && (
            <div style={{
              textAlign: 'center', padding: '48px', color: 'var(--text-muted)',
            }}>
              No content items matching filters
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
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default AgentContentQueue;
