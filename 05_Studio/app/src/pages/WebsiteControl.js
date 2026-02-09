import React, { useState, useEffect, useRef } from 'react';
import '../styles/Pages.css';

function WebsiteControl() {
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState(null);
  const [progress, setProgress] = useState(null);
  const [deployResult, setDeployResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const cleanupRef = useRef(null);

  // Service status monitoring
  const [serviceStatuses, setServiceStatuses] = useState({
    github: { status: 'idle', message: 'Not checked', lastChecked: null, testing: false },
    cloudflare: { status: 'idle', message: 'Not checked', lastChecked: null, testing: false },
    stripe: { status: 'idle', message: 'Not checked', lastChecked: null, testing: false },
    r2: { status: 'idle', message: 'Not checked', lastChecked: null, testing: false },
    c2pa: { status: 'idle', message: 'Not checked', lastChecked: null, testing: false },
    anthropic: { status: 'idle', message: 'Not checked', lastChecked: null, testing: false },
  });

  const [deployStages, setDeployStages] = useState({
    scan: { complete: false, active: false },
    images: { complete: false, active: false },
    c2pa: { complete: false, active: false },
    r2: { complete: false, active: false },
    data: { complete: false, active: false },
    git: { complete: false, active: false },
    push: { complete: false, active: false },
    done: { complete: false, active: false }
  });

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

  const checkServiceStatus = async (service) => {
    setServiceStatuses(prev => ({
      ...prev,
      [service]: { ...prev[service], testing: true }
    }));

    try {
      if (window.electronAPI?.checkServiceStatus) {
        const result = await window.electronAPI.checkServiceStatus(service);
        setServiceStatuses(prev => ({
          ...prev,
          [service]: {
            status: result.status === 'ok' ? 'ok' : result.status === 'warning' ? 'warning' : 'error',
            message: result.message || 'Unknown status',
            lastChecked: new Date().toLocaleTimeString(),
            testing: false
          }
        }));
      }
    } catch (err) {
      setServiceStatuses(prev => ({
        ...prev,
        [service]: {
          status: 'error',
          message: `Check failed: ${err.message}`,
          lastChecked: new Date().toLocaleTimeString(),
          testing: false
        }
      }));
    }
  };

  const checkAllServices = async () => {
    // Mark all as testing
    const testingState = {};
    Object.keys(serviceStatuses).forEach(key => {
      testingState[key] = { ...serviceStatuses[key], testing: true };
    });
    setServiceStatuses(testingState);

    if (window.electronAPI?.checkAllServices) {
      try {
        const results = await window.electronAPI.checkAllServices();
        const newStatuses = {};
        Object.entries(results).forEach(([service, result]) => {
          newStatuses[service] = {
            status: result.status === 'ok' ? 'ok' : result.status === 'warning' ? 'warning' : 'error',
            message: result.message || 'Unknown status',
            lastChecked: new Date().toLocaleTimeString(),
            testing: false
          };
        });
        setServiceStatuses(newStatuses);
      } catch (err) {
        console.error('Failed to check all services:', err);
      }
    }
  };

  const handleDeploy = async () => {
    setDeploying(true);
    setProgress(null);
    setDeployResult(null);
    setDeployStages({
      scan: { complete: false, active: false },
      images: { complete: false, active: false },
      c2pa: { complete: false, active: false },
      r2: { complete: false, active: false },
      data: { complete: false, active: false },
      git: { complete: false, active: false },
      push: { complete: false, active: false },
      done: { complete: false, active: false }
    });

    // Listen for progress events
    if (window.electronAPI?.onDeployProgress) {
      cleanupRef.current = window.electronAPI.onDeployProgress((data) => {
        setProgress(data);
        // Update stage tracking
        if (data.step) {
          setDeployStages(prev => {
            const newStages = { ...prev };
            // Mark previous stage as complete
            const stageOrder = ['scan', 'images', 'c2pa', 'r2', 'data', 'git', 'push', 'done'];
            const currentIndex = stageOrder.indexOf(data.step);

            stageOrder.forEach((stage, idx) => {
              if (idx < currentIndex) {
                newStages[stage] = { complete: true, active: false };
              } else if (idx === currentIndex) {
                newStages[stage] = { complete: false, active: true };
              } else {
                newStages[stage] = { complete: false, active: false };
              }
            });
            return newStages;
          });
        }
      });
    }

    try {
      const result = await window.electronAPI.deployWebsite();
      setDeployResult(result);
      // Mark all stages complete on success
      if (result.success) {
        setDeployStages({
          scan: { complete: true, active: false },
          images: { complete: true, active: false },
          c2pa: { complete: true, active: false },
          r2: { complete: true, active: false },
          data: { complete: true, active: false },
          git: { complete: true, active: false },
          push: { complete: true, active: false },
          done: { complete: true, active: false }
        });
      }
      await checkStatus();
    } catch (err) {
      setDeployResult({ success: false, error: err.message });
      // Mark current active stage as failed
      setDeployStages(prev => {
        const newStages = { ...prev };
        // If no stage was marked active (unexpected error), mark 'scan' as active
        const hasActive = Object.values(newStages).some(s => s.active);
        if (!hasActive) newStages.scan = { complete: false, active: true };
        return newStages;
      });
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

  const getServiceIcon = (service) => {
    const icons = {
      github: '🐙',
      cloudflare: '☁️',
      stripe: '💳',
      r2: '💾',
      c2pa: '🔐',
      anthropic: '🤖'
    };
    return icons[service] || '⚙️';
  };

  const getStatusEmoji = (status) => {
    if (status === 'ok') return '🟢';
    if (status === 'warning') return '🟡';
    if (status === 'error') return '🔴';
    return '⚪';
  };

  const stageLabels = {
    scan: 'Scan',
    images: 'Images',
    c2pa: 'C2PA',
    r2: 'R2',
    data: 'Data',
    git: 'Git',
    push: 'Push',
    done: 'Done'
  };

  return (
    <div className="page">
      <header className="page-header">
        <h2>Website Control</h2>
        <p className="page-subtitle">Deploy and manage archive-35.com</p>
      </header>

      {/* System Status Section */}
      <div className="status-panel-container">
        <div className="status-panel-header">
          <h3>⚙️ Service Health</h3>
          <button
            className="btn btn-secondary"
            onClick={checkAllServices}
            style={{ fontSize: '12px', padding: '8px 12px' }}
            disabled={Object.values(serviceStatuses).some(s => s.testing)}
          >
            {Object.values(serviceStatuses).some(s => s.testing) ? 'Checking...' : 'Check All'}
          </button>
        </div>

        <div className="service-grid">
          {Object.entries(serviceStatuses).map(([service, status]) => (
            <div
              key={service}
              className={`service-card service-${status.status}`}
              style={{
                borderColor: status.status === 'ok' ? 'rgba(34, 197, 94, 0.3)' : status.status === 'warning' ? 'rgba(251, 191, 36, 0.3)' : 'rgba(239, 68, 68, 0.3)',
                background: status.status === 'ok' ? 'rgba(34, 197, 94, 0.05)' : status.status === 'warning' ? 'rgba(251, 191, 36, 0.05)' : 'rgba(239, 68, 68, 0.05)'
              }}
            >
              <div className="service-header">
                <span className="service-icon">{getServiceIcon(service)}</span>
                <span className="service-name">
                  {service.charAt(0).toUpperCase() + service.slice(1).replace(/([A-Z])/g, ' $1')}
                </span>
              </div>

              <div className="service-status">
                <span className="status-indicator">{getStatusEmoji(status.status)}</span>
              </div>

              <div className="service-message" title={status.message}>
                {status.message}
              </div>

              <div className="service-footer">
                <span className="service-time">
                  {status.lastChecked ? `${status.lastChecked}` : 'Never checked'}
                </span>
                <button
                  className="btn-test"
                  onClick={() => checkServiceStatus(service)}
                  disabled={status.testing}
                >
                  {status.testing ? '...' : 'Test'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Deploy Pipeline Visualization — stays visible after deploy completes */}
      {(deploying || deployResult) && (
        <div className="deploy-pipeline-container" style={{
          border: deployResult
            ? `1px solid ${deployResult.success ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
            : '1px solid rgba(251, 191, 36, 0.3)',
          background: deployResult
            ? (deployResult.success ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)')
            : 'rgba(251, 191, 36, 0.05)',
          borderRadius: 'var(--radius-md)',
          padding: '16px 20px',
          marginBottom: '20px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0 }}>Deploy Pipeline</h3>
            {deployResult && (
              <span style={{
                fontSize: '12px',
                color: deployResult.success ? '#22c55e' : '#ef4444',
                fontWeight: 600
              }}>
                {deployResult.success ? '✓ Complete' : '✗ Failed'}
                {deployResult.success && deployResult.photosPublished
                  ? ` — ${deployResult.photosPublished} photos${deployResult.imagesCopied === 0 ? ' (no changes)' : ''}`
                  : ''}
              </span>
            )}
            {deploying && !deployResult && (
              <span style={{ fontSize: '12px', color: '#fbbf24', fontWeight: 600 }}>
                ◉ Deploying...
              </span>
            )}
          </div>
          <div className="deploy-pipeline">
            {Object.entries(deployStages).map(([stage, stageData], idx) => (
              <React.Fragment key={stage}>
                <div
                  className={`pipeline-stage ${stageData.active ? 'active' : ''} ${stageData.complete ? 'complete' : ''} ${deployResult && !deployResult.success && stageData.active ? 'failed' : ''}`}
                  title={stageLabels[stage]}
                >
                  <div className="stage-content">
                    {stageData.complete ? '✓' : stageData.active ? (deployResult && !deployResult.success ? '✗' : '◉') : '○'}
                  </div>
                  <span className="stage-label">{stageLabels[stage]}</span>
                </div>
                {idx < Object.keys(deployStages).length - 1 && (
                  <div className="pipeline-arrow">→</div>
                )}
              </React.Fragment>
            ))}
          </div>
          {/* Status message */}
          {progress && deploying && (
            <div style={{ marginTop: '10px', color: 'var(--text-muted)', fontSize: '13px' }}>
              {progress.message}
              {progress.total > 0 && (
                <div style={{ background: 'var(--bg-tertiary)', borderRadius: '4px', height: '4px', overflow: 'hidden', marginTop: '6px' }}>
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
          {deployResult && (
            <div style={{ marginTop: '10px', fontSize: '13px' }}>
              <div style={{ color: deployResult.success ? '#22c55e' : '#ef4444' }}>
                {deployResult.success
                  ? deployResult.message
                  : `Error: ${deployResult.error}`}
                {deployResult.success && deployResult.imagesCopied > 0 && (
                  <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
                    ({deployResult.photosPublished} photos · {deployResult.imagesCopied} image files synced)
                  </span>
                )}
              </div>
              {deployResult.success && (
                <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  <span>
                    {deployResult.c2paUnsigned > 0
                      ? `\uD83D\uDD13 C2PA: ${deployResult.c2paSigned}/${deployResult.c2paSigned + deployResult.c2paUnsigned} signed`
                      : `\uD83D\uDD10 C2PA: All ${deployResult.c2paSigned} signed`}
                  </span>
                  <span>
                    {deployResult.r2Status === 'configured'
                      ? '\u2601\uFE0F R2: Connected'
                      : deployResult.r2Status === 'unconfigured'
                        ? '\u26A0\uFE0F R2: Not configured'
                        : '\u2753 R2: Unknown'}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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

          {/* Deploy result summary in card */}
          {deployResult && !deploying && (
            <div style={{
              background: deployResult.success ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${deployResult.success ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              borderRadius: 'var(--radius-sm)',
              padding: '12px',
              marginBottom: '16px'
            }}>
              <div style={{ color: deployResult.success ? '#22c55e' : '#ef4444', fontWeight: 600, fontSize: '13px' }}>
                {deployResult.success
                  ? '\u2713 Deploy complete \u2014 see pipeline above'
                  : `\u2717 Deploy failed \u2014 see pipeline above`}
              </div>
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
