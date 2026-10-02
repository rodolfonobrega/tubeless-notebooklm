import { DEFAULT_SETTINGS, normalizeSettings, parseLanguages, parseNotebookUrl, videoUrl, sortVideosByRelevance } from './core/search.js';
import { runDiscovery } from './core/pipeline.js';
import { buildImportQueue, findNotebookTab, recordBatchImportOutcome, shouldPauseImport, markImportConfirmed } from './core/imports.js';
import { SettingsPanel, requestApiPermissions } from './settings.js';
import { sanitizeError } from './core/connections.js';
import { mergeDiscoveryResults, selectionForResult, selectionAfterContinuation, selectedVideoLinks } from './core/continuation.js';

const $ = id => document.getElementById(id);
const state = { settings: { ...DEFAULT_SETTINGS }, result: null, selected: new Set(), filter: 'approved', controller: null, importing: false, reviewing: false, importQueue: null };
const settingsPanel = new SettingsPanel();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let selectionWrite = Promise.resolve();
let settingsWrite = Promise.resolve();
const languageChoices = new Set(['pt', 'en', 'es', 'fr', 'de', 'it', 'ja', 'zh']);
const languageNames = new Intl.DisplayNames(['pt-BR'], { type: 'language' });

function persistSettings() {
  const settings = { ...state.settings };
  settingsWrite = settingsWrite.catch(() => {}).then(() => chrome.storage.local.set({ settings }));
  return settingsWrite;
}

function renderLanguageChoices() {
  const selected = parseLanguages(state.settings.languages);
  selected.forEach(code => languageChoices.add(code));
  const options = [...languageChoices].map(code => {
    const label = element('label', 'language-option');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'searchLanguage';
    checkbox.value = code;
    checkbox.checked = selected.includes(code);
    const name = languageNames.of(code);
    label.append(checkbox, element('span', '', name.charAt(0).toUpperCase() + name.slice(1)));
    return label;
  });
  $('languageOptions').replaceChildren(...options);
  updateLanguageControls();
}

function updateLanguageControls() {
  const count = parseLanguages(state.settings.languages).length;
  $('languagePicker').disabled = Boolean(state.controller);
  $('languageOptions').querySelectorAll('input').forEach(checkbox => {
    checkbox.disabled = checkbox.checked ? count === 1 : count >= 5;
  });
}

function persistSelection() {
  const ids = [...state.selected];
  selectionWrite = selectionWrite.catch(() => {}).then(() => chrome.storage.local.set({ selectedVideoIds: ids }));
  return selectionWrite;
}

function setView(name) {
  $('researchView').classList.toggle('hidden', name !== 'research');
  $('settingsView').classList.toggle('hidden', name !== 'settings');
  $('importDock').classList.toggle('hidden', name !== 'research' || state.selected.size === 0);
  $('settingsToggle').setAttribute('aria-label', name === 'settings' ? 'Voltar à pesquisa' : 'Abrir configurações');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function showMessage(message, success = false) {
  const box = $('messageBox');
  box.textContent = message ? sanitizeError(message, [state.settings.llmApiKey, state.settings.evaluationApiKey, state.settings.youtubeKey]) : '';
  box.classList.toggle('hidden', !message);
  box.classList.toggle('success', success);
}

function showSettingsError(message) {
  $('settingsError').textContent = message || '';
  $('settingsError').classList.toggle('hidden', !message);
}

function showProgress({ phase, completed, total }) {
  const titles = { expanding: 'Preparando a pesquisa', searching: 'Pesquisando vídeos', details: 'Lendo detalhes dos vídeos', evaluating: 'Avaliando vídeos', done: 'Pesquisa concluída' };
  $('statusBox').classList.remove('hidden');
  $('statusTitle').textContent = titles[phase] || 'Trabalhando';
  $('statusDetail').textContent = phase === 'expanding' ? 'Variando termos por idioma…' : `${completed} de ${total}`;
  $('progressBar').style.width = `${total ? Math.round(completed / total * 100) : 10}%`;
}

function fillSettings() {
  settingsPanel.fill(state.settings);
  renderLanguageChoices();
}

function readSettings() {
  return settingsPanel.read();
}

function updateSetup() {
  $('setupNotice').classList.toggle('hidden', connectionsReady());
}

function connectionsReady() {
  const hasKey = (base, key) => Boolean(key) || ['localhost', '127.0.0.1'].includes(new URL(base).hostname);
  return hasKey(state.settings.llmBaseUrl, state.settings.llmApiKey) && hasKey(state.settings.evaluationBaseUrl, state.settings.evaluationApiKey) && (state.settings.youtubeMode !== 'api' || Boolean(state.settings.youtubeKey));
}

function element(tag, className, textValue) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textValue != null) node.textContent = String(textValue);
  return node;
}

