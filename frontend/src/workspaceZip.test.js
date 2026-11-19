import { TextEncoder, TextDecoder } from 'util';
import { buildWorkspaceZip } from './workspaceZip';
global.TextEncoder = TextEncoder;
test('exports nested folders, standalone files, empty files and Unicode contents', () => {
  const files = [{ path: 'index.html', content: '<h1>Hello 🌍</h1>' }, { path: 'src/components/button.js', content: 'export const label = "नमस्ते";' }, { path: 'assets/styles/main.css', content: 'body {color: green}' }, { path: 'empty.txt', content: '' }];
  const zip = buildWorkspaceZip(files);
  const view = new DataView(zip.buffer);
  let offset = 0;
  const decoded = [];
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const start = offset + 30 + nameLength;
    const decoder = new TextDecoder();
    decoded.push({ path: decoder.decode(zip.slice(offset + 30, start)), content: decoder.decode(zip.slice(start, start + size)) });
    offset = start + size;
  }
  expect(decoded).toEqual(files);
  expect(view.getUint32(offset, true)).toBe(0x02014b50);
  expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
  expect(view.getUint16(zip.length - 12, true)).toBe(files.length);
});
test('rejects unsafe paths and duplicate filenames instead of exporting a broken project', () => {
  expect(() => buildWorkspaceZip([])).toThrow();
  expect(() => buildWorkspaceZip([{ path: '../private', content: '' }])).toThrow();
  expect(() => buildWorkspaceZip([{ path: 'index.html', content: 'a' }, { path: 'index.html', content: 'b' }])).toThrow();
});
