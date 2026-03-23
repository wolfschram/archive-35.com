import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Schedule() {
  const [config, setConfig] = useState(null);
  const [postHistory, setPostHistory] = useState([]);
  const [scheduleLog, setScheduleLog] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [outputs, setOutputs] = useState([]);
  const [platforms, setPlatforms] = useState({});

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    if (!window.electronAPI) return;
    const [cfg, history, outputList, platDefs, schedLog] = await Promise.all([
      window.electronAPI.getConfig(),
      window.electronAPI.getPostHistory(),
      window.electronAPI.listOutputs(),
      window.electronAPI.getPlatforms(),
      window.electronAPI.getScheduleLog(),
    ]);
    setConfig(cfg);
    setPostHistory(history.posts || []);
    setOutputs(outputList.files || []);
    setPlatforms(platDefs || {});
    setScheduleLog(schedLog);
  }

  function getCalendarDays() {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();

    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push({ empty: true });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const posts = postHistory.filter(p => p.date?.startsWith(dateStr));
      const scheduled = (scheduleLog?.calendar || []).filter(s => s.date === dateStr);
      const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
      days.push({
        day: d, dateStr, posts, scheduled, isToday,
        hasPosts: posts.length > 0,
        hasScheduled: scheduled.length > 0
      });
    }
    return days;
  }

  const configPlatforms = config?.platforms || {};
  const enabledPlatforms = Object.entries(configPlatforms).filter(([_, p]) => p.enabled);

  return (
    <div className="page">
      <header className="page-header">
        <h2>Schedule</h2>
        <p className="page-subtitle">Posting calendar and platform management</p>
      </header>

      <div className="card-grid">
        {/* Calendar */}
        <div className="glass-card full-width">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <button className="btn btn-secondary" style={{ padding: '6px 12px' }}
              onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}>
              \u2190
            </button>
            <h3 style={{ margin: 0 }}>
              {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h3>
            <button className="btn btn-secondary" style={{ padding: '6px 12px' }}
              onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}>
              \u2192
            </button>
          </div>

          <div className="calendar-grid">
            {DAYS.map(d => (
              <div key={d} className="calendar-header">{d}</div>
            ))}
            {getCalendarDays().map((day, i) => (
              <div
                key={i}
                className={`calendar-day ${day.empty ? 'empty' : ''} ${day.isToday ? 'today' : ''} ${day.hasPosts ? 'has-posts' : ''} ${day.hasScheduled ? 'has-scheduled' : ''}`}
              >
                {!day.empty && (
                  <>
                    <span>{day.day}</span>
                    {day.hasPosts && <span className="post-dot" style={{ background: 'var(--success)' }} />}
                    {day.hasScheduled && !day.hasPosts && <span className="post-dot" style={{ background: 'var(--warning)' }} />}
                  </>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            <span>\u25CF Green = posted</span>
            <span style={{ color: 'var(--warning)' }}>\u25CF Yellow = scheduled</span>
          </div>
        </div>

        {/* Schedule Config */}
        <div className="glass-card">
          <h3>Schedule Settings</h3>
          <div className="status-row">
            <span>Auto-post</span>
            <span className={`status-badge ${config?.schedule?.enabled ? 'online' : 'not-created'}`}>
              {config?.schedule?.enabled ? 'Active' : 'Manual'}
            </span>
          </div>
          <div className="status-row">
            <span>Posts per day</span>
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{config?.schedule?.postsPerDay || 2}</span>
          </div>
          <div className="status-row">
            <span>Times (PST)</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              {(config?.schedule?.times || ['09:00', '18:00']).join(' & ')}
            </span>
          </div>
          <div className="status-row">
            <span>Timezone</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              {config?.schedule?.timezone || 'America/Los_Angeles'}
            </span>
          </div>
          <div className="status-row">
            <span>Rotation</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13, textTransform: 'capitalize' }}>
              {config?.rotation?.mode || 'sequential'}
            </span>
          </div>
        </div>

        {/* 8 Platforms */}
        <div className="glass-card">
          <h3>Platforms (8)</h3>
          <div className="platform-list">
            {Object.entries(platforms).map(([key, platform]) => {
              const userPlatform = configPlatforms[key];
              return (
                <div key={key} className="platform-row">
                  <div className="platform-info">
                    <strong>{platform.label}</strong>
                    <span className="platform-handle" style={{ fontSize: 10 }}>
                      {platform.width}\u00D7{platform.height} \u00B7 {platform.duration}s
                    </span>
                  </div>
                  <span className={`status-badge ${userPlatform?.enabled ? 'online' : 'not-created'}`}>
                    {userPlatform?.enabled ? 'Active' : 'Off'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Ready to Post */}
        <div className="glass-card full-width">
          <h3>Ready to Post</h3>

          {outputs.length === 0 ? (
            <div className="empty-state">No rendered videos yet. Use the Compositor first.</div>
          ) : (
            <div className="queue-list">
              {outputs.slice(0, 10).map((file, i) => (
                <div key={i} className="queue-item">
                  <div className="queue-item-info" style={{ flex: 1, minWidth: 150 }}>
                    <div className="queue-item-title">{file.filename}</div>
                    <div className="queue-item-meta">
                      {(file.size / 1024 / 1024).toFixed(1)} MB &middot; {new Date(file.created).toLocaleDateString()}
                      {file.postContent?.platformLabel && ` &middot; ${file.postContent.platformLabel}`}
                    </div>
                  </div>
                  <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={() => window.electronAPI.openInFinder(file.path)}>
                    Open
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="info-box" style={{ marginTop: 16 }}>
            <strong>Manual posting:</strong> Open video in Finder, then upload to platform directly.
            Automated API posting is Phase 9 (built when platform credentials are ready).
          </div>
        </div>
      </div>
    </div>
  );
}

export default Schedule;
