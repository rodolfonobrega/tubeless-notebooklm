import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTerms, uniqueVideos, normalizeSettings, parseNotebookUrl, isNotebookSite, DEFAULT_SETTINGS, sortVideosByRelevance } from '../core/search.js';
import { buildDecisionRequest, readDecision } from '../core/providers.js';

test('limits and deduplicates queries per language, keeping the topic as the fallback', () => {
  const terms = normalizeTerms({ pt: ['  energia solar ', 'energia solar', 'painéis solares', 'outro'], en: ['solar energy', 'solar energy', 'PV panels'] }, ['pt', 'en'], 2, 'energia solar');
  assert.deepEqual(terms, [{ language: 'pt', query: 'energia solar' }, { language: 'pt', query: 'painéis solares' }, { language: 'en', query: 'solar energy' }, { language: 'en', query: 'PV panels' }]);
  assert.deepEqual(normalizeTerms({}, ['pt', 'en'], 2, 'tema'), [{ language: 'pt', query: 'tema' }]);
});

test('deduplicates videos from different queries and keeps every origin', () => {
  const result = uniqueVideos([
    { id: 'abc12345678', title: 'A', foundBy: 'solar' },
    { id: 'abc12345678', title: 'A', foundBy: 'energia' },
    { id: 'def12345678', title: 'B', foundBy: 'solar' }
  ]);
  assert.deepEqual(result.map(v => [v.id, v.foundBy]), [['abc12345678', ['solar', 'energia']], ['def12345678', ['solar']]]);
});

test('sorts from most to least relevant and puts unevaluated videos at the end', () => {
  const videos = [
    { id: 'zero', probability: 0, status: 'rejected' },
    { id: 'unknown', probability: null, status: 'error' },
    { id: 'middle', probability: 0.7, status: 'approved' },
    { id: 'best', probability: 0.98, status: 'approved' },
    { id: 'tie', probability: 0.7, status: 'approved' },
    { id: 'nan', probability: NaN, status: 'error' }
  ];
  assert.deepEqual(sortVideosByRelevance(videos).map(video => video.id), ['best', 'middle', 'tie', 'zero', 'unknown', 'nan']);
  assert.equal(videos[0].id, 'zero');
});

test('settings accept expanded limits and do not accept decision models as the generator', () => {
  const value = normalizeSettings({ termsPerLanguage: 99, resultsPerTerm: 99, maxEvaluations: 9999, threshold: 2, expansionModel: 'typesafe/jev-1.13' });
  assert.equal(value.termsPerLanguage, 20);
  assert.equal(value.resultsPerTerm, 50);
  assert.equal(value.maxEvaluations, 1000);
  assert.equal(value.threshold, 0.95);
  assert.equal(value.expansionModel, DEFAULT_SETTINGS.expansionModel);
});

test('evaluation accepts up to 1000 videos and keeps parallelism between 1 and 32', () => {
  assert.equal(normalizeSettings({ maxEvaluations: 1000 }).maxEvaluations, 1000);
  assert.equal(normalizeSettings({}).evaluationConcurrency, 8);
  assert.equal(normalizeSettings({ evaluationConcurrency: 100 }).evaluationConcurrency, 32);
  assert.equal(normalizeSettings({ evaluationConcurrency: 0 }).evaluationConcurrency, 1);
  assert.equal(normalizeSettings({ evaluationConcurrency: 'inválido' }).evaluationConcurrency, 8);
});

test('accepts only personal notebook URLs from the expected Google domains', () => {
  assert.equal(parseNotebookUrl('https://notebook.google.com/notebook/abc-123?x=1'), 'https://notebook.google.com/notebook/abc-123');
  assert.equal(parseNotebookUrl('https://notebooklm.google.com/notebook/abc-123'), 'https://notebook.google.com/notebook/abc-123');
  assert.equal(parseNotebookUrl('https://evil.example/notebook/abc-123'), null);
  assert.equal(parseNotebookUrl('https://notebook.google.com/'), null);
  assert.equal(isNotebookSite('https://notebooklm.google.com/'), true);
  assert.equal(isNotebookSite('https://notebooklm.google.com/notebook/abc-123'), true);
  assert.equal(isNotebookSite('https://notebook.google.com/'), true);
  assert.equal(isNotebookSite('https://google.com/'), false);
  assert.equal(isNotebookSite('https://evil.example/notebook/abc-123'), false);
});

test('Jev receives text evidence and answers with a typed probability', () => {
  const request = buildDecisionRequest('energia solar', { title: 'Painéis solares', description: 'Instalação residencial', publishedAt: '2026-08-01', channel: 'Canal A', transcript: 'Como instalar...' }, 'typesafe/jev-1.13');
  assert.equal(request.model, 'typesafe/jev-1.13');
  assert.equal(request.state.video.transcript, 'Como instalar...');
  assert.equal(request.questions.relevant.type, 'noul');
  assert.deepEqual(readDecision({ answers: { relevant: { type: 'noul', noul: 0.82 } } }, 0.7), { probability: 0.82, accepted: true });
  assert.deepEqual(readDecision({ answers: { relevant: { type: 'noul', noul: 0.2 } } }, 0.7), { probability: 0.2, accepted: false });
  assert.throws(() => readDecision({ answers: { relevant: { noul: 'yes' } } }, 0.7));
});
