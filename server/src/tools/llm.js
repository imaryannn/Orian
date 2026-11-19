const { callLLMMessages, parseJsonResponse } = require('../../tools/llm');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRetryDelayMs(error, fallbackMs) {
  const message = error?.message || '';
  const match = message.match(/try again in\s+(\d+(?:\.\d+)?)s/i) || message.match(/(\d+(?:\.\d+)?)s/);
  return match ? Math.ceil(Number(match[1]) * 1000) + 500 : fallbackMs;
}

async function withBackoff(fn, options = {}) {
  const retries = options.retries ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retryable = /429|rate limit|timeout|ECONNRESET|ETIMEDOUT/i.test(error?.message || '');
      if (!retryable || attempt === retries) break;

      const exponentialDelay = Math.min(baseDelayMs * (2 ** attempt), 15000);
      await sleep(extractRetryDelayMs(error, exponentialDelay));
    }
  }

  throw lastError;
}

async function callLLM(messages, options = {}) {
  return callLLMMessages(messages, options);
}

async function callLLMJson(messages, options = {}) {
  const content = await callLLM(messages, options);
  return parseJsonResponse(content);
}

module.exports = {
  callLLM,
  callLLMJson,
  withBackoff,
};
