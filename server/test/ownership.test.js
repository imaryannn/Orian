const { test } = require('node:test');
const assert = require('node:assert/strict');
let stored;
function stub(relative, exports) { require.cache[require.resolve(relative)] = { id: require.resolve(relative), filename: require.resolve(relative), loaded: true, exports }; }
stub('../db/sqlite', { getGoal: async () => stored });
stub('../queues/taskQueue', {});
stub('../middleware/auth', { requireAuth: (_, __, next) => next() });
const { requireGoalOwner } = require('../routes/goal');
async function request(userId) {
  let status, payload, passed = false;
  const req = { params: { goalId: 'goal' }, user: { userId } };
  const res = { status(value) { status = value; return this; }, json(value) { payload = value; } };
  await requireGoalOwner(req, res, () => { passed = true; });
  return { status, payload, passed, req };
}
test('owner can read and cancel their goal', async () => {
  stored = { id: 'goal', userId: 'owner' };
  const result = await request('owner');
  assert.equal(result.passed, true);
  assert.equal(result.req.goal.id, 'goal');
});
test('another user cannot access a goal by its UUID', async () => {
  stored = { id: 'goal', userId: 'owner' };
  const result = await request('other');
  assert.equal(result.status, 404);
  assert.equal(result.passed, false);
});
test('missing and legacy unowned goals are not exposed', async () => {
  for (const goal of [null, { id: 'goal' }]) {
    stored = goal;
    assert.equal((await request('owner')).status, 404);
  }
});
