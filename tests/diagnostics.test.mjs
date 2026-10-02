import test from 'node:test';
import assert from 'node:assert/strict';
import { testConnections } from '../core/diagnostics.js';
import { normalizeSettings } from '../core/search.js';

test('botão testa chamadas completas e mantém resultados independentes das falhas', async () => {
  const settings = normalizeSettings({ llmApiKey: 'generator', evaluationApiKey: 'judge', youtubeMode: 'api', youtubeKey: 'youtube' });
  const updates = [];
  const calls = [];
  const results = await testConnections(settings, { onResult: result => updates.push(result), fetchImpl: async (url, options) => {
    calls.push(String(url));
    if (String(url).endsWith('/chat/completions')) return { ok: true, json: async () => ({ choices: [{ message: { content: '{"pt":["energia solar"],"en":["solar energy"]}' } }] }) };
    if (String(url).endsWith('/decisions')) return { ok: false, status: 401, json: async () => ({ error: { message: 'Invalid token judge' } }) };
    if (String(url).includes('/search?')) return { ok: true, json: async () => ({ items: [{ id: { videoId: 'abc12345678' }, snippet: { title: 'Solar' } }] }) };
    return { ok: true, json: async () => ({ items: [{ id: 'abc12345678', snippet: { title: 'Solar', description: 'Completa' }, contentDetails: { caption: 'true' } }] }) };
  } });
  assert.deepEqual(results.map(result => [result.id, result.status]), [['llm', 'ok'], ['evaluation', 'error'], ['youtube', 'ok']]);
  assert.equal(calls.length, 4);
  assert.equal(updates.filter(result => result.status === 'testing').length, 3);
  assert.match(results[1].message, /401|Invalid token/);
  assert.equal(results[1].message.includes('judge'), false);
});

test('teste não aceita resposta vazia nem transforma ausência de chave em sucesso', async () => {
  const results = await testConnections(normalizeSettings({ llmApiKey: 'llm', youtubeMode: 'api' }), { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.deepEqual(results.map(result => result.status), ['error', 'error', 'error']);
});
