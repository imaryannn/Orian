const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const composio = require('../services/composio');
const { saveConfig, getAllConfigs } = require('../db/providerConfig');

function popupSuccess(provider) {
  return `<!DOCTYPE html><html><body><script>
    window.opener?.postMessage({ type: 'oauth_success', provider: ${JSON.stringify(String(provider))} }, '*');
    window.close();
  </script></body></html>`;
}

function popupError(error) {
  return `<!DOCTYPE html><html><body><script>
    window.opener?.postMessage({ type: 'oauth_error', error: ${JSON.stringify(String(error))} }, '*');
    window.close();
  </script></body></html>`;
}

function getBaseUrl(req) {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

router.get('/integrations/list', requireAuth, async (req, res) => {
  try {
    const providers = await composio.listProviderStatus(req.user.userId);
    const configs = await getAllConfigs(req.user.userId);
    const configMap = {};
    for (const doc of configs) configMap[doc.provider] = doc.config || {};
    res.json({
      configured: composio.isConfigured(),
      providers: providers.map((p) => ({ ...p, config: configMap[p.id] || {} })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/integrations/connect', requireAuth, async (req, res) => {
  try {
    if (!composio.isConfigured()) {
      return res.status(503).json({ error: 'composio not configured' });
    }
    const callbackUrl = `${getBaseUrl(req)}/integrations/composio/callback`;
    const link = await composio.createConnectionLink(req.user.userId, req.body.provider, callbackUrl);
    res.json({ redirectUrl: link.redirectUrl, connectedAccountId: link.connectedAccountId, status: link.status, state: link.state });
  } catch (e) {
    res.status(e.code === 'unknown_provider' ? 400 : 502).json({ error: e.message });
  }
});

router.get('/integrations/composio/callback', async (req, res) => {
  try {
    const { state, status, error } = req.query;
    const connectedAccountId = req.query.connectedAccountId || req.query.connected_account_id;
    if (error) return res.send(popupError(error));
    const pending = composio.consumePendingState(state);
    if (!pending) return res.send(popupError('connection expired or invalid state, please try again'));
    if (status && String(status).toLowerCase() !== 'success') {
      return res.send(popupError(`connection ${status}`));
    }
    const accountId = connectedAccountId || pending.connectedAccountId;
    if (!accountId) return res.send(popupError('missing connectedAccountId'));
    const owned = await composio.ownsAccount(pending.userId, String(accountId));
    if (!owned) return res.send(popupError('connected account not linked to this user'));
    res.send(popupSuccess(pending.providerId));
  } catch (e) {
    res.send(popupError(e.message));
  }
});

router.delete('/integrations/:provider', requireAuth, async (req, res) => {
  try {
    await composio.disconnectProvider(req.user.userId, req.params.provider);
    res.json({ success: true });
  } catch (e) {
    res.status(e.code === 'unknown_provider' ? 404 : 502).json({ error: e.message });
  }
});

router.post('/integrations/:provider/config', requireAuth, async (req, res) => {
  const provider = composio.getProvider(req.params.provider);
  if (!provider) return res.status(404).json({ error: 'unknown provider' });
  const incoming = (req.body && req.body.config) || {};
  const config = {};
  for (const setting of provider.settings) {
    if (incoming[setting.key] !== undefined && incoming[setting.key] !== null) {
      config[setting.key] = String(incoming[setting.key]);
    }
  }
  try {
    await saveConfig(req.user.userId, req.params.provider, config);
    res.json({ success: true, config });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
