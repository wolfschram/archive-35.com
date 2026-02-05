import React from 'react';
import '../styles/Pages.css';

function SalesArtelo() {
  return (
    <div className="page">
      <header className="page-header">
        <h2>Sales / Artelo</h2>
        <p className="page-subtitle">Manage print fulfillment and sales</p>
      </header>

      <div className="card-grid">
        <div className="glass-card">
          <h3>Artelo Connection</h3>
          <div className="status-row">
            <span>API Status</span>
            <span className="status-badge pending">Pending Docs</span>
          </div>
          <div className="status-row">
            <span>API Key</span>
            <span className="status-badge online">Configured</span>
          </div>
          <p className="card-note">
            Waiting for API documentation from Artelo.
            Email sent to info@artelo.io
          </p>
        </div>

        <div className="glass-card">
          <h3>Upload Queue</h3>
          <div className="stat-number">28</div>
          <p>Photos pending upload to Artelo</p>
          <button className="btn btn-secondary" disabled>
            Sync to Artelo
          </button>
        </div>

        <div className="glass-card">
          <h3>Live Products</h3>
          <div className="stat-number">0</div>
          <p>Products available for sale</p>
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

export default SalesArtelo;
