import test from 'node:test';
import assert from 'node:assert/strict';
import { expandQueries, searchYouTube, enrichYouTube, assessVideo, checkRecencyConstraint } from '../core/providers.js';

const ok = value => ({ ok: true, json: async () => value });
const settings = { openRouterKey: 'test-key', youtubeKey: 'test-yt', expansionModel: 'google/gemini-2.5-flash', jevModel: 'typesafe/jev-1.13', languageList: ['pt', 'en'], termsPerLanguage: 2, resultsPerTerm: 8, captionedOnly: true, threshold: 0.7 };

test('search generation uses chat completions and parses fenced JSON', async () => {
  const calls = [];
  const terms = await expandQueries('energia', settings, async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return ok({ choices: [{ message: { content: '```json\n{"pt":["energia solar"],"en":["solar power"]}\n```' } }] });
  });
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].body.model, settings.expansionModel);
  assert.deepEqual(terms, [{ language: 'pt', query: 'energia solar' }, { language: 'en', query: 'solar power' }]);
});

test('YouTube search limits type, language and captions; details include the full description', async () => {
  let searchUrl;
  const candidates = await searchYouTube({ language: 'pt', query: 'energia' }, settings, async url => {
    searchUrl = new URL(url);
    return ok({ items: [{ id: { videoId: 'abc12345678' }, snippet: { title: 'Solar', description: 'Curta', channelTitle: 'Canal', publishedAt: '2026-01-01', thumbnails: {} } }] });
  });
  assert.equal(searchUrl.searchParams.get('type'), 'video');
  assert.equal(searchUrl.searchParams.get('videoCaption'), 'closedCaption');
  assert.equal(searchUrl.searchParams.get('relevanceLanguage'), 'pt');
  const enriched = await enrichYouTube(candidates, settings, async (_url) => ok({ items: [{ id: 'abc12345678', snippet: { title: 'Solar', description: 'Descrição completa' }, contentDetails: { caption: 'true', duration: 'PT6M' } }] }));
  assert.equal(enriched[0].description, 'Descrição completa');
  assert.equal(enriched[0].captionAvailable, true);
  assert.equal(enriched[0].url, 'https://www.youtube.com/watch?v=abc12345678');
});

test('Jev uses the Decisions endpoint and an invalid response fails closed', async () => {
  let body;
  const video = { title: 'Solar', description: 'Tudo sobre painéis' };
  const decision = await assessVideo('energia', video, settings, async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/alpha/decisions');
    body = JSON.parse(options.body);
    return ok({ answers: { relevant: { type: 'noul', noul: 0.81 } } });
  });
  assert.equal(body.model, settings.jevModel);
  assert.equal(decision.accepted, true);
  await assert.rejects(assessVideo('energia', video, settings, async () => ok({ answers: {} })), /invalid/);
});

test('YouTube API does not follow redirects and removes the key from error messages', async () => {
  await assert.rejects(searchYouTube({ language: 'pt', query: 'energia' }, settings, async (_url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.ok(options.signal);
    return { ok: false, status: 403, json: async () => ({ error: { message: `Invalid key ${settings.youtubeKey}` } }) };
  }), error => error.message.includes('[hidden]') && !error.message.includes(settings.youtubeKey));
});

test('continuation generation asks for new angles and reports terms already used', async () => {
  await expandQueries('energia', settings, async (_url, options) => {
    const prompt = JSON.parse(options.body).messages[0].content;
    assert.match(prompt, /do not repeat/i);
    assert.match(prompt, /solar residencial/);
    assert.match(prompt, /2/);
    return ok({ choices: [{ message: { content: '{"pt":["armazenamento"],"en":["solar storage"]}' } }] });
  }, undefined, { previousTerms: [{ language: 'pt', query: 'solar residencial' }], round: 2 });
});

test('old terms returned by the model do not use up the new-query limit', async () => {
  const terms = await expandQueries('energia', { ...settings, termsPerLanguage: 1 }, async () => ok({ choices: [{ message: { content: '{"pt":["antigo","novo"],"en":["old","new"]}' } }] }), undefined, { previousTerms: [{ language: 'pt', query: 'antigo' }, { language: 'en', query: 'old' }], round: 2 });
  assert.deepEqual(terms.map(term => term.query), ['novo', 'new']);
});

test('recency constraint penalizes and rejects older videos when recent ones are requested', async () => {
  const recentTopic = 'Engenharia reversa com LLM, considere apenas vídeos recentes';
  const normalTopic = 'Curso de SketchUp iniciante';
  const oldVideo = { title: 'Reverse engineering with GPT-4', description: 'Decompiling binaries', publishedAt: '2023-04-10T12:00:00Z' };
  const newVideo = { title: 'Reverse engineering with Claude', description: 'Modern binary analysis', publishedAt: new Date().toISOString() };

  assert.equal(checkRecencyConstraint(normalTopic, oldVideo).restricted, false);
  assert.equal(checkRecencyConstraint(recentTopic, oldVideo).restricted, true);
  assert.equal(checkRecencyConstraint(recentTopic, oldVideo).allowed, false);
  assert.equal(checkRecencyConstraint(recentTopic, newVideo).allowed, true);

  const decisionOld = await assessVideo(recentTopic, oldVideo, settings, async () => ok({ answers: { relevant: { type: 'noul', noul: 0.88 } } }));
  assert.equal(decisionOld.accepted, false);
  assert.ok(decisionOld.probability <= 0.15);

  const decisionNew = await assessVideo(recentTopic, newVideo, settings, async () => ok({ answers: { relevant: { type: 'noul', noul: 0.88 } } }));
  assert.equal(decisionNew.accepted, true);
  assert.equal(decisionNew.probability, 0.88);
});

test('a retired evaluation model fails with MODEL_UNAVAILABLE and tells the user to switch', async () => {
  const retired = { ...settings, evaluationProtocol: 'chat', jevModel: 'gone/model' };
  await assert.rejects(assessVideo('energia', { title: 'Solar' }, retired, async () => ({ ok: false, status: 404, json: async () => ({ error: { message: "The model 'gone/model' does not exist" } }) })), error => error.code === 'MODEL_UNAVAILABLE' && /Choose another model in Settings/.test(error.message));
});

test('a generic 404 is not mistaken for a retired model', async () => {
  const retired = { ...settings, evaluationProtocol: 'chat', jevModel: 'gone/model' };
  await assert.rejects(assessVideo('energia', { title: 'Solar' }, retired, async () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'Not Found' } }) })), error => error.code === undefined);
});
