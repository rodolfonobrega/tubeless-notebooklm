import { videoUrl } from './search.js';

const MAX_HTML_BYTES = 8 * 1024 * 1024;
const MAX_JSON_CHARS = 4 * 1024 * 1024;
const MAX_DEPTH = 128;
const MAX_NODES = 100000;
const WATCH_CONCURRENCY = 3;
const VALID_ID = /^[a-zA-Z0-9_-]{11}$/;
const BLOCK_MESSAGE = /not a bot|unusual traffic|automated queries|confirm.*robot|confirme.*rob[oô]|confirma.*robot|try again later|tente novamente mais tarde/i;
const fail = message => new Error(`YouTube público: ${message}`);

function checkPage(html) {
  if (typeof html !== 'string' || !html.trim()) throw fail('página vazia; não foi possível ler os dados');
  if (html.length > MAX_HTML_BYTES) throw fail('a página ultrapassou o limite de tamanho');
  if (/<title[^>]*>\s*(?:Before you continue|Antes de continuar)|<form\b[^>]*action\s*=\s*["']https:\/\/consent\.(?:youtube|google)\.com|consentBumpV2Renderer/i.test(html)) {
    throw fail('o YouTube exigiu consentimento; a busca sem chave não conseguiu acessar esta página');
  }
  if (/<title[^>]*>[^<]*(?:unusual traffic|sorry)|Our systems have detected unusual traffic|<[^>]+(?:id|class)\s*=\s*["'][^"']*(?:g-recaptcha|captcha-form)/i.test(html)) {
    throw fail('bloqueio de tráfego ou verificação de robô; tente novamente mais tarde');
  }
}

// Read JSON literals only. HTML and script bodies are never inserted into a DOM or executed.
function literalEnd(text, start) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  const first = text[start];
  for (let i = start; i < text.length && i - start <= MAX_JSON_CHARS; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') {
        quoted = false;
        if (first === '"') return i + 1;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') {
      if (++depth > MAX_DEPTH) throw fail('JSON ultrapassou o limite de profundidade');
    } else if (char === '}' || char === ']') {
      if (--depth === 0) return i + 1;
    }
  }
  throw fail('JSON incompleto ou acima do limite de tamanho');
}

function pageJson(html, name, required = true) {
  const assignment = new RegExp(`(?:\\b${name}|window\\s*\\[\\s*["']${name}["']\\s*\\])\\s*=\\s*`, 'g');
  let match;
  let attempts = 0;
  while ((match = assignment.exec(html)) && ++attempts <= 8) {
    let start = assignment.lastIndex;
    let source;
    if (html.startsWith('JSON.parse', start)) {
      const prefix = /^JSON\.parse\s*\(\s*/.exec(html.slice(start, start + 40));
      if (!prefix) continue;
      start += prefix[0].length;
      if (html[start] !== '"') continue;
      try { source = JSON.parse(html.slice(start, literalEnd(html, start))); }
      catch (error) { if (error.message?.startsWith('YouTube público:')) throw error; continue; }
      if (typeof source !== 'string' || source[0] !== '{') continue;
      if (source.length > MAX_JSON_CHARS) throw fail('JSON ultrapassou o limite de tamanho');
      literalEnd(source, 0);
    } else {
      if (html[start] !== '{') continue;
      source = html.slice(start, literalEnd(html, start));
    }
    try {
      const data = JSON.parse(source);
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    } catch { /* A later assignment can contain the complete response. */ }
  }
  if (required) throw fail(`não foi possível interpretar os dados JSON ${name}; o formato da página pode ter mudado`);
  return null;
}

function textValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value?.simpleText === 'string') return value.simpleText;
  if (typeof value?.content === 'string') return value.content;
  return Array.isArray(value?.runs) ? value.runs.map(run => typeof run?.text === 'string' ? run.text : '').join('') : '';
}

function exactDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return '';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function duration(secondsOrClock) {
  let seconds;
  if (/^\d+$/.test(String(secondsOrClock || ''))) seconds = Number(secondsOrClock);
  else if (/^\d{1,3}(?::\d{2}){1,2}$/.test(String(secondsOrClock || ''))) {
    seconds = String(secondsOrClock).split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
  }
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 864000) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `PT${hours ? `${hours}H` : ''}${minutes ? `${minutes}M` : ''}${remainder || (!hours && !minutes) ? `${remainder}S` : ''}`;
}

