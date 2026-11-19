import React, { useState, useEffect, useCallback } from 'react';
import './Integrations.css';

import { BACKEND_URL } from '../config';

const NotionIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"/>
  </svg>
);

const SlackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
  </svg>
);

const GoogleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/>
  </svg>
);

const GitHubIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
  </svg>
);

const LinearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M0 14.008 9.99 24l14.01-14.01L14.008 0zm.613 8.662L9.99 22.05V15.62L1.95 7.58zm1.318-9.98 9.98 9.98H5.48L.95 8.14zM14.008.95l9.042 9.042-9.042 9.042V.95z"/>
  </svg>
);

const AirtableIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.955.592 1.342 4.75a.923.923 0 0 0 .008 1.714l10.64 4.048a2.772 2.772 0 0 0 1.978 0l10.64-4.048a.923.923 0 0 0 .008-1.714L13.977.592a2.772 2.772 0 0 0-2.022 0M1.002 8.01v7.477c0 .51.331.96.818 1.11l9.97 3.046a2.772 2.772 0 0 0 1.62 0l9.97-3.046a1.17 1.17 0 0 0 .818-1.11V8.01a.468.468 0 0 0-.611-.444l-10.61 3.237a2.772 2.772 0 0 1-1.614 0L1.613 7.566A.468.468 0 0 0 1 8.01"/>
  </svg>
);

const ICONS = {
  notion: NotionIcon,
  slack: SlackIcon,
  google: GoogleIcon,
  github: GitHubIcon,
  linear: LinearIcon,
  airtable: AirtableIcon,
};

function Integrations({ getToken }) {
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);
  const [providers, setProviders] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [inputs, setInputs] = useState({});

  const fetchStatus = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${BACKEND_URL}/integrations/list`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('[INTEGRATIONS]', data.error || res.status);
        return;
      }
      setConfigured(Boolean(data.configured));
      setProviders(data.providers || []);
      setInputs(prev => {
        const next = { ...prev };
        (data.providers || []).forEach(p => {
          if (!next[p.id] && p.config && Object.keys(p.config).length > 0) {
            next[p.id] = { ...p.config };
          }
        });
        return next;
      });
    } catch (e) {
      console.error('[INTEGRATIONS]', e.message);
    }
  }, [getToken]);

  useEffect(() => {
    fetchStatus();
    const handler = (e) => {
      if (e.origin !== new URL(BACKEND_URL).origin) return;
      if (e.data?.type === 'oauth_success') fetchStatus();
      if (e.data?.type === 'oauth_error') setError(String(e.data.error || 'Connection failed'));
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [fetchStatus]);

  const connect = async (providerId) => {
    setError('');
    const popup = window.open('about:blank', `connect_${providerId}`, 'width=600,height=700,left=200,top=100');
    if (!popup) { setError('Allow popups to connect an app.'); return; }
    try {
      const token = await getToken();
      if (!token) throw new Error('Please sign in again.');
      const res = await fetch(`${BACKEND_URL}/integrations/connect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId }),
      });
      const data = await res.json();
      if (!res.ok || !data.redirectUrl) throw new Error(data.error || 'Could not start connection');
      popup.location.href = data.redirectUrl;
      const timer = setInterval(() => {
        if (popup.closed) { clearInterval(timer); fetchStatus(); }
      }, 1000);
      setTimeout(() => clearInterval(timer), 15 * 60 * 1000);
    } catch (e) {
      popup.close();
      setError(e.message);
    }
  };

  const disconnect = async (providerId) => {
    try {
      const token = await getToken();
      if (!token) return;
      const response = await fetch(`${BACKEND_URL}/integrations/${providerId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Could not disconnect app');
      setProviders(prev => prev.map(p => p.id === providerId
        ? { ...p, connected: false, status: 'NOT_CONNECTED', connectedAccountId: null }
        : p));
      setExpanded(null);
    } catch (e) {
      setError(e.message);
    }
  };

  const saveProviderConfig = async (providerId) => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${BACKEND_URL}/integrations/${providerId}/config`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: inputs[providerId] || {} }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not save settings');
        return;
      }
      setExpanded(null);
    } catch (e) {
      console.error('[CONFIG ERROR]', e.message);
    }
  };

  const setInput = (provider, key, value) => {
    setInputs(prev => ({ ...prev, [provider]: { ...(prev[provider] || {}), [key]: value } }));
  };

  return (
    <div className="integrations">
      <p className="integrations-label">integrations</p>
      {error && <p role="alert" style={{ fontSize: '0.8rem', color: '#b42318' }}>{error}</p>}
      {!configured && (
        <div className="integration-row">
          <span className="integration-name">composio not configured</span>
        </div>
      )}
      <div className="integrations-list">
        {providers.map(p => {
          const Icon = ICONS[p.id];
          const settings = p.settings || [];
          return (
            <div key={p.id} className="integration-item">
              <div className="integration-row">
                <span className="integration-icon">{Icon ? <Icon /> : null}</span>
                <span className="integration-name">{p.label}</span>
                {p.connected ? (
                  <div style={{ display: 'flex', gap: '0.3rem' }}>
                    {settings.length > 0 && (
                      <button
                        className="integration-btn"
                        onClick={() => setExpanded(expanded === `${p.id}-config` ? null : `${p.id}-config`)}
                      >
                        {expanded === `${p.id}-config` ? 'close' : 'config'}
                      </button>
                    )}
                    <button className="integration-btn connected" onClick={() => disconnect(p.id)}>
                      <span className="integration-dot" /> connected
                    </button>
                  </div>
                ) : (
                  <button
                    className="integration-btn"
                    disabled={!configured}
                    style={!configured ? { opacity: 0.4, cursor: 'default' } : undefined}
                    onClick={() => connect(p.id)}
                  >
                    connect
                  </button>
                )}
              </div>
              {expanded === `${p.id}-config` && p.connected && settings.length > 0 && (
                <div className="integration-form">
                  {settings.map(s => (
                    <input
                      key={s.key}
                      placeholder={s.placeholder}
                      value={(inputs[p.id] && inputs[p.id][s.key]) || ''}
                      onChange={e => setInput(p.id, s.key, e.target.value)}
                    />
                  ))}
                  <button className="integration-save-btn" onClick={() => saveProviderConfig(p.id)}>save</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Integrations;
