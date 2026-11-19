import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Loader from './Loader';
jest.mock('./ModelSelector', () => () => null);
test('shows only a typing indicator until actual agent work begins', () => {
  const html = renderToStaticMarkup(<Loader chatHistory={[{ role: 'user', content: 'hi' }]} messages={[
    { key: '1', agent: 'assistant', action: 'initialization', message: 'Starting...' },
    { key: '2', agent: 'assistant', action: 'understanding', message: 'Reading your request and conversation' },
  ]} />);
  expect(html).toContain('loader-chat-dots');
  expect(html).not.toContain('work progress');
  expect(html).not.toContain('Starting...');
  expect(html).not.toContain('Reading your request');
  expect(html).not.toContain('role="progressbar"');
});
test('normal chat replies never show completed workflow logs', () => {
  const html = renderToStaticMarkup(<Loader complete result={{ mode: 'chat' }} chatHistory={[{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello! How can I help you today?' }]} messages={[
    { key: '1', agent: 'assistant', action: 'initialization', message: 'Starting...' },
    { key: '2', agent: 'assistant', action: 'understanding', message: 'Reading your request and conversation' },
  ]} />);
  expect(html).toContain('Hello! How can I help you today?');
  expect(html).not.toContain('work progress');
  expect(html).not.toContain('Starting...');
  expect(html).not.toContain('finished');
});
test('shows the assigned specialist and current connector step', () => {
  const html = renderToStaticMarkup(<Loader chatHistory={[{ role: 'user', content: 'Create a page' }]} messages={[
    { key: '1', agent: 'router', action: 'task_routed', agentType: 'notion_action', message: 'Assigned to Notion', progress: 20 },
    { key: '2', agent: 'notion_action', action: 'executing_tool', message: 'Creating your todo list in Notion' },
  ]} />);
  expect(html).toContain('Notion agent');
  expect(html).toContain('Creating your todo list in Notion');
  expect(html).toContain('Assigned:');
});
test('invites an answer when clarification is needed', () => {
  const html = renderToStaticMarkup(<Loader complete result={{ mode: 'clarification' }} chatHistory={[{ role: 'assistant', content: 'Home or gym?' }]} />);
  expect(html).toContain('Your input needed');
  expect(html).toContain('answer to continue');
});
