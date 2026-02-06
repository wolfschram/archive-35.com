import React, { useState, useEffect, useRef } from 'react';
import '../styles/Pages.css';

function WebsiteControl() {
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState(null);
  const [progress, setProgress] = useState(null);
  const [deployResult, setDeployResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const cleanupRef = useRef(null);

  // Check deploy status on mount
  useEffect(() => {
    checkStatus();
    return () => {
      if (cleanupRef.current) cleanupRef.current();
    };
  }, []);

  const checkStatus = async () => {
    setLoading(true);
    try {
      if (window.electronAPI?.checkDeployStatus) {
        const status = await window.electronAPI.checkDeployStatus();
        setDeployStatus(status);
      }
    } catch (err) {
      console.error('Failed to check deploy status:', err);
    }
    setLoading(false);
  };

  const handleDeploy = async () => {
    setDeploying(true);
    setProgress(null);
    setDeployResult(null);

    // Listen for progress events
    if (window.electronAPI?.onDeployProgress) {
      cleanupRef.current = window.electronAPI.onDeployProgress((data) => {
        setProgress(data);
      });
    }

    try {
      const result = await window.electronAPI.deployWebsite();
      setDeployResult(result);
      await checkStatus();
    } catch (err) {
      setDeployResult({ success: false, error: err.message });
    }

    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    setDeploying(false);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return dateStr; }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h2>Website Control</h2>
        <p className="page-subtitle">Deploy and manage archive-35.com</p>
      </header>

      <div className="card-grid">
        {/* Site Status */}
        <div className="glass-card">
          <h3>Site Status</h3>
          <div className="status-row">
            <span>Website</span>
            <span className="status-badge online">Live</span>
          </div>
          <div className="status-row">
            <span>HTTPS</span>
            <span className="status-badge online">Secure</span>
          </div>
          <div className="status-row">
            <span>Last Deploy</span>
            <span>{loading ? '...' : formatDate(deployStatus?.lastDeployDate)}</span>
          </div>
          <div className="status-row">
            <span>Photos on Website</span>
            <span>{loading ? '...' : deployStatus?.websitePhotoCount || 0}</span>
          </div>
          <div className="status-row">
            <span>Photos in Portfolio</span>
            <span>{loading ? '...' : deployStatus?.portfolioPhotoCount || 0}</span>
          </div>
          <a
            href="https://archive-35.com"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ marginTop: '12px' }}
          >
            Visit Site \u2192
          </a>
        </div>

        {/* Deploy */}
        <div className="glass-card">
          <h3>Deploy</h3>

          {/* Pending changes indicator */}
          {deployStatus?.needsDeploy && !deploying && !deployResult && (
            <div style={{
              background: 'rgba(251, 191, 36, 0.1)',
              border: '1px solid rgba(251, 191, 36, 0.3)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px',
              marginBottom: '16px'
            }}>
              <div style={{ color: '#fbbf24', fontWeight: 600, marginBottom: '4px' }}>
                \u26A1 {deployStatus.pendingPhotos} new photo{deployStatus.pendingPhotos !== 1 ? 's' : ''} ready to publish
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                Portfolio: {deployStatus.portfolioPhotoCount} photos \u2014 Website: {deployStatus.websitePhotoCount}
              </div>
            </div>
          )}

          {!deployStatus?.needsDeploy && !deploying && !loading && !deployResult && (
            <div style={{
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px',
              marginBottom: '16px'
            }}>
              <div style={{ color: '#22c55e', fontWeight: 600 }}>
                \u2713 Website is up to date
              </div>
            </div>
          )}

          {/* Progress during deploy */}
          {deploying && progress && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '8px' }}>
                {progress.message}
              </div>
              {progress.total > 0 && (
                <div style={{ background: 'var(--bg-tertiary)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                  <div style={{
                    background: 'var(--accent)',
                    height: '100%',
                    width: `${Math.round((progress.current / progress.total) * 100)}%`,
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              )}
            </div>
          )}

          {/* Deploy result */}
          {deployResult && (
            <div style={{
              background: deployResult.success ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${deployResult.success ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              borderRadius: 'var(--radius-sm)',
              padding: '12px',
              marginBottom: '16px'
            }}>
              <div style={{ color: deployResult.success ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                {deployResult.success
                  ? `\u2713 ${deployResult.message}`
                  : `\u2717 Deploy failed: ${deployResult.error}`}
              </div>
              {deployResult.success && deployResult.imagesCopied > 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
                  {deployResult.imagesCopied} images synced
                </div>
              )}
            </div>
          )}

          <button
            className="btn btn-primary btn-large"
            onClick={handleDeploy}
            disabled={deploying || loading}
            style={{ width: '100%' }}
          >
            {deploying ? 'Deploying...' : loading ? 'Checking...' : 'Deploy to Website'}
          </button>
        </div>

        {/* Collections */}
        <div className="glass-card">
          <h3>Portfolio Collections</h3>
          {loading ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
          ) : deployStatus?.portfolioCollections?.length > 0 ? (
            <div>
              {deployStatus.portfolioCollections.map((col, i) => (
                <div key={i} className="status-row">
                  <span>{col.name}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{col.count} photos</span>
                    {col.hasPhotosJson && (
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(34, 197, 94, 0.15)',
                        color: '#22c55e'
                      }}>STUDIO</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>No collections found</p>
          )}
        </div>

        {/* Quick Links */}
        <div className="glass-card">
          <h3>Quick Links</h3>
          <a
            href="https://archive-35.com"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ display: 'block', marginBottom: '8px', textAlign: 'center' }}
          >
            Live Website \u2192
          </a>
          <button
            className="btn btn-secondary"
            onClick={checkStatus}
            style={{ display: 'block', width: '100%', textAlign: 'center' }}
          >
            \u21BB Refresh Status
          </button>
        </div>
      </div>
    </div>
  );
}

export default WebsiteControl;
