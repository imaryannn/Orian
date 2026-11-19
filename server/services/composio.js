const { Composio } = require('@composio/core');
const crypto = require('crypto');

const PROVIDERS = {
  notion: {
    toolkit: 'notion',
    label: 'notion',
    settings: [{ key: 'parentPageId', placeholder: 'parent page id (optional)' }],
  },
  slack: {
    toolkit: 'slack',
    label: 'slack',
    settings: [{ key: 'channelId', placeholder: 'channel id (e.g. C01234ABCDE)' }],
  },
  google: {
    toolkit: 'googledocs',
    label: 'google docs',
    settings: [],
  },
  github: {
    toolkit: 'github',
    label: 'github',
    settings: [
      { key: 'owner', placeholder: 'owner (github username/org)' },
      { key: 'repo', placeholder: 'repo name' },
      { key: 'branch', placeholder: 'branch (default: main)' },
      { key: 'labels', placeholder: 'labels (comma separated, optional)' },
    ],
  },
  linear: {
    toolkit: 'linear',
    label: 'linear',
    settings: [{ key: 'teamId', placeholder: 'team id (optional, first team used if empty)' }],
  },
  airtable: {
    toolkit: 'airtable',
    label: 'airtable',
    settings: [
      { key: 'baseId', placeholder: 'base id (app...)' },
      { key: 'table', placeholder: 'table name (default: Reports)' },
      { key: 'extraFields', placeholder: 'extra fields JSON (optional)' },
    ],
  },
};

const PENDING_TTL_MS = 15 * 60 * 1000;
const TOOL_CACHE_TTL_MS = 30 * 60 * 1000;

let client = null;
const authConfigCache = new Map();
const toolCache = new Map();
const singleToolCache = new Map();
const pendingConnections = new Map();

function isConfigured() {
  return Boolean(process.env.COMPOSIO_API_KEY);
}

function getClient() {
  if (!isConfigured()) {
    const err = new Error('composio not configured');
    err.code = 'composio_not_configured';
    throw err;
  }
  if (!client) client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  return client;
}

function getProvider(providerId) {
  return PROVIDERS[providerId] || null;
}

function toolkitOf(toolSlug) {
  return String(toolSlug).split('_')[0].toLowerCase();
}

function prunePending() {
  const now = Date.now();
  for (const [state, entry] of pendingConnections) {
    if (entry.expiresAt <= now) pendingConnections.delete(state);
  }
}

async function getAuthConfigId(toolkit) {
  const cached = authConfigCache.get(toolkit);
  if (cached) return cached;
  const composio = getClient();
  const configs = await composio.authConfigs.list({ toolkit, limit: 50 });
  const items = configs.items || configs || [];
  let cfg = items.find((c) => c.isComposioManaged && c.authScheme === 'OAUTH2') || items[0];
  if (!cfg) {
    cfg = await composio.authConfigs.create(toolkit, {
      type: 'use_composio_managed_auth',
      name: `Orian ${toolkit}`,
    });
  }
  const id = cfg.id || (cfg.authConfig && cfg.authConfig.id);
  if (!id) throw new Error(`failed to resolve auth config for ${toolkit}`);
  authConfigCache.set(toolkit, id);
  return id;
}

async function createConnectionLink(userId, providerId, callbackUrl) {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    const err = new Error('unknown provider');
    err.code = 'unknown_provider';
    throw err;
  }
  prunePending();
  const authConfigId = await getAuthConfigId(provider.toolkit);
  const state = crypto.randomUUID();
  const separator = callbackUrl.includes('?') ? '&' : '?';
  const request = await getClient().connectedAccounts.link(userId, authConfigId, {
    callbackUrl: `${callbackUrl}${separator}state=${state}`,
  });
  pendingConnections.set(state, {
    userId,
    providerId,
    connectedAccountId: request.id,
    expiresAt: Date.now() + PENDING_TTL_MS,
  });
  return {
    redirectUrl: request.redirectUrl,
    connectedAccountId: request.id,
    status: request.status,
    state,
  };
}

function consumePendingState(state) {
  if (!state) return null;
  prunePending();
  const entry = pendingConnections.get(state) || null;
  pendingConnections.delete(state);
  return entry;
}

async function getConnectedAccounts(userId) {
  const response = await getClient().connectedAccounts.list({ userIds: [userId], limit: 100 });
  return response.items || response || [];
}

function accountToolkit(account) {
  if (!account) return null;
  if (typeof account.toolkit === 'string') return account.toolkit;
  return account.toolkit && account.toolkit.slug ? account.toolkit.slug : null;
}

async function getConnectedToolkitMap(userId) {
  const accounts = await getConnectedAccounts(userId);
  const map = new Map();
  for (const account of accounts) {
    const slug = accountToolkit(account);
    if (!slug) continue;
    const existing = map.get(slug);
    if (!existing || (existing.status !== 'ACTIVE' && account.status === 'ACTIVE')) {
      map.set(slug, account);
    }
  }
  return map;
}

async function listProviderStatus(userId) {
  const statuses = userId && isConfigured() ? await getConnectedToolkitMap(userId) : new Map();
  return Object.entries(PROVIDERS).map(([id, provider]) => {
    const account = statuses.get(provider.toolkit);
    return {
      id,
      label: provider.label,
      toolkit: provider.toolkit,
      settings: provider.settings,
      connected: Boolean(account && account.status === 'ACTIVE'),
      status: account ? account.status : 'NOT_CONNECTED',
      connectedAccountId: account ? account.id : null,
    };
  });
}

