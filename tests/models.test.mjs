import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModelCatalog, modelsForConnection, ModelCatalog } from '../core/models.js';

const now = Date.parse('2026-10-02T12:00:00Z');
const raw = {
  'gpt-5-mini': { litellm_provider: 'openai', mode: 'chat' },
  'openai/gpt-5-mini': { litellm_provider: 'openai', mode: 'chat' },
  'groq/openai/gpt-oss-120b': { litellm_provider: 'groq', mode: 'chat' },
  'deepseek/deepseek-chat': { litellm_provider: 'deepseek', mode: 'chat' },
  'openrouter/google/gemini-2.5-flash': { litellm_provider: 'openrouter', mode: 'chat' },
  'openrouter/typesafe/jev-1.13': { litellm_provider: 'openrouter', mode: 'evaluation' },
  'openrouter/typesafe/jev-router': { litellm_provider: 'openrouter', mode: 'chat' },
  'typesafe/jev-latest': { litellm_provider: 'typesafe', mode: 'evaluation' },
  'text-embedding-3-small': { litellm_provider: 'openai', mode: 'embedding' },
  'responses-only': { litellm_provider: 'openai', mode: 'chat', supported_endpoints: ['/v1/responses'] },
  'retired': { litellm_provider: 'openai', mode: 'chat', deprecation_date: '2026-01-01' },
  'future': { litellm_provider: 'openai', mode: 'chat', deprecation_date: '2026-10-10' },
  'ft:gpt-4o': { litellm_provider: 'openai', mode: 'chat' }
};
const snapshot = () => parseModelCatalog(raw, now);

test('catalog filters by provider and format and removes only the LiteLLM prefix', () => {
  const catalog = snapshot();
  assert.deepEqual(modelsForConnection(catalog, 'https://api.groq.com/openai/v1', 'chat', now), ['openai/gpt-oss-120b']);
  assert.deepEqual(modelsForConnection(catalog, 'https://api.deepseek.com/v1', 'chat', now), ['deepseek-chat']);
  assert.deepEqual(modelsForConnection(catalog, 'https://openrouter.ai/api/v1', 'chat', now), ['google/gemini-2.5-flash']);
  assert.deepEqual(modelsForConnection(catalog, 'https://openrouter.ai/api/alpha', 'decisions', now), ['openai/gpt-6-luna-decisions', 'perplexity/pplx-decider-v1.1-27b', 'typesafe/jev-1.13']);
  assert.deepEqual(modelsForConnection(catalog, 'https://api.typesafe.ai', 'systemone', now), ['jev-1.13.0', 'jev-latest']);
});

test('suggestions exclude incompatible and expired models without restricting custom names', () => {
  assert.deepEqual(modelsForConnection(snapshot(), 'https://api.openai.com/v1', 'chat', now), ['future', 'gpt-5-mini']);
  assert.deepEqual(modelsForConnection(snapshot(), 'https://api.openai.com/v1', 'chat', now + 10 * 86400000), ['gpt-5-mini']);
  assert.deepEqual(modelsForConnection(snapshot(), 'https://custom.example/v1', 'chat', now), []);
  assert.throws(() => parseModelCatalog({ sample_spec: {} }, now), /catalog/i);
});

test('refresh sends no credentials and saves only the compact catalog', async () => {
  const writes = [];
  const service = new ModelCatalog({ now: () => now, storage: { get: async () => ({}), set: async value => writes.push(value) }, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers?.Authorization, undefined);
    return new Response(JSON.stringify(raw));
  } });
  const catalog = await service.refresh();
  assert.equal(catalog.fetchedAt, now);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].modelCatalog.version, 2);
  assert.equal(JSON.stringify(writes).includes('supported_endpoints'), false);
});

test('the local catalog works offline and an invalid refresh keeps the previous list', async () => {
  const service = new ModelCatalog({ now: () => now, storage: { get: async () => ({}), set: async () => {} }, fetchImpl: async url => {
    if (url.startsWith('file:')) return new Response(JSON.stringify(snapshot()));
    throw new Error('offline');
  } });
  await service.load();
  assert.equal(service.needsRefresh, true);
  await assert.rejects(service.refresh(), /offline/);
  assert.deepEqual(modelsForConnection(service.catalog, 'https://api.groq.com/openai/v1', 'chat', now), ['openai/gpt-oss-120b']);
});

test('a recent cache avoids downloading again and an invalid cache falls back to the bundled copy', async () => {
  let calls = 0;
  const cached = { ...snapshot(), fetchedAt: now - 1000 };
  const service = new ModelCatalog({ now: () => now, storage: { get: async () => ({ modelCatalog: cached }) }, fetchImpl: async () => { calls++; throw new Error('should not download'); } });
  await service.load();
  assert.equal(calls, 0);
  assert.equal(service.needsRefresh, false);
  const broken = new ModelCatalog({ now: () => now, storage: { get: async () => ({ modelCatalog: { version: 1, fetchedAt: now, providers: {} } }) }, fetchImpl: async () => new Response(JSON.stringify(snapshot())) });
  await broken.load();
  assert.equal(broken.needsRefresh, true);
  assert.equal(broken.catalog.providers.groq.length, 1);
});

test('an invalid, oversized or model-less download does not replace the cache', async () => {
  for (const response of [new Response('{}'), new Response('not JSON'), new Response('{}', { status: 503 }), new Response('{}', { headers: { 'content-length': '10000000' } })]) {
    let written = false;
    const service = new ModelCatalog({ now: () => now, storage: { set: async () => { written = true; } }, fetchImpl: async () => response });
    service.catalog = snapshot();
    await assert.rejects(service.refresh());
    assert.equal(written, false);
    assert.equal(service.catalog.providers.groq.length, 1);
  }
});

test('fetch is called without binding this to the catalog instance', async () => {
  const service = new ModelCatalog({ storage: { set: async () => {} }, now: () => now, fetchImpl: function () {
    assert.equal(this, undefined);
    return Promise.resolve(new Response(JSON.stringify(raw)));
  } });
  await service.refresh();
});
