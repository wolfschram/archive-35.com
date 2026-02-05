import React from 'react';
import '../styles/Pages.css';

const platforms = [
  { name: 'Instagram', handle: '@archive35', status: 'not_created' },
  { name: 'Facebook', handle: 'Archive-35', status: 'not_created' },
  { name: 'TikTok', handle: '@archive35', status: 'not_created' },
  { name: 'LinkedIn', handle: 'Archive-35', status: 'not_created' },
  { name: 'X', handle: '@archive35', status: 'not_created' },
  { name: 'Bluesky', handle: '@archive35.bsky.social', status: 'not_created' },
];

function SocialMedia() {
  return (
    <div className="page">
      <header className="page-header">
        <h2>Social Media</h2>
        <p className="page-subtitle">Manage posts across all platforms</p>
      </header>

      <div className="card-grid">
        <div className="glass-card full-width">
          <h3>Platform Connections</h3>
          <div className="platform-list">
            {platforms.map((platform) => (
              <div key={platform.name} className="platform-row">
                <div className="platform-info">
                  <strong>{platform.name}</strong>
                  <span className="platform-handle">{platform.handle}</span>
                </div>
                <span className="status-badge not-created">Not Created</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card">
          <h3>Post Queue</h3>
          <div className="stat-number">0</div>
          <p>Posts scheduled</p>
          <button className="btn btn-primary">
            Create Post
          </button>
        </div>

        <div className="glass-card">
          <h3>Schedule</h3>
          <p>Posting frequency: 2x daily</p>
          <div className="schedule-times">
            <div>Morning: 9:00 AM PT</div>
            <div>Evening: 5:00 PM PT</div>
          </div>
        </div>

        <div className="glass-card">
          <h3>Templates</h3>
          <p>Pre-configured post formats</p>
          <button className="btn btn-secondary">
            Manage Templates
          </button>
        </div>
      </div>
    </div>
  );
}

export default SocialMedia;
