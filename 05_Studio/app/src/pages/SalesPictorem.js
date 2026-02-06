import React from 'react';
import '../styles/Pages.css';

function SalesPictorem() {
  return (
    <div className="page">
      <header className="page-header">
        <h2>Sales / Pictorem</h2>
        <p className="page-subtitle">Manage print fulfillment and sales</p>
      </header>

      <div className="card-grid">
        <div className="glass-card">
          <h3>Pictorem Connection</h3>
          <div className="status-row">
            <span>API Status</span>
            <span className="status-badge online">Connected</span>
          </div>
          <div className="status-row">
            <span>API Key</span>
            <span className="status-badge online">Configured</span>
          </div>
          <div className="status-row">
            <span>Account</span>
            <span className="status-badge online">PRO (15% rebate)</span>
          </div>
          <p className="card-note">
            Token: archive-35 &middot; USD pricing &middot; www.pictorem.com
          </p>
        </div>

        <div className="glass-card">
          <h3>Upload Queue</h3>
          <div className="stat-number">28</div>
          <p>Photos pending upload to Pictorem</p>
          <button className="btn btn-secondary" disabled>
            Sync to Pictorem
          </button>
        </div>

        <div className="glass-card">
          <h3>Live Products</h3>
          <div className="stat-number">0</div>
          <p>Products available for sale</p>
        </div>

        <div className="glass-card">
          <h3>Print Materials</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
            <li style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>Canvas</li>
            <li style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>Metal</li>
            <li style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>Acrylic</li>
            <li style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>Fine Art Paper</li>
            <li style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>Wood</li>
          </ul>
        </div>

        <div className="glass-card">
          <h3>Sales</h3>
          <div className="stat-number">$0</div>
          <p>Total revenue (all time)</p>
        </div>
      </div>
    </div>
  );
}

export default SalesPictorem;
