/**
 * useAgentApi — React hook for Archive-35 Agent FastAPI calls.
 *
 * Routes through Electron IPC when available, falls back to direct
 * HTTP fetch for browser dev mode.
 */
import { useState, useCallback } from 'react';

const AGENT_API_BASE = 'http://127.0.0.1:8035';

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
 * Hook for Agent API calls with loading/error state.
 */
export function useAgentApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const call = useCallback(async (path, options = {}) => {
    setLoading(true);
    setError(null);
    try {
      const data = await agentFetch(path, options);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const get = useCallback((path) => call(path), [call]);

  const post = useCallback((path, body = {}) => {
    return call(path, { method: 'POST', body });
  }, [call]);

  return { get, post, loading, error, setError };
}

export { agentFetch };
export default useAgentApi;
