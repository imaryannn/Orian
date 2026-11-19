const { spawn } = require('node:child_process');
const path = require('node:path');
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (_) {}
  }
  process.exitCode = code;
}
for (const folder of ['server', 'frontend']) {
  const child = spawn('npm', ['start'], { cwd: path.join(__dirname, '..', folder), stdio: 'inherit', env: process.env, detached: true });
  children.push(child);
  child.on('error', error => { console.error(`${folder}: ${error.message}`); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 0); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
