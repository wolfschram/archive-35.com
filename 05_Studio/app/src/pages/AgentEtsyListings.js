import React, { useState, useEffect, useCallback } from 'react';
import useAgentApi from '../hooks/useAgentApi';

/**
 * AgentEtsyListings — Preview Etsy listings with SKU/pricing breakdown.
 * Supports approve, select SKU variations, and publish-to-Etsy workflow.
 *
 * SHARED ZONE: Changes here must be tested in both Studio and Agent tabs.
 */
function AgentEtsyListings() {
  const { get, post, loading, error } = useAgentApi();
  const [listings, setListings] = useState([]);
  const [skus, setSkus] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [selectedSkus, setSelectedSkus] = useState({});   // { contentId: Set<sku> }
  const [publishing, setPublishing] = useState({});         // { contentId: 'idle'|'publishing'|'done'|'error' }
  const [publishResults, setPublishResults] = useState({}); // { contentId: result }
  const [actionMsg, setActionMsg] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const [listingData, skuData] = await Promise.all([
        get('/etsy/listings'),
        get('/skus'),
      ]);
      setListings(listingData.items || []);
      setSkus(skuData.items || []);
    } catch { /* error shown via hook */ }
  }, []);

  useEffect(() => { loadData(); }, []);

  // Group SKUs by photo_id for easy lookup
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

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="page">
      <header className="page-header">
        <h2>Etsy Listings</h2>
        <p className="page-subtitle">
          Review, approve, and publish Etsy content with SKU variations
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

      {/* Summary stats */}
      <div className="card-grid" style={{ marginBottom: '24px' }}>
        <div className="glass-card">
          <h3>{'🏷️'} Listings</h3>
          <div style={{ fontSize: '36px', fontWeight: 600, color: 'var(--accent)' }}>
            {listings.length}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Etsy content items generated
          </div>
        </div>
        <div className="glass-card">
          <h3>{'📦'} SKUs</h3>
          <div style={{ fontSize: '36px', fontWeight: 600, color: 'var(--accent)' }}>
            {skus.length}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Products in catalog
          </div>
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
            <div style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-muted)' }}>
              {'—'}
            </div>
          )}
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Retail price range
          </div>
        </div>
      </div>

      {/* Listing cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {listings.map(item => {
          const isExpanded = expanded === item.id;
          const photoSkus = skusByPhoto[item.photo_id] || [];
          const selected = selectedSkus[item.id] || new Set();
          const pubState = publishing[item.id] || 'idle';
          const pubResult = publishResults[item.id];

          return (
            <div
              key={item.id}
              className="glass-card"
              style={{ padding: 0, overflow: 'hidden' }}
            >
              {/* Header */}
              <div
                style={{
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 20px', cursor: 'pointer',
                  borderBottom: isExpanded ? '1px solid var(--glass-border)' : 'none',
                }}
                onClick={() => setExpanded(isExpanded ? null : item.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {/* Photo thumbnail */}
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
                    borderRadius: '20px',
                    background: 'rgba(241, 100, 30, 0.12)',
                    color: '#f1641e',
                  }}>
                    Etsy
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
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span className={`status-badge ${
                    item.status === 'approved' ? 'online' :
                    item.status === 'posted' ? 'online' :
                    item.status === 'pending' ? 'pending' : 'not-created'
                  }`}>
                    {item.status}
                  </span>
                  {pubState === 'done' && (
                    <span style={{
                      fontSize: '10px', padding: '3px 8px',
                      background: 'rgba(74, 222, 128, 0.15)',
                      color: 'var(--success)', borderRadius: '10px',
                    }}>
                      Published
                    </span>
                  )}
                  <span style={{
                    fontSize: '14px', color: 'var(--text-muted)',
                    transform: isExpanded ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s',
                  }}>
                    {'\u25BC'}
                  </span>
                </div>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div style={{ padding: '20px' }}>
                  {/* Listing body */}
                  <div style={{
                    padding: '16px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '13px', color: 'var(--text-primary)',
                    lineHeight: 1.6, whiteSpace: 'pre-wrap',
                    maxHeight: '250px', overflowY: 'auto',
                    marginBottom: '16px',
                  }}>
                    {item.body}
                  </div>

                  {/* Tags */}
                  {item.tags && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{
                        fontSize: '11px', color: 'var(--text-secondary)',
                        textTransform: 'uppercase', letterSpacing: '0.1em',
                        marginBottom: '8px',
                      }}>
                        Tags ({(() => {
                          try { return JSON.parse(item.tags).length; } catch { return 0; }
                        })()}/13)
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {(() => {
                          try { return JSON.parse(item.tags); } catch { return []; }
                        })().map((tag, i) => (
                          <span key={i} style={{
                            fontSize: '10px', padding: '3px 10px',
                            background: 'rgba(241, 100, 30, 0.08)',
                            border: '1px solid rgba(241, 100, 30, 0.2)',
                            borderRadius: '10px', color: '#f1641e',
                          }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SKU / Pricing table with checkboxes */}
                  {photoSkus.length > 0 && (
                    <div>
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        marginBottom: '8px',
                      }}>
                        <div style={{
                          fontSize: '11px', color: 'var(--text-secondary)',
                          textTransform: 'uppercase', letterSpacing: '0.1em',
                        }}>
                          SKU Pricing — Select variations to publish
                        </div>
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
                        border: '1px solid var(--glass-border)',
                        borderRadius: 'var(--radius-sm)',
                        overflow: 'hidden',
                      }}>
                        {/* Table header */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '32px 1fr 80px 80px 80px 80px 80px',
                          padding: '8px 12px',
                          background: 'var(--bg-tertiary)',
                          fontSize: '10px', fontWeight: 600,
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}>
                          <span></span>
                          <span>SKU</span>
                          <span>Size</span>
                          <span>Paper</span>
                          <span>Cost</span>
                          <span>Min</span>
                          <span>Retail</span>
                        </div>
                        {/* Rows */}
                        {photoSkus.map(sku => (
                          <div key={sku.sku} style={{
                            display: 'grid',
                            gridTemplateColumns: '32px 1fr 80px 80px 80px 80px 80px',
                            padding: '8px 12px',
                            borderTop: '1px solid var(--glass-border)',
                            fontSize: '12px',
                            background: selected.has(sku.sku)
                              ? 'rgba(241, 100, 30, 0.04)' : 'transparent',
                          }}>
                            <span style={{ display: 'flex', alignItems: 'center' }}>
                              <input
                                type="checkbox"
                                checked={selected.has(sku.sku)}
                                onChange={() => toggleSku(item.id, sku.sku)}
                                style={{ accentColor: 'var(--accent)' }}
                              />
                            </span>
                            <span style={{ fontFamily: 'monospace', color: 'var(--accent)', fontSize: '11px' }}>
                              {sku.sku}
                            </span>
                            <span style={{ color: 'var(--text-secondary)' }}>{sku.size_code}</span>
                            <span style={{ color: 'var(--text-secondary)' }}>{sku.paper_code}</span>
                            <span style={{ color: 'var(--text-muted)' }}>${sku.base_cost_usd.toFixed(2)}</span>
                            <span style={{ color: 'var(--warning)' }}>${sku.min_price_usd.toFixed(2)}</span>
                            <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                              ${sku.list_price_usd.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Publish results */}
                  {pubResult && (
                    <div style={{
                      marginTop: '12px', padding: '12px',
                      background: 'rgba(74, 222, 128, 0.06)',
                      border: '1px solid rgba(74, 222, 128, 0.2)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '12px',
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--success)' }}>
                        Publish Results: {pubResult.created}/{pubResult.total} created
                      </div>
                      {(pubResult.results || []).map((r, i) => (
                        <div key={i} style={{
                          display: 'flex', gap: '8px', alignItems: 'center',
                          fontSize: '11px', padding: '2px 0',
                        }}>
                          <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{r.sku}</span>
                          <span style={{
                            padding: '1px 6px', borderRadius: '8px', fontSize: '10px',
                            background: r.status === 'created' ? 'rgba(74, 222, 128, 0.15)' : 'rgba(248, 113, 113, 0.15)',
                            color: r.status === 'created' ? 'var(--success)' : 'var(--danger)',
                          }}>
                            {r.status}
                          </span>
                          {r.listing_id && (
                            <span style={{ color: 'var(--text-muted)' }}>
                              Etsy #{r.listing_id}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    marginTop: '16px', paddingTop: '16px',
                    borderTop: '1px solid var(--glass-border)',
                  }}>
                    {/* Approve button — only for pending content */}
                    {item.status === 'pending' && (
                      <button
                        onClick={() => handleApprove(item.id)}
                        disabled={loading}
                        style={{
                          padding: '8px 20px', fontSize: '13px', fontWeight: 600,
                          background: 'rgba(74, 222, 128, 0.15)',
                          border: '1px solid var(--success)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--success)', cursor: 'pointer',
                        }}
                      >
                        Approve Content
                      </button>
                    )}

                    {/* Publish button — only for approved content with selected SKUs */}
                    {(item.status === 'approved' || item.status === 'pending') && (
                      <button
                        onClick={() => handlePublish(item.id)}
                        disabled={pubState === 'publishing' || selected.size === 0}
                        style={{
                          padding: '8px 20px', fontSize: '13px', fontWeight: 600,
                          background: selected.size > 0
                            ? 'rgba(241, 100, 30, 0.15)' : 'rgba(128, 128, 128, 0.1)',
                          border: `1px solid ${selected.size > 0 ? '#f1641e' : 'var(--text-muted)'}`,
                          borderRadius: 'var(--radius-sm)',
                          color: selected.size > 0 ? '#f1641e' : 'var(--text-muted)',
                          cursor: selected.size > 0 ? 'pointer' : 'not-allowed',
                          opacity: pubState === 'publishing' ? 0.6 : 1,
                        }}
                      >
                        {pubState === 'publishing'
                          ? 'Publishing...'
                          : `Publish to Etsy (${selected.size} SKU${selected.size !== 1 ? 's' : ''})`}
                      </button>
                    )}

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

export default AgentEtsyListings;
