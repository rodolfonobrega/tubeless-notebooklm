import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { normalizeSettings } from '../core/search.js';
import { sanitizeError } from '../core/connections.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SCOUT_PLAYWRIGHT_PATH || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = resolve(root, '.test-artifacts');
mkdirSync(artifacts, { recursive: true });
const profile = mkdtempSync(resolve(artifacts, 'browser-'));
const live = process.argv.includes('--live');
const secrets = [];
let context;
let panel;
let activeCheck = 'inicialização';
const samples = [
  { id: 'abc12345678', title: 'Solar intermediário', probability: 0.8 },
  { id: 'def12345678', title: 'Solar principal', probability: 0.97 },
  { id: 'ghi12345678', title: 'Tema distante', probability: 0.2 }
];
const extraSample = { id: 'jkl12345678', title: 'Solar ampliação', probability: 0.91 };
let continuationSearch = false;

function searchHtml() {
  const contents = (continuationSearch ? [samples[0], extraSample] : samples).map(video => ({ videoRenderer: { videoId: video.id, title: { simpleText: video.title }, ownerText: { simpleText: 'Canal de exemplo' }, descriptionSnippet: { simpleText: 'Informações sobre energia solar' } } }));
  return `<script>var ytInitialData = ${JSON.stringify({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents } }] } } } } })};</script>`;
}

function watchHtml(video) {
  return `<script>var ytInitialPlayerResponse = ${JSON.stringify({ playabilityStatus: { status: 'OK' }, videoDetails: { videoId: video.id, title: video.title, shortDescription: 'Explicação sobre painéis solares residenciais.', author: 'Canal de exemplo', lengthSeconds: '400' }, microformat: { playerMicroformatRenderer: { publishDate: '2026-01-01' } }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'pt', baseUrl: 'https://www.youtube.com/api/timedtext' }] } } })};</script>`;
}

const notebookHtml = `<!doctype html><meta charset="utf-8"><title>Notebook de teste</title><style>body{padding:20px;font:16px sans-serif}button,input,textarea{padding:10px;margin:8px}</style><button id="add">Add sources</button><div id="modal"></div><div id="sources"></div><script>
  window.submissions=0;
  const titles = ${JSON.stringify(Object.fromEntries([...samples, extraSample].map(video => [video.id, video.title])))};
  document.querySelector('#add').onclick=()=>{
    const modal=document.querySelector('#modal');modal.setAttribute('role','dialog');modal.innerHTML='<button id="choice">YouTube</button>';
    document.querySelector('#choice').onclick=()=>{
      modal.innerHTML='<textarea placeholder="Paste URLs"></textarea><button id="insert">Insert</button>';
      document.querySelector('#insert').onclick=()=>{
        window.submissions++;
        const urls=modal.querySelector('textarea').value.trim().split(/\\s+/);
        for(const url of urls){const id=new URL(url).searchParams.get('v');
        const source=document.createElement('div');source.className='source-item';
        const link=document.createElement('a');link.href=url;link.textContent=titles[id];source.append(link);document.querySelector('#sources').append(source);}
        modal.replaceChildren();modal.removeAttribute('role');
      };
    };
  };
</script>`;

function modernNotebookHtml(submitLabel) {
  return notebookHtml
    .replace('<button id="insert">Insert</button>', `<button id="insert" disabled><mat-icon aria-hidden="true">add</mat-icon><span>${submitLabel}</span></button>`)
    .replace("document.querySelector('#insert').onclick=()=>{", "document.querySelector('textarea').addEventListener('input',()=>setTimeout(()=>document.querySelector('#insert').disabled=false,300)); document.querySelector('#insert').onclick=()=>{");
}

async function check(name, fn) {
  activeCheck = name;
  await fn();
  console.log(`OK: ${name}`);
}

async function store(settings, extra = {}) {
  await panel.evaluate(async value => chrome.storage.local.set(value), { settings, ...extra });
  await panel.reload();
  await panel.locator('#settingsToggle').click();
}

