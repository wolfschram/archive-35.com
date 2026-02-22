import React from 'react';

/**
 * MockupBatch — Tab 3: Batch Compositing Queue
 *
 * Queue and monitor batch compositing jobs for platform content.
 * Full implementation in Phase 5.
 */
function MockupBatch() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h2>Batch Queue</h2>
        <p className="page-subtitle">
          Bulk generate mockup images for Pinterest, Etsy, and Website
        </p>
      </div>

      <div style={{
        marginTop: '24px', padding: '40px', background: '#2a2a2a',
        borderRadius: '8px', textAlign: 'center', border: '1px dashed #3a3a3a'
      }}>
        <p style={{ fontSize: '48px', margin: '0 0 16px' }}>⚙️</p>
        <h3 style={{ margin: '0 0 8px', color: '#ccc' }}>Coming in Phase 5</h3>
        <p style={{ color: '#888', maxWidth: '400px', margin: '0 auto' }}>
          Batch compositing will let you select multiple photos and templates,
          choose target platforms, and generate hundreds of mockup images automatically.
        </p>
        <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <span style={{ padding: '4px 12px', background: '#3a3a3a', borderRadius: '12px', fontSize: '13px', color: '#999' }}>
            Pinterest 2:3
          </span>
          <span style={{ padding: '4px 12px', background: '#3a3a3a', borderRadius: '12px', fontSize: '13px', color: '#999' }}>
            Etsy 1:1
          </span>
          <span style={{ padding: '4px 12px', background: '#3a3a3a', borderRadius: '12px', fontSize: '13px', color: '#999' }}>
            Website Responsive
          </span>
        </div>
      </div>
    </div>
  );
}

export default MockupBatch;
