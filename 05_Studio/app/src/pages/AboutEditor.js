import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

function AboutEditor() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [shortBio, setShortBio] = useState('');
  const [longBioText, setLongBioText] = useState('');
  const [artistQuote, setArtistQuote] = useState('');
  const [printsInfoText, setPrintsInfoText] = useState('');
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
          // Join array paragraphs into single text with blank line separators
          setLongBioText(Array.isArray(data.longBio) ? data.longBio.join('\n\n') : (data.longBio || ''));
          setArtistQuote(data.artistQuote || '');
          setPrintsInfoText(Array.isArray(data.printsInfo) ? data.printsInfo.join('\n\n') : (data.printsInfo || ''));
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
        setPhotoPreview(result.filePath);
      }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    setDeploySteps([]);
    try {
      // Split text back into paragraph arrays (split on double newlines)
      const longBio = longBioText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
      const printsInfo = printsInfoText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

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

  const openAboutPage = () => {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal('https://archive-35.com/about.html');
    }
  };

  const textareaStyle = {
    width: '100%',
    background: '#1a1a2e',
    color: '#e0e0e0',
    border: '1px solid #333',
    borderRadius: '6px',
    padding: '12px',
    fontSize: '0.95em',
    fontFamily: 'inherit',
    resize: 'vertical',
    lineHeight: '1.6',
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
          {status.type === 'success' ? String.fromCharCode(10003) : String.fromCharCode(10007)} {status.message}
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
        <p style={{ color: '#999', fontSize: '0.85em', marginBottom: '8px' }}>One-liner intro shown at the top of the about page.</p>
        <textarea
          value={shortBio}
          onChange={(e) => setShortBio(e.target.value)}
          rows={2}
          style={textareaStyle}
        />
      </div>

      {/* Long Bio */}
      <div className="card">
        <h3>The Longer Story</h3>
        <p style={{ color: '#999', fontSize: '0.85em', marginBottom: '8px' }}>Your full bio. Separate paragraphs with a blank line.</p>
        <textarea
          value={longBioText}
          onChange={(e) => setLongBioText(e.target.value)}
          rows={16}
          style={textareaStyle}
        />
      </div>

      {/* Artist Quote */}
      <div className="card">
        <h3>Artist Statement</h3>
        <p style={{ color: '#999', fontSize: '0.85em', marginBottom: '8px' }}>Displayed as a quote block on the about page.</p>
        <textarea
          value={artistQuote}
          onChange={(e) => setArtistQuote(e.target.value)}
          rows={3}
          style={{ ...textareaStyle, fontStyle: 'italic' }}
        />
      </div>

      {/* Prints Info */}
      <div className="card">
        <h3>About the Prints</h3>
        <p style={{ color: '#999', fontSize: '0.85em', marginBottom: '8px' }}>Separate paragraphs with a blank line. HTML links are allowed.</p>
        <textarea
          value={printsInfoText}
          onChange={(e) => setPrintsInfoText(e.target.value)}
          rows={6}
          style={textareaStyle}
        />
      </div>

      {/* Deploy Progress */}
      {deploySteps.length > 0 && (
        <div className="card">
          <h3>Deploy Progress</h3>
          {deploySteps.map((step, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', borderBottom: '1px solid #222' }}>
              <span style={{ width: '20px', textAlign: 'center' }}>
                {step.status === 'ok' ? String.fromCharCode(10003) : step.status === 'error' ? String.fromCharCode(10007) : step.status === 'running' ? String.fromCharCode(9679) : String.fromCharCode(9675)}
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
