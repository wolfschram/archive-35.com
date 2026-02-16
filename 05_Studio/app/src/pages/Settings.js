import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

function Settings({ mode, setMode }) {
  const [basePath, setBasePath] = useState('');
  const [apiKeys, setApiKeys] = useState([]);
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [showValue, setShowValue] = useState({});
  const [modeConfig, setModeConfig] = useState(null);
  const [switching, setSwitching] = useState(false);
  const [deploySteps, setDeploySteps] = useState([]);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getBasePath().then(setBasePath);
      loadApiKeys();
      loadModeConfig();

      // Listen for mode deploy progress
      if (window.electronAPI.onModeDeployProgress) {
        const cleanup = window.electronAPI.onModeDeployProgress((data) => {
          setDeploySteps(prev => {
            const existing = prev.findIndex(s => s.step === data.step);
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = data;
              return updated;
            }
            return [...prev, data];
          });
        });
        return cleanup;
      }
    }
  }, []);

  useEffect(() => {
    loadModeConfig();
  }, [mode]);

  const loadApiKeys = async () => {
    if (window.electronAPI?.getApiKeys) {
      const keys = await window.electronAPI.getApiKeys();
      setApiKeys(keys || []);
    }
  };

  const loadModeConfig = async () => {
    if (window.electronAPI?.getModeConfig) {
      const config = await window.electronAPI.getModeConfig();
      setModeConfig(config);
    }
  };

  const toggleMode = async () => {
    const newMode = mode === 'live' ? 'test' : 'live';
    setSwitching(true);
    setDeploySteps([]);
    try {
      const result = await window.electronAPI.setMode(newMode);
      if (result.success) {
        setMode(newMode);
      }
    } catch (err) {
      console.error('Mode switch failed:', err);
    }
    setSwitching(false);
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

  // Separate test-mode keys from regular keys
  const testModeKeys = ['STRIPE_TEST_SECRET_KEY', 'STRIPE_TEST_PUBLISHABLE_KEY', 'STRIPE_TEST_WEBHOOK_SECRET'];
  const isTestKey = (id) => testModeKeys.includes(id) || id.startsWith('STRIPE_TEST_');

  return (
    <div className="page">
      <header className="page-header">
        <h2>Settings</h2>
        <p className="page-subtitle">Configure Archive-35 Studio</p>
      </header>

      <div className="card-grid">

        {/* ============================================
            ENVIRONMENT MODE — MOST PROMINENT
            ============================================ */}
        <div className="glass-card full-width" style={{
          border: mode === 'test' ? '2px solid #ff9800' : '2px solid var(--success)',
          background: mode === 'test'
            ? 'linear-gradient(135deg, rgba(255,152,0,0.08) 0%, rgba(255,107,0,0.04) 100%)'
            : 'linear-gradient(135deg, rgba(76,175,80,0.08) 0%, rgba(27,122,27,0.04) 100%)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                Environment Mode
                <span style={{
                  display: 'inline-block',
                  padding: '3px 12px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  background: mode === 'test' ? '#ff9800' : 'var(--success)',
                  color: '#000',
                }}>
                  {mode === 'test' ? 'TEST' : 'LIVE'}
                </span>
              </h3>
              <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '13px' }}>
                {mode === 'test'
                  ? 'Test mode active — Stripe uses test keys, Pictorem orders are mocked, R2 uploads go to test/ prefix'
                  : 'Live mode — All services connected to production. Real orders, real money, real fulfillment.'
                }
              </p>
            </div>

            {/* Toggle Switch */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
              <span style={{
                fontSize: '13px',
                fontWeight: mode === 'live' ? 700 : 400,
                color: mode === 'live' ? 'var(--success)' : 'var(--text-muted)'
              }}>LIVE</span>

              <button
                onClick={toggleMode}
                disabled={switching}
                style={{
                  width: '56px',
                  height: '28px',
                  borderRadius: '14px',
                  border: 'none',
                  cursor: switching ? 'wait' : 'pointer',
                  position: 'relative',
                  transition: 'background 0.3s ease',
                  background: mode === 'test' ? '#ff9800' : 'var(--success)',
                }}
              >
                <span style={{
                  position: 'absolute',
                  top: '3px',
                  left: mode === 'test' ? '31px' : '3px',
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 0.3s ease',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </button>

              <span style={{
                fontSize: '13px',
                fontWeight: mode === 'test' ? 700 : 400,
                color: mode === 'test' ? '#ff9800' : 'var(--text-muted)'
              }}>TEST</span>
            </div>
          </div>

          {/* Mode details grid */}
          {modeConfig && (
            <div style={{
              marginTop: '16px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '12px',
            }}>
              <div style={{ padding: '12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--glass-border)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>Stripe</div>
                <div style={{ fontSize: '13px', color: modeConfig.stripe?.configured ? 'var(--success)' : '#ff9800' }}>
                  {modeConfig.stripe?.configured ? 'Connected' : 'Keys needed'}
                </div>
              </div>
              <div style={{ padding: '12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--glass-border)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>Pictorem</div>
                <div style={{ fontSize: '13px', color: modeConfig.pictorem?.useMock ? '#ff9800' : 'var(--success)' }}>
                  {modeConfig.pictorem?.useMock ? 'Mock (simulated)' : 'Live fulfillment'}
                </div>
              </div>
              <div style={{ padding: '12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--glass-border)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>R2 Storage</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {modeConfig.r2?.prefix ? 'test/ prefix' : 'Production path'}
                </div>
              </div>
            </div>
          )}

          {/* Deploy Progress Steps — shown during mode switch */}
          {deploySteps.length > 0 && (
            <div style={{
              marginTop: '16px',
              padding: '12px 16px',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--glass-border)',
            }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>
                Deploy Progress
              </div>
              {deploySteps.map((s, i) => (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '4px 0',
                  fontSize: '13px',
                  color: s.status === 'ok' ? 'var(--success)'
                       : s.status === 'error' ? '#f44336'
                       : s.status === 'warning' ? '#ff9800'
                       : 'var(--text-secondary)',
                }}>
                  <span style={{ fontSize: '16px', width: '20px', textAlign: 'center' }}>
                    {s.status === 'ok' ? '\u2713'
                     : s.status === 'error' ? '\u2717'
                     : s.status === 'warning' ? '\u26A0'
                     : '\u25CF'}
                  </span>
                  <span>{s.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Test Mode Credentials (only show when in test mode) */}
        {mode === 'test' && (
          <div className="glass-card full-width" style={{ borderLeft: '3px solid #ff9800' }}>
            <h3 style={{ color: '#ff9800' }}>Test Mode Credentials</h3>
            <p style={{ marginBottom: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
              Configure Stripe test keys. Get these from{' '}
              <span style={{ color: '#ff9800' }}>Stripe Dashboard → Developers → API keys</span>{' '}
              (make sure "Test mode" toggle is ON).
            </p>

            {['STRIPE_TEST_SECRET_KEY', 'STRIPE_TEST_PUBLISHABLE_KEY', 'STRIPE_TEST_WEBHOOK_SECRET'].map(keyId => {
              const env = apiKeys.find(k => k.id === keyId);
              const configured = env?.configured || false;
              const labels = {
                'STRIPE_TEST_SECRET_KEY': { name: 'Stripe Test Secret Key', desc: 'sk_test_...' },
                'STRIPE_TEST_PUBLISHABLE_KEY': { name: 'Stripe Test Publishable Key', desc: 'pk_test_...' },
                'STRIPE_TEST_WEBHOOK_SECRET': { name: 'Stripe Test Webhook Secret', desc: 'whsec_... (from Stripe CLI or dashboard)' },
              };
              const label = labels[keyId] || { name: keyId, desc: '' };

              return (
                <div key={keyId} style={{
                  padding: '12px 16px',
                  marginBottom: '8px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--glass-border)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>{label.name}</strong>
                      <span style={{ marginLeft: '8px' }}>
                        <span className={`status-badge ${configured ? 'online' : 'not-created'}`} style={{ fontSize: '10px' }}>
                          {configured ? 'Set' : 'Needed'}
                        </span>
                      </span>
                      <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '2px 0 0' }}>{label.desc}</p>
                    </div>
                    {editingKey !== keyId && (
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '3px 10px', fontSize: '11px' }}
                        onClick={() => { setEditingKey(keyId); setEditValue(env?.value || ''); setTestResult(null); }}
                      >
                        {configured ? 'Edit' : 'Add'}
                      </button>
                    )}
                  </div>
                  {editingKey === keyId && (
                    <div style={{ marginTop: '8px' }}>
                      <input
                        type="text"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        placeholder={label.desc}
                        style={{ width: '100%', marginBottom: '8px', fontFamily: 'monospace', fontSize: '12px' }}
                        autoFocus
                      />
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={() => saveKey(keyId)} disabled={saving || !editValue.trim()}>
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={cancelEditing}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <div style={{
              marginTop: '12px',
              padding: '12px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(255,152,0,0.08)',
              border: '1px solid rgba(255,152,0,0.2)',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
            }}>
              <strong style={{ color: '#ff9800' }}>Test card:</strong> 4242 4242 4242 4242 (any future exp, any CVC)<br/>
              <strong style={{ color: '#ff9800' }}>Pictorem:</strong> Orders are fully mocked — no real prints created<br/>
              <strong style={{ color: '#ff9800' }}>Webhook:</strong> Use <code style={{ background: 'var(--bg-primary)', padding: '1px 4px', borderRadius: '3px' }}>stripe listen --forward-to localhost:8788/api/stripe-webhook</code>
            </div>
          </div>
        )}

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

          {apiKeys.filter(key => !isTestKey(key.id)).map(key => (
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
                  {(key.id === 'ANTHROPIC_API_KEY' || key.id === 'R2_ACCESS_KEY_ID' || key.id === 'R2_SECRET_ACCESS_KEY') && key.configured && editingKey !== key.id && (
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
                    {(key.id === 'ANTHROPIC_API_KEY' || key.id === 'R2_ACCESS_KEY_ID' || key.id === 'R2_SECRET_ACCESS_KEY') && editValue.trim() && (
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
