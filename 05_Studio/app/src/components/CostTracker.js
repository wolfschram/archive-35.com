import React from 'react';

/**
 * CostTracker — API spend widget showing today's and total costs.
 * Uses accent gold for the stat numbers (matches Analytics page pattern).
 */
function CostTracker({ todayUsd, totalUsd, dailyBudget }) {
  const budgetPercent = dailyBudget > 0
    ? Math.min(100, (todayUsd / dailyBudget) * 100)
    : 0;

  const barColor = budgetPercent > 80
    ? 'var(--danger)'
    : budgetPercent > 50
      ? 'var(--warning)'
      : 'var(--success)';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <div style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: '4px',
          }}>
            Today
          </div>
          <div style={{
            fontSize: '32px',
            fontWeight: 600,
            color: 'var(--accent)',
          }}>
            ${todayUsd.toFixed(2)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: '4px',
          }}>
            All Time
          </div>
          <div style={{
            fontSize: '32px',
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}>
            ${totalUsd.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Budget bar */}
      {dailyBudget > 0 && (
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: 'var(--text-muted)',
            marginBottom: '6px',
          }}>
            <span>Daily budget</span>
            <span>${dailyBudget.toFixed(2)}</span>
          </div>
          <div style={{
            height: '6px',
            background: 'var(--bg-tertiary)',
            borderRadius: '3px',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${budgetPercent}%`,
              height: '100%',
              background: barColor,
              borderRadius: '3px',
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

export default CostTracker;
