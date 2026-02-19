import React, { useState } from 'react';

/**
 * PinterestPreview — 2:3 pin format preview with title overlay, description, and board badge.
 * Production quality with character validation and approval workflow.
 */
function PinterestPreview({ content, thumbnailUrl, onApprove, onReject, onDefer }) {
  if (!content || content.platform !== 'pinterest') return null;

  const [showFullDesc, setShowFullDesc] = useState(false);

  // Extract board name from content or tags
  const boardName = content.board_name || 'My Board';
  const titleLength = (content.title || '').length;
  const descLength = (content.body || '').length;
  const maxTitle = 100;
  const maxDesc = 500;

  const titleOverLimit = titleLength > maxTitle;
  const descOverLimit = descLength > maxDesc;

  const truncateDesc = (text, limit) => {
    if (text.length <= limit) return text;
    return text.slice(0, limit) + '...';
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      padding: '20px',
      background: 'linear-gradient(135deg, rgba(230, 0, 35, 0.08) 0%, rgba(0, 0, 0, 0.2) 100%)',
      border: '1px solid rgba(230, 0, 35, 0.2)',
      borderRadius: 'var(--radius-md)',
      backdropFilter: 'blur(10px)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '14px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          🅿️ Pinterest Pin Preview
        </h3>
        <span style={{
          padding: '4px 10px',
          fontSize: '10px',
          fontWeight: 600,
          background: 'rgba(230, 0, 35, 0.15)',
          color: '#e60023',
          borderRadius: '20px',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          {boardName}
        </span>
      </div>

      {/* Main pin preview (2:3 aspect ratio @ 280x420px) */}
      <div style={{
        position: 'relative',
        width: '280px',
        height: '420px',
        borderRadius: '12px',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, rgba(240, 240, 240, 0.1) 0%, rgba(200, 200, 200, 0.05) 100%)',
        border: '1px solid rgba(230, 0, 35, 0.3)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
      }}>
        {/* Photo area */}
        <div style={{
          width: '100%',
          height: '340px',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '60px',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt="Pin preview"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          ) : (
            <span>📷</span>
          )}
        </div>

        {/* Title overlay at bottom */}
        <div style={{
          width: '100%',
          height: '80px',
          background: 'rgba(0, 0, 0, 0.7)',
          padding: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '13px',
          fontWeight: 600,
          color: '#ffffff',
          lineHeight: 1.3,
          textAlign: 'center',
          wordBreak: 'break-word',
          backdropFilter: 'blur(4px)',
        }}>
          {content.title || '(No title)'}
        </div>
      </div>

      {/* Title validation */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        background: 'var(--bg-primary)',
        border: `1px solid ${titleOverLimit ? '#f87171' : '#86efac'}`,
        borderRadius: 'var(--radius-sm)',
        fontSize: '11px',
      }}>
        <span style={{ color: 'var(--text-secondary)' }}>Title Length</span>
        <span style={{
          color: titleOverLimit ? '#ef4444' : '#22c55e',
          fontWeight: 600,
        }}>
          {titleLength} / {maxTitle}
        </span>
      </div>

      {/* Description */}
      <div style={{
        padding: '12px',
        background: 'var(--bg-primary)',
        border: '1px solid var(--glass-border)',
        borderRadius: 'var(--radius-sm)',
        fontSize: '12px',
        color: 'var(--text-secondary)',
        lineHeight: 1.5,
        maxHeight: showFullDesc ? '200px' : '60px',
        overflowY: 'auto',
        transition: 'max-height 0.3s ease',
      }}>
        {content.body || '(No description)'}
      </div>

      {/* Description length and toggle */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        background: 'var(--bg-primary)',
        border: `1px solid ${descOverLimit ? '#f87171' : '#86efac'}`,
        borderRadius: 'var(--radius-sm)',
        fontSize: '11px',
      }}>
        <button
          onClick={() => setShowFullDesc(!showFullDesc)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 500,
            padding: 0,
          }}
        >
          {showFullDesc ? '▼ Collapse' : '▶ Expand'}
        </button>
        <span style={{
          color: descOverLimit ? '#ef4444' : '#22c55e',
          fontWeight: 600,
        }}>
          {descLength} / {maxDesc}
        </span>
      </div>

      {/* Content ID */}
      <div style={{
        fontSize: '10px',
        color: 'var(--text-muted)',
        fontFamily: 'monospace',
        padding: '4px 8px',
        background: 'rgba(0, 0, 0, 0.2)',
        borderRadius: '4px',
      }}>
        ID: {content.id}
      </div>

      {/* Action buttons */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginTop: '8px',
      }}>
        <button
          onClick={() => onApprove(content.id)}
          style={{
            flex: 1,
            padding: '10px 16px',
            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            color: '#ffffff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.target.style.transform = 'translateY(-1px)';
            e.target.style.boxShadow = '0 4px 12px rgba(34, 197, 94, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.target.style.transform = 'translateY(0)';
            e.target.style.boxShadow = 'none';
          }}
        >
          ✓ Approve
        </button>
        <button
          onClick={() => onDefer(content.id)}
          style={{
            flex: 1,
            padding: '10px 16px',
            background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
            color: '#ffffff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.target.style.transform = 'translateY(-1px)';
            e.target.style.boxShadow = '0 4px 12px rgba(245, 158, 11, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.target.style.transform = 'translateY(0)';
            e.target.style.boxShadow = 'none';
          }}
        >
          ⏱ Defer
        </button>
        <button
          onClick={() => onReject(content.id)}
          style={{
            flex: 1,
            padding: '10px 16px',
            background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
            color: '#ffffff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.target.style.transform = 'translateY(-1px)';
            e.target.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.target.style.transform = 'translateY(0)';
            e.target.style.boxShadow = 'none';
          }}
        >
          ✕ Reject
        </button>
      </div>

      {/* Warnings */}
      {(titleOverLimit || descOverLimit) && (
        <div style={{
          padding: '10px 12px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '11px',
          color: '#ef4444',
          lineHeight: 1.4,
        }}>
          {titleOverLimit && <div>⚠️ Title exceeds {maxTitle} character limit</div>}
          {descOverLimit && <div>⚠️ Description exceeds {maxDesc} character limit</div>}
        </div>
      )}
    </div>
  );
}

export default PinterestPreview;
