import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImportQueue, findNotebookTab, recordImportOutcome, recordBatchImportOutcome, shouldPauseImport, markImportConfirmed } from '../core/imports.js';

const videos = [{ id: 'abc12345678', title: 'A' }, { id: 'def12345678', title: 'B' }];
const urlA = 'https://notebook.google.com/notebook/aaa';
const urlB = 'https://notebook.google.com/notebook/bbb';

test('batch records individual confirmation and keeps unanswered items for review', () => {
  const queue = buildImportQueue('topic', videos, urlA);
  const partial = recordBatchImportOutcome(queue, { status: 'batch', outcomes: [{ id: videos[0].id, status: 'imported' }, { id: 'foraDaFila', status: 'imported' }] });
  assert.deepEqual(partial.completed, [videos[0].id]);
  assert.equal(partial.failures[0].id, videos[1].id);
  assert.equal(partial.failures[0].status, 'uncertain');
  const completed = recordBatchImportOutcome(partial, { status: 'batch', outcomes: [{ id: videos[1].id, status: 'duplicate' }] });
  assert.deepEqual(completed.completed, videos.map(video => video.id));
  assert.deepEqual(completed.failures, []);
});

test('a conflicting or lost response neither confirms nor releases an automatic resend', () => {
  const queue = buildImportQueue('topic', videos, urlA);
  const conflicting = recordBatchImportOutcome(queue, { status: 'batch', outcomes: [{ id: videos[0].id, status: 'imported' }, { id: videos[0].id, status: 'error' }] });
  assert.deepEqual(conflicting.completed, []);
  assert.ok(conflicting.failures.every(item => item.status === 'uncertain'));
  assert.ok(recordBatchImportOutcome(queue, null).failures.every(item => item.status === 'uncertain'));
});

test('an error before submission keeps the layout reason on every batch item', () => {
  const queue = buildImportQueue('topic', videos, urlA);
  const failed = recordBatchImportOutcome(queue, { status: 'error', reason: 'layout', message: 'Controle ausente' });
  assert.deepEqual(failed.completed, []);
  assert.equal(failed.failures.length, 2);
  assert.ok(failed.failures.every(item => item.reason === 'layout'));
});

test('queue pins the notebook and only resumes at the same destination', () => {
  const original = buildImportQueue('topic', videos, urlA);
  const after = recordImportOutcome(original, 'abc12345678', { status: 'imported' });
  const resumed = buildImportQueue('topic', videos, urlA, after);
  const other = buildImportQueue('topic', videos, urlB, after);
  assert.equal(resumed.notebookUrl, urlA);
  assert.deepEqual(resumed.completed, ['abc12345678']);
  assert.deepEqual(other.completed, []);
  assert.equal(findNotebookTab([{ id: 2, url: urlB }, { id: 1, url: urlA }], resumed)?.id, 1);
});

test('an individual failure keeps other videos pending', () => {
  const queue = buildImportQueue('topic', videos, urlA);
  const failed = recordImportOutcome(queue, 'abc12345678', { status: 'error', message: 'recusado' });
  const next = recordImportOutcome(failed, 'def12345678', { status: 'imported' });
  assert.deepEqual(next.completed, ['def12345678']);
  assert.deepEqual(next.failures, [{ id: 'abc12345678', status: 'error', message: 'recusado' }]);
});

test('an uncertain source can be confirmed manually after checking the notebook', () => {
  const queue = buildImportQueue('topic', videos, urlA);
  const uncertain = recordImportOutcome(queue, 'abc12345678', { status: 'uncertain', message: 'no confirmation' });
  const confirmed = markImportConfirmed(uncertain, 'abc12345678');
  assert.deepEqual(confirmed.completed, ['abc12345678']);
  assert.deepEqual(confirmed.failures, []);
  assert.throws(() => markImportConfirmed(queue, 'def12345678'));
});

test('an uncertain response pauses the queue to avoid assigning a late source to another video', () => {
  assert.equal(shouldPauseImport({ status: 'uncertain' }), true);
  assert.equal(shouldPauseImport({ status: 'error' }), false);
  assert.equal(shouldPauseImport({ status: 'imported' }), false);
});

test('a layout error pauses without repeating the same failure on every queued video', () => {
  assert.equal(shouldPauseImport({ status: 'error', reason: 'layout' }), true);
  const queue = buildImportQueue('topic', [{ id: 'abc12345678' }, { id: 'def12345678' }], 'https://notebook.google.com/notebook/demo');
  const result = recordImportOutcome(queue, 'abc12345678', { status: 'error', reason: 'layout', message: 'Controle ausente' });
  assert.equal(result.failures[0].reason, 'layout');
  assert.equal(result.failures.length, 1);
  assert.deepEqual(result.completed, []);
});
