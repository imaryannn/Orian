import React, { useState } from 'react';
import { SignIn, SignUp } from '@clerk/react';
import './AuthModal.css';

const FONT = "'Instrument Serif', 'Playfair Display', Georgia, serif";

const clerkAppearance = {
  variables: {
    colorPrimary: '#0a0a0a',
    colorPrimaryForeground: '#ffffff',
    colorForeground: '#0a0a0a',
    colorMutedForeground: '#777777',
    colorBackground: 'transparent',
    colorInput: 'rgba(255, 255, 255, 0.8)',
    colorInputForeground: '#0a0a0a',
    colorBorder: 'rgba(0, 0, 0, 0.15)',
    colorDanger: '#c0392b',
    colorRing: 'rgba(0, 0, 0, 0.35)',
    colorShadow: 'rgba(0, 0, 0, 0.08)',
    fontFamily: FONT,
    fontFamilyButtons: FONT,
    borderRadius: '12px',
    fontSize: '0.95rem',
  },
  elements: {
    rootBox: { width: '100%', maxWidth: '100%' },
    cardBox: {
      width: '100%',
      maxWidth: '100%',
      background: 'transparent',
      boxShadow: 'none',
      border: 'none',
      borderRadius: '0px',
      overflow: 'visible',
    },
    card: {
      width: '100%',
      background: 'transparent',
      boxShadow: 'none',
      border: 'none',
      padding: '0',
      margin: '0',
    },
    logoBox: { display: 'none' },
    header: { display: 'none' },
    headerTitle: { display: 'none' },
    headerSubtitle: { display: 'none' },
    main: { width: '100%' },
    footer: { display: 'none' },
    socialButtonsRoot: { gap: '0.6rem' },
    socialButtonsBlockButton: {
      width: '100%',
      boxSizing: 'border-box',
      borderRadius: '12px',
      border: '1px solid rgba(0, 0, 0, 0.15)',
      backgroundColor: 'rgba(255, 255, 255, 0.8)',
      color: '#0a0a0a',
      textTransform: 'lowercase',
      fontFamily: FONT,
      fontSize: '0.9rem',
      boxShadow: 'none',
      '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.95)', borderColor: 'rgba(0, 0, 0, 0.3)' },
    },
    socialButtonsBlockButtonText: { fontFamily: FONT, textTransform: 'lowercase', fontWeight: '500' },
    dividerRow: { margin: '1.1rem 0' },
    dividerLine: { backgroundColor: 'rgba(0, 0, 0, 0.12)' },
    dividerText: { color: '#777777', fontFamily: FONT, fontSize: '0.75rem', textTransform: 'lowercase' },
    formFieldLabel: {
      color: '#555555',
      fontFamily: FONT,
      fontSize: '0.8rem',
      fontWeight: '600',
      textTransform: 'lowercase',
    },
    formFieldInput: {
      width: '100%',
      boxSizing: 'border-box',
      borderRadius: '12px',
      borderColor: 'rgba(0, 0, 0, 0.15)',
      backgroundColor: 'rgba(255, 255, 255, 0.8)',
      color: '#0a0a0a',
      fontFamily: FONT,
      fontSize: '0.95rem',
      padding: '0.75rem 1rem',
      textTransform: 'lowercase',
      '&:focus': { borderColor: 'rgba(0, 0, 0, 0.35)', boxShadow: 'none' },
    },
    formFieldInputShowPasswordButton: { color: '#777777' },
    formFieldAction: {
      color: '#0a0a0a',
      fontFamily: FONT,
      fontSize: '0.8rem',
      textTransform: 'lowercase',
      textDecoration: 'underline',
      textUnderlineOffset: '3px',
    },
    formFieldErrorText: { color: '#c0392b', fontFamily: FONT, fontSize: '0.8rem', textTransform: 'lowercase' },
    formFieldHintText: { color: '#999999', fontFamily: FONT, fontSize: '0.75rem', textTransform: 'lowercase' },
    formButtonPrimary: {
      width: '100%',
      boxSizing: 'border-box',
      backgroundColor: '#0a0a0a',
      color: '#ffffff',
      borderRadius: '12px',
      border: 'none',
      boxShadow: 'none',
      fontFamily: FONT,
      fontSize: '0.95rem',
      fontWeight: '600',
      textTransform: 'lowercase',
      padding: '0.85rem 1rem',
      marginTop: '0.25rem',
      '&:hover': { backgroundColor: '#0a0a0a', opacity: '0.85' },
      '&:active': { opacity: '0.7' },
      '&:disabled': { opacity: '0.4' },
    },
    formButtonReset: { color: '#777777', fontFamily: FONT, textTransform: 'lowercase' },
    alert: {
      backgroundColor: 'rgba(192, 57, 43, 0.06)',
      border: '1px solid rgba(192, 57, 43, 0.2)',
      borderRadius: '12px',
    },
    alertText: { color: '#c0392b', fontFamily: FONT, fontSize: '0.8rem', textTransform: 'lowercase' },
    identityPreview: {
      borderRadius: '12px',
      border: '1px solid rgba(0, 0, 0, 0.12)',
      backgroundColor: 'rgba(255, 255, 255, 0.8)',
    },
    identityPreviewText: { color: '#0a0a0a', fontFamily: FONT, textTransform: 'lowercase' },
    identityPreviewEditButton: { color: '#0a0a0a' },
    otpCodeFieldInput: {
      borderRadius: '12px',
      borderColor: 'rgba(0, 0, 0, 0.15)',
      backgroundColor: 'rgba(255, 255, 255, 0.8)',
      color: '#0a0a0a',
      fontFamily: FONT,
    },
    formResendCodeLink: { color: '#0a0a0a', fontFamily: FONT, textTransform: 'lowercase' },
    badge: { fontFamily: FONT, textTransform: 'lowercase' },
    lastAuthenticationStrategyBadge: { display: 'none' },
  },
};

function AuthModal() {
  const [mode, setMode] = useState('login');

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
        <div className="auth-clerk">
          {mode === 'login' ? (
            <SignIn routing="hash" appearance={clerkAppearance} fallbackRedirectUrl="/" />
          ) : (
            <SignUp routing="hash" appearance={clerkAppearance} fallbackRedirectUrl="/" />
          )}
        </div>
        <p className="auth-switch">
          {mode === 'login' ? "don't have an account?" : 'already have an account?'}
          <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'sign up' : 'sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}

export default AuthModal;
