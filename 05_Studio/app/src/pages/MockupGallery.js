import React from 'react';

/**
 * MockupGallery — Tab 4: Generated Mockups Browser
 *
 * Browse all generated mockups, filtered by gallery/template/platform.
 * Full implementation in Phase 5.
 */
function MockupGallery() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h2>Mockup Gallery</h2>
        <p className="page-subtitle">
          Browse generated mockups — organized by photo, template, and platform
        </p>
      </div>

      <div style={{
        marginTop: '24px', padding: '40px', background: '#2a2a2a',
        borderRadius: '8px', textAlign: 'center', border: '1px dashed #3a3a3a'
      }}>
        <p style={{ fontSize: '48px', margin: '0 0 16px' }}>📸</p>
        <h3 style={{ margin: '0 0 8px', color: '#ccc' }}>Coming in Phase 5</h3>
        <p style={{ color: '#888', maxWidth: '400px', margin: '0 auto' }}>
          The mockup gallery will show all generated mockups with filters for gallery,
          template, platform, and status (pending, approved, posted).
        </p>
      </div>
    </div>
  );
}

export default MockupGallery;
