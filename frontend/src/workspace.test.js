import { artifactWorkspace, buildPreview, validFilePath, recoverWorkspace } from './workspace';
test('opens old HTML artifacts in the editor', () => {
  expect(artifactWorkspace({ code: [{ language: 'javascript', code: '<!doctype html><h1>App</h1>' }] }).entry).toBe('index.html');
});
test('bundles local styles and scripts into the isolated browser preview', () => {
  const result = buildPreview([{ path: 'index.html', content: '<link rel="stylesheet" href="style.css"><button>Click</button><script src="app.js"></script>' }, { path: 'style.css', content: 'button {color: red}' }, { path: 'app.js', content: 'document.querySelector("button").onclick = () => {}' }], 'index.html');
  expect(result.html).toContain('<style>button {color: red}</style>');
  expect(result.html).toContain('document.querySelector');
  expect(result.html).toContain("connect-src 'none'");
  expect(result.reason).toBe('');
});
test('rewrites local ES modules and reports missing files', () => {
  const files = [{ path: 'index.html', content: '<div id="app"></div><script type="module" src="src/app.js"></script>' }, { path: 'src/app.js', content: "import { x } from './util.js';" }, { path: 'src/util.js', content: 'export const x = 1;' }];
  expect(buildPreview(files, 'index.html').html).toContain('data:text/javascript');
  expect(buildPreview(files.slice(0, 2), 'index.html').reason).toContain('Missing file');
});
test('explains when a non-browser runtime is needed', () => {
  expect(buildPreview([{ path: 'main.py', content: 'print(1)' }], 'main.py').reason).toContain('HTML entry');
  expect(validFilePath('../secrets')).toBe(false);
});

test('recovers the visible calculator from a report when index.html was overwritten by tests', () => {
  const app = '<!DOCTYPE html><html><head><title>Calculator</title></head><body><button>7</button><button>+</button></body></html>';
  const tests = '<!DOCTYPE html><html><head><title>Calculator Evaluation Tests</title></head><body><script>function tokenize(){return []}</script></body></html>';
  const goal = { workspace: { entry: 'index.html', files: [{ path: 'index.html', content: tests }] }, result: { report: { content: 'Calculator implementation\n```html\n' + app + '\n```' } } };
  const recovered = recoverWorkspace(goal);
  expect(recovered.recovered).toBe(true);
  expect(recovered.files.find(f => f.path === 'index.html').content).toBe(app);
  expect(recovered.files.some(f => f.path.startsWith('tests/'))).toBe(true);
  expect(buildPreview(recovered.files, recovered.entry).html).toContain('<button>7</button>');
});
test('preserves saved manual UI edits and shows diagnostics for script-only test pages', () => {
  const workspace = { entry: 'index.html', files: [{ path: 'index.html', content: '<html><body><h1>Manual design</h1></body></html>' }] };
  expect(recoverWorkspace({ workspace }).files).toEqual(workspace.files);
  const result = buildPreview([{ path: 'index.html', content: '<html><head><title>Tests</title></head><body><script>console.log(1)</script></body></html>' }], 'index.html');
  expect(result.html).toBe('');
  expect(result.reason).toContain('tests or scripts');
});
