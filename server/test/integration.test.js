const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
function stub(relative, exports) { require.cache[require.resolve(relative)] = { id: require.resolve(relative), filename: require.resolve(relative), loaded: true, exports }; }
let connected, decisions, calls;
const schema = { type: 'object', properties: { title: { type: 'string' }, parent_id: { type: 'string' } }, required: ['title', 'parent_id'] };
stub('../tools/llm', { callLLMJson: async prompt => {
  if (prompt.includes('exact JSON input schemas')) assert.match(prompt, /parent_id/);
  return decisions.shift();
} });
stub('../services/composio', {
  isToolAllowed: () => true,
  getProvider: () => ({ toolkit: 'notion', label: 'notion' }),
  getConnectedProviderIds: async () => connected,
  getToolkitTools: async () => [{ slug: 'NOTION_CREATE_PAGE', description: 'Create page', inputSchema: schema }],
  executeTool: async (...args) => { calls.push(args); return { id: 'real-page-id', url: 'https://notion.so/real-page-id' }; },
});
stub('../db/providerConfig', { getConfig: async () => ({ parentPageId: 'real-parent-id' }) });
stub('../sockets/socket', { emitAgentActivity() {} });
stub('../db/sqlite', { addTaskLog: async () => {} });
const { runIntegrationAgent } = require('../agents/integrationAgent');
beforeEach(() => {
  connected = ['notion']; calls = [];
  decisions = [{ tools: ['NOTION_CREATE_PAGE'] }, { tool: 'NOTION_CREATE_PAGE', arguments: { title: 'Requested title', parent_id: 'real-parent-id' } }, { done: true, summary: 'Created the requested page' }];
});
test('uses discovered schemas, correct user, and actual tool results', async () => {
  const result = await runIntegrationAgent('goal', 'Create page', 'notion', 'user', null);
  assert.equal(calls[0][0], 'user');
  assert.equal(calls[0][2].parent_id, 'real-parent-id');
  assert.equal(result.steps[0].result.id, 'real-page-id');
});
test('does not execute tools for disconnected apps', async () => {
  connected = [];
  await assert.rejects(runIntegrationAgent('goal', 'Create page', 'notion', 'user', null), /Connect notion/);
  assert.equal(calls.length, 0);
});
test('rejects model-invented tool names', async () => {
  decisions[1].tool = 'FAKE_CREATE_PAGE';
  await assert.rejects(runIntegrationAgent('goal', 'Create page', 'notion', 'user', null), /Invalid connector/);
  assert.equal(calls.length, 0);
});
test('does not repeat an identical successful action', async () => {
  decisions[2] = decisions[1];
  await assert.rejects(runIntegrationAgent('goal', 'Create page', 'notion', 'user', null), /repeat/);
  assert.equal(calls.length, 1);
});

test('asks about an ambiguous destination without executing a write', async () => {
  decisions[1] = { question: 'Which project page should I use: Personal or Work?' };
  const result = await runIntegrationAgent('goal', 'Create page', 'notion', 'user', null);
  assert.equal(result.needsInput, true);
  assert.match(result.question, /Personal or Work/);
  assert.equal(calls.length, 0);
});
