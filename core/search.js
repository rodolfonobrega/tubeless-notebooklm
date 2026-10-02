import { normalizeBaseUrl, LLM_PRESETS, EVALUATION_PRESETS } from './connections.js';

export const DEFAULT_SETTINGS = Object.freeze({
  settingsVersion: 2,
  llmBaseUrl: LLM_PRESETS.openai.baseUrl,
  llmApiKey: '',
  evaluationBaseUrl: EVALUATION_PRESETS.openrouter.baseUrl,
  evaluationApiKey: '',
  evaluationProtocol: 'decisions',
  youtubeMode: 'web',
  youtubeKey: '',
  expansionModel: LLM_PRESETS.openai.model,
  jevModel: 'typesafe/jev-1.13',
  languages: 'pt,en',
  termsPerLanguage: 3,
  resultsPerTerm: 8,
  maxEvaluations: 24,
  evaluationConcurrency: 8,
  threshold: 0.7,
  captionedOnly: true,
  notebookUrl: ''
});

const clamp = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function normalizeSettings(raw = {}) {
  const value = { ...DEFAULT_SETTINGS, ...raw };
  const legacy = raw.settingsVersion !== 2 && Object.hasOwn(raw, 'openRouterKey');
  const expansionModel = String(value.expansionModel || '').trim();
  return {
    settingsVersion: 2,
    llmBaseUrl: normalizeBaseUrl(raw.llmBaseUrl || (legacy ? LLM_PRESETS.openrouter.baseUrl : value.llmBaseUrl)),
    llmApiKey: String(raw.llmApiKey ?? (legacy ? raw.openRouterKey : value.llmApiKey) ?? '').trim(),
    evaluationBaseUrl: normalizeBaseUrl(value.evaluationBaseUrl),
    evaluationApiKey: String(raw.evaluationApiKey ?? (legacy ? raw.openRouterKey : value.evaluationApiKey) ?? '').trim(),
    evaluationProtocol: ['decisions', 'systemone', 'chat'].includes(value.evaluationProtocol) ? value.evaluationProtocol : 'decisions',
    youtubeMode: ['web', 'api'].includes(raw.youtubeMode) ? raw.youtubeMode : legacy && raw.youtubeKey ? 'api' : 'web',
    youtubeKey: String(value.youtubeKey || '').trim(),
    expansionModel: !expansionModel || /(^|\/)jev(?:-|$)/i.test(expansionModel) ? DEFAULT_SETTINGS.expansionModel : expansionModel,
    jevModel: String(value.jevModel || '').trim() || DEFAULT_SETTINGS.jevModel,
    languages: String(value.languages || 'pt,en').trim(),
    termsPerLanguage: Math.round(clamp(value.termsPerLanguage, 3, 1, 5)),
    resultsPerTerm: Math.round(clamp(value.resultsPerTerm, 8, 1, 25)),
    maxEvaluations: Math.round(clamp(value.maxEvaluations, 24, 1, 250)),
    evaluationConcurrency: Math.round(clamp(value.evaluationConcurrency, 8, 1, 16)),
    threshold: Math.round(clamp(value.threshold, 0.7, 0.05, 0.95) * 100) / 100,
    captionedOnly: value.captionedOnly !== false,
    notebookUrl: parseNotebookUrl(value.notebookUrl) || ''
  };
}

export function parseLanguages(input) {
  return [...new Set(String(input || '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(s => /^[a-z]{2}(?:-[a-z]{2})?$/.test(s)))].slice(0, 5);
}

export function normalizeTerms(raw, languages, perLanguage, fallback) {
  const result = [];
  const seen = new Set();
  for (const language of languages) {
    const candidates = Array.isArray(raw?.[language]) ? raw[language] : [];
    let count = 0;
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      const query = candidate.replace(/\s+/g, ' ').trim().slice(0, 180);
      const key = query.toLocaleLowerCase();
      if (!query || seen.has(key)) continue;
      result.push({ language, query });
      seen.add(key);
      if (++count >= perLanguage) break;
    }
  }
  return result.length ? result : [{ language: languages[0] || 'pt', query: String(fallback).trim().slice(0, 180) }];
}

export function uniqueVideos(videos) {
  const byId = new Map();
  for (const video of videos) {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(video?.id || '')) continue;
    const existing = byId.get(video.id);
    if (existing) {
      if (video.foundBy && !existing.foundBy.includes(video.foundBy)) existing.foundBy.push(video.foundBy);
    } else {
      byId.set(video.id, { ...video, foundBy: video.foundBy ? [video.foundBy] : [] });
    }
  }
  return [...byId.values()];
}

export function sortVideosByRelevance(videos) {
  const score = video => typeof video.probability === 'number' && Number.isFinite(video.probability) && video.probability >= 0 && video.probability <= 1 ? video.probability : -1;
  return [...videos].sort((a, b) => score(b) - score(a));
}

export function parseNotebookUrl(input) {
  try {
    const url = new URL(String(input || '').trim());
    if (url.protocol !== 'https:' || !['notebook.google.com', 'notebooklm.google.com'].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/notebook\/([a-zA-Z0-9_-]+)\/?$/);
    return match ? `https://notebook.google.com/notebook/${match[1]}` : null;
  } catch {
    return null;
  }
}

export function videoUrl(id) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) throw new Error('ID de vídeo inválido');
  return `https://www.youtube.com/watch?v=${id}`;
}
