import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ContentIngest from './pages/ContentIngest';
import ContentManagement from './pages/ContentManagement';
import WebsiteControl from './pages/WebsiteControl';
import SalesPictorem from './pages/SalesPictorem';
import SocialMedia from './pages/SocialMedia';
import Analytics from './pages/Analytics';
import GalleryPreview from './pages/GalleryPreview';
import Settings from './pages/Settings';
import './styles/App.css';

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

  const renderPage = () => {
    switch (activeTab) {
      case 'ingest':
        return <ContentIngest />;
      case 'manage':
        return <ContentManagement />;
      case 'gallery':
        return <GalleryPreview />;
      case 'website':
        return <WebsiteControl />;
      case 'sales':
        return <SalesPictorem />;
      case 'social':
        return <SocialMedia />;
      case 'analytics':
        return <Analytics />;
      case 'settings':
        return <Settings mode={mode} setMode={setMode} />;
      default:
        return <ContentIngest />;
    }
  };

  return (
    <div className="app">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} mode={mode} />
      {mode === 'test' && (
        <div className="test-mode-banner">
          TEST MODE — No real orders, payments, or fulfillment
        </div>
      )}
      <main className={`main-content ${mode === 'test' ? 'test-mode-active' : ''}`}>
        {renderPage()}
      </main>
    </div>
  );
}

export default App;
