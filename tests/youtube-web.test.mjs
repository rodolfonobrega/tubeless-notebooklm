import test from 'node:test';
import assert from 'node:assert/strict';
import { searchYouTubeWeb, enrichYouTubeWeb, parseYouTubeSearchHtml, parseYouTubeWatchHtml } from '../core/youtube-web.js';

const settings = { resultsPerTerm: 8, captionedOnly: true };
const term = { query: 'energia solar', language: 'pt-BR' };
const id = 'xKxrkht7CpY';
const otherId = 'abc12345678';
const video = { id, title: 'Título curto', description: 'Trecho', channel: 'Canal', foundBy: ['energia solar'] };
const html = (name, value) => `<html><script>window["${name}"] = ${JSON.stringify(value)};</script></html>`;
const response = (text, status = 200) => new Response(text, { status, headers: { 'Content-Type': 'text/html' } });
const legacy = (videoId = id, overrides = {}) => ({ videoRenderer: {
  videoId,
  title: { runs: [{ text: 'Solar "{energia}"' }] },
  ownerText: { runs: [{ text: 'TED-Ed' }] },
  detailedMetadataSnippets: [{ snippetText: { runs: [{ text: 'Como ' }, { text: 'funciona' }] } }],
  publishedTimeText: { simpleText: '10y ago' },
  lengthText: { simpleText: '4:59' },
  thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, width: 320 }] },
  badges: [{ metadataBadgeRenderer: { label: 'CC', style: 'BADGE_STYLE_TYPE_MEDIA' } }],
  ...overrides
} });
const searchPage = contents => html('ytInitialData', { contents: { twoColumnSearchResultsRenderer: {
  primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents } }] } },
  secondaryContents: { videoRenderer: { videoId: 'related1234', title: { simpleText: 'Relacionado' } } }
} } });
const player = (videoId = id, overrides = {}) => ({
  playabilityStatus: { status: 'OK' },
  videoDetails: { videoId, title: 'Título completo', shortDescription: 'Descrição completa\nCom {chaves} e "aspas".', author: 'TED-Ed', lengthSeconds: '299', thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, width: 480 }] } },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=' + videoId, languageCode: 'pt', kind: 'asr' }] } },
  microformat: { playerMicroformatRenderer: { publishDate: '2016-01-05', uploadDate: '2016-01-04', isUnlisted: false } },
  ...overrides
});

test('busca pública extrai resultados reais, ignora publicidade e envia idioma sem cookies', async () => {
  let requested;
  const results = await searchYouTubeWeb(term, { ...settings, resultsPerTerm: 1 }, async (url, options) => {
    requested = { url: new URL(url), options };
    return response(searchPage([{ adSlotRenderer: { videoRenderer: legacy(otherId).videoRenderer } }, legacy(), legacy()]));
  });
  assert.equal(requested.url.origin, 'https://www.youtube.com');
  assert.equal(requested.url.pathname, '/results');
  assert.equal(requested.url.searchParams.get('search_query'), 'energia solar');
  assert.equal(requested.url.searchParams.get('hl'), 'pt-BR');
  assert.equal(requested.url.searchParams.get('gl'), 'BR');
  assert.equal(requested.url.searchParams.get('sp'), 'EgQQASgB');
  assert.equal(requested.options.credentials, 'omit');
  assert.equal(requested.options.redirect, 'error');
  assert.deepEqual(results, [{ id, title: 'Solar "{energia}"', description: 'Como funciona', channel: 'TED-Ed', publishedAt: '', thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, foundBy: 'energia solar', duration: 'PT4M59S', captionAvailable: true }]);
});

