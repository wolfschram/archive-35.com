import React, { useState } from 'react';

/**
 * EtsyPreview — E-commerce listing preview with product title, price range, tags, description, and SKU table.
 * Etsy-styled mockup with validation for tag count (must be exactly 13) and pricing structure.
 */
function EtsyPreview({ content, thumbnailUrl, onApprove, onReject, onDefer }) {
  if (!content || content.platform !== 'etsy') return null;

  const [showFullDesc, setShowFullDesc] = useState(false);
  const [expandedSKUs, setExpandedSKUs] = useState(false);

  // Parse tags
  const tags = (() => {
    try {
      if (Array.isArray(content.tags)) return content.tags;
      if (typeof content.tags === 'string') return JSON.parse(content.tags);
      return [];
    } catch {
      return [];
    }
  })();

  const tagCount = tags.length;
  const maxTags = 13;
  const tagsWrong = tagCount !== maxTags;

  // Parse SKUs
  const skus = content.skus || [];
  const priceMin = skus.length > 0
    ? Math.min(...skus.map(s => parseFloat(s.min_price) || 0))
    : 0;
  const priceMax = skus.length > 0
    ? Math.max(...skus.map(s => parseFloat(s.retail) || 0))
    : 0;

  const titleLength = (content.title || '').length;
  const maxTitle = 140;
  const titleOverLimit = titleLength > maxTitle;

  const description = content.body || '';
  const descPreview = description.slice(0, 200);
  const descTruncated = description.length > 200;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      padding: '20px',
      background: 'linear-gradient(135deg, rgba(241, 100, 30, 0.08) 0%, rgba(0, 0, 0, 0.2) 100%)',
      border: '1px solid rgba(241, 100, 30, 0.2)',
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
          🛍️ Etsy Listing Preview
        </h3>
        <div style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
        }}>
          {priceMin > 0 && (
            <span style={{
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 600,
              background: 'rgba(241, 100, 30, 0.15)',
              color: '#f1641e',
              borderRadius: '20px',
            }}>
              ${priceMin.toFixed(2)} - ${priceMax.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {/* Etsy-style listing preview */}
      <div style={{
        background: '#fafbfc',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        overflow: 'hidden',
      }}>
        {/* Product image (1:1 square @ 400x400px) */}
        <div style={{
          width: '100%',
          paddingBottom: '100%',
          position: 'relative',
          background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 100%)',
          overflow: 'hidden',
        }}>
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt="Product"
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

        {/* Product info section */}
        <div style={{
          padding: '16px',
        }}>
          {/* Title */}
          <div style={{
            fontSize: '14px',
            fontWeight: 600,
            color: '#222222',
            marginBottom: '8px',
            lineHeight: 1.4,
          }}>
            {content.title || '(No title)'}
          </div>

          {/* Price and rating */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '8px',
          }}>
            <span style={{
              fontSize: '16px',
              fontWeight: 700,
              color: '#f1641e',
            }}>
              ${priceMin.toFixed(2)}
            </span>
            <span style={{
              fontSize: '12px',
              color: '#888',
            }}>
              {skus.length > 0 ? `+${skus.length} SKU options` : 'No pricing'}
            </span>
          </div>

          {/* Description preview */}
          <div style={{
            fontSize: '12px',
            color: '#555',
            lineHeight: 1.4,
            marginBottom: '8px',
          }}>
            {descPreview}
            {descTruncated && '...'}
          </div>
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

      {/* Full description toggle */}
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
        {description || '(No description)'}
      </div>

      {/* Description expand */}
      {descTruncated && (
        <button
          onClick={() => setShowFullDesc(!showFullDesc)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 500,
            padding: '4px 0',
          }}
        >
          {showFullDesc ? '▼ Collapse' : '▶ Expand Full Description'}
        </button>
      )}

      {/* Tags validation */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 12px',
        background: 'var(--bg-primary)',
        border: `1px solid ${tagsWrong ? '#f87171' : '#86efac'}`,
        borderRadius: 'var(--radius-sm)',
        fontSize: '11px',
      }}>
        <span style={{ color: 'var(--text-secondary)' }}>Tags (Must be exactly 13)</span>
        <span style={{
          color: tagsWrong ? '#ef4444' : '#22c55e',
          fontWeight: 600,
        }}>
          {tagCount} / {maxTags}
        </span>
      </div>

      {/* Tags display */}
      {tagCount > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          padding: '12px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--glass-border)',
          borderRadius: 'var(--radius-sm)',
        }}>
          {tags.map((tag, i) => (
            <span
              key={i}
              style={{
                fontSize: '11px',
                padding: '4px 10px',
                background: 'rgba(241, 100, 30, 0.15)',
                color: '#f1641e',
                borderRadius: '6px',
                fontWeight: 500,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* SKU table (collapsible) */}
      {skus.length > 0 && (
        <div>
          <button
            onClick={() => setExpandedSKUs(!expandedSKUs)}
            style={{
              width: '100%',
              padding: '12px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
            onMouseEnter={(e) => { e.target.style.background = 'var(--bg-secondary)'; }}
            onMouseLeave={(e) => { e.target.style.background = 'var(--bg-primary)'; }}
          >
            <span>Pricing by SKU ({skus.length} options)</span>
            <span style={{
              transform: expandedSKUs ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s',
            }}>
              ▼
            </span>
          </button>

          {expandedSKUs && (
            <div style={{
              marginTop: '8px',
              overflowX: 'auto',
              background: 'var(--bg-primary)',
              border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '10px',
            }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
              }}>
                <thead>
                  <tr style={{
                    background: 'rgba(0, 0, 0, 0.2)',
                    borderBottom: '1px solid var(--glass-border)',
                  }}>
                    <th style={{
                      padding: '8px',
                      textAlign: 'left',
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                    }}>SKU</th>
                    <th style={{
                      padding: '8px',
                      textAlign: 'left',
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                    }}>Size</th>
                    <th style={{
                      padding: '8px',
                      textAlign: 'left',
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                    }}>Paper</th>
                    <th style={{
                      padding: '8px',
                      textAlign: 'right',
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                    }}>COGS</th>
                    <th style={{
                      padding: '8px',
                      textAlign: 'right',
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                    }}>Min Price</th>
                    <th style={{
                      padding: '8px',
                      textAlign: 'right',
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                    }}>Retail</th>
                  </tr>
                </thead>
                <tbody>
                  {skus.map((sku, i) => (
                    <tr
                      key={i}
                      style={{
                        borderBottom: i < skus.length - 1 ? '1px solid var(--glass-border)' : 'none',
                        background: i % 2 === 0 ? 'rgba(0, 0, 0, 0.05)' : 'transparent',
                      }}
                    >
                      <td style={{
                        padding: '8px',
                        color: 'var(--text-primary)',
                        fontFamily: 'monospace',
                      }}>
                        {sku.sku}
                      </td>
                      <td style={{
                        padding: '8px',
                        color: 'var(--text-secondary)',
                      }}>
                        {sku.size}
                      </td>
                      <td style={{
                        padding: '8px',
                        color: 'var(--text-secondary)',
                      }}>
                        {sku.paper}
                      </td>
                      <td style={{
                        padding: '8px',
                        textAlign: 'right',
                        color: 'var(--text-secondary)',
                      }}>
                        ${parseFloat(sku.cost).toFixed(2)}
                      </td>
                      <td style={{
                        padding: '8px',
                        textAlign: 'right',
                        color: '#f1641e',
                        fontWeight: 500,
                      }}>
                        ${parseFloat(sku.min_price).toFixed(2)}
                      </td>
                      <td style={{
                        padding: '8px',
                        textAlign: 'right',
                        color: '#22c55e',
                        fontWeight: 600,
                      }}>
                        ${parseFloat(sku.retail).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}>
        {titleOverLimit && (
          <div style={{
            padding: '10px 12px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '11px',
            color: '#ef4444',
          }}>
            ⚠️ Title exceeds {maxTitle} character limit
          </div>
        )}
        {tagsWrong && (
          <div style={{
            padding: '10px 12px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '11px',
            color: '#ef4444',
          }}>
            ⚠️ Etsy requires exactly {maxTags} tags (you have {tagCount})
          </div>
        )}
        {skus.length === 0 && (
          <div style={{
            padding: '10px 12px',
            background: 'rgba(249, 115, 22, 0.1)',
            border: '1px solid rgba(249, 115, 22, 0.3)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '11px',
            color: '#f97316',
          }}>
            ℹ️ No SKU pricing data. Add product variants to enable checkout.
          </div>
        )}
      </div>
    </div>
  );
}

export default EtsyPreview;