try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.SCOUT_CHROME_PATH ? { executablePath: process.env.SCOUT_CHROME_PATH } : {}),
    headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
    viewport: { width: 400, height: 900 }
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: root });
  let catalogOffline = true;
  await context.route('https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json', route => {
    assert.equal(route.request().headers().authorization, undefined);
    if (catalogOffline) return route.abort();
    return route.fulfill({ json: {
      'gpt-5-mini': { litellm_provider: 'openai', mode: 'chat' },
      'groq/openai/gpt-oss-120b': { litellm_provider: 'groq', mode: 'chat' },
      'openrouter/google/gemini-2.5-flash': { litellm_provider: 'openrouter', mode: 'chat' },
      'openrouter/typesafe/jev-1.13': { litellm_provider: 'openrouter', mode: 'evaluation' },
      'typesafe/jev-latest': { litellm_provider: 'typesafe', mode: 'evaluation' },
      'typesafe/jev-preview': { litellm_provider: 'typesafe', mode: 'evaluation' }
    } });
  });
  panel = await context.newPage();
  const pageErrors = [];
  panel.on('pageerror', error => pageErrors.push(error.message));
  await panel.goto(`chrome-extension://${id}/panel.html`);
  await check('idiomas rápidos mantêm pelo menos um idioma e persistem a seleção', async () => {
    const language = code => panel.locator(`#languageOptions input[value="${code}"]`);
    await language('pt').waitFor({ timeout: 3000 });
    assert.equal(await language('pt').isChecked(), true);
    assert.equal(await language('en').isChecked(), true);
    await language('pt').uncheck();
    assert.equal(await language('en').isDisabled(), true);
    await language('es').check();
    await panel.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.languages === 'en,es');
    assert.equal(await panel.locator('#languages').inputValue(), 'en,es');
    await panel.reload();
    assert.equal(await language('en').isChecked(), true);
    assert.equal(await language('es').isChecked(), true);
    assert.equal(await language('pt').isChecked(), false);
    await panel.locator('#settingsToggle').click();
    await panel.locator('#llmPreset').selectOption('openrouter');
    await panel.locator('#languages').fill('pt-br,en,es,fr,de');
    await panel.locator('#saveSettings').click();
    await language('pt-br').waitFor();
    assert.equal(await language('pt-br').isChecked(), true);
    assert.equal(await language('pt').isDisabled(), true);
    await language('fr').uncheck();
    assert.equal(await language('pt').isEnabled(), true);
    await panel.screenshot({ path: resolve(artifacts, 'quick-languages.png') });
  });
  await panel.locator('#settingsToggle').click();
  await check('catálogo por provedor e nomes personalizados independentes', async () => {
    await panel.waitForFunction(() => document.querySelectorAll('#llmModelChoice option').length > 2);
    await panel.locator('#llmPreset').selectOption('groq');
    assert.ok(await panel.locator('#llmModelChoice option[value="openai/gpt-oss-120b"]').count());
    assert.equal(await panel.locator('#llmModelChoice option[value="gpt-5-mini"]').count(), 0);
    await panel.locator('#llmModelChoice').selectOption('openai/gpt-oss-120b');
    assert.equal(await panel.locator('#expansionModel').inputValue(), 'openai/gpt-oss-120b');
    await panel.locator('#llmModelChoice').selectOption('');
    await panel.locator('#expansionModel').fill('meu-modelo-customizado');
    assert.equal(await panel.locator('#llmModelChoice').inputValue(), '');
    catalogOffline = false;
    await panel.locator('#refreshModels').click();
    await panel.waitForFunction(() => !document.querySelector('#refreshModels').disabled);
    assert.equal(await panel.locator('#expansionModel').inputValue(), 'meu-modelo-customizado');
    catalogOffline = true;
    await panel.locator('#refreshModels').click();
    await panel.waitForFunction(() => document.querySelector('#catalogStatus').textContent.includes('lista salva'));
    assert.equal(await panel.locator('#expansionModel').inputValue(), 'meu-modelo-customizado');
    assert.ok(await panel.locator('#evaluationModelChoice option[value="typesafe/jev-1.13"]').count());
    assert.equal(await panel.locator('#evaluationModelChoice option[value="google/gemini-2.5-flash"]').count(), 0);
    await panel.locator('#evaluationPreset').selectOption('typesafe');
    assert.ok(await panel.locator('#evaluationModelChoice option[value="jev-latest"]').count());
    await panel.locator('#evaluationModelChoice').selectOption('jev-preview');
    assert.equal(await panel.locator('#jevModel').inputValue(), 'jev-preview');
    assert.equal(await panel.locator('#expansionModel').inputValue(), 'meu-modelo-customizado');
    await panel.locator('#evaluationPreset').selectOption('groq');
    assert.equal(await panel.locator('#evaluationProtocol').inputValue(), 'chat');
    assert.ok(await panel.locator('#evaluationModelChoice option[value="openai/gpt-oss-120b"]').count());
    await panel.locator('#llmBaseUrl').fill('https://custom.example/v1');
    assert.equal(await panel.locator('#llmModelChoice option').count(), 1);
    assert.equal(await panel.locator('#expansionModel').inputValue(), 'meu-modelo-customizado');
    await panel.locator('#llmPreset').selectOption('openai');
    await panel.locator('#evaluationPreset').selectOption('openrouter');
  });
  await panel.screenshot({ path: resolve(artifacts, 'settings.png') });
  await check('configuração, presets e restauração segura de URL', async () => {
    assert.equal(await panel.locator('#llmBaseUrl').inputValue(), 'https://api.openai.com/v1');
    await panel.locator('#llmPreset').selectOption('groq');
    assert.equal(await panel.locator('#llmBaseUrl').inputValue(), 'https://api.groq.com/openai/v1');
    await panel.locator('#llmApiKey').fill('fake-generator-key');
    await panel.locator('#resetLlmBase').click();
    assert.equal(await panel.locator('#llmApiKey').inputValue(), '');
    assert.equal(await panel.locator('#expansionModel').inputValue(), 'gpt-5-mini');
    await panel.locator('#evaluationPreset').selectOption('typesafe');
    assert.equal(await panel.locator('#evaluationProtocol').inputValue(), 'systemone');
    await panel.locator('#evaluationBaseUrl').fill('https://custom.example');
    await panel.locator('#evaluationApiKey').fill('fake-evaluation-key');
    await panel.locator('#resetEvaluationBase').click();
    assert.equal(await panel.locator('#evaluationBaseUrl').inputValue(), 'https://api.typesafe.ai');
    assert.equal(await panel.locator('#evaluationApiKey').inputValue(), '');
    assert.equal(await panel.locator('#youtubeKeyField').isVisible(), false);
    await panel.locator('#youtubeMode').selectOption('api');
    assert.equal(await panel.locator('#youtubeKeyField').isVisible(), true);
    await panel.locator('#youtubeMode').selectOption('web');
  });

  let slow = false;
  let locatorCalls = 0;
  const discoveryLanguages = [];
  const youtubeLanguages = [];
  await context.route('https://openrouter.ai/api/**', async route => {
    const body = route.request().postDataJSON();
    if (slow) await new Promise(resolve => setTimeout(resolve, 1500));
    if (body.questions?.target) {
      locatorCalls++;
      assert.equal(route.request().headers().authorization, 'Bearer fake-evaluator');
      const target = body.state.candidates.find(candidate => candidate.label === 'Finalizar conexão');
      return route.fulfill({ json: { answers: { target: { type: 'choice', choice: target?.id || 'NONE', confidence: 0.99 } } } });
    }
    const languages = body.messages?.[0]?.content.match(/para cada idioma: ([^.]+)\./)?.[1]?.split(', ') || ['pt', 'en'];
    if (body.messages?.[0]?.content.startsWith('Tema de pesquisa no YouTube:')) discoveryLanguages.push(languages);
    const data = route.request().url().endsWith('/decisions')
      ? { answers: { relevant: { type: 'noul', noul: [...samples, extraSample].find(video => video.title === body.state.video.title)?.probability ?? 0.9 } } }
      : { choices: [{ message: { content: JSON.stringify(Object.fromEntries(languages.map(language => [language, [continuationSearch ? `solar installation ${language}` : `solar energy ${language}`]]))) } }] };
    await route.fulfill({ json: data }).catch(() => {});
  });
  await context.route('https://www.youtube.com/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/results') youtubeLanguages.push(url.searchParams.get('hl'));
    return route.fulfill({ contentType: 'text/html', body: url.pathname === '/results' ? searchHtml() : watchHtml([...samples, extraSample].find(video => video.id === url.searchParams.get('v'))) });
  });
  await context.route('https://i.ytimg.com/**', route => route.abort());
  const settings = normalizeSettings({ llmBaseUrl: 'https://openrouter.ai/api/v1', llmApiKey: 'fake-generator', expansionModel: 'google/gemini-2.5-flash', evaluationApiKey: 'fake-evaluator', termsPerLanguage: 1 });
  await store(settings);
  await check('limite de 250 vídeos e paralelismo são configuráveis e persistidos', async () => {
    assert.equal(await panel.locator('#evaluationConcurrency').inputValue(), '8');
    await panel.locator('#maxEvaluations').fill('251');
    assert.equal(await panel.locator('#maxEvaluations').evaluate(input => input.validity.valid), false);
    await panel.locator('#maxEvaluations').fill('250');
    await panel.locator('#evaluationConcurrency').fill('17');
    assert.equal(await panel.locator('#evaluationConcurrency').evaluate(input => input.validity.valid), false);
    await panel.locator('#evaluationConcurrency').fill('16');
    await panel.locator('#saveSettings').click();
    await panel.waitForFunction(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      return settings.maxEvaluations === 250 && settings.evaluationConcurrency === 16;
    });
    await panel.reload();
    await panel.locator('#settingsToggle').click();
    assert.equal(await panel.locator('#maxEvaluations').inputValue(), '250');
    assert.equal(await panel.locator('#evaluationConcurrency').inputValue(), '16');
    await panel.locator('#maxEvaluations').scrollIntoViewIfNeeded();
    await panel.screenshot({ path: resolve(artifacts, 'evaluation-settings.png') });
  });
  await check('teste das conexões pelo painel sem salvar valores novos', async () => {
    await panel.locator('#llmApiKey').fill('fake-unsaved-generator');
    await panel.locator('#testConnections').click();
    await panel.waitForFunction(() => document.querySelectorAll('.connection-result.ok').length === 3);
    assert.equal(await panel.evaluate(async () => (await chrome.storage.local.get('settings')).settings.llmApiKey), 'fake-generator');
    await panel.screenshot({ path: resolve(artifacts, 'connections-ok.png') });
    await panel.locator('#llmApiKey').fill('fake-generator');
    assert.equal(await panel.locator('#connectionResults').isVisible(), false);
  });
  await check('cancelamento do teste reativa os campos', async () => {
    slow = true;
    await panel.locator('#testConnections').click();
    await panel.waitForFunction(() => document.querySelectorAll('.connection-result.testing').length > 0);
    await panel.locator('#testConnections').click();
    await panel.waitForFunction(() => document.querySelector('#testConnections').textContent === 'Testar conexões');
    assert.equal(await panel.locator('#llmBaseUrl').isEnabled(), true);
    assert.equal(await panel.locator('.connection-result.testing').count(), 0);
    slow = false;
  });
  await check('busca e restauração mantêm vídeos em ordem de relevância', async () => {
    await panel.locator('#saveSettings').click();
    await panel.locator('#languageOptions input[value="es"]').check();
    await panel.locator('#languageOptions input[value="pt"]').uncheck();
    await panel.locator('#languageOptions input[value="en"]').uncheck();
    youtubeLanguages.length = 0;
    await panel.locator('#topic').fill('energia solar');
    await panel.locator('#searchButton').click();
    await panel.waitForFunction(() => document.querySelectorAll('.video-card').length === 2);
    assert.deepEqual(discoveryLanguages.at(-1), ['es']);
    assert.deepEqual([...new Set(youtubeLanguages)], ['es']);
    assert.deepEqual(await panel.locator('.video-info h3').allTextContents(), ['Solar principal', 'Solar intermediário']);
    assert.equal(await panel.locator('.select-video:checked').count(), 2);
    await panel.bringToFront();
    await panel.locator('#copyLinks').click();
    await panel.waitForFunction(() => document.querySelector('#messageBox').textContent.includes('2 link(s) copiado(s)'));
    assert.equal((await panel.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), 'https://www.youtube.com/watch?v=def12345678\nhttps://www.youtube.com/watch?v=abc12345678');
    await panel.locator('#deselectAll').click();
    assert.equal(await panel.locator('.select-video:checked').count(), 0);
    assert.equal(await panel.locator('#copyLinks').isDisabled(), true);
    await panel.locator('[data-filter="all"]').click();
    assert.deepEqual(await panel.locator('.video-info h3').allTextContents(), ['Solar principal', 'Solar intermediário', 'Tema distante']);
    assert.equal(await panel.locator('.select-video').last().isDisabled(), true);
    await panel.evaluate(async () => {
      const { lastSearch } = await chrome.storage.local.get('lastSearch');
      lastSearch.videos.reverse();
      await chrome.storage.local.set({ lastSearch });
    });
    await panel.reload();
    await panel.waitForFunction(() => document.querySelectorAll('.video-card').length === 2);
    assert.deepEqual(await panel.locator('.video-info h3').allTextContents(), ['Solar principal', 'Solar intermediário']);
    assert.equal(await panel.locator('.select-video:checked').count(), 0);
    await panel.screenshot({ path: resolve(artifacts, 'ranked-results.png') });
  });
  await check('continuar buscando preserva desmarcações e seleciona novos relevantes', async () => {
    continuationSearch = true;
    await panel.locator('#languageOptions input[value="en"]').check();
    await panel.locator('#languageOptions input[value="es"]').uncheck();
    youtubeLanguages.length = 0;
    await panel.locator('#continueSearch').click();
    await panel.waitForFunction(() => document.querySelectorAll('.video-card').length === 3);
    assert.deepEqual(discoveryLanguages.at(-1), ['en']);
    assert.deepEqual([...new Set(youtubeLanguages)], ['en']);
    assert.deepEqual(await panel.locator('.video-info h3').allTextContents(), ['Solar principal', 'Solar ampliação', 'Solar intermediário']);
    assert.equal(await panel.locator('.select-video:checked').count(), 1);
    assert.equal(await panel.locator('.select-video').nth(1).isChecked(), true);
    await panel.locator('#continueSearch').click();
    await panel.waitForFunction(() => document.querySelector('#messageBox').textContent.includes('não gerou termos novos'));
    assert.equal(await panel.locator('.video-card').count(), 3);
    assert.equal(await panel.locator('.select-video:checked').count(), 1);
    await panel.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const lastCard = await panel.locator('.video-card').last().boundingBox();
    const dock = await panel.locator('#importDock').boundingBox();
    assert.ok(lastCard.y + lastCard.height <= dock.y, 'Último resultado precisa ficar acessível acima da seleção fixa.');
    await panel.screenshot({ path: resolve(artifacts, 'continued-results.png') });
  });
  await check('sem notebook aberto exibe aviso e não abre destino automaticamente', async () => {
    const home = await context.newPage();
    await context.route('https://notebook.google.com/', route => route.fulfill({ contentType: 'text/html', body: '<h1>Seus notebooks</h1>' }));
    await home.goto('https://notebook.google.com/');
    await panel.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      settings.notebookUrl = 'https://notebook.google.com/notebook/configured123';
      await chrome.storage.local.set({ settings });
    });
    await panel.reload();
    await panel.waitForFunction(() => document.querySelector('#selectedCount').textContent === '1');
    assert.equal(await panel.locator('#notebookNotice').isVisible(), true);
    const before = await panel.evaluate(async () => (await chrome.tabs.query({})).length);
    await panel.locator('#importButton').click();
    await panel.waitForFunction(() => document.querySelector('#messageBox').textContent.includes('Nenhum notebook do NotebookLM está aberto'));
    assert.equal(await panel.evaluate(async () => (await chrome.tabs.query({})).length), before);
    assert.equal(await panel.evaluate(async () => (await chrome.storage.local.get('importQueue')).importQueue), undefined);
    await panel.screenshot({ path: resolve(artifacts, 'no-notebook.png') });
    await home.close();
  });
  await check('importação em lote completa três fontes em um único envio', async () => {
    await context.route('https://notebook.google.com/notebook/fixture123', route => route.fulfill({ contentType: 'text/html', body: modernNotebookHtml('Inserir') }));
    const notebook = await context.newPage();
    await notebook.goto('https://notebook.google.com/notebook/fixture123');
    await panel.locator('#selectAll').click();
    await panel.locator('#importButton').click();
    await panel.waitForFunction(() => document.querySelector('#messageBox').textContent.includes('3 fonte(s) confirmada(s)'), null, { timeout: 15000 });
    assert.equal(await notebook.locator('.source-item').count(), 3);
    assert.equal(await notebook.evaluate(() => window.submissions), 1);
    assert.equal(await panel.evaluate(async () => (await chrome.storage.local.get('importQueue')).importQueue), undefined);
    await notebook.close();
  });
  await check('painel revisa lote parcial e retoma somente links não confirmados', async () => {
    await context.route('https://notebook.google.com/notebook/partial123', route => route.fulfill({ contentType: 'text/html', body: modernNotebookHtml('Inserir') }));
    const notebook = await context.newPage();
    await notebook.goto('https://notebook.google.com/notebook/partial123');
    await notebook.evaluate(() => {
      window.partialHandler = event => {
        if (!event.target.closest('#insert')) return;
        event.preventDefault(); event.stopImmediatePropagation(); window.submissions++;
        const url = document.querySelector('#modal textarea').value.trim().split(/\s+/)[0];
        const source = document.createElement('div'); source.className = 'source-item';
        const link = document.createElement('a'); link.href = url; link.textContent = 'Fonte parcial'; source.append(link); document.querySelector('#sources').append(source);
        const alert = document.createElement('div'); alert.setAttribute('role', 'alert'); alert.textContent = 'Erro ao adicionar algumas fontes'; document.body.append(alert);
        const modal = document.querySelector('#modal'); modal.replaceChildren(); modal.removeAttribute('role');
        document.removeEventListener('click', window.partialHandler, true);
      };
      document.addEventListener('click', window.partialHandler, true);
    });
    await panel.locator('#selectAll').click();
    await panel.locator('#importButton').click();
    await panel.waitForFunction(() => document.querySelector('#messageBox').textContent.includes('2 item(ns) do lote exigem revisão'));
    const partial = await panel.evaluate(async () => (await chrome.storage.local.get('importQueue')).importQueue);
    assert.equal(partial.completed.length, 1);
    assert.equal(partial.failures.length, 2);
    assert.equal(await panel.locator('#pendingResume').isDisabled(), true);
    assert.equal(await panel.locator('#importButton').isDisabled(), true);
    assert.ok((await panel.locator('#pendingDetail').textContent()).includes('Fonte a revisar:'));
    assert.ok((await panel.locator('#pendingDetail').textContent()).includes('Solar ampliação'));
    await panel.locator('#pendingRetry').click();
    await panel.waitForFunction(() => document.querySelector('#pendingDetail').textContent.includes('1 item(ns) aguardando revisão'));
    await panel.locator('#pendingRetry').click();
    await panel.waitForFunction(() => document.querySelector('#pendingRetry').classList.contains('hidden'));
    await panel.locator('#pendingResume').click();
    await panel.waitForFunction(() => document.querySelector('#messageBox').textContent.includes('3 fonte(s) confirmada(s) no NotebookLM'));
    assert.equal(await notebook.locator('.source-item').count(), 3);
    assert.equal(await notebook.evaluate(() => window.submissions), 2);
    const urls = await notebook.locator('.source-item a').evaluateAll(links => links.map(link => link.href));
    assert.equal(new Set(urls).size, 3);
    assert.equal(await panel.evaluate(async () => (await chrome.storage.local.get('importQueue')).importQueue), undefined);
    await notebook.close();
  });
  await check('fechar painel durante envio mantém revisão obrigatória após recarregar notebook', async () => {
    await context.route('https://notebook.google.com/notebook/reload123', route => route.fulfill({ contentType: 'text/html', body: modernNotebookHtml('Inserir') }));
    const notebook = await context.newPage();
    await notebook.goto('https://notebook.google.com/notebook/reload123');
    await notebook.evaluate(() => {
      document.addEventListener('click', event => {
        if (!event.target.closest('#insert')) return;
        event.preventDefault(); event.stopImmediatePropagation(); window.submissions++;
        const urls = document.querySelector('#modal textarea').value.trim().split(/\s+/);
        setTimeout(() => {
          for (const url of urls) {
            const source = document.createElement('div'); source.className = 'source-item';
            const link = document.createElement('a'); link.href = url; link.textContent = 'Fonte adicionada'; source.append(link); document.querySelector('#sources').append(source);
          }
          const modal = document.querySelector('#modal'); modal.replaceChildren(); modal.removeAttribute('role');
        }, 2000);
      }, true);
    });
    await panel.locator('#selectAll').click();
    await panel.locator('#importButton').click();
    await notebook.waitForFunction(() => window.submissions === 1);
    await panel.reload();
    await notebook.waitForFunction(() => document.querySelectorAll('.source-item').length === 3);
    const pending = await panel.evaluate(async () => (await chrome.storage.local.get('importQueue')).importQueue);
    assert.equal(pending.failures.length, 3);
    assert.ok(pending.failures.every(item => item.status === 'uncertain'));
    await notebook.reload();
    await notebook.evaluate(ids => {
      for (const id of ids) {
        const source = document.createElement('div'); source.className = 'source-item'; source.textContent = `Fonte existente ${id}`; document.querySelector('#sources').append(source);
      }
    }, pending.ids);
    assert.equal(await panel.locator('#pendingResume').isDisabled(), true);
    assert.equal(await panel.locator('#importButton').isDisabled(), true);
    await panel.locator('#importButton').evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await panel.waitForFunction(() => document.querySelector('#messageBox').textContent.includes('Revise as fontes sem confirmação'));
    assert.equal(await notebook.evaluate(() => window.submissions), 0);
    for (let remaining = 2; remaining >= 0; remaining--) {
      await panel.locator('#pendingConfirm').click();
      await panel.waitForFunction(async expected => (await chrome.storage.local.get('importQueue')).importQueue.failures.length === expected, remaining);
    }
    await panel.locator('#pendingResume').click();
    await panel.waitForFunction(() => document.querySelector('#messageBox').textContent.includes('3 fonte(s) confirmada(s) no NotebookLM'));
    assert.equal(await notebook.evaluate(() => window.submissions), 0);
    await notebook.close();
  });
  await check('localizador dinâmico passa pelo worker e reutiliza controle salvo', async () => {
    await context.route('https://notebook.google.com/notebook/dynamic123', route => route.fulfill({ contentType: 'text/html', body: modernNotebookHtml('Finalizar conexão') }));
    const notebook = await context.newPage();
    await notebook.goto('https://notebook.google.com/notebook/dynamic123');
    await panel.locator('#selectAll').click();
    await panel.locator('#importButton').click();
    await panel.waitForFunction(() => document.querySelector('#messageBox').textContent.includes('3 fonte(s) confirmada(s)'), null, { timeout: 30000 });
    assert.equal(await notebook.locator('.source-item').count(), 3);
    assert.equal(await notebook.evaluate(() => window.submissions), 1);
    assert.equal(locatorCalls, 1);
    const cache = await panel.evaluate(async () => (await chrome.storage.local.get('notebookLocatorCache')).notebookLocatorCache);
    assert.ok(Object.values(cache.scopes).some(scope => scope.entries.submit.label === 'Finalizar conexão'));
    await notebook.close();
  });
  await check('fila não abre automaticamente um destino fechado mesmo com outro notebook aberto', async () => {
    await context.route('https://notebook.google.com/notebook/other123', route => route.fulfill({ contentType: 'text/html', body: modernNotebookHtml('Inserir') }));
    const other = await context.newPage();
    await other.goto('https://notebook.google.com/notebook/other123');
    await panel.evaluate(async () => {
      const { lastSearch } = await chrome.storage.local.get('lastSearch');
      const id = lastSearch.videos.find(video => video.status === 'approved').id;
      await chrome.storage.local.set({ importQueue: { topic: lastSearch.topic, ids: [id], completed: [], failures: [], notebookUrl: 'https://notebook.google.com/notebook/closed123' }, selectedVideoIds: [id] });
    });
    await panel.reload();
    await panel.waitForFunction(() => !document.querySelector('#pendingNotice').classList.contains('hidden'));
    const before = await panel.evaluate(async () => (await chrome.tabs.query({})).length);
    await panel.locator('#pendingResume').click();
    await panel.waitForFunction(() => document.querySelector('#messageBox').textContent.includes('O notebook de destino não está aberto'));
    assert.equal(await panel.evaluate(async () => (await chrome.tabs.query({})).length), before);
    assert.equal(await other.evaluate(() => window.submissions), 0);
    assert.equal(await panel.locator('#notebookNotice').isVisible(), true);
    await panel.locator('#pendingDiscard').click();
    await other.close();
  });
  await check('troca de notebook durante preparação bloqueia o envio ao destino errado', async () => {
    await context.route('https://notebook.google.com/notebook/raceA', route => route.fulfill({ contentType: 'text/html', body: modernNotebookHtml('Inserir') }));
    await context.route('https://notebook.google.com/notebook/raceB', route => route.fulfill({ contentType: 'text/html', body: modernNotebookHtml('Inserir') }));
    const notebook = await context.newPage();
    await notebook.goto('https://notebook.google.com/notebook/raceA');
    await panel.locator('#selectAll').click();
    await panel.waitForFunction(() => document.querySelector('#notebookTabs').selectedOptions[0]?.dataset.notebookUrl?.endsWith('/raceA'));
    await panel.locator('#importButton').click();
    await notebook.goto('https://notebook.google.com/notebook/raceB');
    await panel.waitForFunction(() => document.querySelector('#messageBox').textContent.includes('O notebook da aba mudou'));
    assert.equal(await notebook.evaluate(() => window.submissions), 0);
    assert.equal(await panel.evaluate(async () => (await chrome.storage.local.get('importQueue')).importQueue), undefined);
    await notebook.close();
  });
  assert.deepEqual(pageErrors, []);

  if (process.argv.includes('--catalog-live')) {
    await context.unroute('https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json');
    await panel.locator('#settingsToggle').click();
    await check('catálogo LiteLLM real baixado no contexto da extensão', async () => {
      const previousModel = await panel.locator('#expansionModel').inputValue();
      await panel.locator('#refreshModels').click();
      await panel.waitForFunction(() => document.querySelector('#catalogStatus').textContent === 'Lista atualizada.', null, { timeout: 20000 });
      const counts = await panel.evaluate(async () => {
        const { modelCatalog } = await chrome.storage.local.get('modelCatalog');
        return Object.fromEntries(Object.entries(modelCatalog.providers).map(([provider, rows]) => [provider, rows.length]));
      });
      assert.ok(counts.openrouter > 100);
      assert.ok(counts.groq > 1);
      assert.equal(await panel.locator('#expansionModel').inputValue(), previousModel);
      console.log(`Modelos: ${JSON.stringify(counts)}`);
      await panel.screenshot({ path: resolve(artifacts, 'models-live.png') });
    });
    await panel.locator('#settingsBack').click();
  }

  if (live) {
    await context.unrouteAll({ behavior: 'wait' });
    loadEnvFile(resolve(root, '.env'));
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('O teste ao vivo no Chrome precisa de OPENROUTER_API_KEY no .env.');
    secrets.push(key);
    await store(normalizeSettings({ llmBaseUrl: 'https://openrouter.ai/api/v1', llmApiKey: key, expansionModel: 'google/gemini-2.5-flash', evaluationApiKey: key, termsPerLanguage: 1, resultsPerTerm: 2, maxEvaluations: 2 }));
    await check('chamadas reais de geração, avaliação e YouTube no contexto da extensão', async () => {
      await panel.locator('#testConnections').click();
      await panel.waitForFunction(() => document.querySelectorAll('.connection-result.ok, .connection-result.error').length === 3, null, { timeout: 75000 });
      const messages = await panel.locator('.connection-result').allTextContents();
      console.log(messages.map(message => sanitizeError(message, secrets)).join('\n'));
      assert.equal(await panel.locator('.connection-result.error').count(), 0);
      await panel.screenshot({ path: resolve(artifacts, 'live-connections.png') });
    });
  }
  console.log(`Chrome: ${context.browser().version()}. Capturas em .test-artifacts/.`);
} catch (error) {
  console.error(`Etapa: ${activeCheck}`);
  if (panel && !panel.isClosed()) console.error(await panel.evaluate(() => ({ catalogStatus: document.querySelector('#catalogStatus')?.textContent, models: document.querySelectorAll('#llmModelChoice option').length, message: document.querySelector('#messageBox')?.textContent, importProgress: document.querySelector('#importProgress')?.textContent, notebookTarget: document.querySelector('#notebookTabs')?.value })).catch(() => 'Painel indisponível'));
  if (panel && !panel.isClosed() && activeCheck.includes('catálogo')) console.error(await panel.evaluate(async () => {
    const { ModelCatalog } = await import('./core/models.js');
    try { return { catalogProviders: Object.keys((await new ModelCatalog().load()).providers) }; }
    catch (error) { return { catalogError: error.message }; }
  }).catch(() => 'Diagnóstico indisponível'));
  console.error(sanitizeError(error.message, secrets));
  process.exitCode = 1;
} finally {
  if (panel && !panel.isClosed()) await panel.evaluate(() => chrome.storage.local.clear()).catch(() => {});
  if (context) await context.close();
  // Delete only the temporary profile created for this test, inside the artifact directory.
  const absoluteProfile = resolve(profile);
  if (absoluteProfile.startsWith(`${artifacts}${sep}`) && absoluteProfile !== artifacts) rmSync(absoluteProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
