import React, { useState } from 'react';
import '../styles/Sidebar.css';

const studioTabs = [
  { id: 'ingest', label: 'Ingest', icon: '📷' },
  { id: 'manage', label: 'Manage', icon: '🗂️' },
  { id: 'gallery', label: 'Gallery', icon: '🖼️' },
  { id: 'website', label: 'Website', icon: '🌐' },
  { id: 'licensing', label: 'Licensing', icon: '📜' },
  { id: 'sales', label: 'Sales', icon: '🛒' },
  { id: 'promos', label: 'Promos', icon: '🏷️' },
  { id: 'sync', label: 'Sync', icon: '☁️' },
  { id: 'social', label: 'Social', icon: '📱' },
  { id: 'analytics', label: 'Analytics', icon: '📊' },
  { id: 'about', label: 'About', icon: '👤' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

const mockupTabs = [
  { id: 'mockup-templates', label: 'Templates', icon: '🏠' },
  { id: 'mockup-preview', label: 'Preview', icon: '🖼️' },
  { id: 'mockup-batch', label: 'Batch', icon: '⚙️' },
  { id: 'mockup-gallery', label: 'Gallery', icon: '📸' },
];

const agentTabs = [
  { id: 'agent-dash', label: 'Dashboard', icon: '🤖' },
  { id: 'agent-photos', label: 'Photos', icon: '🖼️' },
  { id: 'agent-queue', label: 'Queue', icon: '📋' },
  { id: 'agent-pipeline', label: 'Pipeline', icon: '🔄' },
  { id: 'agent-etsy', label: 'Etsy', icon: '🏷️' },
  { id: 'agent-instagram', label: 'Instagram', icon: '📷' },
  { id: 'agent-pinterest', label: 'Pinterest', icon: '📌' },
  { id: 'agent-compose', label: 'Compose', icon: '✏️' },
  { id: 'agent-health', label: 'Health', icon: '🩺' },
  { id: 'agent-settings', label: 'Settings', icon: '⚙️' },
];

function Sidebar({ activeTab, setActiveTab, mode }) {
  // Auto-expand the section that contains the active tab
  const isAgentTab = activeTab.startsWith('agent-');
  const isMockupTab = activeTab.startsWith('mockup-');
  const [studioOpen, setStudioOpen] = useState(!isAgentTab && !isMockupTab);
  const [agentOpen, setAgentOpen] = useState(true);
  const [mockupOpen, setMockupOpen] = useState(isMockupTab);

  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
    // Auto-expand the section when a tab is clicked
    if (tabId.startsWith('agent-')) {
      setAgentOpen(true);
    } else if (tabId.startsWith('mockup-')) {
      setMockupOpen(true);
    } else {
      setStudioOpen(true);
    }
  };

  const renderTab = (tab) => (
    <button
      key={tab.id}
      className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
      onClick={() => handleTabClick(tab.id)}
    >
      <span className="nav-icon">{tab.icon}</span>
      <span className="nav-label">{tab.label}</span>
    </button>
  );

  return (
    <aside className={`sidebar ${mode === 'test' ? 'sidebar-test-mode' : ''}`}>
      <div className="sidebar-header">
        <h1 className="logo">
          <span className="logo-archive">ARCHIVE</span>
          <span className="logo-35">-35</span>
        </h1>
        <span className="logo-subtitle">STUDIO</span>
      </div>

      <nav className="sidebar-nav">
        {/* ── STUDIO Section ── */}
        <button
          className="section-header"
          onClick={() => setStudioOpen(!studioOpen)}
        >
          <span className={`section-chevron ${studioOpen ? 'open' : ''}`}>&#9656;</span>
          <span className="section-label">STUDIO</span>
          <span className="section-count">{studioTabs.length}</span>
        </button>
        {studioOpen && (
          <div className="section-items">
            {studioTabs.map(renderTab)}
          </div>
        )}

        {/* ── AGENT Section ── */}
        <button
          className="section-header agent-section"
          onClick={() => setAgentOpen(!agentOpen)}
        >
          <span className={`section-chevron ${agentOpen ? 'open' : ''}`}>&#9656;</span>
          <span className="section-label">AGENT</span>
          <span className="section-count">{agentTabs.length}</span>
        </button>
        {agentOpen && (
          <div className="section-items">
            {agentTabs.map(renderTab)}
          </div>
        )}

        {/* ── MOCKUP Section ── */}
        <button
          className="section-header mockup-section"
          onClick={() => setMockupOpen(!mockupOpen)}
        >
          <span className={`section-chevron ${mockupOpen ? 'open' : ''}`}>&#9656;</span>
          <span className="section-label">MOCKUP</span>
          <span className="section-count">{mockupTabs.length}</span>
        </button>
        {mockupOpen && (
          <div className="section-items">
            {mockupTabs.map(renderTab)}
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className={`status-indicator ${mode === 'test' ? 'test-mode' : 'online'}`}>
          <span className="status-dot"></span>
          <span>{mode === 'test' ? 'TEST MODE' : 'Live — Operational'}</span>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
