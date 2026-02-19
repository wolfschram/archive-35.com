import React, { useRef, useEffect } from 'react';

/**
 * LogViewer — Scrolling audit log display.
 * Auto-scrolls to bottom, monospace font, color-coded by success/fail.
 */
function LogViewer({ logs, maxHeight = 400 }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div style={{
      maxHeight: `${maxHeight}px`,
      overflowY: 'auto',
      background: 'var(--bg-primary)',
      border: '1px solid var(--glass-border)',
      borderRadius: 'var(--radius-sm)',
      padding: '12px',
      fontFamily: 'monospace',
      fontSize: '12px',
      lineHeight: '1.6',
    }}>
      {(!logs || logs.length === 0) && (
        <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
          No log entries yet
        </div>
      )}
      {logs && logs.map((entry, i) => {
        const ts = entry.timestamp
          ? new Date(entry.timestamp).toLocaleTimeString()
          : '';
        const success = entry.success === 1 || entry.success === true;

        return (
          <div key={entry.id || i} style={{
            padding: '4px 0',
            borderBottom: '1px solid rgba(255,255,255,0.03)',
            display: 'flex',
            gap: '8px',
          }}>
            <span style={{ color: 'var(--text-muted)', minWidth: '70px' }}>
              {ts}
            </span>
            <span style={{
              color: success ? 'var(--success)' : 'var(--danger)',
              minWidth: '12px',
            }}>
              {success ? '\u2713' : '\u2717'}
            </span>
            <span style={{ color: 'var(--accent)', minWidth: '80px' }}>
              {entry.component}
            </span>
            <span style={{ color: 'var(--text-primary)' }}>
              {entry.action}
            </span>
            {entry.cost_usd > 0 && (
              <span style={{ color: 'var(--warning)', marginLeft: 'auto' }}>
                ${entry.cost_usd.toFixed(4)}
              </span>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

export default LogViewer;
