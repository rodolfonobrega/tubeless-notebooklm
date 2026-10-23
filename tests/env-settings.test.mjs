import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsFromEnv } from '../scripts/env-settings.mjs';

test('chat evaluation uses the same DeepSeek connection selected for generation', () => {
  const result = settingsFromEnv({ DEEPSEEK_API_KEY: 'fake-deepseek', OPENAI_API_KEY: 'fake-openai' }, { provider: 'deepseek', chatEvaluation: true });
  assert.equal(result.evaluationBaseUrl, 'https://api.deepseek.com/v1');
  assert.equal(result.evaluationApiKey, 'fake-deepseek');
  assert.equal(result.jevModel, 'deepseek-chat');
  assert.equal(result.evaluationProtocol, 'chat');
});

test('an explicit evaluation key does not inherit the endpoint of another existing key', () => {
  const result = settingsFromEnv({ EVALUATION_API_KEY: 'fake-evaluation', TYPESAFE_API_KEY: 'fake-typesafe' });
  assert.equal(result.evaluationApiKey, 'fake-evaluation');
  assert.equal(result.evaluationBaseUrl, 'https://openrouter.ai/api/alpha');
  assert.equal(result.evaluationProtocol, 'decisions');
});

test('a direct TypeSafe key picks the matching endpoint, protocol, and model', () => {
  const result = settingsFromEnv({ TYPESAFE_API_KEY: 'fake-typesafe', OPENROUTER_API_KEY: 'fake-router' });
  assert.equal(result.evaluationApiKey, 'fake-typesafe');
  assert.equal(result.evaluationBaseUrl, 'https://api.typesafe.ai');
  assert.equal(result.evaluationProtocol, 'systemone');
  assert.equal(result.jevModel, 'jev-latest');
});

test('explicit connections stay independent and chat does not infer the URL from the token', () => {
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

test('explicit System One protocol selects the correct defaults', () => {
  const result = settingsFromEnv({ EVALUATION_API_KEY: 'fake', EVALUATION_PROTOCOL: 'systemone' });
  assert.equal(result.evaluationBaseUrl, 'https://api.typesafe.ai');
  assert.equal(result.jevModel, 'jev-latest');
});

test('chat protocol does not send the OpenRouter key to another provider generator', () => {
  const result = settingsFromEnv({ OPENAI_API_KEY: 'fake-openai', OPENROUTER_API_KEY: 'fake-router', EVALUATION_PROTOCOL: 'chat' });
  assert.equal(result.evaluationBaseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(result.evaluationApiKey, 'fake-router');
  assert.throws(() => settingsFromEnv({ EVALUATION_API_KEY: 'fake', EVALUATION_PROTOCOL: 'chat' }), /EVALUATION_BASE_URL/);
});

test('System One protocol with an OpenRouter key keeps the OpenRouter host', () => {
  const result = settingsFromEnv({ OPENROUTER_API_KEY: 'fake-router', EVALUATION_PROTOCOL: 'systemone' });
  assert.equal(result.evaluationBaseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(result.evaluationApiKey, 'fake-router');
  assert.throws(() => settingsFromEnv({ TYPESAFE_API_KEY: 'fake', EVALUATION_PROTOCOL: 'decisions' }), /systemone/);
});
