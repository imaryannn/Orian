const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const originalPost = axios.post;
process.env.OPENROUTER_API_KEY = 'test-key';
const llm = require('../tools/llm');
afterEach(() => { axios.post = originalPost; });

test('defaults to the free router and rejects paid model overrides', async () => {
  assert.equal(await llm.resolveModelIdForUser(null), 'openrouter/free');
  await assert.rejects(llm.resolveModelIdForUser(null, 'openai/gpt-4o'), { code: 'invalid_model' });
  assert.ok(llm.MODEL_CATALOG.every(m => m.id === 'openrouter/free' || m.id.endsWith(':free')));
});
test('every request has a zero-price provider ceiling', async () => {
  let request;
  axios.post = async (_, body) => { request = body; return { status: 200, data: { choices: [{ message: { content: 'pong' } }] } }; };
  assert.equal(await llm.callLLM('ping'), 'pong');
  assert.deepEqual(request.provider.max_price, { prompt: 0, completion: 0 });
});
test('an unavailable selected free model falls back only to the free router', async () => {
  const models = [];
  axios.post = async (_, body) => {
    models.push(body.model);
    return models.length === 1 ? { status: 404, data: { error: { message: 'model unavailable' } } } : { status: 200, data: { choices: [{ message: { content: 'ok' } }] } };
  };
  await llm.callLLM('ping', { model: 'nvidia/nemotron-3-ultra-550b-a55b:free' });
  assert.deepEqual(models, ['nvidia/nemotron-3-ultra-550b-a55b:free', 'openrouter/free']);
});
test('cancellation stops inference before a provider request', async () => {
  axios.post = async () => { throw new Error('must not call provider'); };
  await assert.rejects(llm.runWithLLMUser(null, () => llm.callLLM('ping'), () => { throw Object.assign(new Error('cancelled'), { code: 'cancelled' }); }), { code: 'cancelled' });
});
test('parses fenced JSON without a second model call', () => {
  assert.deepEqual(llm.parseJsonResponse('```json\n{"ok":true}\n```'), { ok: true });
});

test('Free Auto remains the default even when a legacy server model override is set', async () => {
  const previous = process.env.OPENROUTER_MODEL;
  process.env.OPENROUTER_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
  try { assert.equal(await llm.resolveModelIdForUser(null), 'openrouter/free'); }
  finally { if (previous === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = previous; }
});
