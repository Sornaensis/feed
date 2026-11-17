import { safeUrl } from './model.js?v=6';
import { sanitizedFragment } from './sanitize.js?v=2';

const MAX_EMBEDS = 12;
const MAX_QUOTE_DEPTH = 2;
const players = new WeakMap();
let hlsModule;

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit = 1000) => typeof value === 'string' ? value.slice(0, limit).trim() : '';
const dimension = value => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 20000 ? Math.round(Number(value)) : null;

function element(tag, className = '', content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function outbound(url, className, label) {
  const node = element('a', className, label);
  node.href = url;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

function timestamp(value) {
  const raw = String(value || '');
  if (/^\d+(?:s)?$/.test(raw)) return Math.min(86400, Number(raw.replace(/s$/, '')));
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  return match && match[0] ? Math.min(86400, Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0)) : 0;
}

// Only known player URLs are constructed here. Feed-supplied iframe HTML and
// embed URLs never become live frames, even when they name a supported provider.
export function classifyLink(value, baseUrl) {
  const href = safeUrl(value, baseUrl);
  if (!href) return null;
  const url = new URL(href);
  const host = url.hostname.toLowerCase();
  let id = '';
  if (host === 'youtu.be' || host === 'www.youtu.be') id = url.pathname.split('/')[1] || '';
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
    else id = /^\/(?:embed|shorts|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1] || '';
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    const embed = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
    const start = timestamp(url.searchParams.get('start') || url.searchParams.get('t') || url.hash.slice(1).replace(/^t=/, ''));
    if (start) embed.searchParams.set('start', String(start));
    embed.searchParams.set('rel', '0');
    return { type: 'player', provider: 'YouTube', url: href, embedUrl: embed.href,
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  }
  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) {
    const match = /^\/(?:video\/)?(\d{1,15})(?:\/([a-fA-F0-9]{6,64}))?\/?$/.exec(url.pathname);
    if (match) {
      const embed = new URL(`https://player.vimeo.com/video/${match[1]}`);
      const hash = match[2] || url.searchParams.get('h') || '';
      if (/^[a-fA-F0-9]{6,64}$/.test(hash)) embed.searchParams.set('h', hash);
      embed.searchParams.set('dnt', '1');
      return { type: 'player', provider: 'Vimeo', url: href, embedUrl: embed.href };
    }
  }
  const pathname = url.pathname.toLowerCase();
  if (/\.(?:avif|gif|jpe?g|png|webp)$/.test(pathname)) return { type: 'image', url: href };
  if (/\.(?:mp4|m4v|webm|ogv|mov|m3u8)$/.test(pathname)) return { type: 'video', url: href,
    ...(/\.m3u8$/.test(pathname) ? { mimeType: 'application/vnd.apple.mpegurl' } : {}) };
  if (/\.(?:mp3|m4a|aac|ogg|oga|opus|wav|flac)$/.test(pathname)) return { type: 'audio', url: href };
  return { type: 'link', url: href };
}

// Used for ordinary links inside HN/DEV comments. Do not turn every link in a
// conversation into an article preview: only explicit media is expanded.
export function inlineMediaLinks(bodyHtml, baseUrl) {
  // Inspect an inert tree rather than rebuilding sanitized media merely to
  // find links. Images already shown in the body must not be embedded twice.
  const template = document.createElement('template');
  template.innerHTML = String(bodyHtml || '');
  const fragment = template.content;
  for (const node of fragment.querySelectorAll('script, style, iframe, object, embed, svg, math, form, input, button, textarea, select, link, meta, base, template, noscript, video, audio, source')) node.remove();
  const seen = new Set([...fragment.querySelectorAll('img[src]')]
    .map(image => safeUrl(image.getAttribute('src'), baseUrl)).filter(Boolean));
  const embeds = [];
  for (const anchor of fragment.querySelectorAll('a[href]')) {
    if (anchor.querySelector('img')) continue;
    const media = classifyLink(anchor.getAttribute('href'), baseUrl);
    if (!media || media.type === 'link' || seen.has(media.url)) continue;
    seen.add(media.url);
    embeds.push({ type: media.type === 'player' ? 'link' : media.type, url: media.url,
      title: text(anchor.textContent, 300), ...(media.mimeType ? { mimeType: media.mimeType } : {}) });
    if (embeds.length >= 4) break;
  }
  return embeds;
}

