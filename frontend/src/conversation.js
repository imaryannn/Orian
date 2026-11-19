// Presentation-only compatibility for reports saved by the old delivery formatter.
// The original database record is left intact.
export function normalizeStoredReply(value) {
  const text = typeof value === 'string' ? value : '';
  const legacyLinks = [...text.matchAll(/\[Open notion\]\\?\(\s*(https?:\/\/[^\s)]+)\s*\)/gi)];
  if (legacyLinks.length < 2) return text;
  const lastUrl = legacyLinks[legacyLinks.length - 1][1];
  const body = text.replace(/\[Open notion\]\\?\(\s*https?:\/\/[^\s)]+\s*\)/gi, '').replace(/\\(?=\s|$)/g, '').trim();
  // These legacy confirmations included a long inventory of every exercise.
  const firstSentence = /^Successfully created\b/i.test(body) ? body.match(/^.*?[.!?](?=\s|$)/)?.[0] : null;
  return `${firstSentence || body}\n\n[Open Notion page](${lastUrl})`.trim();
}

export function savedReply(goal) {
  const result = goal?.result;
  return normalizeStoredReply(typeof result === 'string' ? result :
    typeof result?.report === 'string' ? result.report : result?.report?.content || result?.summary?.main || '');
}

export function restoreConversation(goal) {
  const history = (Array.isArray(goal.context) ? goal.context : [])
    .filter(m => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.role === 'assistant' ? normalizeStoredReply(m.content) : m.content }));
  const last = history[history.length - 1];
  if (typeof goal.goal === 'string' && !(last?.role === 'user' && last.content === goal.goal)) {
    history.push({ role: 'user', content: goal.goal });
  }
  const reply = savedReply(goal);
  if (reply) history.push({ role: 'assistant', content: reply });
  else if (goal.status === 'failed') history.push({ role: 'assistant', content: goal.result?.error || 'This task failed. You can retry or ask a follow-up.' });
  else if (goal.status === 'cancelled') history.push({ role: 'assistant', content: 'This task was stopped.' });
  return { history, reply, artifacts: goal.result?.artifacts || goal.artifacts || { code: [], files: [] }, mode: goal.result?.mode };
}
