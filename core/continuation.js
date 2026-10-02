import { normalizeTerms, sortVideosByRelevance, videoUrl } from './search.js';

export const searchTermKey = term => String(term?.query || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();

export function freshSearchTerms(terms, previousTerms, languages, perLanguage, fallback) {
  const seen = new Set(previousTerms.map(searchTermKey));
  const fresh = terms.filter(term => !seen.has(searchTermKey(term)));
  if (!fresh.length && previousTerms.length) return [];
  return normalizeTerms(Object.fromEntries(languages.map(language => [language, fresh.filter(term => term?.language === language).map(term => term.query)])), languages, perLanguage, fallback)
    .filter(term => !seen.has(searchTermKey(term)));
}

export function mergeDiscoveryResults(previous, batch) {
  if (!previous) return { ...batch, rounds: 1 };
  if (previous.topic !== batch.topic) throw new Error('A continuação precisa usar o mesmo tema da pesquisa.');
  const byId = new Map(previous.videos.map(video => [video.id, video]));
  for (const video of batch.videos) if (!byId.has(video.id)) byId.set(video.id, video);
  const terms = [];
  const seenTerms = new Set();
  for (const term of [...previous.terms, ...batch.terms]) {
    const key = searchTermKey(term);
    if (!seenTerms.has(key)) { seenTerms.add(key); terms.push(term); }
  }
  const knownBefore = new Set(previous.discoveredIds || previous.videos.map(video => video.id));
  const discoveredIds = [...new Set([...knownBefore, ...(batch.discoveredIds || batch.videos.map(video => video.id))])];
  const discoveredCount = Math.max(Number(previous.discoveredCount) || 0, knownBefore.size) + discoveredIds.length - knownBefore.size;
  return {
    topic: previous.topic, terms, videos: sortVideosByRelevance([...byId.values()]),
    warnings: [...new Set([...(previous.warnings || []), ...(batch.warnings || [])])],
    discoveredIds, discoveredCount, rounds: (previous.rounds || 1) + 1
  };
}

export function selectionForResult(result, storedIds) {
  const approved = result?.videos.filter(video => video.status === 'approved').map(video => video.id) || [];
  return new Set(Array.isArray(storedIds) ? approved.filter(id => storedIds.includes(id)) : approved);
}

export function selectionAfterContinuation(previous, merged, selected) {
  const oldIds = new Set(previous.videos.map(video => video.id));
  return new Set(merged.videos.filter(video => video.status === 'approved' && (!oldIds.has(video.id) || selected.has(video.id))).map(video => video.id));
}

export function selectedVideoLinks(result, selected) {
  return sortVideosByRelevance(result?.videos || []).filter(video => video.status === 'approved' && selected.has(video.id)).map(video => videoUrl(video.id)).join('\n');
}
