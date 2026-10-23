import { expandQueries, assessVideo, searchYouTube, enrichYouTube } from './providers.js';
import { parseLanguages } from './search.js';
import { sanitizeError } from './connections.js';

const EVALUATION_PROTOCOLS = ['decisions', 'systemone', 'chat'];
// Statuses and messages that point to the call format, not to the key, quota or network.
const isFormatError = error => [400, 404, 405, 415, 422].includes(error.status) || /invalid response|not valid JSON|did not return/i.test(error.message || '');

// skip maps a check id to its earlier successful result. Those checks are not called again.
export async function testConnections(settings, { fetchImpl = fetch, signal, skip = {}, onResult = () => {} } = {}) {
  const sample = { title: 'How to install solar panels at home', description: 'Explanation of photovoltaic generation, residential installation and panel sizing.', channel: 'Example', publishedAt: '2026-01-01' };
  const detected = { protocol: null };
  const checks = [
    { id: 'llm', title: 'Search generation', run: async () => {
      const terms = await expandQueries('residential solar energy', { ...settings, termsPerLanguage: 1, languageList: parseLanguages(settings.languages) }, fetchImpl, signal);
      return `${terms.length} terms generated. Model and call are working.`;
    } },
    { id: 'evaluation', title: 'Video evaluation', run: async () => {
      // Try the configured format first. Only format errors make the other formats worth trying.
      const order = [settings.evaluationProtocol, ...EVALUATION_PROTOCOLS.filter(protocol => protocol !== settings.evaluationProtocol)];
      let firstError;
      for (const protocol of order) {
        try {
          const decision = await assessVideo('residential solar energy', sample, { ...settings, evaluationProtocol: protocol }, fetchImpl, signal);
          detected.protocol = protocol;
          const note = protocol === settings.evaluationProtocol ? '' : ` Call format detected: ${protocol}.`;
          return `Valid response. Relevance of the example: ${Math.round(decision.probability * 100)}%.${note}`;
        } catch (error) {
          if (signal?.aborted) throw error;
          firstError ??= error;
          if (!isFormatError(error)) break;
        }
      }
      throw firstError;
    } },
    { id: 'youtube', title: 'YouTube', run: async () => {
      const videos = await searchYouTube({ language: 'en', query: 'residential solar energy' }, { ...settings, resultsPerTerm: 3 }, fetchImpl, signal);
      if (!videos.length) throw new Error('The search returned no videos. Try again.');
      const detailed = await enrichYouTube(videos.slice(0, 3), settings, fetchImpl, signal);
      const verified = detailed.filter(video => !video.detailError && (!settings.captionedOnly || video.captionAvailable === true));
      if (!verified.length) throw new Error(detailed.find(video => video.detailError)?.detailError || 'Could not read a video with the chosen filters.');
      return `${videos.length} videos found; details read for ${verified.length}.${settings.youtubeMode === 'web' ? ' No API key.' : ''}`;
    } }
  ];
  return Promise.all(checks.map(async check => {
    if (skip[check.id]) {
      const result = { id: check.id, title: check.title, status: 'ok', message: 'Verified earlier. Settings unchanged, so no call was made.', durationMs: 0, protocol: skip[check.id].protocol ?? null };
      onResult(result);
      return result;
    }
    const start = Date.now();
    onResult({ id: check.id, title: check.title, status: 'testing', message: 'Testing…' });
    let result;
    try { result = { id: check.id, title: check.title, status: 'ok', message: await check.run() }; }
    catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      result = { id: check.id, title: check.title, status: 'error', message: sanitizeError(error.message, [settings.llmApiKey, settings.evaluationApiKey, settings.youtubeKey]) };
    }
    result.durationMs = Date.now() - start;
    if (check.id === 'evaluation') result.protocol = detected.protocol;
    onResult(result);
    return result;
  }));
}
