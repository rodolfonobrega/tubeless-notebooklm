import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SCOUT_PLAYWRIGHT_PATH || 'playwright');
const script = readFileSync(new URL('../content/notebook.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true, ...(process.env.SCOUT_CHROME_PATH ? { executablePath: process.env.SCOUT_CHROME_PATH } : {}) });
const fixtures = `<!doctype html><meta charset="utf-8"><style>button,input,textarea { padding:10px; margin:8px } .gone{display:none}</style><button id="add"><mat-icon aria-hidden="true">add_circle</mat-icon><span>Adicionar fontes</span></button><div id="modal"></div><div id="sources"></div><button class="source-card">PRIVATE SOURCE TITLE</button><textarea class="chat-input">PRIVATE NOTE CONTENT</textarea><script>
let count=0;window.submissions=0;
add.onclick=()=> { modal.setAttribute('role','dialog'); modal.innerHTML='<button id="choice"><mat-icon>video_library</mat-icon><span>YouTube</span></button>'; choice.onclick=()=>{
modal.innerHTML='<form><label for="link">URL do YouTube</label><textarea id="link" formcontrolname="newUrl" placeholder="Cole os links"></textarea><button type="button" id="cancel">Cancelar</button><button type="submit" id="submit" disabled><mat-icon>add</mat-icon><span id="submitLabel">Inserir</span></button></form>';
link.oninput=()=>setTimeout(()=>{submit.disabled=false},300);
modal.querySelector('form').onsubmit=e=> {e.preventDefault();window.submissions++;window.lastSubmitted=link.value;for(const url of link.value.trim().split(/\\s+/)){ const source=document.createElement('div');source.className='source-item';source.innerHTML='<a href="'+url+'">Fonte '+(++count)+'</a>';sources.append(source); }modal.replaceChildren();modal.removeAttribute('role')};
}; };
</script>`;

async function createPage(dynamic = false, cache = {}) {
  const page = await browser.newPage();
  await page.route('https://notebooklm.google.com/notebook/fixture123', route => route.fulfill({ body: fixtures, contentType: 'text/html' }));
  await page.goto('https://notebooklm.google.com/notebook/fixture123');
  await page.evaluate(({ dynamic, cache }) => {
    window.importListener = null;
    window.locatorCalls = [];
    window.savedCache = cache;
    window.chrome = { runtime: {
      onMessage: { addListener(fn) { window.importListener = fn; } },
      async sendMessage(message) {
        if (message.type === 'TUBELESS_LOCATOR_CACHE') {
          if (message.op === 'get') return { ok: true, cache: window.savedCache };
          window.savedCache = { ...window.savedCache, ...message.entries };
          return { ok: true };
        }
        window.locatorCalls.push(message);
        const match = message.candidates.find(candidate => /Finalizar conexão/i.test(candidate.label));
        return dynamic && match ? { ok: true, id: match.id } : { ok: false, message: 'Nenhum alvo seguro' };
      }
    } };
    if (dynamic) {
      const observer = new MutationObserver(() => { const label = document.querySelector('#submitLabel'); if (label && label.textContent !== 'Finalizar conexão') label.textContent = 'Finalizar conexão'; });
      observer.observe(document.querySelector('#modal'), { childList: true, subtree: true });
    }
  }, { dynamic, cache });
  await page.evaluate(script);
  return page;
}

async function send(page, id) {
  return page.evaluate(id => new Promise(resolve => window.importListener({ type: 'TUBELESS_IMPORT', url: `https://www.youtube.com/watch?v=${id}`, title: `Vídeo ${id}` }, { id: 'test' }, resolve)), id);
}

async function sendBatch(page, ids, options = {}) {
  return page.evaluate(({ ids, options }) => new Promise(resolve => {
    const listening = window.importListener({ type: 'TUBELESS_IMPORT_BATCH', notebookUrl: options.notebookUrl, videos: ids.map((id, index) => ({ url: `https://www.youtube.com/watch?v=${id}`, title: options.titles?.[index] || `Vídeo ${id}` })) }, { id: 'test' }, resolve);
    if (!listening) resolve({ status: 'unsupported' });
  }), { ids, options });
}

try {
  const batch = await createPage();
  const batchIds = ['abc12345678', 'def12345678', 'ghi12345678'];
  const batchResult = await sendBatch(batch, batchIds);
  assert.equal(batchResult.status, 'batch');
  assert.deepEqual(batchResult.outcomes.map(item => item.status), ['imported', 'imported', 'imported']);
  assert.equal(await batch.locator('.source-item').count(), 3);
  assert.equal(await batch.evaluate(() => window.submissions), 1);
  assert.equal(await batch.evaluate(() => window.lastSubmitted), batchIds.map(id => `https://www.youtube.com/watch?v=${id}`).join('\n'));
  assert.deepEqual((await sendBatch(batch, batchIds)).outcomes.map(item => item.status), ['duplicate', 'duplicate', 'duplicate']);
  assert.equal(await batch.evaluate(() => window.submissions), 1);
  console.log('OK: lote colado uma vez, cada fonte confirmada e duplicatas não reenviadas');
  await batch.close();

  const largeBatch = await createPage();
  const largeIds = Array.from({ length: 250 }, (_, index) => `VID${String(index).padStart(8, '0')}`);
  const largeResult = await sendBatch(largeBatch, largeIds);
  assert.equal(largeResult.outcomes.length, 250);
  assert.ok(largeResult.outcomes.every(item => item.status === 'imported'));
  assert.equal(await largeBatch.locator('.source-item').count(), 250);
  assert.equal(await largeBatch.evaluate(() => window.submissions), 1);
  console.log('OK: 250 links enviados juntos e confirmados individualmente');
  await largeBatch.close();

  const websites = await createPage();
  await websites.evaluate(() => {
    const open = add.onclick;
    add.onclick = () => {
      open();
      const youtube = document.querySelector('#choice'); const choose = youtube.onclick;
      youtube.onclick = () => { window.chosenType = 'youtube'; choose(); };
      const website = document.createElement('button'); website.textContent = 'Sites';
      website.onclick = () => { window.chosenType = 'links'; choose(); };
      modal.append(website);
    };
  });
  assert.ok((await sendBatch(websites, batchIds)).outcomes.every(item => item.status === 'imported'));
  assert.equal(await websites.evaluate(() => window.chosenType), 'links');
  console.log('OK: lote prefere Sites/Links quando a opção YouTube também está disponível');
  await websites.close();

  const singleLine = await createPage();
  await singleLine.evaluate(() => {
    const open = add.onclick;
    add.onclick = () => {
      open(); const choose = document.querySelector('#choice').onclick;
      document.querySelector('#choice').onclick = () => {
        choose(); const textarea = document.querySelector('#link');
        const input = document.createElement('input'); input.type = 'text';
        for (const attribute of textarea.attributes) input.setAttribute(attribute.name, attribute.value);
        input.oninput = textarea.oninput; textarea.replaceWith(input);
      };
    };
  });
  assert.ok((await sendBatch(singleLine, batchIds)).outcomes.every(item => item.status === 'imported'));
  assert.equal(await singleLine.evaluate(() => window.lastSubmitted), batchIds.map(id => `https://www.youtube.com/watch?v=${id}`).join(' '));
  assert.equal(await singleLine.evaluate(() => window.submissions), 1);
  console.log('OK: campo de uma linha recebe links separados por espaços em um único envio');
  await singleLine.close();

  const partial = await createPage();
  await partial.evaluate(() => {
    window.partialHandler = event => {
      event.preventDefault(); event.stopImmediatePropagation(); window.submissions++;
      const url = event.target.querySelector('textarea').value.trim().split(/\s+/)[0];
      const source = document.createElement('div'); source.className = 'source-item';
      const link = document.createElement('a'); link.href = url; link.textContent = 'Primeira fonte'; source.append(link); sources.append(source);
      const alert = document.createElement('div'); alert.setAttribute('role', 'alert'); alert.textContent = 'Erro ao adicionar algumas fontes'; document.body.append(alert);
      modal.replaceChildren(); modal.removeAttribute('role');
    };
    document.addEventListener('submit', window.partialHandler, true);
  });
  const partialResult = await sendBatch(partial, batchIds);
  assert.deepEqual(partialResult.outcomes.map(item => item.status), ['imported', 'uncertain', 'uncertain']);
  const review = (page, id) => page.evaluate(id => new Promise(resolve => window.importListener({ type: 'TUBELESS_IMPORT_REVIEW', url: `https://www.youtube.com/watch?v=${id}`, retry: true }, {}, resolve)), id);
  assert.equal((await review(partial, batchIds[1])).status, 'ok');
  const blocked = await sendBatch(partial, batchIds);
  assert.deepEqual(blocked.outcomes.map(item => item.status), ['duplicate', 'error', 'uncertain']);
  assert.equal(await partial.evaluate(() => window.submissions), 1);
  assert.equal((await review(partial, batchIds[2])).status, 'ok');
  await partial.evaluate(() => { document.removeEventListener('submit', window.partialHandler, true); document.querySelector('[role="alert"]').remove(); });
  const resumedBatch = await sendBatch(partial, batchIds);
  assert.deepEqual(resumedBatch.outcomes.map(item => item.status), ['duplicate', 'imported', 'imported']);
  assert.equal(await partial.locator('.source-item').count(), 3);
  assert.equal(await partial.evaluate(() => window.submissions), 2);
  assert.equal(await partial.evaluate(() => window.lastSubmitted), batchIds.slice(1).map(id => `https://www.youtube.com/watch?v=${id}`).join('\n'));
  console.log('OK: lote parcial preserva confirmadas, exige revisão dos pendentes e retoma somente dois links');
  await partial.close();

  const wrongDestination = await createPage();
  const wrongResult = await sendBatch(wrongDestination, batchIds, { notebookUrl: 'https://notebook.google.com/notebook/wrong123' });
  assert.equal(wrongResult.status, 'error');
  assert.equal(wrongResult.reason, 'layout');
  assert.equal(await wrongDestination.evaluate(() => window.submissions), 0);
  console.log('OK: destino da mensagem diferente do notebook atual não abre nem submete formulário');
  await wrongDestination.close();

  const titleOnly = await createPage();
  await titleOnly.evaluate(() => {
    document.addEventListener('submit', event => {
      event.preventDefault(); event.stopImmediatePropagation(); window.submissions++;
      for (const url of event.target.querySelector('textarea').value.trim().split(/\s+/)) {
        const source = document.createElement('div'); source.className = 'single-source-container';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', `Vídeo ${new URL(url).searchParams.get('v')}`); source.append(checkbox); sources.append(source);
      }
      modal.replaceChildren(); modal.removeAttribute('role');
    }, true);
  });
  assert.ok((await sendBatch(titleOnly, batchIds)).outcomes.every(item => item.status === 'imported'));
  assert.ok((await sendBatch(titleOnly, batchIds)).outcomes.every(item => item.status === 'duplicate'));
  assert.equal(await titleOnly.evaluate(() => window.submissions), 1);
  console.log('OK: fontes com rótulos acessíveis sem URLs são confirmadas e não reenviadas na mesma página');
  await titleOnly.close();

  const overlapping = await createPage();
  await overlapping.evaluate(() => {
    document.addEventListener('submit', event => {
      event.preventDefault(); event.stopImmediatePropagation(); window.submissions++;
      const source = document.createElement('div'); source.className = 'source-item'; source.textContent = 'A & B'; sources.append(source);
      const alert = document.createElement('div'); alert.setAttribute('role', 'alert'); alert.textContent = 'Erro ao adicionar algumas fontes'; document.body.append(alert);
    }, true);
  });
  const overlappingResult = await sendBatch(overlapping, batchIds.slice(0, 2), { titles: ['A & B', 'A &amp; B'] });
  assert.ok(overlappingResult.outcomes.every(item => item.status === 'uncertain'));
  assert.equal(await overlapping.evaluate(() => window.submissions), 1);
  console.log('OK: títulos equivalentes não confirmam dois vídeos pela aparição de uma única fonte');
  await overlapping.close();

  const page = await createPage();
  assert.equal((await send(page, 'abc12345678')).status, 'imported');
  assert.equal(await page.locator('.source-item').count(), 1);
  assert.equal(await page.evaluate(() => window.submissions), 1);
  assert.equal(await page.evaluate(() => window.locatorCalls.length), 0);
  console.log('OK: nomes com ícones e botão habilitado após validação Angular');
  await page.close();

  const privateAdd = await createPage();
  await privateAdd.evaluate(() => {
    const add = document.querySelector('#add');
    add.textContent = 'Conectar material';
    add.setAttribute('data-testid', 'add-source-button');
    const toolbar = document.createElement('div'); toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('data-testid', 'sources-toolbar'); add.before(toolbar); toolbar.append(add);
    for (const attributes of [{ role: 'listitem', 'data-testid': 'source-tile' }, { 'data-testid': 'source-custom-card' }, { role: 'listitem' }]) {
      const row = document.createElement('div');
      for (const [key, value] of Object.entries(attributes)) row.setAttribute(key, value);
      const button = document.createElement('button'); button.textContent = 'PRIVATE_SOURCE_TITLE';
      const field = document.createElement('input'); field.placeholder = 'PRIVATE_SOURCE_DESCRIPTION'; row.append(button, field); document.body.append(row);
    }
    const original = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = async message => {
      if (message.type !== 'TUBELESS_LOCATE_ELEMENT' || message.action !== 'add') return original(message);
      window.locatorCalls.push(message);
      return { ok: true, id: message.candidates.find(candidate => candidate.label === 'Conectar material')?.id };
    };
  });
  assert.equal((await send(privateAdd, 'abc12345678')).status, 'imported');
  const addRequest = await privateAdd.evaluate(() => window.locatorCalls[0]);
  assert.equal(addRequest.action, 'add');
  assert.equal(JSON.stringify(addRequest).includes('PRIVATE_SOURCE'), false);
  assert.deepEqual(addRequest.candidates.map(candidate => candidate.label), ['Conectar material']);
  console.log('OK: fallback Adicionar exclui fontes/listas privadas e preserva a barra legítima');
  await privateAdd.close();

  const dynamic = await createPage(true);
  assert.equal((await send(dynamic, 'abc12345678')).status, 'imported');
  assert.equal(await dynamic.evaluate(() => window.locatorCalls.length), 1);
  const request = await dynamic.evaluate(() => window.locatorCalls[0]);
  assert.equal(request.action, 'submit');
  assert.equal(JSON.stringify(request).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(request).includes('https://www.youtube'), false);
  assert.equal(JSON.stringify(request).includes('value'), false);
  assert.equal((await send(dynamic, 'def12345678')).status, 'imported');
  assert.equal(await dynamic.evaluate(() => window.locatorCalls.length), 1);
  console.log('OK: novo rótulo resolvido por ID, sem conteúdo privado, cache reutilizado');
  const cache = await dynamic.evaluate(() => window.savedCache);
  await dynamic.close();

  const stale = await createPage(false, cache);
  assert.equal((await send(stale, 'ghi12345678')).status, 'imported');
  assert.equal(await stale.evaluate(() => window.locatorCalls.length), 0);
  console.log('OK: cache obsoleto rejeitado e rótulo atual localizado');
  await stale.close();

  const rejected = await createPage(true);
  await rejected.evaluate(() => { const original = chrome.runtime.sendMessage; chrome.runtime.sendMessage = message => message.type === 'TUBELESS_LOCATE_ELEMENT' ? { ok: true, id: '#inventado' } : original(message); });
  const failure = await send(rejected, 'abc12345678');
  assert.equal(failure.status, 'error');
  assert.equal(failure.reason, 'layout');
  assert.equal(await rejected.evaluate(() => window.submissions), 0);
  console.log('OK: resposta com seletor inventado não clica nem submete');
  await rejected.close();

  const angular = await createPage();
  await angular.evaluate(() => {
    const observer = new MutationObserver(() => {
      for (const source of document.querySelectorAll('.source-item')) {
        source.className = 'single-source-container';
        const title = source.textContent;
        source.replaceChildren();
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', title); source.append(checkbox);
      }
    });
    observer.observe(document.querySelector('#sources'), { childList: true });
  });
  assert.equal((await send(angular, 'abc12345678')).status, 'imported');
  assert.equal(await angular.locator('.single-source-container').count(), 1);
  console.log('OK: fonte Angular confirmada pelo rótulo acessível da linha');
  await angular.close();

  const delayed = await createPage();
  await delayed.evaluate(() => {
    // Speed up only the confirmation wait. The form still validates with its real delay.
    document.addEventListener('submit', event => {
      event.preventDefault(); event.stopImmediatePropagation(); window.submissions++;
      const now = Date.now; const start = now(); Date.now = () => start + (now() - start) * 120;
      const url = event.target.querySelector('input,textarea').value;
      setTimeout(() => { const source = document.createElement('div'); source.className = 'source-item'; const link = document.createElement('a'); link.href = url; link.textContent = 'Vídeo abc12345678'; source.append(link); document.querySelector('#sources').append(source); }, 1800);
    }, true);
  });
  assert.equal((await send(delayed, 'abc12345678')).status, 'uncertain');
  assert.equal((await send(delayed, 'def12345678')).status, 'error');
  assert.equal(await delayed.evaluate(() => window.submissions), 1);
  await delayed.waitForSelector('.source-item');
  assert.equal((await send(delayed, 'abc12345678')).status, 'duplicate');
  assert.equal(await delayed.evaluate(() => window.submissions), 1);
  console.log('OK: confirmação tardia bloqueia repetição e só libera com evidência real');
  await delayed.close();
} finally { await browser.close(); }