function createImage(embed, options) {
  const url = safeUrl(embed.url, options.baseUrl);
  if (!url) return null;
  const src = safeUrl(embed.thumbnailUrl, options.baseUrl) || url;
  const figure = element('figure', 'media-image');
  const anchor = outbound(url, 'media-image-link');
  const alt = text(embed.alt, 4000);
  anchor.setAttribute('aria-label', alt ? `Open full image: ${alt.slice(0, 240)}` : 'Open full image');
  const image = element('img', 'media-image-content');
  image.alt = alt;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  const width = dimension(embed.width), height = dimension(embed.height);
  if (width && height) { image.width = width; image.height = height; }
  image.addEventListener('error', () => {
    image.remove();
    anchor.append(element('span', 'media-image-error', 'Image unavailable · Open original'));
  }, { once: true });
  image.src = src;
  anchor.append(image);
  if (alt) {
    const badge = element('span', 'media-alt-badge', 'ALT');
    badge.title = alt;
    badge.setAttribute('aria-hidden', 'true');
    anchor.append(badge);
  }
  figure.append(anchor);
  return figure;
}

function mediaFallback(container, url, message = '') {
  if (message) {
    const status = element('p', 'media-error', message);
    status.setAttribute('role', 'status');
    container.append(status);
  }
  if (url) container.append(outbound(url, 'media-source-link', 'Open at source ↗'));
}

function playableShell(embed, options, label) {
  const figure = element('figure', 'media-player');
  const width = dimension(embed.width), height = dimension(embed.height);
  if (width && height && height > width) figure.classList.add('is-portrait');
  const stage = element('div', 'media-player-stage');
  const play = element('button', 'media-play-button');
  play.type = 'button';
  play.setAttribute('aria-label', `${label}${embed.alt || embed.title ? ': ' + text(embed.alt || embed.title, 220) : ''}`);
  const poster = safeUrl(embed.posterUrl || embed.imageUrl || embed.thumbnailUrl, options.baseUrl);
  if (poster) {
    const image = element('img', 'media-player-poster');
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => image.remove(), { once: true });
    image.src = poster;
    play.append(image);
  }
  const prompt = element('span', 'media-play-prompt');
  const glyph = element('span', 'media-play-glyph', '▶');
  glyph.setAttribute('aria-hidden', 'true');
  prompt.append(glyph, element('span', '', label));
  play.append(prompt);
  stage.append(play);
  const caption = element('figcaption', 'media-player-caption');
  if (text(embed.alt || embed.title, 400)) caption.append(element('span', 'media-player-description', text(embed.alt || embed.title, 400)));
  figure.append(stage, caption);
  return { figure, stage, play, caption };
}

function playMedia(media) {
  try { media.play()?.catch(() => {}); } catch { /* Native controls remain available. */ }
}

function createNativeMedia(embed, options) {
  const url = safeUrl(embed.url, options.baseUrl);
  if (!url) return null;
  const audio = embed.type === 'audio';
  const shell = playableShell(embed, options, audio ? 'Play audio' : 'Play video');
  if (audio) shell.figure.classList.add('is-audio');
  const source = safeUrl(options.baseUrl) || url;
  mediaFallback(shell.caption, source);
  shell.play.addEventListener('click', async () => {
    const media = element(audio ? 'audio' : 'video', 'media-native-player');
    media.controls = true;
    media.preload = 'none';
    if (!audio) {
      media.playsInline = true;
      const poster = safeUrl(embed.posterUrl, options.baseUrl);
      if (poster) media.poster = poster;
    }
    const state = { disposed: false, hls: null };
    players.set(media, state);
    let failed = false;
    function failure(reason = 'Media playback unavailable') {
      if (failed || state.disposed) return;
      failed = true;
      media.dataset.playbackError = String(reason).slice(0, 300);
      state.hls?.destroy();
      state.hls = null;
      mediaFallback(shell.caption, '', 'This media could not be played here. Use the source link to view it.');
    }
    media.addEventListener('error', () => failure(`native:${media.error?.code || 'unknown'} ${media.error?.message || ''}`), { once: true });
    shell.stage.replaceChildren(media);
    const hls = /^(application\/(?:vnd\.apple\.mpegurl|x-mpegurl))$/i.test(String(embed.mimeType || '')) || /\.m3u8(?:$|[?#])/i.test(url);
    if (!hls) {
      media.src = url;
      playMedia(media);
      return;
    }
    function nativeHlsFallback() {
      if (state.disposed || !media.canPlayType('application/vnd.apple.mpegurl')) return false;
      state.hls?.destroy();
      state.hls = null;
      media.src = url;
      playMedia(media);
      return true;
    }
    try {
      hlsModule ||= import('./vendor/hls.light.min.mjs');
      const { default: Hls } = await hlsModule;
      if (state.disposed) return;
      if (!Hls.isSupported()) {
        if (nativeHlsFallback()) return;
        const mse = globalThis.MediaSource || globalThis.ManagedMediaSource;
        failure(`hls:unsupported MSE=${Boolean(mse)} AVC=${Boolean(mse?.isTypeSupported?.('video/mp4; codecs="avc1.42E01E"'))} AAC=${Boolean(mse?.isTypeSupported?.('audio/mp4; codecs="mp4a.40.2"'))}`);
        return;
      }
      const player = new Hls({ enableWorker: false, capLevelToPlayerSize: true,
        maxBufferLength: 20, maxMaxBufferLength: 40, backBufferLength: 10 });
      state.hls = player;
      player.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) failure(`hls:${data.type || 'unknown'} ${data.details || ''} status=${data.response?.code ?? 'unknown'}`);
      });
      player.on(Hls.Events.MANIFEST_PARSED, () => { if (!state.disposed) playMedia(media); });
      player.loadSource(url);
      player.attachMedia(media);
    } catch (error) {
      hlsModule = undefined;
      if (!nativeHlsFallback()) failure(`hls:setup ${error?.name || 'Error'} ${error?.message || ''}`);
    }
  }, { once: true });
  return shell.figure;
}

