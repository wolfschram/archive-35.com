import React, { useState, useCallback, useEffect } from 'react';

/**
 * LicensingManager — Studio tab for managing the licensing pipeline.
 *
 * WORKFLOW: Licensing images have their own ingest path, separate from gallery.
 *   1. Select source folder (Browse button or type path)
 *   2. Run pipeline: scan → preview (invisible protection) → thumbnail → R2 → catalog
 *   3. AI Name: auto-generate titles/descriptions/locations via Claude Haiku
 *   4. Review & approve AI suggestions (edit inline before saving)
 *   5. Deploy via Website Control tab
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

  // AI naming state
  const [aiResults, setAiResults] = useState([]);  // pending AI suggestions
  const [aiRunning, setAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState(null);
  const [showAiReview, setShowAiReview] = useState(false);

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

  // ── Listen for AI progress events ───────────────────────────────
  useEffect(() => {
    if (!window.electronAPI?.onLicensingAIProgress) return;
    const cleanup = window.electronAPI.onLicensingAIProgress((data) => {
      setAiProgress(data);
    });
    return cleanup;
  }, []);

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
            const sourceArg = step.id === 'scan' ? ` . --source "../${sourceFolder}"` : '';
            const folderArg = (step.id !== 'scan' && step.id !== 'r2') ? ' .' : '';
            const forceArg = (step.id === 'watermark' && forceRegenPreviews) ? ' --force' : '';
            const result = await window.electronAPI.runCommand(
              `cd 09_Licensing && python3 ${step.script}${folderArg}${sourceArg}${forceArg}`
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

  // ── AI Naming ─────────────────────────────────────────────────────
  const runAINaming = async (selectedIds = null) => {
    if (!window.electronAPI?.analyzeLicensingPhotos) return;
    setAiRunning(true);
    setAiProgress(null);
    setAiResults([]);

    try {
      const result = await window.electronAPI.analyzeLicensingPhotos({
        catalogIds: selectedIds  // null = all untitled
      });

      if (result.success && result.results.length > 0) {
        // Pre-populate editable fields from AI suggestions
        setAiResults(result.results.map(r => ({
          ...r,
          title: r.ai_title,
          description: r.ai_description,
          location: r.ai_location,
        })));
        setShowAiReview(true);
      } else if (result.success && result.results.length === 0) {
        alert('All images already have titles. Select specific images to re-analyze.');
      } else {
        alert('AI analysis failed: ' + (result.error || 'Unknown error'));
      }
    } catch (e) {
      alert('AI analysis error: ' + e.message);
    }

    setAiRunning(false);
    setAiProgress(null);
  };

  const updateAiResult = (catalogId, field, value) => {
    setAiResults(prev => prev.map(r =>
      r.catalog_id === catalogId ? { ...r, [field]: value } : r
    ));
  };

  const removeAiResult = (catalogId) => {
    setAiResults(prev => prev.filter(r => r.catalog_id !== catalogId));
  };

  const approveAll = async () => {
    if (!window.electronAPI?.saveLicensingMetadata) return;
    const updates = aiResults.filter(r => r.status !== 'error').map(r => ({
      catalog_id: r.catalog_id,
      title: r.title,
      description: r.description,
      location: r.location,
    }));

    const result = await window.electronAPI.saveLicensingMetadata({ updates });
    if (result.success) {
      setAiResults([]);
      setShowAiReview(false);
      await loadCatalog();
    } else {
      alert('Save failed: ' + result.error);
    }
  };

  const approveSingle = async (catalogId) => {
    if (!window.electronAPI?.saveLicensingMetadata) return;
    const item = aiResults.find(r => r.catalog_id === catalogId);
    if (!item) return;

    const result = await window.electronAPI.saveLicensingMetadata({
      updates: [{
        catalog_id: item.catalog_id,
        title: item.title,
        description: item.description,
        location: item.location,
      }]
    });
    if (result.success) {
      removeAiResult(catalogId);
      await loadCatalog();
      if (aiResults.length <= 1) setShowAiReview(false);
    }
  };

  // ── Edit metadata (existing catalog entries) ─────────────────────
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
    if (window.electronAPI?.saveLicensingMetadata) {
      try {
        await window.electronAPI.saveLicensingMetadata({
          updates: [{
            catalog_id: editingId,
            title: editFields.title,
            description: editFields.description,
            location: editFields.location,
          }]
        });
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
    untitled: images.filter(i => !i.title || i.title.trim() === '').length,
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

      {/* Pipeline + AI controls */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={runPipeline}
          disabled={pipelineRunning || aiRunning || !sourceFolder}
          style={{
            padding: '8px 20px', background: (pipelineRunning || aiRunning || !sourceFolder) ? '#333' : '#c4973b',
            color: (pipelineRunning || aiRunning || !sourceFolder) ? '#666' : '#000', border: 'none', borderRadius: '6px',
            fontWeight: 700, fontSize: '12px', cursor: (pipelineRunning || aiRunning || !sourceFolder) ? 'not-allowed' : 'pointer',
            textTransform: 'uppercase', letterSpacing: '1px'
          }}
        >
          {pipelineRunning ? `Running: ${currentStep || '...'}` : 'Run Pipeline'}
        </button>

        <button
          onClick={() => runAINaming(null)}
          disabled={aiRunning || pipelineRunning || counts.untitled === 0}
          style={{
            padding: '8px 20px',
            background: (aiRunning || pipelineRunning || counts.untitled === 0) ? '#333' : '#2a6b3a',
            color: (aiRunning || pipelineRunning || counts.untitled === 0) ? '#666' : '#fff',
            border: 'none', borderRadius: '6px',
            fontWeight: 700, fontSize: '12px',
            cursor: (aiRunning || pipelineRunning || counts.untitled === 0) ? 'not-allowed' : 'pointer',
            textTransform: 'uppercase', letterSpacing: '1px'
          }}
        >
          {aiRunning
            ? `AI Naming ${aiProgress ? `${aiProgress.current}/${aiProgress.total}` : '...'}`
            : `AI Name (${counts.untitled} untitled)`}
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

      {/* AI Progress bar */}
      {aiRunning && aiProgress && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#999', marginBottom: '4px' }}>
            <span>{aiProgress.message}</span>
            <span>{Math.round(aiProgress.current / aiProgress.total * 100)}%</span>
          </div>
          <div style={{ background: '#1a1a1a', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
            <div style={{
              background: '#2a6b3a', height: '100%', borderRadius: '4px',
              width: `${(aiProgress.current / aiProgress.total) * 100}%`,
              transition: 'width 0.3s ease'
            }} />
          </div>
        </div>
      )}

      {/* Workflow note */}
      <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '6px', padding: '10px 16px', marginBottom: '24px', fontSize: '11px', color: '#777' }}>
        <strong style={{ color: '#c4973b' }}>Licensing workflow:</strong> Select a source folder containing high-res panoramic images → Run Pipeline → Images are scanned, classified, and previews are generated with invisible copy protection (no visible watermark). Then use <strong style={{ color: '#2a6b3a' }}>AI Name</strong> to auto-generate titles, descriptions, and locations — review and approve before saving.
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

      {/* ── AI Review Panel ─────────────────────────────────────── */}
      {showAiReview && aiResults.length > 0 && (
        <div style={{
          background: '#0f1f14', border: '1px solid #2a6b3a', borderRadius: '8px',
          padding: '20px', marginBottom: '24px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ color: '#2a6b3a', fontSize: '14px', letterSpacing: '1px', margin: 0, textTransform: 'uppercase' }}>
              Review AI Suggestions ({aiResults.length})
            </h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => { setAiResults([]); setShowAiReview(false); }}
                style={{
                  padding: '6px 14px', background: '#333', color: '#999', border: 'none',
                  borderRadius: '4px', fontSize: '11px', cursor: 'pointer'
                }}
              >
                Discard All
              </button>
              <button
                onClick={approveAll}
                style={{
                  padding: '6px 14px', background: '#2a6b3a', color: '#fff', border: 'none',
                  borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: 700
                }}
              >
                Approve All ({aiResults.filter(r => r.status !== 'error').length})
              </button>
            </div>
          </div>

          <p style={{ color: '#6a9', fontSize: '11px', marginBottom: '16px' }}>
            Review and edit each suggestion below. Click "Approve" to save, or edit the fields first if the AI got something wrong.
          </p>

          {aiResults.map((r) => {
            const cls = CLASSIFICATIONS[r.classification] || CLASSIFICATIONS.STANDARD;
            return (
              <div key={r.catalog_id} style={{
                background: '#1a1a1a', border: '1px solid #333', borderRadius: '6px',
                padding: '14px', marginBottom: '10px',
                opacity: r.status === 'error' ? 0.5 : 1
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'monospace', color: '#777', fontSize: '11px' }}>{r.catalog_id}</span>
                    <span style={{ color: '#999', fontSize: '12px' }}>{r.original_filename}</span>
                    <span style={{
                      background: cls.color, color: '#000', padding: '1px 6px',
                      borderRadius: '3px', fontSize: '9px', fontWeight: 700
                    }}>{r.classification}</span>
                    {r.width && <span style={{ color: '#666', fontSize: '10px' }}>{r.width?.toLocaleString()} x {r.height?.toLocaleString()}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {r.status !== 'error' && (
                      <button
                        onClick={() => approveSingle(r.catalog_id)}
                        style={{
                          padding: '4px 12px', background: '#2a6b3a', color: '#fff', border: 'none',
                          borderRadius: '3px', fontSize: '11px', cursor: 'pointer', fontWeight: 600
                        }}
                      >
                        Approve
                      </button>
                    )}
                    <button
                      onClick={() => removeAiResult(r.catalog_id)}
                      style={{
                        padding: '4px 12px', background: '#333', color: '#999', border: 'none',
                        borderRadius: '3px', fontSize: '11px', cursor: 'pointer'
                      }}
                    >
                      Skip
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '16px' }}>
                  {/* Image preview */}
                  {r.thumbnail ? (
                    <div style={{ flexShrink: 0 }}>
                      <img
                        src={r.thumbnail}
                        alt={r.original_filename}
                        style={{
                          width: '180px', height: '120px', objectFit: 'cover',
                          borderRadius: '4px', border: '1px solid #333'
                        }}
                      />
                    </div>
                  ) : (
                    <div style={{
                      width: '180px', height: '120px', flexShrink: 0,
                      background: '#222', borderRadius: '4px', border: '1px solid #333',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#555', fontSize: '10px'
                    }}>
                      No preview
                    </div>
                  )}

                  {/* Metadata fields */}
                  <div style={{ flex: 1 }}>
                    {r.status === 'error' ? (
                      <div style={{ color: '#c44', fontSize: '11px' }}>AI analysis failed: {r.error}</div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '6px 10px', fontSize: '12px' }}>
                        <label style={{ color: '#777', textAlign: 'right', paddingTop: '4px' }}>Title:</label>
                        <input
                          value={r.title}
                          onChange={(e) => updateAiResult(r.catalog_id, 'title', e.target.value)}
                          style={{
                            background: '#222', border: '1px solid #444', color: '#fff',
                            padding: '4px 8px', borderRadius: '3px', fontSize: '12px'
                          }}
                        />
                        <label style={{ color: '#777', textAlign: 'right', paddingTop: '4px' }}>Location:</label>
                        <input
                          value={r.location}
                          onChange={(e) => updateAiResult(r.catalog_id, 'location', e.target.value)}
                          style={{
                            background: '#222', border: '1px solid #444', color: '#fff',
                            padding: '4px 8px', borderRadius: '3px', fontSize: '12px'
                          }}
                        />
                        <label style={{ color: '#777', textAlign: 'right', paddingTop: '4px' }}>Description:</label>
                        <textarea
                          value={r.description}
                          onChange={(e) => updateAiResult(r.catalog_id, 'description', e.target.value)}
                          rows={2}
                          style={{
                            background: '#222', border: '1px solid #444', color: '#fff',
                            padding: '4px 8px', borderRadius: '3px', fontSize: '12px', resize: 'vertical'
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'Total', count: counts.total, color: '#fff' },
          { label: 'Ultra', count: counts.ultra, color: CLASSIFICATIONS.ULTRA.color },
          { label: 'Premium', count: counts.premium, color: CLASSIFICATIONS.PREMIUM.color },
          { label: 'Standard', count: counts.standard, color: CLASSIFICATIONS.STANDARD.color },
          { label: 'Untitled', count: counts.untitled, color: counts.untitled > 0 ? '#c44' : '#4a4' },
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
                    {img.width?.toLocaleString()} x {img.height?.toLocaleString()}
                  </td>
                  <td style={{ padding: '6px 8px', color: '#aaa' }}>{img.megapixels}</td>
                  <td style={{ padding: '6px 8px', color: '#aaa' }}>{img.file_size_mb} MB</td>
                  <td style={{ padding: '6px 8px' }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <input
                          value={editFields.title}
                          onChange={(e) => setEditFields(f => ({ ...f, title: e.target.value }))}
                          placeholder="Title"
                          style={{ background: '#222', border: '1px solid #c4973b', color: '#fff', padding: '2px 6px', borderRadius: '3px', fontSize: '11px' }}
                        />
                        <input
                          value={editFields.location}
                          onChange={(e) => setEditFields(f => ({ ...f, location: e.target.value }))}
                          placeholder="Location"
                          style={{ background: '#222', border: '1px solid #555', color: '#fff', padding: '2px 6px', borderRadius: '3px', fontSize: '11px' }}
                        />
                        <input
                          value={editFields.description}
                          onChange={(e) => setEditFields(f => ({ ...f, description: e.target.value }))}
                          placeholder="Description"
                          style={{ background: '#222', border: '1px solid #555', color: '#fff', padding: '2px 6px', borderRadius: '3px', fontSize: '11px' }}
                        />
                      </div>
                    ) : (
                      <span style={{ color: img.title ? '#ccc' : '#555' }}>{img.title || '(untitled)'}</span>
                    )}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <button onClick={saveEdit} style={{ background: '#c4973b', color: '#000', border: 'none', padding: '2px 10px', borderRadius: '3px', fontSize: '11px', cursor: 'pointer' }}>Save</button>
                        <button onClick={() => setEditingId(null)} style={{ background: '#333', color: '#999', border: 'none', padding: '2px 10px', borderRadius: '3px', fontSize: '11px', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button onClick={() => startEdit(img)} style={{ background: 'none', color: '#c4973b', border: '1px solid #333', padding: '2px 10px', borderRadius: '3px', fontSize: '11px', cursor: 'pointer' }}>Edit</button>
                        {(!img.title || img.title.trim() === '') && (
                          <button
                            onClick={() => runAINaming([img.catalog_id])}
                            disabled={aiRunning}
                            style={{ background: 'none', color: '#2a6b3a', border: '1px solid #333', padding: '2px 8px', borderRadius: '3px', fontSize: '10px', cursor: aiRunning ? 'not-allowed' : 'pointer' }}
                          >
                            AI
                          </button>
                        )}
                      </div>
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
