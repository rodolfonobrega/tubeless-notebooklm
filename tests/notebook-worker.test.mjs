import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotebookLocatorHandler } from '../core/notebook-worker.js';

const sender = { id: 'extension', frameId: 0, tab: { id: 1 }, url: 'https://notebooklm.google.com/notebook/abc123' };
function apiFixture(allowed = true) {
  const store = { settings: { evaluationApiKey: 'fake-evaluator', llmApiKey: 'fake-generator' } };
  return { store, api: { runtime: { id: 'extension' }, permissions: { async contains() { return allowed; } }, storage: { local: { async get(key) { return { [key]: store[key] }; }, async set(values) { Object.assign(store, values); } } } } };
}

test('proxy de localização não entrega credenciais e nega origens ou permissões inválidas', async () => {
  const { api } = apiFixture();
  let called = 0;
  const handle = createNotebookLocatorHandler(api, async (action, candidates, settings) => { called++; assert.equal(settings.evaluationApiKey, 'fake-evaluator'); return candidates[0].id; });
  const message = { type: 'TUBELESS_LOCATE_ELEMENT', action: 'submit', candidates: [{ id: 'e0', kind: 'button', label: 'Inserir', tag: 'button' }] };
  assert.deepEqual(await handle(message, sender), { ok: true, id: 'e0' });
  assert.equal((await handle(message, { ...sender, url: 'https://evil.example/' })).ok, false);
  assert.equal((await createNotebookLocatorHandler(apiFixture(false).api, async () => { called++; })(message, sender)).ok, false);
  assert.equal(called, 1);
});

test('cache persiste somente descritores e mantém escopo por domínio e idioma', async () => {
  const { api, store } = apiFixture();
  const handle = createNotebookLocatorHandler(api);
  const put = { type: 'TUBELESS_LOCATOR_CACHE', op: 'put', locale: 'pt-BR', entries: { submit: { tag: 'button', kind: 'button', label: 'Finalizar', value: 'PRIVATE', selector: 'body', apiKey: 'PRIVATE' } } };
  assert.equal((await handle(put, sender)).ok, true);
  const get = { type: put.type, op: 'get', locale: put.locale };
  const read = await handle(get, sender);
  assert.equal(read.cache.submit.label, 'Finalizar');
  assert.equal(JSON.stringify(store.notebookLocatorCache).includes('PRIVATE'), false);
  assert.equal(read.settings, undefined);
  assert.deepEqual((await handle({ ...get, locale: 'en' }, sender)).cache, {});
  assert.deepEqual((await handle(get, { ...sender, url: 'https://notebook.google.com/notebook/abc123' })).cache, {});
});

test('erros do provedor nunca retornam as chaves ao conteúdo', async () => {
  const { api } = apiFixture();
  const handle = createNotebookLocatorHandler(api, async () => { throw new Error('fake-evaluator fake-generator'); });
  const result = await handle({ type: 'TUBELESS_LOCATE_ELEMENT', action: 'submit', candidates: [{ id: 'e0', tag: 'button', kind: 'button', label: 'Adicionar' }] }, sender);
  assert.equal(result.ok, false);
  assert.equal(result.message.includes('fake-evaluator'), false);
  assert.equal(result.message.includes('fake-generator'), false);
});

test('localizador do worker aborta uma chamada lenta antes do limite de vida do Chrome', async () => {
  const { api } = apiFixture();
  let aborted = false;
  const handle = createNotebookLocatorHandler(api, async (_action, _candidates, _settings, _fetch, signal) => {
    if (!(signal instanceof AbortSignal)) return 'e0';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve('e0'), 100);
      signal.addEventListener('abort', () => { aborted = true; clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
  }, { timeoutMs: 10 });
  const result = await handle({ type: 'TUBELESS_LOCATE_ELEMENT', action: 'submit', candidates: [{ id: 'e0', tag: 'button', kind: 'button', label: 'Adicionar' }] }, sender);
  assert.equal(result.ok, false);
  assert.equal(aborted, true);
});
