require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const fs = require('node:fs/promises');
const path = require('node:path');
const { initializeDatabase, createGoal, getGoal, closeDatabase } = require('../db/sqlite');
const { executeGoal } = require('../tools/executor');
const ids = [];
async function run(goal, context = []) {
  const id = randomUUID(); ids.push(id);
  const now = new Date().toISOString();
  await createGoal({ id, goal, status: 'queued', createdAt: now, updatedAt: now, context });
  await executeGoal(id, { goal, context }, null);
  const saved = await getGoal(id);
  if (saved.status !== 'completed' || !saved.result?.report?.content) throw new Error('Missing persisted completion');
  return saved.result;
}
(async () => {
  await initializeDatabase();
  const first = await run('My favorite color is turquoise. Remember that for this conversation.');
  const second = await run('What is my favorite color?', [
    { role: 'user', content: 'My favorite color is turquoise. Remember that for this conversation.' },
    { role: 'assistant', content: first.report.content },
    { role: 'user', content: 'What is my favorite color?' },
  ]);
  if (!/turquoise/i.test(second.report.content)) throw new Error('Conversation memory failed');
  console.log('PASS: real chat inference, conversation memory, persisted completion');
  const report = await run('Create a short local markdown file explaining three benefits of reading books. No web research or external apps.');
  if (!report.artifacts.files.length) throw new Error('No file artifact');
  for (const file of report.artifacts.files) await fs.access(file.filepath);
  console.log('PASS: real planner, specialist, critic, summarizer, saved report and artifacts');
})().catch(error => { console.error('SMOKE FAILED:', error.message); process.exitCode = 1; }).finally(async () => {
  // Remove only records/files created by this diagnostic, never existing user data.
  if (mongoose.connection.readyState === 1) {
    await mongoose.model('Goal').deleteMany({ _id: { $in: ids } });
    await mongoose.model('TaskLog').deleteMany({ goalId: { $in: ids } });
    await mongoose.model('File').deleteMany({ goalId: { $in: ids } });
    for (const id of ids) await fs.rm(path.join(__dirname, '../uploads', id), { recursive: true, force: true });
  }
  await closeDatabase();
});
