import test from 'node:test';
import assert from 'node:assert/strict';
import * as providers from '../core/providers.js';
import { sanitizeCandidates, validNotebookSender, sanitizeLocatorDescriptor } from '../core/element-locator.js';

const candidates = [
  { id: 'e0', tag: 'button', role: 'button', label: 'Cancelar', kind: 'button' },
  { id: 'e1', tag: 'button', role: 'button', label: 'Finish import', kind: 'button' }
];
const settings = { evaluationBaseUrl: 'https://openrouter.ai/api/alpha', evaluationApiKey: 'fake-evaluator', evaluationProtocol: 'decisions', jevModel: 'typesafe/jev-1.13' };

test('locator uses Choice, only observed IDs, and the independent evaluation connection', async () => {
  assert.equal(typeof providers.selectNotebookElement, 'function');
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, headers: options.headers, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ answers: { target: { type: 'choice', choice: 'e1', confidence: 0.97 } } }));
  };
  assert.equal(await providers.selectNotebookElement('submit', candidates, settings, fetchImpl), 'e1');
  assert.equal(request.url, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(request.headers.Authorization, 'Bearer fake-evaluator');
  assert.equal(request.body.questions.target.type, 'choice');
  assert.deepEqual(Object.keys(request.body.questions.target.criteria), ['e0', 'e1', 'NONE']);
  assert.equal(request.body.state.document, undefined);
  assert.equal(request.body.state.candidates[0].value, undefined);
});

test('locator rejects an invented target or low confidence without running actions', async () => {
  assert.equal(typeof providers.selectNotebookElement, 'function');
  for (const answer of [
    { type: 'choice', choice: '#invented', confidence: 1 },
    { type: 'choice', choice: 'e1', confidence: 0.1 },
    { type: 'noul', noul: 1 },
    { type: 'choice', choice: 'NONE', confidence: 1 }
  ]) {
    await assert.rejects(providers.selectNotebookElement('submit', candidates, settings, async () => new Response(JSON.stringify({ answers: { target: answer } }))));
  }
});

test('locator also uses an OpenAI-compatible format with a validated structured response', async () => {
  assert.equal(typeof providers.selectNotebookElement, 'function');
  let url;
  const result = await providers.selectNotebookElement('url', [{ id: 'e0', tag: 'input', kind: 'field', label: 'Paste the address' }], { ...settings, evaluationBaseUrl: 'https://api.groq.com/openai/v1', evaluationProtocol: 'chat', jevModel: 'openai/gpt-oss-120b' }, async (input, options) => {
    url = input;
    assert.equal(JSON.parse(options.body).model, 'openai/gpt-oss-120b');
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"choice":"e0","confidence":0.98}' } }] }));
  });
  assert.equal(result, 'e0');
  assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
});

test('field data, HTML, URLs, and extra properties do not enter the observation or the cache', () => {
  const input = { id: 'e0', tag: 'input', kind: 'field', label: 'URL', value: 'PRIVATE NOTE', outerHTML: '<p>PRIVATE</p>', url: 'https://private', selector: 'body' };
  const sanitized = sanitizeCandidates('url', [input])[0];
  for (const field of ['value', 'outerHTML', 'url', 'selector']) assert.equal(sanitized[field], undefined);
  const descriptor = sanitizeLocatorDescriptor(input);
  for (const field of ['value', 'outerHTML', 'url', 'selector', 'id']) assert.equal(descriptor[field], undefined);
  assert.throws(() => sanitizeCandidates('submit', [input]));
  assert.throws(() => sanitizeCandidates('submit', [{ ...candidates[0], id: 'NONE' }]));
});

test('proxy only accepts content from the main frame of a real notebook in the extension', () => {
  const sender = { id: 'ext123', frameId: 0, tab: { id: 1 }, url: 'https://notebooklm.google.com/notebook/abc123' };
  assert.equal(validNotebookSender(sender, 'ext123'), true);
  for (const change of [{ frameId: 1 }, { id: 'other' }, { tab: undefined }, { url: 'https://evil.example/notebook/abc123' }, { url: 'https://notebooklm.google.com/' }, { url: 'https://notebooklm.google.com.evil.example/notebook/a' }]) assert.equal(validNotebookSender({ ...sender, ...change }, 'ext123'), false);
});