test('busca aceita lockup moderno e Shorts, sem confundir playlists ou buscar URLs externas', () => {
  const page = searchPage([
    { lockupViewModel: {
      contentId: otherId, contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
      metadata: { lockupMetadataViewModel: {
        title: { content: 'Vídeo moderno' },
        metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: {
          content: 'Canal novo',
          commandRuns: [{ onTap: { innertubeCommand: { browseEndpoint: { browseId: 'UC123' } } } }]
        } }] }] } }
      } },
      contentImage: { thumbnailViewModel: { image: { sources: [{ url: 'https://example.com/untrusted.jpg', width: 720 }] }, overlays: [{ thumbnailOverlayBadgeViewModel: { thumbnailBadges: [{ thumbnailBadgeViewModel: { text: '12:03' } }] } }] } }
    } },
    { lockupViewModel: { contentId: id, contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST' } },
    { shortsLockupViewModel: { onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: id } } }, overlayMetadata: { primaryText: { content: 'Short de ciência' } }, thumbnail: { sources: [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }] } } },
    legacy('invalid-id')
  ]);
  const results = parseYouTubeSearchHtml(page, term, { ...settings, captionedOnly: false });
  assert.deepEqual(results.map(v => ({ id: v.id, title: v.title, channel: v.channel, duration: v.duration, captionAvailable: v.captionAvailable })), [
    { id: otherId, title: 'Vídeo moderno', channel: 'Canal novo', duration: 'PT12M3S', captionAvailable: undefined },
    { id, title: 'Short de ciência', channel: '', duration: undefined, captionAvailable: undefined }
  ]);
  assert.equal(results[0].thumbnail, `https://i.ytimg.com/vi/${otherId}/mqdefault.jpg`);
});

test('player fornece descrição completa, legendas automáticas e data exata sem executar HTML', () => {
  globalThis.__youtubeExecuted = false;
  const page = `<script>globalThis.__youtubeExecuted = true;</script>` + html('ytInitialPlayerResponse', player());
  const result = parseYouTubeWatchHtml(page, video);
  assert.equal(globalThis.__youtubeExecuted, false);
  delete globalThis.__youtubeExecuted;
  assert.equal(result.title, 'Título completo');
  assert.equal(result.description, 'Descrição completa\nCom {chaves} e "aspas".');
  assert.equal(result.publishedAt, '2016-01-05T00:00:00.000Z');
  assert.equal(result.duration, 'PT4M59S');
  assert.equal(result.captionAvailable, true);
  assert.equal(result.playabilityStatus, 'OK');
  assert.equal(result.url, `https://www.youtube.com/watch?v=${id}`);
  assert.deepEqual(result.foundBy, ['energia solar']);
});

test('enriquecimento remove vídeos sem legendas ou indisponíveis e mantém descrição sem legenda quando permitido', async () => {
  const noCaptions = html('ytInitialPlayerResponse', player(id, { captions: undefined }));
  const unavailable = html('ytInitialPlayerResponse', player(otherId, { playabilityStatus: { status: 'UNPLAYABLE', reason: 'Video unavailable' }, videoDetails: undefined }));
  const fetchPage = async url => response(new URL(url).searchParams.get('v') === id ? noCaptions : unavailable);
  assert.deepEqual(await enrichYouTubeWeb([video, { ...video, id: otherId }], settings, fetchPage), []);
  const retained = await enrichYouTubeWeb([video], { ...settings, captionedOnly: false }, fetchPage);
  assert.equal(retained.length, 1);
  assert.equal(retained[0].captionAvailable, false);
});

test('falha parcial do YouTube mantém sucessos e expõe bloqueio para o chamador', async () => {
  const results = await enrichYouTubeWeb([video, { ...video, id: otherId }], settings, async url => {
    return response(new URL(url).searchParams.get('v') === id ? html('ytInitialPlayerResponse', player()) : '<html><title>Before you continue to YouTube</title><form action="https://consent.youtube.com/save"></form></html>');
  });
  assert.equal(results[0].description, 'Descrição completa\nCom {chaves} e "aspas".');
  assert.match(results[1].detailError, /consentimento/i);
  assert.equal(results[1].captionAvailable, undefined);
  assert.equal(results[1].playabilityStatus, 'UNKNOWN');
});

test('página de consentimento, robô, HTTP 429 e layout desconhecido falham explicitamente', async () => {
  for (const body of ['<title>Before you continue to YouTube</title>', '<html><div>Our systems have detected unusual traffic</div></html>', html('ytInitialData', { arbitrary: {} })]) {
    await assert.rejects(searchYouTubeWeb(term, settings, async () => response(body)), /YouTube/i);
  }
  await assert.rejects(searchYouTubeWeb(term, settings, async () => response('Too many requests', 429)), /429/);
  assert.throws(() => parseYouTubeWatchHtml(html('ytInitialPlayerResponse', player(id, { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: "Sign in to confirm you're not a bot" } })), video), /bloqueio|robô/i);
});

