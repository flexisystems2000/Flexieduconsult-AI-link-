'use strict';
const crypto = require('crypto');

const DEFAULT_MAX_PROMPT_CHARS = 12000;
const DEFAULT_MAX_REQUEST_BYTES = 12 * 1024 * 1024;

function correlationId(value) {
  const supplied = String(value || '').trim();
  return /^[A-Za-z0-9._-]{8,100}$/.test(supplied) ? supplied : crypto.randomUUID();
}
function requestMetrics(body = {}) {
  const serialized = JSON.stringify(body || {});
  return {
    promptChars: String(body.prompt || '').length,
    requestBytes: Buffer.byteLength(serialized, 'utf8'),
    responseFormat: String(body.responseFormat || 'text').toLowerCase(),
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  };
}
function buildProviderPrompt(prompt, botName) {\n  const personalities = {\n    Alexa: 'You are Alexa, the official AI assistant for Flexi Digital Academy. Be professional, concise, and helpful.',\n    Jarvis: 'You are JARVIS for Flexi Digital Academy. Be educational and technical.'\n  };\n  const identity = personalities[botName] || personalities.Jarvis;\n  return `${identity}\\n\\nNO LATEX.\\nUse Unicode symbols like:\\n√ π ± ² ³\\n\\nUser:\\n${String(prompt || 'Analyze this')}`;\n}\n\nfunction classifyProviderError(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  const code = String(error?.code || '');
  if (status === 429) return { code: 'GEMINI_RATE_LIMIT', status: 429, category: 'provider_rate_limit' };
  if ([401, 403].includes(status)) return { code: 'GEMINI_AUTH_ERROR', status, category: 'provider_auth' };
  if (status === 408 || ['ECONNABORTED', 'ETIMEDOUT'].includes(code)) return { code: 'GEMINI_TIMEOUT', status: 504, category: 'provider_timeout' };
  if (status >= 500) return { code: 'GEMINI_PROVIDER_ERROR', status: 502, category: 'provider_error' };
  if (status >= 400) return { code: 'GEMINI_REQUEST_ERROR', status: 502, category: 'provider_request_error' };
  return { code: 'AI_PROVIDER_ERROR', status: 502, category: 'provider_network_error' };
}
module.exports = { DEFAULT_MAX_PROMPT_CHARS, DEFAULT_MAX_REQUEST_BYTES, correlationId, requestMetrics, classifyProviderError, buildProviderPrompt };
