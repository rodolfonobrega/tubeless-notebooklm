import test from 'node:test';
import assert from 'node:assert/strict';
import { runDiscovery } from '../core/pipeline.js';
import { normalizeSettings } from '../core/search.js';

const settings = { languageList: ['pt', 'en'], termsPerLanguage: 1, maxEvaluations: 3, threshold: 0.7 };
const video = (id, foundBy) => ({ id, title: id, foundBy });

test('evaluates 250 videos and keeps partial errors and relevance order', async () => {
  const assessed = new Set();
  const progress = [];
  const result = await runDiscovery({
    topic: 'tema', settings: { ...normalizeSettings({ maxEvaluations: 250, captionedOnly: false }), languageList: ['pt'] },
    expand: async () => [{ language: 'pt', query: 'termo' }],
    search: async () => Array.from({ length: 260 }, (_, index) => ({ ...video(`VID${String(index).padStart(8, '0')}`, 'termo'), index })),
    enrich: async items => items,
    assess: async (_topic, item) => {
      assessed.add(item.id);
      if (item.index === 7) throw new Error('isolated failure');
      return { probability: item.index / 250, accepted: item.index >= 175 };
    },
    onProgress: value => { if (value.phase === 'evaluating') progress.push(value.completed); }
  });
  assert.equal(assessed.size, 250);
  assert.equal(result.videos.length, 250);
  assert.equal(result.videos[0].index, 249);
  assert.equal(result.videos.at(-1).index, 7);
  assert.equal(result.videos.at(-1).status, 'error');
  assert.match(result.warnings.join(' '), /10 video\(s\) fell outside/);
  assert.deepEqual(progress, Array.from({ length: 251 }, (_, index) => index));
});

for (const concurrency of [1, 8, 16, undefined]) {
  test(`asynchronous evaluations respect ${concurrency ?? 'the default of 8'} simultaneous call(s)`, async () => {
    let active = 0;
    let peak = 0;
    const result = await runDiscovery({
      topic: 'tema', settings: { ...settings, maxEvaluations: 32, evaluationConcurrency: concurrency },
      expand: async () => [{ language: 'pt', query: 'termo' }],
      search: async () => Array.from({ length: 32 }, (_, index) => ({ ...video(`VID${String(index).padStart(8, '0')}`, 'termo'), index })),
      enrich: async items => items,
      assess: async (_topic, item) => {
        peak = Math.max(peak, ++active);
        await new Promise(resolve => setImmediate(resolve));
        active--;
        return { probability: item.index / 32, accepted: true };
      }
    });
    assert.equal(peak, concurrency ?? 8);
    assert.equal(active, 0);
    assert.deepEqual(result.videos.map(item => item.index), Array.from({ length: 32 }, (_, index) => 31 - index));
  });
}

test('cancellation stops parallel calls without starting pending videos', async () => {
  const controller = new AbortController();
  let started = 0;
  let active = 0;
  const progress = [];
  await assert.rejects(runDiscovery({
    topic: 'tema', settings: { ...settings, maxEvaluations: 250, evaluationConcurrency: 8 }, signal: controller.signal,
    expand: async () => [{ language: 'pt', query: 'termo' }],
    search: async () => Array.from({ length: 250 }, (_, index) => video(`VID${String(index).padStart(8, '0')}`, 'termo')),
    enrich: async items => items,
    assess: async () => {
      started++;
      active++;
      try {
        await new Promise((resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
          if (started === 8) controller.abort();
        });
      } finally { active--; }
    },
    onProgress: value => { if (value.phase === 'evaluating') progress.push(value.completed); }
  }), { name: 'AbortError' });
  assert.equal(started, 8);
  assert.equal(active, 0);
  assert.deepEqual(progress, [0]);
});

