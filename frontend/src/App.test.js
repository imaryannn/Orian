import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import App from './App';
jest.mock('lenis', () => jest.fn());
jest.mock('@clerk/react', () => {
  const getToken = async () => 'test-token';
  return { useAuth: () => ({ isLoaded: true, isSignedIn: true, getToken, signOut: jest.fn() }), useUser: () => ({ user: null }), UserButton: () => null };
});
jest.mock('socket.io-client', () => ({ io: jest.fn(() => ({ on: jest.fn(), io: { on: jest.fn() }, emit: jest.fn(), disconnect: jest.fn(), connect: jest.fn(), connected: false, active: false })) }));
jest.mock('./components/DotsBackground', () => () => null);
jest.mock('./components/Integrations', () => () => null);
jest.mock('./components/ModelSelector', () => () => null);
beforeEach(() => {
  require('socket.io-client').io.mockImplementation(() => ({ on: jest.fn(), emit: jest.fn(), disconnect: jest.fn(), connect: jest.fn(), connected: false, active: false }));
});

test('clicking history opens the saved chat with clean links and a follow-up input', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem('orian_show_app', '1');
  const saved = {
    id: 'saved-goal', goal: 'Create Chest Workout', status: 'completed', createdAt: '2026-11-19T12:00:00Z',
    context: [{ role: 'user', content: 'Use dumbbells' }, { role: 'assistant', content: 'I will use dumbbells.' }, { role: 'user', content: 'Create Chest Workout' }],
    result: { report: { content: "Successfully created a new Notion page titled 'Chest Workout'. More details.\n[Open notion](https://notion.so/Welcome)\n[Open notion](https://notion.so/Chest-Workout)" } },
  };
  const originalFetch = global.fetch;
  global.fetch = jest.fn(async url => ({ ok: true, json: async () => String(url).endsWith('/api/goal') ? { goals: [saved] } : saved }));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<App />); });
    await act(async () => { Simulate.click(container.querySelector('.taskhistory-item')); });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/goal/saved-goal'), expect.any(Object));
    expect(container.querySelector('.loader-chat')).not.toBeNull();
    expect(container.querySelector('.result-layout')).toBeNull();
    expect(container.textContent).toContain('Use dumbbells');
    expect(container.textContent).toContain('I will use dumbbells.');
    expect(container.querySelector('.loader-chat-input-field').placeholder).toBe('ask a follow-up...');
    const links = [...container.querySelectorAll('.loader-chat-report-content a')];
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe('https://notion.so/Chest-Workout');
    expect(container.textContent).not.toContain('codename: synthesis');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    global.fetch = originalFetch;
    localStorage.clear();
  }
});

test('reopening a coding conversation restores the saved editor files and can save edits', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem('orian_show_app', '1');
  const workspace = { files: [{ path: 'index.html', content: '<h1>Manual edit</h1>' }], entry: 'index.html', updatedAt: 'saved-version' };
  const saved = { id: 'coding-goal', goal: 'Build a site', status: 'completed', workspace, createdAt: '2026-11-19T12:00:00Z', result: { report: { content: 'Built your site.' }, artifacts: { code: [{ language: 'html', code: '<h1>Old generated version</h1>' }] } } };
  const originalFetch = global.fetch;
  global.fetch = jest.fn(async (url, options) => ({ ok: true, json: async () => options?.method === 'PATCH' ? { workspace: { ...workspace, updatedAt: 'new-version' } } : String(url).endsWith('/api/goal') ? { goals: [saved] } : saved }));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<App />));
    await act(async () => Simulate.click(container.querySelector('.taskhistory-item')));
    expect(container.querySelector('.coding-session')).not.toBeNull();
    await act(async () => Simulate.click([...container.querySelectorAll('[role="tab"]')].find(button => button.textContent === 'Code')));
    expect(container.querySelector('.workspace-editor textarea').value).toBe('<h1>Manual edit</h1>');
    await act(async () => Simulate.change(container.querySelector('.workspace-editor textarea'), { target: { value: '<h1>New edit</h1>' } }));
    await act(async () => Simulate.click([...container.querySelectorAll('.code-workspace button')].find(button => button.textContent === 'Save')));
    const savedRequest = global.fetch.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(savedRequest[0]).toContain('/api/goal/coding-goal/workspace');
    expect(JSON.parse(savedRequest[1].body).files[0].content).toBe('<h1>New edit</h1>');
  } finally { await act(async () => root.unmount()); container.remove(); global.fetch = originalFetch; localStorage.clear(); }
});

