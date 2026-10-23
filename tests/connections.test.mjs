import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, DEFAULT_SETTINGS } from '../core/search.js';
import { normalizeBaseUrl, endpointUrl, requiredApiOrigins, sanitizeError, maskSecretKey } from '../core/connections.js';
import { expandQueries, assessVideo } from '../core/providers.js';

const ok = data => ({ ok: true, json: async () => data });

test('defaults use OpenAI and keyless search, with independent evaluation', () => {
  const settings = normalizeSettings();
  assert.equal(settings.llmBaseUrl, 'https://api.openai.com/v1');
  assert.equal(settings.expansionModel, 'gpt-5-mini');
  assert.equal(settings.youtubeMode, 'web');
  assert.equal(settings.evaluationBaseUrl, 'https://openrouter.ai/api/alpha');
  assert.equal(settings.evaluationApiKey, '');
  assert.equal(settings.evaluationProtocol, 'decisions');
  assert.equal(settings.jevModel, 'perplexity/pplx-decider-v1.1-27b');
});

test('migration keeps both OpenRouter calls and lets the keys be separated', () => {
  const migrated = normalizeSettings({ openRouterKey: 'old-key', expansionModel: 'google/gemini-2.5-flash', youtubeKey: 'youtube-key' });
  assert.equal(migrated.llmBaseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(migrated.llmApiKey, 'old-key');
  assert.equal(migrated.evaluationApiKey, 'old-key');
  assert.equal(migrated.youtubeMode, 'api');
  assert.equal('openRouterKey' in migrated, false);
  const separate = normalizeSettings({ ...migrated, llmApiKey: 'groq-key', llmBaseUrl: 'https://api.groq.com/openai/v1', evaluationApiKey: 'judge-key' });
  assert.equal(separate.evaluationApiKey, 'judge-key');
  assert.equal(separate.llmApiKey, 'groq-key');
});

test('URLs accept HTTPS providers and local servers, without credentials or parameters', () => {
  assert.equal(normalizeBaseUrl(' https://api.groq.com/openai/v1/// '), 'https://api.groq.com/openai/v1');
  assert.equal(normalizeBaseUrl('http://localhost:1234/v1'), 'http://localhost:1234/v1');
  assert.throws(() => normalizeBaseUrl('http://remote.example/v1'), /HTTPS/);
  assert.throws(() => normalizeBaseUrl('https://user:pass@example.com/v1'), /credentials/);
  assert.throws(() => normalizeBaseUrl('https://example.com/v1?key=secret'), /parameters/);
  assert.equal(endpointUrl('https://example.com/v1/', 'chat/completions'), 'https://example.com/v1/chat/completions');
  assert.equal(endpointUrl('https://example.com/v1/chat/completions', 'chat/completions'), 'https://example.com/v1/chat/completions');
  assert.deepEqual(requiredApiOrigins({ ...DEFAULT_SETTINGS, llmBaseUrl: 'http://localhost:1234/v1' }), ['http://localhost/*', 'https://openrouter.ai/*']);
});

test('generation and evaluation send keys only to their own provider', async () => {
  const settings = normalizeSettings({ llmBaseUrl: 'https://api.groq.com/openai/v1', llmApiKey: 'generator-key', expansionModel: 'llama-3.3-70b-versatile', evaluationBaseUrl: 'https://api.typesafe.ai', evaluationApiKey: 'judge-key', evaluationProtocol: 'systemone', jevModel: 'jev-latest', languages: 'pt', termsPerLanguage: 1 });
  await expandQueries('energia', { ...settings, languageList: ['pt'] }, async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer generator-key');
    assert.equal(options.redirect, 'error');
    assert.equal('temperature' in JSON.parse(options.body), false);
    return ok({ choices: [{ message: { content: '{"pt":["energia solar"]}' } }] });
  });
  const decision = await assessVideo('energia', { title: 'Solar' }, settings, async (url, options) => {
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(options.headers.Authorization, 'Bearer judge-key');
    assert.equal(JSON.parse(options.body).model, 'jev-latest');
    return ok({ answers: { relevant: { type: 'noul', noul: 0.8 } } });
  });
  assert.equal(decision.accepted, true);
});

test('older chat providers can use max_tokens, and invalid responses fail', async () => {
  let count = 0;
  const settings = { ...DEFAULT_SETTINGS, llmApiKey: 'test', languageList: ['pt'] };
  const terms = await expandQueries('energia', settings, async (_url, options) => {
    const body = JSON.parse(options.body);
    if (++count === 1) return { ok: false, status: 400, json: async () => ({ error: { message: "Unknown parameter: max_completion_tokens" } }) };
    assert.equal(body.max_tokens, 4096);
    assert.equal('max_completion_tokens' in body, false);
    return ok({ choices: [{ message: { content: '{"pt":["solar"]}' } }] });
  });
  assert.equal(terms[0].query, 'solar');
  await assert.rejects(expandQueries('energia', settings, async () => ok({ choices: [{ message: { content: '{}' } }] })), /terms/);
});

test('evaluation can also use an OpenAI-compatible provider', async () => {
  const settings = { ...DEFAULT_SETTINGS, evaluationBaseUrl: 'https://api.openai.com/v1', evaluationApiKey: 'judge-key', evaluationProtocol: 'chat', jevModel: 'gpt-5-mini' };
  const result = await assessVideo('energia', { title: 'Solar' }, settings, async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(JSON.parse(options.body).model, 'gpt-5-mini');
    return ok({ choices: [{ message: { content: '{"probability":0.9}' } }] });
  });
  assert.equal(result.accepted, true);
  await assert.rejects(assessVideo('energia', {}, settings, async () => ok({ choices: [{ message: { content: '{"probability":"0.9"}' } }] })), /invalid/);
});

test('visible errors remove credentials even if the provider repeats them', () => {
  assert.equal(sanitizeError('Token custom-key invalid', ['custom-key']), 'Token [hidden] invalid');
  assert.equal(sanitizeError('sk-proj-123456789ABCDEFGHI invalid'), '[hidden] invalid');
});

test('maskSecretKey masks keys, keeping only the start and end without exposing the secret', () => {
  assert.equal(maskSecretKey(''), 'No key configured');
  assert.equal(maskSecretKey('   '), 'No key configured');
  assert.equal(maskSecretKey(null), '');
  assert.equal(maskSecretKey('12345678'), '12••••78');
  assert.equal(maskSecretKey('1234567890123456'), '1234••••••••3456');
  assert.equal(
    maskSecretKey('sk-or-v1-mock_test_key_sample_value_placeholder_string_for_testing_only_6789'),
    'sk-or-v1-moc••••••••••••••••6789'
  );
  assert.equal(
    maskSecretKey('sk-proj-mock_test_key_sample_value_placeholder_string_for_testing_only_6789'),
    'sk-proj-moc••••••••••••••••6789'
  );
  assert.equal(
    maskSecretKey('AIzaSy_mock_test_key_sample_value_placeholder_string_for_testing_7890'),
    'AIzaSy••••••••••••••••7890'
  );
});
