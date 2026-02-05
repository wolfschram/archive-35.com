import React, { useState } from 'react';
import '../styles/Pages.css';

function WebsiteControl() {
  const [deploying, setDeploying] = useState(false);
  const [lastDeploy, setLastDeploy] = useState('3 hours ago');

  const handleDeploy = () => {
    setDeploying(true);
    // Simulate deploy
    setTimeout(() => {
      setDeploying(false);
      setLastDeploy('Just now');
    }, 3000);
  };

  return (
    <div className="page">
      <header className="page-header">
        <h2>Website Control</h2>
        <p className="page-subtitle">Deploy and manage archive-35.com</p>
      </header>

      <div className="card-grid">
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
            <span>{lastDeploy}</span>
          </div>
          <a
            href="https://archive-35.com"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Visit Site →
          </a>
        </div>

        <div className="glass-card">
          <h3>Deploy</h3>
          <p>Push changes to the live website.</p>

          <div className="deploy-checklist">
            <label className="checkbox-item">
              <input type="checkbox" defaultChecked />
              <span>Run post-deploy tests</span>
            </label>
            <label className="checkbox-item">
              <input type="checkbox" defaultChecked />
              <span>Verify all images load</span>
            </label>
            <label className="checkbox-item">
              <input type="checkbox" defaultChecked />
              <span>Check buy links</span>
            </label>
          </div>

          <button
            className="btn btn-primary btn-large"
            onClick={handleDeploy}
            disabled={deploying}
          >
            {deploying ? 'Deploying...' : 'Deploy to Website'}
          </button>
        </div>

        <div className="glass-card">
          <h3>Preview</h3>
          <p>Preview changes before deploying.</p>
          <button className="btn btn-secondary">
            Open Local Preview
          </button>
        </div>

        <div className="glass-card">
          <h3>Rollback</h3>
          <p>Revert to a previous version if needed.</p>
          <select className="form-select">
            <option>Select version...</option>
            <option>2026-02-03 12:15 - Initial deploy</option>
          </select>
          <button className="btn btn-danger" disabled>
            Rollback
          </button>
        </div>
      </div>
    </div>
  );
}

export default WebsiteControl;