test('busca só devolve vazio quando o YouTube fornece seção vazia ou mensagem de nenhum resultado', () => {
  assert.deepEqual(parseYouTubeSearchHtml(searchPage([]), term, settings), []);
  assert.deepEqual(parseYouTubeSearchHtml(searchPage([{ messageRenderer: { text: { simpleText: 'Nenhum resultado encontrado' } } }]), term, settings), []);
  assert.throws(() => parseYouTubeSearchHtml(searchPage([{ newUnknownRenderer: { value: 'changed schema' } }]), term, settings), /formato|layout|interpretar/i);
});

test('JSON parse seguro aceita atribuições usuais e rejeita expressão, truncamento e profundidade excessiva', () => {
  const raw = JSON.stringify({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [legacy()] } }] } } } } });
  for (const assignment of [`var ytInitialData = ${raw};`, `ytInitialData=${raw};`, `window['ytInitialData'] = ${raw};`, `ytInitialData = JSON.parse(${JSON.stringify(raw)});`]) {
    assert.equal(parseYouTubeSearchHtml(`<script>${assignment}</script>`, term, settings)[0].id, id);
  }
  assert.throws(() => parseYouTubeSearchHtml('<script>ytInitialData = (() => { return {} })();</script>', term, settings), /JSON|dados/i);
  assert.throws(() => parseYouTubeSearchHtml('<script>ytInitialData = {"contents":{}</script>', term, settings), /JSON|dados/i);
  const deep = '{"next":'.repeat(150) + '{}' + '}'.repeat(150);
  assert.throws(() => parseYouTubeSearchHtml(`<script>ytInitialData=${deep};</script>`, term, settings), /limite|profundidade/i);
});

test('player com outro ID e player sem metadados não confirma vídeos por acidente', () => {
  assert.throws(() => parseYouTubeWatchHtml(html('ytInitialPlayerResponse', player(otherId)), video), /ID|identidade/i);
  assert.throws(() => parseYouTubeWatchHtml(html('ytInitialPlayerResponse', { playabilityStatus: { status: 'OK' } }), video), /metadados|dados/i);
  assert.throws(() => parseYouTubeWatchHtml(html('ytInitialPlayerResponse', player(id, { videoDetails: { videoId: id, title: 'Título apenas' } })), video), /descrição|metadados/i);
});

test('requisição recusa corpos enormes antes da leitura e também durante streaming', async () => {
  const advertised = new Response('small', { headers: { 'Content-Length': '9000000' } });
  await assert.rejects(searchYouTubeWeb(term, settings, async () => advertised), /limite|grande/i);
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8500000)); }, cancel() { cancelled = true; } });
  await assert.rejects(searchYouTubeWeb(term, settings, async () => new Response(stream)), /limite|grande/i);
  assert.equal(cancelled, true);
});

test('enriquecimento limita simultaneidade e preserva a ordem ao receber respostas fora de ordem', async () => {
  const ids = [id, otherId, 'def12345678', 'ghi12345678', 'jkl12345678'];
  let active = 0;
  let highest = 0;
  const result = await enrichYouTubeWeb(ids.map(id => ({ ...video, id })), settings, async (url, options) => {
    active++;
    highest = Math.max(highest, active);
    assert.equal(options.credentials, 'omit');
    const current = new URL(url).searchParams.get('v');
    await new Promise(resolve => setTimeout(resolve, current === id ? 15 : 1));
    active--;
    return response(html('ytInitialPlayerResponse', player(current)));
  });
  assert.ok(highest <= 3, `received ${highest} concurrent requests`);
  assert.deepEqual(result.map(v => v.id), ids);
});

test('cancelamento interrompe antes de buscar e é propagado durante enriquecimento', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(searchYouTubeWeb(term, settings, async () => { calls++; return response(searchPage([])); }, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 0);
  const during = new AbortController();
  await assert.rejects(enrichYouTubeWeb([video], settings, async (_url, options) => {
    during.abort();
    options.signal.throwIfAborted();
  }, during.signal), { name: 'AbortError' });
});
