import React from 'react';
import '../styles/Sidebar.css';

const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'galleries', label: 'Galleries', icon: '🖼️' },
  { id: 'compositor', label: 'Compositor', icon: '🎬' },
  { id: 'queue', label: 'Queue', icon: '📋' },
  { id: 'schedule', label: 'Schedule', icon: '📅' },
  { id: 'history', label: 'History', icon: '✅' },
  { id: 'handshake', label: 'Handshake', icon: '🤝' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

function Sidebar({ activeTab, setActiveTab, studioConnected }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="logo">
          <span className="logo-archive">ARCHIVE</span>
          <span className="logo-35">-35</span>
        </h1>
        <span className="logo-subtitle">SOCIAL MEDIA</span>
      </div>

      <nav className="sidebar-nav">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="nav-icon">{tab.icon}</span>
            <span className="nav-label">{tab.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className={`status-indicator ${studioConnected ? 'online' : 'offline'}`}>
          <span className="status-dot"></span>
          <span>{studioConnected ? 'Studio Connected' : 'Studio Offline'}</span>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
