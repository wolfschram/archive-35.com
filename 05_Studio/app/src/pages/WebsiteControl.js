import React, { useState, useEffect, useRef } from 'react';
import '../styles/Pages.css';

function WebsiteControl() {
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState(null);
  const [progress, setProgress] = useState(null);
  const [deployResult, setDeployResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const cleanupRef = useRef(null);
  const deployTimeoutRef = useRef(null);
  const deployTimerRef = useRef(null);
  const [deployCountdown, setDeployCountdown] = useState(null);

  // R2 batch upload state
  const [r2Uploading, setR2Uploading] = useState(false);
  const [r2Progress, setR2Progress] = useState(null);
  const [r2Result, setR2Result] = useState(null);
  const r2CleanupRef = useRef(null);

  // Reconciliation state
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState(null);

  // Service status monitoring — now includes 'dependencies' and supports checks[] array
  const serviceList = ['github', 'cloudflare', 'stripe', 'r2', 'c2pa', 'anthropic', 'dependencies'];
  const initialServiceState = {};
  serviceList.forEach(s => { initialServiceState[s] = { status: 'idle', message: 'Not checked', lastChecked: null, testing: false, checks: [] }; });
  const [serviceStatuses, setServiceStatuses] = useState(initialServiceState);
  const [expandedService, setExpandedService] = useState(null);

  const initialStages = {
    scan: { complete: false, active: false },
    images: { complete: false, active: false },
    c2pa: { complete: false, active: false },
    r2: { complete: false, active: false },
    data: { complete: false, active: false },
    git: { complete: false, active: false },
    push: { complete: false, active: false },
    verify: { complete: false, active: false },
    done: { complete: false, active: false }
  };

  const [deployStages, setDeployStages] = useState(initialStages);

  // Check deploy status on mount
  useEffect(() => {
    checkStatus();
    return () => {
      if (cleanupRef.current) cleanupRef.current();
      if (deployTimeoutRef.current) clearTimeout(deployTimeoutRef.current);
      if (deployTimerRef.current) clearInterval(deployTimerRef.current);
    };
  }, []);

  const checkStatus = async () => {
    setLoading(true);
    try {
      if (window.electronAPI?.checkDeployStatus) {
        const status = await window.electronAPI.checkDeployStatus();
        setDeployStatus(status);
      }
    } catch (err) {
      console.error('Failed to check deploy status:', err);
    }
    setLoading(false);
  };

  // === Reset functions — always available ===
  const resetDeploy = () => {
    if (deployTimeoutRef.current) clearTimeout(deployTimeoutRef.current);
    if (deployTimerRef.current) clearInterval(deployTimerRef.current);
    deployTimeoutRef.current = null;
    deployTimerRef.current = null;
    setDeployResult(null);
    setProgress(null);
    setDeploying(false);
    setDeployStages({...initialStages});
    setDeployCountdown(null);
    checkStatus();
  };

  const resetR2 = () => {
    setR2Result(null);
    setR2Progress(null);
    setR2Uploading(false);
  };

  const resetReconcile = () => {
    setReconcileResult(null);
  };

  // === Service health checks ===
  const checkServiceStatus = async (service) => {
    setServiceStatuses(prev => ({
      ...prev,
      [service]: { ...prev[service], testing: true }
    }));

    try {
      if (window.electronAPI?.checkServiceStatus) {
        const result = await window.electronAPI.checkServiceStatus(service);
        setServiceStatuses(prev => ({
          ...prev,
          [service]: {
            status: result.status === 'ok' ? 'ok' : result.status === 'warning' ? 'warning' : 'error',
            message: result.message || 'Unknown status',
            lastChecked: new Date().toLocaleTimeString(),
            testing: false,
            checks: result.checks || []
          }
        }));
      }
    } catch (err) {
      setServiceStatuses(prev => ({
        ...prev,
        [service]: {
          status: 'error',
          message: `Check failed: ${err.message}`,
          lastChecked: new Date().toLocaleTimeString(),
          testing: false,
          checks: []
        }
      }));
    }
  };

  const checkAllServices = async () => {
    // Mark all as testing
    const testingState = {};
    serviceList.forEach(key => {
      testingState[key] = { ...serviceStatuses[key], testing: true };
    });
    setServiceStatuses(testingState);

    // Fire all checks in PARALLEL
    const promises = serviceList.map(async (service) => {
      try {
        const result = await window.electronAPI.checkServiceStatus(service);
        return [service, {
          status: result.status === 'ok' ? 'ok' : result.status === 'warning' ? 'warning' : 'error',
          message: result.message || 'Unknown status',
          lastChecked: new Date().toLocaleTimeString(),
          testing: false,
          checks: result.checks || []
        }];
      } catch (err) {
        return [service, {
          status: 'error',
          message: `Check failed: ${err.message}`,
          lastChecked: new Date().toLocaleTimeString(),
          testing: false,
          checks: []
        }];
      }
    });

    const results = await Promise.allSettled(promises);
    const newStatuses = { ...testingState };
    for (const item of results) {
      if (item.status === 'fulfilled') {
        const [svc, data] = item.value;
        newStatuses[svc] = data;
      }
    }
    setServiceStatuses(newStatuses);
  };

  // === Deploy handler with 3-minute timeout ===
  const DEPLOY_TIMEOUT_SECONDS = 180;

  const handleDeploy = async () => {
    setDeploying(true);
    setProgress(null);
    setDeployResult(null);
    setDeployStages({...initialStages});
    setDeployCountdown(DEPLOY_TIMEOUT_SECONDS);

    // Start countdown timer (ticks every second)
    if (deployTimerRef.current) clearInterval(deployTimerRef.current);
    const startTime = Date.now();
    deployTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = Math.max(0, DEPLOY_TIMEOUT_SECONDS - elapsed);
      setDeployCountdown(remaining);
    }, 1000);

    if (window.electronAPI?.onDeployProgress) {
      cleanupRef.current = window.electronAPI.onDeployProgress((data) => {
        setProgress(data);
        if (data.step) {
          setDeployStages(prev => {
            const newStages = { ...prev };
            const stageOrder = ['scan', 'images', 'c2pa', 'r2', 'data', 'git', 'push', 'verify', 'done'];
            const currentIndex = stageOrder.indexOf(data.step);
            stageOrder.forEach((stage, idx) => {
              if (idx < currentIndex) {
                newStages[stage] = { complete: true, active: false };
              } else if (idx === currentIndex) {
                newStages[stage] = { complete: false, active: true };
              } else {
                newStages[stage] = { complete: false, active: false };
              }
            });
            return newStages;
          });
        }
      });
    }

    // Race: deploy vs 3-minute timeout
    let timedOut = false;
    const timeoutPromise = new Promise((_, reject) => {
      deployTimeoutRef.current = setTimeout(() => {
        timedOut = true;
        reject(new Error('TIMEOUT'));
      }, DEPLOY_TIMEOUT_SECONDS * 1000);
    });

    try {
      const result = await Promise.race([
        window.electronAPI.deployWebsite(),
        timeoutPromise
      ]);

      // Deploy completed before timeout — clear timer
      clearTimeout(deployTimeoutRef.current);
      clearInterval(deployTimerRef.current);
      deployTimeoutRef.current = null;
      deployTimerRef.current = null;
      setDeployCountdown(null);

      setDeployResult(result);
      if (result.success) {
        setDeployStages({
          scan: { complete: true, active: false },
          images: { complete: true, active: false },
          c2pa: { complete: true, active: false },
          r2: { complete: true, active: false },
          data: { complete: true, active: false },
          git: { complete: true, active: false },
          push: { complete: true, active: false },
          verify: { complete: true, active: false, warned: result.verified === false },
          done: { complete: true, active: false, warned: result.verified === false }
        });
      } else {
        // Mark the failed stage properly
        setDeployStages(prev => {
          const newStages = { ...prev };
          let foundActive = false;
          const stageOrder = ['scan', 'images', 'c2pa', 'r2', 'data', 'git', 'push', 'verify', 'done'];
          for (const stage of stageOrder) {
            if (newStages[stage].active) foundActive = true;
          }
          if (!foundActive) {
            const failStep = result.r2Status === 'blocked' ? 'r2' : 'scan';
            for (const stage of stageOrder) {
              const idx = stageOrder.indexOf(stage);
              const failIdx = stageOrder.indexOf(failStep);
              if (idx < failIdx) {
                newStages[stage] = { complete: true, active: false };
              } else if (idx === failIdx) {
                newStages[stage] = { complete: false, active: true };
              }
            }
          }
          return newStages;
        });
      }
      await checkStatus();
    } catch (err) {
      // Clear timers
      if (deployTimeoutRef.current) clearTimeout(deployTimeoutRef.current);
      if (deployTimerRef.current) clearInterval(deployTimerRef.current);
      deployTimeoutRef.current = null;
      deployTimerRef.current = null;
      setDeployCountdown(null);

      if (timedOut) {
        // Timeout: identify which stage was stuck
        setDeployResult({
          success: false,
          error: `Deploy timed out after ${DEPLOY_TIMEOUT_SECONDS / 60} minutes. The process stopped responding. Check the terminal for errors, then restart Studio and try again.`,
          timedOut: true
        });
        // Mark the currently active stage as the failure point
        setDeployStages(prev => {
          const newStages = { ...prev };
          const stageOrder = ['scan', 'images', 'c2pa', 'r2', 'data', 'git', 'push', 'verify', 'done'];
          let lastActiveStage = null;
          for (const stage of stageOrder) {
            if (newStages[stage].active) lastActiveStage = stage;
          }
          // If we were still in progress and timed out, mark done as failed
          if (!lastActiveStage) {
            // Nothing was active — mark done as the timeout point
            stageOrder.forEach(stage => {
              if (!newStages[stage].complete && !newStages[stage].active) {
                // First incomplete stage becomes the failure
                if (!lastActiveStage) {
                  lastActiveStage = stage;
                  newStages[stage] = { complete: false, active: true };
                }
              }
            });
          }
          return newStages;
        });
      } else {
        setDeployResult({ success: false, error: err.message });
        setDeployStages(prev => {
          const newStages = { ...prev };
          const hasActive = Object.values(newStages).some(s => s.active);
          if (!hasActive) newStages.scan = { complete: false, active: true };
          return newStages;
        });
      }
    }

    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    setDeploying(false);
  };

  // === R2 Upload handler ===
  const handleR2Upload = async () => {
    if (!window.confirm('Upload ALL portfolio originals to R2? This may take a while for large collections.')) return;
    setR2Uploading(true);
    setR2Progress(null);
    setR2Result(null);

    if (window.electronAPI?.onR2UploadProgress) {
      r2CleanupRef.current = window.electronAPI.onR2UploadProgress((data) => {
        setR2Progress(data);
      });
    }

    try {
      const result = await window.electronAPI.batchUploadR2();
      setR2Result(result);
    } catch (err) {
      setR2Result({ success: false, error: err.message });
    }

    if (r2CleanupRef.current) {
      r2CleanupRef.current();
      r2CleanupRef.current = null;
    }
    setR2Uploading(false);
  };

  // === Reconciliation handler ===
  const handleReconcile = async () => {
    setReconciling(true);
    setReconcileResult(null);
    try {
      const result = await window.electronAPI.reconcileStripeOrders({ days: 7 });
      setReconcileResult(result);
    } catch (err) {
      setReconcileResult({ success: false, message: `Error: ${err.message}`, sessions: [] });
    }
    setReconciling(false);
  };

  // === Helpers ===
  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return dateStr; }
  };

  const getServiceIcon = (service) => {
    const icons = { github: '\uD83D\uDC19', cloudflare: '\u2601\uFE0F', stripe: '\uD83D\uDCB3', r2: '\uD83D\uDCBE', c2pa: '\uD83D\uDD10', anthropic: '\uD83E\uDD16', dependencies: '\uD83D\uDD17' };
    return icons[service] || '\u2699\uFE0F';
  };

  const getServiceLabel = (service) => {
    const labels = { github: 'GitHub', cloudflare: 'Cloudflare', stripe: 'Stripe', r2: 'R2 Storage', c2pa: 'C2PA', anthropic: 'Anthropic', dependencies: 'Dependencies' };
    return labels[service] || service;
  };

  const getStatusDot = (status) => {
    if (status === 'ok') return { color: '#22c55e', symbol: '\u25CF' };
    if (status === 'warning') return { color: '#fbbf24', symbol: '\u25CF' };
    if (status === 'error') return { color: '#ef4444', symbol: '\u25CF' };
    return { color: 'rgba(255,255,255,0.3)', symbol: '\u25CB' };
  };

  const stageLabels = { scan: 'Scan', images: 'Images', c2pa: 'C2PA', r2: 'R2', data: 'Data', git: 'Git', push: 'Push', verify: 'Verify', done: 'Done' };

  // === Health indicators for card headers ===
  const getDeployHealth = () => {
    if (deploying) return { icon: '\u25C9', color: '#fbbf24', label: 'Deploying...' };
    if (deployResult && !deployResult.success && deployResult.timedOut) return { icon: '\u23F0', color: '#ef4444', label: 'Timed Out' };
    if (deployResult && !deployResult.success) return { icon: '\u2717', color: '#ef4444', label: 'Failed' };
    if (deployResult && deployResult.success) return { icon: '\u2713', color: '#22c55e', label: 'Deployed' };
    if (deployStatus?.needsDeploy) return { icon: '\u26A1', color: '#fbbf24', label: `${deployStatus.pendingPhotos} pending` };
    if (!loading && deployStatus) return { icon: '\u2713', color: '#22c55e', label: 'Up to date' };
    return { icon: '\u25CB', color: 'var(--text-muted)', label: 'Ready' };
  };

  const getR2Health = () => {
    if (r2Uploading) return { icon: '\u25C9', color: '#3b82f6', label: `Uploading ${r2Progress?.current || 0}/${r2Progress?.total || '?'}` };
    if (r2Result && !r2Result.success) return { icon: '\u2717', color: '#ef4444', label: 'Error' };
    if (r2Result && r2Result.success && r2Result.failed > 0) return { icon: '\u26A0', color: '#fbbf24', label: `${r2Result.failed} failed` };
    if (r2Result && r2Result.success) return { icon: '\u2713', color: '#22c55e', label: `${r2Result.uploaded} uploaded, ${r2Result.skipped} existed` };
    return { icon: '\u25CB', color: 'var(--text-muted)', label: 'Not checked' };
  };

  const getReconcileHealth = () => {
    if (reconciling) return { icon: '\u25C9', color: '#3b82f6', label: 'Checking...' };
    if (reconcileResult && reconcileResult.success === false) return { icon: '\u2717', color: '#ef4444', label: 'Error' };
    if (reconcileResult && reconcileResult.sessionCount === 0) return { icon: '\u2713', color: '#22c55e', label: 'All clear' };
    if (reconcileResult && reconcileResult.sessionCount > 0) return { icon: '\u26A0', color: '#fbbf24', label: `${reconcileResult.sessionCount} sessions found` };
    return { icon: '\u25CB', color: 'var(--text-muted)', label: 'Not checked' };
  };

  // Reusable card header with health badge + ALWAYS VISIBLE reset button
  const CardHeader = ({ title, health, onReset, hasState }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '12px', color: health.color, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span>{health.icon}</span> {health.label}
        </span>
        <button
          className="btn btn-secondary"
          onClick={onReset}
          disabled={!hasState}
          style={{
            padding: '2px 8px',
            fontSize: '11px',
            lineHeight: '1.4',
            opacity: hasState ? 1 : 0.3,
            cursor: hasState ? 'pointer' : 'default'
          }}
          title={hasState ? 'Reset' : 'Nothing to reset'}
        >
          {'↻'}
        </button>
      </div>
    </div>
  );

  // === Render check detail row ===
  const CheckRow = ({ check }) => {
    const dot = getStatusDot(check.status);
    return (
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '4px 0',
        fontSize: '12px',
        borderBottom: '1px solid rgba(255,255,255,0.04)'
      }}>
        <span style={{ color: dot.color, flexShrink: 0, marginTop: '1px' }}>{dot.symbol}</span>
        <span style={{ color: 'var(--text-primary)', minWidth: '120px', flexShrink: 0 }}>{check.name}</span>
        <span style={{ color: check.status === 'error' ? '#ef4444' : check.status === 'warning' ? '#fbbf24' : 'var(--text-muted)' }}>{check.detail}</span>
      </div>
    );
  };

  return (
    <div className="page">
      <header className="page-header">
        <h2>Website Control</h2>
        <p className="page-subtitle">Deploy and manage archive-35.com</p>
      </header>

      {/* ===== SERVICE HEALTH SECTION ===== */}
      <div className="status-panel-container">
        <div className="status-panel-header">
          <h3>{'⚙️'} System Health</h3>
          <button
            className="btn btn-secondary"
            onClick={checkAllServices}
            style={{ fontSize: '12px', padding: '8px 12px' }}
            disabled={Object.values(serviceStatuses).some(s => s.testing)}
          >
            {Object.values(serviceStatuses).some(s => s.testing) ? 'Testing...' : 'Run All Tests'}
          </button>
        </div>

        <div className="service-grid">
          {serviceList.map((service) => {
            const status = serviceStatuses[service];
            const dot = getStatusDot(status.status);
            const isExpanded = expandedService === service;
            const hasChecks = status.checks && status.checks.length > 0;

            return (
              <div
                key={service}
                className={`service-card service-${status.status}`}
                style={{
                  borderColor: status.status === 'ok' ? 'rgba(34, 197, 94, 0.3)' : status.status === 'warning' ? 'rgba(251, 191, 36, 0.3)' : status.status === 'error' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255,255,255,0.08)',
                  background: status.status === 'ok' ? 'rgba(34, 197, 94, 0.05)' : status.status === 'warning' ? 'rgba(251, 191, 36, 0.05)' : status.status === 'error' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(255,255,255,0.02)',
                  cursor: hasChecks ? 'pointer' : 'default',
                  gridColumn: service === 'dependencies' ? 'span 2' : undefined
                }}
                onClick={() => hasChecks && setExpandedService(isExpanded ? null : service)}
              >
                <div className="service-header">
                  <span className="service-icon">{getServiceIcon(service)}</span>
                  <span className="service-name">{getServiceLabel(service)}</span>
                </div>
                <div className="service-status">
                  <span style={{ color: dot.color, fontSize: '16px' }}>{status.testing ? '\u25C9' : dot.symbol}</span>
                </div>
                <div className="service-message" title={status.message}>
                  {status.testing ? 'Testing...' : status.message}
                </div>

                {/* Expandable check details */}
                {isExpanded && hasChecks && (
                  <div style={{
                    marginTop: '8px',
                    padding: '8px',
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: 'var(--radius-sm)',
                    borderTop: '1px solid rgba(255,255,255,0.08)'
                  }}
                  onClick={(e) => e.stopPropagation()}>
                    {status.checks.map((check, i) => (
                      <CheckRow key={i} check={check} />
                    ))}
                  </div>
                )}

                <div className="service-footer">
                  <span className="service-time">
                    {status.lastChecked ? status.lastChecked : 'Never'}
                    {hasChecks && !isExpanded ? ' \u2022 Click for details' : ''}
                  </span>
                  <button
                    className="btn-test"
                    onClick={(e) => { e.stopPropagation(); checkServiceStatus(service); }}
                    disabled={status.testing}
                  >
                    {status.testing ? '...' : 'Test'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ===== DEPLOY PIPELINE — ALWAYS VISIBLE ===== */}
      <div className="deploy-pipeline-container" style={{
        border: deployResult
          ? `1px solid ${deployResult.success ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
          : deploying
            ? '1px solid rgba(251, 191, 36, 0.3)'
            : '1px solid rgba(255, 255, 255, 0.08)',
        background: deployResult
          ? (deployResult.success ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)')
          : deploying
            ? 'rgba(251, 191, 36, 0.05)'
            : 'rgba(255, 255, 255, 0.02)',
        borderRadius: 'var(--radius-md)',
        padding: '16px 20px',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0 }}>Deploy Pipeline</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {deployResult && (
              <span style={{
                fontSize: '12px',
                color: deployResult.success ? '#22c55e' : '#ef4444',
                fontWeight: 600
              }}>
                {deployResult.success ? (deployResult.verified !== false ? '\u2713 Verified' : '\u26A0 Pushed (verify pending)') : (deployResult.timedOut ? '\u23F0 Timed Out' : '\u2717 Failed')}
                {deployResult.success && deployResult.photosPublished
                  ? ` \u2014 ${deployResult.photosPublished} photos${deployResult.imagesCopied === 0 ? ' (no changes)' : ''}`
                  : ''}
              </span>
            )}
            {deploying && !deployResult && (
              <span style={{ fontSize: '12px', color: '#fbbf24', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>{'◉'} Deploying...</span>
                {deployCountdown !== null && (
                  <span style={{
                    fontSize: '11px',
                    color: deployCountdown < 30 ? '#ef4444' : deployCountdown < 60 ? '#fbbf24' : 'var(--text-muted)',
                    fontFamily: 'monospace',
                    fontWeight: deployCountdown < 30 ? 700 : 400
                  }}>
                    {Math.floor(deployCountdown / 60)}:{String(deployCountdown % 60).padStart(2, '0')}
                  </span>
                )}
              </span>
            )}
            {!deploying && !deployResult && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Ready
              </span>
            )}
            {/* Reset button — ALWAYS VISIBLE, disabled when nothing to reset */}
            <button
              className="btn btn-secondary"
              onClick={resetDeploy}
              disabled={!deployResult && !deploying}
              style={{
                padding: '2px 8px',
                fontSize: '11px',
                lineHeight: '1.4',
                opacity: (deployResult || deploying) ? 1 : 0.3,
                cursor: (deployResult || deploying) ? 'pointer' : 'default'
              }}
              title={(deployResult || deploying) ? 'Reset pipeline' : 'Nothing to reset'}
            >
              {'↻'}
            </button>
          </div>
        </div>
        <div className="deploy-pipeline">
          {Object.entries(deployStages).map(([stage, stageData], idx) => (
            <React.Fragment key={stage}>
              <div
                className={`pipeline-stage ${stageData.active ? 'active' : ''} ${stageData.complete ? 'complete' : ''} ${stageData.warned ? 'warned' : ''} ${deployResult && !deployResult.success && stageData.active ? 'failed' : ''}`}
                title={stageLabels[stage]}
              >
                <div className="stage-content">
                  {stageData.complete ? (stageData.warned ? '\u26A0' : '\u2713') : stageData.active ? (deployResult && !deployResult.success ? '\u2717' : '\u25C9') : '\u25CB'}
                </div>
                <span className="stage-label">{stageLabels[stage]}</span>
              </div>
              {idx < Object.keys(deployStages).length - 1 && (
                <div className="pipeline-arrow">{'→'}</div>
              )}
            </React.Fragment>
          ))}
        </div>
        {/* Progress message while deploying */}
        {progress && deploying && (
          <div style={{ marginTop: '10px', color: 'var(--text-muted)', fontSize: '13px' }}>
            {progress.message}
            {progress.total > 0 && (
              <div style={{ background: 'var(--bg-tertiary)', borderRadius: '4px', height: '4px', overflow: 'hidden', marginTop: '6px' }}>
                <div style={{
                  background: 'var(--accent)',
                  height: '100%',
                  width: `${Math.round((progress.current / progress.total) * 100)}%`,
                  transition: 'width 0.3s ease'
                }} />
              </div>
            )}
          </div>
        )}
        {/* Result details after deploy */}
        {deployResult && (
          <div style={{ marginTop: '10px', fontSize: '13px' }}>
            <div style={{ color: deployResult.success ? '#22c55e' : '#ef4444' }}>
              {deployResult.success
                ? deployResult.message
                : `Error: ${deployResult.error}`}
              {deployResult.success && deployResult.imagesCopied > 0 && (
                <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
                  ({deployResult.photosPublished} photos {'·'} {deployResult.imagesCopied} image files synced)
                </span>
              )}
            </div>
            {deployResult.success && (
              <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                <span>
                  {deployResult.c2paUnsigned > 0
                    ? `\uD83D\uDD13 C2PA: ${deployResult.c2paSigned}/${deployResult.c2paSigned + deployResult.c2paUnsigned} signed`
                    : `\uD83D\uDD10 C2PA: All ${deployResult.c2paSigned} signed`}
                </span>
                <span style={{ color: deployResult.r2Status === 'ok' ? '#22c55e' : deployResult.r2Status === 'warning' ? '#fbbf24' : 'var(--text-muted)' }}>
                  {deployResult.r2Status === 'ok'
                    ? `R2: All ${deployResult.r2ObjectCount} originals verified`
                    : deployResult.r2Status === 'warning'
                      ? `R2 WARNING: ${deployResult.r2MissingCount} originals MISSING from R2!`
                      : deployResult.r2Status === 'unconfigured'
                        ? 'R2: Not configured'
                        : 'R2: Check failed'}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== ACTION CARDS GRID ===== */}
      <div className="card-grid">
        {/* Site Status */}
        <div className="glass-card">
          <h3>Site Status</h3>
          <div className="status-row">
            <span>Website</span>
            <span className="status-badge online">Live</span>
          </div>
          <div className="status-row">
            <span>HTTPS</span>
            <span className="status-badge online">Secure</span>
          </div>
          <div className="status-row">
            <span>Last Deploy</span>
            <span>{loading ? '...' : formatDate(deployStatus?.lastDeployDate)}</span>
          </div>
          <div className="status-row">
            <span>Photos on Website</span>
            <span>{loading ? '...' : deployStatus?.websitePhotoCount || 0}</span>
          </div>
          <div className="status-row">
            <span>Photos in Portfolio</span>
            <span>{loading ? '...' : deployStatus?.portfolioPhotoCount || 0}</span>
          </div>
          <div className="status-row">
            <span>Collections</span>
            <span>{loading ? '...' : deployStatus?.portfolioCollections?.length || 0}</span>
          </div>
          <a
            href="https://archive-35.com"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ marginTop: '12px' }}
          >
            Visit Site {'→'}
          </a>
        </div>

        {/* Deploy Card — ALWAYS VISIBLE */}
        <div className="glass-card">
          <CardHeader
            title="Deploy"
            health={getDeployHealth()}
            onReset={resetDeploy}
            hasState={!!(deployResult || deploying)}
          />

          {/* Status message */}
          {deployStatus?.needsDeploy && !deploying && !deployResult && (
            <div style={{
              background: 'rgba(251, 191, 36, 0.1)',
              border: '1px solid rgba(251, 191, 36, 0.3)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              marginBottom: '12px',
              fontSize: '13px'
            }}>
              <span style={{ color: '#fbbf24', fontWeight: 600 }}>
                {deployStatus.pendingPhotos} new photo{deployStatus.pendingPhotos !== 1 ? 's' : ''} ready
              </span>
              <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
                Portfolio: {deployStatus.portfolioPhotoCount} {'—'} Website: {deployStatus.websitePhotoCount}
              </span>
            </div>
          )}

          {!deployStatus?.needsDeploy && !deploying && !loading && !deployResult && (
            <div style={{
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              marginBottom: '12px',
              fontSize: '13px'
            }}>
              <span style={{ color: '#22c55e', fontWeight: 600 }}>{'✓'} Website is up to date</span>
            </div>
          )}

          {deployResult && !deploying && (
            <div style={{
              background: deployResult.success ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${deployResult.success ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              marginBottom: '12px',
              fontSize: '13px'
            }}>
              <span style={{ color: deployResult.success ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                {deployResult.success ? '\u2713 Complete \u2014 see pipeline above' : '\u2717 Failed \u2014 see pipeline above'}
              </span>
            </div>
          )}

          <button
            className="btn btn-primary btn-large"
            onClick={handleDeploy}
            disabled={deploying || loading}
            style={{ width: '100%' }}
          >
            {deploying ? 'Deploying...' : loading ? 'Checking...' : 'Deploy to Website'}
          </button>
        </div>

        {/* R2 Cloud Backup — ALWAYS VISIBLE */}
        <div className="glass-card">
          <CardHeader
            title="R2 Original Backup"
            health={getR2Health()}
            onReset={resetR2}
            hasState={!!(r2Result || r2Uploading)}
          />

          {/* Status area — always shows something */}
          {!r2Uploading && !r2Result && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              marginBottom: '12px',
              fontSize: '13px',
              color: 'var(--text-muted)'
            }}>
              Upload portfolio originals to R2 for print fulfillment. Run before deploy.
            </div>
          )}

          {r2Result && !r2Uploading && (
            <div style={{
              background: r2Result.success ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${r2Result.success ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              marginBottom: '12px',
              fontSize: '13px'
            }}>
              {r2Result.success ? (
                <div>
                  <div style={{ color: '#22c55e', fontWeight: 600 }}>Upload Complete</div>
                  <div style={{ color: 'var(--text-muted)', marginTop: '4px' }}>
                    {r2Result.uploaded} uploaded / {r2Result.skipped} already existed / {r2Result.failed} failed
                  </div>
                  {r2Result.failed > 0 && (
                    <div style={{ color: '#ef4444', marginTop: '4px' }}>
                      Failures: {r2Result.errors?.slice(0, 5).join(', ')}{r2Result.errors?.length > 5 ? ` (+${r2Result.errors.length - 5} more)` : ''}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ color: '#ef4444' }}>Error: {r2Result.error}</div>
              )}
            </div>
          )}

          {r2Uploading && (
            <div style={{
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              marginBottom: '12px'
            }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '6px' }}>
                {r2Progress?.message || 'Starting upload...'}
              </div>
              {r2Progress?.total > 0 && (
                <div style={{ background: 'var(--bg-tertiary)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                  <div style={{
                    background: '#3b82f6',
                    height: '100%',
                    width: `${Math.round((r2Progress.current / r2Progress.total) * 100)}%`,
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              )}
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={handleR2Upload}
            disabled={r2Uploading || deploying}
            style={{ width: '100%' }}
          >
            {r2Uploading ? `Uploading... ${r2Progress?.current || 0}/${r2Progress?.total || '?'}` : 'Upload All Originals to R2'}
          </button>
        </div>

        {/* Order Reconciliation — ALWAYS VISIBLE */}
        <div className="glass-card">
          <CardHeader
            title="Order Reconciliation"
            health={getReconcileHealth()}
            onReset={resetReconcile}
            hasState={!!reconcileResult}
          />

          {/* Status area — always shows something */}
          {!reconciling && !reconcileResult && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              marginBottom: '12px',
              fontSize: '13px',
              color: 'var(--text-muted)'
            }}>
              Compare Stripe checkout sessions against Google Sheet order log.
            </div>
          )}

          {reconcileResult && (
            <div style={{
              background: reconcileResult.sessionCount === 0 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(59, 130, 246, 0.1)',
              border: `1px solid ${reconcileResult.sessionCount === 0 ? 'rgba(34, 197, 94, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`,
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              marginBottom: '12px',
              fontSize: '13px',
              color: 'var(--text-primary)',
              maxHeight: '200px',
              overflowY: 'auto',
            }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>{reconcileResult.message}</div>
              {reconcileResult.sessions?.map((s, i) => (
                <div key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.1)', padding: '6px 0', fontSize: '12px' }}>
                  <span style={{ color: 'var(--accent)' }}>${s.amount}</span>
                  {' \u2014 '}{s.photoTitle || s.photoId || 'Unknown'} ({s.orderType})
                  <br/>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {s.customerName} &lt;{s.customerEmail}&gt; {'—'} {new Date(s.created).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}

          {reconciling && (
            <div style={{
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              marginBottom: '12px',
              fontSize: '13px',
              color: '#3b82f6'
            }}>
              Checking Stripe sessions...
            </div>
          )}

          <button
            className="btn btn-secondary"
            onClick={handleReconcile}
            disabled={reconciling}
            style={{ width: '100%' }}
          >
            {reconciling ? 'Checking...' : 'Check Last 7 Days'}
          </button>
        </div>

        {/* Quick Links — ALWAYS VISIBLE */}
        <div className="glass-card">
          <h3>Quick Links</h3>
          <a
            href="https://archive-35.com"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ display: 'block', marginBottom: '8px', textAlign: 'center' }}
          >
            Live Website {'→'}
          </a>
          <button
            className="btn btn-secondary"
            onClick={checkStatus}
            style={{ display: 'block', width: '100%', textAlign: 'center' }}
          >
            {'↻'} Refresh Status
          </button>
        </div>

        {/* Portfolio Collections — bottom of grid */}
        <div className="glass-card">
          <h3>Portfolio Collections</h3>
          {loading ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
          ) : deployStatus?.portfolioCollections?.length > 0 ? (
            <div>
              {deployStatus.portfolioCollections.map((col, i) => (
                <div key={i} className="status-row">
                  <span>{col.name}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{col.count} photos</span>
                    {col.hasPhotosJson && (
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(34, 197, 94, 0.15)',
                        color: '#22c55e'
                      }}>STUDIO</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>No collections found</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default WebsiteControl;