function createProviderPlayer(embed, classification, options) {
  const shell = playableShell({ ...embed, thumbnailUrl: embed.imageUrl || classification.thumbnailUrl }, options, `Play on ${classification.provider}`);
  mediaFallback(shell.caption, classification.url);
  shell.play.addEventListener('click', () => {
    const iframe = element('iframe', 'media-provider-player');
    iframe.title = `${classification.provider} video${embed.title ? ': ' + text(embed.title, 200) : ''}`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    const url = new URL(classification.embedUrl);
    url.searchParams.set('autoplay', '1'); // Only after this explicit play click.
    iframe.src = url.href;
    shell.stage.replaceChildren(iframe);
  }, { once: true });
  return shell.figure;
}

function createLinkCard(embed, options) {
  const url = safeUrl(embed.url, options.baseUrl);
  if (!url) return null;
  const classification = classifyLink(url);
  if (classification.type === 'player') return createProviderPlayer(embed, classification, options);
  if (['image', 'video', 'audio'].includes(classification.type)) return createOne({ ...embed, ...classification }, options, 0);
  const hostname = new URL(url).hostname.replace(/^www\./, '');
  const card = outbound(url, 'media-link-card');
  const imageUrl = safeUrl(embed.imageUrl, options.baseUrl);
  if (imageUrl) {
    card.classList.add('has-image');
    const image = element('img', 'media-link-thumb');
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => { image.remove(); card.classList.remove('has-image'); }, { once: true });
    image.src = imageUrl;
    card.append(image);
  }
  const copy = element('span', 'media-link-copy');
  const domain = element('span', 'media-link-domain', text(embed.siteName, 100) || hostname);
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrow.setAttribute('class', 'media-link-arrow');
  arrow.setAttribute('viewBox', '0 0 24 24');
  arrow.setAttribute('fill', 'none');
  arrow.setAttribute('stroke', 'currentColor');
  arrow.setAttribute('stroke-width', '1.65');
  arrow.setAttribute('stroke-linecap', 'round');
  arrow.setAttribute('stroke-linejoin', 'round');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.setAttribute('focusable', 'false');
  const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrowPath.setAttribute('d', 'M14 3h7v7M21 3l-11 11M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5');
  arrow.append(arrowPath);
  domain.append(arrow);
  copy.append(domain, element('strong', 'media-link-title', text(embed.title, 500) || hostname));
  if (text(embed.description)) copy.append(element('span', 'media-link-description', text(embed.description)));
  if (text(embed.siteName) && text(embed.siteName).toLowerCase() !== hostname) copy.append(element('span', 'media-link-host', hostname));
  card.append(copy);
  return card;
}

function gatedContent(factory, warning) {
  const details = element('details', 'media-sensitive');
  details.append(element('summary', '', text(warning, 300) || 'Sensitive media — show content'));
  const content = element('div', 'media-sensitive-content');
  details.append(content);
  details.addEventListener('toggle', () => {
    if (details.open) {
      if (!content.childNodes.length) content.append(factory());
    } else {
      disposeEmbeds(content);
      content.replaceChildren();
    }
  });
  return details;
}

