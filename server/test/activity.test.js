const { test } = require('node:test');
const assert = require('node:assert/strict');
const persisted = [];
const db = require.resolve('../db/sqlite');
require.cache[db] = { id: db, filename: db, loaded: true, exports: { appendGoalActivity: async (goalId, event) => persisted.push({ goalId, event }) } };
const { emitAgentActivity, emitTaskUpdate } = require('../sockets/socket');
test('persists progress and assignment even without a live socket', async () => {
  emitTaskUpdate(null, 'goal', { stage: 'planning', message: 'Planning your request', progress: 10 });
  emitAgentActivity(null, 'goal', 'router', 'task_routed', { agentType: 'notion_action', message: 'Assigned to Notion agent' });
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0].event.data.progress, 10);
  assert.equal(persisted[1].event.data.agentType, 'notion_action');
  assert.ok(persisted.every(p => p.event.id));
});
