'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { correlationId, requestMetrics, classifyProviderError, DEFAULT_MAX_PROMPT_CHARS, buildProviderPrompt } = require('../gateway-utils');

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

test('gateway enforces a 12,000 character complete provider prompt ceiling by default', () => {
  assert.equal(DEFAULT_MAX_PROMPT_CHARS,12000);
});

test('provider prompt builder includes gateway instructions in the measured total', () => {
  const prompt=buildProviderPrompt('hello','Jarvis');
  assert.match(prompt,/You are JARVIS/);
  assert.match(prompt,/NO LATEX/);
  assert.match(prompt,/User:\nhello$/);
  assert.equal(buildProviderPrompt('x'.repeat(12000),'Jarvis').length>12000,true);
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
