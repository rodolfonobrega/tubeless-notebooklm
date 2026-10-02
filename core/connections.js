export const LLM_PRESETS = Object.freeze({
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash' }
});

export const EVALUATION_PRESETS = Object.freeze({
  openrouter: { baseUrl: 'https://openrouter.ai/api/alpha', protocol: 'decisions', model: 'typesafe/jev-1.13' },
  typesafe: { baseUrl: 'https://api.typesafe.ai', protocol: 'systemone', model: 'jev-latest' },
  openai: { baseUrl: LLM_PRESETS.openai.baseUrl, protocol: 'chat', model: LLM_PRESETS.openai.model },
  groq: { baseUrl: LLM_PRESETS.groq.baseUrl, protocol: 'chat', model: LLM_PRESETS.groq.model },
  deepseek: { baseUrl: LLM_PRESETS.deepseek.baseUrl, protocol: 'chat', model: LLM_PRESETS.deepseek.model }
});

export function normalizeBaseUrl(input) {
  let url;
  try { url = new URL(String(input || '').trim()); }
  catch { throw new Error('Informe uma URL base válida.'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Use HTTPS ou um endereço local em localhost/127.0.0.1.');
  }
  if (url.username || url.password) throw new Error('A URL base não pode conter credenciais.');
  if (url.search || url.hash) throw new Error('A URL base não pode conter parâmetros ou fragmentos.');
  return url.toString().replace(/\/+$/, '');
}

export function endpointUrl(baseUrl, endpoint) {
  const base = normalizeBaseUrl(baseUrl);
  const suffix = String(endpoint).replace(/^\/+/, '');
  if (base.endsWith(`/${suffix}`)) return base;
  const overlap = suffix.split('/')[0];
  return base.endsWith(`/${overlap}`) ? `${base}/${suffix.slice(overlap.length + 1)}` : `${base}/${suffix}`;
}

export function requiredApiOrigins(settings) {
  return [...new Set([settings.llmBaseUrl, settings.evaluationBaseUrl].map(base => {
    const url = new URL(normalizeBaseUrl(base));
    return `${url.protocol}//${url.hostname}/*`;
  }))];
}

export function sanitizeError(message, secrets = []) {
  let text = String(message || 'Não foi possível completar a chamada.');
  for (const secret of secrets) if (secret) text = text.split(secret).join('[oculto]');
  return text.replace(/\b(?:sk-(?:or-v1-|proj-)?|gsk_)[a-zA-Z0-9_-]{12,}\b/g, '[oculto]').slice(0, 400);
}
