import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsFromEnv } from '../scripts/env-settings.mjs';

test('avaliação chat usa a mesma conexão DeepSeek selecionada para geração', () => {
  const result = settingsFromEnv({ DEEPSEEK_API_KEY: 'fake-deepseek', OPENAI_API_KEY: 'fake-openai' }, { provider: 'deepseek', chatEvaluation: true });
  assert.equal(result.evaluationBaseUrl, 'https://api.deepseek.com/v1');
  assert.equal(result.evaluationApiKey, 'fake-deepseek');
  assert.equal(result.jevModel, 'deepseek-chat');
  assert.equal(result.evaluationProtocol, 'chat');
});

test('chave explícita de avaliação não herda endpoint de outra chave existente', () => {
  const result = settingsFromEnv({ EVALUATION_API_KEY: 'fake-evaluation', TYPESAFE_API_KEY: 'fake-typesafe' });
  assert.equal(result.evaluationApiKey, 'fake-evaluation');
  assert.equal(result.evaluationBaseUrl, 'https://openrouter.ai/api/alpha');
  assert.equal(result.evaluationProtocol, 'decisions');
});

test('chave TypeSafe direta escolhe o endpoint, protocolo e modelo correspondentes', () => {
  const result = settingsFromEnv({ TYPESAFE_API_KEY: 'fake-typesafe', OPENROUTER_API_KEY: 'fake-router' });
  assert.equal(result.evaluationApiKey, 'fake-typesafe');
  assert.equal(result.evaluationBaseUrl, 'https://api.typesafe.ai');
  assert.equal(result.evaluationProtocol, 'systemone');
  assert.equal(result.jevModel, 'jev-latest');
});

test('conexões explícitas permanecem independentes e chat não infere URL pelo token', () => {
  const env = { LLM_API_KEY: 'fake-generator', LLM_BASE_URL: 'https://generator.example/v1', LLM_MODEL: 'generator', EVALUATION_API_KEY: 'fake-evaluator', EVALUATION_BASE_URL: 'https://evaluator.example/v1', EVALUATION_PROTOCOL: 'chat', EVALUATION_MODEL: 'evaluator' };
  const result = settingsFromEnv(env);
  assert.equal(result.llmApiKey, 'fake-generator');
  assert.equal(result.evaluationApiKey, 'fake-evaluator');
  assert.equal(result.evaluationBaseUrl, 'https://evaluator.example/v1');
  assert.equal(result.jevModel, 'evaluator');
  const same = settingsFromEnv(env, { chatEvaluation: true });
  assert.equal(same.evaluationBaseUrl, result.llmBaseUrl);
  assert.equal(same.evaluationApiKey, result.llmApiKey);
  assert.equal(same.jevModel, result.expansionModel);
});

test('protocolo explícito System One seleciona os defaults corretos', () => {
  const result = settingsFromEnv({ EVALUATION_API_KEY: 'fake', EVALUATION_PROTOCOL: 'systemone' });
  assert.equal(result.evaluationBaseUrl, 'https://api.typesafe.ai');
  assert.equal(result.jevModel, 'jev-latest');
});

test('protocolo chat não envia a chave OpenRouter para o gerador de outro provedor', () => {
  const result = settingsFromEnv({ OPENAI_API_KEY: 'fake-openai', OPENROUTER_API_KEY: 'fake-router', EVALUATION_PROTOCOL: 'chat' });
  assert.equal(result.evaluationBaseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(result.evaluationApiKey, 'fake-router');
  assert.throws(() => settingsFromEnv({ EVALUATION_API_KEY: 'fake', EVALUATION_PROTOCOL: 'chat' }), /EVALUATION_BASE_URL/);
});

test('protocolo System One com chave OpenRouter mantém o host OpenRouter', () => {
  const result = settingsFromEnv({ OPENROUTER_API_KEY: 'fake-router', EVALUATION_PROTOCOL: 'systemone' });
  assert.equal(result.evaluationBaseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(result.evaluationApiKey, 'fake-router');
  assert.throws(() => settingsFromEnv({ TYPESAFE_API_KEY: 'fake', EVALUATION_PROTOCOL: 'decisions' }), /systemone/);
});
