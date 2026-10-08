import { DEFAULT_SETTINGS, normalizeSettings, parseLanguages, parseNotebookUrl, isNotebookSite, videoUrl, sortVideosByRelevance } from './core/search.js';
import { runDiscovery } from './core/pipeline.js';
import { buildImportQueue, findNotebookTab, recordBatchImportOutcome, shouldPauseImport, markImportConfirmed } from './core/imports.js';
import { SettingsPanel, requestApiPermissions } from './settings.js';
import { sanitizeError } from './core/connections.js';
import { mergeDiscoveryResults, selectionForResult, selectionAfterContinuation, selectedVideoLinks } from './core/continuation.js';
import { createHistoryEntry, addHistoryEntry, removeHistoryEntry, findHistoryEntry } from './core/history.js';

const $ = id => document.getElementById(id);
const state = { settings: { ...DEFAULT_SETTINGS }, result: null, selected: new Set(), filter: 'approved', controller: null, importing: false, reviewing: false, importQueue: null, history: [] };
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
    checkbox.disabled = checkbox.checked ? count === 1 : count >= 20;
  });
}

function persistSelection() {
  const ids = [...state.selected];
  selectionWrite = selectionWrite.catch(() => {}).then(() => chrome.storage.local.set({ selectedVideoIds: ids }));
  return selectionWrite;
}

function persistHistory() {
  return chrome.storage.local.set({ searchHistory: state.history });
}

function isCurrentSearchSaved() {
  if (!state.result?.topic) return false;
  return state.history.some(item => item.topic.trim().toLowerCase() === state.result.topic.trim().toLowerCase());
}

function renderHistory() {
  const count = state.history.length;
  $('historyBadge').textContent = String(count);
  $('historyBadge').classList.toggle('hidden', count === 0);
  const list = $('historyList');
  list.replaceChildren();
  if (!count) {
    list.append(element('div', 'empty-results', 'Nenhuma busca salva no histórico.'));
    return;
  }
  state.history.forEach(entry => {
    const card = element('div', 'history-item');
    const info = element('div', 'history-info');
    const topic = element('div', 'history-topic', entry.topic);
    topic.title = entry.topic;
    const approvedCount = entry.videos.filter(v => v.status === 'approved').length;
    const meta = element('div', 'history-meta', `${entry.dateFormatted} · ${approvedCount} relevantes de ${entry.videos.length} vídeos`);
    info.append(topic, meta);

    const actions = element('div', 'history-actions');
    const openBtn = element('button', 'secondary-button', 'Abrir');
    openBtn.type = 'button';
    openBtn.title = 'Carregar esta pesquisa na tela';
    openBtn.addEventListener('click', () => loadFromHistory(entry.id));

    const delBtn = element('button', 'text-button history-delete', '✕');
    delBtn.type = 'button';
    delBtn.title = 'Excluir esta busca';
    delBtn.addEventListener('click', () => deleteFromHistory(entry.id));

    actions.append(openBtn, delBtn);
    card.append(info, actions);
    list.append(card);
  });
}

async function loadFromHistory(id) {
  const entry = findHistoryEntry(state.history, id);
  if (!entry) return;
  if (state.controller || state.importing || state.reviewing) {
    showMessage('Conclua a operação em andamento antes de carregar outra busca.');
    return;
  }
  state.result = {
    topic: entry.topic,
    terms: entry.terms,
    videos: entry.videos,
    discoveredCount: entry.discoveredCount,
    discoveredIds: entry.discoveredIds,
    warnings: entry.warnings,
    rounds: entry.rounds,
    historyId: entry.id
  };
  state.selected = new Set(entry.selectedVideoIds || entry.videos.filter(v => v.status === 'approved').map(v => v.id));
  state.filter = 'approved';
  $('topic').value = entry.topic;
  $('historyDrawer').classList.add('hidden');
  $('historyToggle').setAttribute('aria-expanded', 'false');
  await chrome.storage.local.set({ lastSearch: state.result, selectedVideoIds: [...state.selected] });
  renderResults();
  showMessage(`Busca "${entry.topic}" carregada do histórico.`, true);
}

async function deleteFromHistory(id) {
  state.history = removeHistoryEntry(state.history, id);
  await persistHistory();
  renderHistory();
  renderResults();
  showMessage('Busca removida do histórico.', true);
}

async function clearAllHistory() {
  if (!state.history.length) return;
  state.history = [];
  await persistHistory();
  renderHistory();
  renderResults();
  showMessage('Histórico de buscas limpo.', true);
}

async function saveCurrentSearchToHistory() {
  if (!state.result) return;
  const entry = createHistoryEntry(state.result, state.selected);
  state.history = addHistoryEntry(state.history, entry);
  await persistHistory();
  renderHistory();
  renderResults();
  showMessage(`Busca "${entry.topic}" salva no histórico!`, true);
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
  const saveBtn = $('saveCurrentSearch');
  if (saveBtn) {
    saveBtn.classList.toggle('hidden', !result);
    if (result) {
      const saved = isCurrentSearchSaved();
      saveBtn.textContent = saved ? 'Salva no histórico ✓' : 'Salvar busca';
      saveBtn.disabled = saved;
    }
  }
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
}

async function ensureTabReady(tabId) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const ping = await chrome.tabs.sendMessage(tabId, { type: 'TUBELESS_PING' });
      if (ping?.ok) return true;
    } catch {
      // Content script ainda carregando ou estabelecendo conexão
    }
    await wait(300);
  }
  return true;
}

