const express = require('express');
const https = require('https');
const router = express.Router();
const { saveIntegration, getIntegration, listIntegrations, deleteIntegration } = require('../db/integrations');
const { requireAuth } = require('../middleware/auth');

function oauthRequest(options, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function popupSuccess(provider, extra = '') {
  return `<!DOCTYPE html><html><body><script>
    window.opener?.postMessage({ type: 'oauth_success', provider: '${provider}'${extra} }, '*');
    window.close();
  </script></body></html>`;
}

function popupError(error) {
  return `<!DOCTYPE html><html><body><script>
    window.opener?.postMessage({ type: 'oauth_error', error: '${error}' }, '*');
    window.close();
  </script></body></html>`;
}

function getRedirectUri(envName) {
  const uri = process.env[envName];
  if (!uri) return uri;
  return uri.replace(/^http:\/\/([^.]+\.onrender\.com)/, 'https://$1');
}

router.get('/integrations/list', requireAuth, async (req, res) => {
  const integrations = await listIntegrations(req.user.userId);
  res.json({ integrations });
});

router.delete('/integrations/:provider', requireAuth, async (req, res) => {
  await deleteIntegration(req.user.userId, req.params.provider);
  res.json({ success: true });
});

router.get('/integrations/:provider/status', requireAuth, async (req, res) => {
  const integration = await getIntegration(req.user.userId, req.params.provider);
  res.json({ connected: !!integration, provider: req.params.provider });
});

// ─── NOTION ───────────────────────────────────────────────────────────────────

router.get('/auth/notion', requireAuth, (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.NOTION_CLIENT_ID,
    response_type: 'code',
    owner: 'user',
    redirect_uri: getRedirectUri('NOTION_REDIRECT_URI'),
    state: req.user.userId,
  });
  res.redirect(`https://api.notion.com/v1/oauth/authorize?${params}`);
});

router.get('/auth/notion/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;
  if (error) return res.send(popupError(error));
  try {
    const credentials = Buffer.from(`${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`).toString('base64');
    const payload = JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: getRedirectUri('NOTION_REDIRECT_URI') });
    const data = await oauthRequest({
      hostname: 'api.notion.com', path: '/v1/oauth/token', method: 'POST',
      headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'Notion-Version': '2022-06-28' },
    }, payload);
    if (data.error) return res.send(popupError(data.error));
    await saveIntegration(userId, 'notion', { accessToken: data.access_token, metadata: { workspaceId: data.workspace_id, workspaceName: data.workspace_name } });
    res.send(popupSuccess('notion', `, workspace: '${data.workspace_name}'`));
  } catch (e) { res.send(popupError(e.message)); }
});

// ─── SLACK ────────────────────────────────────────────────────────────────────

router.get('/auth/slack', requireAuth, (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID,
    scope: 'chat:write,channels:read,files:write,incoming-webhook',
    redirect_uri: getRedirectUri('SLACK_REDIRECT_URI'),
    state: req.user.userId,
  });
  res.redirect(`https://slack.com/oauth/v2/authorize?${params}`);
});

router.get('/auth/slack/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;
  if (error) return res.send(popupError(error));
  try {
    const params = new URLSearchParams({ client_id: process.env.SLACK_CLIENT_ID, client_secret: process.env.SLACK_CLIENT_SECRET, code, redirect_uri: getRedirectUri('SLACK_REDIRECT_URI') });
    const data = await oauthRequest({ hostname: 'slack.com', path: `/api/oauth.v2.access?${params}`, method: 'GET' });
    if (!data.ok) return res.send(popupError(data.error));
    await saveIntegration(userId, 'slack', { accessToken: data.access_token, metadata: { teamId: data.team?.id, teamName: data.team?.name, webhookUrl: data.incoming_webhook?.url } });
    res.send(popupSuccess('slack', `, team: '${data.team?.name}'`));
  } catch (e) { res.send(popupError(e.message)); }
});

// ─── GOOGLE ───────────────────────────────────────────────────────────────────

router.get('/auth/google', requireAuth, (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: getRedirectUri('GOOGLE_REDIRECT_URI'),
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/documents',
    access_type: 'offline',
    prompt: 'consent',
    state: req.user.userId,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/auth/google/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;
  if (error) return res.send(popupError(error));
  try {
    const payload = new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: getRedirectUri('GOOGLE_REDIRECT_URI'), grant_type: 'authorization_code' }).toString();
    const data = await oauthRequest({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) },
    }, payload);
    if (data.error) return res.send(popupError(data.error));
    await saveIntegration(userId, 'google', { accessToken: data.access_token, refreshToken: data.refresh_token, metadata: { scope: data.scope } });
    res.send(popupSuccess('google'));
  } catch (e) { res.send(popupError(e.message)); }
});

