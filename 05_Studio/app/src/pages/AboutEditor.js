import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

function AboutEditor() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [shortBio, setShortBio] = useState('');
  const [longBio, setLongBio] = useState([]);
  const [artistQuote, setArtistQuote] = useState('');
  const [printsInfo, setPrintsInfo] = useState([]);
  const [photoPath, setPhotoPath] = useState('');
  const [newPhotoPath, setNewPhotoPath] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [deploySteps, setDeploySteps] = useState([]);

  useEffect(() => {
    loadContent();
    if (window.electronAPI?.onAboutDeployProgress) {
      const cleanup = window.electronAPI.onAboutDeployProgress((data) => {
        setDeploySteps(prev => {
          const existing = prev.findIndex(s => s.step === data.step);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = data;
            return updated;
          }
          return [...prev, data];
        });
        if (data.status === 'ok' && data.step === 'done') {
          setSaving(false);
          setStatus({ type: 'success', message: 'About page updated and deployed!' });
          setNewPhotoPath(null);
        } else if (data.status === 'error') {
          setSaving(false);
          setStatus({ type: 'error', message: data.message });
        }
      });
      return cleanup;
    }
  }, []);

  const loadContent = async () => {
    setLoading(true);
    try {
      if (window.electronAPI?.loadAboutContent) {
        const data = await window.electronAPI.loadAboutContent();
        if (data) {
          setShortBio(data.shortBio || '');
          setLongBio(data.longBio || []);
          setArtistQuote(data.artistQuote || '');
          setPrintsInfo(data.printsInfo || []);
          setPhotoPath(data.photoPath || '');
          setPhotoPreview(data.photoPath || '');
        }
      }
    } catch (err) {
      setStatus({ type: 'error', message: 'Failed to load about content: ' + err.message });
    }
    setLoading(false);
  };

  const handleSelectPhoto = async () => {
    if (window.electronAPI?.selectAboutPhoto) {
      const result = await window.electronAPI.selectAboutPhoto();
      if (result && result.filePath) {
        setNewPhotoPath(result.filePath);
        setPhotoPreview(result.preview || result.filePath);
      }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    setDeploySteps([]);
    try {
      await window.electronAPI.saveAboutContent({
        shortBio,
        longBio,
        artistQuote,
        printsInfo,
        photoPath,
        newPhotoPath: newPhotoPath || null,
      });
    } catch (err) {
      setSaving(false);
      setStatus({ type: 'error', message: 'Save failed: ' + err.message });
    }
  };

  const updateLongBioParagraph = (index, value) => {
    const updated = [...longBio];
    updated[index] = value;
    setLongBio(updated);
  };

  const addLongBioParagraph = () => {
    setLongBio([...longBio, '']);
  };

  const removeLongBioParagraph = (index) => {
    setLongBio(longBio.filter((_, i) => i !== index));
  };

  const updatePrintsInfoParagraph = (index, value) => {
    const updated = [...printsInfo];
    updated[index] = value;
    setPrintsInfo(updated);
  };

  const addPrintsInfoParagraph = () => {
    setPrintsInfo([...printsInfo, '']);
  };

  const removePrintsInfoParagraph = (index) => {
    setPrintsInfo(printsInfo.filter((_, i) => i !== index));
  };

  const openAboutPage = () => {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal('https://archive-35.com/about.html');
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <h2>About Page Editor</h2>
        </div>
        <div className="card"><p>Loading about content...</p></div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>About Page Editor</h2>
        <p className="page-subtitle">Edit your bio, artist statement, and portrait photo. Changes are deployed to the live site.</p>
      </div>

      {status && (
        <div className={`status-banner ${status.type}`}>
          {status.type === 'success' ? '\u2713' : '\u2717'} {status.message}
        </div>
      )}

      {/* Portrait Photo */}
      <div className="card">
        <h3>Portrait Photo</h3>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
          <div style={{ flex: '0 0 200px' }}>
            {photoPreview && (
              <img
                src={newPhotoPath ? `file://${newPhotoPath}` : `https://archive-35.com/${photoPreview}`}
                alt="Portrait preview"
                style={{ width: '200px', height: '200px', objectFit: 'cover', borderRadius: '8px', border: '2px solid #333' }}
              />
            )}
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ color: '#999', fontSize: '0.9em', marginBottom: '12px' }}>
              Current: {photoPath}
            </p>
            <button className="btn btn-secondary" onClick={handleSelectPhoto}>
              Choose New Photo
            </button>
            {newPhotoPath && (
              <p style={{ color: '#c9a96e', marginTop: '8px', fontSize: '0.85em' }}>
                New photo selected (will be deployed on save)
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Short Bio */}
      <div className="card">
        <h3>The Short Version</h3>
        <textarea
          value={shortBio}
          onChange={(e) => setShortBio(e.target.value)}
          rows={3}
          style={{ width: '100%', background: '#1a1a2e', color: '#e0e0e0', border: '1px solid #333', borderRadius: '6px', padding: '12px', fontSize: '0.95em', fontFamily: 'inherit', resize: 'vertical' }}
        />
      </div>

      {/* Long Bio */}
      <div className="card">
        <h3>The Longer Story</h3>
        <p style={{ color: '#999', fontSize: '0.85em', marginBottom: '12px' }}>Each text area is one paragraph on the website.</p>
        {longBio.map((para, i) => (
          <div key={i} style={{ marginBottom: '12px', display: 'flex', gap: '8px' }}>
            <textarea
              value={para}
              onChange={(e) => updateLongBioParagraph(i, e.target.value)}
              rows={3}
              style={{ flex: 1, background: '#1a1a2e', color: '#e0e0e0', border: '1px solid #333', borderRadius: '6px', padding: '12px', fontSize: '0.95em', fontFamily: 'inherit', resize: 'vertical' }}
            />
            <button
              onClick={() => removeLongBioParagraph(i)}
              style={{ background: 'transparent', border: '1px solid #555', color: '#999', borderRadius: '6px', padding: '0 10px', cursor: 'pointer', fontSize: '1.1em' }}
              title="Remove paragraph"
            >
              \u2715
            </button>
          </div>
        ))}
        <button className="btn btn-secondary" onClick={addLongBioParagraph} style={{ marginTop: '4px' }}>
          + Add Paragraph
        </button>
      </div>

      {/* Artist Quote */}
      <div className="card">
        <h3>Artist Statement</h3>
        <textarea
          value={artistQuote}
          onChange={(e) => setArtistQuote(e.target.value)}
          rows={3}
          style={{ width: '100%', background: '#1a1a2e', color: '#e0e0e0', border: '1px solid #333', borderRadius: '6px', padding: '12px', fontSize: '0.95em', fontFamily: 'inherit', fontStyle: 'italic', resize: 'vertical' }}
        />
      </div>

      {/* Prints Info */}
      <div className="card">
        <h3>About the Prints</h3>
        <p style={{ color: '#999', fontSize: '0.85em', marginBottom: '12px' }}>Each text area is one paragraph. HTML links are allowed.</p>
        {printsInfo.map((para, i) => (
          <div key={i} style={{ marginBottom: '12px', display: 'flex', gap: '8px' }}>
            <textarea
              value={para}
              onChange={(e) => updatePrintsInfoParagraph(i, e.target.value)}
              rows={2}
              style={{ flex: 1, background: '#1a1a2e', color: '#e0e0e0', border: '1px solid #333', borderRadius: '6px', padding: '12px', fontSize: '0.95em', fontFamily: 'inherit', resize: 'vertical' }}
            />
            <button
              onClick={() => removePrintsInfoParagraph(i)}
              style={{ background: 'transparent', border: '1px solid #555', color: '#999', borderRadius: '6px', padding: '0 10px', cursor: 'pointer', fontSize: '1.1em' }}
              title="Remove paragraph"
            >
              \u2715
            </button>
          </div>
        ))}
        <button className="btn btn-secondary" onClick={addPrintsInfoParagraph} style={{ marginTop: '4px' }}>
          + Add Paragraph
        </button>
      </div>

      {/* Deploy Progress */}
      {deploySteps.length > 0 && (
        <div className="card">
          <h3>Deploy Progress</h3>
          {deploySteps.map((step, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', borderBottom: '1px solid #222' }}>
              <span style={{ width: '20px', textAlign: 'center' }}>
                {step.status === 'ok' ? '\u2713' : step.status === 'error' ? '\u2717' : step.status === 'running' ? '\u25CF' : '\u25CB'}
              </span>
              <span style={{ color: step.status === 'error' ? '#ff6b6b' : step.status === 'ok' ? '#51cf66' : '#e0e0e0' }}>
                {step.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '16px', marginBottom: '40px' }}>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ minWidth: '180px' }}
        >
          {saving ? 'Deploying...' : 'Save & Deploy'}
        </button>
        <button className="btn btn-secondary" onClick={openAboutPage}>
          View Live Page
        </button>
        <button className="btn btn-secondary" onClick={loadContent}>
          Reload
        </button>
      </div>
    </div>
  );
}

export default AboutEditor;
