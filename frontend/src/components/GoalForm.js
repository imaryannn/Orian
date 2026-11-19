import React, { useState, useRef, useEffect } from 'react';
import ModelSelector from './ModelSelector';
import './GoalForm.css';

const CHIPS = [
  'build a personal portfolio website',
  'create a weekly planner in Notion',
  'write a project proposal in Google Docs',
  'compare free AI coding models with sources',
  'explain how APIs work with a simple example',
];

function GoalForm({ onSubmit, getToken }) {
  const [goal, setGoal] = useState('');
  const [mounted, setMounted] = useState(false);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    setMounted(true);
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const handleChange = (e) => {
    setGoal(e.target.value);
    autoResize();
  };

  const handleSubmit = () => {
    if (!goal.trim()) return;
    onSubmit(goal);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleChip = (chip) => {
    setGoal(chip);
    textareaRef.current?.focus();
    setTimeout(autoResize, 0);
  };

  return (
    <div className="goalform-layout">
      <div className={`goalform-body ${mounted ? 'visible' : ''}`}>
        <h2 className="goalform-title">what would you like me to do?</h2>
        <p className="goalform-codename">/ codename: genesis /</p>
      </div>
      <div className="goalform-bar-wrapper">
        <div className="goalform-chips">
          {CHIPS.map((chip) => (
            <button key={chip} className="goalform-chip" onClick={() => handleChip(chip)}>
              {chip}
            </button>
          ))}
        </div>
        <div className={`goalform-bar ${focused ? 'focused' : ''}`}>
          <textarea
            ref={textareaRef}
            value={goal}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="e.g., build a personal portfolio website with a dark theme"
            rows="1"
          />
          <div className="goalform-bar-foot">
            <div className="goalform-bar-foot-left">
              <ModelSelector getToken={getToken} />
            </div>
            <button onClick={handleSubmit} disabled={!goal.trim()} className={`goalform-send-btn ${goal.trim() ? 'has-text' : ''}`}>
              <span className="goalform-send-arrow">↗</span>
              <span className="goalform-send-label">run</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GoalForm;
