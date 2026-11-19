const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validatePlan, getExecutionOrder } = require('../agents/planner');
function task(id, depends_on = [], type = 'analysis') { return { id, depends_on, type, task: `Task ${id}` }; }
test('dependent tasks are scheduled in a later batch', () => {
  assert.deepEqual(getExecutionOrder({ subtasks: [task(1), task(2, [1]), task(3)] }), [[1, 3], [2]]);
});
test('rejects empty plans, duplicate IDs, unknown dependencies and cycles', () => {
  for (const subtasks of [[], [task(1), task(1)], [task(1, [2])], [task(1, [2]), task(2, [1])]]) {
    assert.equal(validatePlan({ subtasks }), false);
  }
});
test('accepts app and research types actually supported by the executor', () => {
  for (const type of ['notion_action', 'google_action', 'linear_action', 'airtable_action', 'web_search', 'code_execution']) {
    assert.equal(validatePlan({ subtasks: [task(1, [], type)] }), true);
  }
});
