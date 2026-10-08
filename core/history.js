export const MAX_HISTORY_ITEMS = 25;

export function createHistoryId() {
  return `hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function formatSearchDate(date = new Date()) {
  try {
    const d = typeof date === 'number' || typeof date === 'string' ? new Date(date) : date;
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d);
  } catch {
    return new Date().toLocaleDateString('pt-BR');
  }
}

export function createHistoryEntry(result, selectedVideoIds = []) {
  if (!result || !result.topic) throw new Error('Resultado inválido para salvar no histórico.');
  const id = result.historyId || createHistoryId();
  const selected = Array.isArray(selectedVideoIds) ? selectedVideoIds : Array.from(selectedVideoIds || []);
  const now = Date.now();
  return {
    id,
    topic: String(result.topic).trim(),
    createdAt: result.createdAt || now,
    dateFormatted: result.dateFormatted || formatSearchDate(result.createdAt || now),
    terms: Array.isArray(result.terms) ? result.terms : [],
    videos: Array.isArray(result.videos) ? result.videos : [],
    discoveredCount: Number(result.discoveredCount) || (result.videos || []).length,
    discoveredIds: Array.isArray(result.discoveredIds) ? result.discoveredIds : (result.videos || []).map(v => v.id),
    selectedVideoIds: selected,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    rounds: Number(result.rounds) || 1
  };
}

export function addHistoryEntry(history = [], entry, limit = MAX_HISTORY_ITEMS) {
  const current = Array.isArray(history) ? history : [];
  const filtered = current.filter(item => item.id !== entry.id && item.topic.toLowerCase() !== entry.topic.toLowerCase());
  return [entry, ...filtered].slice(0, limit);
}

export function removeHistoryEntry(history = [], id) {
  if (!Array.isArray(history)) return [];
  return history.filter(item => item.id !== id);
}

export function findHistoryEntry(history = [], id) {
  if (!Array.isArray(history)) return null;
  return history.find(item => item.id === id) || null;
}
