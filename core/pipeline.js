import { uniqueVideos, sortVideosByRelevance, normalizeSettings } from './search.js';
import { expandQueries, searchYouTube, enrichYouTube, assessVideo } from './providers.js';
import { freshSearchTerms } from './continuation.js';

async function mapLimit(items, limit, work, signal, progress) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      signal?.throwIfAborted?.();
      const index = next++;
      try { results[index] = { status: 'fulfilled', value: await work(items[index], index) }; }
      catch (reason) {
        if (signal?.aborted) throw reason;
        results[index] = { status: 'rejected', reason };
      }
      signal?.throwIfAborted?.();
      progress?.(++done, items.length);
    }
  }));
  return results;
}

export async function runDiscovery({ topic, settings, previousResult, fetchImpl = fetch, signal, onProgress = () => {}, expand, search, enrich, assess }) {
  const cleanTopic = String(topic || '').trim();
  if (!cleanTopic) throw new Error('Informe um tema para pesquisar.');
  if (previousResult && previousResult.topic !== cleanTopic) throw new Error('A continuação precisa usar o mesmo tema da pesquisa.');
  const { maxEvaluations, evaluationConcurrency } = normalizeSettings(settings);
  const context = { previousTerms: previousResult?.terms || [], round: previousResult ? (previousResult.rounds || 1) + 1 : 1 };
  const previousIds = new Set(previousResult?.videos.map(video => video.id) || []);
  const warnings = [];
  const requireCaptions = settings.captionedOnly === true || (settings.youtubeMode === 'web' && settings.captionedOnly !== false);
  const doExpand = expand || ((value, history) => expandQueries(value, settings, fetchImpl, signal, history));
  const doSearch = search || ((term) => searchYouTube(term, settings, fetchImpl, signal));
  const doEnrich = enrich || ((items) => enrichYouTube(items, settings, fetchImpl, signal));
  const doAssess = assess || ((value, video) => assessVideo(value, video, settings, fetchImpl, signal));

  onProgress({ phase: 'expanding', completed: 0, total: 1 });
  let terms;
  try {
    terms = await doExpand(cleanTopic, context);
    if (!Array.isArray(terms)) throw new Error('lista de termos inválida');
  }
  catch (error) {
    if (signal?.aborted) throw error;
    if (previousResult) throw new Error(`Não foi possível preparar termos novos: ${error.message}. Seus resultados anteriores foram mantidos.`);
    terms = [{ language: settings.languageList?.[0] || 'pt', query: cleanTopic }];
    warnings.push(`Não foi possível variar os termos: ${error.message}. Busca pelo tema original.`);
  }
  terms = freshSearchTerms(terms, context.previousTerms, settings.languageList || ['pt'], settings.termsPerLanguage || 3, cleanTopic);
  if (!terms.length) throw new Error('O modelo não gerou termos novos. Os resultados anteriores foram mantidos. Tente novamente ou ajuste os idiomas.');

  onProgress({ phase: 'searching', completed: 0, total: terms.length });
  const searched = await mapLimit(terms, 4, doSearch, signal, (completed, total) => onProgress({ phase: 'searching', completed, total }));
  const found = [];
  const searchErrors = [];
  searched.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') found.push(...outcome.value);
    else searchErrors.push(`${terms[index].query}: ${outcome.reason?.message || 'erro'}`);
  });
  if (searchErrors.length) warnings.push(`${searchErrors.length} busca(s) falharam: ${searchErrors.join(' | ')}`);
  if (!found.length && (!previousResult || searchErrors.length)) throw new Error(searchErrors.length ? `Nenhuma busca concluiu com vídeos. ${searchErrors[0]}` : 'Nenhum vídeo encontrado para este tema.');

  const discovered = uniqueVideos(found);
  const discoveredIds = discovered.map(video => video.id);
  const unique = discovered.filter(video => !previousIds.has(video.id));
  if (!unique.length && previousResult) {
    warnings.push('Nenhum vídeo novo foi encontrado nesta rodada. Os resultados anteriores continuam disponíveis. Tente novos idiomas ou outra rodada.');
    onProgress({ phase: 'done', completed: 0, total: 0 });
    return { topic: cleanTopic, terms, videos: [], warnings, discoveredCount: discovered.length, discoveredIds };
  }
  const byId = new Map(unique.map(video => [video.id, video]));
  const buckets = searched.map(outcome => outcome.status === 'fulfilled' ? outcome.value : []);
  const candidates = [];
  const chosen = new Set();
  const maxRows = Math.max(...buckets.map(bucket => bucket.length));
  for (let row = 0; row < maxRows && candidates.length < maxEvaluations; row++) {
    for (const bucket of buckets) {
      const id = bucket[row]?.id;
      if (byId.has(id) && !chosen.has(id)) {
        chosen.add(id);
        candidates.push(byId.get(id));
        if (candidates.length >= maxEvaluations) break;
      }
    }
  }
  let videos = [];
  onProgress({ phase: 'details', completed: 0, total: candidates.length });
  try {
    for (let start = 0; start < candidates.length; start += 50) {
      signal?.throwIfAborted?.();
      videos.push(...await doEnrich(candidates.slice(start, start + 50)));
      onProgress({ phase: 'details', completed: videos.length, total: candidates.length });
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    if (settings.youtubeMode === 'web' || requireCaptions) throw new Error(`Não foi possível verificar os detalhes dos vídeos: ${error.message}`);
    warnings.push(`Não foi possível carregar todos os detalhes: ${error.message}. Avaliação limitada às informações da busca.`);
    videos = candidates;
  }
  const unread = videos.filter(video => video.detailError);
  if (unread.length) warnings.push(`${unread.length} vídeo(s) não puderam ser verificados e foram excluídos da avaliação. ${unread[0].detailError}`);
  videos = videos.filter(video => !video.detailError && (!requireCaptions || video.captionAvailable === true));
  if (!videos.length) throw new Error(unread[0]?.detailError || 'Nenhum vídeo disponível com os filtros escolhidos. Tente outros termos ou idiomas.');

  onProgress({ phase: 'evaluating', completed: 0, total: videos.length });
  const decisions = await mapLimit(videos, evaluationConcurrency, video => doAssess(cleanTopic, video), signal, (completed, total) => onProgress({ phase: 'evaluating', completed, total }));
  const evaluated = sortVideosByRelevance(videos.map((video, index) => {
    const decision = decisions[index];
    if (decision.status === 'rejected') return { ...video, status: 'error', probability: null, evaluationError: decision.reason?.message || 'Falha na avaliação' };
    return { ...video, status: decision.value.accepted ? 'approved' : 'rejected', probability: decision.value.probability, evaluationError: '' };
  }));
  if (unique.length > candidates.length) warnings.push(`${unique.length - candidates.length} vídeo(s) ficaram fora do limite de avaliação configurado.`);
  if (evaluated.some(video => video.status === 'error')) warnings.push('Alguns vídeos não puderam ser avaliados; revise os resultados.');
  onProgress({ phase: 'done', completed: evaluated.length, total: evaluated.length });
  return { topic: cleanTopic, terms, videos: evaluated, warnings, discoveredCount: discovered.length, discoveredIds };
}
