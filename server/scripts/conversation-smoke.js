require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const assert = require('node:assert/strict');
const { classifyRequest } = require('../agents/intent');
(async () => {
  const request = 'Go to my Notion and create a todo list for a chest workout';
  const first = await classifyRequest(request);
  assert.equal(first.type, 'clarify', `Expected a question, got ${first.type}`);
  assert.ok(first.reply?.trim());
  console.log('Question:', first.reply);
  const second = await classifyRequest('Gym, with dumbbells and a bench. Use my Chest Workout page.', [
    { role: 'user', content: request }, { role: 'assistant', content: first.reply },
  ]);
  assert.equal(second.type, 'task', `Expected continuation of task, got ${second.type}`);
  console.log('PASS: free model asks for missing details, then recognizes the answer as a continuation. No app writes performed.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