function renderTerms(terms) {
  const container = $('termList');
  container.replaceChildren();
  for (const term of terms) {
    const chip = element('span', 'term-chip');
    chip.append(element('b', '', term.language.toUpperCase()), document.createTextNode(term.query));
    container.append(chip);
  }
}

function renderVideo(video) {
  const card = element('article', `video-card${state.selected.has(video.id) ? ' selected' : ''}`);
  const top = element('div', 'video-top');
  const image = element('img', 'thumbnail');
  image.src = `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`;
  image.alt = '';
  image.loading = 'lazy';
  const info = element('div', 'video-info');
  const title = element('h3', '', video.title);
  const date = video.publishedAt ? new Date(video.publishedAt).toLocaleDateString('pt-BR') : '';
  info.append(title, element('div', 'video-meta', [video.channel, date].filter(Boolean).join(' • ')));
  top.append(image, info);
  const bottom = element('div', 'video-bottom');
  const checkbox = element('input', 'select-video');
  checkbox.type = 'checkbox';
  checkbox.checked = state.selected.has(video.id);
  checkbox.disabled = video.status !== 'approved' || Boolean(state.importQueue) || state.importing || Boolean(state.controller);
  checkbox.setAttribute('aria-label', `Selecionar ${video.title}`);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) state.selected.add(video.id); else state.selected.delete(video.id);
    card.classList.toggle('selected', checkbox.checked);
    updateDock();
    persistSelection().catch(error => showMessage(error.message));
  });
  const status = video.status === 'error' ? 'Sem avaliação' : `${Math.round(video.probability * 100)}% relevante`;
  const pill = element('span', `score-pill ${video.status}`, status);
  const evidence = element('span', 'evidence', video.evaluationError || (video.transcript ? 'Com transcrição' : 'Informações do vídeo'));
  evidence.title = evidence.textContent;
  const link = element('a', '', 'Assistir ↗');
  link.href = videoUrl(video.id);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  bottom.append(checkbox, pill, evidence, link);
  card.append(top, bottom);
  return card;
}

function renderResults() {
  const result = state.result;
  $('resultsSection').classList.toggle('hidden', !result);
  if (!result) { updateDock(); return; }
  $('resultTitle').textContent = result.topic;
  const approved = result.videos.filter(v => v.status === 'approved').length;
  $('resultSummary').textContent = `${approved} relevantes · ${result.videos.length} avaliados · ${result.discoveredCount} encontrados`;
  renderTerms(result.terms);
  const list = $('videoList');
  list.replaceChildren();
  const videos = sortVideosByRelevance(state.filter === 'approved' ? result.videos.filter(v => v.status === 'approved') : result.videos);
  if (!videos.length) list.append(element('div', 'empty-results', state.filter === 'approved' ? 'Nenhum vídeo atingiu a relevância mínima. Veja todos os resultados ou ajuste a pesquisa.' : 'Nenhum vídeo para mostrar.'));
  else videos.forEach(video => list.append(renderVideo(video)));
  const warningBox = $('warnings');
  warningBox.replaceChildren(...result.warnings.map(warning => element('div', '', warning)));
  warningBox.classList.toggle('hidden', !result.warnings.length);
  document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === state.filter));
  updateDock();
}

async function refreshNotebookTabs() {
  const tabs = await chrome.tabs.query({});
  const notebookTabs = tabs.filter(tab => parseNotebookUrl(tab.url));
  const select = $('notebookTabs');
  const previous = select.value;
  select.replaceChildren();
  for (const tab of notebookTabs) {
    const option = element('option', '', tab.title?.slice(0, 55) || parseNotebookUrl(tab.url));
    option.value = String(tab.id);
    option.dataset.notebookUrl = parseNotebookUrl(tab.url);
    select.append(option);
  }
  if (!select.options.length) {
    const option = element('option', '', 'Nenhum notebook aberto');
    option.value = '';
    select.append(option);
  }
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
  if (state.importQueue) {
    const target = findNotebookTab(notebookTabs, state.importQueue);
    if (target) select.value = String(target.id);
    else select.value = '';
  }
  const targetAvailable = state.importQueue ? Boolean(findNotebookTab(notebookTabs, state.importQueue)) : notebookTabs.length > 0;
  $('notebookNotice').classList.toggle('hidden', targetAvailable);
  $('notebookNotice').textContent = state.importQueue ? 'Abra o notebook de destino no Chrome para retomar a importação.' : 'Abra um notebook no Chrome antes de adicionar fontes.';
  select.disabled = Boolean(state.importQueue);
}

