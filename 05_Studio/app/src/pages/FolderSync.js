import React, { useState, useEffect, useRef } from 'react';

/**
 * FolderSync — One-way folder sync (Source → Destination)
 *
 * Designed for syncing the Photography master folder to iCloud
 * so Wolf can access photos from a second computer for social media.
 *
 * - Source = master (Photography folder)
 * - Destination = iCloud folder
 * - One-way only: source → destination (never reverse)
 * - Copies new and updated files
 * - Optionally removes files from dest that don't exist in source
 */

const styles = {
  container: {
    padding: '32px',
    maxWidth: '800px',
    color: '#e0e0e0',
  },
  header: {
    fontSize: '24px',
    fontWeight: 700,
    marginBottom: '8px',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: '14px',
    color: '#888',
    marginBottom: '32px',
  },
  section: {
    background: '#1a1a2e',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '20px',
    border: '1px solid #2a2a4a',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#ffffff',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  folderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px',
  },
  folderLabel: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#aaa',
    width: '90px',
    flexShrink: 0,
  },
  folderPath: {
    flex: 1,
    background: '#0d0d1a',
    border: '1px solid #333',
    borderRadius: '8px',
    padding: '10px 14px',
    color: '#e0e0e0',
    fontSize: '13px',
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minHeight: '20px',
  },
  folderPathEmpty: {
    color: '#555',
    fontStyle: 'italic',
  },
  btn: {
    padding: '8px 16px',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    transition: 'all 0.2s',
    flexShrink: 0,
  },
  btnBrowse: {
    background: '#2a2a4a',
    color: '#e0e0e0',
  },
  btnSync: {
    background: '#4a90d9',
    color: '#fff',
    padding: '12px 32px',
    fontSize: '15px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  btnSyncDisabled: {
    background: '#333',
    color: '#666',
    cursor: 'not-allowed',
  },
  btnSave: {
    background: '#2d6a2d',
    color: '#fff',
    padding: '10px 24px',
    fontSize: '14px',
  },
  btnDanger: {
    background: '#4a2020',
    color: '#ff6b6b',
    padding: '8px 16px',
    fontSize: '12px',
  },
  statusBar: {
    background: '#0d0d1a',
    borderRadius: '8px',
    padding: '16px',
    marginTop: '12px',
  },
  progressOuter: {
    width: '100%',
    height: '6px',
    background: '#222',
    borderRadius: '3px',
    overflow: 'hidden',
    marginTop: '8px',
    marginBottom: '8px',
  },
  progressInner: {
    height: '100%',
    background: '#4a90d9',
    borderRadius: '3px',
    transition: 'width 0.3s ease',
  },
  statusText: {
    fontSize: '13px',
    color: '#aaa',
  },
  statusSuccess: {
    color: '#4CAF50',
  },
  statusError: {
    color: '#ff6b6b',
  },
  lastSync: {
    fontSize: '12px',
    color: '#666',
    marginTop: '8px',
  },
  infoBox: {
    background: '#1a2a1a',
    border: '1px solid #2d4a2d',
    borderRadius: '8px',
    padding: '12px 16px',
    fontSize: '13px',
    color: '#8bc34a',
    lineHeight: 1.5,
    marginBottom: '16px',
  },
  warningBox: {
    background: '#2a2a1a',
    border: '1px solid #4a4a2d',
    borderRadius: '8px',
    padding: '12px 16px',
    fontSize: '13px',
    color: '#ffb74d',
    lineHeight: 1.5,
  },
  statsRow: {
    display: 'flex',
    gap: '24px',
    marginTop: '12px',
    flexWrap: 'wrap',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
  },
  statValue: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#4a90d9',
  },
  statLabel: {
    fontSize: '11px',
    color: '#888',
    textTransform: 'uppercase',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginTop: '12px',
  },
  toggle: {
    width: '40px',
    height: '22px',
    borderRadius: '11px',
    background: '#333',
    position: 'relative',
    cursor: 'pointer',
    transition: 'background 0.2s',
    border: 'none',
    padding: 0,
  },
  toggleActive: {
    background: '#4a90d9',
  },
  toggleDot: {
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    background: '#fff',
    position: 'absolute',
    top: '2px',
    left: '2px',
    transition: 'left 0.2s',
  },
  toggleDotActive: {
    left: '20px',
  },
  toggleLabel: {
    fontSize: '13px',
    color: '#ccc',
  },
};

