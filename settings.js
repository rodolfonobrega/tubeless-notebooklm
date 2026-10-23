import { normalizeSettings, parseLanguages, parseNotebookUrl } from './core/search.js';
import { LLM_PRESETS, EVALUATION_PRESETS, requiredApiOrigins, sanitizeError, maskSecretKey } from './core/connections.js';
import { testConnections } from './core/diagnostics.js';
import { ModelCatalog, modelsForConnection, inferEvaluationProtocol, modelStatus } from './core/models.js';

const fields = ['llmBaseUrl', 'llmApiKey', 'expansionModel', 'evaluationBaseUrl', 'evaluationApiKey', 'evaluationProtocol', 'jevModel', 'youtubeMode', 'youtubeKey', 'languages', 'termsPerLanguage', 'resultsPerTerm', 'maxEvaluations', 'evaluationConcurrency', 'threshold', 'captionedOnly'];
const $ = id => document.getElementById(id);

export function requestApiPermissions(settings) {
  // Call directly from a user click, before other asynchronous work.
  return chrome.permissions.request({ origins: requiredApiOrigins(settings) }).then(granted => {
    if (!granted) throw new Error('Allow access to the chosen providers to continue.');
  });
}

// A check is skipped when the settings it depends on are the same as in its last successful test.
// Keys go into the fingerprint only as a SHA-256 digest, never as plain text.
const VERIFIED_KEY = 'verifiedConnections';

async function fingerprint(...parts) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function connectionFingerprints(settings) {
  return {
    llm: await fingerprint('llm', settings.llmBaseUrl, settings.expansionModel, settings.llmApiKey),
    evaluation: await fingerprint('evaluation', settings.evaluationBaseUrl, settings.jevModel, settings.evaluationProtocol, settings.evaluationApiKey),
    youtube: await fingerprint('youtube', settings.youtubeMode, settings.youtubeKey, settings.captionedOnly)
  };
}

async function loadVerifiedChecks(settings) {
  const stored = (await chrome.storage.local.get(VERIFIED_KEY).catch(() => ({})))[VERIFIED_KEY] || {};
  const current = await connectionFingerprints(settings);
  return Object.fromEntries(Object.entries(current).filter(([id, value]) => stored[id]?.fingerprint === value).map(([id]) => [id, stored[id]]));
}

// Only successful checks are remembered. A failed check is tested again next time.
async function saveVerifiedChecks(settings, results) {
  const verified = {};
  for (const result of results) {
    if (result.status !== 'ok') continue;
    const tested = { ...settings };
    if (result.id === 'evaluation' && result.protocol) tested.evaluationProtocol = result.protocol;
    verified[result.id] = { fingerprint: (await connectionFingerprints(tested))[result.id], protocol: result.protocol ?? null };
  }
  await chrome.storage.local.set({ [VERIFIED_KEY]: verified }).catch(() => {});
}

export class SettingsPanel {
  constructor() { this.controller = null; this.results = new Map(); this.models = new ModelCatalog(); }

  fill(settings) {
    for (const field of fields) {
      const input = $(field);
      if (!input) continue;
      if (input.type === 'checkbox') input.checked = Boolean(settings[field]);
      else input.value = settings[field];
    }
    this.syncPresets();
    this.syncYouTube();
    $('thresholdValue').textContent = `${Math.round(settings.threshold * 100)}%`;
    this.updateKeyPreviews();
  }

  updateKeyPreviews() {
    document.querySelectorAll('[data-reveal]').forEach(button => {
      const fieldId = button.dataset.reveal;
      const input = $(fieldId);
      const preview = $(`${fieldId}Preview`);
      if (input && preview && !preview.classList.contains('hidden')) {
        preview.textContent = maskSecretKey(input.value);
      }
    });
  }

