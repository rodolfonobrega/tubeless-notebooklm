import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryEntry, addHistoryEntry, removeHistoryEntry, findHistoryEntry, MAX_HISTORY_ITEMS } from '../core/history.js';

test('cria entrada de histórico preservando vídeos, seleções e termos', () => {
  const result = {
    topic: 'sketchup iniciante',
    terms: [{ language: 'pt', query: 'sketchup tutorial' }],
    videos: [{ id: 'vid12345678', title: 'Aula 1', status: 'approved' }],
    discoveredCount: 10,
    warnings: ['Aviso']
  };
  const entry = createHistoryEntry(result, ['vid12345678']);
  assert.equal(entry.topic, 'sketchup iniciante');
  assert.ok(entry.id.startsWith('hist_'));
  assert.deepEqual(entry.selectedVideoIds, ['vid12345678']);
  assert.equal(entry.discoveredCount, 10);
  assert.equal(entry.videos.length, 1);
});

test('adiciona nova busca no topo e substitui mesma pesquisa', () => {
  const e1 = createHistoryEntry({ topic: 'curso sketchup' }, ['id1']);
  const e2 = createHistoryEntry({ topic: 'física quântica' }, ['id2']);
  let history = addHistoryEntry([], e1);
  assert.equal(history.length, 1);
  history = addHistoryEntry(history, e2);
  assert.equal(history.length, 2);
  assert.equal(history[0].topic, 'física quântica');

  // Adicionando mesma busca atualizada deve ir para o topo
  const e1Updated = createHistoryEntry({ topic: 'curso sketchup', discoveredCount: 20 }, ['id1', 'id3']);
  history = addHistoryEntry(history, e1Updated);
  assert.equal(history.length, 2);
  assert.equal(history[0].topic, 'curso sketchup');
  assert.equal(history[0].discoveredCount, 20);
});

test('respeita limite máximo de histórico', () => {
  let history = [];
  for (let i = 0; i < 30; i++) {
    const entry = createHistoryEntry({ topic: `tema ${i}` });
    history = addHistoryEntry(history, entry, 5);
  }
  assert.equal(history.length, 5);
  assert.equal(history[0].topic, 'tema 29');
});

test('remove busca do histórico e localiza por ID', () => {
  const e1 = createHistoryEntry({ topic: 'tema A' });
  const e2 = createHistoryEntry({ topic: 'tema B' });
  let history = addHistoryEntry([e1], e2);
  assert.equal(findHistoryEntry(history, e1.id).topic, 'tema A');
  assert.equal(findHistoryEntry(history, 'inexistente'), null);

  history = removeHistoryEntry(history, e1.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].topic, 'tema B');
});
