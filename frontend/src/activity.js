export function mergeActivity(previous, events) {
  const byId = new Map(previous.map(event => [event.key, event]));
  for (const data of events) {
    const agent = data.agent?.toLowerCase() || 'assistant';
    const key = data.id || `${agent}:${data.action}:${data.timestamp}`;
    byId.set(key, {
      key, agent, action: data.action,
      message: data.data?.message || data.action?.replace(/_/g, ' '),
      agentType: data.data?.agentType || data.data?.agent || null,
      progress: data.data?.progress, timestamp: data.timestamp,
    });
  }
  return [...byId.values()].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}
