import React, { useState, useCallback, useEffect } from 'react';

/**
 * LicensingManager — Studio tab for managing the licensing pipeline.
 *
 * WORKFLOW: Licensing images have their own ingest path, separate from gallery.
 *   1. Select source folder (Browse button or type path)
 *   2. Run pipeline: scan → preview (invisible protection) → thumbnail → R2 → catalog
 *   3. Review catalog, edit metadata (title, description, location)
 *   4. Deploy via Website Control tab
 *
 * NOTE: Gallery ingest (ContentIngest) auto-excludes licensing source folders.
 * Licensing images should ONLY go through this pipeline, not the gallery.
 */

const CLASSIFICATIONS = {
  ULTRA:    { color: '#c9a84c', label: 'ULTRA',    minWidth: 15000 },
  PREMIUM:  { color: '#b0b0b0', label: 'PREMIUM',  minWidth: 8000 },
  STANDARD: { color: '#cd7f32', label: 'STANDARD', minWidth: 4000 },
};

const PIPELINE_STEPS = [
  { id: 'scan',      label: 'Scan & Classify',       script: 'scan_licensing_folder.py' },
  { id: 'watermark', label: 'Generate Previews',       script: 'generate_watermark.py' },
  { id: 'thumbnail', label: 'Generate Thumbnails',    script: 'generate_thumbnail.py' },
  { id: 'r2',        label: 'Upload to R2',           script: 'upload_to_r2.py' },
  { id: 'catalog',   label: 'Generate Gallery Catalog', script: 'process_licensing_images.py' },
];

