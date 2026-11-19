require('dotenv').config({ path: require('node:path').join(__dirname, '../.env'), quiet: true });
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const db = require('../db/sqlite');
const { runCodeAgent } = require('../agents/codeAgent');
const { mergeFiles } = require('../lib/workspace');
const id = randomUUID();
(async () => {
  await db.initializeDatabase();
  const now = new Date().toISOString();
  await db.createGoal({ id, goal: 'Temporary coding workspace check', status: 'running', createdAt: now, updatedAt: now });
  const generated = await runCodeAgent(id, 'Create exactly two files: index.html containing a button labelled Count: 0 with inline JavaScript that increments its count when clicked, and style.css setting the body background to #112233. Link the stylesheet. No external packages.', {}, null);
  assert.ok(generated.files.some(f => f.path === 'index.html'));
  assert.ok(generated.files.some(f => f.path === 'style.css'));
  const revision = await runCodeAgent(id, `Change only style.css to set the body background to #445566. Return only that complete changed file. Existing workspace: ${JSON.stringify(generated.files)}`, {}, null);
  const merged = mergeFiles(generated.files, revision.files);
  assert.ok(merged.find(f => f.path === 'style.css').content.includes('#445566'));
  assert.equal(merged.find(f => f.path === 'index.html').content, generated.files.find(f => f.path === 'index.html').content);
  await db.saveWorkspace(id, { files: merged, entry: 'index.html' });
  const saved = await db.getGoal(id);
  assert.equal(saved.workspace.files.length, merged.length);
  console.log('PASS: free model generated project files, revised the CSS, preserved HTML, and persisted the workspace.');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.model('Goal').deleteOne({ _id: id });
    await mongoose.model('TaskLog').deleteMany({ goalId: id });
  }
  await db.closeDatabase();
});
