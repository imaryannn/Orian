import React, { useEffect } from 'react';
import './Toast.css';

function Toast({ message, onClose, error = false }) {
  useEffect(() => {
    const t = setTimeout(onClose, error ? 4500 : 3500);
    return () => clearTimeout(t);
  }, [onClose, error]);

  return (
    <div className={`toast ${error ? 'toast-error' : ''}`}>
      {error ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      )}
      {message}
    </div>
  );
}

export default Toast;
