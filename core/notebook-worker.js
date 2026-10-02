import { validNotebookSender, LOCATOR_ACTIONS, sanitizeCandidates, sanitizeLocatorDescriptor } from './element-locator.js';
import { selectNotebookElement } from './providers.js';
import { normalizeSettings } from './search.js';
import { sanitizeError } from './connections.js';

const CACHE_KEY = 'notebookLocatorCache';

export function createNotebookLocatorHandler(api, select = selectNotebookElement, { timeoutMs = 25000 } = {}) {
  const inFlight = new Set();
  let writes = Promise.resolve();
  return async function handle(message, sender) {
    if (!validNotebookSender(sender, api.runtime.id)) return { ok: false, message: 'Origem do notebook inválida.' };
    let settings;
    try {
      if (message.type === 'TUBELESS_LOCATE_ELEMENT') {
        const candidates = sanitizeCandidates(message.action, message.candidates);
        const token = `${sender.tab.id}:${message.action}`;
        if (inFlight.has(token)) throw new Error('Identificação do controle já está em andamento.');
        settings = normalizeSettings((await api.storage.local.get('settings')).settings);
        const base = new URL(settings.evaluationBaseUrl);
        if (!settings.evaluationApiKey && !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Configure a chave de avaliação para identificar os controles do notebook.');
        if (!await api.permissions.contains({ origins: [`${base.protocol}//${base.hostname}/*`] })) throw new Error('Salve a configuração de avaliação para permitir chamadas ao provedor.');
        inFlight.add(token);
        // Respond before Chrome's 30-second fetch deadline can terminate this worker.
        try { return { ok: true, id: await select(message.action, candidates, settings, fetch, AbortSignal.timeout(timeoutMs)) }; }
        finally { inFlight.delete(token); }
      }
      if (message.type !== 'TUBELESS_LOCATOR_CACHE' || !/^[a-zA-Z0-9_-]{1,32}$/.test(message.locale || '')) throw new Error('Solicitação de controles inválida.');
      const scope = `${new URL(sender.url).hostname}:${message.locale}`;
      if (message.op === 'get') {
        const saved = (await api.storage.local.get(CACHE_KEY))[CACHE_KEY];
        return { ok: true, cache: saved?.version === 1 ? saved.scopes?.[scope]?.entries || {} : {} };
      }
      if (message.op !== 'put') throw new Error('Operação de cache inválida.');
      const entries = {};
      for (const [action, descriptor] of Object.entries(message.entries || {})) {
        if (!LOCATOR_ACTIONS[action]) throw new Error('Ação de cache inválida.');
        const cleaned = sanitizeLocatorDescriptor(descriptor);
        if ((action === 'url') !== (cleaned.kind === 'field')) throw new Error('Controle de cache incompatível.');
        entries[action] = cleaned;
      }
      writes = writes.catch(() => {}).then(async () => {
        const saved = (await api.storage.local.get(CACHE_KEY))[CACHE_KEY];
        const scopes = saved?.version === 1 ? { ...saved.scopes } : {};
        scopes[scope] = { updatedAt: Date.now(), entries: { ...scopes[scope]?.entries, ...entries } };
        const recent = Object.fromEntries(Object.entries(scopes).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 12));
        await api.storage.local.set({ [CACHE_KEY]: { version: 1, scopes: recent } });
      });
      await writes;
      return { ok: true };
    } catch (error) {
      return { ok: false, message: sanitizeError(error.message, [settings?.llmApiKey, settings?.evaluationApiKey, settings?.youtubeKey].filter(Boolean)) };
    }
  };
}
