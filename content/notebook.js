(() => {
  if (globalThis.__tubelessNotebookLoaded) return;
  globalThis.__tubelessNotebookLoaded = true;
  const LABELS = {
    add: /^(add (a |new )?sources?|adicionar (uma |nova )?fontes?|agregar fuentes?|ajouter (une |des )?sources?|quellen hinzuf[uü]gen)$/i,
    youtube: /\byoutube\b/i,
    links: /^(websites?|web sites?|links?|sites?|sites da web|site da web|url|enlaces?|sitios web|liens?|lien web)$/i,
    submit: /^(insert|add|import|save|inserir|adicionar|importar|salvar|agregar|guardar|a[ñn]adir|ajouter|ins[eé]rer|hinzuf[uü]gen)( (?:a |new |uma |nova )?(?:source|fonte|fuente)s?| links?| youtube)?$/i,
    error: /could(?:n.t| not) add|unable to add|failed|erro ao adicionar|não foi possível|no se pudo|unsupported/i
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = element => {
    if (!element?.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
  };
  const enabled = element => visible(element) && !element.disabled && !element.readOnly && element.getAttribute('aria-disabled') !== 'true';
  const clean = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 140);
  function label(element) {
    const aria = element.getAttribute('aria-label');
    if (aria) return clean(aria);
    const labelled = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent || '').join(' ');
    if (labelled) return clean(labelled);
    if (element.labels?.length) return clean([...element.labels].map(item => item.textContent).join(' '));
    if (element.getAttribute('title')) return clean(element.getAttribute('title'));
    const copy = element.cloneNode(true);
    copy.querySelectorAll('mat-icon, svg, [aria-hidden="true"], .material-icons, .material-symbols-outlined').forEach(icon => icon.remove());
    return clean(copy.textContent) || clean(element.getAttribute('placeholder'));
  }
  const excluded = '.single-source-container, [role="listitem"], [class*="source-item"], [class*="source-card"], [class*="source-row"], [data-source-id], [class*="note-item"], [class*="note-card"], [class*="chat-input"], [class*="chat-message"]';
  function privateControl(element) {
    if (element.closest(excluded)) return true;
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      const id = (node.getAttribute('data-testid') || '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/_/g, '-');
      if (!id.includes('source')) continue;
      // Source rows are private. Explicit toolbars, panels and add-source forms are UI.
      const container = node.getAttribute('role') === 'toolbar'
        || /(?:^|-)(?:sources?)-(?:toolbar|panel|sidebar|header|section|dialog|modal|form|chooser)(?:-|$)/.test(id)
        || /(?:^|-)(?:toolbar|panel|sidebar|header|section)-(?:sources?)(?:-|$)/.test(id);
      const action = node === element && (/(?:^|-)(?:add|insert|import|new)-(?:sources?)(?:-|$)/.test(id)
        || /(?:^|-)(?:sources?)-(?:add|insert|import|new|url|link|submit|type)(?:-|$)/.test(id));
      if (!container && !action) return true;
    }
    return false;
  }
  const controls = root => [...root.querySelectorAll('button, [role="button"], mat-chip, [role="tab"]')].filter(element => visible(element) && !privateControl(element));
  const fields = root => [...root.querySelectorAll('input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea')].filter(element => visible(element) && !privateControl(element) && ['text', 'url', 'search', 'textarea', ''].includes(element.type || ''));
  const findControl = (pattern, root) => controls(root).find(element => pattern.test(label(element)) && enabled(element));
  const dialog = () => [...document.querySelectorAll('[role="dialog"], mat-dialog-container, dialog, .cdk-overlay-pane')].filter(visible).at(-1) || document;
  const busy = () => [...dialog().querySelectorAll('[aria-busy="true"], [role="progressbar"], mat-progress-spinner')].some(visible);
  const layoutError = message => Object.assign(new Error(message), { reason: 'layout' });
  const locale = () => (document.documentElement.lang || navigator.language || 'en').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'en';

  async function until(fn, ms = 12000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const value = fn();
      if (value) return value;
      await sleep(120);
    }
    return null;
  }
  function describe(element, kind) {
    return { tag: element.tagName.toLowerCase(), kind, role: clean(element.getAttribute('role')), label: label(element), ariaLabel: clean(element.getAttribute('aria-label')), placeholder: clean(element.getAttribute('placeholder')), formControlName: clean(element.getAttribute('formcontrolname')), testId: clean(element.getAttribute('data-testid')), name: clean(element.getAttribute('name')) };
  }
  function matchesDescriptor(element, descriptor) {
    if (element.tagName.toLowerCase() !== descriptor.tag || !visible(element)) return false;
    for (const [key, attribute] of [['ariaLabel', 'aria-label'], ['placeholder', 'placeholder'], ['formControlName', 'formcontrolname'], ['testId', 'data-testid'], ['name', 'name'], ['role', 'role']]) {
      if (descriptor[key] && clean(element.getAttribute(attribute)) !== descriptor[key]) return false;
    }
    return !descriptor.label || label(element) === descriptor.label;
  }
  async function message(request) {
    try { return await chrome.runtime.sendMessage(request); }
    catch { return { ok: false, message: 'Recarregue a extensão e a aba do notebook para identificar o controle.' }; }
  }
  async function locate(action, root, cache, found) {
    const pagePath = location.pathname;
    const kind = action === 'url' ? 'field' : 'button';
    const list = () => kind === 'field' ? fields(root) : controls(root);
    const cached = cache[action];
    if (cached) {
      const matches = list().filter(element => matchesDescriptor(element, cached));
      if (matches.length === 1 && await until(() => matchesDescriptor(matches[0], cached) && enabled(matches[0]) && matches[0], action === 'submit' ? 6000 : 1500)) { found[action] = describe(matches[0], kind); return matches[0]; }
    }
    const heuristic = () => {
      if (action === 'url') {
        const available = fields(root).filter(enabled);
        return available.find(element => /^(newUrl|url|urls|youtubeUrl|webUrl)$/i.test(element.getAttribute('formcontrolname') || ''))
          || available.find(element => /url|link|youtube|cole|paste|enlace|adresse/i.test([element.placeholder, element.getAttribute('aria-label'), label(element)].join(' ')))
          || available.find(element => element.type === 'url');
      }
      if (action === 'youtube') return findControl(LABELS.youtube, root) || findControl(LABELS.links, root);
      if (action === 'links') return findControl(LABELS.links, root) || findControl(LABELS.youtube, root);
      return findControl(LABELS[action], root);
    };
    const direct = await until(heuristic, action === 'submit' ? 6000 : 2000);
    if (direct) { found[action] = describe(direct, kind); return direct; }
    // Disabled controls can become ready after Angular validates the URL. Never click early.
    await until(() => list().some(enabled), 1500);
    const unsafeAction = /\b(delete|remove|excluir|apagar|remover|rename|renomear|cancel|cancelar|close|fechar|back|voltar|discover|descobrir)\b/i;
    const elements = list().filter(element => enabled(element) && (kind === 'field' || !unsafeAction.test(label(element)))).slice(0, 60);
    if (!elements.length) throw layoutError('Nenhum controle disponível para esta etapa. Abra a janela de adicionar YouTube e tente novamente.');
    const descriptors = elements.map(element => describe(element, kind));
    const candidates = descriptors.map(({ tag, role, label: name, placeholder, formControlName }, index) => {
      return { id: `e${index}`, kind, tag, role, label: name, placeholder, formControlName };
    });
    const response = await message({ type: 'TUBELESS_LOCATE_ELEMENT', action, candidates });
    if (!response?.ok) throw layoutError(response?.message || 'Não foi possível identificar o controle do notebook.');
    const index = candidates.findIndex(candidate => candidate.id === response.id);
    const target = elements[index];
    if (!target || location.pathname !== pagePath || !enabled(target) || !root.contains(target) || !matchesDescriptor(target, descriptors[index]) || dialog() !== root && root !== document) throw layoutError('A janela mudou durante a identificação. Tente novamente.');
    found[action] = describe(target, kind);
    return target;
  }
  function setValue(field, value) {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
  }
  function errorText() {
    const candidates = [...document.querySelectorAll('[role="alert"], [aria-live="assertive"], .mat-mdc-snack-bar-label')].filter(visible);
    return candidates.map(element => element.textContent?.trim()).find(text => text && LABELS.error.test(text)) || '';
  }
  function sourceEntries() {
    const entries = [...document.querySelectorAll('.single-source-container, [role="listitem"], [data-testid*="source"], [class*="source-item"], [class*="source-card"], [class*="source-row"]')].filter(element => visible(element) && !element.matches('[aria-busy="true"]') && ![...element.querySelectorAll('[role="progressbar"], mat-progress-spinner')].some(visible));
    return entries.map(element => {
      const text = [element.textContent, element.getAttribute('aria-label'), ...[...element.querySelectorAll('[aria-label]')].map(child => child.getAttribute('aria-label'))].filter(Boolean).join(' ').replace(/\s+/g, ' ').toLocaleLowerCase();
      const ids = new Set();
      for (const link of element.querySelectorAll('a[href]')) {
        try {
          const url = new URL(link.href);
          if (['www.youtube.com', 'youtube.com'].includes(url.hostname)) ids.add(url.searchParams.get('v'));
          else if (url.hostname === 'youtu.be') ids.add(url.pathname.slice(1));
        } catch { /* Ignore unrelated or invalid links. */ }
      }
      return { text, ids };
    });
  }
  const normalizeTitle = title => String(title || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  function sourceSnapshot(title, id, entries = sourceEntries()) {
    const normalizedTitle = normalizeTitle(title);
    return {
      titleMatches: normalizedTitle ? entries.filter(entry => entry.text.includes(normalizedTitle)).length : 0,
      urlMatches: entries.filter(entry => entry.ids.has(id)).length
    };
  }
  const confirmedSince = (transaction, entries) => {
    const after = sourceSnapshot(transaction.title, transaction.id, entries);
    return after.titleMatches > transaction.before.titleMatches || after.urlMatches > transaction.before.urlMatches;
  };
  const pending = new Map();
  const confirmedReceipts = new Map();

  async function importVideos(input, notebookUrl) {
    if (notebookUrl) {
      const expected = /^https:\/\/(?:notebook\.google\.com|notebooklm\.google\.com)\/notebook\/([a-zA-Z0-9_-]+)\/?$/.exec(notebookUrl);
      if (!expected || location.pathname.replace(/\/$/, '') !== `/notebook/${expected[1]}`) throw layoutError('O notebook mudou antes da inserção. Volte ao destino escolhido e tente novamente.');
    }
    if (!Array.isArray(input) || !input.length || input.length > 1000) throw new Error('Seleção de vídeos inválida.');
    const videos = input.map(item => {
      if (!/^https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}$/.test(item?.url || '')) throw new Error('URL de vídeo inválida.');
      return { url: item.url, title: String(item.title || '').slice(0, 1000), id: new URL(item.url).searchParams.get('v') };
    });
    if (new Set(videos.map(item => item.id)).size !== videos.length) throw new Error('A seleção contém links repetidos.');
    if (!/^\/notebook\/[a-zA-Z0-9_-]+\/?$/.test(location.pathname)) throw new Error('Abra um notebook antes de importar.');
    const destinationPath = location.pathname;
    const assertDestination = () => { if (location.pathname !== destinationPath) throw layoutError('O notebook mudou antes da inserção. Volte ao destino escolhido e tente novamente.'); };
    const entries = sourceEntries();
    const late = new Set();
    for (const [key, transaction] of confirmedReceipts) {
      if (transaction.path !== destinationPath) continue;
      if (confirmedSince(transaction, entries)) late.add(transaction.url);
      else confirmedReceipts.delete(key);
    }
    for (const [key, transaction] of pending) {
      if (transaction.path === destinationPath && confirmedSince(transaction, entries)) { pending.delete(key); confirmedReceipts.set(key, transaction); late.add(transaction.url); }
    }
    const outcomes = new Map();
    const additions = videos.filter(video => {
      if (!late.has(video.url) && !sourceSnapshot(video.title, video.id, entries).urlMatches) return true;
      outcomes.set(video.id, { id: video.id, status: 'duplicate', message: 'Este link já está nas fontes do notebook.' });
      return false;
    });
    const result = () => videos.map(video => outcomes.get(video.id));
    if (!additions.length) return result();
    if ([...pending.values()].some(transaction => transaction.path === destinationPath)) {
      additions.forEach(video => outcomes.set(video.id, { id: video.id, status: pending.has(`${destinationPath}:${video.id}`) ? 'uncertain' : 'error', message: 'Há fontes do envio anterior sem confirmação. Revise os itens pendentes antes de repetir.' }));
      return result();
    }
    const saved = await message({ type: 'TUBELESS_LOCATOR_CACHE', op: 'get', locale: locale() });
    assertDestination();
    const cache = saved?.ok ? saved.cache || {} : {};
    const found = {};
    let root = dialog();
    if (root === document) {
      const add = await locate('add', document, cache, found);
      assertDestination();
      add.click();
      root = await until(() => dialog() !== document && dialog(), 8000);
      assertDestination();
      if (!root) throw layoutError('A janela de adicionar fontes não abriu. Abra-a no notebook e tente novamente.');
    }
    let field = fields(root).find(element => enabled(element) && /url|link|youtube/i.test([element.getAttribute('formcontrolname'), element.placeholder, label(element)].join(' ')));
    if (!field && (findControl(LABELS.youtube, root) || findControl(LABELS.links, root) || !fields(root).length)) {
      const choice = await locate(additions.length > 1 ? 'links' : 'youtube', root, cache, found);
      assertDestination();
      choice.click();
      await until(() => fields(dialog()).some(enabled), 8000);
      assertDestination();
      root = dialog();
      if (root === document) throw layoutError('A janela de YouTube fechou antes da inserção. Tente novamente.');
    }
    field = await locate('url', root, cache, found);
    assertDestination();
    if (additions.length > 1 && field.type === 'url') throw layoutError('Este campo aceita apenas um link. Abra a opção Sites/Links para adicionar o lote ou use Copiar links selecionados.');
    const value = additions.map(video => video.url).join(field instanceof HTMLTextAreaElement ? '\n' : ' ');
    setValue(field, value);
    const submit = await locate('submit', root, cache, found);
    assertDestination();
    if (!enabled(submit) || !field.isConnected || field.value !== value) throw layoutError('O formulário mudou antes da inserção. Tente novamente.');
    const previousError = errorText();
    let errorCleared = !previousError;
    const titleKey = video => normalizeTitle(video.title);
    const transactions = additions.map(video => {
      // Overlapping titles cannot prove which member of a batch was added.
      const title = additions.some(other => other.id !== video.id && (titleKey(other).includes(titleKey(video)) || titleKey(video).includes(titleKey(other)))) ? '' : video.title;
      const transaction = { ...video, title, before: sourceSnapshot(title, video.id, entries), path: destinationPath };
      pending.set(`${destinationPath}:${video.id}`, transaction);
      return transaction;
    });
    submit.click();
    let unconfirmedMessage = 'A interface não confirmou esta fonte. Verifique o notebook antes de repetir.';
    await until(() => {
      if (location.pathname !== destinationPath) { unconfirmedMessage = 'O notebook mudou antes de confirmar o lote. Verifique o destino original.'; return true; }
      const current = sourceEntries();
      for (const transaction of transactions) {
        if (!outcomes.has(transaction.id) && confirmedSince(transaction, current)) {
          outcomes.set(transaction.id, { id: transaction.id, status: 'imported', message: 'Nova fonte confirmada no notebook.' });
          pending.delete(`${destinationPath}:${transaction.id}`);
          confirmedReceipts.set(`${destinationPath}:${transaction.id}`, transaction);
        }
      }
      if (transactions.every(transaction => outcomes.has(transaction.id))) return true;
      const error = errorText();
      if (!error) errorCleared = true;
      if (error && (errorCleared || error !== previousError)) { unconfirmedMessage = error; return true; }
      return null;
    }, additions.length > 1 ? 90000 : 45000);
    if ([...outcomes.values()].some(outcome => outcome.status === 'imported')) {
      // Save only descriptors of controls used by a successful, visibly confirmed import.
      await message({ type: 'TUBELESS_LOCATOR_CACHE', op: 'put', locale: locale(), entries: found });
    }
    transactions.forEach(transaction => {
      if (!outcomes.has(transaction.id)) outcomes.set(transaction.id, { id: transaction.id, status: 'uncertain', message: unconfirmedMessage });
    });
    return result();
  }

  let queue = Promise.resolve();
  chrome.runtime.onMessage.addListener((request, _sender, respond) => {
    if (request?.type === 'TUBELESS_PING') {
      respond({ ok: true, path: location.pathname });
      return false;
    }
    if (request?.type === 'TUBELESS_IMPORT_REVIEW') {
      const entry = [...pending].find(([, transaction]) => transaction.url === request.url && transaction.path === location.pathname);
      if (!entry) { respond({ status: 'ok' }); return false; }
      if (request.confirmed === true || request.retry === true && !busy()) {
        pending.delete(entry[0]);
        respond({ status: 'ok' });
      } else respond({ status: 'error', message: 'A inserção ainda está em andamento. Aguarde a janela do notebook.' });
      return false;
    }
    if (!['TUBELESS_IMPORT', 'TUBELESS_IMPORT_BATCH'].includes(request?.type)) return false;
    const batch = request.type === 'TUBELESS_IMPORT_BATCH';
    const input = batch ? request.videos : [{ url: request.url, title: request.title }];
    queue = queue.catch(() => {}).then(() => importVideos(input, request.notebookUrl));
    queue.then(outcomes => respond(batch ? { status: 'batch', outcomes } : outcomes[0]), error => respond({ status: [...pending.values()].some(transaction => transaction.path === location.pathname) ? 'uncertain' : 'error', reason: error.reason, message: error?.message || 'Falha na importação.' }));
    return true;
  });
})();