function FolderSync() {
  const [sourceFolder, setSourceFolder] = useState('');
  const [destFolder, setDestFolder] = useState('');
  const [deleteOrphans, setDeleteOrphans] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [configDirty, setConfigDirty] = useState(false);
  const cleanupRef = useRef(null);

  // Load saved config on mount
  useEffect(() => {
    loadConfig();
    // Subscribe to sync progress events
    if (window.electronAPI?.onSyncProgress) {
      cleanupRef.current = window.electronAPI.onSyncProgress((data) => {
        setProgress(data);
        if (data.phase === 'complete') {
          setSyncing(false);
          setLastSync(new Date().toISOString());
          setLastResult({
            success: true,
            copied: data.copied || 0,
            skipped: data.skipped || 0,
            deleted: data.deleted || 0,
            errors: data.errors || 0,
            totalFiles: data.totalFiles || 0,
            duration: data.duration || 0,
          });
        } else if (data.phase === 'error') {
          setSyncing(false);
          setLastResult({ success: false, error: data.message });
        }
      });
    }
    return () => {
      if (cleanupRef.current) cleanupRef.current();
    };
  }, []);

  async function loadConfig() {
    try {
      const config = await window.electronAPI.getSyncConfig();
      if (config) {
        setSourceFolder(config.sourceFolder || '');
        setDestFolder(config.destFolder || '');
        setDeleteOrphans(config.deleteOrphans || false);
        setLastSync(config.lastSync || null);
      }
    } catch (err) {
      console.error('Failed to load sync config:', err);
    }
  }

  async function selectSource() {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      setSourceFolder(folder);
      setConfigDirty(true);
    }
  }

  async function selectDest() {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      setDestFolder(folder);
      setConfigDirty(true);
    }
  }

  async function saveConfig() {
    try {
      await window.electronAPI.saveSyncConfig({
        sourceFolder,
        destFolder,
        deleteOrphans,
      });
      setConfigDirty(false);
    } catch (err) {
      console.error('Failed to save sync config:', err);
    }
  }

  async function runSync() {
    if (!sourceFolder || !destFolder) return;
    if (syncing) return;

    setSyncing(true);
    setProgress({ phase: 'scanning', message: 'Scanning source folder...', percent: 0 });
    setLastResult(null);

    try {
      // Save config first (in case paths changed)
      await window.electronAPI.saveSyncConfig({
        sourceFolder,
        destFolder,
        deleteOrphans,
      });
      setConfigDirty(false);

      // Run the sync
      const result = await window.electronAPI.runFolderSync({
        sourceFolder,
        destFolder,
        deleteOrphans,
      });

      if (!result.success) {
        setSyncing(false);
        setLastResult({ success: false, error: result.error });
      }
      // On success, the progress event handler sets the final state
    } catch (err) {
      setSyncing(false);
      setLastResult({ success: false, error: err.message });
    }
  }

  const canSync = sourceFolder && destFolder && !syncing;
  const configComplete = sourceFolder && destFolder;

  return (
    <div style={styles.container}>
      <div style={styles.header}>☁️ Folder Sync</div>
      <div style={styles.subtitle}>
        One-way sync from master folder → iCloud (or any destination)
      </div>

      {/* Info */}
      <div style={styles.infoBox}>
        <strong>One-way sync:</strong> Files are copied from Source → Destination only.
        The source folder is always the master — nothing is ever written back to it.
      </div>

      {/* Folder Selection */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>📂 Folders</div>

        {/* Source */}
        <div style={styles.folderRow}>
          <div style={styles.folderLabel}>SOURCE</div>
          <div style={{
            ...styles.folderPath,
            ...(sourceFolder ? {} : styles.folderPathEmpty),
          }}>
            {sourceFolder || 'No source folder selected'}
          </div>
          <button
            style={{ ...styles.btn, ...styles.btnBrowse }}
            onClick={selectSource}
            disabled={syncing}
          >
            Browse
          </button>
        </div>

        {/* Arrow */}
        <div style={{ textAlign: 'center', fontSize: '20px', color: '#4a90d9', margin: '4px 0 12px 0' }}>
          ↓ syncs to ↓
        </div>

        {/* Destination */}
        <div style={styles.folderRow}>
          <div style={styles.folderLabel}>DESTINATION</div>
          <div style={{
            ...styles.folderPath,
            ...(destFolder ? {} : styles.folderPathEmpty),
          }}>
            {destFolder || 'No destination folder selected'}
          </div>
          <button
            style={{ ...styles.btn, ...styles.btnBrowse }}
            onClick={selectDest}
            disabled={syncing}
          >
            Browse
          </button>
        </div>

        {/* Options */}
        <div style={styles.toggleRow}>
          <button
            style={{
              ...styles.toggle,
              ...(deleteOrphans ? styles.toggleActive : {}),
            }}
            onClick={() => { setDeleteOrphans(!deleteOrphans); setConfigDirty(true); }}
            disabled={syncing}
          >
            <div style={{
              ...styles.toggleDot,
              ...(deleteOrphans ? styles.toggleDotActive : {}),
            }} />
          </button>
          <span style={styles.toggleLabel}>
            Remove destination files not in source
          </span>
        </div>
        {deleteOrphans && (
          <div style={{ ...styles.warningBox, marginTop: '12px' }}>
            ⚠️ Files in the destination that don't exist in the source will be <strong>permanently deleted</strong>.
          </div>
        )}

        {/* Save */}
        {configDirty && (
          <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              style={{ ...styles.btn, ...styles.btnSave }}
              onClick={saveConfig}
            >
              Save Configuration
            </button>
          </div>
        )}
      </div>

      {/* Sync Control */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>🔄 Sync</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            style={{
              ...styles.btn,
              ...styles.btnSync,
              ...(!canSync ? styles.btnSyncDisabled : {}),
            }}
            onClick={runSync}
            disabled={!canSync}
          >
            {syncing ? '⏳ Syncing...' : '▶ Sync Now'}
          </button>

          {lastSync && !syncing && (
            <div style={styles.lastSync}>
              Last sync: {new Date(lastSync).toLocaleString()}
            </div>
          )}
        </div>

        {/* Progress Bar */}
        {syncing && progress && (
          <div style={styles.statusBar}>
            <div style={styles.statusText}>
              {progress.message || 'Working...'}
            </div>
            <div style={styles.progressOuter}>
              <div style={{
                ...styles.progressInner,
                width: `${progress.percent || 0}%`,
              }} />
            </div>
            {progress.current && progress.total && (
              <div style={styles.statusText}>
                {progress.current} / {progress.total} files
              </div>
            )}
          </div>
        )}

        {/* Result */}
        {lastResult && !syncing && (
          <div style={{
            ...styles.statusBar,
            border: lastResult.success ? '1px solid #2d4a2d' : '1px solid #4a2020',
          }}>
            {lastResult.success ? (
              <>
                <div style={{ ...styles.statusText, ...styles.statusSuccess, fontWeight: 600 }}>
                  ✅ Sync completed successfully
                </div>
                <div style={styles.statsRow}>
                  <div style={styles.stat}>
                    <span style={styles.statValue}>{lastResult.copied}</span>
                    <span style={styles.statLabel}>Copied</span>
                  </div>
                  <div style={styles.stat}>
                    <span style={styles.statValue}>{lastResult.skipped}</span>
                    <span style={styles.statLabel}>Up to date</span>
                  </div>
                  {lastResult.deleted > 0 && (
                    <div style={styles.stat}>
                      <span style={{ ...styles.statValue, color: '#ff6b6b' }}>{lastResult.deleted}</span>
                      <span style={styles.statLabel}>Deleted</span>
                    </div>
                  )}
                  {lastResult.errors > 0 && (
                    <div style={styles.stat}>
                      <span style={{ ...styles.statValue, color: '#ffb74d' }}>{lastResult.errors}</span>
                      <span style={styles.statLabel}>Errors</span>
                    </div>
                  )}
                  <div style={styles.stat}>
                    <span style={styles.statValue}>{lastResult.totalFiles}</span>
                    <span style={styles.statLabel}>Total</span>
                  </div>
                  {lastResult.duration > 0 && (
                    <div style={styles.stat}>
                      <span style={styles.statValue}>{(lastResult.duration / 1000).toFixed(1)}s</span>
                      <span style={styles.statLabel}>Duration</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ ...styles.statusText, ...styles.statusError }}>
                ❌ Sync failed: {lastResult.error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Help */}
      {!configComplete && (
        <div style={styles.warningBox}>
          Select both a <strong>source</strong> and <strong>destination</strong> folder to enable syncing.
          For iCloud, choose your iCloud Drive folder (usually <code>~/Library/Mobile Documents/com~apple~CloudDocs/</code>).
        </div>
      )}
    </div>
  );
}

export default FolderSync;