function createQuote(embed, options, depth) {
  const url = safeUrl(embed.url, options.baseUrl);
  const quote = element('article', 'media-quote');
  const header = element('div', 'media-quote-header');
  header.append(element('span', 'media-quote-label', 'Quoted post'));
  if (url) header.append(outbound(url, 'media-quote-author', text(embed.author, 200) || 'View original ↗'));
  else if (text(embed.author)) header.append(element('strong', 'media-quote-author', text(embed.author, 200)));
  quote.append(header);
  if (embed.unavailable) {
    quote.append(element('p', 'media-quote-unavailable', 'This quoted post is no longer available.'));
    return quote;
  }
  function content() {
    const body = element('div', 'media-quote-content');
    if (text(embed.bodyHtml, 20000)) {
      const copy = element('div', 'media-quote-body');
      copy.append(sanitizedFragment(text(embed.bodyHtml, 20000), url || options.baseUrl));
      body.append(copy);
    }
    if (depth < MAX_QUOTE_DEPTH) body.append(renderList(embed.embeds, { ...options, baseUrl: url || options.baseUrl, compact: true }, depth + 1));
    if (url) body.append(outbound(url, 'media-source-link', 'View post ↗'));
    return body;
  }
  quote.append(embed.sensitive || embed.contentWarning ? gatedContent(content, embed.contentWarning) : content());
  return quote;
}

function createOne(embed, options, depth) {
  if (!record(embed)) return null;
  switch (embed.type) {
    case 'image': return createImage(embed, options);
    case 'video':
    case 'audio': return createNativeMedia(embed, options);
    case 'link': return createLinkCard(embed, options);
    case 'quote': return createQuote(embed, options, depth);
    default: return null;
  }
}

function renderList(embeds, options, depth = 0) {
  const list = element('div', `media-embeds${options.compact ? ' is-compact' : ''}`);
  const items = Array.isArray(embeds) ? embeds.slice(0, MAX_EMBEDS) : [];
  let gallery;
  for (const embed of items) {
    const node = createOne(embed, options, depth);
    if (!node) continue;
    if (embed.type === 'image') {
      if (!gallery) { gallery = element('div', 'media-gallery'); list.append(gallery); }
      gallery.append(node);
      gallery.dataset.count = String(gallery.children.length);
    } else { gallery = null; list.append(node); }
  }
  return list;
}

export function renderEmbeds(embeds, { baseUrl, sensitive = false, contentWarning = '', compact = false } = {}) {
  const options = { baseUrl, compact };
  if ((sensitive || contentWarning) && Array.isArray(embeds) && embeds.length) {
    return gatedContent(() => renderList(embeds, options), contentWarning);
  }
  return renderList(embeds, options);
}

export function renderLinkPreview(post) {
  if (!record(post) || post.unavailable) return null;
  const url = safeUrl(post.url);
  if (!url || url === safeUrl(post.discussionUrl)) return null;
  if (Array.isArray(post.embeds) && post.embeds.some(embed => embed?.type === 'link' && safeUrl(embed.url) === url)) return null;
  const preview = record(post.linkPreview) && safeUrl(post.linkPreview.url) === url ? post.linkPreview : {};
  const data = { type: 'link', url, title: text(preview.title, 500) || text(post.title, 500),
    description: text(preview.description) || text(post.excerpt),
    imageUrl: preview.imageUrl, siteName: preview.siteName };
  const render = () => createLinkCard(data, { baseUrl: url });
  return post.sensitive || post.contentWarning ? gatedContent(render, post.contentWarning) : render();
}

// Call immediately before a reader/story/comment subtree is removed. A late
// dynamic import cannot start a player after its original node was disposed.
export function disposeEmbeds(root) {
  if (!root?.querySelectorAll) return;
  const nodes = [...root.querySelectorAll('video, audio, iframe')];
  if (root.matches?.('video, audio, iframe')) nodes.push(root);
  for (const node of nodes) {
    const state = players.get(node);
    if (state) { state.disposed = true; state.hls?.destroy(); state.hls = null; players.delete(node); }
    if (node.tagName === 'IFRAME') { node.removeAttribute('src'); continue; }
    try { node.pause(); node.removeAttribute('src'); node.load(); } catch { /* Already detached or unsupported. */ }
  }
}
