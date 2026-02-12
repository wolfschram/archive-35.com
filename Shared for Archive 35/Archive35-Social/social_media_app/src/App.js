import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import GalleryBrowser from './pages/GalleryBrowser';
import Compositor from './pages/Compositor';
import RenderQueue from './pages/RenderQueue';
import Schedule from './pages/Schedule';
import PostHistory from './pages/PostHistory';
import Handshake from './pages/Handshake';
import Settings from './pages/Settings';
import './styles/App.css';

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
  const [activeTab, setActiveTab] = useState('dashboard');
  const [studioConnected, setStudioConnected] = useState(false);

  useEffect(() => {
    checkStudio();
    const interval = setInterval(checkStudio, 30000);
    return () => clearInterval(interval);
  }, []);

  async function checkStudio() {
    if (!window.electronAPI) return;
    const studio = await window.electronAPI.readStudioStatus();
    if (studio?.timestamp) {
      const age = Date.now() - new Date(studio.timestamp).getTime();
      setStudioConnected(age < 5 * 60 * 1000); // 5 min threshold
    } else {
      setStudioConnected(false);
    }
  }

  return (
    <div className="app">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} studioConnected={studioConnected} />
      <main className="main-content">
        <TabPanel id="dashboard" activeTab={activeTab}>
          <Dashboard />
        </TabPanel>
        <TabPanel id="galleries" activeTab={activeTab}>
          <GalleryBrowser />
        </TabPanel>
        <TabPanel id="compositor" activeTab={activeTab}>
          <Compositor />
        </TabPanel>
        <TabPanel id="queue" activeTab={activeTab}>
          <RenderQueue />
        </TabPanel>
        <TabPanel id="schedule" activeTab={activeTab}>
          <Schedule />
        </TabPanel>
        <TabPanel id="history" activeTab={activeTab}>
          <PostHistory />
        </TabPanel>
        <TabPanel id="handshake" activeTab={activeTab}>
          <Handshake />
        </TabPanel>
        <TabPanel id="settings" activeTab={activeTab}>
          <Settings />
        </TabPanel>
      </main>
    </div>
  );
}

export default App;
