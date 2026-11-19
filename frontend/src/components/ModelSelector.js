import React, { useState, useEffect, useCallback, useRef } from 'react';
import './ModelSelector.css';

import { BACKEND_URL } from '../config';

const FALLBACK_MODELS = [
  {
    id: 'openrouter/free',
    label: 'free auto router',
    name: 'OpenRouter Free Router',
    description: 'automatically selects an available free model',
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    label: 'nemotron 3 ultra',
    name: 'NVIDIA Nemotron 3 Ultra 550B',
    description: 'larger free model for complex tasks',
  },
];

const TEST_MESSAGES = {
  not_configured: 'openrouter not configured on server',
  invalid_model: 'unknown model',
  model_unavailable: 'model unavailable',
  rate_limit: 'rate limited, try again later',
  timeout: 'request timed out',
  network: 'network error',
  auth: 'invalid api key',
  provider: 'provider error',
};

function testMessage(result) {
  if (!result) return '';
  if (result.ok) return `ok · ${result.latencyMs}ms`;
  const known = TEST_MESSAGES[result.code];
  if (known) return known;
  return String(result.error || 'test failed').slice(0, 120);
}

function ModelSelector({ getToken }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [models, setModels] = useState(FALLBACK_MODELS);
  const [selected, setSelected] = useState(FALLBACK_MODELS[0].id);
  const [saving, setSaving] = useState(null);
  const [testing, setTesting] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [error, setError] = useState(null);
  const rootRef = useRef(null);

  const authHeaders = async () => {
    const token = await getToken?.();
    if (!token) throw new Error('not signed in');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  };

  const fetchModel = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${BACKEND_URL}/api/settings/model`, { headers });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `status ${res.status}`);
        return;
      }
      setConfigured(Boolean(data.configured));
      if (Array.isArray(data.available) && data.available.length > 0) {
        setModels(data.available);
      }
      setSelected(data.modelId || data.defaultModelId || FALLBACK_MODELS[0].id);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchModel();
  }, [fetchModel]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selectModel = async (modelId) => {
    if (modelId === selected || saving) return;
    const previous = selected;
    setSaving(modelId);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${BACKEND_URL}/api/settings/model`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ modelId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `status ${res.status}`);
      setSelected(modelId);
      setError(null);
      setOpen(false);
    } catch (e) {
      setSelected(previous);
      setError(e.message);
    } finally {
      setSaving(null);
    }
  };

  const testModel = async (modelId) => {
    if (testing) return;
    setTesting(modelId);
    setTestResults(prev => ({ ...prev, [modelId]: null }));
    try {
      const headers = await authHeaders();
      const res = await fetch(`${BACKEND_URL}/api/settings/model/test`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ modelId }),
      });
      const data = await res.json();
      setTestResults(prev => ({ ...prev, [modelId]: data }));
    } catch (e) {
      setTestResults(prev => ({ ...prev, [modelId]: { ok: false, code: 'network', error: e.message } }));
    } finally {
      setTesting(null);
    }
  };

  const current = models.find(m => m.id === selected);
  const triggerLabel = loading
    ? 'loading...'
    : !configured
      ? 'not configured'
      : (current?.label || current?.name || selected || 'select model');

  return (
    <div className={`model-selector${open ? ' open' : ''}`} ref={rootRef}>
      <button
        className="model-trigger"
        onClick={() => setOpen(o => !o)}
        disabled={loading}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="model-trigger-key">model</span>
        <span className="model-trigger-name">{triggerLabel}</span>
        <svg className="model-trigger-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 15 12 9 18 15" />
        </svg>
      </button>

      {open && (
        <div className="model-menu" role="listbox">
          {models.map(m => {
            const isSelected = selected === m.id;
            const result = testResults[m.id];
            return (
              <div key={m.id} className={`model-item${isSelected ? ' selected' : ''}`}>
                <button
                  className="model-row-btn"
                  onClick={() => selectModel(m.id)}
                  disabled={!configured || Boolean(saving)}
                  role="option"
                  aria-selected={isSelected}
                >
                  <span className="model-radio">
                    {isSelected
                      ? <span className="model-radio-fill" />
                      : <span className="model-radio-empty" />}
                  </span>
                  <span className="model-name">{m.label || m.name || m.id}</span>
                  {saving === m.id ? (
                    <span className="model-state">saving...</span>
                  ) : isSelected ? (
                    <span className="model-state active"><span className="model-dot" />active</span>
                  ) : null}
                </button>
                <div className="model-meta">
                  <span className="model-desc">{m.description || m.id}</span>
                  <button
                    className="model-test-btn"
                    onClick={() => testModel(m.id)}
                    disabled={Boolean(testing)}
                  >
                    {testing === m.id ? 'testing...' : 'test'}
                  </button>
                </div>
                {result && (
                  <p className={`model-test-result${result.ok ? ' ok' : ' err'}`}>
                    {testMessage(result)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="model-error">{error}</p>}
    </div>
  );
}

export default ModelSelector;
