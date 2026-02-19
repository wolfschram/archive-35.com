import React, { useState, useEffect } from 'react';
import useAgentApi from '../hooks/useAgentApi';

/**
 * AgentSettings — Configure Agent-specific API keys, shared keys (read-only),
 * photo source, and agent configuration (budget, log level, schedule).
 */
function AgentSettings() {
  const { get, post, loading, error, setError } = useAgentApi();

  // Agent-specific API keys (editable)
  const AGENT_API_KEYS = [
    { id: 'LATE_API_KEY', name: 'Late API Key', desc: 'Social media posting integration' },
    { id: 'TELEGRAM_BOT_TOKEN', name: 'Telegram Bot Token', desc: 'Approval bot token (starts with digits:)' },
    { id: 'TELEGRAM_CHAT_ID', name: 'Telegram Chat ID', desc: "Wolf's Telegram chat ID for notifications" },
    { id: 'ETSY_API_KEY', name: 'Etsy API Key', desc: 'Etsy marketplace integration (Phase 2)' },
    { id: 'ETSY_API_SECRET', name: 'Etsy API Secret', desc: 'Etsy API secret key (Phase 2)' },
    { id: 'SHOPIFY_STORE_URL', name: 'Shopify Store URL', desc: 'Shopify store domain (Phase 2)' },
    { id: 'SHOPIFY_API_KEY', name: 'Shopify API Key', desc: 'Shopify API key (Phase 2)' },
    { id: 'SHOPIFY_API_SECRET', name: 'Shopify API Secret', desc: 'Shopify API secret (Phase 2)' },
  ];

  // Shared keys from Studio Settings (read-only)
  const SHARED_KEYS = [
    { id: 'ANTHROPIC_API_KEY', name: 'Claude API Key', desc: 'Anthropic Claude API for vision analysis' },
    { id: 'R2_ACCESS_KEY_ID', name: 'R2 Access Key ID', desc: 'Cloudflare R2 credentials' },
    { id: 'R2_SECRET_ACCESS_KEY', name: 'R2 Secret Access Key', desc: 'Cloudflare R2 secret' },
    { id: 'R2_ENDPOINT', name: 'R2 Endpoint', desc: 'Cloudflare R2 endpoint URL' },
    { id: 'R2_BUCKET_NAME', name: 'R2 Bucket Name', desc: 'Cloudflare R2 bucket name' },
    { id: 'PICTOREM_API_KEY', name: 'Pictorem API Key', desc: 'Print fulfillment service' },
  ];

  // Agent keys (from Agent .env)
  const [agentKeys, setAgentKeys] = useState({});
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [showValue, setShowValue] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [testingKey, setTestingKey] = useState(null);
  const [testResult, setTestResult] = useState(null);

  // Shared keys (from Studio via IPC)
  const [sharedKeys, setSharedKeys] = useState({});
  const [sharedLoading, setSharedLoading] = useState(true);

  // Photo source config
  const [photoSource, setPhotoSource] = useState('local');
  const [photoImportDir, setPhotoImportDir] = useState('');
  const [loadingPhotoSource, setLoadingPhotoSource] = useState(true);

  // Agent config
  const [agentConfig, setAgentConfig] = useState({
    daily_budget_usd: 5.00,
    log_level: 'INFO',
    db_path: 'data/archive35.db',
  });
  const [editingConfig, setEditingConfig] = useState(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [pipelineSchedule, setPipelineSchedule] = useState(null);

  // Fetch shared keys from Studio Settings
  useEffect(() => {
    if (window.electronAPI?.getAgentConfig) {
      window.electronAPI.getAgentConfig()
        .then(config => {
          if (config?.shared_keys) {
            setSharedKeys(config.shared_keys);
          }
          setSharedLoading(false);
        })
        .catch(err => {
          console.error('Failed to load shared keys:', err);
          setSharedLoading(false);
        });
    } else {
      setSharedLoading(false);
    }
  }, []);

  // Load Agent settings
  useEffect(() => {
    loadAgentKeys();
    loadPhotoSource();
    loadAgentConfig();
  }, []);

  const loadAgentKeys = async () => {
    try {
      const data = await get('/config/keys');
      setAgentKeys(data || {});
    } catch (err) {
      console.error('Failed to load Agent keys:', err);
    }
  };

  const loadPhotoSource = async () => {
    try {
      setLoadingPhotoSource(true);
      const data = await get('/config/photo-source');
      setPhotoSource(data?.source || 'local');
      if (data?.import_dir) {
        setPhotoImportDir(data.import_dir);
      }
      setLoadingPhotoSource(false);
    } catch (err) {
      console.error('Failed to load photo source config:', err);
      setLoadingPhotoSource(false);
    }
  };

  const loadAgentConfig = async () => {
    try {
      const data = await get('/config');
      if (data) {
        setAgentConfig({
          daily_budget_usd: data.daily_budget_usd || 5.00,
          log_level: data.log_level || 'INFO',
          db_path: data.db_path || 'data/archive35.db',
        });
        if (data.pipeline_schedule) {
          setPipelineSchedule(data.pipeline_schedule);
        }
      }
    } catch (err) {
      console.error('Failed to load Agent config:', err);
    }
  };

  const saveAgentKey = async (keyId) => {
    setSavingKey(keyId);
    try {
      await post('/config/keys', {
        [keyId]: editValue,
      });
      setEditingKey(null);
      setEditValue('');
      setTestResult(null);
      await loadAgentKeys();
    } catch (err) {
      setError(`Failed to save ${keyId}: ${err.message}`);
    }
    setSavingKey(null);
  };

  const testAgentKey = async (keyId) => {
    setTestingKey(keyId);
    setTestResult(null);
    try {
      const value = editValue || agentKeys[keyId];
      const result = await post('/config/test-key', {
        key_id: keyId,
        value: value,
      });
      setTestResult({ keyId, ...result });
    } catch (err) {
      setTestResult({
        keyId,
        success: false,
        message: `Test failed: ${err.message}`,
      });
    }
    setTestingKey(null);
  };

  const saveAgentConfig = async () => {
    setSavingConfig(true);
    try {
      await post('/config', agentConfig);
      await loadAgentConfig();
    } catch (err) {
      setError(`Failed to save config: ${err.message}`);
    }
    setSavingConfig(false);
  };

  const savePhotoSource = async () => {
    try {
      await post('/config/photo-source', {
        source: photoSource,
        import_dir: photoImportDir,
      });
    } catch (err) {
      setError(`Failed to save photo source: ${err.message}`);
    }
  };

  const testConnection = async (type) => {
    setTestingKey(`connection_${type}`);
    setTestResult(null);
    try {
      let result;
      if (type === 'claude') {
        result = await get('/health');
        setTestResult({
          keyId: `connection_${type}`,
          success: result?.status === 'ok',
          message: result?.message || 'Claude API connection successful',
        });
      } else if (type === 'telegram') {
        result = await post('/config/test-telegram', {});
        setTestResult({
          keyId: `connection_${type}`,
          success: result?.success !== false,
          message: result?.message || 'Telegram bot test sent',
        });
      } else if (type === 'late') {
        result = await post('/config/test-late', {});
        setTestResult({
          keyId: `connection_${type}`,
          success: result?.success !== false,
          message: result?.message || 'Late API connection successful',
        });
      }
    } catch (err) {
      setTestResult({
        keyId: `connection_${type}`,
        success: false,
        message: `Test failed: ${err.message}`,
      });
    }
    setTestingKey(null);
  };

  const toggleShow = (keyId) => {
    setShowValue(prev => ({ ...prev, [keyId]: !prev[keyId] }));
  };

  const maskValue = (value) => {
    if (!value) return '—';
    if (value.length <= 8) return '*'.repeat(value.length);
    return value.substring(0, 3) + '*'.repeat(value.length - 6) + value.substring(value.length - 3);
  };

  const startEditing = (key) => {
    setEditingKey(key.id);
    setEditValue(agentKeys[key.id] || '');
    setTestResult(null);
  };

  const cancelEditing = () => {
    setEditingKey(null);
    setEditValue('');
    setTestResult(null);
  };

  // Style constants
  const cardStyle = {
    padding: '20px',
    marginBottom: '20px',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    backdropFilter: 'blur(10px)',
  };

  const sectionHeaderStyle = {
    fontSize: '14px',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: '16px',
    fontWeight: 600,
  };

  const keyRowStyle = {
    padding: '12px 16px',
    marginBottom: '8px',
    background: 'var(--bg-tertiary)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--glass-border)',
  };

  const inputStyle = {
    width: '100%',
    padding: '8px 12px',
    marginBottom: '8px',
    background: 'var(--bg-primary)',
    border: '1px solid var(--glass-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    fontFamily: 'monospace',
    fontSize: '12px',
  };

  return (
    <div className="page">
      <header className="page-header">
        <h2>Agent Settings</h2>
        <p className="page-subtitle">
          Configure API keys, credentials, and Agent parameters
        </p>
      </header>

      {error && (
        <div style={{
          marginBottom: '20px',
          padding: '12px 16px',
          background: 'rgba(248, 113, 113, 0.1)',
          border: '1px solid var(--danger)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--danger)',
          fontSize: '13px',
        }}>
          {error}
        </div>
      )}

      {/* ========== AGENT-SPECIFIC API KEYS ========== */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          {'🔑'} Agent-Specific API Keys
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px' }}>
          These keys are stored in the Agent's .env file and are specific to this Agent instance.
        </p>

        <div style={sectionHeaderStyle}>Integration Services</div>
        {AGENT_API_KEYS.slice(0, 3).map(key => (
          <div key={key.id} style={keyRowStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>{key.name}</strong>
                <span style={{ marginLeft: '12px' }}>
                  <span className={`status-badge ${agentKeys[key.id] ? 'online' : 'not-created'}`} style={{ fontSize: '10px' }}>
                    {agentKeys[key.id] ? 'Configured' : 'Not Set'}
                  </span>
                </span>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 0' }}>{key.desc}</p>
              </div>
              {editingKey !== key.id && (
                <button
                  className="btn btn-secondary"
                  style={{ padding: '4px 12px', fontSize: '11px', whiteSpace: 'nowrap', marginLeft: '12px' }}
                  onClick={() => startEditing(key)}
                >
                  {agentKeys[key.id] ? 'Edit' : 'Add'}
                </button>
              )}
            </div>

            {agentKeys[key.id] && editingKey !== key.id && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                <code style={{ fontSize: '12px', color: 'var(--text-secondary)', background: 'var(--bg-primary)', padding: '4px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>
                  {showValue[key.id] ? agentKeys[key.id] : maskValue(agentKeys[key.id])}
                </code>
                <button
                  onClick={() => toggleShow(key.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px', padding: '2px 6px' }}
                >
                  {showValue[key.id] ? 'Hide' : 'Show'}
                </button>
              </div>
            )}

            {editingKey === key.id && (
              <div style={{ marginTop: '8px' }}>
                <input
                  type="text"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  placeholder={`Enter ${key.name}...`}
                  style={inputStyle}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn btn-primary"
                    style={{ padding: '6px 16px', fontSize: '12px' }}
                    onClick={() => saveAgentKey(key.id)}
                    disabled={savingKey === key.id || !editValue.trim()}
                  >
                    {savingKey === key.id ? 'Saving...' : 'Save'}
                  </button>
                  {editValue.trim() && ['LATE_API_KEY', 'TELEGRAM_BOT_TOKEN'].includes(key.id) && (
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '6px 16px', fontSize: '12px' }}
                      onClick={() => testAgentKey(key.id)}
                      disabled={testingKey === key.id}
                    >
                      {testingKey === key.id ? 'Testing...' : 'Test'}
                    </button>
                  )}
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 16px', fontSize: '12px' }}
                    onClick={cancelEditing}
                  >
                    Cancel
                  </button>
                </div>
                {testResult?.keyId === key.id && (
                  <div style={{
                    marginTop: '8px',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    background: testResult.success ? 'rgba(27, 122, 27, 0.15)' : 'rgba(198, 40, 40, 0.15)',
                    color: testResult.success ? '#4caf50' : '#ef5350',
                  }}>
                    {testResult.success ? '✓ ' : '✕ '}
                    {testResult.message}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        <div style={{ ...sectionHeaderStyle, marginTop: '16px' }}>Ecommerce Platforms (Phase 2)</div>
        {AGENT_API_KEYS.slice(3).map(key => (
          <div key={key.id} style={keyRowStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>{key.name}</strong>
                <span style={{ marginLeft: '12px' }}>
                  <span className={`status-badge ${agentKeys[key.id] ? 'online' : 'not-created'}`} style={{ fontSize: '10px' }}>
                    {agentKeys[key.id] ? 'Configured' : 'Not Set'}
                  </span>
                </span>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 0' }}>{key.desc}</p>
              </div>
              {editingKey !== key.id && (
                <button
                  className="btn btn-secondary"
                  style={{ padding: '4px 12px', fontSize: '11px', whiteSpace: 'nowrap', marginLeft: '12px' }}
                  onClick={() => startEditing(key)}
                >
                  {agentKeys[key.id] ? 'Edit' : 'Add'}
                </button>
              )}
            </div>

            {agentKeys[key.id] && editingKey !== key.id && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                <code style={{ fontSize: '12px', color: 'var(--text-secondary)', background: 'var(--bg-primary)', padding: '4px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>
                  {showValue[key.id] ? agentKeys[key.id] : maskValue(agentKeys[key.id])}
                </code>
                <button
                  onClick={() => toggleShow(key.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px', padding: '2px 6px' }}
                >
                  {showValue[key.id] ? 'Hide' : 'Show'}
                </button>
              </div>
            )}

            {editingKey === key.id && (
              <div style={{ marginTop: '8px' }}>
                <input
                  type="text"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  placeholder={`Enter ${key.name}...`}
                  style={inputStyle}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn btn-primary"
                    style={{ padding: '6px 16px', fontSize: '12px' }}
                    onClick={() => saveAgentKey(key.id)}
                    disabled={savingKey === key.id || !editValue.trim()}
                  >
                    {savingKey === key.id ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 16px', fontSize: '12px' }}
                    onClick={cancelEditing}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ========== SHARED KEYS (READ-ONLY) ========== */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          {'🔐'} Shared Keys (Read-Only)
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px' }}>
          These keys are configured in Studio Settings and shared with the Agent. Click "Edit in Studio" to change them.
        </p>

        {sharedLoading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading shared keys...</p>
        ) : (
          <>
            {SHARED_KEYS.map(key => {
              const value = sharedKeys[key.id];
              const configured = !!value;
              return (
                <div key={key.id} style={keyRowStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>{key.name}</strong>
                      <span style={{ marginLeft: '12px' }}>
                        <span className={`status-badge ${configured ? 'online' : 'not-created'}`} style={{ fontSize: '10px' }}>
                          {configured ? 'Configured' : 'Not Set'}
                        </span>
                      </span>
                      <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 0' }}>{key.desc}</p>
                    </div>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '4px 12px', fontSize: '11px', whiteSpace: 'nowrap', marginLeft: '12px' }}
                      disabled
                    >
                      Edit in Studio
                    </button>
                  </div>

                  {configured && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                      <code style={{ fontSize: '12px', color: 'var(--text-secondary)', background: 'var(--bg-primary)', padding: '4px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>
                        {showValue[key.id] ? value : maskValue(value)}
                      </code>
                      <button
                        onClick={() => toggleShow(key.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px', padding: '2px 6px' }}
                      >
                        {showValue[key.id] ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* ========== PHOTO SOURCE CONFIGURATION ========== */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          {'📷'} Photo Source Configuration
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px' }}>
          Choose where the Agent scans for new photos.
        </p>

        {loadingPhotoSource ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
        ) : (
          <>
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '20px', marginBottom: '12px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="photo-source"
                    value="local"
                    checked={photoSource === 'local'}
                    onChange={e => setPhotoSource(e.target.value)}
                  />
                  <span style={{ color: 'var(--text-primary)', fontSize: '13px' }}>Local Folder</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="photo-source"
                    value="r2"
                    checked={photoSource === 'r2'}
                    onChange={e => setPhotoSource(e.target.value)}
                  />
                  <span style={{ color: 'var(--text-primary)', fontSize: '13px' }}>Cloudflare R2</span>
                </label>
              </div>
            </div>

            {photoSource === 'local' && (
              <div style={{
                padding: '12px 16px',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--glass-border)',
              }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  Path to local folder:
                </p>
                <input
                  type="text"
                  value={photoImportDir}
                  onChange={e => setPhotoImportDir(e.target.value)}
                  placeholder="/path/to/photos"
                  style={inputStyle}
                />
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                  onClick={savePhotoSource}
                  disabled={loading}
                >
                  Save
                </button>
              </div>
            )}

            {photoSource === 'r2' && (
              <div style={{
                padding: '12px 16px',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--glass-border)',
              }}>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Photos will be scanned from: <strong>{sharedKeys['R2_BUCKET_NAME'] || 'not configured'}</strong>
                </p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                  Make sure R2 credentials are configured in Studio Settings.
                </p>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '12px', marginTop: '8px' }}
                  onClick={savePhotoSource}
                  disabled={loading}
                >
                  Save
                </button>
              </div>
            )}

            <div style={{
              marginTop: '12px',
              padding: '12px',
              background: 'rgba(33, 150, 243, 0.08)',
              border: '1px solid rgba(33, 150, 243, 0.2)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              color: 'var(--text-secondary)',
            }}>
              <strong style={{ color: '#2196f3' }}>Current setting:</strong> {photoSource === 'local' ? 'Local Folder' : 'Cloudflare R2'}
              {photoSource === 'local' && photoImportDir && ` — ${photoImportDir}`}
            </div>
          </>
        )}
      </div>

      {/* ========== AGENT CONFIGURATION ========== */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          {'⚙️'} Agent Configuration
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px' }}>
          Core Agent parameters and operational settings.
        </p>

        <div style={keyRowStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>Daily Budget (USD)</strong>
            {editingConfig !== 'daily_budget_usd' && (
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 12px', fontSize: '11px' }}
                onClick={() => setEditingConfig('daily_budget_usd')}
              >
                Edit
              </button>
            )}
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Maximum daily spend on Claude API calls
          </p>

          {editingConfig === 'daily_budget_usd' ? (
            <div style={{ marginTop: '8px' }}>
              <input
                type="number"
                step="0.01"
                min="0"
                value={agentConfig.daily_budget_usd}
                onChange={e => setAgentConfig({ ...agentConfig, daily_budget_usd: parseFloat(e.target.value) || 0 })}
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-primary"
                  style={{ padding: '6px 16px', fontSize: '12px' }}
                  onClick={saveAgentConfig}
                  disabled={savingConfig}
                >
                  {savingConfig ? 'Saving...' : 'Save'}
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 16px', fontSize: '12px' }}
                  onClick={() => setEditingConfig(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: '8px', fontSize: '14px', color: 'var(--accent)', fontWeight: 600 }}>
              ${agentConfig.daily_budget_usd.toFixed(2)}
            </div>
          )}
        </div>

        <div style={keyRowStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>Log Level</strong>
            {editingConfig !== 'log_level' && (
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 12px', fontSize: '11px' }}
                onClick={() => setEditingConfig('log_level')}
              >
                Edit
              </button>
            )}
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Logging verbosity for Agent operations
          </p>

          {editingConfig === 'log_level' ? (
            <div style={{ marginTop: '8px' }}>
              <select
                value={agentConfig.log_level}
                onChange={e => setAgentConfig({ ...agentConfig, log_level: e.target.value })}
                style={{
                  ...inputStyle,
                  marginBottom: '8px',
                }}
              >
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARNING">WARNING</option>
                <option value="ERROR">ERROR</option>
              </select>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-primary"
                  style={{ padding: '6px 16px', fontSize: '12px' }}
                  onClick={saveAgentConfig}
                  disabled={savingConfig}
                >
                  {savingConfig ? 'Saving...' : 'Save'}
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 16px', fontSize: '12px' }}
                  onClick={() => setEditingConfig(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              {agentConfig.log_level}
            </div>
          )}
        </div>

        <div style={keyRowStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>Database Path</strong>
            {editingConfig !== 'db_path' && (
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 12px', fontSize: '11px' }}
                onClick={() => setEditingConfig('db_path')}
              >
                Edit
              </button>
            )}
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Path to Agent SQLite database
          </p>

          {editingConfig === 'db_path' ? (
            <div style={{ marginTop: '8px' }}>
              <input
                type="text"
                value={agentConfig.db_path}
                onChange={e => setAgentConfig({ ...agentConfig, db_path: e.target.value })}
                placeholder="data/archive35.db"
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-primary"
                  style={{ padding: '6px 16px', fontSize: '12px' }}
                  onClick={saveAgentConfig}
                  disabled={savingConfig}
                >
                  {savingConfig ? 'Saving...' : 'Save'}
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 16px', fontSize: '12px' }}
                  onClick={() => setEditingConfig(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
              {agentConfig.db_path}
            </div>
          )}
        </div>

        {pipelineSchedule && (
          <div style={keyRowStyle}>
            <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>{'📅'} Pipeline Schedule</strong>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
              {pipelineSchedule}
            </p>
            <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              Daily at <strong>6 AM</strong> — Posts at <strong>10 AM, 2 PM, 6 PM</strong>
            </div>
          </div>
        )}
      </div>

      {/* ========== TEST CONNECTIONS ========== */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          {'🧪'} Test Connections
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px' }}>
          Verify that critical services are properly configured.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <div style={{ ...keyRowStyle, marginBottom: 0 }}>
            <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>Claude API</strong>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 8px' }}>
              Verify API connectivity and authentication
            </p>
            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '6px 12px', fontSize: '12px' }}
              onClick={() => testConnection('claude')}
              disabled={testingKey === 'connection_claude'}
            >
              {testingKey === 'connection_claude' ? 'Testing...' : 'Test Claude API'}
            </button>
            {testResult?.keyId === 'connection_claude' && (
              <div style={{
                marginTop: '8px',
                padding: '8px 12px',
                borderRadius: '4px',
                fontSize: '12px',
                background: testResult.success ? 'rgba(27, 122, 27, 0.15)' : 'rgba(198, 40, 40, 0.15)',
                color: testResult.success ? '#4caf50' : '#ef5350',
              }}>
                {testResult.success ? '✓ ' : '✕ '}
                {testResult.message}
              </div>
            )}
          </div>

          <div style={{ ...keyRowStyle, marginBottom: 0 }}>
            <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>Telegram Bot</strong>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 8px' }}>
              Send test message to Wolf's chat
            </p>
            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '6px 12px', fontSize: '12px' }}
              onClick={() => testConnection('telegram')}
              disabled={testingKey === 'connection_telegram'}
            >
              {testingKey === 'connection_telegram' ? 'Testing...' : 'Test Telegram'}
            </button>
            {testResult?.keyId === 'connection_telegram' && (
              <div style={{
                marginTop: '8px',
                padding: '8px 12px',
                borderRadius: '4px',
                fontSize: '12px',
                background: testResult.success ? 'rgba(27, 122, 27, 0.15)' : 'rgba(198, 40, 40, 0.15)',
                color: testResult.success ? '#4caf50' : '#ef5350',
              }}>
                {testResult.success ? '✓ ' : '✕ '}
                {testResult.message}
              </div>
            )}
          </div>

          <div style={{ ...keyRowStyle, marginBottom: 0 }}>
            <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>Late API</strong>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 8px' }}>
              Verify social media integration
            </p>
            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '6px 12px', fontSize: '12px' }}
              onClick={() => testConnection('late')}
              disabled={testingKey === 'connection_late'}
            >
              {testingKey === 'connection_late' ? 'Testing...' : 'Test Late API'}
            </button>
            {testResult?.keyId === 'connection_late' && (
              <div style={{
                marginTop: '8px',
                padding: '8px 12px',
                borderRadius: '4px',
                fontSize: '12px',
                background: testResult.success ? 'rgba(27, 122, 27, 0.15)' : 'rgba(198, 40, 40, 0.15)',
                color: testResult.success ? '#4caf50' : '#ef5350',
              }}>
                {testResult.success ? '✓ ' : '✕ '}
                {testResult.message}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AgentSettings;
