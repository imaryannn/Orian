const { test } = require('node:test');
const assert = require('node:assert/strict');
const { groupConversations } = require('../lib/conversations');
test('one entry per explicit conversation points to latest turn and keeps original title', () => {
  const rows = groupConversations([
    { id: '1', conversationId: 'chat', goal: 'Build a calculator', createdAt: '1' },
    { id: '2', conversationId: 'chat', goal: 'Make it blue', createdAt: '2' },
    { id: '3', conversationId: 'other', goal: 'Hi', createdAt: '3' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].id, '2');
  assert.equal(rows[1].conversationTitle, 'Build a calculator');
});
test('legacy prompts group by exact preceding conversation instead of prompt text', () => {
  const rows = groupConversations([
    { id: 'a', goal: 'Hi', createdAt: '1', result: { report: { content: 'Hello A' } } },
    { id: 'b', goal: 'Hi', createdAt: '2', result: { report: { content: 'Hello B' } } },
    { id: 'c', goal: 'Build a calculator', createdAt: '3', context: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello A' }, { role: 'user', content: 'Build a calculator' }] },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].conversationId, 'a');
  assert.equal(rows[1].conversationId, 'b');
});
