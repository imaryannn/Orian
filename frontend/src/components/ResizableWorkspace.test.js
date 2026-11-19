import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import ResizableWorkspace from './ResizableWorkspace';
test('drags the chat divider, persists its width, supports keys and resets', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ResizableWorkspace enabled><div>Chat</div><div>Workspace</div></ResizableWorkspace>));
    const split = container.querySelector('.coding-session');
    split.getBoundingClientRect = () => ({ left: 200, width: 1000 });
    const divider = container.querySelector('[role="separator"]');
    await act(async () => Simulate.pointerDown(divider, { button: 0, pointerId: 1 }));
    await act(async () => Simulate.pointerMove(divider, { clientX: 700, pointerId: 1 }));
    await act(async () => Simulate.pointerUp(divider, { pointerId: 1 }));
    expect(split.style.getPropertyValue('--chat-width')).toBe('500px');
    expect(localStorage.getItem('orian_chat_width')).toBe('500');
    expect(document.body.style.cursor).toBe('');
    await act(async () => Simulate.keyDown(divider, { key: 'ArrowLeft' }));
    expect(split.style.getPropertyValue('--chat-width')).toBe('480px');
    await act(async () => Simulate.keyDown(divider, { key: 'Home' }));
    expect(split.style.getPropertyValue('--chat-width')).toBe('240px');
    await act(async () => Simulate.keyDown(divider, { key: 'End' }));
    expect(split.style.getPropertyValue('--chat-width')).toBe('672px');
    await act(async () => Simulate.doubleClick(divider));
    expect(localStorage.getItem('orian_chat_width')).toBeNull();
    expect(split.style.getPropertyValue('--chat-width')).toBe('');
  } finally { await act(async () => root.unmount()); container.remove(); localStorage.clear(); }
});
