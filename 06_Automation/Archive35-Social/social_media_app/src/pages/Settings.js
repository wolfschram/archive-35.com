import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

function Settings() {
  const [config, setConfig] = useState(null);
  const [saved, setSaved] = useState(false);
  const [ffmpegInfo, setFfmpegInfo] = useState(null);
  const [platforms, setPlatforms] = useState({});

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    if (!window.electronAPI) return;
    const [cfg, ffmpeg, platDefs] = await Promise.all([
      window.electronAPI.getConfig(),
      window.electronAPI.checkFfmpeg(),
      window.electronAPI.getPlatforms(),
    ]);
    setConfig(cfg);
    setFfmpegInfo(ffmpeg);
    setPlatforms(platDefs || {});
  }

  async function save() {
    if (!config) return;
    await window.electronAPI.saveConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function selectPath(key, title) {
    const path = await window.electronAPI.selectFolder(title);
    if (path) {
      setConfig(prev => ({ ...prev, [key]: path }));
    }
  }

  function updateNested(path, value) {
    setConfig(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let obj = copy;
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
      obj[keys[keys.length - 1]] = value;
      return copy;
    });
  }

  function togglePlatform(key) {
    setConfig(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      if (!copy.platforms[key]) copy.platforms[key] = { enabled: false, handle: '' };
      copy.platforms[key].enabled = !copy.platforms[key].enabled;
      return copy;
    });
  }

  if (!config) return <div className="page"><div className="empty-state">Loading settings...</div></div>;

  return (
    <div className="page">
      <header className="page-header">
        <h2>Settings</h2>
        <p className="page-subtitle">Paths, video, schedule, and platform configuration</p>
      </header>

      <div className="card-grid">
        {/* Folder Paths */}
        <div className="glass-card full-width">
          <h3>Folder Paths (iCloud Drive)</h3>

          <PathSelector
            label="Photography Folder"
            value={config.photographyPath}
            hint="Contains 26 gallery folders (Grand_Teton, Iceland, etc.)"
            onBrowse={() => selectPath('photographyPath', 'Select Photography Folder')}
          />

          <PathSelector
            label="PNG Sequences Folder"
            value={config.pngSeqPath}
            hint="After Effects exported template sequences (A35_PNG Seqs/)"
            onBrowse={() => selectPath('pngSeqPath', 'Select PNG Sequences Folder')}
          />

          <PathSelector
            label="Audio Folder (optional)"
            value={config.audioPath}
            hint="Ambient audio track for video background. Renders silent if empty."
            onBrowse={() => selectPath('audioPath', 'Select Audio Folder')}
          />

          <PathSelector
            label="Handshake Folder (iCloud shared)"
            value={config.handshakePath}
            hint="Shared folder for Studio \u2194 Social Media JSON sync files. Leave empty for local-only mode."
            onBrowse={() => selectPath('handshakePath', 'Select Handshake Folder')}
          />
        </div>

        {/* Video Settings */}
        <div className="glass-card">
          <h3>Video Settings</h3>

          <div className="form-group">
            <label>FPS</label>
            <input type="number" value={config.video?.fps || 30}
              onChange={e => updateNested('video.fps', parseInt(e.target.value))} />
          </div>

          <div className="form-group">
            <label>Quality Preset (i7 optimized)</label>
            <select value={config.video?.quality || 'medium'}
              onChange={e => updateNested('video.quality', e.target.value)}>
              <option value="ultrafast">Ultrafast (draft)</option>
              <option value="fast">Fast</option>
              <option value="medium">Medium (recommended for i7)</option>
              <option value="slow">Slow (high quality)</option>
            </select>
          </div>

          <div className="form-group">
            <label>CRF (quality, lower = better, 18 default)</label>
            <input type="number" value={config.video?.crf || 18} min={1} max={51}
              onChange={e => updateNested('video.crf', parseInt(e.target.value))} />
          </div>

          <div className="form-group">
            <label>Audio fade-in (seconds)</label>
            <input type="number" value={config.video?.audioFadeIn || 1} step={0.5} min={0} max={5}
              onChange={e => updateNested('video.audioFadeIn', parseFloat(e.target.value))} />
          </div>

          <div className="form-group">
            <label>Audio fade-out (seconds)</label>
            <input type="number" value={config.video?.audioFadeOut || 2} step={0.5} min={0} max={5}
              onChange={e => updateNested('video.audioFadeOut', parseFloat(e.target.value))} />
          </div>
        </div>

        {/* Schedule Settings */}
        <div className="glass-card">
          <h3>Schedule</h3>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={config.schedule?.enabled || false}
                onChange={e => updateNested('schedule.enabled', e.target.checked)} />
              Enable automated scheduling
            </label>
          </div>

          <div className="form-group">
            <label>Morning post time (PST)</label>
            <input type="time" value={config.schedule?.times?.[0] || '09:00'}
              onChange={e => {
                const times = [...(config.schedule?.times || ['09:00', '18:00'])];
                times[0] = e.target.value;
                updateNested('schedule.times', times);
              }} />
          </div>

          <div className="form-group">
            <label>Evening post time (PST)</label>
            <input type="time" value={config.schedule?.times?.[1] || '18:00'}
              onChange={e => {
                const times = [...(config.schedule?.times || ['09:00', '18:00'])];
                times[1] = e.target.value;
                updateNested('schedule.times', times);
              }} />
          </div>

          <div className="form-group">
            <label>Gallery rotation mode</label>
            <select value={config.rotation?.mode || 'sequential'}
              onChange={e => updateNested('rotation.mode', e.target.value)}>
              <option value="sequential">Sequential (A-Z)</option>
              <option value="random">Random</option>
              <option value="queue">Manual queue (via Studio)</option>
            </select>
          </div>
        </div>

        {/* 8 Platform Configuration */}
        <div className="glass-card full-width">
          <h3>Platform Configuration (8 platforms)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {Object.entries(platforms).map(([key, platform]) => {
              const userPlatform = config.platforms?.[key] || {};
              return (
                <div key={key} className="glass-card" style={{ margin: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <strong style={{ fontSize: 13 }}>{platform.label}</strong>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                      <input type="checkbox" checked={userPlatform.enabled || false}
                        onChange={() => togglePlatform(key)} />
                      Active
                    </label>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                    {platform.width}\u00D7{platform.height} \u00B7 {platform.duration}s \u00B7 {platform.format}
                    {platform.supportsLinks ? ' \u00B7 links' : ' \u00B7 watermark only'}
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <input type="text" placeholder="@handle"
                      value={userPlatform.handle || ''}
                      style={{ fontSize: 12, padding: '4px 8px' }}
                      onChange={e => updateNested(`platforms.${key}.handle`, e.target.value)} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* System Info */}
        <div className="glass-card full-width">
          <h3>System</h3>
          <div className="status-row">
            <span>FFmpeg</span>
            <span className={`status-badge ${ffmpegInfo?.installed ? 'online' : 'error'}`}>
              {ffmpegInfo?.installed ? 'Installed' : 'Not Found \u2014 install with: brew install ffmpeg'}
            </span>
          </div>
          {ffmpegInfo?.version && (
            <div className="status-row">
              <span>FFmpeg version</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 11, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {ffmpegInfo.version}
              </span>
            </div>
          )}
          <div className="status-row">
            <span>App version</span>
            <span style={{ color: 'var(--text-secondary)' }}>0.2.0</span>
          </div>
          <div className="status-row">
            <span>Dev port</span>
            <span style={{ color: 'var(--text-secondary)' }}>3001</span>
          </div>
          <div className="status-row">
            <span>Temp directory</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>/tmp/archive35/</span>
          </div>
        </div>

        {/* Save button */}
        <div className="glass-card full-width">
          <button className="btn btn-primary btn-large" onClick={save} style={{ width: '100%' }}>
            {saved ? '\u2713 Saved' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PathSelector({ label, value, hint, onBrowse }) {
  return (
    <div className="form-group">
      <label>{label}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="path-display" style={{ flex: 1 }}>
          {value || 'Not set'}
        </div>
        <button className="btn btn-secondary" onClick={onBrowse}>Browse</button>
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export default Settings;
