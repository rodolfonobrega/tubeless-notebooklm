import { parseNotebookUrl } from './search.js';

export function buildImportQueue(topic, videos, notebookUrl, previous = null) {
  const canonical = parseNotebookUrl(notebookUrl);
  if (!canonical) throw new Error('Destino de notebook inválido.');
  const ids = videos.map(video => video.id);
  const same = previous?.topic === topic && parseNotebookUrl(previous?.notebookUrl) === canonical && JSON.stringify(previous?.ids) === JSON.stringify(ids);
  return {
    topic,
    ids,
    notebookUrl: canonical,
    completed: same && Array.isArray(previous.completed) ? previous.completed.filter(id => ids.includes(id)) : [],
    failures: []
  };
}

export function findNotebookTab(tabs, queue) {
  return tabs.find(tab => parseNotebookUrl(tab.url) === parseNotebookUrl(queue.notebookUrl)) || null;
}

export function recordImportOutcome(queue, id, response) {
  if (!queue.ids.includes(id)) throw new Error('Vídeo fora da fila.');
  const completed = queue.completed.filter(item => item !== id);
  const failures = queue.failures.filter(item => item.id !== id);
  if (response?.status === 'imported' || response?.status === 'duplicate') completed.push(id);
  else failures.push({ id, status: response?.status || 'error', ...(response?.reason === 'layout' ? { reason: 'layout' } : {}), message: response?.message || 'Sem confirmação' });
  return { ...queue, completed, failures };
}

export function recordBatchImportOutcome(queue, response) {
  let updated = queue;
  for (const id of queue.ids.filter(item => !queue.completed.includes(item))) {
    const matches = response?.status === 'batch' && Array.isArray(response.outcomes) ? response.outcomes.filter(item => item?.id === id) : [];
    const outcome = matches.length === 1 && ['imported', 'duplicate', 'uncertain', 'error'].includes(matches[0].status)
      ? matches[0]
      : response?.status === 'error' ? response : { status: 'uncertain', message: response?.message || 'O notebook não confirmou este item do lote. Verifique antes de repetir.' };
    updated = recordImportOutcome(updated, id, outcome);
  }
  return updated;
}

export function shouldPauseImport(response) {
  return response?.status === 'uncertain' || response?.reason === 'layout';
}

export function markImportConfirmed(queue, id) {
  if (!queue.failures.some(item => item.id === id && item.status === 'uncertain')) throw new Error('A fonte não está aguardando confirmação manual.');
  return {
    ...queue,
    completed: [...new Set([...queue.completed, id])],
    failures: queue.failures.filter(item => item.id !== id)
  };
}
