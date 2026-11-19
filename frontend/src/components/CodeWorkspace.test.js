import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import CodeWorkspace from './CodeWorkspace';
test('edits files, saves the project, and refreshes the mobile preview', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  const save = jest.fn(async () => {});
  function Harness() {
    const [workspace, setWorkspace] = useState({ files: [{ path: 'index.html', content: '<h1>Original</h1>' }], entry: 'index.html' });
    return <CodeWorkspace workspace={workspace} onChange={setWorkspace} onSave={save} projectId="project" />;
  }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => jest.advanceTimersByTime(450));
    expect(container.querySelector('iframe').getAttribute('sandbox')).toBe('allow-scripts');
    expect(container.querySelector('iframe').srcdoc).toContain('Original');
    await act(async () => Simulate.click([...container.querySelectorAll('[role="tab"]')].find(b => b.textContent === 'Code')));
    const editor = container.querySelector('textarea');
    await act(async () => { Simulate.change(editor, { target: { value: '<h1>Edited</h1>' } }); });
    expect(container.textContent).toContain('Unsaved changes');
    await act(async () => Simulate.click([...container.querySelectorAll('button')].find(b => b.textContent === 'Save')));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.objectContaining({ content: '<h1>Edited</h1>' })] }));
    await act(async () => Simulate.click([...container.querySelectorAll('[role="tab"]')].find(b => b.textContent === 'Preview')));
    await act(async () => jest.advanceTimersByTime(450));
    expect(container.querySelector('iframe').srcdoc).toContain('Edited');
    await act(async () => Simulate.click(container.querySelector('[aria-label="Mobile preview"]')));
    expect(container.querySelector('.workspace-preview.mobile')).not.toBeNull();
  } finally { await act(async () => root.unmount()); container.remove(); jest.useRealTimers(); }
});

test('Download ZIP includes every file and the current unsaved editor content', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const zip = require('../workspaceZip');
  const download = jest.spyOn(zip, 'downloadWorkspaceZip').mockImplementation(() => {});
  const initial = [{ path: 'index.html', content: '<h1>Old</h1>' }, { path: 'src/styles/main.css', content: 'body{color:green}' }];
  function Harness() {
    const [workspace, setWorkspace] = useState({ files: initial, entry: 'index.html' });
    return <CodeWorkspace workspace={workspace} onChange={setWorkspace} onSave={jest.fn()} projectId="website" />;
  }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => Simulate.click([...container.querySelectorAll('[role="tab"]')].find(button => button.textContent === 'Code')));
    await act(async () => Simulate.change(container.querySelector('textarea'), { target: { value: '<h1>Unsaved edit</h1>' } }));
    await act(async () => Simulate.click([...container.querySelectorAll('button')].find(button => button.textContent === 'Download ZIP')));
    expect(download).toHaveBeenCalledWith([{ path: 'index.html', content: '<h1>Unsaved edit</h1>' }, initial[1]], 'website');
    expect(container.textContent).toContain('Unsaved changes');
  } finally { await act(async () => root.unmount()); container.remove(); download.mockRestore(); }
});
