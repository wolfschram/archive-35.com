import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import ContentIngest from './pages/ContentIngest';
import ContentManagement from './pages/ContentManagement';
import WebsiteControl from './pages/WebsiteControl';
import SalesArtelo from './pages/SalesArtelo';
import SocialMedia from './pages/SocialMedia';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import './styles/App.css';

function App() {
  const [activeTab, setActiveTab] = useState('ingest');

  const renderPage = () => {
    switch (activeTab) {
      case 'ingest':
        return <ContentIngest />;
      case 'manage':
        return <ContentManagement />;
      case 'website':
        return <WebsiteControl />;
      case 'sales':
        return <SalesArtelo />;
      case 'social':
        return <SocialMedia />;
      case 'analytics':
        return <Analytics />;
      case 'settings':
        return <Settings />;
      default:
        return <ContentIngest />;
    }
  };

  return (
    <div className="app">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  );
}

export default App;
