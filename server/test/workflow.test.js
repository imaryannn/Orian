const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
function stub(relative, exports) { require.cache[require.resolve(relative)] = { id: require.resolve(relative), filename: require.resolve(relative), loaded: true, exports }; }
let status, savedResult, history, searches, intent, completed, plannerContext, analysisContext, steps;
stub('../db/sqlite', {
  getGoal: async () => ({ id: 'goal', status }),
  updateGoalStatus: async (_, next, result) => { if (status !== 'cancelled') { status = next; savedResult = result; } },
  addTaskLog: async () => {},
  saveWorkspace: async (_, workspace) => ({ ...workspace, updatedAt: 'test-version' }),
});
stub('../tools/llm', {
  runWithLLMUser: async (_, fn) => fn(),
  callLLMJson: async prompt => { history = prompt; return intent; },
  callLLM: async prompt => { analysisContext = prompt; return 'Analysis using earlier evidence'; },
});
stub('../agents/planner', {
  runPlanner: async (...args) => { plannerContext = args[5]; return { subtasks: steps }; },
  getExecutionOrder: () => steps.map(t => [t.id]),
  getSubtask: (plan, id) => plan.subtasks.find(t => t.id === id),
});
stub('../agents/router', { routeTask: async (_, t) => ({ taskId: t.id, assignedAgent: t.type }) });
stub('../agents/webAgent', { runWebAgent: async () => { searches++; return { synthesis: { summary: 'Evidence' } }; } });
stub('../agents/fileAgent', { runFileAgent: async (_, content) => ({ filename: 'report.md', content }) });
stub('../agents/codeAgent', { runCodeAgent: async () => ({ code: 'const x = 1', description: 'Updated app', entry: 'index.html', files: [{ path: 'index.html', content: '<h1>Updated app</h1>' }] }) });
stub('../agents/critic', { runCritic: async () => ({ status: 'approved', score: 1 }), isApproved: () => true });
stub('../agents/summarizer', { runSummarizer: async () => ({ summary: 'Done', keyPoints: [] }) });
stub('../agents/integrationAgent', { runIntegrationAgent: async () => ({ provider: 'notion', summary: 'Page created', steps: [{ tool: 'NOTION_CREATE_PAGE', result: { url: 'https://notion.so/test' } }] }) });
stub('../sockets/socket', { emitTaskUpdate() {}, emitTaskComplete: (_, __, r) => { completed = r; }, emitError() {} });
stub('../tools/tracer', { startTrace: () => 'trace', startSpan: () => ({}), endSpan() {}, endTrace() {} });
const { executeGoal, executeTask } = require('../tools/executor');
beforeEach(() => { status = 'queued'; savedResult = null; searches = 0; completed = null; intent = { type: 'chat', reply: 'Your favorite color was blue.' }; steps = [{ id: 1, type: 'analysis', task: 'Explain this' }]; });

test('chat uses history and persists its full result for reconnects', async () => {
  const context = [{ role: 'user', content: 'My favorite color is blue' }];
  await executeGoal('goal', { goal: 'What color did I say?', context }, null);
  assert.match(history, /favorite color is blue/);
  assert.equal(savedResult.report.content, intent.reply);
  assert.equal(completed.report.content, intent.reply);
  assert.equal(searches, 0);
});
test('analysis uses the LLM without web search', async () => {
  const result = await executeTask('goal', { task: 'Explain gravity' }, { assignedAgent: 'analysis' }, null, 'user', 'Earlier context');
  assert.equal(searches, 0);
  assert.match(analysisContext, /Earlier context/);
  assert.match(result.synthesis.summary, /Analysis/);
});
test('task workflows pass conversation to the planner and expose actual connector results', async () => {
  intent = { type: 'task' };
  steps = [{ id: 1, type: 'notion_action', task: 'Create requested page' }];
  const context = [{ role: 'user', content: 'Use the notes above' }];
  await executeGoal('goal', { goal: 'Create a Notion page', context, userId: 'user' }, null);
  assert.deepEqual(plannerContext, context);
  assert.match(savedResult.report.content, /Page created/);
  assert.match(savedResult.report.content, /https:\/\/notion.so\/test/);
  assert.equal(savedResult.actions.length, 1);
});
test('cancelled jobs never emit completion or overwrite cancellation', async () => {
  status = 'cancelled';
  await assert.rejects(executeGoal('goal', { goal: 'hello' }, null), { code: 'cancelled' });
  assert.equal(status, 'cancelled');
  assert.equal(completed, null);
});
test('provider errors are persisted instead of silently turning into task plans', async () => {
  intent = { type: 'invalid' };
  await assert.rejects(executeGoal('goal', { goal: 'hello' }, null), /Invalid intent/);
  assert.equal(status, 'failed');
});

test('essential missing information returns a question without planning or writing', async () => {
  intent = { type: 'clarify', reply: 'Will you train at home or in a gym, and what equipment do you have?' };
  await executeGoal('goal', { goal: 'Create a chest workout in Notion' }, null);
  assert.equal(savedResult.mode, 'clarification');
  assert.match(savedResult.report.content, /home or in a gym/);
  assert.equal(searches, 0);
});

test('coding tasks persist the project while retaining files not changed by the agent', async () => {
  intent = { type: 'task' };
  steps = [{ id: 1, type: 'code_execution', task: 'Update the app' }];
  await executeGoal('goal', { goal: 'Update the app', workspace: { files: [{ path: 'style.css', content: 'body{color:red}' }] } }, null);
  assert.equal(savedResult.workspace.files.length, 2);
  assert.equal(savedResult.workspace.updatedAt, 'test-version');
  assert.ok(savedResult.workspace.files.some(f => f.path === 'style.css'));
  assert.match(savedResult.report.content, /Updated app/);
  assert.ok(!savedResult.report.content.includes('const x'));
});
