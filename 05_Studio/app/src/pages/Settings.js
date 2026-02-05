import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

function Settings() {
  const [basePath, setBasePath] = useState('');

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getBasePath().then(setBasePath);
    }
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <h2>Settings</h2>
        <p className="page-subtitle">Configure Archive-35 Studio</p>
      </header>

      <div className="card-grid">
        <div className="glass-card full-width">
          <h3>Paths</h3>
          <div className="form-group">
            <label>Archive-35 Base Folder</label>
            <input type="text" value={basePath} readOnly />
          </div>
        </div>

        <div className="glass-card">
          <h3>API Keys</h3>
          <p>Manage API connections</p>
          <div className="api-status-list">
            <div className="api-row">
              <span>Artelo</span>
              <span className="status-badge online">Configured</span>
            </div>
            <div className="api-row">
              <span>Claude AI</span>
              <span className="status-badge not-created">Not Set</span>
            </div>
            <div className="api-row">
              <span>Meta (IG/FB)</span>
              <span className="status-badge not-created">Not Set</span>
            </div>
          </div>
          <button className="btn btn-secondary">
            Edit API Keys
          </button>
        </div>

        <div className="glass-card">
          <h3>Notifications</h3>
          <label className="checkbox-item">
            <input type="checkbox" defaultChecked />
            <span>Desktop notifications</span>
          </label>
          <label className="checkbox-item">
            <input type="checkbox" defaultChecked />
            <span>Email on errors</span>
          </label>
          <label className="checkbox-item">
            <input type="checkbox" />
            <span>Daily summary email</span>
          </label>
        </div>

        <div className="glass-card">
          <h3>Backups</h3>
          <p>Auto-backup before destructive operations</p>
          <label className="checkbox-item">
            <input type="checkbox" defaultChecked />
            <span>Enable auto-backup</span>
          </label>
          <button className="btn btn-secondary">
            Backup Now
          </button>
        </div>
      </div>
    </div>
  );
}

export default Settings;
