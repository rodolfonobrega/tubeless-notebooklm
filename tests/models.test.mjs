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

test('catálogo filtra por provedor e formato e remove apenas o prefixo LiteLLM', () => {
  const catalog = snapshot();
  assert.deepEqual(modelsForConnection(catalog, 'https://api.groq.com/openai/v1', 'chat', now), ['openai/gpt-oss-120b']);
  assert.deepEqual(modelsForConnection(catalog, 'https://api.deepseek.com/v1', 'chat', now), ['deepseek-chat']);
  assert.deepEqual(modelsForConnection(catalog, 'https://openrouter.ai/api/v1', 'chat', now), ['google/gemini-2.5-flash']);
  assert.deepEqual(modelsForConnection(catalog, 'https://openrouter.ai/api/alpha', 'decisions', now), ['openai/gpt-6-luna-decisions', 'perplexity/pplx-decider-v1.1-27b', 'typesafe/jev-1.13']);
  assert.deepEqual(modelsForConnection(catalog, 'https://api.typesafe.ai', 'systemone', now), ['jev-1.13.0', 'jev-latest']);
});

test('sugestões excluem modelos incompatíveis e expirados sem restringir nomes customizados', () => {
  assert.deepEqual(modelsForConnection(snapshot(), 'https://api.openai.com/v1', 'chat', now), ['future', 'gpt-5-mini']);
  assert.deepEqual(modelsForConnection(snapshot(), 'https://api.openai.com/v1', 'chat', now + 10 * 86400000), ['gpt-5-mini']);
  assert.deepEqual(modelsForConnection(snapshot(), 'https://custom.example/v1', 'chat', now), []);
  assert.throws(() => parseModelCatalog({ sample_spec: {} }, now), /catálogo/i);
});

test('atualização não envia credenciais e salva somente o catálogo compacto', async () => {
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

test('catálogo local funciona offline e uma atualização inválida preserva a lista anterior', async () => {
  const service = new ModelCatalog({ now: () => now, storage: { get: async () => ({}), set: async () => {} }, fetchImpl: async url => {
    if (url.startsWith('file:')) return new Response(JSON.stringify(snapshot()));
    throw new Error('offline');
  } });
  await service.load();
  assert.equal(service.needsRefresh, true);
  await assert.rejects(service.refresh(), /offline/);
  assert.deepEqual(modelsForConnection(service.catalog, 'https://api.groq.com/openai/v1', 'chat', now), ['openai/gpt-oss-120b']);
});

test('cache recente evita baixar novamente e cache inválido usa cópia incluída', async () => {
  let calls = 0;
  const cached = { ...snapshot(), fetchedAt: now - 1000 };
  const service = new ModelCatalog({ now: () => now, storage: { get: async () => ({ modelCatalog: cached }) }, fetchImpl: async () => { calls++; throw new Error('não deve baixar'); } });
  await service.load();
  assert.equal(calls, 0);
  assert.equal(service.needsRefresh, false);
  const broken = new ModelCatalog({ now: () => now, storage: { get: async () => ({ modelCatalog: { version: 1, fetchedAt: now, providers: {} } }) }, fetchImpl: async () => new Response(JSON.stringify(snapshot())) });
  await broken.load();
  assert.equal(broken.needsRefresh, true);
  assert.equal(broken.catalog.providers.groq.length, 1);
});

test('download inválido, muito grande ou sem modelos suportados não substitui o cache', async () => {
  for (const response of [new Response('{}'), new Response('não é JSON'), new Response('{}', { status: 503 }), new Response('{}', { headers: { 'content-length': '10000000' } })]) {
    let written = false;
    const service = new ModelCatalog({ now: () => now, storage: { set: async () => { written = true; } }, fetchImpl: async () => response });
    service.catalog = snapshot();
    await assert.rejects(service.refresh());
    assert.equal(written, false);
    assert.equal(service.catalog.providers.groq.length, 1);
  }
});

test('fetch mantém chamada sem vincular this à instância do catálogo', async () => {
  const service = new ModelCatalog({ storage: { set: async () => {} }, now: () => now, fetchImpl: function () {
    assert.equal(this, undefined);
    return Promise.resolve(new Response(JSON.stringify(raw)));
  } });
  await service.refresh();
});
