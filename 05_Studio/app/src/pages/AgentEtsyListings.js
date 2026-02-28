import React, { useState, useEffect, useCallback } from 'react';
import useAgentApi from '../hooks/useAgentApi';

/**
 * AgentEtsyListings — Etsy listing management with SKU/pricing breakdown.
 * Supports approve, publish, delete, and copy-to-clipboard for manual listing.
 *
 * SHARED ZONE: Changes here must be tested in both Studio and Agent tabs.
 */
function AgentEtsyListings() {
  const { get, post, del, loading, error } = useAgentApi();
  const [listings, setListings] = useState([]);
  const [etsyListings, setEtsyListings] = useState([]); // Live Etsy listings
  const [skus, setSkus] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [selectedSkus, setSelectedSkus] = useState({});
  const [publishing, setPublishing] = useState({});
  const [publishResults, setPublishResults] = useState({});
  const [actionMsg, setActionMsg] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedEtsyListings, setSelectedEtsyListings] = useState(new Set());
  const [viewMode, setViewMode] = useState('content'); // 'content' | 'live'
  const [copiedId, setCopiedId] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const [listingData, skuData] = await Promise.all([
        get('/etsy/listings'),
        get('/skus'),
      ]);
      // Content queue listings
      setListings(listingData.items || []);
      setSkus(skuData.items || []);

      // Fetch live Etsy listings from the actual Etsy API
      const [liveActive, liveDraft] = await Promise.all([
        get('/etsy/listings/live?state=active&limit=100').catch(() => ({ results: [] })),
        get('/etsy/listings/live?state=draft&limit=100').catch(() => ({ results: [] })),
      ]);
      const allLive = [
        ...(liveActive?.results || []).map(l => ({ ...l, _state: 'active' })),
        ...(liveDraft?.results || []).map(l => ({ ...l, _state: 'draft' })),
      ];
      setEtsyListings(allLive);
    } catch { /* error shown via hook */ }
  }, []);

  useEffect(() => { loadData(); }, []);

  const skusByPhoto = {};
  skus.forEach(s => {
    if (!skusByPhoto[s.photo_id]) skusByPhoto[s.photo_id] = [];
    skusByPhoto[s.photo_id].push(s);
  });

  // ── Handlers ─────────────────────────────────────────────

  const handleApprove = async (contentId) => {
    try {
      await post(`/content/${contentId}/approve`);
      setActionMsg({ type: 'success', text: 'Content approved' });
      loadData();
    } catch (err) {
      setActionMsg({ type: 'error', text: `Approve failed: ${err.message || err}` });
    }
  };

  const toggleSku = (contentId, sku) => {
    setSelectedSkus(prev => {
      const set = new Set(prev[contentId] || []);
      if (set.has(sku)) set.delete(sku); else set.add(sku);
      return { ...prev, [contentId]: set };
    });
  };

  const toggleAllSkus = (contentId, photoSkus) => {
    setSelectedSkus(prev => {
      const current = prev[contentId] || new Set();
      const allSelected = photoSkus.every(s => current.has(s.sku));
      return {
        ...prev,
        [contentId]: allSelected ? new Set() : new Set(photoSkus.map(s => s.sku)),
      };
    });
  };

  const handlePublish = async (contentId) => {
    const skuSet = selectedSkus[contentId];
    if (!skuSet || skuSet.size === 0) {
      setActionMsg({ type: 'error', text: 'Select at least one SKU variation to publish' });
      return;
    }
    setPublishing(prev => ({ ...prev, [contentId]: 'publishing' }));
    setActionMsg(null);
    try {
      const result = await post('/etsy/listings/create-batch', {
        content_id: contentId,
        sku_list: Array.from(skuSet),
      });
      setPublishing(prev => ({ ...prev, [contentId]: 'done' }));
      setPublishResults(prev => ({ ...prev, [contentId]: result }));
      setActionMsg({
        type: 'success',
        text: `Published ${result.created}/${result.total} listings to Etsy`,
      });
      loadData();
    } catch (err) {
      setPublishing(prev => ({ ...prev, [contentId]: 'error' }));
      setActionMsg({ type: 'error', text: `Publish failed: ${err.message || err}` });
    }
  };

  // ── Delete handlers ────────────────────────────────────────

  const handleDeleteEtsyListing = async (listingId) => {
    if (!window.confirm(`Delete Etsy listing #${listingId}? This is permanent.`)) return;
    setDeleting(true);
    try {
      await del(`/etsy/listings/${listingId}`);
      setActionMsg({ type: 'success', text: `Deleted Etsy listing #${listingId}` });
      loadData();
    } catch (err) {
      setActionMsg({ type: 'error', text: `Delete failed: ${err.message}` });
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteSelectedEtsy = async () => {
    if (selectedEtsyListings.size === 0) return;
    if (!window.confirm(`Delete ${selectedEtsyListings.size} Etsy listing(s)? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const result = await post('/etsy/listings/delete-batch', {
        listing_ids: Array.from(selectedEtsyListings),
      });
      setActionMsg({
        type: result.deleted > 0 ? 'success' : 'error',
        text: `Deleted ${result.deleted}/${result.total} Etsy listings`,
      });
      setSelectedEtsyListings(new Set());
      loadData();
    } catch (err) {
      setActionMsg({ type: 'error', text: `Batch delete failed: ${err.message}` });
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteAllEtsy = async () => {
    if (etsyListings.length === 0) return;
    if (!window.confirm(`DELETE ALL ${etsyListings.length} Etsy listings? This cannot be undone!`)) return;
    setDeleting(true);
    try {
      const allIds = etsyListings.map(l => l.listing_id);
      const result = await post('/etsy/listings/delete-batch', { listing_ids: allIds });
      setActionMsg({
        type: result.deleted > 0 ? 'success' : 'error',
        text: `Deleted ${result.deleted}/${result.total} listings from Etsy`,
      });
      setSelectedEtsyListings(new Set());
      loadData();
    } catch (err) {
      setActionMsg({ type: 'error', text: `Delete all failed: ${err.message}` });
    } finally {
      setDeleting(false);
    }
  };

  // ── Copy to clipboard for manual Etsy listing ──────────────

  const handleCopyForManualListing = (item) => {
    const photoSkuList = skusByPhoto[item.photo_id] || [];
    let tags = [];
    try { tags = JSON.parse(item.tags || '[]'); } catch {}

    const clipText = [
      `TITLE: ${item.title || item.filename}`,
      '',
      `DESCRIPTION:`,
      item.body || '(no description)',
      '',
      `TAGS (comma-separated, paste into Etsy):`,
      tags.join(', '),
      '',
      photoSkuList.length > 0 ? `PRICING:` : '',
      ...photoSkuList.map(s => `  ${s.size_code} ${s.paper_code}: $${s.list_price_usd.toFixed(2)}`),
      '',
      `IMAGE: https://archive-35.com/images/${item.collection}/${item.filename}`,
    ].join('\n');

    navigator.clipboard.writeText(clipText).then(() => {
      setCopiedId(item.id);
      setActionMsg({ type: 'success', text: 'Listing details copied — paste into Etsy manual listing form' });
      setTimeout(() => setCopiedId(null), 3000);
    }).catch(() => {
      setActionMsg({ type: 'error', text: 'Clipboard copy failed' });
    });
  };

  const handleDeleteContent = async (contentId) => {
    if (!window.confirm('Delete this content item from the queue?')) return;
    try {
      await del(`/content/${contentId}`);
      setActionMsg({ type: 'success', text: 'Content item deleted' });
      loadData();
    } catch (err) {
      setActionMsg({ type: 'error', text: `Delete failed: ${err.message || err}` });
    }
  };

  const toggleEtsyListing = (id) => {
    setSelectedEtsyListings(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="page">
      <header className="page-header">
        <h2>Etsy Listings</h2>
        <p className="page-subtitle">
          Review, approve, publish, and manage Etsy listings
        </p>
      </header>

      {/* Connection status — only show if no OAuth token */}
      {etsyListings.length === 0 && listings.length === 0 && !loading && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(212, 165, 116, 0.08)',
          border: '1px solid rgba(212, 165, 116, 0.25)',
          borderRadius: '8px',
          color: 'var(--accent)',
          fontSize: '13px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span style={{ fontSize: '18px' }}>{'🏷️'}</span>
          <span>
            No listings yet. Use <strong>Compose</strong> to create Etsy drafts directly via the API.
          </span>
        </div>
      )}

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
        {['content', 'live'].map(mode => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            style={{
              padding: '8px 20px', fontSize: '13px', fontWeight: 600,
              background: viewMode === mode ? 'rgba(212, 165, 116, 0.15)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${viewMode === mode ? 'var(--accent)' : 'var(--glass-border)'}`,
              borderRadius: '8px',
              color: viewMode === mode ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {mode === 'content' ? 'Content Queue' : 'Live on Etsy'}
          </button>
        ))}
      </div>

      {/* Summary stats */}
      <div className="card-grid" style={{ marginBottom: '24px' }}>
        <div className="glass-card">
          <h3>{'🏷️'} Queue</h3>
          <div style={{ fontSize: '36px', fontWeight: 600, color: 'var(--accent)' }}>
            {listings.length}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Content items ready</div>
        </div>
        <div className="glass-card">
          <h3>{'🛒'} Live</h3>
          <div style={{ fontSize: '36px', fontWeight: 600, color: 'var(--accent)' }}>
            {etsyListings.filter(l => (l._state || l.state) === 'active').length}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Active on Etsy</div>
          {etsyListings.filter(l => (l._state || l.state) === 'draft').length > 0 && (
            <div style={{ fontSize: '11px', color: '#eab308', marginTop: '4px' }}>
              + {etsyListings.filter(l => (l._state || l.state) === 'draft').length} drafts
            </div>
          )}
        </div>
        <div className="glass-card">
          <h3>{'📦'} SKUs</h3>
          <div style={{ fontSize: '36px', fontWeight: 600, color: 'var(--accent)' }}>
            {skus.length}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Products in catalog</div>
        </div>
        <div className="glass-card">
          <h3>{'📐'} Price Range</h3>
          {skus.length > 0 ? (
            <div style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)' }}>
              ${Math.min(...skus.map(s => s.list_price_usd)).toFixed(0)}
              {' — '}
              ${Math.max(...skus.map(s => s.list_price_usd)).toFixed(0)}
            </div>
          ) : (
            <div style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-muted)' }}>{'—'}</div>
          )}
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Retail price range</div>
        </div>
      </div>

      {/* ────────── CONTENT QUEUE VIEW ────────── */}
      {viewMode === 'content' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {listings.map(item => {
            const isExpanded = expanded === item.id;
            const photoSkus = skusByPhoto[item.photo_id] || [];
            const selected = selectedSkus[item.id] || new Set();
            const pubState = publishing[item.id] || 'idle';
            const pubResult = publishResults[item.id];

            return (
              <div key={item.id} className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Header */}
                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '16px 20px', cursor: 'pointer',
                    borderBottom: isExpanded ? '1px solid var(--glass-border)' : 'none',
                  }}
                  onClick={() => setExpanded(isExpanded ? null : item.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {item.collection && item.filename && (
                      <img
                        src={`https://archive-35.com/images/${item.collection}/thumbnails/${item.filename}`}
                        alt=""
                        style={{
                          width: '48px', height: '32px', objectFit: 'cover',
                          borderRadius: '4px', border: '1px solid var(--glass-border)',
                        }}
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    )}
                    <span style={{
                      padding: '4px 10px', fontSize: '11px', fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      borderRadius: '20px', background: 'rgba(241, 100, 30, 0.12)', color: '#f1641e',
                    }}>Etsy</span>
                    <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{item.filename}</span>
                    {item.collection && (
                      <span style={{
                        fontSize: '10px', padding: '2px 6px',
                        background: 'rgba(212, 165, 116, 0.15)', color: 'var(--accent)', borderRadius: '10px',
                      }}>{item.collection}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className={`status-badge ${
                      item.status === 'approved' ? 'online' :
                      item.status === 'posted' ? 'online' :
                      item.status === 'pending' ? 'pending' : 'not-created'
                    }`}>{item.status}</span>
                    {pubState === 'done' && (
                      <span style={{
                        fontSize: '10px', padding: '3px 8px',
                        background: 'rgba(74, 222, 128, 0.15)', color: 'var(--success)', borderRadius: '10px',
                      }}>Published</span>
                    )}
                    <span style={{
                      fontSize: '14px', color: 'var(--text-muted)',
                      transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s',
                    }}>{'\u25BC'}</span>
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div style={{ padding: '20px' }}>
                    <div style={{
                      padding: '16px', background: 'var(--bg-primary)',
                      border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-sm)',
                      fontSize: '13px', color: 'var(--text-primary)',
                      lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: '250px', overflowY: 'auto',
                      marginBottom: '16px',
                    }}>{item.body}</div>

                    {/* Tags */}
                    {item.tags && (
                      <div style={{ marginBottom: '16px' }}>
                        <div style={{
                          fontSize: '11px', color: 'var(--text-secondary)',
                          textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px',
                        }}>
                          Tags ({(() => { try { return JSON.parse(item.tags).length; } catch { return 0; } })()}/13)
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {(() => { try { return JSON.parse(item.tags); } catch { return []; } })().map((tag, i) => (
                            <span key={i} style={{
                              fontSize: '10px', padding: '3px 10px',
                              background: 'rgba(241, 100, 30, 0.08)',
                              border: '1px solid rgba(241, 100, 30, 0.2)',
                              borderRadius: '10px', color: '#f1641e',
                            }}>{tag}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* SKU table */}
                    {photoSkus.length > 0 && (
                      <div>
                        <div style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px',
                        }}>
                          <div style={{
                            fontSize: '11px', color: 'var(--text-secondary)',
                            textTransform: 'uppercase', letterSpacing: '0.1em',
                          }}>SKU Pricing — Select variations to publish</div>
                          <label style={{
                            fontSize: '11px', color: 'var(--text-muted)',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                          }}>
                            <input
                              type="checkbox"
                              checked={photoSkus.length > 0 && photoSkus.every(s => selected.has(s.sku))}
                              onChange={() => toggleAllSkus(item.id, photoSkus)}
                              style={{ accentColor: 'var(--accent)' }}
                            />
                            Select all
                          </label>
                        </div>
                        <div style={{
                          border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden',
                        }}>
                          <div style={{
                            display: 'grid', gridTemplateColumns: '32px 1fr 80px 80px 80px 80px 80px',
                            padding: '8px 12px', background: 'var(--bg-tertiary)',
                            fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)',
                            textTransform: 'uppercase', letterSpacing: '0.05em',
                          }}>
                            <span></span><span>SKU</span><span>Size</span><span>Paper</span>
                            <span>Cost</span><span>Min</span><span>Retail</span>
                          </div>
                          {photoSkus.map(sku => (
                            <div key={sku.sku} style={{
                              display: 'grid', gridTemplateColumns: '32px 1fr 80px 80px 80px 80px 80px',
                              padding: '8px 12px', borderTop: '1px solid var(--glass-border)', fontSize: '12px',
                              background: selected.has(sku.sku) ? 'rgba(241, 100, 30, 0.04)' : 'transparent',
                            }}>
                              <span style={{ display: 'flex', alignItems: 'center' }}>
                                <input type="checkbox" checked={selected.has(sku.sku)}
                                  onChange={() => toggleSku(item.id, sku.sku)}
                                  style={{ accentColor: 'var(--accent)' }} />
                              </span>
                              <span style={{ fontFamily: 'monospace', color: 'var(--accent)', fontSize: '11px' }}>{sku.sku}</span>
                              <span style={{ color: 'var(--text-secondary)' }}>{sku.size_code}</span>
                              <span style={{ color: 'var(--text-secondary)' }}>{sku.paper_code}</span>
                              <span style={{ color: 'var(--text-muted)' }}>${sku.base_cost_usd.toFixed(2)}</span>
                              <span style={{ color: 'var(--warning)' }}>${sku.min_price_usd.toFixed(2)}</span>
                              <span style={{ color: 'var(--success)', fontWeight: 600 }}>${sku.list_price_usd.toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Publish results */}
                    {pubResult && (
                      <div style={{
                        marginTop: '12px', padding: '12px',
                        background: 'rgba(74, 222, 128, 0.06)', border: '1px solid rgba(74, 222, 128, 0.2)',
                        borderRadius: 'var(--radius-sm)', fontSize: '12px',
                      }}>
                        <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--success)' }}>
                          Publish Results: {pubResult.created}/{pubResult.total} created
                        </div>
                        {(pubResult.results || []).map((r, i) => (
                          <div key={i} style={{
                            display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px', padding: '2px 0',
                          }}>
                            <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{r.sku}</span>
                            <span style={{
                              padding: '1px 6px', borderRadius: '8px', fontSize: '10px',
                              background: r.status === 'created' ? 'rgba(74, 222, 128, 0.15)' : 'rgba(248, 113, 113, 0.15)',
                              color: r.status === 'created' ? 'var(--success)' : 'var(--danger)',
                            }}>{r.status}</span>
                            {r.listing_id && <span style={{ color: 'var(--text-muted)' }}>Etsy #{r.listing_id}</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
                      marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--glass-border)',
                    }}>
                      {item.status === 'pending' && (
                        <button onClick={() => handleApprove(item.id)} disabled={loading}
                          style={{
                            padding: '8px 20px', fontSize: '13px', fontWeight: 600,
                            background: 'rgba(74, 222, 128, 0.15)', border: '1px solid var(--success)',
                            borderRadius: 'var(--radius-sm)', color: 'var(--success)', cursor: 'pointer',
                          }}>Approve Content</button>
                      )}

                      {(item.status === 'approved' || item.status === 'pending') && (
                        <button onClick={() => handlePublish(item.id)}
                          disabled={pubState === 'publishing' || selected.size === 0}
                          style={{
                            padding: '8px 20px', fontSize: '13px', fontWeight: 600,
                            background: selected.size > 0 ? 'rgba(241, 100, 30, 0.15)' : 'rgba(128, 128, 128, 0.1)',
                            border: `1px solid ${selected.size > 0 ? '#f1641e' : 'var(--text-muted)'}`,
                            borderRadius: 'var(--radius-sm)',
                            color: selected.size > 0 ? '#f1641e' : 'var(--text-muted)',
                            cursor: selected.size > 0 ? 'pointer' : 'not-allowed',
                            opacity: pubState === 'publishing' ? 0.6 : 1,
                          }}>
                          {pubState === 'publishing' ? 'Publishing...'
                            : `Publish to Etsy (${selected.size} SKU${selected.size !== 1 ? 's' : ''})`}
                        </button>
                      )}

                      {/* Delete from queue */}
                      <button onClick={() => handleDeleteContent(item.id)}
                        style={{
                          padding: '8px 20px', fontSize: '13px', fontWeight: 600,
                          background: 'rgba(239, 68, 68, 0.08)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: 'var(--radius-sm)',
                          color: '#ef4444',
                          cursor: 'pointer',
                        }}>
                        Delete
                      </button>

                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Created: {new Date(item.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {listings.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
              No Etsy listings generated yet. Run the pipeline to create content.
            </div>
          )}
        </div>
      )}

      {/* ────────── LIVE ETSY LISTINGS VIEW ────────── */}
      {viewMode === 'live' && (
        <div className="glass-card">
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px',
          }}>
            <h3 style={{ margin: 0 }}>Live Etsy Listings</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              {etsyListings.length > 0 && (
                <>
                  <button onClick={handleDeleteSelectedEtsy}
                    disabled={deleting || selectedEtsyListings.size === 0}
                    style={{
                      padding: '6px 14px', fontSize: '12px', fontWeight: 600,
                      background: selectedEtsyListings.size > 0 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(128,128,128,0.08)',
                      border: `1px solid ${selectedEtsyListings.size > 0 ? 'var(--danger)' : 'var(--glass-border)'}`,
                      borderRadius: '6px',
                      color: selectedEtsyListings.size > 0 ? 'var(--danger)' : 'var(--text-muted)',
                      cursor: selectedEtsyListings.size > 0 ? 'pointer' : 'not-allowed',
                    }}>Delete Selected ({selectedEtsyListings.size})</button>
                  <button onClick={handleDeleteAllEtsy} disabled={deleting}
                    style={{
                      padding: '6px 14px', fontSize: '12px', fontWeight: 600,
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px', color: '#ef4444', cursor: 'pointer',
                    }}>Delete All</button>
                </>
              )}
              <button onClick={loadData} disabled={loading}
                style={{
                  padding: '6px 14px', fontSize: '12px',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)',
                  borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer',
                }}>Refresh</button>
            </div>
          </div>

          {/* Select all */}
          {etsyListings.length > 0 && (
            <label style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px', cursor: 'pointer',
            }}>
              <input type="checkbox"
                checked={etsyListings.length > 0 && selectedEtsyListings.size === etsyListings.length}
                onChange={() => {
                  if (selectedEtsyListings.size === etsyListings.length) {
                    setSelectedEtsyListings(new Set());
                  } else {
                    setSelectedEtsyListings(new Set(etsyListings.map(l => l.listing_id)));
                  }
                }}
                style={{ accentColor: 'var(--danger)' }}
              />
              Select all ({etsyListings.length})
            </label>
          )}

          {etsyListings.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: '14px' }}>
              {loading ? 'Loading...' : 'No live Etsy listings found — connect OAuth in Settings or create from Compose'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {etsyListings.map(listing => (
                <div key={listing.listing_id} style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '12px 16px',
                  background: selectedEtsyListings.has(listing.listing_id)
                    ? 'rgba(239, 68, 68, 0.04)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${selectedEtsyListings.has(listing.listing_id) ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: '8px',
                }}>
                  <input type="checkbox"
                    checked={selectedEtsyListings.has(listing.listing_id)}
                    onChange={() => toggleEtsyListing(listing.listing_id)}
                    style={{ accentColor: 'var(--danger)' }}
                  />
                  {listing.images?.[0]?.url_75x75 && (
                    <img src={listing.images[0].url_75x75} alt=""
                      style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '13px', color: 'var(--text)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{listing.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                      <span>#{listing.listing_id}</span>
                      <span style={{
                        padding: '1px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600,
                        background: (listing._state || listing.state) === 'active' ? 'rgba(74, 222, 128, 0.15)' : 'rgba(234, 179, 8, 0.15)',
                        color: (listing._state || listing.state) === 'active' ? 'var(--success)' : '#eab308',
                      }}>{listing._state || listing.state}</span>
                      {listing.price?.amount && <span>${(listing.price.amount / listing.price.divisor).toFixed(2)}</span>}
                      {listing.quantity != null && <span>{listing.quantity} qty</span>}
                    </div>
                  </div>
                  <a href={`https://www.etsy.com/your/shops/me/tools/listings/${listing.listing_id}`}
                    target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      padding: '4px 10px', fontSize: '11px',
                      background: 'rgba(212, 165, 116, 0.08)',
                      border: '1px solid rgba(212, 165, 116, 0.25)',
                      borderRadius: '4px', color: 'var(--accent)',
                      textDecoration: 'none', whiteSpace: 'nowrap',
                    }}>View on Etsy</a>
                  <button onClick={() => handleDeleteEtsyListing(listing.listing_id)}
                    disabled={deleting}
                    style={{
                      padding: '4px 10px', fontSize: '11px',
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      borderRadius: '4px', color: '#ef4444', cursor: 'pointer',
                    }}>Delete</button>
                </div>
              ))}
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

export default AgentEtsyListings;
