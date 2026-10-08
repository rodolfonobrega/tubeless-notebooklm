import test from 'node:test';
import assert from 'node:assert/strict';
import { expandQueries, searchYouTube, enrichYouTube, assessVideo, checkRecencyConstraint } from '../core/providers.js';

const ok = value => ({ ok: true, json: async () => value });
const settings = { openRouterKey: 'test-key', youtubeKey: 'test-yt', expansionModel: 'google/gemini-2.5-flash', jevModel: 'typesafe/jev-1.13', languageList: ['pt', 'en'], termsPerLanguage: 2, resultsPerTerm: 8, captionedOnly: true, threshold: 0.7 };

test('expansão usa chat completions e interpreta JSON com cerca', async () => {
  const calls = [];
  const terms = await expandQueries('energia', settings, async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return ok({ choices: [{ message: { content: '```json\n{"pt":["energia solar"],"en":["solar power"]}\n```' } }] });
  });
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].body.model, settings.expansionModel);
  assert.deepEqual(terms, [{ language: 'pt', query: 'energia solar' }, { language: 'en', query: 'solar power' }]);
});

test('busca YouTube restringe tipo, idioma e legendas; detalhes trazem descrição completa', async () => {
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

test('Jev usa endpoint Decisions e resposta inválida falha fechada', async () => {
  let body;
  const video = { title: 'Solar', description: 'Tudo sobre painéis' };
  const decision = await assessVideo('energia', video, settings, async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/alpha/decisions');
    body = JSON.parse(options.body);
    return ok({ answers: { relevant: { type: 'noul', noul: 0.81 } } });
  });
  assert.equal(body.model, settings.jevModel);
  assert.equal(decision.accepted, true);
  await assert.rejects(assessVideo('energia', video, settings, async () => ok({ answers: {} })), /inválida/);
});

test('API YouTube não segue redirecionamentos e remove a chave de mensagens de erro', async () => {
  await assert.rejects(searchYouTube({ language: 'pt', query: 'energia' }, settings, async (_url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.ok(options.signal);
    return { ok: false, status: 403, json: async () => ({ error: { message: `Invalid key ${settings.youtubeKey}` } }) };
  }), error => error.message.includes('[oculto]') && !error.message.includes(settings.youtubeKey));
});

test('expansão da continuação orienta novos ângulos e informa termos já usados', async () => {
  await expandQueries('energia', settings, async (_url, options) => {
    const prompt = JSON.parse(options.body).messages[0].content;
    assert.match(prompt, /não repita/i);
    assert.match(prompt, /solar residencial/);
    assert.match(prompt, /2/);
    return ok({ choices: [{ message: { content: '{"pt":["armazenamento"],"en":["solar storage"]}' } }] });
  }, undefined, { previousTerms: [{ language: 'pt', query: 'solar residencial' }], round: 2 });
});

test('termos antigos retornados pelo modelo não consomem o limite de consultas novas', async () => {
  const terms = await expandQueries('energia', { ...settings, termsPerLanguage: 1 }, async () => ok({ choices: [{ message: { content: '{"pt":["antigo","novo"],"en":["old","new"]}' } }] }), undefined, { previousTerms: [{ language: 'pt', query: 'antigo' }, { language: 'en', query: 'old' }], round: 2 });
  assert.deepEqual(terms.map(term => term.query), ['novo', 'new']);
});

test('restrição de recência penaliza e rejeita vídeos de anos anteriores quando solicitados recentes', async () => {
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
