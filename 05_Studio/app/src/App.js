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
import PromoCodeManager from './pages/PromoCodeManager';
import FolderSync from './pages/FolderSync';
import Settings from './pages/Settings';
import AboutEditor from './pages/AboutEditor';
import AgentDashboard from './pages/AgentDashboard';
import AgentPhotoImport from './pages/AgentPhotoImport';
import AgentContentQueue from './pages/AgentContentQueue';
import AgentPipelineMonitor from './pages/AgentPipelineMonitor';
import AgentEtsyListings from './pages/AgentEtsyListings';
import AgentInstagram from './pages/AgentInstagram';
import AgentPinterest from './pages/AgentPinterest';
import AgentCompose from './pages/AgentCompose';
import AgentHealthPanel from './pages/AgentHealthPanel';
import AgentSettings from './pages/AgentSettings';
import MockupTemplates from './pages/MockupTemplates';
import MockupPreview from './pages/MockupPreview';
import MockupBatch from './pages/MockupBatch';
import MockupGallery from './pages/MockupGallery';
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
        <TabPanel id="promos" activeTab={activeTab}>
          <PromoCodeManager />
        </TabPanel>
        <TabPanel id="sync" activeTab={activeTab}>
          <FolderSync />
        </TabPanel>
        <TabPanel id="social" activeTab={activeTab}>
          <SocialMedia />
        </TabPanel>
        <TabPanel id="analytics" activeTab={activeTab}>
          <Analytics />
        </TabPanel>
        <TabPanel id="about" activeTab={activeTab}>
          <AboutEditor />
        </TabPanel>
        <TabPanel id="settings" activeTab={activeTab}>
          <Settings mode={mode} setMode={setMode} />
        </TabPanel>

        {/* Agent Pages */}
        <TabPanel id="agent-dash" activeTab={activeTab}>
          <AgentDashboard />
        </TabPanel>
        <TabPanel id="agent-photos" activeTab={activeTab}>
          <AgentPhotoImport />
        </TabPanel>
        <TabPanel id="agent-queue" activeTab={activeTab}>
          <AgentContentQueue />
        </TabPanel>
        <TabPanel id="agent-pipeline" activeTab={activeTab}>
          <AgentPipelineMonitor />
        </TabPanel>
        <TabPanel id="agent-etsy" activeTab={activeTab}>
          <AgentEtsyListings />
        </TabPanel>
        <TabPanel id="agent-instagram" activeTab={activeTab}>
          <AgentInstagram />
        </TabPanel>
        <TabPanel id="agent-pinterest" activeTab={activeTab}>
          <AgentPinterest />
        </TabPanel>
        <TabPanel id="agent-compose" activeTab={activeTab}>
          <AgentCompose />
        </TabPanel>
        <TabPanel id="agent-health" activeTab={activeTab}>
          <AgentHealthPanel />
        </TabPanel>
        <TabPanel id="agent-settings" activeTab={activeTab}>
          <AgentSettings setActiveTab={setActiveTab} />
        </TabPanel>

        {/* Mockup Pages */}
        <TabPanel id="mockup-templates" activeTab={activeTab}>
          <MockupTemplates />
        </TabPanel>
        <TabPanel id="mockup-preview" activeTab={activeTab}>
          <MockupPreview />
        </TabPanel>
        <TabPanel id="mockup-batch" activeTab={activeTab}>
          <MockupBatch />
        </TabPanel>
        <TabPanel id="mockup-gallery" activeTab={activeTab}>
          <MockupGallery />
        </TabPanel>
      </main>
    </div>
  );
}

export default App;
