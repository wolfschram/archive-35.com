import React, { useState, useEffect } from 'react';
import useAgentApi from '../hooks/useAgentApi';

/**
 * AgentInstagram — Instagram account status, recent posts, publish, and dev-mode info.
 */
function AgentInstagram() {
  const { get, post, loading, error } = useAgentApi();
  const [status, setStatus] = useState(null);
  const [account, setAccount] = useState(null);
  const [media, setMedia] = useState([]);
  const [refreshResult, setRefreshResult] = useState(null);
  const [publishUrl, setPublishUrl] = useState('');
  const [publishCaption, setPublishCaption] = useState('');
  const [publishResult, setPublishResult] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const loadData = async () => {
    try {
      const [statusData, accountData, mediaData] = await Promise.all([
        get('/instagram/status'),
        get('/instagram/account').catch(() => null),
        get('/instagram/media?limit=12').catch(() => ({ data: [] })),
      ]);
      setStatus(statusData);
      setAccount(accountData);
      setMedia(mediaData?.data || []);
    } catch { /* error shown via hook */ }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleRefreshToken = async () => {
    try {
      const result = await post('/instagram/refresh-token');
      setRefreshResult(result);
      await loadData();
    } catch (err) {
      setRefreshResult({ success: false, error: err.message });
    }
  };

  const handlePublish = async () => {
    if (!publishUrl.trim()) return;
    setIsPublishing(true);
    setPublishResult(null);
    try {
      const result = await post('/instagram/publish', {
        image_url: publishUrl.trim(),
        caption: publishCaption.trim(),
      });
      setPublishResult(result);
      if (!result.error) {
        setPublishUrl('');
        setPublishCaption('');
        loadData();
      }
    } catch (err) {
      setPublishResult({ error: err.message });
    } finally {
      setIsPublishing(false);
    }
  };

  const isValid = status?.valid;
  const tokenExpires = status?.token_expires || 'unknown';

  return (
    <div className="page">
      <header className="page-header">
        <h2>Instagram</h2>
        <p className="page-subtitle">
          Account status, token management, publishing, and recent posts
        </p>
      </header>

      {/* Dev mode warning */}
      <div style={{
        padding: '12px 16px',
        background: 'rgba(234, 179, 8, 0.08)',
        border: '1px solid rgba(234, 179, 8, 0.3)',
        borderRadius: '8px',
        color: '#eab308',
        fontSize: '13px',
        marginBottom: '20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span style={{ fontSize: '18px' }}>{'⚠️'}</span>
          <strong>Development Mode</strong>
        </div>
        <div style={{ paddingLeft: '26px', lineHeight: 1.5 }}>
          Posts are only visible to approved test users (max 10). To go public:
          <br />
          1. Submit for <strong>Meta App Review</strong> with <code>instagram_content_publish</code> permission
          <br />
          2. Record a <strong>2-3 min screencast</strong> showing the publishing flow
          <br />
          3. Once approved, posts are visible to all followers
        </div>
      </div>

      {/* Status Cards */}
      <div className="card-grid" style={{ marginBottom: '24px' }}>
        <div className="glass-card">
          <h3>{'📡'} Connection</h3>
          <div style={{
            fontSize: '36px', fontWeight: 600,
            color: isValid ? 'var(--success, #22c55e)' : 'var(--error, #ef4444)',
          }}>
            {isValid ? 'ONLINE' : status?.configured === false ? 'NOT SET UP' : 'OFFLINE'}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {isValid ? `@${status?.username || ''}` : (status?.error || 'Checking...')}
          </div>
        </div>

        <div className="glass-card">
          <h3>{'👥'} Followers</h3>
          <div style={{ fontSize: '36px', fontWeight: 600, color: 'var(--accent)' }}>
            {account?.followers_count ?? '—'}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Following: {account?.follows_count ?? '—'}
          </div>
        </div>

        <div className="glass-card">
          <h3>{'📸'} Posts</h3>
          <div style={{ fontSize: '36px', fontWeight: 600, color: 'var(--accent)' }}>
            {account?.media_count ?? '—'}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Total Instagram posts
          </div>
        </div>

        <div className="glass-card">
          <h3>{'🔑'} Token</h3>
          <div style={{
            fontSize: '18px', fontWeight: 600,
            color: isValid ? 'var(--success, #22c55e)' : 'var(--error, #ef4444)',
          }}>
            {isValid ? 'Valid' : 'Invalid'}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
            Expires: {tokenExpires}
          </div>
          <button onClick={handleRefreshToken} disabled={loading || !isValid}
            style={{
              padding: '4px 12px', fontSize: '12px',
              background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '6px',
              cursor: loading ? 'wait' : 'pointer',
              opacity: loading || !isValid ? 0.5 : 1,
            }}>Refresh Token</button>
          {refreshResult && (
            <div style={{
              fontSize: '11px', marginTop: '4px',
              color: refreshResult.success ? 'var(--success, #22c55e)' : 'var(--error, #ef4444)',
            }}>
              {refreshResult.success
                ? `Refreshed — ${refreshResult.expires_days} days left`
                : refreshResult.error}
            </div>
          )}
        </div>
      </div>

      {/* Quick Publish */}
      {isValid && (
        <div className="glass-card" style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '12px' }}>Quick Publish</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Post a photo by providing a public image URL. Images must be JPEG, max 8MB.
            In dev mode, only approved testers will see the post.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <input
              type="text"
              placeholder="Public image URL (https://...)"
              value={publishUrl}
              onChange={(e) => setPublishUrl(e.target.value)}
              style={{
                padding: '10px 14px', fontSize: '13px',
                background: 'var(--bg-primary)', border: '1px solid var(--glass-border)',
                borderRadius: '6px', color: 'var(--text)',
              }}
            />
            <textarea
              placeholder="Caption (optional — include hashtags here)"
              value={publishCaption}
              onChange={(e) => setPublishCaption(e.target.value)}
              rows={3}
              style={{
                padding: '10px 14px', fontSize: '13px',
                background: 'var(--bg-primary)', border: '1px solid var(--glass-border)',
                borderRadius: '6px', color: 'var(--text)', resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button onClick={handlePublish}
                disabled={isPublishing || !publishUrl.trim()}
                style={{
                  padding: '10px 24px', fontSize: '13px', fontWeight: 600,
                  background: publishUrl.trim() ? 'rgba(212, 165, 116, 0.15)' : 'rgba(128,128,128,0.08)',
                  border: `1px solid ${publishUrl.trim() ? 'var(--accent)' : 'var(--glass-border)'}`,
                  borderRadius: '6px',
                  color: publishUrl.trim() ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: publishUrl.trim() ? 'pointer' : 'not-allowed',
                  opacity: isPublishing ? 0.6 : 1,
                }}>
                {isPublishing ? 'Publishing...' : 'Publish to Instagram'}
              </button>
              {publishResult && (
                <span style={{
                  fontSize: '12px',
                  color: publishResult.error ? 'var(--danger)' : 'var(--success)',
                }}>
                  {publishResult.error || `Posted! ID: ${publishResult.id}`}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '8px', color: '#ef4444', fontSize: '13px', marginBottom: '24px',
        }}>{error}</div>
      )}

      {/* Recent Posts */}
      <div className="glass-card" style={{ marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '16px' }}>Recent Posts</h3>
        {media.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '24px 0', textAlign: 'center' }}>
            {loading ? 'Loading...' : 'No posts found'}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '16px',
          }}>
            {media.map((item) => (
              <div key={item.id} style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '8px', padding: '12px', fontSize: '13px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{
                    padding: '2px 8px', background: 'rgba(99, 102, 241, 0.15)',
                    borderRadius: '4px', fontSize: '11px', color: 'var(--accent)',
                  }}>{item.media_type || 'IMAGE'}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {item.timestamp ? new Date(item.timestamp).toLocaleDateString() : ''}
                  </span>
                </div>
                <div style={{
                  color: 'var(--text)', lineHeight: 1.5, maxHeight: '80px', overflow: 'hidden', marginBottom: '8px',
                }}>
                  {item.caption
                    ? item.caption.length > 150 ? item.caption.substring(0, 150) + '...' : item.caption
                    : '(no caption)'}
                </div>
                {item.permalink && (
                  <a href={item.permalink} target="_blank" rel="noopener noreferrer"
                    onClick={(e) => {
                      e.preventDefault();
                      if (window.electronAPI?.openExternal) {
                        window.electronAPI.openExternal(item.permalink);
                      } else {
                        window.open(item.permalink, '_blank');
                      }
                    }}
                    style={{ fontSize: '12px', color: 'var(--accent)', textDecoration: 'none' }}>
                    View on Instagram →
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Account Info */}
      {account && !account.error && (
        <div className="glass-card">
          <h3 style={{ marginBottom: '12px' }}>Account Details</h3>
          <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['Username', `@${account.username || status?.username || ''}`],
                ['Account Type', account.account_type || '—'],
                ['Scoped ID', account.id || '—'],
                ['User ID', status?.user_id || '—'],
                ['App Mode', 'Development (testers only)'],
              ].map(([label, value]) => (
                <tr key={label} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <td style={{ padding: '8px 0', color: 'var(--text-muted)', width: '140px' }}>{label}</td>
                  <td style={{ padding: '8px 0', color: 'var(--text)', fontFamily: 'monospace', fontSize: '12px' }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AgentInstagram;
