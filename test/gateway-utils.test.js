'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { correlationId, requestMetrics, classifyProviderError, DEFAULT_MAX_PROMPT_CHARS } = require('../gateway-utils');

test('correlation IDs preserve safe supplied IDs and replace unsafe values', () => {
  assert.equal(correlationId('request-12345678'), 'request-12345678');
  assert.match(correlationId('bad id'), /^[0-9a-f-]{36}$/i);
  assert.match(correlationId(''), /^[0-9a-f-]{36}$/i);
});

test('request metrics count prompt characters and serialized UTF-8 bytes', () => {
  const body={prompt:'naïve',responseFormat:'json',botName:'Jarvis'};
  const metrics=requestMetrics(body);
  assert.equal(metrics.promptChars,5);
  assert.equal(metrics.requestBytes,Buffer.byteLength(JSON.stringify(body),'utf8'));
  assert.equal(metrics.responseFormat,'json');
  assert.ok(metrics.model);
});

test('gateway keeps the documented 50,000 character prompt ceiling by default', () => {
  assert.equal(DEFAULT_MAX_PROMPT_CHARS,50000);
});

test('Gemini 429 is classified as provider rate limiting', () => {
  assert.deepEqual(classifyProviderError({response:{status:429}}),{code:'GEMINI_RATE_LIMIT',status:429,category:'provider_rate_limit'});
});

test('Gemini authentication failures are distinct from provider failures', () => {
  assert.equal(classifyProviderError({response:{status:401}}).code,'GEMINI_AUTH_ERROR');
  assert.equal(classifyProviderError({response:{status:403}}).status,403);
});

test('timeouts and upstream 5xx failures have distinct classifications', () => {
  assert.equal(classifyProviderError({code:'ETIMEDOUT'}).code,'GEMINI_TIMEOUT');
  assert.equal(classifyProviderError({response:{status:503}}).code,'GEMINI_PROVIDER_ERROR');
});
