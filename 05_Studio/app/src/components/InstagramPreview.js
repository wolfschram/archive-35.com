import React, { useState } from 'react';

/**
 * InstagramPreview — 1:1 square feed post preview with caption, hashtags, and character validation.
 * Instagram-styled mockup with platform-specific features.
 */
function InstagramPreview({ content, thumbnailUrl, onApprove, onReject, onDefer }) {
  if (!content || content.platform !== 'instagram') return null;

  const [showFullCaption, setShowFullCaption] = useState(false);

  // Parse hashtags from tags array
  const tags = (() => {
    try {
      if (Array.isArray(content.tags)) return content.tags;
      if (typeof content.tags === 'string') return JSON.parse(content.tags);
      return [];
    } catch {
      return [];
    }
  })();

  const hashtagCount = tags.length;
  const maxHashtags = 30;
  const hashtagsOverLimit = hashtagCount > maxHashtags;

  const caption = content.body || '';
  const captionLines = caption.split('\n');
  const truncatedCaption = captionLines.slice(0, 3).join('\n');
  const captionTruncated = captionLines.length > 3;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      padding: '20px',
      maxWidth: '460px',
      background: 'linear-gradient(135deg, rgba(225, 48, 108, 0.08) 0%, rgba(0, 0, 0, 0.2) 100%)',
      border: '1px solid rgba(225, 48, 108, 0.2)',
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
          📸 Instagram Post Preview
        </h3>
        <div style={{
          display: 'flex',
          gap: '6px',
          alignItems: 'center',
        }}>
          <span style={{
            fontSize: '10px',
            color: 'var(--text-muted)',
          }}>
            Feed
          </span>
        </div>
      </div>

      {/* Instagram-style post frame */}
      <div style={{
        width: '100%',
        maxWidth: '400px',
        background: '#000',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(225, 48, 108, 0.2)',
      }}>
        {/* Instagram header bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: '#000',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
            }}>
              📷
            </div>
            <div>
              <div style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#ffffff',
              }}>
                Archive Studio
              </div>
              <div style={{
                fontSize: '10px',
                color: 'rgba(255, 255, 255, 0.5)',
              }}>
                Just now
              </div>
            </div>
          </div>
          <span style={{
            fontSize: '18px',
            color: 'rgba(255, 255, 255, 0.5)',
            cursor: 'pointer',
          }}>
            ⋯
          </span>
        </div>

        {/* Image area (1:1 square @ 400x400px) */}
        <div style={{
          width: '100%',
          paddingBottom: '100%',
          position: 'relative',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          overflow: 'hidden',
        }}>
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt="Instagram post"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          ) : (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '60px',
            }}>
              📷
            </div>
          )}
        </div>

        {/* Instagram action bar */}
        <div style={{
          padding: '12px 16px',
          background: '#000',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          gap: '16px',
          fontSize: '20px',
        }}>
          <span style={{ cursor: 'pointer' }}>♡</span>
          <span style={{ cursor: 'pointer' }}>💬</span>
          <span style={{ cursor: 'pointer' }}>➜</span>
          <span style={{ cursor: 'pointer', marginLeft: 'auto' }}>🔖</span>
        </div>

        {/* Caption section */}
        <div style={{
          padding: '12px 16px',
          background: '#000',
        }}>
          <div style={{
            fontSize: '12px',
            color: '#ffffff',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            marginBottom: '8px',
          }}>
            <span style={{ fontWeight: 600 }}>Archive Studio</span>
            <span style={{ marginLeft: '8px' }}>
              {showFullCaption ? caption : truncatedCaption}
              {captionTruncated && !showFullCaption && '...'}
            </span>
          </div>
          {captionTruncated && (
            <button
              onClick={() => setShowFullCaption(!showFullCaption)}
              style={{
                background: 'none',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.5)',
                cursor: 'pointer',
                fontSize: '11px',
                padding: 0,
                marginBottom: '8px',
              }}
            >
              {showFullCaption ? 'Hide caption' : 'View all comments'}
            </button>
          )}
        </div>
      </div>

      {/* Hashtag validation badge */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 12px',
        background: 'var(--bg-primary)',
        border: `1px solid ${hashtagsOverLimit ? '#f87171' : '#86efac'}`,
        borderRadius: 'var(--radius-sm)',
        fontSize: '11px',
      }}>
        <span style={{ color: 'var(--text-secondary)' }}>Hashtags</span>
        <span style={{
          color: hashtagsOverLimit ? '#ef4444' : '#22c55e',
          fontWeight: 600,
        }}>
          {hashtagCount} / {maxHashtags}
        </span>
      </div>

      {/* Hashtags display (scrollable) */}
      {hashtagCount > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          padding: '12px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--glass-border)',
          borderRadius: 'var(--radius-sm)',
          maxHeight: '120px',
          overflowY: 'auto',
        }}>
          {tags.map((tag, i) => (
            <span
              key={i}
              style={{
                fontSize: '11px',
                padding: '4px 10px',
                background: 'rgba(225, 48, 108, 0.15)',
                color: '#e1306c',
                borderRadius: '6px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              #{tag.replace(/^#/, '')}
            </span>
          ))}
        </div>
      )}

      {/* No hashtags warning */}
      {hashtagCount === 0 && (
        <div style={{
          padding: '10px 12px',
          background: 'rgba(249, 115, 22, 0.1)',
          border: '1px solid rgba(249, 115, 22, 0.3)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '11px',
          color: '#f97316',
        }}>
          ℹ️ No hashtags found. Add tags to improve discoverability.
        </div>
      )}

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
      {hashtagsOverLimit && (
        <div style={{
          padding: '10px 12px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '11px',
          color: '#ef4444',
          lineHeight: 1.4,
        }}>
          ⚠️ Hashtag count exceeds {maxHashtags} limit (Instagram may suppress reach)
        </div>
      )}
    </div>
  );
}

export default InstagramPreview;