test('searches terms in parallel, tolerates partial failure, and uses Jev as the only approval', async () => {
  const result = await runDiscovery({
    topic: 'tema', settings,
    expand: async () => [{ language: 'pt', query: 'termo pt' }, { language: 'en', query: 'term en' }],
    search: async term => term.language === 'pt' ? [video('abc12345678', term.query), video('def12345678', term.query)] : [video('abc12345678', term.query), video('ghi12345678', term.query)],
    enrich: async items => items.map(item => ({ ...item, description: 'descrição', url: `https://www.youtube.com/watch?v=${item.id}` })),
    assess: async (_topic, item) => item.id === 'ghi12345678' ? { probability: 0.9, accepted: true } : item.id === 'def12345678' ? Promise.reject(new Error('créditos')) : { probability: 0.3, accepted: false }
  });
  assert.equal(result.videos.length, 3);
  assert.deepEqual(result.videos.map(v => [v.id, v.status]), [['ghi12345678', 'approved'], ['abc12345678', 'rejected'], ['def12345678', 'error']]);
  assert.deepEqual(result.videos.find(v => v.id === 'abc12345678').foundBy, ['termo pt', 'term en']);
  assert.equal(result.videos.filter(v => v.status === 'approved').length, 1);
});

test('expansion failure keeps the search on the original topic and warns', async () => {
  const result = await runDiscovery({
    topic: 'energia', settings,
    expand: async () => { throw new Error('sem créditos'); },
    search: async term => { assert.equal(term.query, 'energia'); return [video('abc12345678', 'energia')]; },
    enrich: async items => items,
    assess: async () => ({ probability: 0.8, accepted: true })
  });
  assert.equal(result.terms[0].query, 'energia');
  assert.match(result.warnings[0], /vary the terms/i);
});

test('unexpected expansion output also keeps the original topic', async () => {
  const result = await runDiscovery({ topic: 'energia', settings, expand: async () => undefined, search: async () => [video('abc12345678', 'energia')], enrich: async items => items, assess: async () => ({ probability: 0.8, accepted: true }) });
  assert.deepEqual(result.terms, [{ language: 'pt', query: 'energia' }]);
  assert.match(result.warnings[0], /vary the terms/i);
});

test('an error in every search is not shown as an empty list', async () => {
  await assert.rejects(runDiscovery({ topic: 'tema', settings, expand: async () => [{ language: 'pt', query: 'x' }], search: async () => { throw new Error('quota'); }, enrich: async () => [], assess: async () => ({ probability: 1, accepted: true }) }), /quota/);
});

test('public search does not evaluate videos whose details could not be verified', async () => {
  const assessed = [];
  const result = await runDiscovery({ topic: 'energia', settings: { ...settings, youtubeMode: 'web', captionedOnly: true }, expand: async () => [{ language: 'pt', query: 'solar' }], search: async () => [video('abc12345678', 'solar'), video('def12345678', 'solar')], enrich: async items => items.map((item, index) => index ? { ...item, detailError: 'bloqueio', captionAvailable: undefined } : { ...item, captionAvailable: true, description: 'Completa' }), assess: async (_topic, item) => { assessed.push(item.id); return { probability: 0.9, accepted: true }; } });
  assert.deepEqual(assessed, ['abc12345678']);
  assert.equal(result.videos.length, 1);
  assert.match(result.warnings[0], /could not be verified/i);
});

test('total failure in public details does not approve based on the title alone', async () => {
  let assessed = false;
  await assert.rejects(runDiscovery({ topic: 'energia', settings: { ...settings, youtubeMode: 'web' }, expand: async () => [{ language: 'pt', query: 'solar' }], search: async () => [video('abc12345678', 'solar')], enrich: async () => { throw new Error('bloqueio'); }, assess: async () => { assessed = true; return { probability: 0.9, accepted: true }; } }), /details/i);
  assert.equal(assessed, false);
});

test('evaluation limit interleaves the results of the languages', async () => {
  const assessed = [];
  await runDiscovery({
    topic: 'tema', settings: { ...settings, maxEvaluations: 4 },
    expand: async () => [{ language: 'pt', query: 'termo pt' }, { language: 'en', query: 'term en' }],
    search: async term => term.language === 'pt'
      ? ['AAA00000001', 'AAA00000002', 'AAA00000003', 'AAA00000004'].map(id => video(id, term.query))
      : ['BBB00000001', 'BBB00000002', 'BBB00000003', 'BBB00000004'].map(id => video(id, term.query)),
    enrich: async items => items,
    assess: async (_topic, item) => { assessed.push(item.id); return { probability: 0.8, accepted: true }; }
  });
  assert.deepEqual(assessed.sort(), ['AAA00000001', 'AAA00000002', 'BBB00000001', 'BBB00000002']);
});

