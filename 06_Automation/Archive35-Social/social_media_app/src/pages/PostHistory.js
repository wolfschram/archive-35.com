import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

function PostHistory() {
  const [posts, setPosts] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [platforms, setPlatforms] = useState({});

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    if (!window.electronAPI) return;
    const [history, outputList, platDefs] = await Promise.all([
      window.electronAPI.getPostHistory(),
      window.electronAPI.listOutputs(),
      window.electronAPI.getPlatforms(),
    ]);
    setPosts(history.posts || []);
    setOutputs(outputList.files || []);
    setPlatforms(platDefs || {});
  }

  async function markAsPosted(file, platformKey) {
    const platform = platforms[platformKey];
    const post = {
      id: Date.now(),
      filename: file.filename,
      videoPath: file.path,
      platform: platformKey,
      platformLabel: platform?.label || platformKey,
      date: new Date().toISOString(),
      gallery: file.postContent?.gallery || file.folder || 'unknown',
      caption: file.postContent?.caption || '',
      hashtags: file.postContent?.hashtagString || '',
    };

    const updated = [post, ...posts];
    setPosts(updated);
    await window.electronAPI.savePostHistory({ posts: updated });
  }

  const totalPosts = posts.length;
  const platformCounts = posts.reduce((acc, p) => {
    acc[p.platform] = (acc[p.platform] || 0) + 1;
    return acc;
  }, {});

  const platformKeys = Object.keys(platforms);

  return (
    <div className="page">
      <header className="page-header">
        <h2>Post History</h2>
        <p className="page-subtitle">{totalPosts} posts tracked across {Object.keys(platformCounts).length} platforms</p>
      </header>

      <div className="card-grid">
        {/* Stats by platform */}
        <div className="glass-card full-width">
          <h3>Posts by Platform</h3>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {platformKeys.map(key => (
              <div key={key} style={{ textAlign: 'center', minWidth: 80 }}>
                <div className="stat-number" style={{ fontSize: 28 }}>{platformCounts[key] || 0}</div>
                <span className="stat-label" style={{ fontSize: 10 }}>
                  {platforms[key]?.label || key}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Log a post manually */}
        <div className="glass-card full-width">
          <h3>Log a Post</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            After manually posting a video, click the platform button to track it.
          </p>

          {outputs.length === 0 ? (
            <div className="empty-state">No videos to log. Render some videos first.</div>
          ) : (
            <div className="queue-list">
              {outputs.slice(0, 8).map((file, i) => (
                <div key={i} className="queue-item" style={{ flexWrap: 'wrap' }}>
                  <div className="queue-item-info" style={{ flex: 1, minWidth: 150 }}>
                    <div className="queue-item-title">{file.filename}</div>
                    <div className="queue-item-meta">
                      {new Date(file.created).toLocaleDateString()}
                      {file.postContent?.platformLabel && ` \u00B7 ${file.postContent.platformLabel}`}
                    </div>
                  </div>
                  <div className="button-group" style={{ margin: 0, flexWrap: 'wrap', gap: 4 }}>
                    {platformKeys.map(pk => (
                      <button key={pk} className="btn btn-secondary"
                        style={{ padding: '3px 8px', fontSize: 10 }}
                        onClick={() => markAsPosted(file, pk)}>
                        {platforms[pk]?.label?.split(' ')[0] || pk}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent posts */}
        <div className="glass-card full-width">
          <h3>Recent Activity</h3>
          {posts.length === 0 ? (
            <div className="empty-state">No posts logged yet.</div>
          ) : (
            <div className="queue-list">
              {posts.slice(0, 30).map((post, i) => (
                <div key={i} className="queue-item">
                  <div className="queue-item-info" style={{ flex: 1 }}>
                    <div className="queue-item-title">
                      {post.gallery || post.filename}
                    </div>
                    <div className="queue-item-meta">
                      Posted to <strong>{post.platformLabel || post.platform}</strong> &middot; {new Date(post.date).toLocaleDateString()}
                    </div>
                    {post.caption && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, maxWidth: 400 }}>
                        {post.caption.substring(0, 80)}{post.caption.length > 80 ? '...' : ''}
                      </div>
                    )}
                  </div>
                  <span className="status-badge online" style={{ fontSize: 10 }}>
                    {post.platformLabel?.split(' ')[0] || post.platform}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PostHistory;
