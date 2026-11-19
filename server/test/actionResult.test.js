const { test } = require('node:test');
const assert = require('node:assert/strict');
const { actionLinks, conciseSummary } = require('../tools/actionResult');
test('ignores every search-result link and links only to the created page', () => {
  const action = { provider: 'notion', steps: [
    { tool: 'NOTION_SEARCH_PAGES', result: { results: [{ url: 'https://notion.so/Welcome' }, { url: 'https://notion.so/Todo' }] } },
    { tool: 'NOTION_CREATE_PAGE', result: { url: 'https://notion.so/Chest-Workout' } },
  ] };
  assert.deepEqual(actionLinks(action), ['https://notion.so/Chest-Workout']);
});
test('deduplicates repeated mutation URLs', () => {
  const step = { tool: 'NOTION_UPDATE_PAGE', result: { url: 'https://notion.so/Chest-Workout' } };
  assert.deepEqual(actionLinks({ provider: 'notion', steps: [step, step] }), ['https://notion.so/Chest-Workout']);
});
test('creates a usable document link when the write result contains only its ID', () => {
  assert.deepEqual(actionLinks({ provider: 'google', steps: [{ tool: 'GOOGLEDOCS_CREATE_DOCUMENT', result: { documentId: 'new-doc' } }] }), ['https://docs.google.com/document/d/new-doc/edit']);
});
test('caps verbose confirmations and removes embedded link repetition', () => {
  const summary = conciseSummary('Created your page. '.repeat(100) + '[Open notion](https://notion.so/page)');
  assert.ok(summary.length <= 320);
  assert.ok(!summary.includes('https://'));
});
