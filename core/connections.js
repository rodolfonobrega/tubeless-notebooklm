export const LLM_PRESETS = Object.freeze({
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' }
});

export const EVALUATION_PRESETS = Object.freeze({
  openrouter: { baseUrl: 'https://openrouter.ai/api/alpha', protocol: 'decisions', model: 'perplexity/pplx-decider-v1.1-27b' },
  typesafe: { baseUrl: 'https://api.typesafe.ai', protocol: 'systemone', model: 'jev-latest' },
  openai: { baseUrl: LLM_PRESETS.openai.baseUrl, protocol: 'chat', model: LLM_PRESETS.openai.model },
  groq: { baseUrl: LLM_PRESETS.groq.baseUrl, protocol: 'chat', model: LLM_PRESETS.groq.model },
  deepseek: { baseUrl: LLM_PRESETS.deepseek.baseUrl, protocol: 'chat', model: LLM_PRESETS.deepseek.model }
});

export function normalizeBaseUrl(input) {
  let url;
  try { url = new URL(String(input || '').trim()); }
  catch { throw new Error('Enter a valid base URL.'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Use HTTPS or a local address on localhost/127.0.0.1.');
  }
  if (url.username || url.password) throw new Error('The base URL cannot contain credentials.');
  if (url.search || url.hash) throw new Error('The base URL cannot contain query parameters or fragments.');
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
  let text = String(message || 'The request could not be completed.');
  for (const secret of secrets) if (secret) text = text.split(secret).join('[hidden]');
  return text.replace(/\b(?:sk-(?:or-v1-|proj-)?|gsk_)[a-zA-Z0-9_-]{12,}\b/g, '[hidden]').slice(0, 400);
}

export function maskSecretKey(key) {
  if (typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (!trimmed) return 'No key configured';
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`;
  }
  if (trimmed.length <= 16) {
    return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
  }
  const maxPrefixLen = Math.max(4, trimmed.length - 8);
  const targetPrefixLen = trimmed.startsWith('sk-or-v1-') ? 12 : trimmed.startsWith('sk-proj-') ? 11 : 6;
  const prefix = trimmed.slice(0, Math.min(targetPrefixLen, maxPrefixLen));
  const suffix = trimmed.slice(-4);
  return `${prefix}••••••••••••••••${suffix}`;
}
