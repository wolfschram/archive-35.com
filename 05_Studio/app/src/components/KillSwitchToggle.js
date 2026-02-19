import React, { useState } from 'react';

/**
 * KillSwitchToggle — Emergency stop toggle for global or per-platform scope.
 * Matches Studio glass-card styling with danger/success states.
 */
function KillSwitchToggle({ scope, active, reason, onToggle, disabled }) {
  const [confirming, setConfirming] = useState(false);

  const handleClick = () => {
    if (active) {
      // Resuming — no confirmation needed
      onToggle(scope, false);
    } else {
      // Killing — confirm first
      setConfirming(true);
    }
  };

  const handleConfirm = () => {
    onToggle(scope, true);
    setConfirming(false);
  };

  return (
    <div className="kill-switch-item" style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      background: active
        ? 'rgba(248, 113, 113, 0.08)'
        : 'var(--bg-tertiary)',
      border: `1px solid ${active ? 'var(--danger)' : 'var(--glass-border)'}`,
      borderRadius: 'var(--radius-sm)',
      marginBottom: '8px',
      transition: 'all 0.2s ease',
    }}>
      <div>
        <span style={{
          fontSize: '14px',
          fontWeight: 500,
          color: 'var(--text-primary)',
          textTransform: 'capitalize',
        }}>
          {scope === 'global' ? 'Global Kill Switch' : scope}
        </span>
        {active && reason && (
          <span style={{
            display: 'block',
            fontSize: '12px',
            color: 'var(--text-muted)',
            marginTop: '4px',
          }}>
            {reason}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {confirming ? (
          <>
            <button
              className="btn btn-danger"
              style={{ padding: '6px 14px', fontSize: '12px' }}
              onClick={handleConfirm}
              disabled={disabled}
            >
              Confirm Kill
            </button>
            <button
              className="btn btn-secondary"
              style={{ padding: '6px 14px', fontSize: '12px' }}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className={`status-badge ${active ? 'not-created' : 'online'}`}>
              {active ? 'STOPPED' : 'RUNNING'}
            </span>
            <button
              className={`btn ${active ? 'btn-primary' : 'btn-danger'}`}
              style={{ padding: '6px 14px', fontSize: '12px' }}
              onClick={handleClick}
              disabled={disabled}
            >
              {active ? 'Resume' : 'Kill'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default KillSwitchToggle;
