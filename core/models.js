export const MODEL_CATALOG_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const PROVIDERS = ['openai', 'groq', 'deepseek', 'openrouter', 'typesafe'];
const HOSTS = { 'api.openai.com': 'openai', 'api.groq.com': 'groq', 'api.deepseek.com': 'deepseek', 'openrouter.ai': 'openrouter', 'api.typesafe.ai': 'typesafe' };
const DAY = 86400000;
const MAX_BYTES = 8 * 1024 * 1024;
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,199}$/.test(id) && !id.startsWith('ft:');
const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date));
const active = (row, now) => !row.deprecatedOn || row.deprecatedOn > new Date(now).toISOString().slice(0, 10);

export const CURATED_DECISIONS_MODELS = Object.freeze([
  'perplexity/pplx-decider-v1.1-27b',
  'openai/gpt-6-luna-decisions',
  'typesafe/jev-1.13'
]);

export const CURATED_EVALUATION_MODELS = Object.freeze({
  openrouter: CURATED_DECISIONS_MODELS,
  typesafe: ['jev-latest', 'jev-1.13.0']
});

export function parseModelCatalog(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid model catalog.');
  const maps = Object.fromEntries(PROVIDERS.map(provider => [provider, new Map()]));
  for (const [key, metadata] of Object.entries(raw)) {
    const provider = metadata?.litellm_provider;
    if (!PROVIDERS.includes(provider) || !['chat', 'evaluation'].includes(metadata.mode)) continue;
    if (metadata.mode === 'chat' && Array.isArray(metadata.supported_endpoints) && metadata.supported_endpoints.length && !metadata.supported_endpoints.some(endpoint => /(?:^|\/)chat\/completions$/.test(endpoint))) continue;
    // Strip the LiteLLM routing prefix only; provider model namespaces stay intact.
    const id = key.startsWith(`${provider}/`) ? key.slice(provider.length + 1) : key;
    if (!validId(id)) continue;
    if (metadata.mode === 'chat' && /(^|\/)jev(?:-|$)/i.test(id)) continue;
    const row = { id, mode: metadata.mode };
    if (validDate(metadata.deprecation_date)) row.deprecatedOn = metadata.deprecation_date;
    if (!active(row, now)) continue;
    const previous = maps[provider].get(id);
    if (!previous || (previous.deprecatedOn && (!row.deprecatedOn || row.deprecatedOn > previous.deprecatedOn))) maps[provider].set(id, row);
  }
  const foundAny = Object.values(maps).some(map => map.size > 0);
  if (!foundAny) throw new Error('Catalog has no compatible models.');
  for (const [provider, models] of Object.entries(CURATED_EVALUATION_MODELS)) {
    if (!maps[provider]) continue;
    for (const id of models) {
      if (!maps[provider].has(id)) {
        maps[provider].set(id, { id, mode: 'evaluation' });
      }
    }
  }
  const providers = Object.fromEntries(PROVIDERS.map(provider => [provider, [...maps[provider].values()].sort((a, b) => a.id.localeCompare(b.id, 'en'))]));
  return { version: 2, fetchedAt: now, providers };
}

// OpenRouter lists its own models. Text models serve generation (chat); decision models serve evaluation.
export function parseOpenRouterModels(raw, now = Date.now()) {
  if (!Array.isArray(raw?.data)) throw new Error('Invalid OpenRouter model list.');
  const rows = [];
  for (const model of raw.data) {
    const id = model?.id;
    if (!validId(id)) continue;
    const outputs = Array.isArray(model.architecture?.output_modalities) ? model.architecture.output_modalities : [];
    const modes = [];
    if (outputs.includes('text') && !/(^|\/)jev(?:-|$)/i.test(id)) modes.push('chat');
    if (outputs.includes('decisions')) modes.push('evaluation');
    for (const mode of modes) {
      const row = { id, mode };
      if (validDate(model.expiration_date)) row.deprecatedOn = model.expiration_date;
      if (active(row, now)) rows.push(row);
    }
  }
  return rows;
}

