import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDiscoveryResults, selectionForResult, selectionAfterContinuation, selectedVideoLinks } from '../core/continuation.js';

const first = {
  topic: 'energia', terms: [{ language: 'pt', query: 'solar residencial' }], warnings: [], rounds: 1,
  discoveredIds: ['abc12345678', 'def12345678', 'ghi12345678'], discoveredCount: 3,
  videos: [
    { id: 'abc12345678', probability: 0.8, status: 'approved' },
    { id: 'def12345678', probability: 0.9, status: 'approved' },
    { id: 'ghi12345678', probability: 0.2, status: 'rejected' }
  ]
};

test('novos relevantes entram selecionados, desmarcações antigas permanecem e cópia segue relevância', () => {
  const batch = { topic: first.topic, terms: [{ language: 'pt', query: 'armazenamento' }], warnings: [], discoveredIds: ['abc12345678', 'jkl12345678', 'mno12345678'], discoveredCount: 3,
    videos: [{ id: 'abc12345678', probability: 0.99, status: 'approved' }, { id: 'jkl12345678', probability: 0.95, status: 'approved' }, { id: 'mno12345678', probability: 0.3, status: 'rejected' }] };
  const merged = mergeDiscoveryResults(first, batch);
  const selected = selectionAfterContinuation(first, merged, new Set(['abc12345678']));
  assert.deepEqual(merged.videos.map(video => video.id), ['jkl12345678', 'def12345678', 'abc12345678', 'mno12345678', 'ghi12345678']);
  assert.equal(merged.videos.find(video => video.id === 'abc12345678').probability, 0.8);
  assert.deepEqual([...selected], ['jkl12345678', 'abc12345678']);
  assert.equal(selectedVideoLinks(merged, selected), 'https://www.youtube.com/watch?v=jkl12345678\nhttps://www.youtube.com/watch?v=abc12345678');
  assert.equal(merged.discoveredCount, 5);
  assert.equal(merged.rounds, 2);
  assert.equal(first.videos.length, 3);
});

test('restauração usa seleção salva e seleciona relevantes por padrão somente sem seleção anterior', () => {
  assert.deepEqual([...selectionForResult(first)], ['abc12345678', 'def12345678']);
  assert.deepEqual([...selectionForResult(first, [])], []);
  assert.deepEqual([...selectionForResult(first, ['def12345678', 'ghi12345678', 'inexistente'])], ['def12345678']);
});

test('rodada vazia preserva vídeos anteriores e guarda os termos tentados', () => {
  const merged = mergeDiscoveryResults(first, { topic: first.topic, terms: [{ language: 'en', query: 'renewable storage' }], videos: [], warnings: ['Nenhum vídeo novo'], discoveredIds: first.discoveredIds, discoveredCount: 3 });
  assert.equal(merged.videos.length, 3);
  assert.equal(merged.discoveredCount, 3);
  assert.deepEqual(merged.terms.map(term => term.query), ['solar residencial', 'renewable storage']);
  assert.match(merged.warnings[0], /novo/);
  assert.throws(() => mergeDiscoveryResults(first, { topic: 'outro', videos: [], terms: [] }), /mesmo tema/);
});
