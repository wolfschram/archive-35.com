/**
 * useAgentApi — React hook for Archive-35 Agent FastAPI calls.
 *
 * Routes through Electron IPC when available, falls back to direct
 * HTTP fetch for browser dev mode.
 *
 * Startup-aware: silently retries during the first 15 seconds while
 * the Agent backend boots, suppressing ECONNREFUSED noise.
 */
import { useState, useCallback, useRef } from 'react';

const AGENT_API_BASE = 'http://127.0.0.1:8035';
const STARTUP_GRACE_PERIOD = 15000; // 15 seconds to let Agent boot
const RETRY_DELAY = 2000; // retry every 2s during grace period
const MAX_RETRIES = 6; // 6 retries × 2s = 12s coverage

// Shared across all hook instances — tracks when the app started
const appStartTime = Date.now();
let agentReady = false;

function isInStartupGrace() {
  return !agentReady && (Date.now() - appStartTime) < STARTUP_GRACE_PERIOD;
}

function isConnectionError(err) {
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('econnrefused') || msg.includes('unreachable') || msg.includes('failed to fetch');
}

async function agentFetch(path, options = {}) {
  // Try Electron IPC first
  if (window.electronAPI?.agentApiCall) {
    return window.electronAPI.agentApiCall(path, options);
  }

  // Fallback: direct HTTP (browser dev mode)
  const url = `${AGENT_API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `API error ${res.status}`);
  }

  return res.json();
}

/**
 * Retry-aware fetch — silently retries during startup grace period.
 */
async function agentFetchWithRetry(path, options = {}) {
  let lastError;
  const retries = isInStartupGrace() ? MAX_RETRIES : 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await agentFetch(path, options);
      agentReady = true; // First successful call marks Agent as ready
      return result;
    } catch (err) {
      lastError = err;
      if (isConnectionError(err) && attempt < retries && isInStartupGrace()) {
        // Agent still booting — wait and retry silently
        await new Promise(r => setTimeout(r, RETRY_DELAY));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * Hook for Agent API calls with loading/error state.
 * Suppresses connection errors during startup grace period.
 */
export function useAgentApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const call = useCallback(async (path, options = {}) => {
    setLoading(true);
    setError(null);
    try {
      const data = await agentFetchWithRetry(path, options);
      return data;
    } catch (err) {
      // Suppress connection errors during startup — don't spam the UI
      if (isConnectionError(err) && isInStartupGrace()) {
        // Silently fail — the component will retry on next render/interaction
        return null;
      }
      setError(err.message || err.detail || String(err) || 'Unknown API error');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const get = useCallback((path) => call(path), [call]);

  const post = useCallback((path, body = {}) => {
    return call(path, { method: 'POST', body });
  }, [call]);

  const del = useCallback((path) => {
    return call(path, { method: 'DELETE' });
  }, [call]);

  return { get, post, del, loading, error, setError };
}

export { agentFetch };
export default useAgentApi;
