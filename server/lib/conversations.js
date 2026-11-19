const { createHash } = require('node:crypto');
function fingerprint(messages) { return createHash('sha256').update(JSON.stringify(messages.map(m => ({ role: m.role, content: m.content })))).digest('hex'); }
function beforeGoal(goal) {
  const context = [...(goal.context || [])];
  if (context.at(-1)?.role === 'user' && context.at(-1).content === goal.goal) context.pop();
  return context;
}
// Exact history matching links older records without merging unrelated chats that both start with "hi".
function groupConversations(goals) {
  const endings = new Map();
  const grouped = new Map();
  for (const goal of [...goals].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
    const id = goal.id || goal._id;
    const history = beforeGoal(goal);
    const parent = history.length ? endings.get(fingerprint(history)) : null;
    const conversationId = goal.conversationId || parent?.conversationId || id;
    const existing = grouped.get(conversationId);
    const conversationTitle = goal.conversationTitle || existing?.conversationTitle || parent?.conversationTitle || goal.goal;
    const entry = { ...goal, id, conversationId, conversationTitle };
    grouped.set(conversationId, entry);
    const reply = typeof goal.result === 'string' ? goal.result : goal.result?.report?.content || goal.result?.summary?.main;
    if (reply) endings.set(fingerprint([...history, { role: 'user', content: goal.goal }, { role: 'assistant', content: reply }]), entry);
  }
  return [...grouped.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
module.exports = { groupConversations };
