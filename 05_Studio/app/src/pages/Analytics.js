import React from 'react';
import '../styles/Pages.css';

function Analytics() {
  return (
    <div className="page">
      <header className="page-header">
        <h2>Analytics</h2>
        <p className="page-subtitle">Track performance across all channels</p>
      </header>

      <div className="card-grid">
        <div className="glass-card">
          <h3>Website Traffic</h3>
          <div className="stat-number">—</div>
          <p>Visitors this week</p>
          <span className="card-note">Google Analytics not configured</span>
        </div>

        <div className="glass-card">
          <h3>Social Engagement</h3>
          <div className="stat-number">—</div>
          <p>Total interactions</p>
          <span className="card-note">No accounts connected</span>
        </div>

        <div className="glass-card">
          <h3>Sales</h3>
          <div className="stat-number">$0</div>
          <p>Revenue this month</p>
        </div>

        <div className="glass-card">
          <h3>Top Content</h3>
          <p>Most engaging posts</p>
          <span className="card-note">No data yet</span>
        </div>

        <div className="glass-card full-width">
          <h3>Daily Report</h3>
          <p>Email summaries to wolfbroadcast@gmail.com</p>
          <p className="card-note">Requires SMTP configuration in .env and Google Analytics integration. Not yet active.</p>
        </div>
      </div>
    </div>
  );
}

export default Analytics;