function LicensingManager() {
  const [sourceFolder, setSourceFolder] = useState('Photography/Large Scale Photography Stitch');
  const [pipelineLog, setPipelineLog] = useState('');
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editFields, setEditFields] = useState({ title: '', description: '', location: '' });
  const [forceRegenPreviews, setForceRegenPreviews] = useState(false);

  // ── Load catalog ──────────────────────────────────────────────────
  const loadCatalog = useCallback(async () => {
    try {
      if (window.electronAPI?.readFile) {
        const data = await window.electronAPI.readFile('09_Licensing/_catalog.json');
        setCatalog(JSON.parse(data));
      } else {
        // Fallback: fetch from web
        const resp = await fetch('/data/licensing-catalog.json');
        if (resp.ok) setCatalog(await resp.json());
      }
    } catch (e) {
      console.error('Failed to load catalog:', e);
    }
  }, []);

  // ── Auto-load catalog on mount ──────────────────────────────────
  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  // ── Browse for source folder ─────────────────────────────────────
  const browseSourceFolder = async () => {
    if (window.electronAPI?.selectFolder) {
      const result = await window.electronAPI.selectFolder();
      if (result) {
        // Convert absolute path to relative path from Archive-35 root
        const basePath = await window.electronAPI.getBasePath?.() || '';
        const relative = result.startsWith(basePath)
          ? result.slice(basePath.length + 1)  // +1 for trailing /
          : result;
        setSourceFolder(relative);
      }
    }
  };

  // ── Run pipeline ──────────────────────────────────────────────────
  const runPipeline = async () => {
    setPipelineRunning(true);
    setPipelineLog('');

    const log = (msg) => setPipelineLog(prev => prev + msg + '\n');

    if (window.electronAPI?.runCommand) {
      // Electron environment — run Python scripts
      for (const step of PIPELINE_STEPS) {
        setCurrentStep(step.id);
        log(`\n── ${step.label} ──`);
        try {
          if (step.id === 'catalog') {
            const result = await window.electronAPI.runCommand(
              `cd 09_Licensing && python3 process_licensing_images.py . --source "../${sourceFolder}"`
            );
            log(result);
          } else {
            const sourceArg = step.id === 'scan' ? ` --source "../${sourceFolder}"` : '';
            const forceArg = (step.id === 'watermark' && forceRegenPreviews) ? ' --force' : '';
            const result = await window.electronAPI.runCommand(
              `cd 09_Licensing && python3 ${step.script} .${sourceArg}${forceArg}`
            );
            log(result);
          }
        } catch (e) {
          log(`ERROR: ${e.message}`);
        }
      }
    } else {
      log('⚠ Pipeline requires Electron environment.');
      log('Run manually from terminal:');
      log(`  cd 09_Licensing`);
      log(`  python3 process_licensing_images.py . --source "../${sourceFolder}"`);
    }

    setCurrentStep(null);
    setPipelineRunning(false);
    await loadCatalog();
  };

  // ── Edit metadata ─────────────────────────────────────────────────
  const startEdit = (image) => {
    setEditingId(image.catalog_id || image.id);
    setEditFields({
      title: image.title || '',
      description: image.description || '',
      location: image.location || '',
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    if (window.electronAPI?.readFile && window.electronAPI?.writeFile) {
      try {
        const metaPath = `09_Licensing/metadata/${editingId}.json`;
        const data = JSON.parse(await window.electronAPI.readFile(metaPath));
        data.title = editFields.title;
        data.description = editFields.description;
        data.location = editFields.location;
        await window.electronAPI.writeFile(metaPath, JSON.stringify(data, null, 2));
        setEditingId(null);
        await loadCatalog();
      } catch (e) {
        console.error('Failed to save metadata:', e);
      }
    }
  };

  // ── Render ────────────────────────────────────────────────────────
  const images = catalog?.images || [];
  const counts = {
    total: images.length,
    ultra: images.filter(i => i.classification === 'ULTRA').length,
    premium: images.filter(i => i.classification === 'PREMIUM').length,
    standard: images.filter(i => i.classification === 'STANDARD').length,
  };

  return (
    <div style={{ padding: '24px', color: '#e0e0e0', fontFamily: 'Inter, sans-serif' }}>
      <h2 style={{ color: '#c4973b', marginBottom: '4px', fontSize: '20px', letterSpacing: '2px' }}>
        LICENSING MANAGER
      </h2>
      <p style={{ color: '#777', fontSize: '13px', marginBottom: '24px' }}>
        Process ultra-high-resolution images for commercial licensing
      </p>

      {/* Source folder selection */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'center' }}>
        <label style={{ color: '#999', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', whiteSpace: 'nowrap' }}>
          Source Folder:
        </label>
        <input
          type="text"
          value={sourceFolder}
          onChange={(e) => setSourceFolder(e.target.value)}
          placeholder="Photography/Large Scale Photography Stitch"
          style={{
            flex: 1, padding: '8px 12px', background: '#1a1a1a', border: '1px solid #333',
            borderRadius: '6px', color: '#fff', fontSize: '13px'
          }}
        />
        <button
          onClick={browseSourceFolder}
          style={{
            padding: '8px 16px', background: '#222', color: '#c4973b', border: '1px solid #333',
            borderRadius: '6px', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap'
          }}
        >
          Browse...
        </button>
      </div>

      {/* Pipeline controls */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', alignItems: 'center' }}>
        <button
          onClick={runPipeline}
          disabled={pipelineRunning || !sourceFolder}
          style={{
            padding: '8px 20px', background: (pipelineRunning || !sourceFolder) ? '#333' : '#c4973b',
            color: (pipelineRunning || !sourceFolder) ? '#666' : '#000', border: 'none', borderRadius: '6px',
            fontWeight: 700, fontSize: '12px', cursor: (pipelineRunning || !sourceFolder) ? 'not-allowed' : 'pointer',
            textTransform: 'uppercase', letterSpacing: '1px'
          }}
        >
          {pipelineRunning ? `Running: ${currentStep || '...'}` : 'Run Pipeline'}
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#999', fontSize: '12px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={forceRegenPreviews}
            onChange={(e) => setForceRegenPreviews(e.target.checked)}
            style={{ accentColor: '#c4973b' }}
          />
          Regenerate all previews
        </label>
        <button
          onClick={loadCatalog}
          style={{
            padding: '8px 16px', background: '#222', color: '#c4973b', border: '1px solid #333',
            borderRadius: '6px', fontSize: '12px', cursor: 'pointer', marginLeft: 'auto'
          }}
        >
          Reload Catalog
        </button>
      </div>

      {/* Workflow note */}
      <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '6px', padding: '10px 16px', marginBottom: '24px', fontSize: '11px', color: '#777' }}>
        <strong style={{ color: '#c4973b' }}>Licensing workflow:</strong> Select a source folder containing high-res panoramic images → Run Pipeline → Images are scanned, classified, and previews are generated with invisible copy protection (no visible watermark). Gallery ingest automatically excludes licensing source folders.
      </div>

      {/* Pipeline steps indicator */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px' }}>
        {PIPELINE_STEPS.map((step) => (
          <div key={step.id} style={{
            flex: 1, padding: '8px', borderRadius: '4px', textAlign: 'center', fontSize: '11px',
            background: currentStep === step.id ? '#c4973b' : '#1a1a1a',
            color: currentStep === step.id ? '#000' : '#666',
            border: `1px solid ${currentStep === step.id ? '#c4973b' : '#333'}`,
            fontWeight: currentStep === step.id ? 700 : 400,
          }}>
            {step.label}
          </div>
        ))}
      </div>

      {/* Pipeline log */}
      {pipelineLog && (
        <pre style={{
          background: '#0d0d0d', border: '1px solid #333', borderRadius: '6px',
          padding: '16px', fontSize: '11px', maxHeight: '200px', overflowY: 'auto',
          marginBottom: '24px', color: '#aaa', whiteSpace: 'pre-wrap'
        }}>
          {pipelineLog}
        </pre>
      )}

      {/* Stats */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'Total', count: counts.total, color: '#fff' },
          { label: 'Ultra', count: counts.ultra, color: CLASSIFICATIONS.ULTRA.color },
          { label: 'Premium', count: counts.premium, color: CLASSIFICATIONS.PREMIUM.color },
          { label: 'Standard', count: counts.standard, color: CLASSIFICATIONS.STANDARD.color },
        ].map(s => (
          <div key={s.label} style={{
            background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px',
            padding: '12px 20px', textAlign: 'center'
          }}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: s.color }}>{s.count}</div>
            <div style={{ fontSize: '11px', color: '#777', textTransform: 'uppercase', letterSpacing: '1px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Image catalog table */}
      {images.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333', textAlign: 'left' }}>
              <th style={{ padding: '8px', color: '#777' }}>ID</th>
              <th style={{ padding: '8px', color: '#777' }}>File</th>
              <th style={{ padding: '8px', color: '#777' }}>Tier</th>
              <th style={{ padding: '8px', color: '#777' }}>Resolution</th>
              <th style={{ padding: '8px', color: '#777' }}>MP</th>
              <th style={{ padding: '8px', color: '#777' }}>Size</th>
              <th style={{ padding: '8px', color: '#777' }}>Title</th>
              <th style={{ padding: '8px', color: '#777' }}></th>
            </tr>
          </thead>
          <tbody>
            {images.map((img) => {
              const cls = CLASSIFICATIONS[img.classification] || CLASSIFICATIONS.STANDARD;
              const isEditing = editingId === (img.catalog_id || img.id);
              return (
                <tr key={img.catalog_id || img.id} style={{ borderBottom: '1px solid #222' }}>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: '#999' }}>
                    {img.catalog_id || img.id}
                  </td>
                  <td style={{ padding: '6px 8px', color: '#ccc', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {img.original_filename || img.title}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <span style={{
                      background: cls.color, color: '#000', padding: '2px 8px',
                      borderRadius: '3px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px'
                    }}>{img.classification}</span>
                  </td>
                  <td style={{ padding: '6px 8px', color: '#aaa' }}>
                    {img.width?.toLocaleString()} × {img.height?.toLocaleString()}
                  </td>
                  <td style={{ padding: '6px 8px', color: '#aaa' }}>{img.megapixels}</td>
                  <td style={{ padding: '6px 8px', color: '#aaa' }}>{img.file_size_mb} MB</td>
                  <td style={{ padding: '6px 8px' }}>
                    {isEditing ? (
                      <input
                        value={editFields.title}
                        onChange={(e) => setEditFields(f => ({ ...f, title: e.target.value }))}
                        style={{ background: '#222', border: '1px solid #c4973b', color: '#fff', padding: '2px 6px', borderRadius: '3px', width: '100%' }}
                      />
                    ) : (
                      <span style={{ color: img.title ? '#ccc' : '#555' }}>{img.title || '(untitled)'}</span>
                    )}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {isEditing ? (
                      <button onClick={saveEdit} style={{ background: '#c4973b', color: '#000', border: 'none', padding: '2px 10px', borderRadius: '3px', fontSize: '11px', cursor: 'pointer' }}>Save</button>
                    ) : (
                      <button onClick={() => startEdit(img)} style={{ background: 'none', color: '#c4973b', border: '1px solid #333', padding: '2px 10px', borderRadius: '3px', fontSize: '11px', cursor: 'pointer' }}>Edit</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {images.length === 0 && !pipelineRunning && (
        <div style={{ textAlign: 'center', padding: '48px', color: '#555' }}>
          <p style={{ fontSize: '16px' }}>No licensing images found</p>
          <p style={{ fontSize: '13px' }}>Set your source folder above and run the pipeline to scan images.</p>
        </div>
      )}
    </div>
  );
}

export default LicensingManager;