function updatePendingNotice() {
  const queue = state.importQueue;
  const uncertain = queue?.failures?.find(item => item.status === 'uncertain');
  const reviewTitle = state.result?.videos.find(video => video.id === uncertain?.id)?.title || uncertain?.id;
  $('pendingNotice').classList.toggle('hidden', !queue);
  if (queue) $('pendingDetail').textContent = state.result?.topic === queue.topic
    ? uncertain
      ? `${queue.completed.length}/${queue.ids.length} confirmadas · destino: ${queue.notebookUrl.split('/').at(-1)}. Fonte a revisar: “${reviewTitle}”. Confira se já entrou e marque-a como presente ou libere nova tentativa. ${queue.failures.filter(item => item.status === 'uncertain').length} item(ns) aguardando revisão.`
      : `${queue.completed.length}/${queue.ids.length} confirmadas · destino: ${queue.notebookUrl.split('/').at(-1)}. Termine ou descarte antes de outra busca.`
    : 'Os resultados originais não estão disponíveis. Descarte esta fila para iniciar outra busca.';
  $('pendingResume').disabled = !queue || Boolean(uncertain) || state.result?.topic !== queue.topic || state.importing || state.reviewing;
  $('pendingConfirm').classList.toggle('hidden', !uncertain);
  $('pendingRetry').classList.toggle('hidden', !uncertain);
  $('pendingConfirm').disabled = state.importing || state.reviewing;
  $('pendingRetry').disabled = state.importing || state.reviewing;
  $('pendingDiscard').disabled = !queue || state.importing || state.reviewing;
}

function queueResultsAvailable() {
  return !state.importQueue || (state.result?.topic === state.importQueue.topic && state.importQueue.ids.every(id => state.result.videos.some(video => video.id === id && video.status === 'approved')));
}

function updateDock() {
  const visible = !$('researchView').classList.contains('hidden') && state.selected.size > 0;
  $('importDock').classList.toggle('hidden', !visible);
  document.body.classList.toggle('has-selection', visible);
  $('selectedCount').textContent = String(state.selected.size);
  const locked = state.importing || state.reviewing || Boolean(state.controller) || Boolean(state.importQueue);
  $('importButton').disabled = state.importing || state.reviewing || Boolean(state.controller) || state.selected.size === 0 || !queueResultsAvailable() || Boolean(state.importQueue?.failures.some(item => item.status === 'uncertain'));
  $('continueSearch').disabled = locked || !state.result;
  $('selectAll').disabled = locked;
  $('deselectAll').disabled = locked || state.selected.size === 0;
  $('clearResults').disabled = locked;
  $('dockClose').disabled = locked;
  $('copyLinks').disabled = !state.result || state.selected.size === 0;
  updateLanguageControls();
  updatePendingNotice();
  if (visible) refreshNotebookTabs().catch(() => {});
}

async function waitForTab(tabId, expectedUrl) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const tab = await chrome.tabs.get(tabId);
    if (parseNotebookUrl(tab.url) !== parseNotebookUrl(expectedUrl)) throw new Error('O notebook da aba mudou. Selecione novamente o destino antes de adicionar fontes.');
    if (tab.status === 'complete') {
      await wait(500);
      const ready = await chrome.tabs.get(tabId);
      if (parseNotebookUrl(ready.url) !== parseNotebookUrl(expectedUrl)) throw new Error('O notebook da aba mudou. Selecione novamente o destino antes de adicionar fontes.');
      if (ready.status === 'complete') return ready;
    }
    await wait(250);
  }
  throw new Error('A aba do notebook não terminou de carregar. Abra o notebook e tente novamente.');
}

