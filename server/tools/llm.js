const axios = require('axios');
const { AsyncLocalStorage } = require('async_hooks');
const { getConfig, saveConfig } = require('../db/providerConfig');

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const MODEL_SETTINGS_KEY = 'llm';
const MODEL_CACHE_TTL_MS = 30000;
const DEFAULT_TIMEOUT_MS = 60000;

const MODEL_CATALOG = [
  {
    id: 'openrouter/free',
    label: 'free auto router',
    name: 'OpenRouter Free Router',
    description: 'Automatically selects an available free model. No paid fallback.',
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    label: 'nemotron 3 ultra',
    name: 'NVIDIA Nemotron 3 Ultra (Free)',
    description: 'Planning, reasoning, orchestration, and long-running agent workflows.',
    reasoning: { enabled: false },
  },
];

const DEFAULT_MODEL_ID = 'openrouter/free';

class LLMError extends Error {
  constructor(message, code = 'provider', retryable = false, status = null) {
    super(message);
    this.name = 'LLMError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

const llmContext = new AsyncLocalStorage();
const userModelCache = new Map();

function isAllowedModel(modelId) {
  return typeof modelId === 'string' && MODEL_CATALOG.some((m) => m.id === modelId);
}

function sanitizeModelId(modelId) {
  return isAllowedModel(modelId) ? modelId : null;
}

function runWithLLMUser(userId, fn, checkCancelled) {
  return llmContext.run({ userId: userId || null, checkCancelled }, fn);
}

async function checkLLMCancelled() {
  await llmContext.getStore()?.checkCancelled?.();
}

function getLLMUserId() {
  const store = llmContext.getStore();
  return store ? store.userId : null;
}

function invalidateUserModelCache(userId) {
  if (userId) userModelCache.delete(userId);
  else userModelCache.clear();
}

async function getSavedModelId(userId) {
  if (!userId) return null;
  const cached = userModelCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.modelId;
  let modelId = null;
  try {
    const config = await getConfig(userId, MODEL_SETTINGS_KEY);
    modelId = sanitizeModelId(config && config.modelId) || null;
  } catch (e) {
    console.warn('[LLM] failed to read saved model:', e.message);
  }
  userModelCache.set(userId, { modelId, expiresAt: Date.now() + MODEL_CACHE_TTL_MS });
  return modelId;
}

async function saveModelForUser(userId, modelId) {
  const sanitized = sanitizeModelId(modelId);
  if (!sanitized) {
    throw new LLMError(`invalid model id: ${String(modelId)}`, 'invalid_model', false);
  }
  await saveConfig(userId, MODEL_SETTINGS_KEY, { modelId: sanitized });
  invalidateUserModelCache(userId);
  return sanitized;
}

async function resolveModelIdForUser(userId, explicitModel) {
  if (explicitModel && !isAllowedModel(explicitModel)) {
    throw new LLMError('Only the listed free models are allowed', 'invalid_model');
  }
  const explicit = sanitizeModelId(explicitModel);
  if (explicit) return explicit;
  const saved = await getSavedModelId(userId);
  if (saved) return saved;
  if (explicitModel) {
    console.warn(`[LLM] ignoring non-allowlisted model "${explicitModel}", using default`);
  }
  return DEFAULT_MODEL_ID;
}

function extractProviderMessage(err) {
  const data = err && err.response && err.response.data;
  if (data) {
    if (typeof data.error?.message === 'string' && data.error.message) return data.error.message;
    if (typeof data.message === 'string' && data.message) return data.message;
    if (typeof data === 'string' && data) return data.slice(0, 300);
  }
  return err && err.message ? err.message : 'unknown provider error';
}

function parseRetryAfterMs(err, fallbackMs) {
  const headers = err && err.response && err.response.headers;
  const header = headers && (headers['retry-after'] || headers['x-ratelimit-reset']);
  const headerSec = header ? parseFloat(header) : NaN;
  if (Number.isFinite(headerSec) && headerSec >= 0) return Math.min(Math.ceil(headerSec * 1000) + 500, 60000);
  const message = extractProviderMessage(err);
  const match = message.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)/i);
  if (match) return Math.min(Math.ceil(parseFloat(match[1]) * 1000) + 500, 60000);
  return fallbackMs;
}

