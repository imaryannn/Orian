const path = require('node:path');
function validateFiles(files) {
  if (!Array.isArray(files) || files.length > 32) throw new Error('Workspace supports up to 32 files');
  const seen = new Set();
  let size = 0;
  return files.map(file => {
    const name = file?.path;
    if (typeof name !== 'string' || !name || name.length > 180 || name.includes('\\') || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..') || /[^\w./ -]/.test(name) || seen.has(name)) throw new Error('Invalid or duplicate workspace file path');
    if (typeof file.content !== 'string') throw new Error('Workspace file content must be text');
    size += Buffer.byteLength(file.content);
    if (size > 2 * 1024 * 1024) throw new Error('Workspace exceeds 2 MB');
    seen.add(name);
    return { path: name, content: file.content, language: typeof file.language === 'string' ? file.language.slice(0, 30) : path.extname(name).slice(1) };
  });
}
function codeFiles(result) {
  if (Array.isArray(result.files) && result.files.length) return validateFiles(result.files);
  if (typeof result.code !== 'string' || !result.code.trim()) throw new Error('Model returned no code');
  const language = result.language || 'javascript';
  const ext = /<!doctype|<html[\s>]/i.test(result.code) || language === 'html' ? 'html' : ({ javascript: 'js', typescript: 'ts', python: 'py', css: 'css', jsx: 'jsx', tsx: 'tsx', bash: 'sh' }[language] || 'txt');
  return validateFiles([{ path: ext === 'html' ? 'index.html' : `main.${ext}`, content: result.code, language }]);
}
function isTestPage(source = '', name = '') {
  return /\b(?:tests?|specs?|evaluation)\b/i.test(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') || /(?:^|[/.-])(?:tests?|spec)(?:[/.-]|$)/i.test(name);
}
function mergeFiles(previous = [], next = []) {
  const safeNext = next.map(file => file.path.endsWith('.html') && isTestPage(file.content, file.path) && !file.path.startsWith('tests/') ? { ...file, path: `tests/${file.path}` } : file);
  return validateFiles([...new Map([...previous, ...safeNext].map(file => [file.path, file])).values()]);
}
module.exports = { validateFiles, codeFiles, mergeFiles, isTestPage };
