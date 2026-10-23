import test from 'node:test';
import assert from 'node:assert/strict';
import { searchYouTubeWeb, enrichYouTubeWeb, parseYouTubeSearchHtml, parseYouTubeWatchHtml } from '../core/youtube-web.js';

const settings = { resultsPerTerm: 8, captionedOnly: true };
const term = { query: 'solar energy', language: 'pt-BR' };
const id = 'xKxrkht7CpY';
const otherId = 'abc12345678';
const video = { id, title: 'Short title', description: 'Snippet', channel: 'Channel', foundBy: ['solar energy'] };
const html = (name, value) => `<html><script>window["${name}"] = ${JSON.stringify(value)};</script></html>`;
const response = (text, status = 200) => new Response(text, { status, headers: { 'Content-Type': 'text/html' } });
const legacy = (videoId = id, overrides = {}) => ({ videoRenderer: {
  videoId,
  title: { runs: [{ text: 'Solar "{energy}"' }] },
  ownerText: { runs: [{ text: 'TED-Ed' }] },
  detailedMetadataSnippets: [{ snippetText: { runs: [{ text: 'How ' }, { text: 'it works' }] } }],
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
  videoDetails: { videoId, title: 'Full title', shortDescription: 'Full description\nWith {braces} and "quotes".', author: 'TED-Ed', lengthSeconds: '299', thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, width: 480 }] } },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=' + videoId, languageCode: 'pt', kind: 'asr' }] } },
  microformat: { playerMicroformatRenderer: { publishDate: '2016-01-05', uploadDate: '2016-01-04', isUnlisted: false } },
  ...overrides
});

test('public search extracts real results, ignores ads, and accepts credentials and redirects', async () => {
  let requested;
  const results = await searchYouTubeWeb(term, { ...settings, resultsPerTerm: 1 }, async (url, options) => {
    requested = { url: new URL(url), options };
    return response(searchPage([{ adSlotRenderer: { videoRenderer: legacy(otherId).videoRenderer } }, legacy(), legacy()]));
  });
  assert.equal(requested.url.origin, 'https://www.youtube.com');
  assert.equal(requested.url.pathname, '/results');
  assert.equal(requested.url.searchParams.get('search_query'), 'solar energy');
  assert.equal(requested.url.searchParams.get('hl'), 'pt-BR');
  assert.equal(requested.url.searchParams.get('gl'), 'BR');
  assert.equal(requested.url.searchParams.get('sp'), 'EgQQASgB');
  assert.equal(requested.options.credentials, 'include');
  assert.equal(requested.options.redirect, 'follow');
  assert.deepEqual(results, [{ id, title: 'Solar "{energy}"', description: 'How it works', channel: 'TED-Ed', publishedAt: '', thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, foundBy: 'solar energy', duration: 'PT4M59S', captionAvailable: true }]);
});

test('search accepts modern lockups and Shorts without confusing playlists or external URLs', () => {
  const page = searchPage([
    { lockupViewModel: {
      contentId: otherId, contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
      metadata: { lockupMetadataViewModel: {
        title: { content: 'Modern video' },
        metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: {
          content: 'New channel',
          commandRuns: [{ onTap: { innertubeCommand: { browseEndpoint: { browseId: 'UC123' } } } }]
        } }] }] } }
      } },
      contentImage: { thumbnailViewModel: { image: { sources: [{ url: 'https://example.com/untrusted.jpg', width: 720 }] }, overlays: [{ thumbnailOverlayBadgeViewModel: { thumbnailBadges: [{ thumbnailBadgeViewModel: { text: '12:03' } }] } }] } }
    } },
    { lockupViewModel: { contentId: id, contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST' } },
    { shortsLockupViewModel: { onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: id } } }, overlayMetadata: { primaryText: { content: 'Science Short' } }, thumbnail: { sources: [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }] } } },
    legacy('invalid-id')
  ]);
  const results = parseYouTubeSearchHtml(page, term, { ...settings, captionedOnly: false });
  assert.deepEqual(results.map(v => ({ id: v.id, title: v.title, channel: v.channel, duration: v.duration, captionAvailable: v.captionAvailable })), [
    { id: otherId, title: 'Modern video', channel: 'New channel', duration: 'PT12M3S', captionAvailable: undefined },
    { id, title: 'Science Short', channel: '', duration: undefined, captionAvailable: undefined }
  ]);
  assert.equal(results[0].thumbnail, `https://i.ytimg.com/vi/${otherId}/mqdefault.jpg`);
});