async function targetTab() {
  const allTabs = await chrome.tabs.query({});

  // 1. Se há uma fila de importação pendente, continuar no mesmo notebook
  if (state.importQueue) {
    const tab = findNotebookTab(allTabs, state.importQueue);
    if (!tab) throw new Error('O notebook original da importação pendente não está aberto. Abra-o no Chrome para continuar ou descarte a fila pendente.');
    await ensureTabReady(tab.id);
    return tab;
  }

  // 2. Prioridade 1: Aba ativa na janela em foco (onde o usuário está navegando ao lado do painel lateral)
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = activeTabs[0];
  if (activeTab && parseNotebookUrl(activeTab.url)) {
    await ensureTabReady(activeTab.id);
    return activeTab;
  }

  // 3. Prioridade 2: Qualquer aba aberta que esteja em um caderno (/notebook/ID)
  const projectTabs = allTabs.filter(tab => parseNotebookUrl(tab.url));
  if (projectTabs.length > 0) {
    const chosen = projectTabs.find(t => t.windowId === activeTab?.windowId) || projectTabs[0];
    await ensureTabReady(chosen.id);
    await chrome.tabs.update(chosen.id, { active: true }).catch(() => {});
    return chosen;
  }

  // 4. Prioridade 3: Se há aba no site do NotebookLM, mas ainda na home (sem caderno aberto)
  const siteTab = allTabs.find(tab => isNotebookSite(tab.url));
  if (siteTab) {
    await chrome.tabs.update(siteTab.id, { active: true }).catch(() => {});
    if (siteTab.windowId) await chrome.windows.update(siteTab.windowId, { focused: true }).catch(() => {});
    throw new Error('Você está no NotebookLM, mas nenhum caderno está aberto. Abra o projeto desejado para adicionar as fontes.');
  }

  // 5. Nenhuma aba do NotebookLM encontrada
  throw new Error('Nenhuma aba do NotebookLM está aberta no Chrome. Clique em "Abrir NotebookLM" para entrar.');
}

async function sendToNotebook(tabId, videos, notebookUrl) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await chrome.tabs.sendMessage(tabId, {
        type: 'TUBELESS_IMPORT_BATCH',
        notebookUrl,
        videos: videos.map(video => ({ url: videoUrl(video.id), title: video.title }))
      });
    } catch (error) {
      if (!/Receiving end does not exist|Could not establish connection/i.test(error.message)) throw error;
      await wait(800);
    }
  }
  throw new Error('Não foi possível conectar à aba do NotebookLM. Recarregue a página do notebook e tente novamente.');
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
    const shouldSave = $('saveSearchToggle')?.checked ?? true;
    if (shouldSave) {
      const entry = createHistoryEntry(result, selected);
      state.history = addHistoryEntry(state.history, entry);
      await persistHistory();
      renderHistory();
    }
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
  $('historyToggle').addEventListener('click', () => {
    const drawer = $('historyDrawer');
    const isHidden = drawer.classList.toggle('hidden');
    $('historyToggle').setAttribute('aria-expanded', String(!isHidden));
  });
  $('clearAllHistory').addEventListener('click', clearAllHistory);
  $('saveCurrentSearch').addEventListener('click', saveCurrentSearchToHistory);
  $('languageOptions').addEventListener('change', event => {
    if (!event.target.matches('input[name="searchLanguage"]')) return;
    const languages = [...$('languageOptions').querySelectorAll('input:checked')].map(input => input.value);
    if (state.controller || !languages.length || languages.length > 20) { renderLanguageChoices(); return; }
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
  $('clearResults').addEventListener('click', async () => {
    if (selectionLocked()) { showMessage('Conclua a busca ou descarte a fila pendente antes de limpar os resultados.'); return; }
    state.result = null;
    state.selected.clear();
    await selectionWrite.catch(() => {});
    await chrome.storage.local.remove(['lastSearch', 'selectedVideoIds']);
    renderResults();
    showMessage('Pesquisa limpa da tela. Suas buscas salvas continuam disponíveis no Histórico.');
  });
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
  $('pendingDiscard').addEventListener('click', async () => { if (state.importing || state.reviewing) return; state.importQueue = null; state.selected.clear(); await chrome.storage.local.remove('importQueue'); await persistSelection(); showMessage('Fila descartada. Os resultados da pesquisa continuam disponíveis.', true); renderResults(); });
  $('openNotebook').addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find(tab => isNotebookSite(tab.url));
    if (existing) {
      await chrome.tabs.update(existing.id, { active: true }).catch(() => {});
      if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
    } else {
      await chrome.tabs.create({ url: state.importQueue?.notebookUrl || 'https://notebooklm.google.com/', active: true });
    }
  });
  $('importButton').addEventListener('click', importSelected);
}

async function init() {
  const stored = await chrome.storage.local.get(['settings', 'lastSearch', 'importQueue', 'selectedVideoIds', 'searchHistory']);
  state.settings = normalizeSettings(stored.settings || {});
  state.settings.languages = (parseLanguages(state.settings.languages).length ? parseLanguages(state.settings.languages) : parseLanguages(DEFAULT_SETTINGS.languages)).join(',');
  state.history = Array.isArray(stored.searchHistory) ? stored.searchHistory : [];
  state.result = stored.lastSearch || null;
  state.importQueue = stored.importQueue || null;
  state.selected = selectionForResult(state.result, stored.selectedVideoIds);
  if (state.result) $('topic').value = state.result.topic;
  if (state.importQueue && state.result?.topic === state.importQueue.topic) {
    state.selected = new Set(state.importQueue.ids);
    if (state.selected.size) showMessage('Há uma importação pendente. Revise a seleção e clique em Adicionar fontes para retomar.');
  }
  renderHistory();
  fillSettings();
  updateSetup();
  renderResults();
  installEvents();
}

init().catch(error => showMessage(`Não foi possível iniciar a extensão: ${error.message}`));
