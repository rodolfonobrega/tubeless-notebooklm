import test from 'node:test';
import assert from 'node:assert/strict';
import { runDiscovery } from '../core/pipeline.js';
import { normalizeSettings } from '../core/search.js';

const settings = { languageList: ['pt', 'en'], termsPerLanguage: 1, maxEvaluations: 3, threshold: 0.7 };
const video = (id, foundBy) => ({ id, title: id, foundBy });

test('avalia 250 vídeos e preserva erros parciais e a ordem de relevância', async () => {
  const assessed = new Set();
  const progress = [];
  const result = await runDiscovery({
    topic: 'tema', settings: { ...normalizeSettings({ maxEvaluations: 250, captionedOnly: false }), languageList: ['pt'] },
    expand: async () => [{ language: 'pt', query: 'termo' }],
    search: async () => Array.from({ length: 260 }, (_, index) => ({ ...video(`VID${String(index).padStart(8, '0')}`, 'termo'), index })),
    enrich: async items => items,
    assess: async (_topic, item) => {
      assessed.add(item.id);
      if (item.index === 7) throw new Error('falha isolada');
      return { probability: item.index / 250, accepted: item.index >= 175 };
    },
    onProgress: value => { if (value.phase === 'evaluating') progress.push(value.completed); }
  });
  assert.equal(assessed.size, 250);
  assert.equal(result.videos.length, 250);
  assert.equal(result.videos[0].index, 249);
  assert.equal(result.videos.at(-1).index, 7);
  assert.equal(result.videos.at(-1).status, 'error');
  assert.match(result.warnings.join(' '), /10 vídeo\(s\) ficaram fora/);
  assert.deepEqual(progress, Array.from({ length: 251 }, (_, index) => index));
});

for (const concurrency of [1, 8, 16, undefined]) {
  test(`avaliações assíncronas respeitam ${concurrency ?? 'o padrão de 8'} chamada(s) simultânea(s)`, async () => {
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

test('cancelamento interrompe chamadas em paralelo sem iniciar os vídeos pendentes', async () => {
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

test('busca termos em paralelo, tolera falha parcial e usa Jev como única aprovação', async () => {
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

test('falha da expansão mantém busca com tema original e avisa', async () => {
  const result = await runDiscovery({
    topic: 'energia', settings,
    expand: async () => { throw new Error('sem créditos'); },
    search: async term => { assert.equal(term.query, 'energia'); return [video('abc12345678', 'energia')]; },
    enrich: async items => items,
    assess: async () => ({ probability: 0.8, accepted: true })
  });
  assert.equal(result.terms[0].query, 'energia');
  assert.match(result.warnings[0], /variar os termos/i);
});

test('saída inesperada da expansão também mantém o tema original', async () => {
  const result = await runDiscovery({ topic: 'energia', settings, expand: async () => undefined, search: async () => [video('abc12345678', 'energia')], enrich: async items => items, assess: async () => ({ probability: 0.8, accepted: true }) });
  assert.deepEqual(result.terms, [{ language: 'pt', query: 'energia' }]);
  assert.match(result.warnings[0], /variar os termos/i);
});

test('erro em todas as buscas não aparece como lista vazia', async () => {
  await assert.rejects(runDiscovery({ topic: 'tema', settings, expand: async () => [{ language: 'pt', query: 'x' }], search: async () => { throw new Error('quota'); }, enrich: async () => [], assess: async () => ({ probability: 1, accepted: true }) }), /quota/);
});

test('busca pública não avalia vídeos cujos detalhes não puderam ser verificados', async () => {
  const assessed = [];
  const result = await runDiscovery({ topic: 'energia', settings: { ...settings, youtubeMode: 'web', captionedOnly: true }, expand: async () => [{ language: 'pt', query: 'solar' }], search: async () => [video('abc12345678', 'solar'), video('def12345678', 'solar')], enrich: async items => items.map((item, index) => index ? { ...item, detailError: 'bloqueio', captionAvailable: undefined } : { ...item, captionAvailable: true, description: 'Completa' }), assess: async (_topic, item) => { assessed.push(item.id); return { probability: 0.9, accepted: true }; } });
  assert.deepEqual(assessed, ['abc12345678']);
  assert.equal(result.videos.length, 1);
  assert.match(result.warnings[0], /não puderam ser verificados/i);
});

test('falha completa nos detalhes públicos não aprova apenas pelo título', async () => {
  let assessed = false;
  await assert.rejects(runDiscovery({ topic: 'energia', settings: { ...settings, youtubeMode: 'web' }, expand: async () => [{ language: 'pt', query: 'solar' }], search: async () => [video('abc12345678', 'solar')], enrich: async () => { throw new Error('bloqueio'); }, assess: async () => { assessed = true; return { probability: 0.9, accepted: true }; } }), /detalhes/i);
  assert.equal(assessed, false);
});

test('limite de avaliação intercala os resultados dos idiomas', async () => {
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

test('API oficial também exclui vídeos sem legendas quando o filtro está ativo', async () => {
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

test('falha nos detalhes da API impede aprovação quando é preciso verificar legendas', async () => {
  let assessed = false;
  await assert.rejects(runDiscovery({
    topic: 'energia', settings: { ...settings, youtubeMode: 'api', captionedOnly: true },
    expand: async () => [{ language: 'pt', query: 'solar' }],
    search: async () => [video('abc12345678', 'solar')],
    enrich: async () => { throw new Error('quota'); },
    assess: async () => { assessed = true; return { probability: 0.9, accepted: true }; }
  }), /detalhes/i);
  assert.equal(assessed, false);
});

test('continuação exclui termos antigos e vídeos já avaliados antes de gastar em detalhes', async () => {
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

test('continuação sem vídeos novos retorna lote vazio e não repete avaliação', async () => {
  const result = await runDiscovery({
    topic: 'energia', settings, previousResult: { topic: 'energia', terms: [{ language: 'pt', query: 'antigo' }], videos: [video('abc12345678', 'antigo')] },
    expand: async () => [{ language: 'pt', query: 'novo' }], search: async () => [video('abc12345678', 'novo')],
    enrich: async () => { assert.fail('Detalhes antigos não devem ser chamados'); }, assess: async () => { assert.fail('Avaliação antiga não deve ser chamada'); }
  });
  assert.deepEqual(result.videos, []);
  assert.match(result.warnings.join(' '), /nenhum vídeo novo/i);
});

test('continuação filtra repetições antes do limite de termos e não busca tema original em falha', async () => {
  const previousResult = { topic: 'energia', terms: [{ language: 'pt', query: 'antigo' }], videos: [] };
  const options = { topic: 'energia', settings, previousResult, search: async () => { assert.fail('Nenhuma busca repetida deve ser disparada'); } };
  await assert.rejects(runDiscovery({ ...options, expand: async () => [{ language: 'pt', query: 'antigo' }] }), /termos novos/i);
  await assert.rejects(runDiscovery({ ...options, expand: async () => { throw new Error('quota'); } }), /quota/);
});
