import React, { useState, useEffect } from 'react';
import useAgentApi from '../hooks/useAgentApi';

const COLLECTIONS = ['ICE', 'TOK', 'LON', 'PAR', 'NYC', 'HAV', 'MAR', 'SYD', 'BER'];

/**
 * AgentPhotoImport — Photo library browser + import trigger.
 * Grid view with collection filter, click for detail panel.
 */
function AgentPhotoImport() {
  const { get, post, loading, error } = useAgentApi();
  const [photos, setPhotos] = useState([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [importing, setImporting] = useState(false);

  const loadPhotos = async () => {
    try {
      const params = filter ? `?collection=${filter}&limit=100` : '?limit=100';
      const data = await get(`/photos${params}`);
      setPhotos(data.items || []);
      setTotal(data.total || 0);
    } catch { /* error shown via hook */ }
  };

  useEffect(() => { loadPhotos(); }, [filter]);

  const loadDetail = async (photoId) => {
    try {
      const data = await get(`/photos/${photoId}`);
      setDetail(data);
      setSelected(photoId);
    } catch { /* error shown via hook */ }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const result = await post('/photos/import');
      alert(`Imported ${result.imported} new photos`);
      await loadPhotos();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  const parseTags = (tagsStr) => {
    if (!tagsStr) return [];
    try { return JSON.parse(tagsStr); } catch { return []; }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>Photo Library</h2>
            <p className="page-subtitle">{total} photos in agent database</p>
          </div>
          <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
            {importing ? 'Importing...' : 'Import New Photos'}
          </button>
        </div>
      </header>

      {/* Collection filter */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <button
          className={`btn ${!filter ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '6px 14px', fontSize: '12px' }}
          onClick={() => setFilter('')}
        >
          All
        </button>
        {COLLECTIONS.map(c => (
          <button
            key={c}
            className={`btn ${filter === c ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '6px 14px', fontSize: '12px' }}
            onClick={() => setFilter(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '24px' }}>
        {/* Photo grid */}
        <div style={{ flex: 1 }}>
          <div className="photo-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '12px',
          }}>
            {photos.map(photo => (
              <div
                key={photo.id}
                className="photo-card"
                style={{
                  cursor: 'pointer',
                  border: selected === photo.id
                    ? '2px solid var(--accent)'
                    : '2px solid var(--glass-border)',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                  background: 'var(--bg-tertiary)',
                  transition: 'all 0.2s ease',
                }}
                onClick={() => loadDetail(photo.id)}
              >
                <div style={{
                  aspectRatio: '1',
                  background: 'var(--bg-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '28px',
                  color: 'var(--text-muted)',
                }}>
                  {photo.vision_analyzed_at ? '🖼️' : '📷'}
                </div>
                <div style={{ padding: '8px' }}>
                  <div style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {photo.filename}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                    {photo.collection && (
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        background: 'rgba(212, 165, 116, 0.15)',
                        color: 'var(--accent)',
                        borderRadius: '10px',
                      }}>
                        {photo.collection}
                      </span>
                    )}
                    {photo.vision_analyzed_at && (
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        background: 'rgba(74, 222, 128, 0.15)',
                        color: 'var(--success)',
                        borderRadius: '10px',
                      }}>
                        AI
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {photos.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
              {filter ? `No photos in ${filter} collection` : 'No photos imported yet'}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {detail && (
          <div className="glass-card" style={{ width: '320px', flexShrink: 0 }}>
            <h3>{detail.photo.filename}</h3>

            <div style={{ marginBottom: '16px' }}>
              <div className="detail-row">
                <span className="detail-label">Collection</span>
                <span>{detail.photo.collection || '—'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Size</span>
                <span>{detail.photo.width}{'×'}{detail.photo.height}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Imported</span>
                <span>{new Date(detail.photo.imported_at).toLocaleDateString()}</span>
              </div>
            </div>

            {/* Vision Analysis */}
            {detail.photo.vision_analyzed_at && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  marginBottom: '8px',
                }}>
                  Vision Analysis
                </div>
                {detail.photo.vision_mood && (
                  <div className="detail-row">
                    <span className="detail-label">Mood</span>
                    <span>{detail.photo.vision_mood}</span>
                  </div>
                )}
                {detail.photo.marketability_score != null && (
                  <div className="detail-row">
                    <span className="detail-label">Marketability</span>
                    <span style={{ color: 'var(--accent)' }}>
                      {detail.photo.marketability_score}/10
                    </span>
                  </div>
                )}
                {detail.photo.vision_tags && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                    {parseTags(detail.photo.vision_tags).map((tag, i) => (
                      <span key={i} style={{
                        fontSize: '10px',
                        padding: '2px 8px',
                        background: 'var(--glass-bg)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: '10px',
                        color: 'var(--text-secondary)',
                      }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Related content */}
            {detail.content && detail.content.length > 0 && (
              <div>
                <div style={{
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  marginBottom: '8px',
                }}>
                  Generated Content ({detail.content.length})
                </div>
                {detail.content.map(c => (
                  <div key={c.id} style={{
                    padding: '8px',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: '6px',
                    fontSize: '12px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--accent)', textTransform: 'capitalize' }}>
                        {c.platform}
                      </span>
                      <span className={`status-badge ${
                        c.status === 'approved' ? 'online' :
                        c.status === 'pending' ? 'pending' : 'not-created'
                      }`}>
                        {c.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* SKUs */}
            {detail.skus && detail.skus.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <div style={{
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  marginBottom: '8px',
                }}>
                  SKUs ({detail.skus.length})
                </div>
                {detail.skus.map(s => (
                  <div key={s.sku} style={{
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    color: 'var(--text-secondary)',
                    padding: '4px 0',
                  }}>
                    {s.sku} {'—'} ${s.list_price_usd}
                  </div>
                ))}
              </div>
            )}
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

export default AgentPhotoImport;
