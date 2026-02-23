import React, { useState, useEffect, useCallback } from 'react';
import useAgentApi from '../hooks/useAgentApi';

/**
 * AgentPinterest — Pinterest board/pin management, status, and publishing.
 *
 * Shows connection status, boards, pins on each board, and supports
 * creating/deleting pins. Trial tier note is displayed prominently.
 */
function AgentPinterest() {
  const { get, post, del, loading, error, setError } = useAgentApi();
  const [status, setStatus] = useState(null);
  const [user, setUser] = useState(null);
  const [boards, setBoards] = useState([]);
  const [selectedBoard, setSelectedBoard] = useState(null);
  const [pins, setPins] = useState([]);
  const [pinsBookmark, setPinsBookmark] = useState('');
  const [selectedPins, setSelectedPins] = useState(new Set());
  const [actionMsg, setActionMsg] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [creatingBoard, setCreatingBoard] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const [statusData, userData] = await Promise.all([
        get('/pinterest/status'),
        get('/pinterest/user').catch(() => null),
      ]);
      setStatus(statusData);
      setUser(userData);
    } catch { /* error shown via hook */ }
  }, []);

  const loadBoards = useCallback(async () => {
    try {
      const data = await get('/pinterest/boards');
      setBoards(data?.items || []);
      // Auto-select first board
      if (!selectedBoard && data?.items?.length > 0) {
        setSelectedBoard(data.items[0].id);
      }
    } catch { /* error shown via hook */ }
  }, [selectedBoard]);

  const loadPins = useCallback(async (boardId) => {
    if (!boardId) return;
    try {
      const data = await get(`/pinterest/boards/${boardId}/pins?page_size=50`);
      setPins(data?.items || []);
      setPinsBookmark(data?.bookmark || '');
      setSelectedPins(new Set());
    } catch { /* error shown via hook */ }
  }, []);

  useEffect(() => {
    loadStatus();
    loadBoards();
  }, []);

  useEffect(() => {
    if (selectedBoard) loadPins(selectedBoard);
  }, [selectedBoard]);

  const handleDeleteSelected = async () => {
    if (selectedPins.size === 0) return;
    if (!window.confirm(`Delete ${selectedPins.size} pin(s)? This cannot be undone.`)) return;

    setDeleting(true);
    setActionMsg(null);
    try {
      const result = await post('/pinterest/pins/delete-batch', {
        pin_ids: Array.from(selectedPins),
      });
      setActionMsg({
        type: result.deleted > 0 ? 'success' : 'error',
        text: `Deleted ${result.deleted}/${result.total} pins`,
      });
      setSelectedPins(new Set());
      loadPins(selectedBoard);
    } catch (err) {
      setActionMsg({ type: 'error', text: `Delete failed: ${err.message}` });
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteAll = async () => {
    if (pins.length === 0) return;
    if (!window.confirm(`DELETE ALL ${pins.length} pins on this board? This cannot be undone!`)) return;

    setDeleting(true);
    setActionMsg(null);
    try {
      const allIds = pins.map(p => p.id);
      const result = await post('/pinterest/pins/delete-batch', { pin_ids: allIds });
      setActionMsg({
        type: result.deleted > 0 ? 'success' : 'error',
        text: `Deleted ${result.deleted}/${result.total} pins`,
      });
      setSelectedPins(new Set());
      loadPins(selectedBoard);
    } catch (err) {
      setActionMsg({ type: 'error', text: `Delete all failed: ${err.message}` });
    } finally {
      setDeleting(false);
    }
  };

  const handleCreateBoard = async () => {
    if (!newBoardName.trim()) return;
    setCreatingBoard(true);
    try {
      await post('/pinterest/boards/create', { name: newBoardName.trim() });
      setNewBoardName('');
      setActionMsg({ type: 'success', text: `Board "${newBoardName}" created` });
      loadBoards();
    } catch (err) {
      setActionMsg({ type: 'error', text: `Create board failed: ${err.message}` });
    } finally {
      setCreatingBoard(false);
    }
  };

  const togglePin = (pinId) => {
    setSelectedPins(prev => {
      const next = new Set(prev);
      if (next.has(pinId)) next.delete(pinId); else next.add(pinId);
      return next;
    });
  };

  const toggleAllPins = () => {
    if (selectedPins.size === pins.length) {
      setSelectedPins(new Set());
    } else {
      setSelectedPins(new Set(pins.map(p => p.id)));
    }
  };

  const isConnected = status?.configured && !status?.error;
  const selectedBoardObj = boards.find(b => b.id === selectedBoard);

  return (
    <div className="page">
      <header className="page-header">
        <h2>Pinterest</h2>
        <p className="page-subtitle">
          Board management, pin publishing, and analytics
        </p>
      </header>

      {/* Trial tier warning */}
      <div style={{
        padding: '12px 16px',
        background: 'rgba(234, 179, 8, 0.08)',
        border: '1px solid rgba(234, 179, 8, 0.3)',
        borderRadius: '8px',
        color: '#eab308',
        fontSize: '13px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span style={{ fontSize: '18px' }}>{'⚠️'}</span>
        <span>
          <strong>Trial Tier</strong> — Pins created via API are only visible to you (the creator).
          Standard access upgrade is pending. Useful for testing the full pipeline.
        </span>
      </div>

      {/* Action message toast */}
      {actionMsg && (
        <div style={{
          marginBottom: '16px', padding: '10px 16px',
          background: actionMsg.type === 'success' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)',
          border: `1px solid ${actionMsg.type === 'success' ? 'var(--success)' : 'var(--danger)'}`,
          borderRadius: 'var(--radius-sm)',
          color: actionMsg.type === 'success' ? 'var(--success)' : 'var(--danger)',
          fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{actionMsg.text}</span>
          <span onClick={() => setActionMsg(null)} style={{ cursor: 'pointer', fontSize: '16px' }}>×</span>
        </div>
      )}

      {/* Status Cards */}
      <div className="card-grid" style={{ marginBottom: '24px' }}>
        <div className="glass-card">
          <h3>{'📡'} Connection</h3>
          <div style={{
            fontSize: '36px', fontWeight: 600,
            color: isConnected ? 'var(--success, #22c55e)' : 'var(--error, #ef4444)',
          }}>
            {isConnected ? 'ONLINE' : 'OFFLINE'}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {user?.username ? `@${user.username}` : (status?.error || 'Checking...')}
          </div>
        </div>

        <div className="glass-card">
          <h3>{'📌'} Boards</h3>
          <div style={{ fontSize: '36px', fontWeight: 600, color: 'var(--accent)' }}>
            {boards.length}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Pinterest boards
          </div>
        </div>

        <div className="glass-card">
          <h3>{'🖼️'} Pins</h3>
          <div style={{ fontSize: '36px', fontWeight: 600, color: 'var(--accent)' }}>
            {pins.length}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            On selected board
          </div>
        </div>

        <div className="glass-card">
          <h3>{'🔑'} Token</h3>
          <div style={{
            fontSize: '18px', fontWeight: 600,
            color: isConnected ? 'var(--success, #22c55e)' : 'var(--error, #ef4444)',
          }}>
            {isConnected ? 'Valid' : 'Invalid'}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Expires: {status?.token_expires || 'unknown'}
          </div>
        </div>
      </div>

      {/* Board Selector + Create */}
      <div className="glass-card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ margin: 0 }}>Boards</h3>
          <button
            onClick={() => { loadBoards(); if (selectedBoard) loadPins(selectedBoard); }}
            disabled={loading}
            style={{
              padding: '4px 12px', fontSize: '12px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--glass-border)',
              borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>

        {/* Board tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
          {boards.map(board => (
            <button
              key={board.id}
              onClick={() => setSelectedBoard(board.id)}
              style={{
                padding: '8px 16px', fontSize: '13px',
                background: selectedBoard === board.id ? 'rgba(212, 165, 116, 0.15)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${selectedBoard === board.id ? 'var(--accent)' : 'var(--glass-border)'}`,
                borderRadius: '8px',
                color: selectedBoard === board.id ? 'var(--accent)' : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              {board.name}
              {board.pin_count != null && (
                <span style={{ fontSize: '11px', marginLeft: '6px', opacity: 0.7 }}>
                  ({board.pin_count})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Create board */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="New board name..."
            value={newBoardName}
            onChange={(e) => setNewBoardName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateBoard()}
            style={{
              flex: 1, padding: '8px 12px', fontSize: '13px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--glass-border)',
              borderRadius: '6px', color: 'var(--text)',
            }}
          />
          <button
            onClick={handleCreateBoard}
            disabled={creatingBoard || !newBoardName.trim()}
            style={{
              padding: '8px 16px', fontSize: '13px', fontWeight: 600,
              background: 'rgba(212, 165, 116, 0.15)',
              border: '1px solid var(--accent)',
              borderRadius: '6px', color: 'var(--accent)',
              cursor: newBoardName.trim() ? 'pointer' : 'not-allowed',
              opacity: creatingBoard || !newBoardName.trim() ? 0.5 : 1,
            }}
          >
            + Create Board
          </button>
        </div>
      </div>

      {/* Pins on selected board */}
      {selectedBoard && (
        <div className="glass-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>
              Pins{selectedBoardObj ? ` — ${selectedBoardObj.name}` : ''}
            </h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              {pins.length > 0 && (
                <>
                  <button
                    onClick={handleDeleteSelected}
                    disabled={deleting || selectedPins.size === 0}
                    style={{
                      padding: '6px 14px', fontSize: '12px', fontWeight: 600,
                      background: selectedPins.size > 0 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(128,128,128,0.08)',
                      border: `1px solid ${selectedPins.size > 0 ? 'var(--danger)' : 'var(--glass-border)'}`,
                      borderRadius: '6px',
                      color: selectedPins.size > 0 ? 'var(--danger)' : 'var(--text-muted)',
                      cursor: selectedPins.size > 0 ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Delete Selected ({selectedPins.size})
                  </button>
                  <button
                    onClick={handleDeleteAll}
                    disabled={deleting}
                    style={{
                      padding: '6px 14px', fontSize: '12px', fontWeight: 600,
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px', color: '#ef4444', cursor: 'pointer',
                    }}
                  >
                    Delete All
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Select all toggle */}
          {pins.length > 0 && (
            <label style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px', cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={pins.length > 0 && selectedPins.size === pins.length}
                onChange={toggleAllPins}
                style={{ accentColor: 'var(--accent)' }}
              />
              Select all ({pins.length})
            </label>
          )}

          {/* Pin grid */}
          {pins.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: '14px' }}>
              {loading ? 'Loading pins...' : 'No pins on this board'}
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: '12px',
            }}>
              {pins.map(pin => (
                <div
                  key={pin.id}
                  style={{
                    background: selectedPins.has(pin.id) ? 'rgba(239, 68, 68, 0.04)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${selectedPins.has(pin.id) ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: '8px',
                    overflow: 'hidden',
                  }}
                >
                  {/* Pin image */}
                  {pin.media?.images?.['150x150']?.url && (
                    <img
                      src={pin.media.images['150x150'].url}
                      alt=""
                      style={{ width: '100%', height: '160px', objectFit: 'cover' }}
                    />
                  )}

                  <div style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <input
                        type="checkbox"
                        checked={selectedPins.has(pin.id)}
                        onChange={() => togglePin(pin.id)}
                        style={{ accentColor: 'var(--danger)' }}
                      />
                      <span style={{
                        fontSize: '13px', fontWeight: 500, color: 'var(--text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        flex: 1,
                      }}>
                        {pin.title || '(untitled)'}
                      </span>
                    </div>
                    {pin.description && (
                      <div style={{
                        fontSize: '12px', color: 'var(--text-muted)',
                        lineHeight: 1.4, maxHeight: '40px', overflow: 'hidden',
                        marginBottom: '6px',
                      }}>
                        {pin.description.length > 100
                          ? pin.description.substring(0, 100) + '...'
                          : pin.description}
                      </div>
                    )}
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      ID: {pin.id}
                      {pin.created_at && ` · ${new Date(pin.created_at).toLocaleDateString()}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          marginTop: '16px', padding: '12px',
          background: 'rgba(248, 113, 113, 0.1)',
          border: '1px solid var(--danger)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--danger)', fontSize: '13px',
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default AgentPinterest;
