import { normalizeStoredReply, restoreConversation } from './conversation';
const oldReply = "Successfully created a new Notion page titled 'Chest Workout'. The page includes a long list of exercises.\n\\\n[Open notion](https://app.notion.com/p/Welcome)\\\n[Open notion](https://app.notion.com/p/To-Do-List)\\\n[Open notion](https://app.notion.com/p/Chest-Workout)";
test('cleans old saved Notion spam without changing the stored record', () => {
  const cleaned = normalizeStoredReply(oldReply);
  expect(cleaned).toContain("titled 'Chest Workout'.");
  expect(cleaned).toContain('[Open Notion page](https://app.notion.com/p/Chest-Workout)');
  expect(cleaned).not.toMatch(/Welcome|To-Do-List|long list|\\/);
  expect((cleaned.match(/\]\(/g) || [])).toHaveLength(1);
  expect(oldReply).toContain('Welcome');
});
test('supports escaped parentheses in legacy links', () => {
  expect(normalizeStoredReply('[Open notion]\\(https://notion.so/old) [Open notion]\\(https://notion.so/new)')).toBe('[Open Notion page](https://notion.so/new)');
});
test('leaves normal reports with multiple intentional citations intact', () => {
  const report = '[Source one](https://example.com/one)\n[Source two](https://example.com/two)';
  expect(normalizeStoredReply(report)).toBe(report);
});
test('restores the full conversation and current reply without duplicating the last question', () => {
  const goal = { goal: 'Create the list', status: 'completed', context: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Create the list' }], result: { report: { content: oldReply } } };
  const restored = restoreConversation(goal);
  expect(restored.history.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  expect(restored.reply).not.toContain('Welcome');
});
test('restores running tasks and handles a saved string reply', () => {
  expect(restoreConversation({ goal: 'Research this', status: 'running' }).history).toEqual([{ role: 'user', content: 'Research this' }]);
  expect(restoreConversation({ goal: 'Hi', result: 'Hello' }).reply).toBe('Hello');
});