async function getConnectedProviderIds(userId) {
  if (!userId || !isConfigured()) return [];
  const list = await listProviderStatus(userId);
  return list.filter((p) => p.connected).map((p) => p.id);
}

async function disconnectProvider(userId, providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    const err = new Error('unknown provider');
    err.code = 'unknown_provider';
    throw err;
  }
  const accounts = await getConnectedAccounts(userId);
  const owned = accounts.filter((a) => accountToolkit(a) === provider.toolkit);
  const composio = getClient();
  for (const account of owned) {
    await composio.connectedAccounts.delete(account.id);
  }
  return owned.length;
}

async function ownsAccount(userId, connectedAccountId) {
  const accounts = await getConnectedAccounts(userId);
  return accounts.some((a) => a.id === connectedAccountId);
}

async function getToolkitTools(toolkit) {
  const cached = toolCache.get(toolkit);
  if (cached && cached.expiresAt > Date.now()) return cached.tools;
  const response = await getClient().tools.getRawComposioTools({
    toolkits: [toolkit],
    limit: 200,
  });
  const raw = Array.isArray(response) ? response : response.items || [];
  const tools = raw.map((tool) => ({
    slug: tool.slug,
    name: tool.name,
    description: String(tool.description || ''),
    version: tool.version,
    inputSchema: tool.inputParameters || { type: 'object', properties: {} },
    required: (tool.inputParameters && tool.inputParameters.required) || [],
    properties: Object.keys((tool.inputParameters && tool.inputParameters.properties) || {}),
  }));
  toolCache.set(toolkit, { tools, expiresAt: Date.now() + TOOL_CACHE_TTL_MS });
  return tools;
}

async function findTool(toolSlug, toolkit) {
  const cached = singleToolCache.get(toolSlug);
  if (cached) return cached;
  const tools = await getToolkitTools(toolkit);
  const found = tools.find((t) => t.slug === toolSlug);
  if (found) return found;
  const response = await getClient().tools.getRawComposioTools({ tools: [toolSlug] });
  const raw = Array.isArray(response) ? response : response.items || [];
  const tool = raw[0];
  if (!tool) {
    const err = new Error(`composio tool not available: ${toolSlug}`);
    err.code = 'tool_not_found';
    throw err;
  }
  const entry = {
    slug: tool.slug,
    name: tool.name,
    description: String(tool.description || ''),
    version: tool.version,
    inputSchema: tool.inputParameters || { type: 'object', properties: {} },
    required: (tool.inputParameters && tool.inputParameters.required) || [],
    properties: Object.keys((tool.inputParameters && tool.inputParameters.properties) || {}),
  };
  singleToolCache.set(toolSlug, entry);
  return entry;
}

function resolveVersion(toolkit, discovered) {
  const envKey = `COMPOSIO_TOOLKIT_VERSION_${toolkit.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  return process.env[envKey] || discovered;
}

function isToolAllowed(toolkit, slug) {
  if (toolkit !== 'github') return true;
  if (/COMMIT|PUSH|MERGE/i.test(slug)) return false;
  return /^GITHUB_(GET|LIST|SEARCH|CHECK|COMPARE|DOWNLOAD)_/.test(slug) || /GIST|ISSUE|COMMENT/.test(slug);
}

async function executeTool(userId, toolSlug, args, toolkit) {
  if (!userId) {
    const err = new Error('missing user context for composio execution');
    err.code = 'missing_user';
    throw err;
  }
  const toolkitSlug = toolkit || toolkitOf(toolSlug);
  if (toolkitOf(toolSlug) !== toolkitSlug) throw new Error('Tool does not belong to the requested app');
  if (!isToolAllowed(toolkitSlug, toolSlug)) {
    throw new Error('GitHub commits and repository writes are disabled');
  }
  const accounts = await getConnectedToolkitMap(userId);
  const account = accounts.get(toolkitSlug);
  if (!account || account.status !== 'ACTIVE') throw new Error(`Connect ${toolkitSlug} before using it`);
  const tool = await findTool(toolSlug, toolkitSlug);
  const version = resolveVersion(toolkitSlug, tool.version);
  await require('../tools/llm').checkLLMCancelled();
  const response = await getClient().tools.execute(toolSlug, {
    userId,
    connectedAccountId: account.id,
    arguments: args,
    ...(version ? { version } : {}),
  });
  if (response && response.successful === false) {
    throw new Error(response.error || `${toolSlug} failed`);
  }
  if (response && response.error && response.successful !== true) {
    throw new Error(response.error);
  }
  return response && response.data !== undefined ? response.data : response;
}

function pickUrl(data) {
  if (!data || typeof data !== 'object') return undefined;
  return (
    data.url ||
    data.html_url ||
    data.shareUrl ||
    data.share_url ||
    data.link ||
    data.webUrl ||
    (data.issue && data.issue.url) ||
    (data.page && data.page.url) ||
    (data.gist && data.gist.html_url) ||
    (data.document && data.document.url) ||
    undefined
  );
}

function normalizeList(data, keys) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key];
  }
  if (Array.isArray(data.data)) return data.data;
  return [];
}

module.exports = {
  PROVIDERS,
  isConfigured,
  getProvider,
  createConnectionLink,
  consumePendingState,
  getConnectedAccounts,
  getConnectedToolkitMap,
  listProviderStatus,
  getConnectedProviderIds,
  disconnectProvider,
  ownsAccount,
  getToolkitTools,
  findTool,
  executeTool,
  isToolAllowed,
  pickUrl,
  normalizeList,
};
