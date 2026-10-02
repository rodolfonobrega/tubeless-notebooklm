import { normalizeSettings, parseLanguages, parseNotebookUrl } from './core/search.js';
import { LLM_PRESETS, EVALUATION_PRESETS, requiredApiOrigins, sanitizeError } from './core/connections.js';
import { testConnections } from './core/diagnostics.js';
import { ModelCatalog, modelsForConnection } from './core/models.js';

const fields = ['llmBaseUrl', 'llmApiKey', 'expansionModel', 'evaluationBaseUrl', 'evaluationApiKey', 'evaluationProtocol', 'jevModel', 'youtubeMode', 'youtubeKey', 'languages', 'termsPerLanguage', 'resultsPerTerm', 'maxEvaluations', 'evaluationConcurrency', 'threshold', 'captionedOnly', 'notebookUrl'];
const $ = id => document.getElementById(id);

export function requestApiPermissions(settings) {
  // Call directly from a user click, before other asynchronous work.
  return chrome.permissions.request({ origins: requiredApiOrigins(settings) }).then(granted => {
    if (!granted) throw new Error('Permita o acesso aos provedores escolhidos para continuar.');
  });
}

export class SettingsPanel {
  constructor() { this.controller = null; this.results = new Map(); this.models = new ModelCatalog(); }

  fill(settings) {
    for (const field of fields) {
      const input = $(field);
      if (input.type === 'checkbox') input.checked = Boolean(settings[field]);
      else input.value = settings[field];
    }
    this.syncPresets();
    this.syncYouTube();
    $('thresholdValue').textContent = `${Math.round(settings.threshold * 100)}%`;
  }

  read() {
    const raw = Object.fromEntries(fields.map(field => [field, $(field).type === 'checkbox' ? $(field).checked : $(field).value]));
    if (raw.notebookUrl && !parseNotebookUrl(raw.notebookUrl)) throw new Error('Cole o link de um notebook, terminado em /notebook/ID.');
    if (!parseLanguages(raw.languages).length) throw new Error('Informe pelo menos um idioma válido, como pt,en.');
    if (!raw.llmBaseUrl.trim() || !raw.evaluationBaseUrl.trim()) throw new Error('Informe a URL base de cada conexão.');
    if (!raw.expansionModel.trim() || /(^|\/)jev(?:-|$)/i.test(raw.expansionModel.trim())) throw new Error('Informe um modelo de chat para gerar buscas.');
    if (!raw.jevModel.trim()) throw new Error('Informe o modelo de avaliação.');
    return normalizeSettings(raw);
  }

  syncPresets() {
    $('llmPreset').value = Object.entries(LLM_PRESETS).find(([, preset]) => preset.baseUrl === $('llmBaseUrl').value.replace(/\/+$/, ''))?.[0] || 'custom';
    $('evaluationPreset').value = Object.entries(EVALUATION_PRESETS).find(([, preset]) => preset.baseUrl === $('evaluationBaseUrl').value.replace(/\/+$/, '') && preset.protocol === $('evaluationProtocol').value)?.[0] || 'custom';
    this.syncModels();
  }

  syncModels() {
    for (const kind of ['llm', 'evaluation']) {
      const input = $(kind === 'llm' ? 'expansionModel' : 'jevModel');
      const choice = $(`${kind}ModelChoice`);
      const models = modelsForConnection(this.models.catalog, $(`${kind}BaseUrl`).value, kind === 'llm' ? 'chat' : $('evaluationProtocol').value);
      const custom = document.createElement('option');
      custom.value = '';
      custom.textContent = 'Nome personalizado';
      choice.replaceChildren(custom);
      for (const model of models) {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        choice.append(option);
      }
      choice.value = models.includes(input.value) ? input.value : '';
    }
  }

  async loadModels() {
    try { await this.models.load(); this.syncModels(); }
    catch { $('catalogStatus').textContent = 'Você pode digitar o nome do modelo.'; }
    if (this.models.needsRefresh) await this.refreshModels();
  }

  async refreshModels() {
    $('refreshModels').disabled = true;
    $('catalogStatus').textContent = 'Atualizando lista…';
    try {
      await this.models.refresh();
      this.syncModels();
      $('catalogStatus').textContent = 'Lista atualizada.';
    } catch {
      $('catalogStatus').textContent = this.models.catalog ? 'Usando lista salva. Tente atualizar depois.' : 'Não foi possível carregar a lista. Digite o nome do modelo.';
    } finally { $('refreshModels').disabled = false; }
  }

  syncYouTube() {
    const official = $('youtubeMode').value === 'api';
    $('youtubeKeyField').classList.toggle('hidden', !official);
    $('youtubeKey').required = official;
  }

