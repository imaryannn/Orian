import { mergeActivity } from './activity';
test('merges polling and socket activity without repeated steps', () => {
  const data = { id: 'event-1', agent: 'router', action: 'task_routed', timestamp: '2026-11-19T12:00:00Z', data: { message: 'Assigned to Notion', agentType: 'notion_action', progress: 20 } };
  const messages = mergeActivity(mergeActivity([], [data]), [data]);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ agentType: 'notion_action', progress: 20, message: 'Assigned to Notion' });
});
test('keeps late replayed events in chronological order', () => {
  const late = { id: 'b', timestamp: '2026-11-19T12:00:02Z', action: 'done' };
  const early = { id: 'a', timestamp: '2026-11-19T12:00:01Z', action: 'started' };
  expect(mergeActivity(mergeActivity([], [late]), [early]).map(m => m.key)).toEqual(['a', 'b']);
});
