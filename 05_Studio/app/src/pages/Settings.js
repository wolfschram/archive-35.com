import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

function Settings() {
  const [basePath, setBasePath] = useState('');
  const [apiKeys, setApiKeys] = useState([]);
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [showValue, setShowValue] = useState({});

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getBasePath().then(setBasePath);
      loadApiKeys();
    }
  }, []);

  const loadApiKeys = async () => {
    if (window.electronAPI?.getApiKeys) {
      const keys = await window.electronAPI.getApiKeys();
      setApiKeys(keys || []);
    }
  };

  const startEditing = (key) => {
    setEditingKey(key.id);
    setEditValue(key.value);
    setTestResult(null);
  };

  const cancelEditing = () => {
    setEditingKey(null);
    setEditValue('');
    setTestResult(null);
  };

  const saveKey = async (keyId) => {
    setSaving(true);
    const result = await window.electronAPI.saveApiKey({ keyId, value: editValue });
    if (result.success) {
      setEditingKey(null);
      setEditValue('');
      await loadApiKeys();
    }
    setSaving(false);
  };

  const testKey = async (keyId) => {
    setTesting(keyId);
    setTestResult(null);
    const result = await window.electronAPI.testApiKey({ keyId, value: editValue || apiKeys.find(k => k.id === keyId)?.value });
    setTestResult({ keyId, ...result });
    setTesting(null);
  };

  const toggleShow = (keyId) => {
    setShowValue(prev => ({ ...prev, [keyId]: !prev[keyId] }));
  };

  return (
    <div className="page">
      <header className="page-header">
        <h2>Settings</h2>
        <p className="page-subtitle">Configure Archive-35 Studio</p>
      </header>

      <div className="card-grid">
        {/* Paths */}
        <div className="glass-card full-width">
          <h3>Paths</h3>
          <div className="form-group">
            <label>Archive-35 Base Folder</label>
            <input type="text" value={basePath} readOnly />
          </div>
        </div>

        {/* API Keys */}
        <div className="glass-card full-width">
          <h3>API Keys</h3>
          <p style={{ marginBottom: '16px', color: 'var(--text-muted)' }}>Manage connections to external services. Keys are stored locally in your .env file.</p>

          {apiKeys.map(key => (
            <div key={key.id} style={{
              padding: '16px',
              marginBottom: '12px',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--glass-border)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <div>
                  <strong style={{ color: 'var(--text-primary)' }}>{key.name}</strong>
                  <span style={{ marginLeft: '12px' }}>
                    <span className={`status-badge ${key.configured ? 'online' : 'not-created'}`}>
                      {key.configured ? 'Configured' : 'Not Set'}
                    </span>
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {key.id === 'ANTHROPIC_API_KEY' && key.configured && editingKey !== key.id && (
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '4px 12px', fontSize: '12px' }}
                      onClick={() => testKey(key.id)}
                      disabled={testing === key.id}
                    >
                      {testing === key.id ? 'Testing...' : 'Test'}
                    </button>
                  )}
                  {editingKey !== key.id && (
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '4px 12px', fontSize: '12px' }}
                      onClick={() => startEditing(key)}
                    >
                      {key.configured ? 'Edit' : 'Add Key'}
                    </button>
                  )}
                </div>
              </div>

              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 8px' }}>{key.description}</p>

              {/* Display current value (masked) */}
              {key.configured && editingKey !== key.id && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <code style={{ fontSize: '13px', color: 'var(--text-secondary)', background: 'var(--bg-primary)', padding: '4px 8px', borderRadius: '4px' }}>
                    {showValue[key.id] ? key.value : key.masked}
                  </code>
                  <button
                    onClick={() => toggleShow(key.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '12px' }}
                  >
                    {showValue[key.id] ? 'Hide' : 'Show'}
                  </button>
                </div>
              )}

              {/* Edit mode */}
              {editingKey === key.id && (
                <div style={{ marginTop: '8px' }}>
                  <input
                    type="text"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    placeholder={`Enter ${key.name} key...`}
                    style={{ width: '100%', marginBottom: '8px', fontFamily: 'monospace', fontSize: '13px' }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn btn-primary"
                      style={{ padding: '6px 16px', fontSize: '13px' }}
                      onClick={() => saveKey(key.id)}
                      disabled={saving || !editValue.trim()}
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    {key.id === 'ANTHROPIC_API_KEY' && editValue.trim() && (
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '6px 16px', fontSize: '13px' }}
                        onClick={() => testKey(key.id)}
                        disabled={testing === key.id}
                      >
                        {testing === key.id ? 'Testing...' : 'Test Connection'}
                      </button>
                    )}
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '6px 16px', fontSize: '13px' }}
                      onClick={cancelEditing}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Test result */}
              {testResult && testResult.keyId === key.id && (
                <div style={{
                  marginTop: '8px',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  fontSize: '13px',
                  background: testResult.success ? 'rgba(27, 122, 27, 0.15)' : 'rgba(198, 40, 40, 0.15)',
                  color: testResult.success ? '#4caf50' : '#ef5350'
                }}>
                  {testResult.success ? '✓ ' : '✕ '}
                  {testResult.message || testResult.error}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Notifications */}
        <div className="glass-card">
          <h3>Notifications</h3>
          <label className="checkbox-item">
            <input type="checkbox" defaultChecked />
            <span>Desktop notifications</span>
          </label>
          <label className="checkbox-item">
            <input type="checkbox" defaultChecked />
            <span>Email on errors</span>
          </label>
        </div>

        {/* Backups */}
        <div className="glass-card">
          <h3>Backups</h3>
          <p>Auto-backup before destructive operations</p>
          <label className="checkbox-item">
            <input type="checkbox" defaultChecked />
            <span>Enable auto-backup</span>
          </label>
          <button className="btn btn-secondary">
            Backup Now
          </button>
        </div>
      </div>
    </div>
  );
}

export default Settings;
