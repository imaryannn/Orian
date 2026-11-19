function isWriteTool(slug) {
  return !/_(SEARCH|GET|LIST|RETRIEVE|FETCH)_/.test(slug) && /_(CREATE|UPDATE|APPEND|INSERT|ADD|POST|PATCH|DELETE|SEND)_/.test(slug);
}
function actionLinks(action) {
  // Search results describe the workspace, not the work we just produced.
  const writes = (action.steps || []).filter(step => isWriteTool(step.tool));
  const links = [];
  for (const step of writes) {
    const result = step.result || {};
    const objects = [result, result.data, result.page, result.document, result.issue].filter(Boolean);
    let url = objects.map(o => o.url || o.html_url || o.webUrl).find(u => typeof u === 'string' && /^https?:\/\//.test(u));
    if (!url && action.provider === 'google') {
      const id = objects.map(o => o.documentId || o.document_id).find(Boolean);
      if (id) url = `https://docs.google.com/document/d/${encodeURIComponent(id)}/edit`;
    }
    if (!url && action.provider === 'notion') {
      const id = objects.map(o => o.id).find(id => typeof id === 'string' && /^[\da-f-]{32,36}$/i.test(id));
      if (id) url = `https://www.notion.so/${id.replace(/-/g, '')}`;
    }
    if (url && !links.includes(url)) links.push(url);
  }
  return links.slice(-3);
}
function conciseSummary(value) {
  const text = String(value || 'Done.').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  return text.length <= 320 ? text : text.slice(0, 317).replace(/\s+\S*$/, '') + '…';
}
module.exports = { actionLinks, conciseSummary, isWriteTool };
