import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImportQueue, findNotebookTab, recordImportOutcome, recordBatchImportOutcome, shouldPauseImport, markImportConfirmed } from '../core/imports.js';

const videos = [{ id: 'abc12345678', title: 'A' }, { id: 'def12345678', title: 'B' }];
const urlA = 'https://notebook.google.com/notebook/aaa';
const urlB = 'https://notebook.google.com/notebook/bbb';

test('lote registra confirmação individual e mantém itens sem resposta para revisão', () => {
  const queue = buildImportQueue('tema', videos, urlA);
  const partial = recordBatchImportOutcome(queue, { status: 'batch', outcomes: [{ id: videos[0].id, status: 'imported' }, { id: 'foraDaFila', status: 'imported' }] });
  assert.deepEqual(partial.completed, [videos[0].id]);
  assert.equal(partial.failures[0].id, videos[1].id);
  assert.equal(partial.failures[0].status, 'uncertain');
  const completed = recordBatchImportOutcome(partial, { status: 'batch', outcomes: [{ id: videos[1].id, status: 'duplicate' }] });
  assert.deepEqual(completed.completed, videos.map(video => video.id));
  assert.deepEqual(completed.failures, []);
});

test('resposta conflitante ou perdida não confirma nem libera reenvio automático', () => {
  const queue = buildImportQueue('tema', videos, urlA);
  const conflicting = recordBatchImportOutcome(queue, { status: 'batch', outcomes: [{ id: videos[0].id, status: 'imported' }, { id: videos[0].id, status: 'error' }] });
  assert.deepEqual(conflicting.completed, []);
  assert.ok(conflicting.failures.every(item => item.status === 'uncertain'));
  assert.ok(recordBatchImportOutcome(queue, null).failures.every(item => item.status === 'uncertain'));
});

test('erro anterior à submissão mantém o motivo de layout em todos os itens do lote', () => {
  const queue = buildImportQueue('tema', videos, urlA);
  const failed = recordBatchImportOutcome(queue, { status: 'error', reason: 'layout', message: 'Controle ausente' });
  assert.deepEqual(failed.completed, []);
  assert.equal(failed.failures.length, 2);
  assert.ok(failed.failures.every(item => item.reason === 'layout'));
});

test('fila fixa o notebook e só retoma no mesmo destino', () => {
  const original = buildImportQueue('tema', videos, urlA);
  const after = recordImportOutcome(original, 'abc12345678', { status: 'imported' });
  const resumed = buildImportQueue('tema', videos, urlA, after);
  const other = buildImportQueue('tema', videos, urlB, after);
  assert.equal(resumed.notebookUrl, urlA);
  assert.deepEqual(resumed.completed, ['abc12345678']);
  assert.deepEqual(other.completed, []);
  assert.equal(findNotebookTab([{ id: 2, url: urlB }, { id: 1, url: urlA }], resumed)?.id, 1);
});

test('falha individual mantém outros vídeos pendentes', () => {
  const queue = buildImportQueue('tema', videos, urlA);
  const failed = recordImportOutcome(queue, 'abc12345678', { status: 'error', message: 'recusado' });
  const next = recordImportOutcome(failed, 'def12345678', { status: 'imported' });
  assert.deepEqual(next.completed, ['def12345678']);
  assert.deepEqual(next.failures, [{ id: 'abc12345678', status: 'error', message: 'recusado' }]);
});

test('fonte incerta pode ser confirmada manualmente após verificação no notebook', () => {
  const queue = buildImportQueue('tema', videos, urlA);
  const uncertain = recordImportOutcome(queue, 'abc12345678', { status: 'uncertain', message: 'sem confirmação' });
  const confirmed = markImportConfirmed(uncertain, 'abc12345678');
  assert.deepEqual(confirmed.completed, ['abc12345678']);
  assert.deepEqual(confirmed.failures, []);
  assert.throws(() => markImportConfirmed(queue, 'def12345678'));
});

test('resposta incerta pausa a fila para evitar atribuir uma fonte tardia a outro vídeo', () => {
  assert.equal(shouldPauseImport({ status: 'uncertain' }), true);
  assert.equal(shouldPauseImport({ status: 'error' }), false);
  assert.equal(shouldPauseImport({ status: 'imported' }), false);
});

test('erro de layout pausa sem repetir a mesma falha em todos os vídeos da fila', () => {
  assert.equal(shouldPauseImport({ status: 'error', reason: 'layout' }), true);
  const queue = buildImportQueue('tema', [{ id: 'abc12345678' }, { id: 'def12345678' }], 'https://notebook.google.com/notebook/demo');
  const result = recordImportOutcome(queue, 'abc12345678', { status: 'error', reason: 'layout', message: 'Controle ausente' });
  assert.equal(result.failures[0].reason, 'layout');
  assert.equal(result.failures.length, 1);
  assert.deepEqual(result.completed, []);
});