function thumbnail(value, id) {
  const images = value?.thumbnails || value?.sources || [];
  const safe = images.filter(item => {
    try {
      const url = new URL(item?.url);
      return url.protocol === 'https:' && (url.hostname === 'i.ytimg.com' || url.hostname.endsWith('.ytimg.com'));
    } catch { return false; }
  }).sort((a, b) => Number(b.width || 0) - Number(a.width || 0));
  return safe[0]?.url || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

function walk(root, visit) {
  const stack = [{ node: root, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (++count > MAX_NODES || depth > MAX_DEPTH) throw fail('dados ultrapassaram o limite de complexidade');
    if (visit(node) === false) continue;
    const entries = Array.isArray(node) ? node : Object.values(node);
    for (let i = entries.length - 1; i >= 0; i--) stack.push({ node: entries[i], depth: depth + 1 });
  }
}

function traditionalVideo(renderer, term) {
  if (!VALID_ID.test(renderer?.videoId || '')) return null;
  const title = textValue(renderer.title);
  if (!title) return null;
  const result = {
    id: renderer.videoId,
    title,
    description: Array.isArray(renderer.detailedMetadataSnippets)
      ? renderer.detailedMetadataSnippets.map(snippet => textValue(snippet.snippetText)).join('\n')
      : textValue(renderer.descriptionSnippet),
    channel: textValue(renderer.ownerText || renderer.longBylineText || renderer.shortBylineText),
    publishedAt: exactDate(renderer.publishedAt || textValue(renderer.publishedTimeText)),
    thumbnail: thumbnail(renderer.thumbnail, renderer.videoId),
    foundBy: term.query
  };
  const length = textValue(renderer.lengthText) || textValue(renderer.thumbnailOverlays?.find(item => item?.thumbnailOverlayTimeStatusRenderer)?.thumbnailOverlayTimeStatusRenderer?.text);
  const isoDuration = duration(length);
  if (isoDuration) result.duration = isoDuration;
  if (renderer.badges?.some(badge => /^(?:CC|subtitles|legendas)$/i.test(badge?.metadataBadgeRenderer?.label || ''))) result.captionAvailable = true;
  return result;
}

function modernVideo(renderer, term) {
  if (!['LOCKUP_CONTENT_TYPE_VIDEO', 'LOCKUP_CONTENT_TYPE_SHORT'].includes(renderer.contentType) || !VALID_ID.test(renderer.contentId || '')) return null;
  const metadata = renderer.metadata?.lockupMetadataViewModel;
  const title = textValue(metadata?.title);
  if (!title) return null;
  let channel = '';
  let length = '';
  let captions = false;
  walk(metadata?.metadata, node => {
    if (!channel && node.text?.commandRuns?.some(run => run?.onTap?.innertubeCommand?.browseEndpoint?.browseId?.startsWith('UC'))) channel = textValue(node.text);
  });
  walk(renderer.contentImage, node => {
    const candidate = textValue(node.thumbnailBadgeViewModel?.text);
    if (duration(candidate)) length = candidate;
    if (/^(?:CC|subtitles|legendas)$/i.test(candidate)) captions = true;
  });
  const result = { id: renderer.contentId, title, description: '', channel, publishedAt: '', thumbnail: thumbnail(renderer.contentImage?.thumbnailViewModel?.image, renderer.contentId), foundBy: term.query };
  if (length) result.duration = duration(length);
  if (captions) result.captionAvailable = true;
  return result;
}

function shortsVideo(renderer, term) {
  const endpoint = renderer.onTap?.innertubeCommand;
  const id = endpoint?.reelWatchEndpoint?.videoId || endpoint?.watchEndpoint?.videoId || renderer.videoId;
  if (!VALID_ID.test(id || '')) return null;
  const title = textValue(renderer.overlayMetadata?.primaryText || renderer.headline);
  if (!title) return null;
  return { id, title, description: '', channel: '', publishedAt: '', thumbnail: thumbnail(renderer.thumbnail, id), foundBy: term.query };
}

export function parseYouTubeSearchHtml(html, term, settings = {}) {
  checkPage(html);
  const data = pageJson(html, 'ytInitialData');
  const root = data.contents?.twoColumnSearchResultsRenderer?.primaryContents || data.contents?.sectionListRenderer && data.contents;
  if (!root) throw fail('layout da busca desconhecido; não foi possível interpretar os resultados');
  const results = new Map();
  let recognized = false;
  let message = false;
  let emptySection = false;
  walk(root, node => {
    if (node.adSlotRenderer || node.adPlacementRenderer || node.promotedSparklesWebRenderer || node.promotedVideoRenderer) return false;
    if (node.messageRenderer || node.backgroundPromoRenderer) message = true;
    if (node.itemSectionRenderer?.contents?.length === 0 || node.sectionListRenderer?.contents?.length === 0) emptySection = true;
    let candidate;
    const renderer = node.videoRenderer || node.compactVideoRenderer || node.gridVideoRenderer;
    if (renderer) { recognized = true; candidate = traditionalVideo(renderer, term); }
    else if (node.lockupViewModel) { recognized = true; candidate = modernVideo(node.lockupViewModel, term); }
    else if (node.shortsLockupViewModel || node.reelItemRenderer) { recognized = true; candidate = shortsVideo(node.shortsLockupViewModel || node.reelItemRenderer, term); }
    if (candidate && !results.has(candidate.id)) results.set(candidate.id, candidate);
    if (renderer || node.lockupViewModel || node.shortsLockupViewModel || node.reelItemRenderer) return false;
  });
  if (!results.size && !recognized && !message && !emptySection) throw fail('formato dos resultados desconhecido; a página pode ter mudado');
  const limit = Math.max(1, Math.min(50, Math.round(Number(settings.resultsPerTerm) || 15)));
  return [...results.values()].slice(0, limit);
}

export function parseYouTubeWatchHtml(html, video) {
  if (!VALID_ID.test(video?.id || '')) throw fail('ID de vídeo inválido');
  checkPage(html);
  const player = pageJson(html, 'ytInitialPlayerResponse');
  const status = player.playabilityStatus?.status;
  const reason = textValue(player.playabilityStatus?.reason);
  if (BLOCK_MESSAGE.test(reason)) throw fail(`bloqueio de tráfego ou robô: ${reason}`);
  if (typeof status !== 'string' || !status) throw fail('metadados do player sem estado de disponibilidade');
  if (status !== 'OK') return { ...video, url: videoUrl(video.id), playabilityStatus: status, captionAvailable: false };
  const details = player.videoDetails;
  const micro = player.microformat?.playerMicroformatRenderer || {};
  if (!details || details.videoId !== video.id) throw fail('ID ou identidade do vídeo nos metadados não corresponde ao solicitado');
  if (!textValue(details.title) || typeof details.shortDescription !== 'string') throw fail('metadados incompletos: título ou descrição completa ausente');
  const captionTracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return {
    ...video,
    title: details.title,
    description: details.shortDescription,
    channel: details.author || textValue(micro.ownerChannelName) || video.channel || '',
    publishedAt: exactDate(micro.publishDate || micro.uploadDate) || video.publishedAt || '',
    thumbnail: thumbnail(details.thumbnail || micro.thumbnail, video.id),
    duration: duration(details.lengthSeconds || micro.lengthSeconds) || video.duration || '',
    captionAvailable: Array.isArray(captionTracks) && captionTracks.some(track => typeof track?.languageCode === 'string' && typeof track?.baseUrl === 'string'),
    url: videoUrl(video.id),
    playabilityStatus: status
  };
}

function locale(language, settings) {
  const candidate = String(language || settings.hl || settings.languageList?.[0] || 'en').replace('_', '-');
  const hl = /^[a-z]{2}(?:-[a-z]{2})?$/i.test(candidate) ? candidate : 'en';
  const defaultRegions = { pt: 'BR', en: 'US', es: 'ES', fr: 'FR', de: 'DE', ja: 'JP', ko: 'KR', zh: 'TW' };
  const gl = /^[A-Z]{2}$/i.test(String(settings.gl || '')) ? String(settings.gl).toUpperCase() : hl.split('-')[1]?.toUpperCase() || defaultRegions[hl.slice(0, 2)] || 'US';
  return { hl, gl };
}

async function readBounded(response, signal) {
  if (Number(response.headers?.get?.('content-length')) > MAX_HTML_BYTES) {
    await response.body?.cancel?.();
    throw fail('a página ultrapassou o limite de tamanho');
  }
  if (!response.body?.getReader) {
    const html = await response.text();
    if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) throw fail('a página ultrapassou o limite de tamanho');
    return html;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let html = '';
  const cancel = () => { reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) { await reader.cancel(); throw fail('a página ultrapassou o limite de tamanho'); }
      html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

async function publicPage(url, fetchImpl, signal) {
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(20000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetchImpl(url, {
      credentials: 'include',
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      signal: requestSignal
    });
  } catch (error) {
    signal?.throwIfAborted();
    if (timeout.aborted) throw fail('a página demorou demais para responder');
    throw fail(`não foi possível acessar a página pública; pode haver redirecionamento de consentimento ou bloqueio (${error.message || 'erro de rede'})`);
  }
  requestSignal.throwIfAborted();
  if (response.url) {
    const final = new URL(response.url);
    const isYouTube = final.protocol === 'https:' && (final.hostname === 'youtube.com' || final.hostname.endsWith('.youtube.com'));
    const isGoogleConsent = final.protocol === 'https:' && (final.hostname === 'consent.youtube.com' || final.hostname === 'consent.google.com' || final.hostname.endsWith('.google.com'));
    if (!isYouTube && !isGoogleConsent) throw fail('redirecionamento fora do YouTube bloqueado');
  }
  if (!response.ok) {
    await response.body?.cancel?.();
    throw fail(`a página respondeu HTTP ${response.status}; tente novamente mais tarde`);
  }
  return readBounded(response, requestSignal);
}

export async function searchYouTubeWeb(term, settings = {}, fetchImpl = fetch, signal) {
  if (!term || typeof term.query !== 'string' || !term.query.trim()) throw fail('termo de busca vazio');
  const url = new URL('https://www.youtube.com/results');
  url.search = new URLSearchParams({ search_query: term.query.trim().slice(0, 180), ...locale(term.language, settings), sp: settings.captionedOnly === false ? 'EgIQAQ==' : 'EgQQASgB' }).toString();

  const maxAttempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    signal?.throwIfAborted();
    try {
      const html = await publicPage(url, fetchImpl, signal);
      return parseYouTubeSearchHtml(html, term, settings);
    } catch (error) {
      lastError = error;
      signal?.throwIfAborted();
      if (/exigiu consentimento|verificação de robô|layout da busca desconhecido|formato dos resultados desconhecido|ultrapassou o limite|ID de vídeo inválido/i.test(error.message)) {
        throw error;
      }
      if (attempt < maxAttempts) {
        console.warn(`[TubeLess YouTube Web] Tentativa ${attempt}/${maxAttempts} falhou para "${term.query}": ${error.message}. Aguardando retry...`);
        const delay = attempt * 300;
        await new Promise(resolve => setTimeout(resolve, delay));
        signal?.throwIfAborted();
      } else {
        console.error(`[TubeLess YouTube Web] Falha definitiva após ${maxAttempts} tentativas para "${term.query}": ${error.message}`);
      }
    }
  }
  throw lastError;
}

export async function enrichYouTubeWeb(videos, settings = {}, fetchImpl = fetch, signal) {
  signal?.throwIfAborted();
  const results = new Array(videos.length);
  let next = 0;
  const worker = async () => {
    while (next < videos.length) {
      signal?.throwIfAborted();
      const index = next++;
      const video = videos[index];
      const maxAttempts = 2;
      let lastErr;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        signal?.throwIfAborted();
        try {
          const url = new URL(videoUrl(video.id));
          const language = video.language || settings.languageList?.[0];
          for (const [key, value] of Object.entries(locale(language, settings))) url.searchParams.set(key, value);
          results[index] = parseYouTubeWatchHtml(await publicPage(url, fetchImpl, signal), video);
          lastErr = null;
          break;
        } catch (error) {
          if (error.name === 'AbortError' || signal?.aborted) throw error;
          lastErr = error;
          if (/ID de vídeo inválido|exigiu consentimento|bloqueio de tráfego/i.test(error.message)) break;
          if (attempt < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, attempt * 200));
          }
        }
      }
      if (lastErr) {
        signal?.throwIfAborted();
        results[index] = { ...video, url: VALID_ID.test(video?.id || '') ? videoUrl(video.id) : '', captionAvailable: undefined, playabilityStatus: 'UNKNOWN', detailError: lastErr.message || 'YouTube público: falha ao obter os metadados' };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WATCH_CONCURRENCY, videos.length) }, worker));
  signal?.throwIfAborted();
  return results.filter(video => video.detailError || video.playabilityStatus === 'OK' && (settings.captionedOnly === false || video.captionAvailable === true));
}
