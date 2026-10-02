export const MODEL_CATALOG_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const PROVIDERS = ['openai', 'groq', 'deepseek', 'openrouter', 'typesafe'];
const HOSTS = { 'api.openai.com': 'openai', 'api.groq.com': 'groq', 'api.deepseek.com': 'deepseek', 'openrouter.ai': 'openrouter', 'api.typesafe.ai': 'typesafe' };
const DAY = 86400000;
const MAX_BYTES = 8 * 1024 * 1024;
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,199}$/.test(id) && !id.startsWith('ft:');
const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date));
const active = (row, now) => !row.deprecatedOn || row.deprecatedOn > new Date(now).toISOString().slice(0, 10);

export function parseModelCatalog(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Catálogo de modelos inválido.');
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
  const providers = Object.fromEntries(PROVIDERS.map(provider => [provider, [...maps[provider].values()].sort((a, b) => a.id.localeCompare(b.id, 'en'))]));
  if (!Object.values(providers).some(rows => rows.length)) throw new Error('Catálogo sem modelos compatíveis.');
  return { version: 1, fetchedAt: now, providers };
}

function validSnapshot(value) {
  return value?.version === 1 && Number.isFinite(value.fetchedAt) && value.fetchedAt >= 0 &&
    PROVIDERS.every(provider => Array.isArray(value.providers?.[provider]) && value.providers[provider].length <= 2500 &&
      value.providers[provider].every(row => validId(row?.id) && ['chat', 'evaluation'].includes(row.mode) && (!row.deprecatedOn || validDate(row.deprecatedOn)))) &&
    PROVIDERS.some(provider => value.providers[provider].length > 0);
}

export function modelsForConnection(catalog, baseUrl, protocol = 'chat', now = Date.now()) {
  let provider;
  try { provider = HOSTS[new URL(baseUrl).hostname]; } catch { return []; }
  const mode = protocol === 'chat' ? 'chat' : 'evaluation';
  return (catalog?.providers?.[provider] || []).filter(row => row.mode === mode && active(row, now)).map(row => row.id);
}

async function readJson(response) {
  if (!response.ok) throw new Error(`Catálogo indisponível (HTTP ${response.status}).`);
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Catálogo excede o limite de tamanho.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Resposta do catálogo vazia.');
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Catálogo excede o limite de tamanho.'); }
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
    if (!validSnapshot(bundled)) throw new Error('Catálogo local inválido.');
    this.catalog = bundled;
    return this.catalog;
  }

  refresh() {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const response = await this.fetchImpl(MODEL_CATALOG_URL, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) });
      const catalog = parseModelCatalog(await readJson(response), this.now());
      this.catalog = catalog;
      this.needsRefresh = false;
      try { await this.storage?.set({ modelCatalog: catalog }); } catch { /* Fresh list still works for this panel. */ }
      return catalog;
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
}