// ─── GITHUB ───────────────────────────────────────────────────────────────────

router.get('/auth/github', requireAuth, (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: getRedirectUri('GITHUB_REDIRECT_URI'),
    scope: 'repo,gist',
    state: req.user.userId,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

router.get('/auth/github/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;
  if (error) return res.send(popupError(error));
  try {
    const payload = JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: getRedirectUri('GITHUB_REDIRECT_URI') });
    const data = await oauthRequest({
      hostname: 'github.com', path: '/login/oauth/access_token', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, payload);
    if (data.error) return res.send(popupError(data.error));
    await saveIntegration(userId, 'github', { accessToken: data.access_token, metadata: { scope: data.scope } });
    res.send(popupSuccess('github'));
  } catch (e) { res.send(popupError(e.message)); }
});

// ─── LINEAR ───────────────────────────────────────────────────────────────────

router.get('/auth/linear', requireAuth, (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.LINEAR_CLIENT_ID,
    redirect_uri: getRedirectUri('LINEAR_REDIRECT_URI'),
    response_type: 'code',
    scope: 'read,write',
    state: req.user.userId,
  });
  res.redirect(`https://linear.app/oauth/authorize?${params}`);
});

router.get('/auth/linear/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;
  if (error) return res.send(popupError(error));
  try {
    const payload = JSON.stringify({ client_id: process.env.LINEAR_CLIENT_ID, client_secret: process.env.LINEAR_CLIENT_SECRET, code, redirect_uri: getRedirectUri('LINEAR_REDIRECT_URI'), grant_type: 'authorization_code' });
    const data = await oauthRequest({
      hostname: 'api.linear.app', path: '/oauth/token', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, payload);
    if (data.error) return res.send(popupError(data.error));
    await saveIntegration(userId, 'linear', { accessToken: data.access_token, metadata: { scope: data.scope } });
    res.send(popupSuccess('linear'));
  } catch (e) { res.send(popupError(e.message)); }
});

// ─── DISCORD ──────────────────────────────────────────────────────────────────

router.post('/integrations/discord/connect', requireAuth, async (req, res) => {
  const { webhookUrl } = req.body;
  if (!webhookUrl) return res.status(400).json({ error: 'webhookUrl required' });
  await saveIntegration(req.user.userId, 'discord', { accessToken: webhookUrl, metadata: { webhookUrl } });
  res.json({ success: true });
});

// ─── AIRTABLE ─────────────────────────────────────────────────────────────────

router.post('/integrations/airtable/connect', requireAuth, async (req, res) => {
  const { apiKey, baseId, table, extraFields } = req.body;
  if (!apiKey || !baseId) return res.status(400).json({ error: 'apiKey and baseId required' });
  await saveIntegration(req.user.userId, 'airtable', { accessToken: apiKey, metadata: { baseId, table: table || 'Reports', extraFields: extraFields || '' } });
  res.json({ success: true });
});

// ─── WEBHOOK ──────────────────────────────────────────────────────────────────

router.post('/integrations/webhook/connect', requireAuth, async (req, res) => {
  const { webhookUrl, provider = 'webhook', headers } = req.body;
  if (!webhookUrl) return res.status(400).json({ error: 'webhookUrl required' });
  await saveIntegration(req.user.userId, provider, { accessToken: webhookUrl, metadata: { webhookUrl, headers: headers || '' } });
  res.json({ success: true });
});

router.post('/integrations/github/config', requireAuth, async (req, res) => {
  const { owner, repo, labels, branch, commitPath } = req.body;
  const integration = await require('../db/integrations').getIntegration(req.user.userId, 'github');
  if (!integration) return res.status(404).json({ error: 'github not connected' });
  const meta = JSON.parse(integration.metadata || '{}');
  await require('../db/integrations').saveIntegration(req.user.userId, 'github', {
    accessToken: integration.accessToken,
    metadata: { ...meta, owner, repo, labels: labels || '', branch: branch || 'main', commitPath: commitPath || '' },
  });
  res.json({ success: true });
});

router.post('/integrations/slack/config', requireAuth, async (req, res) => {
  const { channelId } = req.body;
  const integration = await require('../db/integrations').getIntegration(req.user.userId, 'slack');
  if (!integration) return res.status(404).json({ error: 'slack not connected' });
  const meta = JSON.parse(integration.metadata || '{}');
  await require('../db/integrations').saveIntegration(req.user.userId, 'slack', { accessToken: integration.accessToken, metadata: { ...meta, channelId } });
  res.json({ success: true });
});

module.exports = router;
