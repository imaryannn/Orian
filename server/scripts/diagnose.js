require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const axios = require('axios');
const { testModelConnection, DEFAULT_MODEL_ID } = require('../tools/llm');
const composio = require('../services/composio');
(async () => {
  const models = await axios.get('https://openrouter.ai/api/v1/models', { timeout: 20000 });
  const free = models.data.data.filter(m => m.id === DEFAULT_MODEL_ID || m.id.endsWith(':free'));
  console.log('Free models available:', free.length);
  console.log('Default model available:', free.some(m => m.id === DEFAULT_MODEL_ID));
  console.log('Free inference:', await testModelConnection(DEFAULT_MODEL_ID));
  if (composio.isConfigured()) {
    for (const toolkit of ['notion', 'googledocs']) {
      const tools = await composio.getToolkitTools(toolkit);
      console.log(`${toolkit}: ${tools.length} discovered tools; ${tools.filter(t => t.inputSchema).length} input schemas`);
    }
    // A count only: don't display account IDs, tokens, or private documents.
    const { Composio } = require('@composio/core');
    const client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
    const accounts = await client.connectedAccounts.list({ limit: 100 });
    const items = accounts.items || [];
    console.log('Connector accounts:', items.length, 'active:', items.filter(a => a.status === 'ACTIVE').length);
  } else console.log('Set COMPOSIO_API_KEY to enable app connections.');
})().catch(error => { console.error('Diagnostic failed:', error.response?.status || error.code || error.name, error.message); process.exitCode = 1; });
