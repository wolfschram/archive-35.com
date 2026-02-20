import React, { useState, useEffect } from 'react';
import useAgentApi from '../hooks/useAgentApi';
import LogViewer from '../components/LogViewer';

/**
 * AgentPipelineMonitor — Live audit logs, manual pipeline trigger, last run status.
 */
function AgentPipelineMonitor() {
  const { get, post, loading, error } = useAgentApi();
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logFilter, setLogFilter] = useState('');
  const [runResult, setRunResult] = useState(null);
  const [running, setRunning] = useState(false);

  const loadStatus = async () => {
    try {
      const data = await get('/pipeline/status');
      setPipelineStatus(data);
    } catch { /* error shown via hook */ }
  };

  const loadLogs = async () => {
    try {
      const params = logFilter ? `?component=${logFilter}&limit=200` : '?limit=200';
      const data = await get(`/pipeline/logs${params}`);
      setLogs(data.items || []);
    } catch { /* error shown via hook */ }
  };

  useEffect(() => { loadStatus(); loadLogs(); }, []);
  useEffect(() => { loadLogs(); }, [logFilter]);

  const handleRunPipeline = async (dryRun) => {
    setRunning(true);
    setRunResult(null);
    try {
      const result = await post(`/pipeline/run?dry_run=${dryRun}`);
      setRunResult(result);
      await loadStatus();
      await loadLogs();
    } catch (err) {
      setRunResult({ status: 'failed', errors: [err.message || String(err) || 'Unknown error'] });
    } finally {
      setRunning(false);
    }
  };

  const lastRun = pipelineStatus?.last_run;
  const statusColor = {
    'completed': 'var(--success)',
    'completed_with_errors': 'var(--warning)',
    'failed': 'var(--danger)',
    'blocked': 'var(--danger)',
  };

  return (
    <div className="page">
      <header className="page-header">
        <h2>Pipeline Monitor</h2>
        <p className="page-subtitle">
          Daily pipeline execution and audit trail
        </p>
      </header>

      <div className="card-grid">
        {/* Last Run Status */}
        <div className="glass-card">
          <h3>{'🔄'} Last Pipeline Run</h3>
          {lastRun ? (
            <div>
              <div style={{
                fontSize: '18px', fontWeight: 600,
                color: statusColor[lastRun.action?.replace('daily_', '')] || 'var(--text-primary)',
                marginBottom: '8px', textTransform: 'capitalize',
              }}>
                {lastRun.action?.replace('daily_', '') || 'Unknown'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {new Date(lastRun.timestamp).toLocaleString()}
              </div>
              {lastRun.details && (
                <div style={{
                  marginTop: '12px', padding: '8px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px', fontFamily: 'monospace',
                  color: 'var(--text-secondary)',
                }}>
                  {(() => {
                    try {
                      if (typeof lastRun.details === 'string') {
                        return JSON.stringify(JSON.parse(lastRun.details), null, 2);
                      }
                      return JSON.stringify(lastRun.details, null, 2);
                    } catch {
                      return String(lastRun.details || '');
                    }
                  })()}
                </div>
              )}
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>No pipeline runs recorded</p>
          )}
        </div>

        {/* Run Controls */}
        <div className="glass-card">
          <h3>{'▶️'} Run Pipeline</h3>
          <p>Manually trigger the daily pipeline. Dry run simulates without posting.</p>
          <div className="button-group">
            <button
              className="btn btn-primary"
              onClick={() => handleRunPipeline(true)}
              disabled={running || loading}
            >
              {running ? 'Running...' : 'Dry Run'}
            </button>
            <button
              className="btn btn-warning"
              style={{
                background: 'rgba(251, 191, 36, 0.15)',
                color: 'var(--warning)',
                border: '1px solid var(--warning)',
              }}
              onClick={() => handleRunPipeline(false)}
              disabled={running || loading}
            >
              Live Run
            </button>
          </div>

          {/* Run Result */}
          {runResult && (
            <div style={{
              marginTop: '16px', padding: '12px',
              background: runResult.status === 'started'
                ? 'rgba(251, 191, 36, 0.08)'
                : runResult.status === 'completed'
                  ? 'rgba(74, 222, 128, 0.08)'
                  : 'rgba(248, 113, 113, 0.08)',
              border: `1px solid ${
                runResult.status === 'started' ? 'var(--warning)'
                : runResult.status === 'completed' ? 'var(--success)' : 'var(--danger)'}`,
              borderRadius: 'var(--radius-sm)',
              fontSize: '13px',
            }}>
              <div style={{
                fontWeight: 600,
                color: runResult.status === 'started' ? 'var(--warning)'
                  : runResult.status === 'completed' ? 'var(--success)' : 'var(--danger)',
                marginBottom: '8px',
              }}>
                Pipeline: {runResult.status}
              </div>
              {runResult.message && (
                <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '8px' }}>
                  {runResult.message}
                </div>
              )}
              {runResult.steps && typeof runResult.steps === 'object' &&
                Object.entries(runResult.steps).map(([step, data]) => (
                <div key={step} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '4px 0', fontSize: '12px',
                }}>
                  <span style={{ color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                    {step}
                  </span>
                  <span style={{
                    color: data?.status === 'ok' ? 'var(--success)' : 'var(--danger)',
                  }}>
                    {data?.status === 'ok' ? '\u2713' : '\u2717'} {data?.status || 'unknown'}
                  </span>
                </div>
              ))}
              {runResult.errors?.length > 0 && (
                <div style={{ marginTop: '8px', color: 'var(--danger)', fontSize: '12px' }}>
                  {runResult.errors.map((e, i) => (
                    <div key={i}>{'·'} {e}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        {pipelineStatus?.recent_activity?.length > 0 && (
          <div className="glass-card full-width">
            <h3>{'📋'} Recent Pipeline Activity</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {pipelineStatus.recent_activity.slice(0, 10).map((entry, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)',
                  fontSize: '13px',
                }}>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                  <span style={{ color: 'var(--accent)' }}>
                    {entry.action}
                  </span>
                  <span style={{
                    color: entry.success ? 'var(--success)' : 'var(--danger)',
                  }}>
                    {entry.success ? '\u2713' : '\u2717'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Audit Log */}
        <div className="glass-card full-width">
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', marginBottom: '16px',
          }}>
            <h3 style={{ margin: 0 }}>{'📜'} Audit Log</h3>
            <div style={{ display: 'flex', gap: '6px' }}>
              {['', 'pipeline', 'vision', 'content', 'social', 'studio'].map(f => (
                <button
                  key={f || 'all'}
                  className={`btn ${logFilter === f ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '4px 10px', fontSize: '10px' }}
                  onClick={() => setLogFilter(f)}
                >
                  {f || 'All'}
                </button>
              ))}
            </div>
          </div>
          <LogViewer logs={logs} maxHeight={500} />
        </div>
      </div>

      {error && (
        <div style={{
          marginTop: '16px', padding: '12px',
          background: 'rgba(248, 113, 113, 0.1)',
          border: '1px solid var(--danger)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--danger)', fontSize: '13px',
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default AgentPipelineMonitor;