async function targetTab() {
  if (state.importQueue) {
    const tab = findNotebookTab(await chrome.tabs.query({}), state.importQueue);
    if (!tab) throw new Error('O notebook de destino não está aberto. Abra-o no Chrome e retome a importação.');
    return waitForTab(tab.id, state.importQueue.notebookUrl);
  }
  const value = $('notebookTabs').value;
  const expectedUrl = $('notebookTabs').selectedOptions[0]?.dataset.notebookUrl;
  if (value) {
    const tab = await chrome.tabs.get(Number(value));
    if (!expectedUrl || parseNotebookUrl(tab.url) !== expectedUrl) throw new Error('O notebook da aba mudou. Selecione novamente o destino antes de adicionar fontes.');
    return waitForTab(tab.id, expectedUrl);
  }
  throw new Error('Nenhum notebook do NotebookLM está aberto. Abra um notebook no Chrome antes de adicionar fontes.');
}

async function sendToNotebook(tabId, videos, notebookUrl) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await chrome.tabs.sendMessage(tabId, { type: 'TUBELESS_IMPORT_BATCH', notebookUrl, videos: videos.map(video => ({ url: videoUrl(video.id), title: video.title })) }); }
    catch (error) {
      if (!/Receiving end does not exist|Could not establish connection/i.test(error.message)) throw error;
      await wait(750);
    }
  }
  throw new Error('Não foi possível acessar a aba. Recarregue o NotebookLM e tente novamente.');
}

async function importSelected() {
  if (state.importing || state.reviewing || !state.result || !state.selected.size) return;
  if (!queueResultsAvailable()) { showMessage('Os resultados da fila pendente não estão disponíveis. Descarte a fila antes de adicionar outras fontes.'); return; }
  if (state.importQueue?.failures.some(item => item.status === 'uncertain')) { showMessage('Revise as fontes sem confirmação antes de retomar a importação.'); return; }
  state.importing = true;
  renderResults();
  $('importButton').disabled = true;
  $('importProgress').classList.remove('hidden');
  showMessage('');
  try {
    const tab = await targetTab();
    const videos = state.result.videos.filter(video => video.status === 'approved' && state.selected.has(video.id));
    if (!videos.length) throw new Error('Selecione pelo menos um vídeo relevante.');
    let queue = buildImportQueue(state.result.topic, videos, tab.url, state.importQueue);
    state.importQueue = queue;
    const additions = videos.filter(video => !queue.completed.includes(video.id));
    if (additions.length) {
      queue = recordBatchImportOutcome(queue, { status: 'uncertain', message: 'O envio deste lote ainda não foi confirmado. Confira esta fonte no notebook antes de repetir.' });
      state.importQueue = queue;
      await chrome.storage.local.set({ importQueue: queue });
      $('importProgress').textContent = `Adicionando ${additions.length} link(s) em um único envio. Aguardando confirmação das fontes…`;
      let response;
      try { response = await sendToNotebook(tab.id, additions, queue.notebookUrl); }
      catch (error) { response = { status: 'uncertain', message: `${error.message} Verifique o notebook antes de repetir o lote.` }; }
      queue = recordBatchImportOutcome(queue, response);
      state.importQueue = queue;
      await chrome.storage.local.set({ importQueue: queue });
    }
    const paused = queue.failures.some(shouldPauseImport);
    const count = queue.completed.length;
    const failed = queue.failures.length;
    $('importProgress').textContent = `${count} fonte(s) confirmada(s).${failed ? ` ${failed} exigem revisão.` : ''}`;
    const failureMessages = [...new Set(queue.failures.map(item => item.message).filter(Boolean))].slice(0, 3).join(' | ');
    const layoutFailure = queue.failures.some(item => item.reason === 'layout');
    showMessage(paused
      ? layoutFailure ? `Importação pausada porque não foi possível localizar um controle do notebook. ${failureMessages} Reabra o notebook e retome a fila.` : `${count} fonte(s) confirmada(s). ${failed} item(ns) do lote exigem revisão no notebook antes de repetir.`
      : failed ? `${failed} vídeo(s) não foram confirmados no notebook. ${failureMessages}` : `${count} fonte(s) confirmada(s) no NotebookLM.`, !failed);
    if (!failed) { state.selected.clear(); state.importQueue = null; await chrome.storage.local.remove('importQueue'); await persistSelection(); renderResults(); }
    else { updatePendingNotice(); renderResults(); }
  } catch (error) {
    $('importProgress').textContent = error.message;
    showMessage(error.message);
  } finally {
    state.importing = false;
    renderResults();
  }
}

