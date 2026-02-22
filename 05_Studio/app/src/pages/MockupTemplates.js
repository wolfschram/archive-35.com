import React, { useState, useEffect } from 'react';

/**
 * MockupTemplates — Tab 1: Room Template Manager
 *
 * Manages room templates: grid view, import, placement zone editor.
 * Phase 4 will add: drag-handle corner editor, template creation workflow.
 */
function MockupTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [serviceOnline, setServiceOnline] = useState(false);

  useEffect(() => {
    checkService();
  }, []);

  const checkService = async () => {
    try {
      const status = await window.electronAPI.mockupStatus();
      setServiceOnline(status.online);
      if (status.online) {
        loadTemplates();
      }
    } catch {
      setServiceOnline(false);
    }
    setLoading(false);
  };

  const loadTemplates = async () => {
    try {
      const result = await window.electronAPI.mockupGetTemplates();
      if (result?.data?.templates) {
        setTemplates(result.data.templates);
      }
    } catch (err) {
      console.error('Failed to load templates:', err);
    }
  };

  if (loading) {
    return <div className="page-container"><p>Loading...</p></div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>Room Templates</h2>
        <p className="page-subtitle">
          Manage room templates for mockup compositing
        </p>
      </div>

      {!serviceOnline ? (
        <div className="status-card" style={{ background: '#2a2a2a', padding: '20px', borderRadius: '8px', marginTop: '16px' }}>
          <p style={{ color: '#ff6b6b' }}>Mockup Service Offline</p>
          <p style={{ color: '#999', fontSize: '14px' }}>
            The mockup compositing service is not running. It should auto-start with Studio.
          </p>
          <button
            onClick={async () => {
              await window.electronAPI.mockupStart();
              checkService();
            }}
            style={{ marginTop: '12px', padding: '8px 16px', background: '#4a9eff', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}
          >
            Start Service
          </button>
        </div>
      ) : (
        <div style={{ marginTop: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
            {templates.map(t => (
              <div key={t.id} style={{
                background: '#2a2a2a',
                borderRadius: '8px',
                padding: '16px',
                border: '1px solid #3a3a3a'
              }}>
                <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>{t.name}</h3>
                <p style={{ color: '#999', fontSize: '13px', margin: '0 0 4px' }}>
                  Category: {t.category}
                </p>
                <p style={{ color: '#999', fontSize: '13px', margin: '0 0 4px' }}>
                  {t.dimensions.width}x{t.dimensions.height} — {t.zoneCount} zone(s)
                </p>
                <p style={{ color: '#999', fontSize: '13px', margin: '0' }}>
                  Print sizes: {t.printSizes?.join(', ')}
                </p>
              </div>
            ))}
          </div>

          {templates.length === 0 && (
            <p style={{ color: '#666', textAlign: 'center', marginTop: '40px' }}>
              No templates yet. Import a room photo to create your first template.
            </p>
          )}

          <p style={{ color: '#666', fontSize: '13px', marginTop: '24px' }}>
            Full template editor with drag-handle placement zones coming in Phase 4.
          </p>
        </div>
      )}
    </div>
  );
}

export default MockupTemplates;