test('transient socket failures do not show a red popup and reconnect with fresh authentication', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem('orian_show_app', '1');
  jest.useFakeTimers();
  const originalFetch = global.fetch;
  global.fetch = jest.fn(async (url, options) => ({ ok: true, json: async () => options?.method === 'POST' ? { goalId: 'test-goal' } : String(url).endsWith('/test-goal') ? { status: 'running' } : { goals: [] } }));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const { io } = require('socket.io-client');
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await act(async () => root.render(<App />));
    await act(async () => Simulate.change(container.querySelector('.goalform-bar textarea'), { target: { value: 'Hello Orian' } }));
    await act(async () => Simulate.click(container.querySelector('.goalform-send-btn')));
    const socket = io.mock.results[io.mock.results.length - 1].value;
    const options = io.mock.calls[io.mock.calls.length - 1][1];
    const authenticate = jest.fn();
    await options.auth(authenticate);
    expect(authenticate).toHaveBeenCalledWith({ token: 'test-token' });
    const onError = socket.on.mock.calls.find(([event]) => event === 'connect_error')[1];
    await act(async () => onError(new Error('unauthorized')));
    expect(container.querySelector('.toast-error')).toBeNull();
    await act(async () => jest.advanceTimersByTime(1000));
    expect(socket.connect).toHaveBeenCalledTimes(2);
    const onConnect = socket.on.mock.calls.find(([event]) => event === 'connect')[1];
    await act(async () => onConnect());
    expect(socket.emit).toHaveBeenCalledWith('subscribe_goal', 'test-goal');
    const onComplete = socket.on.mock.calls.find(([event]) => event === 'task_complete')[1];
    await act(async () => onComplete({ goalId: 'test-goal', result: { mode: 'chat', report: { content: 'Hello back!' } } }));
    expect(container.textContent).toContain('Hello back!');
    expect(container.querySelector('.toast-error')).toBeNull();
  } finally { await act(async () => root.unmount()); container.remove(); global.fetch = originalFetch; warn.mockRestore(); jest.useRealTimers(); localStorage.clear(); }
});

test('real prompt submission failures still show their error', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem('orian_show_app', '1');
  const originalFetch = global.fetch;
  global.fetch = jest.fn(async (_, options) => options?.method === 'POST' ? { ok: false, status: 503, json: async () => ({ error: 'Task queue unavailable' }) } : { ok: true, json: async () => ({ goals: [] }) });
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<App />));
    await act(async () => Simulate.change(container.querySelector('.goalform-bar textarea'), { target: { value: 'Hello Orian' } }));
    await act(async () => Simulate.click(container.querySelector('.goalform-send-btn')));
    expect(container.querySelector('.toast-error').textContent).toContain('Task queue unavailable');
  } finally { await act(async () => root.unmount()); container.remove(); global.fetch = originalFetch; consoleError.mockRestore(); localStorage.clear(); }
});

test('follow-up prompts update the existing conversation instead of adding sidebar rows', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem('orian_show_app', '1');
  const saved = { id: 'first', conversationId: 'conversation', conversationTitle: 'My calculator', goal: 'Build a calculator', status: 'completed', createdAt: '2026-11-19T12:00:00Z', result: { mode: 'chat', report: { content: 'Ready.' } } };
  const originalFetch = global.fetch;
  global.fetch = jest.fn(async (url, options) => ({ ok: true, json: async () => options?.method === 'POST' ? { goalId: 'second', conversationId: 'conversation', conversationTitle: 'My calculator' } : String(url).endsWith('/api/goal') ? { goals: [saved] } : String(url).endsWith('/second') ? { status: 'running' } : saved }));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<App />));
    await act(async () => Simulate.click(container.querySelector('.taskhistory-item')));
    await act(async () => Simulate.change(container.querySelector('.loader-chat-input-field'), { target: { value: 'Make the buttons green' } }));
    await act(async () => Simulate.submit(container.querySelector('.loader-chat-input-box')));
    const request = global.fetch.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(JSON.parse(request[1].body).previousGoalId).toBe('first');
    expect(container.querySelectorAll('.taskhistory-item')).toHaveLength(1);
    expect(container.querySelector('.taskhistory-goal').textContent).toBe('My calculator');
    expect(container.querySelector('.taskhistory-heading').textContent).toBe('conversations');
  } finally { await act(async () => root.unmount()); container.remove(); global.fetch = originalFetch; localStorage.clear(); }
});
