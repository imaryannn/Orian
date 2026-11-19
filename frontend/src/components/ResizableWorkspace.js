import React, { Children, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'orian_chat_width';
const MIN_CHAT = 240;
const MIN_WORKSPACE = 320;
export default function ResizableWorkspace({ enabled, children }) {
  const container = useRef(null);
  const dragging = useRef(false);
  const bodyStyle = useRef(null);
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_CHAT ? saved : null;
  });
  const widthRef = useRef(width);
  widthRef.current = width;
  const clamp = value => {
    const total = container.current?.getBoundingClientRect().width || 1000;
    return Math.round(Math.max(MIN_CHAT, Math.min(value, Math.max(MIN_CHAT, total - MIN_WORKSPACE - 8))));
  };
  const update = value => {
    const next = clamp(value);
    widthRef.current = next;
    setWidth(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  };
  const restoreBody = () => {
    dragging.current = false;
    if (bodyStyle.current) {
      document.body.style.cursor = bodyStyle.current.cursor;
      document.body.style.userSelect = bodyStyle.current.userSelect;
      bodyStyle.current = null;
    }
    container.current?.classList.remove('is-resizing');
  };
  useEffect(() => () => restoreBody(), []);
  useEffect(() => {
    const node = container.current;
    if (!enabled || !node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (widthRef.current && node.getBoundingClientRect().width > 600) update(widthRef.current);
    });
    observer.observe(node);
    return () => observer.disconnect();
    // The observer reads the current size through refs.
  }, [enabled]);
  const reset = () => { setWidth(null); widthRef.current = null; localStorage.removeItem(STORAGE_KEY); };
  const panes = Children.toArray(children);
  return <div ref={container} className={enabled ? 'coding-session' : ''} style={enabled && width ? { '--chat-width': `${width}px` } : undefined}>
    {panes[0]}
    {enabled && <div className="workspace-divider" role="separator" aria-label="Resize chat and workspace" aria-orientation="vertical" aria-valuemin={MIN_CHAT} aria-valuenow={width || Math.round((container.current?.clientWidth || 1000) * .34)} tabIndex={0} title="Drag to resize · double-click to reset"
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragging.current = true;
        bodyStyle.current = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
        document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
        container.current?.classList.add('is-resizing');
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={event => { if (dragging.current) update(event.clientX - container.current.getBoundingClientRect().left); }}
      onPointerUp={event => { if (!dragging.current) return; restoreBody(); if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={restoreBody} onLostPointerCapture={restoreBody} onDoubleClick={reset}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const current = widthRef.current || container.current.getBoundingClientRect().width * .34;
        update(event.key === 'Home' ? MIN_CHAT : event.key === 'End' ? Number.MAX_SAFE_INTEGER : current + (event.key === 'ArrowRight' ? 20 : -20));
      }}><span /></div>}
    {enabled && panes[1]}
  </div>;
}
