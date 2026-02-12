import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

function Handshake() {
  const [socialStatus, setSocialStatus] = useState(null);
  const [studioStatus, setStudioStatus] = useState(null);
  const [galleryQueue, setGalleryQueue] = useState(null);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  async function checkStatus() {
    if (!window.electronAPI) return;
    const [heartbeat, studio, gQueue] = await Promise.all([
      window.electronAPI.writeHeartbeat(),
      window.electronAPI.readStudioStatus(),
      window.electronAPI.readGalleryQueue(),
    ]);
    setSocialStatus(heartbeat);
    setStudioStatus(studio);
    setGalleryQueue(gQueue);
  }

  function getTimeSince(timestamp) {
    if (!timestamp) return 'Never';
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function isStale(timestamp, thresholdMinutes = 5) {
    if (!timestamp) return true;
    return (Date.now() - new Date(timestamp).getTime()) > thresholdMinutes * 60000;
  }

  return (
    <div className="page">
      <header className="page-header">
        <h2>Handshake</h2>
        <p className="page-subtitle">Studio \u2194 Social Media sync via iCloud Drive</p>
      </header>

      <div className="card-grid">
        {/* This app status */}
        <div className="glass-card">
          <h3>This App (Social Media v0.2)</h3>
          <div className="status-row">
            <span>Status</span>
            <span className="status-badge online">{socialStatus?.status || 'running'}</span>
          </div>
          <div className="status-row">
            <span>Last heartbeat</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              {socialStatus?.last_heartbeat ? getTimeSince(socialStatus.last_heartbeat) : 'Never'}
            </span>
          </div>
          <div className="status-row">
            <span>Machine</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{socialStatus?.machine || 'i7-macbook-pro'}</span>
          </div>
          <div className="status-row">
            <span>Current task</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{socialStatus?.current_task || 'idle'}</span>
          </div>
          {socialStatus?.stats && (
            <>
              <div className="status-row">
                <span>Videos today</span>
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{socialStatus.stats.videos_rendered_today || 0}</span>
              </div>
              <div className="status-row">
                <span>Posts today</span>
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{socialStatus.stats.posts_made_today || 0}</span>
              </div>
              <div className="status-row">
                <span>Queue</span>
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{socialStatus.stats.queue_length || 0}</span>
              </div>
            </>
          )}
        </div>

        {/* Studio status */}
        <div className="glass-card">
          <h3>Studio (M3 Max)</h3>
          {studioStatus ? (
            <>
              <div className="status-row">
                <span>Status</span>
                <span className={`status-badge ${isStale(studioStatus.last_heartbeat || studioStatus.timestamp) ? 'pending' : 'online'}`}>
                  {isStale(studioStatus.last_heartbeat || studioStatus.timestamp) ? 'Stale' : studioStatus.status || 'Connected'}
                </span>
              </div>
              <div className="status-row">
                <span>Last seen</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                  {getTimeSince(studioStatus.last_heartbeat || studioStatus.timestamp)}
                </span>
              </div>
              <div className="status-row">
                <span>Version</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{studioStatus.version || 'Unknown'}</span>
              </div>
              <div className="status-row">
                <span>Machine</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{studioStatus.machine || 'm3-max'}</span>
              </div>
              {studioStatus.galleries_updated?.length > 0 && (
                <div className="status-row">
                  <span>Updated galleries</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                    {studioStatus.galleries_updated.join(', ')}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state" style={{ padding: '20px 0' }}>
              No Studio heartbeat detected.
              <br /><br />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Studio writes to <code>handshake/studio_status.json</code> via iCloud sync.
                Make sure Studio is running and the handshake folder is in the shared iCloud Drive.
              </span>
            </div>
          )}
        </div>

        {/* Gallery Queue from Studio */}
        <div className="glass-card full-width">
          <h3>Studio Gallery Queue</h3>
          {galleryQueue?.queue?.length > 0 ? (
            <div className="queue-list">
              {galleryQueue.queue.map((item, i) => (
                <div key={i} className="queue-item">
                  <div className="queue-item-info" style={{ flex: 1 }}>
                    <div className="queue-item-title">{item.gallery}</div>
                    <div className="queue-item-meta">
                      Priority: {item.priority || 'normal'} &middot;
                      Queued by: {item.queued_by || 'studio'} &middot;
                      {item.queued_at && new Date(item.queued_at).toLocaleString()}
                    </div>
                  </div>
                  <span className="status-badge pending">
                    {item.platforms?.[0] === 'all' ? 'All platforms' : item.platforms?.join(', ') || 'default'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              No galleries queued by Studio. Using {socialStatus?.stats ? 'automatic rotation' : 'manual mode'}.
            </div>
          )}
        </div>

        {/* How it works */}
        <div className="glass-card full-width">
          <h3>Protocol</h3>
          <div className="info-box">
            Both apps write JSON status files to the <code>handshake/</code> folder in iCloud Drive.
            Each reads the other's status every 60 seconds. If a heartbeat is older than 5 minutes, it shows as stale.
            Studio can also queue galleries for priority rendering via <code>gallery_queue.json</code>.
          </div>

          <div style={{ display: 'flex', gap: 40, marginTop: 20, justifyContent: 'center', alignItems: 'center', padding: '20px 0' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 4 }}>M3 Max</div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Studio</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>studio_status.json</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>gallery_queue.json</div>
            </div>
            <div style={{ fontSize: 24, color: 'var(--accent)' }}>\u27F7</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 4 }}>iCloud</div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>handshake/</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>auto-sync</div>
            </div>
            <div style={{ fontSize: 24, color: 'var(--accent)' }}>\u27F7</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 4 }}>i7 MacBook</div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Social Media</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>social_status.json</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Handshake;
