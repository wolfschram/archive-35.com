import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ContentIngest from './pages/ContentIngest';
import ContentManagement from './pages/ContentManagement';
import WebsiteControl from './pages/WebsiteControl';
import LicensingManager from './pages/LicensingManager';
import SalesPictorem from './pages/SalesPictorem';
import SocialMedia from './pages/SocialMedia';
import Analytics from './pages/Analytics';
import GalleryPreview from './pages/GalleryPreview';
import Settings from './pages/Settings';
import './styles/App.css';

/**
 * Page wrapper: keeps component mounted but hidden when not active.
 * This preserves all React state (scan results, AI analysis progress,
 * review data, batch phases) across tab switches.
 */
function TabPanel({ id, activeTab, children }) {
  return (
    <div
      className="tab-panel"
      style={{ display: activeTab === id ? 'block' : 'none' }}
      role="tabpanel"
      aria-hidden={activeTab !== id}
    >
      {children}
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('ingest');
  const [mode, setMode] = useState('live');

  useEffect(() => {
    // Load current mode on startup
    if (window.electronAPI?.getMode) {
      window.electronAPI.getMode().then(m => setMode(m));
    }
    // Listen for mode changes from Settings
    if (window.electronAPI?.onModeChanged) {
      const cleanup = window.electronAPI.onModeChanged((newMode) => {
        setMode(newMode);
      });
      return cleanup;
    }
  }, []);

  return (
    <div className="app">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} mode={mode} />
      {mode === 'test' && (
        <div className="test-mode-banner">
          TEST MODE — No real orders, payments, or fulfillment
        </div>
      )}
      <main className={`main-content ${mode === 'test' ? 'test-mode-active' : ''}`}>
        <TabPanel id="ingest" activeTab={activeTab}>
          <ContentIngest />
        </TabPanel>
        <TabPanel id="manage" activeTab={activeTab}>
          <ContentManagement />
        </TabPanel>
        <TabPanel id="gallery" activeTab={activeTab}>
          <GalleryPreview />
        </TabPanel>
        <TabPanel id="website" activeTab={activeTab}>
          <WebsiteControl />
        </TabPanel>
        <TabPanel id="licensing" activeTab={activeTab}>
          <LicensingManager />
        </TabPanel>
        <TabPanel id="sales" activeTab={activeTab}>
          <SalesPictorem />
        </TabPanel>
        <TabPanel id="social" activeTab={activeTab}>
          <SocialMedia />
        </TabPanel>
        <TabPanel id="analytics" activeTab={activeTab}>
          <Analytics />
        </TabPanel>
        <TabPanel id="settings" activeTab={activeTab}>
          <Settings mode={mode} setMode={setMode} />
        </TabPanel>
      </main>
    </div>
  );
}

export default App;
