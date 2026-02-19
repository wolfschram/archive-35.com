import React, { useState, useEffect } from 'react';
import useAgentApi from '../hooks/useAgentApi';

/**
 * AgentEtsyListings — Preview Etsy listings with SKU/pricing breakdown.
 */
function AgentEtsyListings() {
  const { get, loading, error } = useAgentApi();
  const [listings, setListings] = useState([]);
  const [skus, setSkus] = useState([]);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [listingData, skuData] = await Promise.all([
          get('/etsy/listings'),
          get('/skus'),
        ]);
        setListings(listingData.items || []);
        setSkus(skuData.items || []);
      } catch { /* error shown via hook */ }
    };
    load();
  }, []);

  // Group SKUs by photo_id for easy lookup
  const skusByPhoto = {};
  skus.forEach(s => {
    if (!skusByPhoto[s.photo_id]) skusByPhoto[s.photo_id] = [];
    skusByPhoto[s.photo_id].push(s);
  });

  return (
    <div className="page">
      <header className="page-header">
        <h2>Etsy Listings</h2>
        <p className="page-subtitle">
          Preview generated Etsy content with SKU and pricing
        </p>
      </header>

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
                    item.status === 'pending' ? 'pending' : 'not-created'
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

                  {/* SKU / Pricing table */}
                  {photoSkus.length > 0 && (
                    <div>
                      <div style={{
                        fontSize: '11px', color: 'var(--text-secondary)',
                        textTransform: 'uppercase', letterSpacing: '0.1em',
                        marginBottom: '8px',
                      }}>
                        SKU Pricing
                      </div>
                      <div style={{
                        border: '1px solid var(--glass-border)',
                        borderRadius: 'var(--radius-sm)',
                        overflow: 'hidden',
                      }}>
                        {/* Table header */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 80px 80px 80px 80px 80px',
                          padding: '8px 12px',
                          background: 'var(--bg-tertiary)',
                          fontSize: '10px', fontWeight: 600,
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}>
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
                            gridTemplateColumns: '1fr 80px 80px 80px 80px 80px',
                            padding: '8px 12px',
                            borderTop: '1px solid var(--glass-border)',
                            fontSize: '12px',
                          }}>
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

                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px' }}>
                    Created: {new Date(item.created_at).toLocaleString()}
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
