import React, { useState } from 'react';
import './AuthModal.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'https://orian-ondq.onrender.com';

function AuthModal({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      localStorage.setItem('orian_token', data.token);
      localStorage.setItem('orian_user', JSON.stringify(data.user));
      onAuth(data.user, data.token);
    } catch {
      setError('failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay">
      <div className="auth-modal">
        <div className="auth-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="1.5" strokeLinecap="round">
            <line x1="12" y1="2" x2="12" y2="22" /><line x1="2" y1="12" x2="22" y2="12" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /><line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
          </svg>
          <span>orian</span>
        </div>
        <h2 className="auth-title">{mode === 'login' ? 'welcome back' : 'create account'}</h2>
        <form onSubmit={handleSubmit} className="auth-form">
          {mode === 'register' && (
            <input className="auth-input" type="text" placeholder="name" value={name} onChange={e => setName(e.target.value)} />
          )}
          <input className="auth-input" type="email" placeholder="email" value={email} onChange={e => setEmail(e.target.value)} required />
          <input className="auth-input" type="password" placeholder="password" value={password} onChange={e => setPassword(e.target.value)} required />
          {error && <p className="auth-error">{error}</p>}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? '...' : mode === 'login' ? 'sign in' : 'sign up'}
          </button>
        </form>
        <p className="auth-switch">
          {mode === 'login' ? "don't have an account?" : 'already have an account?'}
          <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
            {mode === 'login' ? 'sign up' : 'sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}

export default AuthModal;