test('player provides full description, automatic captions, and exact date without running HTML', () => {
  globalThis.__youtubeExecuted = false;
  const page = `<script>globalThis.__youtubeExecuted = true;</script>` + html('ytInitialPlayerResponse', player());
  const result = parseYouTubeWatchHtml(page, video);
  assert.equal(globalThis.__youtubeExecuted, false);
  delete globalThis.__youtubeExecuted;
  assert.equal(result.title, 'Full title');
  assert.equal(result.description, 'Full description\nWith {braces} and "quotes".');
  assert.equal(result.publishedAt, '2016-01-05T00:00:00.000Z');
  assert.equal(result.duration, 'PT4M59S');
  assert.equal(result.captionAvailable, true);
  assert.equal(result.playabilityStatus, 'OK');
  assert.equal(result.url, `https://www.youtube.com/watch?v=${id}`);
  assert.deepEqual(result.foundBy, ['solar energy']);
});

test('enrichment removes videos without captions or unavailable ones, and keeps descriptions without captions when allowed', async () => {
  const noCaptions = html('ytInitialPlayerResponse', player(id, { captions: undefined }));
  const unavailable = html('ytInitialPlayerResponse', player(otherId, { playabilityStatus: { status: 'UNPLAYABLE', reason: 'Video unavailable' }, videoDetails: undefined }));
  const fetchPage = async url => response(new URL(url).searchParams.get('v') === id ? noCaptions : unavailable);
  assert.deepEqual(await enrichYouTubeWeb([video, { ...video, id: otherId }], settings, fetchPage), []);
  const retained = await enrichYouTubeWeb([video], { ...settings, captionedOnly: false }, fetchPage);
  assert.equal(retained.length, 1);
  assert.equal(retained[0].captionAvailable, false);
});

test('partial YouTube failure keeps successes and exposes the block to the caller', async () => {
  const results = await enrichYouTubeWeb([video, { ...video, id: otherId }], settings, async url => {
    return response(new URL(url).searchParams.get('v') === id ? html('ytInitialPlayerResponse', player()) : '<html><title>Before you continue to YouTube</title><form action="https://consent.youtube.com/save"></form></html>');
  });
  assert.equal(results[0].description, 'Full description\nWith {braces} and "quotes".');
  assert.match(results[1].detailError, /consent/i);
  assert.equal(results[1].captionAvailable, undefined);
  assert.equal(results[1].playabilityStatus, 'UNKNOWN');
});

test('consent page, bot check, HTTP 429, and unknown layout fail explicitly', async () => {
  for (const body of ['<title>Before you continue to YouTube</title>', '<html><div>Our systems have detected unusual traffic</div></html>', html('ytInitialData', { arbitrary: {} })]) {
    await assert.rejects(searchYouTubeWeb(term, settings, async () => response(body)), /YouTube/i);
  }
  await assert.rejects(searchYouTubeWeb(term, settings, async () => response('Too many requests', 429)), /429/);
  assert.throws(() => parseYouTubeWatchHtml(html('ytInitialPlayerResponse', player(id, { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: "Sign in to confirm you're not a bot" } })), video), /blocked|bot/i);
});

test('search returns empty only when YouTube gives an empty section or a no-results message', () => {
  assert.deepEqual(parseYouTubeSearchHtml(searchPage([]), term, settings), []);
  assert.deepEqual(parseYouTubeSearchHtml(searchPage([{ messageRenderer: { text: { simpleText: 'No results found' } } }]), term, settings), []);
  assert.throws(() => parseYouTubeSearchHtml(searchPage([{ newUnknownRenderer: { value: 'changed schema' } }]), term, settings), /format|layout|could not parse/i);
});

