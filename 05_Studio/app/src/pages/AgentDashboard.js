import React, { useState, useEffect } from 'react';
import useAgentApi from '../hooks/useAgentApi';
import KillSwitchToggle from '../components/KillSwitchToggle';
import CostTracker from '../components/CostTracker';

/**
 * AgentDashboard — Pipeline status, cost tracker, kill switches.
 * First page Wolf sees in the Agent section.
 */
function AgentDashboard() {
  const { get, post, loading, error } = useAgentApi();
  const [stats, setStats] = useState(null);
  const [agentOnline, setAgentOnline] = useState(false);

  const loadStats = async () => {
    try {
      const data = await get('/stats');
      setStats(data);
      setAgentOnline(true);
    } catch {
      setAgentOnline(false);
    }
  };

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 15000); // Refresh every 15s
    return () => clearInterval(interval);
  }, []);

  const handleKillToggle = async (scope, activate) => {
    try {
      if (activate) {
        await post(`/safety/kill/${scope}`, { reason: 'Stopped from Studio' });
      } else {
        await post(`/safety/resume/${scope}`);
      }
      await loadStats();
    } catch (err) {
      console.error('Kill switch toggle failed:', err);
    }
  };

  const scopes = ['global', 'pinterest', 'instagram', 'etsy'];
  const killMap = {};
  if (stats?.kill_switches) {
    stats.kill_switches.forEach(ks => { killMap[ks.scope] = ks; });
  }

  return (
    <div className="page">
      <header className="page-header">
        <h2>Agent Dashboard</h2>
        <p className="page-subtitle">
          AI content pipeline status and controls
        </p>
      </header>

      {/* Connection status */}
      <div style={{ marginBottom: '24px' }}>
        <span className={`status-badge ${agentOnline ? 'online' : 'not-created'}`}>
          {agentOnline ? 'AGENT ONLINE' : 'AGENT OFFLINE'}
        </span>
        {!agentOnline && (
          <span style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            marginLeft: '12px',
          }}>
            Start the Agent API: cd "Archive 35 Agent" {'&&'} uv run python -m src.api
          </span>
        )}
      </div>

      <div className="card-grid">
        {/* Photo Stats */}
        <div className="glass-card">
          <h3>{'📷'} Photos</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '36px', fontWeight: 600, color: 'var(--accent)' }}>
                {stats?.photos?.total ?? '—'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total imported</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '36px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {stats?.photos?.analyzed ?? '—'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Analyzed</div>
            </div>
          </div>
        </div>

        {/* Content Stats */}
        <div className="glass-card">
          <h3>{'📝'} Content Queue</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {[
              { label: 'Pending', value: stats?.content?.pending, color: 'var(--warning)' },
              { label: 'Approved', value: stats?.content?.approved, color: 'var(--success)' },
              { label: 'Posted', value: stats?.content?.posted, color: 'var(--accent)' },
              { label: 'Total', value: stats?.content?.total, color: 'var(--text-primary)' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div style={{ fontSize: '24px', fontWeight: 600, color }}>{value ?? '—'}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Cost Tracker */}
        <div className="glass-card">
          <h3>{'💰'} API Costs</h3>
          {stats ? (
            <CostTracker
              todayUsd={stats.costs.today_usd}
              totalUsd={stats.costs.total_usd}
              dailyBudget={5.00}
            />
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
          )}
        </div>

        {/* Kill Switches */}
        <div className="glass-card">
          <h3>{'🛑'} Kill Switches</h3>
          {scopes.map(scope => (
            <KillSwitchToggle
              key={scope}
              scope={scope}
              active={killMap[scope]?.active === 1}
              reason={killMap[scope]?.reason}
              onToggle={handleKillToggle}
              disabled={loading || !agentOnline}
            />
          ))}
        </div>

        {/* Quick Actions */}
        <div className="glass-card full-width">
          <h3>{'⚡'} Quick Actions</h3>
          <div className="button-group">
            <button
              className="btn btn-primary"
              disabled={loading || !agentOnline}
              onClick={async () => {
                try {
                  await post('/pipeline/run?dry_run=true');
                  await loadStats();
                } catch (err) {
                  console.error('Pipeline run failed:', err);
                }
              }}
            >
              Run Pipeline (Dry Run)
            </button>
            <button
              className="btn btn-secondary"
              disabled={loading || !agentOnline}
              onClick={async () => {
                try {
                  await post('/photos/import');
                  await loadStats();
                } catch (err) {
                  console.error('Import failed:', err);
                }
              }}
            >
              Import New Photos
            </button>
            <button
              className="btn btn-secondary"
              onClick={loadStats}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          marginTop: '16px',
          padding: '12px',
          background: 'rgba(248, 113, 113, 0.1)',
          border: '1px solid var(--danger)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--danger)',
          fontSize: '13px',
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default AgentDashboard;