function validSnapshot(value) {
  return value?.version === 2 && Number.isFinite(value.fetchedAt) && value.fetchedAt >= 0 &&
    PROVIDERS.every(provider => Array.isArray(value.providers?.[provider]) && value.providers[provider].length <= 2500 &&
      value.providers[provider].every(row => validId(row?.id) && ['chat', 'evaluation'].includes(row.mode) && (!row.deprecatedOn || validDate(row.deprecatedOn)))) &&
    PROVIDERS.some(provider => value.providers[provider].length > 0);
}

export function modelsForConnection(catalog, baseUrl, protocol = 'chat', now = Date.now()) {
  let provider;
  try { provider = HOSTS[new URL(baseUrl).hostname]; } catch { return []; }
  const mode = protocol === 'chat' ? 'chat' : 'evaluation';
  const list = (catalog?.providers?.[provider] || []).filter(row => row.mode === mode && active(row, now)).map(row => row.id);
  if (!list.length && CURATED_EVALUATION_MODELS[provider] && mode === 'evaluation') {
    return [...CURATED_EVALUATION_MODELS[provider]];
  }
  return list;
}

// Returns the call format a catalog model needs, or null when the catalog cannot tell.
export function inferEvaluationProtocol(catalog, baseUrl, modelId) {
  let provider;
  try { provider = HOSTS[new URL(baseUrl).hostname]; } catch { return null; }
  if (provider === 'typesafe') return /(^|\/)jev(?:-|$)/i.test(modelId) ? 'systemone' : null;
  const row = (catalog?.providers?.[provider] || []).find(item => item.id === modelId);
  if (!row) return null;
  if (provider === 'openrouter') return row.mode === 'evaluation' ? 'decisions' : 'chat';
  return 'chat';
}

async function readJson(response) {
  if (!response.ok) throw new Error(`Catalog unavailable (HTTP ${response.status}).`);
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Catalog exceeds the size limit.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty catalog response.');
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Catalog exceeds the size limit.'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally { reader.releaseLock(); }
}

export class ModelCatalog {
  constructor({ fetchImpl = fetch, storage = globalThis.chrome?.storage.local, now = Date.now } = {}) {
    this.fetchImpl = (...args) => fetchImpl(...args);
    this.storage = storage;
    this.now = now;
    this.catalog = null;
    this.needsRefresh = true;
    this.pending = null;
  }

  async load() {
    let cached;
    try { cached = (await this.storage?.get('modelCatalog'))?.modelCatalog; } catch { /* Local fallback below. */ }
    if (validSnapshot(cached) && cached.fetchedAt <= this.now() + 300000) {
      this.catalog = cached;
      this.needsRefresh = this.now() - cached.fetchedAt >= DAY;
      return this.catalog;
    }
    const bundled = await readJson(await this.fetchImpl(new URL('../assets/model-catalog.json', import.meta.url).href));
    if (!validSnapshot(bundled)) throw new Error('Invalid local catalog.');
    this.catalog = bundled;
    return this.catalog;
  }

  // Replaces the LiteLLM rows for OpenRouter. If the OpenRouter list fails, the LiteLLM rows stay.
  async addOpenRouterModels(catalog) {
    try {
      const response = await this.fetchImpl(OPENROUTER_MODELS_URL, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) });
      const rows = parseOpenRouterModels(await readJson(response), this.now());
      const byKey = new Map(rows.map(row => [`${row.mode}:${row.id}`, row]));
      for (const id of CURATED_EVALUATION_MODELS.openrouter) {
        if (!byKey.has(`evaluation:${id}`)) byKey.set(`evaluation:${id}`, { id, mode: 'evaluation' });
      }
      catalog.providers.openrouter = [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
    } catch { /* Keep the LiteLLM rows for OpenRouter. */ }
  }

  refresh() {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const response = await this.fetchImpl(MODEL_CATALOG_URL, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) });
      const catalog = parseModelCatalog(await readJson(response), this.now());
      await this.addOpenRouterModels(catalog);
      this.catalog = catalog;
      this.needsRefresh = false;
      try { await this.storage?.set({ modelCatalog: catalog }); } catch { /* Fresh list still works for this panel. */ }
      return catalog;
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
}
