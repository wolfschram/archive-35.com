import React, { useState, useEffect } from 'react';
import '../styles/Pages.css';

function Analytics() {
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [browserMode, setBrowserMode] = useState(false);

  // Load analytics data on mount
  useEffect(() => {
    loadAnalyticsData();
  }, []);

  const loadAnalyticsData = async () => {
    try {
      setLoading(true);

      // Check if Electron API is available (not in browser dev mode)
      if (window.electronAPI) {
        setBrowserMode(false);
        const data = await window.electronAPI.getAnalyticsData();
        setAnalyticsData(data);
      } else {
        // Fallback for browser dev mode
        setBrowserMode(true);
        setAnalyticsData(null);
      }
    } catch (err) {
      console.error('Failed to load analytics:', err);
      setAnalyticsData({
        ga4: { configured: false, error: err.message },
        cloudflare: { configured: false, error: err.message },
        stripe: { configured: false, error: err.message }
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAnalyticsData();
    setRefreshing(false);
  };

  const openGa4Dashboard = async () => {
    if (window.electronAPI) {
      // In Electron - use shell.openExternal via IPC
      await window.electronAPI.openExternal('https://analytics.google.com/analytics/web/#/p/523662516/reports');
    } else {
      // In browser - open in new tab
      window.open('https://analytics.google.com/analytics/web/#/p/523662516/reports', '_blank');
    }
  };

  const openCloudflareAnalytics = async () => {
    if (window.electronAPI) {
      // In Electron
      await window.electronAPI.openExternal('https://dash.cloudflare.com/');
    } else {
      // In browser
      window.open('https://dash.cloudflare.com/', '_blank');
    }
  };

  const openStripeDashboard = async () => {
    if (window.electronAPI) {
      // In Electron
      await window.electronAPI.openExternal('https://dashboard.stripe.com/');
    } else {
      // In browser
      window.open('https://dashboard.stripe.com/', '_blank');
    }
  };

  const getStatusDot = (configured, hasData = false, hasError = false) => {
    if (hasError) return 'error';
    if (!configured) return 'inactive';
    if (!hasData) return 'pending';
    return 'active';
  };

  const getStatusText = (configured, hasData = false, error = null) => {
    if (error) return error;
    if (!configured) return 'Not configured';
    if (!hasData) return 'Connected — no data yet';
    return 'Live';
  };

  if (loading) {
    return (
      <div className="page">
        <header className="page-header">
          <h2>Analytics</h2>
          <p className="page-subtitle">Track performance across all channels</p>
        </header>
        <div className="loading">Loading analytics data...</div>
      </div>
    );
  }

  if (browserMode) {
    return (
      <div className="page">
        <header className="page-header">
          <h2>Analytics</h2>
          <p className="page-subtitle">Track performance across all channels</p>
        </header>
        <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
          <p>Run in Electron for live data. Browser mode does not have access to analytics APIs.</p>
        </div>
      </div>
    );
  }

  const ga4 = analyticsData?.ga4 || {};
  const cloudflare = analyticsData?.cloudflare || {};
  const stripe = analyticsData?.stripe || {};

  return (
    <div className="page">
      <header className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>Analytics</h2>
            <p className="page-subtitle">Track performance across all channels</p>
          </div>
          <button
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : '⟳ Refresh'}
          </button>
        </div>
      </header>

      {/* GA4 Configuration Card */}
      <div className="analytics-config-card">
        <div className="analytics-header">
          <h3>Google Analytics 4 Status</h3>
          <span className={`analytics-status-dot ${getStatusDot(ga4.configured, ga4.error)}`}></span>
        </div>
        <div className="analytics-details">
          <div className="analytics-detail-row">
            <span className="analytics-label">Measurement ID:</span>
            <span className="analytics-value">{ga4.measurementId || '—'}</span>
          </div>
          <div className="analytics-detail-row">
            <span className="analytics-label">Property ID:</span>
            <span className="analytics-value">{ga4.propertyId || '—'}</span>
          </div>
          <p className="analytics-message">{ga4.message || 'GA4 Data API requires Google Cloud service account — set up in Settings'}</p>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="card-grid">
        {/* Website Traffic Card */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3>Website Traffic</h3>
            <span className={`analytics-status-dot ${getStatusDot(cloudflare.configured, cloudflare.uniqueVisitors > 0, !!cloudflare.error)}`}></span>
          </div>
          <div className="stat-number">
            {cloudflare.configured ? (cloudflare.uniqueVisitors || 0).toLocaleString() : '—'}
          </div>
          <p>Unique visitors (7 days)</p>
          <span className="card-note">
            {getStatusText(cloudflare.configured, cloudflare.uniqueVisitors > 0, cloudflare.error)}
          </span>
        </div>

        {/* Page Views Card */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3>Page Views</h3>
            <span className={`analytics-status-dot ${getStatusDot(cloudflare.configured, cloudflare.pageViews > 0, !!cloudflare.error)}`}></span>
          </div>
          <div className="stat-number">
            {cloudflare.configured ? (cloudflare.pageViews || 0).toLocaleString() : '—'}
          </div>
          <p>Total page views (7 days)</p>
          <span className="card-note">
            {getStatusText(cloudflare.configured, cloudflare.pageViews > 0, cloudflare.error)}
          </span>
        </div>

        {/* Top Pages Card */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3>Top Pages</h3>
            <span className={`analytics-status-dot ${getStatusDot(cloudflare.configured, cloudflare.topPages?.length > 0, !!cloudflare.error)}`}></span>
          </div>
          {cloudflare.configured && cloudflare.topPages?.length > 0 ? (
            <div style={{ fontSize: '13px', color: '#aaa', lineHeight: '1.6' }}>
              {cloudflare.topPages.slice(0, 3).map((page, idx) => (
                <div key={idx} style={{ marginBottom: '6px' }}>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {page.path}
                  </div>
                  <div style={{ fontSize: '11px', color: '#888' }}>{page.views} views</div>
                </div>
              ))}
            </div>
          ) : (
            <p>Most visited pages</p>
          )}
          <span className="card-note">
            {getStatusText(cloudflare.configured, cloudflare.topPages?.length > 0, cloudflare.error)}
          </span>
        </div>

        {/* Traffic Sources Card */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3>Traffic Sources</h3>
            <span className={`analytics-status-dot ${getStatusDot(cloudflare.configured, cloudflare.topReferrers?.length > 0, !!cloudflare.error)}`}></span>
          </div>
          {cloudflare.configured && cloudflare.topReferrers?.length > 0 ? (
            <div style={{ fontSize: '13px', color: '#aaa', lineHeight: '1.6' }}>
              {cloudflare.topReferrers.slice(0, 3).map((referrer, idx) => (
                <div key={idx} style={{ marginBottom: '6px' }}>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {referrer.source}
                  </div>
                  <div style={{ fontSize: '11px', color: '#888' }}>{referrer.visits} visits</div>
                </div>
              ))}
            </div>
          ) : (
            <p>Where visitors come from</p>
          )}
          <span className="card-note">
            {getStatusText(cloudflare.configured, cloudflare.topReferrers?.length > 0, cloudflare.error)}
          </span>
        </div>

        {/* Sales Card */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3>Sales</h3>
            <span className={`analytics-status-dot ${getStatusDot(stripe.configured, stripe.revenue > 0, !!stripe.error)}`}></span>
          </div>
          <div className="stat-number">
            {stripe.configured ? `$${stripe.revenue?.toFixed(2) || '0.00'}` : '$0.00'}
          </div>
          <p>Revenue (30 days)</p>
          <div style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
            <div>{stripe.orderCount || 0} orders</div>
            <div>Avg: ${stripe.averageOrder?.toFixed(2) || '0.00'}</div>
          </div>
          <span className="card-note">
            {getStatusText(stripe.configured, stripe.revenue > 0, stripe.error)}
          </span>
        </div>
      </div>

      {/* Quick Links Row */}
      <div className="quick-links-row">
        <h3 style={{ marginBottom: '16px' }}>Quick Links</h3>
        <div className="button-group">
          <button
            className="btn btn-secondary"
            onClick={openGa4Dashboard}
            disabled={!ga4.configured}
          >
            📊 GA4 Dashboard
          </button>
          <button
            className="btn btn-secondary"
            onClick={openCloudflareAnalytics}
          >
            ☁️ Cloudflare Analytics
          </button>
          <button
            className="btn btn-secondary"
            onClick={openStripeDashboard}
          >
            💳 Stripe Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

export default Analytics;
