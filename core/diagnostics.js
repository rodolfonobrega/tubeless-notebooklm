import { expandQueries, assessVideo, searchYouTube, enrichYouTube } from './providers.js';
import { parseLanguages } from './search.js';
import { sanitizeError } from './connections.js';

export async function testConnections(settings, { fetchImpl = fetch, signal, onResult = () => {} } = {}) {
  const sample = { title: 'Como instalar painéis solares em casa', description: 'Explicação de geração fotovoltaica, instalação residencial e dimensionamento dos painéis.', channel: 'Exemplo', publishedAt: '2026-01-01' };
  const checks = [
    { id: 'llm', title: 'Geração de buscas', run: async () => {
      const terms = await expandQueries('energia solar residencial', { ...settings, termsPerLanguage: 1, languageList: parseLanguages(settings.languages) }, fetchImpl, signal);
      return `${terms.length} termos gerados. Modelo e chamada funcionando.`;
    } },
    { id: 'evaluation', title: 'Avaliação de vídeos', run: async () => {
      const decision = await assessVideo('energia solar residencial', sample, settings, fetchImpl, signal);
      return `Resposta válida. Relevância do exemplo: ${Math.round(decision.probability * 100)}%.`;
    } },
    { id: 'youtube', title: 'YouTube', run: async () => {
      const videos = await searchYouTube({ language: 'pt', query: 'energia solar residencial' }, { ...settings, resultsPerTerm: 3 }, fetchImpl, signal);
      if (!videos.length) throw new Error('A busca não retornou vídeos. Tente novamente.');
      const detailed = await enrichYouTube(videos.slice(0, 3), settings, fetchImpl, signal);
      const verified = detailed.filter(video => !video.detailError && (!settings.captionedOnly || video.captionAvailable === true));
      if (!verified.length) throw new Error(detailed.find(video => video.detailError)?.detailError || 'Não foi possível ler um vídeo com os filtros escolhidos.');
      return `${videos.length} vídeos encontrados; detalhes de ${verified.length} lidos.${settings.youtubeMode === 'web' ? ' Sem chave de API.' : ''}`;
    } }
  ];
  return Promise.all(checks.map(async check => {
    const start = Date.now();
    onResult({ id: check.id, title: check.title, status: 'testing', message: 'Testando…' });
    let result;
    try { result = { id: check.id, title: check.title, status: 'ok', message: await check.run() }; }
    catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      result = { id: check.id, title: check.title, status: 'error', message: sanitizeError(error.message, [settings.llmApiKey, settings.evaluationApiKey, settings.youtubeKey]) };
    }
    result.durationMs = Date.now() - start;
    onResult(result);
    return result;
  }));
}
