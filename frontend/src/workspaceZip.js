import { validFilePath } from './workspace.js';

// ZIP's standard STORE method keeps project files byte-for-byte intact. No upload or service is needed.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function header(size) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  return { bytes, u16: (at, value) => view.setUint16(at, value, true), u32: (at, value) => view.setUint32(at, value, true) };
}
export function buildWorkspaceZip(files, date = new Date()) {
  if (!Array.isArray(files) || !files.length) throw new Error('There are no project files to download.');
  if (files.length > 65535) throw new Error('Too many files for this ZIP archive.');
  const encoder = new TextEncoder();
  const paths = new Set();
  const localParts = [];
  const directoryParts = [];
  let offset = 0;
  let directorySize = 0;
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  for (const file of files) {
    if (!validFilePath(file?.path) || paths.has(file.path) || typeof file.content !== 'string') throw new Error('The project contains an invalid or duplicate file path.');
    paths.add(file.path);
    const name = encoder.encode(file.path);
    const content = encoder.encode(file.content);
    const crc = crc32(content);
    const local = header(30 + name.length);
    local.u32(0, 0x04034b50); local.u16(4, 20); local.u16(6, 0x0800); // UTF-8 filenames
    local.u16(10, dosTime); local.u16(12, dosDate); local.u32(14, crc);
    local.u32(18, content.length); local.u32(22, content.length); local.u16(26, name.length);
    local.bytes.set(name, 30);
    const entry = header(46 + name.length);
    entry.u32(0, 0x02014b50); entry.u16(4, 20); entry.u16(6, 20); entry.u16(8, 0x0800);
    entry.u16(12, dosTime); entry.u16(14, dosDate); entry.u32(16, crc);
    entry.u32(20, content.length); entry.u32(24, content.length); entry.u16(28, name.length); entry.u32(42, offset);
    entry.bytes.set(name, 46);
    localParts.push(local.bytes, content); directoryParts.push(entry.bytes);
    offset += local.bytes.length + content.length;
    directorySize += entry.bytes.length;
  }
  const end = header(22);
  end.u32(0, 0x06054b50); end.u16(8, files.length); end.u16(10, files.length);
  end.u32(12, directorySize); end.u32(16, offset);
  const result = new Uint8Array(offset + directorySize + end.bytes.length);
  let cursor = 0;
  for (const bytes of [...localParts, ...directoryParts, end.bytes]) { result.set(bytes, cursor); cursor += bytes.length; }
  return result;
}
export function downloadWorkspaceZip(files, projectId) {
  const bytes = buildWorkspaceZip(files);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  const link = document.createElement('a');
  const suffix = String(projectId || 'project').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48);
  link.href = url; link.download = `orian-${suffix}.zip`;
  document.body.appendChild(link);
  try { link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
