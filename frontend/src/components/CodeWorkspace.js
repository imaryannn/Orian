import React, { useEffect, useRef, useState } from 'react';
import { downloadWorkspaceZip } from '../workspaceZip';
import { buildPreview, validFilePath } from '../workspace';
import './CodeWorkspace.css';

export default function CodeWorkspace({ workspace, onChange, onSave, busy = false, projectId, onRepair }) {
  const files = workspace?.files || [];
  const [selected, setSelected] = useState(files[0]?.path || '');
  const [tab, setTab] = useState('preview');
  const [width, setWidth] = useState('desktop');
  const [newFile, setNewFile] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState({ html: '', reason: '' });
  const [blank, setBlank] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState([]);
  const [run, setRun] = useState(0);
  const previewSourceRef = useRef('');
  const frame = useRef(null);
  const editor = useRef(null);
  const gutter = useRef(null);
  const channel = useRef(`orian-preview-${Math.random().toString(36).slice(2)}`).current;
  useEffect(() => { setSelected(''); setDirty(false); setNotice(''); }, [projectId]);
  useEffect(() => {
    if (!files.some(file => file.path === selected)) setSelected(files[0]?.path || '');
  }, [files, selected]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = buildPreview(files, workspace?.entry, channel);
      if (next.html !== previewSourceRef.current) { setErrors([]); setBlank(false); setLoaded(false); previewSourceRef.current = next.html; }
      setPreview(next);
    }, 400);
    return () => clearTimeout(timer);
  }, [workspace, run, channel]);
  useEffect(() => {
    const receive = event => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== channel) return;
      if (event.data.ready) { setLoaded(true); setBlank(Boolean(event.data.empty)); }
      if (event.data.error) setErrors(prev => [...prev.slice(-4), String(event.data.error).slice(0, 500)]);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [channel]);
  const file = files.find(file => file.path === selected);
  const change = next => { setDirty(true); setNotice(''); onChange(next); };
  const save = async () => {
    if (busy || saving || !files.length) return;
    setSaving(true);
    try { await onSave(workspace); setDirty(false); setNotice('Saved to this conversation'); }
    catch (error) { setNotice(error.message); }
    finally { setSaving(false); }
  };
  const download = () => {
    if (!file) return;
    const url = URL.createObjectURL(new Blob([file.content], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = file.path.split('/').pop(); a.click(); URL.revokeObjectURL(url);
  };
  const downloadProject = () => {
    try { downloadWorkspaceZip(files, projectId); setNotice('Project ZIP downloaded, including current edits and folder paths.'); }
    catch (error) { setNotice(error.message); }
  };
  const addFile = event => {
    event.preventDefault();
    if (!validFilePath(newFile) || files.some(f => f.path === newFile) || files.length >= 32) { setNotice('Choose a unique relative filename (up to 32 files).'); return; }
    change({ ...workspace, files: [...files, { path: newFile, content: '' }] }); setSelected(newFile); setTab('code'); setAdding(false); setNewFile('');
  };
  return <section className="code-workspace" aria-label="Coding workspace">
    <header className="workspace-header"><div className="workspace-project-title"><span className="workspace-project-icon" aria-hidden="true">⌘</span><div><strong>Project workspace</strong><span>{busy ? 'Building your app' : dirty ? 'Unsaved changes' : 'Changes saved with this chat'}</span></div></div>
      <div className="workspace-project-actions"><button onClick={downloadProject} disabled={busy || !files.length} title="Download all project files and folders as a ZIP">Download ZIP</button><button onClick={save} disabled={busy || saving || !files.length}>{saving ? 'Saving…' : 'Save'}</button></div>
    </header>
    <nav className="workspace-toolbar" aria-label="Workspace views">
      <div role="tablist"><button role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>Preview</button><button role="tab" aria-selected={tab === 'code'} onClick={() => setTab('code')}>Code</button></div>
      <div><button aria-label="Desktop preview" aria-pressed={width === 'desktop'} onClick={() => setWidth('desktop')}>Desktop</button><button aria-label="Mobile preview" aria-pressed={width === 'mobile'} onClick={() => setWidth('mobile')}>Mobile</button><button aria-label="Reload preview" onClick={() => { setLoaded(false); setRun(n => n + 1); }}>↻</button></div>
    </nav>
    <div className="workspace-address-bar"><span className={`workspace-status-dot${busy ? ' building' : ''}`} /><span>{workspace?.entry || 'Waiting for app files'}</span><span>{busy ? 'Generating' : preview.html ? 'Browser preview' : 'Preview unavailable'}</span>{files.filter(f => f.path.endsWith('.html')).length > 1 && <select aria-label="Preview entry" value={workspace.entry} onChange={e => change({ ...workspace, entry: e.target.value })}>{files.filter(f => f.path.endsWith('.html')).map(f => <option key={f.path} value={f.path}>{f.path}</option>)}</select>}</div>
    {workspace?.recovered && <p className="workspace-notice">Restored the app interface from your saved artifacts. Save to keep this version.</p>}
    {notice && <p className="workspace-notice" role="status">{notice}</p>}
    {tab === 'code' ? <div className="workspace-code">
      <aside className="workspace-files" aria-label="Project files"><div className="workspace-files-heading">Files <button aria-label="Add file" disabled={busy} onClick={() => setAdding(v => !v)}>+</button></div>
        {adding && <form onSubmit={addFile}><input aria-label="New file path" placeholder="styles.css" value={newFile} onChange={e => setNewFile(e.target.value)} /><button type="submit">Add</button></form>}
        {files.map(f => <button key={f.path} className={f.path === selected ? 'selected' : ''} onClick={() => setSelected(f.path)} title={f.path}>{f.path}</button>)}
      </aside>
      <div className="workspace-editor-panel"><div className="workspace-file-tab"><span>{file?.path || 'No file selected'}</span><button disabled={!file} onClick={download}>Download file</button></div>
        {file ? <div className="workspace-editor"><pre ref={gutter} aria-hidden="true">{file.content.split('\n').map((_, i) => i + 1).join('\n')}</pre><textarea ref={editor} aria-label={`Edit ${file.path}`} value={file.content} spellCheck={false} readOnly={busy || saving} onScroll={e => { if (gutter.current) gutter.current.scrollTop = e.target.scrollTop; }} onChange={e => change({ ...workspace, files: files.map(f => f.path === selected ? { ...f, content: e.target.value } : f) })} onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
          if (e.key === 'Tab' && !busy) { e.preventDefault(); const start = e.target.selectionStart; const end = e.target.selectionEnd; const content = file.content.slice(0, start) + '  ' + file.content.slice(end); change({ ...workspace, files: files.map(f => f.path === selected ? { ...f, content } : f) }); requestAnimationFrame(() => editor.current?.setSelectionRange(start + 2, start + 2)); }
        }} /></div> : <div className="workspace-empty">Generated files will appear here.</div>}
      </div>
    </div> : <div className={`workspace-preview ${width}`}>
      {preview.html && !blank ? <iframe onLoad={() => setLoaded(true)} key={run} ref={frame} title="Project live preview" srcDoc={preview.html} sandbox="allow-scripts" /> : <div className="workspace-empty"><div className="workspace-empty-icon" aria-hidden="true">{busy ? '◌' : '◇'}</div><strong>{busy ? 'Bringing your idea to life' : blank ? 'The page has no visible interface' : 'Your app belongs here'}</strong><p>{blank ? 'The current entry loaded, but it did not render anything. Choose a different entry or ask Orian to repair it.' : files.length ? preview.reason : 'Orian is preparing the files. The live preview will open here as soon as the interface is ready.'}</p>{!busy && files.length > 0 && onRepair && <button onClick={onRepair}>Repair preview ↗</button>}</div>}
    </div>}
    {preview.html && !loaded && !blank && <p className="workspace-loading" role="status">Loading preview…</p>}
    {errors.length > 0 && <div className="workspace-errors" role="alert"><strong>Preview errors</strong>{errors.map((error, i) => <pre key={i}>{error}</pre>)}</div>}
    <footer className="workspace-footer">{files.length} files · {tab === 'preview' ? 'HTML, CSS & JavaScript browser preview' : '⌘ / Ctrl + S to save'}<span>Ask in chat to revise this project</span></footer>
  </section>;
}
