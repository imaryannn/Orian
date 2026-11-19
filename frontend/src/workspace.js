export function htmlScore(source = '', name = '') {
  if (!/<(?:html|body|div|main|button|h1|section)[\s>]/i.test(source)) return -1000;
  const title = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  const test = /\b(?:tests?|specs?|evaluation)\b/i.test(title) || /(?:^|[/.-])(?:tests?|spec)(?:[/.-]|$)/i.test(name);
  const visible = source.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').trim();
  const controls = (source.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').match(/<(?:button|input|h1|canvas|svg|img)\b/gi) || []).length;
  return (visible || controls ? 100 + controls : /id=['"](?:root|app)['"]/.test(source) ? 10 : 0) - (test ? 500 : 0);
}
function htmlSources(text = '') {
  const complete = [...text.matchAll(/<!doctype html[^>]*>[\s\S]*?<\/html>/gi)].map(match => match[0]);
  const fences = [...text.matchAll(/```(?:html)?\s*\n([\s\S]*?)```/gi)].map(match => match[1]).filter(source => /<(?:html|body|main|div)[\s>]/i.test(source));
  if (complete.length || fences.length) return [...complete, ...fences];
  return /^\s*<(?:!doctype|html|body|main|div)/i.test(text) ? [text] : [];
}
export function artifactWorkspace(artifacts = {}, report = '') {
  const byPath = new Map();
  const candidates = [];
  for (const item of artifacts.code || []) {
    if (item.files?.length) {
      for (const file of item.files) {
        const previous = byPath.get(file.path);
        if (!previous || !file.path.endsWith('.html') || htmlScore(file.content, file.path) > htmlScore(previous.content, previous.path)) byPath.set(file.path, file);
        if (file.path.endsWith('.html')) candidates.push(file.content);
      }
    } else if (item.code) {
      const html = /<!doctype|<html[\s>]/i.test(item.code) || item.language === 'html';
      const ext = ({ javascript: 'js', python: 'py', typescript: 'ts', css: 'css' })[item.language] || 'txt';
      const name = html ? (htmlScore(item.code) < 0 ? 'tests/evaluation.html' : 'index.html') : `main.${ext}`;
      byPath.set(name, { path: name, content: item.code, language: item.language });
      if (html) candidates.push(...htmlSources(item.code));
    }
  }
  for (const file of artifacts.files || []) {
    if (/\.(html|css|js|jsx|ts|tsx|py|json)$/.test(file.filename || '') && typeof file.content === 'string' && !byPath.has(file.filename)) byPath.set(file.filename, { path: file.filename, content: file.content });
    candidates.push(...htmlSources(file.content));
  }
  candidates.push(...htmlSources(report));
  const best = candidates.sort((a, b) => htmlScore(b) - htmlScore(a))[0];
  const current = byPath.get('index.html');
  if (best && htmlScore(best) > 0 && (!current || htmlScore(current.content) <= 0)) byPath.set('index.html', { path: 'index.html', content: best, language: 'html' });
  const files = [...byPath.values()];
  return { files, entry: [...files].filter(file => file.path.endsWith('.html')).sort((a, b) => htmlScore(b.content, b.path) - htmlScore(a.content, a.path))[0]?.path || files[0]?.path };
}
export function recoverWorkspace(goal) {
  const current = goal.workspace || goal.result?.workspace;
  const recovered = artifactWorkspace(goal.result?.artifacts, goal.result?.report?.content || '');
  if (!current?.files?.length) return recovered;
  const entry = current.files.find(file => file.path === current.entry) || current.files.find(file => file.path.endsWith('.html'));
  if (!entry || !entry.path.endsWith('.html') || htmlScore(entry.content, entry.path) > 0) return current;
  const app = recovered.files.find(file => file.path === recovered.entry);
  if (!app || htmlScore(app.content, app.path) <= 0) return current;
  return { ...current, files: [...current.files.filter(file => file.path !== app.path), ...(current.files.some(file => file.path === app.path) ? [{ ...entry, path: 'tests/previous-evaluation.html' }] : []), app], entry: app.path, recovered: true };
}
export function validFilePath(path) {
  return Boolean(path && path.length <= 180 && !path.startsWith('/') && !path.includes('\\') && !/[^\w./ -]/.test(path) && !path.split('/').some(p => !p || p === '..' || p === '.'));
}
function resolvePath(from, target) {
  const parts = from.split('/').slice(0, -1);
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}
export function buildPreview(files, entry, channel = 'orian-preview') {
  const map = new Map(files.map(file => [file.path, file.content]));
  const htmlPath = entry?.endsWith('.html') ? entry : files.find(file => file.path.endsWith('.html'))?.path;
  if (!htmlPath) return { html: '', reason: 'Live preview needs an HTML entry file. You can edit and download source files for other languages.' };
  const moduleUrl = (name, ancestors = []) => {
    if (ancestors.includes(name)) throw new Error('Circular local module imports need a build runtime.');
    if (!map.has(name)) throw new Error(`Missing file: ${name}`);
    let source = map.get(name);
    source = source.replace(/((?:from\s*|import\s*)['"])(\.[^'"]+)(['"])/g, (_, start, target, end) => `${start}${moduleUrl(resolvePath(name, target), [...ancestors, name])}${end}`);
    return `data:text/javascript;charset=utf-8,${encodeURIComponent(source).replace(/'/g, '%27')}`;
  };
  try {
    let html = map.get(htmlPath);
    if (typeof html !== 'string') throw new Error(`Missing entry file: ${htmlPath}`);
    if (htmlScore(html, htmlPath) <= 0) return { html: '', reason: 'This file contains tests or scripts without an app interface. Select an app entry file, or ask Orian to build the interface.', empty: true };
    html = html.replace(/<link\b[^>]*href=['"]([^'"]+)['"][^>]*>/gi, (tag, target) => {
      if (/^(?:https?:|data:|\/\/)/i.test(target)) return tag;
      const name = resolvePath(htmlPath, target);
      if (!map.has(name)) throw new Error(`Missing stylesheet: ${name}`);
      return `<style>${map.get(name).replace(/<\/style/gi, '<\\/style')}</style>`;
    });
    html = html.replace(/<script\b([^>]*?)src=['"]([^'"]+)['"]([^>]*)>\s*<\/script>/gi, (tag, before, target, after) => {
      if (/^(?:https?:|data:|\/\/)/i.test(target)) return tag;
      const name = resolvePath(htmlPath, target);
      if (/type=['"]module['"]/.test(before + after)) return `<script type="module" src="${moduleUrl(name)}"></script>`;
      if (!map.has(name)) throw new Error(`Missing script: ${name}`);
      return `<script>${map.get(name).replace(/<\/script/gi, '<\\/script')}</script>`;
    });
    html = html.replace(/<script\b([^>]*type=['"]module['"][^>]*)>([\s\S]*?)<\/script>/gi, (tag, attrs, source) => {
      if (/\bsrc=/.test(attrs)) return tag;
      const rewritten = source.replace(/((?:from\s*|import\s*)['"])(\.[^'"]+)(['"])/g, (_, start, target, end) => `${start}${moduleUrl(resolvePath(htmlPath, target))}${end}`);
      return `<script ${attrs}>${rewritten}</script>`;
    });
    const bridge = `<script>(()=>{const send=data=>parent.postMessage({channel:${JSON.stringify(channel)},...data},'*');addEventListener('error',e=>send({error:e.message||'A preview resource could not load'}));addEventListener('unhandledrejection',e=>send({error:String(e.reason)}));addEventListener('securitypolicyviolation',e=>send({error:'Preview blocked a resource: '+e.blockedURI}));addEventListener('load',()=>setTimeout(()=>{const body=document.body?.cloneNode(true);body?.querySelectorAll('script,style,link').forEach(n=>n.remove());send({ready:true,empty:!body?.textContent.trim()&&!body?.querySelector('button,input,canvas,img,svg,iframe')});},700));})();</script>`;
    const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https: data: blob:; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
    const injected = /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, match => match + policy + bridge) : html.replace(/<!doctype[^>]*>/i, '').replace(/<html\b[^>]*>/i, '') ;
    return { html: /<head\b/i.test(html) ? injected : `<!doctype html><html><head>${policy}${bridge}</head><body>${injected}</body></html>`, reason: '' };
  } catch (error) { return { html: '', reason: error.message }; }
}
