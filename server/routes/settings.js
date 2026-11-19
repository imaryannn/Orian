const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const {
  MODEL_CATALOG,
  DEFAULT_MODEL_ID,
  sanitizeModelId,
  resolveModelIdForUser,
  getSavedModelId,
  saveModelForUser,
  testModelConnection,
} = require('../tools/llm');

router.get('/model', requireAuth, async (req, res) => {
  try {
    const savedModelId = await getSavedModelId(req.user.userId);
    const modelId = await resolveModelIdForUser(req.user.userId);
    res.json({
      configured: Boolean(process.env.OPENROUTER_API_KEY),
      modelId,
      savedModelId,
      defaultModelId: DEFAULT_MODEL_ID,
      available: MODEL_CATALOG,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/model', requireAuth, async (req, res) => {
  try {
    const { modelId } = req.body || {};
    if (!sanitizeModelId(modelId)) {
      return res.status(400).json({
        error: 'invalid model id',
        available: MODEL_CATALOG.map((m) => m.id),
      });
    }
    const saved = await saveModelForUser(req.user.userId, modelId);
    res.json({ success: true, modelId: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/model/test', requireAuth, async (req, res) => {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return res.json({ ok: false, code: 'not_configured', error: 'OPENROUTER_API_KEY not set on server' });
    }
    const { modelId } = req.body || {};
    if (modelId !== undefined && modelId !== null && modelId !== '' && !sanitizeModelId(modelId)) {
      return res.status(400).json({ ok: false, code: 'invalid_model', error: 'invalid model id' });
    }
    const target = modelId ? sanitizeModelId(modelId) : await resolveModelIdForUser(req.user.userId);
    const result = await testModelConnection(target);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, code: e.code || 'provider', error: e.message });
  }
});

module.exports = router;
