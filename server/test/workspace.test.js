const { test } = require('node:test');
const assert = require('node:assert/strict');
const { codeFiles, mergeFiles, validateFiles } = require('../lib/workspace');
test('accepts structured projects and adapts legacy HTML snippets', () => {
  assert.equal(codeFiles({ language: 'javascript', code: '<!doctype html><html></html>' })[0].path, 'index.html');
  assert.equal(codeFiles({ files: [{ path: 'src/app.js', content: 'console.log(1)' }] })[0].path, 'src/app.js');
});
test('AI revisions replace changed files and preserve the rest of the workspace', () => {
  const files = mergeFiles([{ path: 'index.html', content: '<h1>App</h1>' }, { path: 'style.css', content: 'old' }], [{ path: 'style.css', content: 'new' }]);
  assert.deepEqual(files.map(f => f.content), ['<h1>App</h1>', 'new']);
});
test('rejects path traversal, duplicate files and oversized projects', () => {
  for (const path of ['../secret', '/etc/passwd', 'src/../../secret', 'a\\b', 'a//b']) assert.throws(() => validateFiles([{ path, content: '' }]));
  assert.throws(() => validateFiles([{ path: 'x', content: '' }, { path: 'x', content: '' }]));
  assert.throws(() => validateFiles([{ path: 'x', content: 'a'.repeat(2 * 1024 * 1024 + 1) }]));
});

test('test harnesses never overwrite the app entry', () => {
  const files = mergeFiles([{ path: 'index.html', content: '<html><body><button>Calculator</button></body></html>' }], [{ path: 'index.html', content: '<html><head><title>Calculator Evaluation Tests</title></head><body><script>assert(true)</script></body></html>' }]);
  assert.match(files.find(f => f.path === 'index.html').content, /<button>/);
  assert.ok(files.some(f => f.path === 'tests/index.html'));
});