async function startSearch(event, continuing = false) {
  event?.preventDefault();
  if (state.controller || state.importing || state.reviewing) return;
  if (state.importQueue) { showMessage('Finalize ou descarte a importação pendente antes de iniciar outra pesquisa.'); return; }
  const previous = continuing ? state.result : null;
  if (continuing && !previous) return;
  const topic = continuing ? previous.topic : $('topic').value.trim();
  if (!topic) { showMessage('Informe um tema antes de pesquisar.'); return; }
  if (!connectionsReady()) { showMessage('Configure as conexões de busca e avaliação para começar.'); setView('settings'); return; }
  showMessage('');
  state.controller = new AbortController();
  $('searchButton').disabled = true;
  $('topic').disabled = true;
  $('cancelButton').classList.remove('hidden');
  renderResults();
  try {
    await requestApiPermissions(state.settings);
    state.controller.signal.throwIfAborted();
    const settings = { ...state.settings, languageList: parseLanguages(state.settings.languages) };
    const batch = await runDiscovery({ topic, settings, previousResult: previous, signal: state.controller.signal, onProgress: showProgress });
    state.controller.signal.throwIfAborted();
    const result = mergeDiscoveryResults(previous, batch);
    const selected = previous ? selectionAfterContinuation(previous, result, state.selected) : selectionForResult(result);
    await selectionWrite.catch(() => {});
    await chrome.storage.local.set({ lastSearch: result, selectedVideoIds: [...selected] });
    state.result = result;
    state.selected = selected;
    state.filter = 'approved';
    $('topic').value = result.topic;
    if (continuing) showMessage(batch.videos.length ? `${batch.videos.length} vídeo(s) novo(s) avaliados. Os relevantes foram selecionados.` : 'Nenhum vídeo novo nesta rodada. Seus resultados e a seleção foram mantidos.', batch.videos.length > 0);
    renderResults();
  } catch (error) {
    if (error.name !== 'AbortError') showMessage(error.message || 'Falha na pesquisa.');
    else showMessage('Pesquisa cancelada.');
  } finally {
    state.controller = null;
    $('searchButton').disabled = false;
    $('topic').disabled = false;
    $('statusBox').classList.add('hidden');
    renderResults();
  }
}

