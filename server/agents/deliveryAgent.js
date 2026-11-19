const { executeTool, pickUrl, normalizeList, isConfigured, getConnectedProviderIds } = require('../services/composio');
const { getAllConfigs, saveConfig } = require('../db/providerConfig');
const { addTaskLog } = require('../db/sqlite');

function configFor(configs, provider) {
  const doc = configs.find((c) => c.provider === provider);
  return doc ? doc.config || {} : {};
}

async function resolveNotionParent(userId, cfg) {
  if (cfg && cfg.parentPageId) return cfg.parentPageId;
  const data = await executeTool(userId, 'NOTION_SEARCH_NOTION_PAGE', { query: '' }, 'notion');
  const results = normalizeList(data, ['results', 'pages', 'items']);
  const page = results.find((r) => r && r.id && (r.object === 'page' || r.type === 'page' || r.object === undefined));
  return page ? page.id : null;
}

async function deliverViaNotion(userId, cfg, report, goal) {
  const parent = await resolveNotionParent(userId, cfg);
  if (!parent) return { skipped: true, reason: 'no parent page found — set a parent page id in notion settings' };
  const data = await executeTool(userId, 'NOTION_CREATE_NOTION_PAGE', {
    parent_id: parent,
    title: goal.substring(0, 100),
    markdown: report,
  }, 'notion');
  return { delivered: true, url: pickUrl(data), pageId: data && data.id };
}

async function deliverViaSlack(userId, cfg, report, goal) {
  if (!cfg.channelId) return { skipped: true, reason: 'no slack channel configured' };
  const truncated = report.length > 2700 ? report.substring(0, 2700) + '...' : report;
  const text = `*${goal.substring(0, 150)}*\n\n${truncated}\n\ndelivered by *orian* · ${new Date().toUTCString()}`;
  const data = await executeTool(userId, 'SLACK_CHAT_POST_MESSAGE', {
    channel: cfg.channelId,
    text,
  }, 'slack');
  return { delivered: true, channel: data && data.channel, ts: data && data.ts };
}

async function deliverViaGoogleDocs(userId, cfg, report, goal) {
  const data = await executeTool(userId, 'GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN', {
    title: goal.substring(0, 100),
    markdown_text: report,
  }, 'googledocs');
  const documentId = data && (data.documentId || data.document_id || (data.document && data.document.documentId));
  return {
    delivered: true,
    documentId,
    url: pickUrl(data) || (documentId ? `https://docs.google.com/document/d/${documentId}` : undefined),
  };
}

async function deliverViaGitHub(userId, cfg, report, goal) {
  const results = {};
  const gistData = await executeTool(userId, 'GITHUB_CREATE_A_GIST', {
    description: goal.substring(0, 100),
    public: false,
    files: JSON.stringify({ 'report.md': { content: report } }),
  }, 'github');
  results.gist = { url: pickUrl(gistData) || (gistData && gistData.html_url) };

  if (cfg.owner && cfg.repo) {
    const labels = cfg.labels
      ? cfg.labels.split(',').map((l) => l.trim()).filter(Boolean)
      : ['orian-report'];
    const issueData = await executeTool(userId, 'GITHUB_CREATE_AN_ISSUE', {
      owner: cfg.owner,
      repo: cfg.repo,
      title: goal.substring(0, 100),
      body: report.substring(0, 65000),
      labels,
    }, 'github');
    results.issue = {
      url: pickUrl(issueData) || (issueData && issueData.html_url),
      number: issueData && (issueData.number || (issueData.issue && issueData.issue.number)),
    };

    if (cfg.commitPath) {
      const branch = cfg.branch || 'main';
      const filePath = cfg.commitPath.replace(/^\//, '');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const finalPath = filePath.includes('{timestamp}') ? filePath.replace('{timestamp}', timestamp) : filePath;
      const commitData = await executeTool(userId, 'GITHUB_COMMIT_MULTIPLE_FILES', {
        owner: cfg.owner,
        repo: cfg.repo,
        branch,
        message: `orian: ${goal.substring(0, 72)}`,
        upserts: [{ path: finalPath, content: report }],
      }, 'github');
      results.commit = { url: pickUrl(commitData), branch, path: finalPath };
    }
  }

  return { delivered: true, ...results };
}

async function deliverViaLinear(userId, cfg, report, goal) {
  let teamId = cfg.teamId;
  if (!teamId) {
    const data = await executeTool(userId, 'LINEAR_LIST_LINEAR_TEAMS', {}, 'linear');
    const teams = normalizeList(data, ['teams', 'nodes', 'results', 'issues']);
    const first = teams.find((t) => t && (t.id || t.uuid));
    teamId = first ? first.id || first.uuid : null;
    if (teamId) {
      await saveConfig(userId, 'linear', { ...cfg, teamId });
    }
  }
  if (!teamId) return { skipped: true, reason: 'no linear team found — set a team id in linear settings' };
  const data = await executeTool(userId, 'LINEAR_CREATE_LINEAR_ISSUE', {
    team_id: teamId,
    title: goal.substring(0, 100),
    description: report.substring(0, 100000),
  }, 'linear');
  return {
    delivered: true,
    issueUrl: pickUrl(data) || (data && data.issue && data.issue.url),
    issueId: data && data.issue && data.issue.id,
  };
}

async function deliverViaAirtable(userId, cfg, report, goal) {
  if (!cfg.baseId) return { skipped: true, reason: 'no airtable base id configured' };
  const fields = {
    Goal: goal.substring(0, 100),
    Report: report.substring(0, 100000),
    CreatedAt: new Date().toISOString(),
  };
  if (cfg.extraFields) {
    try { Object.assign(fields, JSON.parse(cfg.extraFields)); } catch (_) {}
  }
  const data = await executeTool(userId, 'AIRTABLE_CREATE_RECORDS', {
    baseId: cfg.baseId,
    tableIdOrName: cfg.table || 'Reports',
    records: [{ fields }],
  }, 'airtable');
  const record = data && data.records && data.records[0];
  return { delivered: true, recordId: record && record.id };
}

async function runDeliveryAgent(workflowId, report, goal, userId) {
  console.log(`[DELIVERY] Starting delivery for workflow ${workflowId}`);
  const results = {};
  const lookupId = userId || workflowId;
  const deliverers = {
    notion: deliverViaNotion,
    slack: deliverViaSlack,
    google: deliverViaGoogleDocs,
    github: deliverViaGitHub,
    linear: deliverViaLinear,
    airtable: deliverViaAirtable,
  };

  if (!isConfigured()) {
    results.skipped = { reason: 'composio not configured' };
  } else if (!userId) {
    results.skipped = { reason: 'no user context for delivery' };
  } else {
    let connected;
    try {
      connected = new Set(await getConnectedProviderIds(lookupId));
    } catch (err) {
      connected = null;
      console.warn(`[DELIVERY] connection lookup failed:`, err.message);
    }
    const configs = connected ? await getAllConfigs(lookupId) : [];
    for (const [name, fn] of Object.entries(deliverers)) {
      try {
        if (connected && !connected.has(name)) {
          results[name] = { skipped: true, reason: 'not connected' };
          continue;
        }
        results[name] = await fn(lookupId, configFor(configs, name), report, goal);
      } catch (err) {
        console.warn(`[DELIVERY] ${name} failed:`, err.message);
        results[name] = { error: err.message };
      }
    }
  }

  await addTaskLog(workflowId, 'delivery_complete', 'Delivery complete', results);
  console.log('[DELIVERY] Delivery complete');
  return results;
}

module.exports = { runDeliveryAgent, resolveNotionParent };