function classifyHttpError(status, message, headers) {
  if (status === 401 || status === 403) {
    return new LLMError(message || 'openrouter authentication failed — check OPENROUTER_API_KEY', 'auth', false, status);
  }
  if (status === 402) {
    return new LLMError(message || 'openrouter account has insufficient credits', 'provider', false, status);
  }
  if (status === 429) {
    return new LLMError(message || 'rate limited by openrouter', 'rate_limit', true, status);
  }
  if (status === 404 || (status === 400 && /model|not found|unavailable|disabled/i.test(message || ''))) {
    const transient = /no endpoints|temporarily|try again/i.test(message || '');
    return new LLMError(message || 'model unavailable on openrouter', 'model_unavailable', transient, status);
  }
  if (status >= 500) {
    return new LLMError(message || `openrouter server error (${status})`, 'provider', true, status);
  }
  return new LLMError(message || `openrouter error (${status})`, 'provider', false, status);
}

function classifyNetworkError(err) {
  if (err instanceof LLMError || err?.code === 'cancelled') return err;
  const code = err && err.code;
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test(err && err.message)) {
    return new LLMError('openrouter request timed out', 'timeout', true);
  }
  if (['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'].includes(code) || (err && err.message === 'Network Error')) {
    return new LLMError('network error reaching openrouter', 'network', true);
  }
  return new LLMError((err && err.message) || 'openrouter request failed', 'provider', false);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageContent(message) {
  if (!message) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text || part?.content || '')).join('');
  }
  return '';
}

function buildHeaders() {
  const headers = {
    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'X-Title': 'Orian',
  };
  const referer = process.env.FRONTEND_URL;
  if (referer) headers['HTTP-Referer'] = referer;
  return headers;
}

async function chatCompletion(payload, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new LLMError('OPENROUTER_API_KEY not set', 'not_configured', false);
  }

  const model = await resolveModelIdForUser(getLLMUserId(), payload.model || options.model);
  const timeout = Number(process.env.OPENROUTER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, Math.min((options.retries ?? 3) + 1, 7));

  const requestedMaxTokens = payload.maxTokens ?? options.maxTokens ?? 2048;
  const body = {
    model,
    messages: payload.messages,
    max_tokens: Math.max(requestedMaxTokens, 1024),
    temperature: payload.temperature ?? options.temperature ?? 0.7,
    top_p: payload.topP ?? options.topP ?? 1,
    provider: { max_price: { prompt: 0, completion: 0 } },
  };
  const catalogEntry = MODEL_CATALOG.find((m) => m.id === model);
  if (catalogEntry && catalogEntry.reasoning) body.reasoning = catalogEntry.reasoning;
  if (payload.tools) body.tools = payload.tools;
  if (payload.tool_choice) body.tool_choice = payload.tool_choice;

  console.log(`[LLM] model=${model} messages=${payload.messages.length} prompt=${JSON.stringify(body.messages).length} chars`);

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await llmContext.getStore()?.checkCancelled?.();
      const res = await axios.post(`${OPENROUTER_BASE_URL}/chat/completions`, body, {
        headers: buildHeaders(),
        timeout,
        validateStatus: () => true,
      });

      if (res.status < 200 || res.status >= 300) {
        const providerMessage = extractProviderMessage({ response: res });
        const error = classifyHttpError(res.status, providerMessage, res.headers);
        if (error.code === 'model_unavailable' && body.model !== DEFAULT_MODEL_ID) {
          body.model = DEFAULT_MODEL_ID;
          delete body.reasoning;
          if (attempt < maxAttempts) continue;
        }
        if (error.code === 'rate_limit') {
          error.retryAfterMs = parseRetryAfterMs({ response: res }, 5000);
        }
        lastError = error;
        if (!error.retryable || attempt === maxAttempts) throw error;
        const waitMs = error.retryAfterMs || Math.min(1000 * 2 ** (attempt - 1), 15000);
        console.warn(`[LLM] attempt ${attempt}/${maxAttempts} failed (${error.code}), retrying in ${waitMs}ms: ${error.message}`);
        await sleep(waitMs);
        continue;
      }

      const choice = res.data && res.data.choices && res.data.choices[0];
      const message = choice && choice.message;
      if (!message) {
        lastError = new LLMError('openrouter returned an empty response', 'provider', true, res.status);
        if (attempt === maxAttempts) throw lastError;
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 15000));
        continue;
      }
      if (!messageContent(message) && !message.tool_calls?.length) {
        if (choice.finish_reason === 'length') {
          lastError = new LLMError('model response truncated — reasoning tokens exhausted the budget', 'length', true, res.status);
          body.max_tokens = Math.min(body.max_tokens * 2, 16384);
          console.warn(`[LLM] empty content with finish_reason=length, escalating max_tokens to ${body.max_tokens}`);
        } else {
          lastError = new LLMError('openrouter returned empty content', 'provider', true, res.status);
        }
        if (attempt === maxAttempts) throw lastError;
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 15000));
        continue;
      }
      await llmContext.getStore()?.checkCancelled?.();
      return message;
    } catch (err) {
      const error = classifyNetworkError(err);
      lastError = error;
      if (!error.retryable || attempt === maxAttempts) throw error;
      const waitMs = Math.min(1000 * 2 ** (attempt - 1), 15000);
      console.warn(`[LLM] attempt ${attempt}/${maxAttempts} failed (${error.code}), retrying in ${waitMs}ms: ${error.message}`);
      await sleep(waitMs);
    }
  }

  throw lastError || new LLMError('openrouter request failed', 'provider', false);
}

