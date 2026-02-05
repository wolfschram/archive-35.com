import React from 'react';
import '../styles/Sidebar.css';

const tabs = [
  { id: 'ingest', label: 'Ingest', icon: '📷' },
  { id: 'manage', label: 'Manage', icon: '🗂️' },
  { id: 'website', label: 'Website', icon: '🌐' },
  { id: 'sales', label: 'Sales', icon: '🛒' },
  { id: 'social', label: 'Social', icon: '📱' },
  { id: 'analytics', label: 'Analytics', icon: '📊' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

function Sidebar({ activeTab, setActiveTab }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="logo">
          <span className="logo-archive">ARCHIVE</span>
          <span className="logo-35">-35</span>
        </h1>
        <span className="logo-subtitle">STUDIO</span>
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
        <div className="status-indicator online">
          <span className="status-dot"></span>
          <span>All systems operational</span>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
