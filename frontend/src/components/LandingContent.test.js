import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import LandingContent from './LandingContent';
test('landing examples switch without taking action in external apps, and entry buttons open Orian', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const onStart = jest.fn();
  const onPrivacy = jest.fn();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<LandingContent onStart={onStart} onPrivacy={onPrivacy} onTerms={jest.fn()} />));
    expect(container.querySelector('#features')).not.toBeNull();
    expect(container.querySelector('#about')).not.toBeNull();
    expect(container.querySelector('#docs')).not.toBeNull();
    await act(async () => Simulate.click(container.querySelector('.landing-habit button')));
    expect(container.textContent).toContain('1 small win');
    expect(onStart).not.toHaveBeenCalled();
    await act(async () => Simulate.click(container.querySelector('#demo-tab-connect')));
    expect(container.querySelector('.landing-planner')).not.toBeNull();
    expect(container.querySelector('[role="tabpanel"]').getAttribute('aria-labelledby')).toBe('demo-tab-connect');
    await act(async () => Simulate.click(container.querySelector('#demo-tab-research')));
    expect(container.querySelector('.landing-research')).not.toBeNull();
    await act(async () => Simulate.click(container.querySelector('.hero-cta')));
    expect(onStart).toHaveBeenCalledTimes(1);
    await act(async () => Simulate.click(container.querySelector('.landing-legal button')));
    expect(onPrivacy).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('details')).toHaveLength(4);
  } finally { await act(async () => root.unmount()); container.remove(); }
});