test('official API also excludes videos without captions when the filter is on', async () => {
  const assessed = [];
  const result = await runDiscovery({
    topic: 'energia', settings: { ...settings, youtubeMode: 'api', captionedOnly: true },
    expand: async () => [{ language: 'pt', query: 'solar' }],
    search: async () => [video('abc12345678', 'solar'), video('def12345678', 'solar')],
    enrich: async items => items.map((item, index) => ({ ...item, captionAvailable: index === 0 })),
    assess: async (_topic, item) => { assessed.push(item.id); return { probability: 0.9, accepted: true }; }
  });
  assert.deepEqual(assessed, ['abc12345678']);
  assert.equal(result.videos.length, 1);
});

test('API details failure blocks approval when captions must be verified', async () => {
  let assessed = false;
  await assert.rejects(runDiscovery({
    topic: 'energia', settings: { ...settings, youtubeMode: 'api', captionedOnly: true },
    expand: async () => [{ language: 'pt', query: 'solar' }],
    search: async () => [video('abc12345678', 'solar')],
    enrich: async () => { throw new Error('quota'); },
    assess: async () => { assessed = true; return { probability: 0.9, accepted: true }; }
  }), /details/i);
  assert.equal(assessed, false);
});

test('continuation drops old terms and already evaluated videos before spending on details', async () => {
  const previousResult = { topic: 'energia', terms: [{ language: 'pt', query: '  ENERGIA solar ' }], videos: [{ ...video('abc12345678', 'energia solar'), status: 'approved', probability: 0.8 }], rounds: 1 };
  const searched = [];
  const assessed = [];
  const result = await runDiscovery({
    topic: 'energia', settings, previousResult,
    expand: async (_topic, context) => {
      assert.equal(context.previousTerms[0].query, '  ENERGIA solar ');
      assert.equal(context.round, 2);
      return [{ language: 'pt', query: 'energia solar' }, { language: 'pt', query: 'armazenamento renovável' }, { language: 'en', query: 'solar storage' }];
    },
    search: async term => { searched.push(term.query); return [video('abc12345678', term.query), video('def12345678', term.query)]; },
    enrich: async items => { assert.deepEqual(items.map(item => item.id), ['def12345678']); return items; },
    assess: async (_topic, item) => { assessed.push(item.id); return { probability: 0.9, accepted: true }; }
  });
  assert.deepEqual(searched, ['armazenamento renovável', 'solar storage']);
  assert.deepEqual(assessed, ['def12345678']);
  assert.equal(result.videos.length, 1);
});

test('continuation with no new videos returns an empty batch and does not re-evaluate', async () => {
  const result = await runDiscovery({
    topic: 'energia', settings, previousResult: { topic: 'energia', terms: [{ language: 'pt', query: 'antigo' }], videos: [video('abc12345678', 'antigo')] },
    expand: async () => [{ language: 'pt', query: 'novo' }], search: async () => [video('abc12345678', 'novo')],
    enrich: async () => { assert.fail('Old details must not be called'); }, assess: async () => { assert.fail('Old evaluation must not be called'); }
  });
  assert.deepEqual(result.videos, []);
  assert.match(result.warnings.join(' '), /no new videos/i);
});

test('continuation filters repeats before the term limit and does not search the original topic on failure', async () => {
  const previousResult = { topic: 'energia', terms: [{ language: 'pt', query: 'antigo' }], videos: [] };
  const options = { topic: 'energia', settings, previousResult, search: async () => { assert.fail('No repeated search should be triggered'); } };
  await assert.rejects(runDiscovery({ ...options, expand: async () => [{ language: 'pt', query: 'antigo' }] }), /new terms/i);
  await assert.rejects(runDiscovery({ ...options, expand: async () => { throw new Error('quota'); } }), /quota/);
});

test('a retired evaluation model stops the search instead of listing every video error', async () => {
  const gone = Object.assign(new Error('the model is no longer available'), { code: 'MODEL_UNAVAILABLE' });
  await assert.rejects(runDiscovery({
    topic: 'tema', settings,
    expand: async () => [{ language: 'pt', query: 'termo' }],
    search: async () => [video('abc12345678', 'termo'), video('def12345678', 'termo')],
    enrich: async items => items,
    assess: async () => { throw gone; }
  }), error => error.code === 'MODEL_UNAVAILABLE');
});
