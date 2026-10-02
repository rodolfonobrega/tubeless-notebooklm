import { LLM_PRESETS, EVALUATION_PRESETS } from '../core/connections.js';
import { normalizeSettings } from '../core/search.js';

// Select a complete connection; token prefixes are never used to infer a host.
export function settingsFromEnv(env, { provider = 'openai', chatEvaluation = false } = {}) {
  const selected = LLM_PRESETS[provider];
  if (!selected) throw new Error('Provedor de teste inválido. Use openai, groq, openrouter ou deepseek.');
  const llmBaseUrl = env.LLM_BASE_URL || (provider === 'openai' ? env.OPENAI_BASE_URL : '') || selected.baseUrl;
  const llmApiKey = env.LLM_API_KEY || env[`${provider.toUpperCase()}_API_KEY`] || '';
  const expansionModel = env.LLM_MODEL || (provider === 'openai' ? env.DEFAULT_MODEL : '') || selected.model;
  const explicitEvaluationKey = env.EVALUATION_API_KEY || env.JEV_API_KEY;
  const source = explicitEvaluationKey ? 'explicit' : env.TYPESAFE_API_KEY ? 'typesafe' : 'openrouter';
  const evaluationApiKey = explicitEvaluationKey || (source === 'typesafe' ? env.TYPESAFE_API_KEY : env.OPENROUTER_API_KEY) || '';
  const explicitHost = env.EVALUATION_BASE_URL ? new URL(env.EVALUATION_BASE_URL).hostname : '';
  const evaluationProtocol = env.EVALUATION_PROTOCOL || (explicitHost === 'api.typesafe.ai' || (!explicitHost && source === 'typesafe') ? 'systemone' : 'decisions');
  if (!chatEvaluation && evaluationProtocol === 'chat' && !env.EVALUATION_BASE_URL && source !== 'openrouter') {
    throw new Error('Informe EVALUATION_BASE_URL para uma conexão de avaliação Chat Completions explícita.');
  }
  if (!chatEvaluation && evaluationProtocol === 'decisions' && source === 'typesafe' && !env.EVALUATION_BASE_URL) {
    throw new Error('A chave TypeSafe direta requer o protocolo systemone.');
  }
  const fallback = evaluationProtocol === 'systemone'
    ? source === 'openrouter' ? { baseUrl: LLM_PRESETS.openrouter.baseUrl, model: 'jev-latest' } : EVALUATION_PRESETS.typesafe
    : evaluationProtocol === 'chat' ? LLM_PRESETS.openrouter : EVALUATION_PRESETS.openrouter;
  return normalizeSettings({
    llmBaseUrl, llmApiKey, expansionModel,
    evaluationBaseUrl: chatEvaluation ? llmBaseUrl : env.EVALUATION_BASE_URL || fallback.baseUrl,
    evaluationApiKey: chatEvaluation ? llmApiKey : evaluationApiKey,
    evaluationProtocol: chatEvaluation ? 'chat' : evaluationProtocol,
    jevModel: chatEvaluation ? expansionModel : env.EVALUATION_MODEL || fallback.model,
    youtubeMode: env.YOUTUBE_MODE || 'web', youtubeKey: env.YOUTUBE_API_KEY || '',
    languages: 'pt,en', termsPerLanguage: 1, resultsPerTerm: 2, maxEvaluations: 2, captionedOnly: true
  });
}