test('safe JSON parse accepts usual assignments and rejects expressions, truncation, and excessive depth', () => {
  const raw = JSON.stringify({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [legacy()] } }] } } } } });
  for (const assignment of [`var ytInitialData = ${raw};`, `ytInitialData=${raw};`, `window['ytInitialData'] = ${raw};`, `ytInitialData = JSON.parse(${JSON.stringify(raw)});`]) {
    assert.equal(parseYouTubeSearchHtml(`<script>${assignment}</script>`, term, settings)[0].id, id);
  }
  assert.throws(() => parseYouTubeSearchHtml('<script>ytInitialData = (() => { return {} })();</script>', term, settings), /JSON|data/i);
  assert.throws(() => parseYouTubeSearchHtml('<script>ytInitialData = {"contents":{}</script>', term, settings), /JSON|data/i);
  const deep = '{"next":'.repeat(150) + '{}' + '}'.repeat(150);
  assert.throws(() => parseYouTubeSearchHtml(`<script>ytInitialData=${deep};</script>`, term, settings), /limit|depth/i);
});

test('player with another ID or without metadata does not confirm videos by accident', () => {
  assert.throws(() => parseYouTubeWatchHtml(html('ytInitialPlayerResponse', player(otherId)), video), /ID|identity/i);
  assert.throws(() => parseYouTubeWatchHtml(html('ytInitialPlayerResponse', { playabilityStatus: { status: 'OK' } }), video), /metadata|data/i);
  assert.throws(() => parseYouTubeWatchHtml(html('ytInitialPlayerResponse', player(id, { videoDetails: { videoId: id, title: 'Title only' } })), video), /description|metadata/i);
});

test('request refuses huge bodies before reading and also during streaming', async () => {
  const advertised = new Response('small', { headers: { 'Content-Length': '9000000' } });
  await assert.rejects(searchYouTubeWeb(term, settings, async () => advertised), /limit/i);
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8500000)); }, cancel() { cancelled = true; } });
  await assert.rejects(searchYouTubeWeb(term, settings, async () => new Response(stream)), /limit/i);
  assert.equal(cancelled, true);
});

test('enrichment limits concurrency and keeps order when responses arrive out of order', async () => {
  const ids = [id, otherId, 'def12345678', 'ghi12345678', 'jkl12345678'];
  let active = 0;
  let highest = 0;
  const result = await enrichYouTubeWeb(ids.map(id => ({ ...video, id })), settings, async (url, options) => {
    active++;
    highest = Math.max(highest, active);
    assert.equal(options.credentials, 'include');
    const current = new URL(url).searchParams.get('v');
    await new Promise(resolve => setTimeout(resolve, current === id ? 15 : 1));
    active--;
    return response(html('ytInitialPlayerResponse', player(current)));
  });
  assert.ok(highest <= 3, `received ${highest} concurrent requests`);
  assert.deepEqual(result.map(v => v.id), ids);
});

test('redirect to a safe YouTube domain or consent is accepted', async () => {
  const redirectedResponse = new Response(searchPage([legacy()]), { status: 200, headers: { 'Content-Type': 'text/html' } });
  Object.defineProperty(redirectedResponse, 'url', { value: 'https://youtube.com/results?search_query=energia+solar' });
  const results = await searchYouTubeWeb(term, { ...settings, resultsPerTerm: 1 }, async () => redirectedResponse);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, id);
});

test('redirect outside YouTube or Google is blocked for safety', async () => {
  const evilResponse = new Response(searchPage([legacy()]), { status: 200, headers: { 'Content-Type': 'text/html' } });
  Object.defineProperty(evilResponse, 'url', { value: 'https://evil-site.com/results' });
  await assert.rejects(searchYouTubeWeb(term, settings, async () => evilResponse), /redirect outside YouTube blocked/i);
});

test('cancellation stops before searching and propagates during enrichment', async () => {
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