function parseJsonResponse(response) {
  try {
    return JSON.parse(response);
  } catch (_) {
    const jsonMatch = response.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1]); } catch (_) {}
    }
    const objMatch = response.match(/({[\s\S]*})/);
    if (objMatch) {
      try { return JSON.parse(objMatch[1]); } catch (_) {}
    }
    const arrMatch = response.match(/(\[[\s\S]*\])/);
    if (arrMatch) {
      try { return JSON.parse(arrMatch[1]); } catch (_) {}
    }
    throw new Error('No valid JSON found in response');
  }
}

async function callLLM(prompt, options = {}) {
  const systemPrompt = options.systemPrompt || 'You are a helpful AI assistant.';
  const message = await chatCompletion({
    model: options.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    maxTokens: options.maxTokens ?? 2048,
    temperature: options.temperature ?? 0.7,
    topP: options.topP ?? 1,
    tools: options.tools,
    tool_choice: options.tool_choice,
  }, options);
  return messageContent(message);
}

async function callLLMJson(prompt, options = {}) {
  const jsonRetries = Math.max(1, Math.min(options.jsonRetries ?? 3, 6));
  let lastError;

  for (let i = 0; i < jsonRetries; i++) {
    try {
      const response = await callLLM(prompt, {
        ...options,
        systemPrompt: (options.systemPrompt || 'You are a helpful AI assistant.') +
          '\n\nAlways respond with valid JSON only. No markdown, no extra text.',
      });
      return parseJsonResponse(response);
    } catch (error) {
      lastError = error;
      if (/No valid JSON/.test(error.message)) {
        console.warn(`[LLM] JSON parse failed (attempt ${i + 1}/${jsonRetries}), retrying`);
        continue;
      }
      throw error;
    }
  }

  throw lastError || new LLMError('JSON call failed', 'provider', false);
}

async function callLLMMessages(messages, options = {}) {
  const message = await chatCompletion({
    model: options.model,
    messages,
    maxTokens: options.maxTokens ?? 1200,
    temperature: options.temperature ?? 0.4,
    topP: options.topP ?? 1,
    tools: options.tools,
    tool_choice: options.tool_choice,
  }, options);
  return messageContent(message);
}

async function callLLMMessagesJson(messages, options = {}) {
  const response = await callLLMMessages(messages, options);
  return parseJsonResponse(response);
}

async function testModelConnection(modelId) {
  const model = sanitizeModelId(modelId);
  if (modelId && !model) {
    throw new LLMError(`invalid model id: ${String(modelId)}`, 'invalid_model', false);
  }
  const target = model || (await resolveModelIdForUser(getLLMUserId()));
  const started = Date.now();
  try {
    const content = await callLLM('Reply with the single word: pong', {
      model: target,
      maxTokens: 16,
      temperature: 0,
      retries: 1,
      jsonRetries: 1,
    });
    return {
      ok: true,
      model: target,
      latencyMs: Date.now() - started,
      sample: String(content || '').slice(0, 80).trim(),
    };
  } catch (e) {
    return {
      ok: false,
      model: target,
      code: e.code || 'provider',
      error: e.message,
      latencyMs: Date.now() - started,
    };
  }
}

module.exports = {
  MODEL_CATALOG,
  DEFAULT_MODEL_ID,
  LLMError,
  isAllowedModel,
  sanitizeModelId,
  runWithLLMUser,
  getLLMUserId,
  checkLLMCancelled,
  resolveModelIdForUser,
  getSavedModelId,
  saveModelForUser,
  invalidateUserModelCache,
  chatCompletion,
  callLLM,
  callLLMJson,
  callLLMMessages,
  callLLMMessagesJson,
  parseJsonResponse,
  testModelConnection,
};