function installEvents() {
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--import-dock-height', `${Math.ceil($('importDock').getBoundingClientRect().height)}px`);
  }).observe($('importDock'));
  $('settingsToggle').addEventListener('click', () => setView($('settingsView').classList.contains('hidden') ? 'settings' : 'research'));
  $('setupOpen').addEventListener('click', () => setView('settings'));
  $('settingsBack').addEventListener('click', () => setView('research'));
  $('searchForm').addEventListener('submit', startSearch);
  $('cancelButton').addEventListener('click', () => state.controller?.abort());
  $('languageOptions').addEventListener('change', event => {
    if (!event.target.matches('input[name="searchLanguage"]')) return;
    const languages = [...$('languageOptions').querySelectorAll('input:checked')].map(input => input.value);
    if (state.controller || !languages.length || languages.length > 5) { renderLanguageChoices(); return; }
    state.settings = { ...state.settings, languages: languages.join(',') };
    $('languages').value = state.settings.languages;
    updateLanguageControls();
    persistSettings().catch(error => showMessage(`Não foi possível salvar os idiomas: ${error.message}`));
  });
  settingsPanel.install();
  $('settingsForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const settings = readSettings();
      await requestApiPermissions(settings);
      state.settings = settings;
      state.settings.languages = parseLanguages(settings.languages).join(',');
      await persistSettings();
      $('languages').value = state.settings.languages;
      renderLanguageChoices();
      showSettingsError('');
      updateSetup();
      refreshNotebookTabs();
      setView('research');
      showMessage('Configurações salvas neste Chrome.', true);
    } catch (error) { showSettingsError(error.message); setView('settings'); }
  });
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; renderResults(); }));
  const selectionLocked = () => state.importQueue || state.importing || state.reviewing || state.controller;
  $('selectAll').addEventListener('click', () => { if (selectionLocked()) return; state.selected = selectionForResult(state.result); renderResults(); persistSelection().catch(error => showMessage(error.message)); });
  const deselect = () => { if (selectionLocked()) return; state.selected.clear(); renderResults(); persistSelection().catch(error => showMessage(error.message)); };
  $('deselectAll').addEventListener('click', deselect);
  $('dockClose').addEventListener('click', deselect);
  $('continueSearch').addEventListener('click', event => startSearch(event, true));
  $('copyLinks').addEventListener('click', async () => {
    const links = selectedVideoLinks(state.result, state.selected);
    if (!links) return;
    try { await navigator.clipboard.writeText(links); showMessage(`${links.split('\n').length} link(s) copiado(s).`, true); }
    catch { showMessage('Não foi possível copiar os links. Deixe o painel ativo e tente novamente.'); }
  });
  $('clearResults').addEventListener('click', async () => { if (selectionLocked()) { showMessage('Conclua a busca ou descarte a fila pendente antes de limpar os resultados.'); return; } state.result = null; state.selected.clear(); await selectionWrite.catch(() => {}); await chrome.storage.local.remove(['lastSearch', 'selectedVideoIds']); renderResults(); });
  $('pendingResume').addEventListener('click', () => { if (!state.result || state.importing || !state.importQueue) return; state.selected = new Set(state.importQueue.ids); state.filter = 'approved'; renderResults(); persistSelection().catch(error => showMessage(error.message)); importSelected(); });
  const reviewPendingSource = async confirmed => {
    if (state.importing || state.reviewing) return;
    const uncertain = state.importQueue?.failures?.find(item => item.status === 'uncertain');
    if (!uncertain) return;
    state.reviewing = true;
    updateDock();
    try {
      const tab = findNotebookTab(await chrome.tabs.query({}), state.importQueue);
      if (!tab) throw new Error('Abra o notebook de destino antes de confirmar a revisão.');
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'TUBELESS_IMPORT_REVIEW', url: videoUrl(uncertain.id), ...(confirmed ? { confirmed: true } : { retry: true }) });
      if (response?.status !== 'ok') throw new Error(response?.message || 'O notebook não confirmou a revisão. Recarregue a aba e tente novamente.');
      state.importQueue = confirmed ? markImportConfirmed(state.importQueue, uncertain.id) : { ...state.importQueue, failures: state.importQueue.failures.filter(item => item.id !== uncertain.id) };
      await chrome.storage.local.set({ importQueue: state.importQueue });
      showMessage(confirmed ? 'Fonte marcada como presente no notebook. Revise os demais itens pendentes ou retome.' : 'Revisão registrada. Revise os demais itens pendentes e retome para enviar os links restantes.', true);
    } catch (error) { showMessage(error.message || 'Não foi possível registrar a revisão.'); }
    finally { state.reviewing = false; updateDock(); }
  };
  $('pendingConfirm').addEventListener('click', () => reviewPendingSource(true));
  $('pendingRetry').addEventListener('click', () => reviewPendingSource(false));
  $('pendingDiscard').addEventListener('click', async () => { if (state.importing || state.reviewing) return; state.importQueue = null; state.selected.clear(); await chrome.storage.local.remove('importQueue'); await persistSelection(); showMessage('Fila descartada. Os resultados da pesquisa continuam disponíveis.', true); renderResults(); refreshNotebookTabs(); });
  $('openNotebook').addEventListener('click', async () => { await chrome.tabs.create({ url: state.importQueue?.notebookUrl || state.settings.notebookUrl || 'https://notebook.google.com/', active: true }); await refreshNotebookTabs(); });
  $('importButton').addEventListener('click', importSelected);
  chrome.tabs.onCreated.addListener(() => refreshNotebookTabs().catch(() => {}));
  chrome.tabs.onRemoved.addListener(() => refreshNotebookTabs().catch(() => {}));
  chrome.tabs.onUpdated.addListener((_tabId, change) => { if (change.url || change.status === 'complete') refreshNotebookTabs().catch(() => {}); });
}

async function init() {
  const stored = await chrome.storage.local.get(['settings', 'lastSearch', 'importQueue', 'selectedVideoIds']);
  state.settings = normalizeSettings(stored.settings || {});
  state.settings.languages = (parseLanguages(state.settings.languages).length ? parseLanguages(state.settings.languages) : parseLanguages(DEFAULT_SETTINGS.languages)).join(',');
  state.result = stored.lastSearch || null;
  state.importQueue = stored.importQueue || null;
  state.selected = selectionForResult(state.result, stored.selectedVideoIds);
  if (state.result) $('topic').value = state.result.topic;
  if (state.importQueue && state.result?.topic === state.importQueue.topic) {
    state.selected = new Set(state.importQueue.ids);
    if (state.selected.size) showMessage('Há uma importação pendente. Revise a seleção e clique em Adicionar fontes para retomar.');
  }
  fillSettings();
  updateSetup();
  renderResults();
  await refreshNotebookTabs();
  installEvents();
}

init().catch(error => showMessage(`Não foi possível iniciar a extensão: ${error.message}`));