  read() {
    const raw = Object.fromEntries(fields.filter(field => $(field)).map(field => [field, $(field).type === 'checkbox' ? $(field).checked : $(field).value]));
    if (raw.notebookUrl && !parseNotebookUrl(raw.notebookUrl)) throw new Error('Paste a notebook link ending in /notebook/ID.');
    if (!parseLanguages(raw.languages).length) throw new Error('Enter at least one valid language, such as pt,en.');
    if (!raw.llmBaseUrl.trim() || !raw.evaluationBaseUrl.trim()) throw new Error('Enter the base URL of each connection.');
    if (!raw.expansionModel.trim() || /(^|\/)jev(?:-|$)/i.test(raw.expansionModel.trim())) throw new Error('Enter a chat model to generate searches.');
    if (!raw.jevModel.trim()) throw new Error('Enter the evaluation model.');
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
      custom.textContent = 'Custom name';
      choice.replaceChildren(custom);
      for (const model of models) {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        choice.append(option);
      }
      choice.value = models.includes(input.value) ? input.value : '';
      this.syncModelNotice(kind);
    }
  }

  // Tells the user when a model is no longer listed by a provider whose list is live, and suggests one that is.
  syncModelNotice(kind) {
    const input = $(kind === 'llm' ? 'expansionModel' : 'jevModel');
    const notice = $(`${kind}ModelNotice`);
    const status = modelStatus(this.models.catalog, $(`${kind}BaseUrl`).value, input.value.trim(), kind === 'llm' ? 'chat' : $('evaluationProtocol').value);
    notice.classList.toggle('hidden', !status);
    notice.textContent = status ? `"${input.value.trim()}" is no longer available from this provider. Consider switching to "${status.replacement}".` : '';
  }

  async loadModels() {
    try { await this.models.load(); this.syncModels(); }
    catch { $('catalogStatus').textContent = 'You can type the model name.'; }
    if (this.models.needsRefresh) await this.refreshModels();
  }

  async refreshModels() {
    $('refreshModels').disabled = true;
    $('catalogStatus').textContent = 'Refreshing list…';
    try {
      await this.models.refresh();
      this.syncModels();
      $('catalogStatus').textContent = 'List updated.';
    } catch {
      $('catalogStatus').textContent = this.models.catalog ? 'Using saved list. Try refreshing later.' : 'Could not load the list. Type the model name.';
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

  // A model from the catalog fixes its call format, so the user does not have to pick it.
  syncProtocolFromCatalog() {
    const protocol = inferEvaluationProtocol(this.models.catalog, $('evaluationBaseUrl').value, $('jevModel').value);
    if (!protocol || $('evaluationProtocol').value === protocol) return;
    $('evaluationProtocol').value = protocol;
    this.syncPresets();
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
      const label = { testing: 'Testing…', ok: 'OK', error: 'Failed', cancelled: 'Cancelled' }[entry.status];
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
      $('testConnections').textContent = 'Cancel test';
      $('settingsForm').querySelectorAll('input, select, button').forEach(input => { if (input.id !== 'testConnections') input.disabled = true; });
      await permission;
      signal.throwIfAborted();
      const skip = await loadVerifiedChecks(settings);
      const results = await testConnections(settings, { signal, skip, onResult: result => this.renderResult(result) });
      await saveVerifiedChecks(settings, results);
      // The test may find that another call format works for a custom model. Apply it; the user still saves.
      const protocol = results.find(result => result.id === 'evaluation')?.protocol;
      if (protocol && protocol !== settings.evaluationProtocol) {
        $('evaluationProtocol').value = protocol;
        this.syncPresets();
      }
      $('connectionResults').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      if (this.controller?.signal.aborted) {
        for (const result of this.results.values()) if (result.status === 'testing') this.renderResult({ ...result, status: 'cancelled', message: 'Test cancelled.' });
      } else {
        $('settingsError').textContent = sanitizeError(error.message, [settings?.llmApiKey, settings?.evaluationApiKey, settings?.youtubeKey]);
        $('settingsError').classList.remove('hidden');
      }
    } finally {
      this.controller = null;
      $('settingsForm').querySelectorAll('input, select, button').forEach(input => { input.disabled = false; });
      $('testConnections').textContent = 'Test connections';
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
        if (kind === 'evaluation') this.syncProtocolFromCatalog();
        this.clearResults();
      });
      input.addEventListener('input', () => {
        choice.value = [...choice.options].some(option => option.value === input.value) ? input.value : '';
        if (kind === 'evaluation') this.syncProtocolFromCatalog();
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
    document.querySelectorAll('[data-reveal]').forEach(button => {
      const fieldId = button.dataset.reveal;
      const input = $(fieldId);
      const preview = $(`${fieldId}Preview`);
      if (!input || !preview) return;

      const updatePreview = () => {
        if (!preview.classList.contains('hidden')) {
          preview.textContent = maskSecretKey(input.value);
        }
      };

      input.addEventListener('input', updatePreview);

      button.addEventListener('click', () => {
        const isHidden = preview.classList.contains('hidden');
        if (isHidden) {
          preview.textContent = maskSecretKey(input.value);
          preview.classList.remove('hidden');
          button.classList.add('active');
          button.setAttribute('aria-label', 'Hide key check');
        } else {
          preview.classList.add('hidden');
          button.classList.remove('active');
          button.setAttribute('aria-label', 'Check the start and end of the key');
        }
      });
    });
  }
}
