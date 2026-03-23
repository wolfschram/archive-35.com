import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

function RenderQueue() {
  const [queue, setQueue] = useState([]);
  const [history, setHistory] = useState([]);
  const [view, setView] = useState('queue'); // queue | history

  useEffect(() => {
    loadQueue();
  }, []);

  async function loadQueue() {
    if (!window.electronAPI) return;
    const data = await window.electronAPI.getRenderQueue();
    setQueue(data.queue || []);
    setHistory(data.history || []);
  }

  async function removeFromQueue(id) {
    const updated = queue.filter(item => item.id !== id);
    setQueue(updated);
    await window.electronAPI.saveRenderQueue({ queue: updated, history });
  }

  async function moveToHistory(item) {
    const updatedQueue = queue.filter(q => q.id !== item.id);
    const updatedHistory = [{ ...item, completedAt: new Date().toISOString() }, ...history];
    setQueue(updatedQueue);
    setHistory(updatedHistory);
    await window.electronAPI.saveRenderQueue({ queue: updatedQueue, history: updatedHistory });
  }

  return (
    <div className="page">
      <header className="page-header">
        <h2>Render Queue</h2>
        <p className="page-subtitle">{queue.length} in queue &middot; {history.length} completed</p>
      </header>

      <div className="toggle-group">
        <button className={`toggle-btn ${view === 'queue' ? 'active' : ''}`} onClick={() => setView('queue')}>
          Queue ({queue.length})
        </button>
        <button className={`toggle-btn ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>
          Completed ({history.length})
        </button>
      </div>

      {view === 'queue' && (
        <div className="glass-card full-width">
          {queue.length === 0 ? (
            <div className="empty-state">Queue is empty. Use the Compositor to create videos.</div>
          ) : (
            <div className="queue-list">
              {queue.map(item => (
                <div key={item.id} className="queue-item">
                  <div className="queue-item-thumb">
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                      🎬
                    </div>
                  </div>
                  <div className="queue-item-info" style={{ flex: 1 }}>
                    <div className="queue-item-title">{item.gallery}</div>
                    <div className="queue-item-meta">
                      {item.template} &middot; {item.photoCount} photos &middot; {new Date(item.created).toLocaleDateString()}
                    </div>
                  </div>
                  <span className={`status-badge ${item.status === 'rendered' ? 'online' : 'pending'}`}>
                    {item.status}
                  </span>
                  <div className="button-group" style={{ margin: 0 }}>
                    {item.videoPath && (
                      <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }}
                        onClick={() => window.electronAPI.openInFinder(item.videoPath)}>
                        Finder
                      </button>
                    )}
                    <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 12 }}
                      onClick={() => moveToHistory(item)}>
                      Done
                    </button>
                    <button className="btn btn-danger" style={{ padding: '6px 12px', fontSize: 12 }}
                      onClick={() => removeFromQueue(item.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'history' && (
        <div className="glass-card full-width">
          {history.length === 0 ? (
            <div className="empty-state">No completed renders yet.</div>
          ) : (
            <div className="queue-list">
              {history.map((item, i) => (
                <div key={i} className="queue-item">
                  <div className="queue-item-thumb">
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                      ✅
                    </div>
                  </div>
                  <div className="queue-item-info">
                    <div className="queue-item-title">{item.gallery}</div>
                    <div className="queue-item-meta">
                      {item.template} &middot; {item.photoCount} photos &middot; Completed {new Date(item.completedAt).toLocaleDateString()}
                    </div>
                  </div>
                  {item.videoPath && (
                    <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }}
                      onClick={() => window.electronAPI.openInFinder(item.videoPath)}>
                      Open
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default RenderQueue;
