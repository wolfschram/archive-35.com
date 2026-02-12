import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

function Dashboard() {
  const [stats, setStats] = useState({ galleries: 0, queued: 0, rendered: 0, posted: 0 });
  const [ffmpegInfo, setFfmpegInfo] = useState(null);
  const [studioStatus, setStudioStatus] = useState(null);
  const [outputs, setOutputs] = useState([]);
  const [config, setConfig] = useState(null);
  const [nextGallery, setNextGallery] = useState(null);
  const [studioQueue, setStudioQueue] = useState(null);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadDashboard() {
    if (!window.electronAPI) return;

    const [ffmpeg, studio, queue, history, outputList, cfg, galNext, sQueue] = await Promise.all([
      window.electronAPI.checkFfmpeg(),
      window.electronAPI.readStudioStatus(),
      window.electronAPI.getRenderQueue(),
      window.electronAPI.getPostHistory(),
      window.electronAPI.listOutputs(),
      window.electronAPI.getConfig(),
      window.electronAPI.getNextGallery(),
      window.electronAPI.readGalleryQueue(),
    ]);

    setFfmpegInfo(ffmpeg);
    setStudioStatus(studio);
    setOutputs(outputList.files?.slice(0, 5) || []);
    setConfig(cfg);
    setNextGallery(galNext);
    setStudioQueue(sQueue);

    // Count galleries by scanning
    const galResult = await window.electronAPI.scanGalleries();
    const galCount = galResult.galleries?.length || 0;

    setStats({
      galleries: galCount,
      queued: queue.queue?.length || 0,
      rendered: outputList.files?.length || 0,
      posted: history.posts?.length || 0,
    });

    // Write heartbeat
    window.electronAPI.writeHeartbeat();
  }

  const pathsConfigured = config?.photographyPath && config?.pngSeqPath;
  const enabledPlatformCount = config?.platforms
    ? Object.values(config.platforms).filter(p => p.enabled).length
    : 0;

  return (
    <div className="page">
      <header className="page-header">
        <h2>Dashboard</h2>
        <p className="page-subtitle">Archive-35 Social Media Engine v0.2</p>
      </header>

      <div className="card-grid">
        {/* System Status */}
        <div className="glass-card full-width">
          <h3>System Status</h3>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <StatusItem
              label="FFmpeg"
              status={ffmpegInfo === null ? 'checking' : ffmpegInfo?.installed ? 'ok' : 'error'}
              message={ffmpegInfo?.installed ? 'Installed' : 'Not Found'}
            />
            <StatusItem
              label="Photography"
              status={config?.photographyPath ? 'ok' : 'error'}
              message={config?.photographyPath ? `${stats.galleries} galleries` : 'Not Set'}
            />
            <StatusItem
              label="PNG Templates"
              status={config?.pngSeqPath ? 'ok' : 'error'}
              message={config?.pngSeqPath ? 'Connected' : 'Not Set'}
            />
            <StatusItem
              label="Studio"
              status={studioStatus?.last_heartbeat ? 'ok' : 'offline'}
              message={studioStatus?.last_heartbeat
                ? `Last: ${new Date(studioStatus.last_heartbeat).toLocaleTimeString()}`
                : 'No heartbeat'}
            />
            <StatusItem
              label="Scheduler"
              status={config?.schedule?.enabled ? 'ok' : 'offline'}
              message={config?.schedule?.enabled
                ? `${config.schedule.times?.join(' & ')} PST`
                : 'Manual mode'}
            />
            <StatusItem
              label="Platforms"
              status={enabledPlatformCount > 0 ? 'ok' : 'error'}
              message={`${enabledPlatformCount} of 8 active`}
            />
          </div>
        </div>

        {/* Stats cards */}
        <div className="glass-card">
          <h3>Galleries</h3>
          <div className="stat-number">{stats.galleries}</div>
          <span className="stat-label">Available collections</span>
        </div>

        <div className="glass-card">
          <h3>Render Queue</h3>
          <div className="stat-number">{stats.queued}</div>
          <span className="stat-label">Videos queued</span>
        </div>

        <div className="glass-card">
          <h3>Rendered</h3>
          <div className="stat-number">{stats.rendered}</div>
          <span className="stat-label">Videos created</span>
        </div>

        <div className="glass-card">
          <h3>Posted</h3>
          <div className="stat-number">{stats.posted}</div>
          <span className="stat-label">Published to platforms</span>
        </div>

        {/* Next Up: Gallery Rotation */}
        <div className="glass-card full-width">
          <h3>Next Up</h3>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent)' }}>
                {nextGallery?.gallery || 'Not determined'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Source: {nextGallery?.source || 'rotation'}
                {nextGallery?.priority && ` (${nextGallery.priority} priority)`}
              </div>
            </div>
            {config?.rotation?.mode && (
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <span className="status-badge online" style={{ textTransform: 'capitalize' }}>
                  {config.rotation.mode} rotation
                </span>
              </div>
            )}
          </div>

          {studioQueue?.queue?.length > 0 && (
            <div className="info-box" style={{ marginTop: 12 }}>
              Studio queue: {studioQueue.queue.map(q => q.gallery).join(', ')}
            </div>
          )}
        </div>

        {/* Recent outputs */}
        <div className="glass-card full-width">
          <h3>Recent Renders</h3>
          {outputs.length === 0 ? (
            <p className="empty-state">No videos rendered yet</p>
          ) : (
            <div className="queue-list">
              {outputs.map((file, i) => (
                <div key={i} className="queue-item" onClick={() => window.electronAPI.openInFinder(file.path)}>
                  <div className="queue-item-info" style={{ flex: 1 }}>
                    <div className="queue-item-title">{file.filename}</div>
                    <div className="queue-item-meta">
                      {file.folder || 'output'} &middot; {(file.size / 1024 / 1024).toFixed(1)} MB &middot; {new Date(file.created).toLocaleDateString()}
                      {file.postContent?.platformLabel && ` &middot; ${file.postContent.platformLabel}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!pathsConfigured && (
          <div className="glass-card full-width">
            <div className="info-box">
              <strong>Setup Required:</strong> Go to Settings to configure your Photography and PNG Sequence paths.
              Both folders should be in your shared iCloud Drive folder.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusItem({ label, status, message }) {
  const colors = {
    ok: 'var(--success)',
    error: 'var(--danger)',
    offline: 'var(--text-muted)',
    checking: 'var(--warning)',
  };
  const icons = { ok: '\u25CF', error: '\u25CF', offline: '\u25CB', checking: '\u25CC' };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}>
      <span style={{ color: colors[status], fontSize: 16 }}>{icons[status]}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{message}</div>
      </div>
    </div>
  );
}

export default Dashboard;