  applyPreset(kind, name) {
    const preset = (kind === 'llm' ? LLM_PRESETS : EVALUATION_PRESETS)[name];
    if (!preset) return;
    const base = $(`${kind}BaseUrl`);
    try { if (new URL(base.value).origin !== new URL(preset.baseUrl).origin) $(`${kind}ApiKey`).value = ''; }
    catch { $(`${kind}ApiKey`).value = ''; }
    base.value = preset.baseUrl;
    $(kind === 'llm' ? 'expansionModel' : 'jevModel').value = preset.model;
    if (kind === 'evaluation') $('evaluationProtocol').value = preset.protocol;
    this.syncPresets();
    this.clearResults();
  }

  clearResults() {
    if (this.controller) return;
    this.results.clear();
    $('connectionResults').replaceChildren();
    $('connectionResults').classList.add('hidden');
  }

  renderResult(result) {
    this.results.set(result.id, result);
    const container = $('connectionResults');
    container.classList.remove('hidden');
    container.replaceChildren();
    for (const entry of this.results.values()) {
      const row = document.createElement('div');
      row.className = `connection-result ${entry.status}`;
      const heading = document.createElement('strong');
      const label = { testing: 'Testando…', ok: 'OK', error: 'Falhou', cancelled: 'Cancelado' }[entry.status];
      heading.textContent = `${entry.title} · ${label}`;
      const message = document.createElement('p');
      message.textContent = entry.message;
      row.append(heading, message);
      container.append(row);
    }
  }

  async test() {
    if (this.controller) { this.controller.abort(); return; }
    let settings;
    try {
      settings = this.read();
      // Start this while the button's user gesture is still active.
      const permission = requestApiPermissions(settings);
      this.controller = new AbortController();
      const signal = this.controller.signal;
      this.results.clear();
      $('settingsError').classList.add('hidden');
      $('testConnections').textContent = 'Cancelar teste';
      $('settingsForm').querySelectorAll('input, select, button').forEach(input => { if (input.id !== 'testConnections') input.disabled = true; });
      await permission;
      signal.throwIfAborted();
      await testConnections(settings, { signal, onResult: result => this.renderResult(result) });
      $('connectionResults').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      if (this.controller?.signal.aborted) {
        for (const result of this.results.values()) if (result.status === 'testing') this.renderResult({ ...result, status: 'cancelled', message: 'Teste cancelado.' });
      } else {
        $('settingsError').textContent = sanitizeError(error.message, [settings?.llmApiKey, settings?.evaluationApiKey, settings?.youtubeKey]);
        $('settingsError').classList.remove('hidden');
      }
    } finally {
      this.controller = null;
      $('settingsForm').querySelectorAll('input, select, button').forEach(input => { input.disabled = false; });
      $('testConnections').textContent = 'Testar conexões';
    }
  }

  install() {
    this.loadModels();
    $('refreshModels').addEventListener('click', () => this.refreshModels());
    for (const kind of ['llm', 'evaluation']) {
      const input = $(kind === 'llm' ? 'expansionModel' : 'jevModel');
      const choice = $(`${kind}ModelChoice`);
      choice.addEventListener('change', () => {
        if (choice.value) input.value = choice.value;
        else input.focus();
        this.clearResults();
      });
      input.addEventListener('input', () => {
        choice.value = [...choice.options].some(option => option.value === input.value) ? input.value : '';
      });
    }
    $('llmPreset').addEventListener('change', () => this.applyPreset('llm', $('llmPreset').value));
    $('evaluationPreset').addEventListener('change', () => this.applyPreset('evaluation', $('evaluationPreset').value));
    $('resetLlmBase').addEventListener('click', () => {
      this.applyPreset('llm', 'openai');
    });
    $('resetEvaluationBase').addEventListener('click', () => {
      const name = $('evaluationPreset').value !== 'custom' ? $('evaluationPreset').value : Object.entries(EVALUATION_PRESETS).find(([, preset]) => preset.protocol === $('evaluationProtocol').value)?.[0];
      this.applyPreset('evaluation', name);
    });
    ['llmBaseUrl', 'evaluationBaseUrl', 'evaluationProtocol'].forEach(id => $(id).addEventListener('input', () => this.syncPresets()));
    $('youtubeMode').addEventListener('change', () => this.syncYouTube());
    $('settingsForm').addEventListener('input', () => this.clearResults());
    $('testConnections').addEventListener('click', () => this.test());
    $('threshold').addEventListener('input', () => { $('thresholdValue').textContent = `${Math.round(Number($('threshold').value) * 100)}%`; });
    document.querySelectorAll('[data-reveal]').forEach(button => button.addEventListener('click', () => {
      const input = $(button.dataset.reveal);
      input.type = input.type === 'password' ? 'text' : 'password';
      button.setAttribute('aria-label', input.type === 'password' ? 'Mostrar chave' : 'Ocultar chave');
    }));
  }
}
