import { normalizePost, safeUrl } from './model.js?v=6';

const BLUESKY_API = 'https://public.api.bsky.app/xrpc/';
const BLUESKY_DEPTH = 6;
const MAX_BLUESKY_COMMENTS = 500;
const MAX_MASTODON_COMMENTS = 60;
const MAX_EMBEDS = 20;
const MAX_QUOTE_DEPTH = 2;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[char]);
const paragraph = value => value ? `<p>${escapeHtml(value).replace(/\n/g, '<br>')}</p>` : '';
const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : null;
const limitTo = value => Math.min(25, Math.max(1, number(value) ?? 25));
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const missing = error => [404, 410].includes(Number(error?.status ?? error?.statusCode));

function short(value, limit = 180) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  const points = [...text];
  return points.length <= limit ? text : points.slice(0, limit - 1).join('').trimEnd() + '…';
}

function plainHtml(value) {
  const html = String(value ?? '').replace(/<\/(?:p|div|li|blockquote)\s*>/gi, ' ');
  if (typeof document !== 'undefined') {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script, style').forEach(node => node.remove());
    return template.content.textContent.replace(/\s+/gu, ' ').trim();
  }
  // The browser uses its inert HTML parser. This fallback keeps fixture tests
  // usable in Node without adding a DOM dependency.
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
      if (code[0] !== '#') return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[code.toLowerCase()];
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '�';
    }).replace(/\s+/gu, ' ').trim();
}

async function identity(value) {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function removed() {
  return Object.assign(new Error('This post was removed or is no longer publicly available.'), { removed: true });
}

function quote(value, colons = false) {
  const encoded = encodeURIComponent(String(value)).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
  return colons ? encoded.replace(/%3A/gi, ':') : encoded;
}

function blueskyUrl(uri, author) {
  const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/.exec(String(uri || ''));
  return match ? `https://bsky.app/profile/${quote(author?.did || match[1], true)}/post/${quote(match[2])}` : '';
}

function blueskyText(text, facets) {
  const bytes = encoder.encode(text);
  let cursor = 0;
  const parts = [];
  const ordered = (Array.isArray(facets) ? facets : []).filter(record)
    .sort((a, b) => (number(a.index?.byteStart) ?? 0) - (number(b.index?.byteStart) ?? 0));
  for (const facet of ordered) {
    const start = number(facet.index?.byteStart);
    const end = number(facet.index?.byteEnd);
    if (start === null || end === null || start < cursor || start < 0 || end <= start || end > bytes.length) continue;
    let href = '';
    for (const feature of Array.isArray(facet.features) ? facet.features : []) {
      if (!record(feature)) continue;
      if (feature.$type === 'app.bsky.richtext.facet#link') href = safeUrl(feature.uri) || '';
      else if (feature.$type === 'app.bsky.richtext.facet#mention' && typeof feature.did === 'string' && feature.did) {
        href = `https://bsky.app/profile/${quote(feature.did, true)}`;
      }
      if (href) break;
    }
    if (!href) continue;
    try {
      const before = decoder.decode(bytes.slice(cursor, start));
      const label = decoder.decode(bytes.slice(start, end));
      parts.push(escapeHtml(before), `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`);
      cursor = end;
    } catch { /* Reject facets that split a UTF-8 character. */ }
  }
  parts.push(escapeHtml(decoder.decode(bytes.slice(cursor))));
  return text ? `<p>${parts.join('').replace(/\n/g, '<br>')}</p>` : '';
}

function dimensions(value) {
  if (!record(value)) return {};
  const width = number(value.width), height = number(value.height);
  return width > 0 && width <= 100000 && height > 0 && height <= 100000 ? { width, height } : {};
}

function mediaUrl(value) {
  return typeof value === 'string' && value.length <= 8192 && !/[\s\\]/u.test(value.trim())
    && !/^https?:\/\/[^/?#]*@/iu.test(value.trim()) ? safeUrl(value) || '' : '';
}

function blueskyWarning(view) {
  const value = record(view.record) ? view.record : record(view.value) ? view.value : {};
  const labels = [...(Array.isArray(view.labels) ? view.labels : []), ...(Array.isArray(value.labels?.values) ? value.labels.values : [])];
  const warningLabels = new Set(['porn', 'sexual', 'nudity', 'graphic-media', 'gore', 'corpse', 'self-harm', '!warn', '!hide']);
  const sensitive = labels.some(label => record(label) && !label.neg && warningLabels.has(label.val));
  return { sensitive, contentWarning: sensitive ? 'Sensitive content' : '' };
}

function blueskyEmbeds(value, depth = 0, nesting = 0) {
  if (!record(value) || depth > MAX_QUOTE_DEPTH || nesting > 8) return [];
  const result = [];
  const addImage = image => {
    if (!record(image)) return;
    const thumbnailUrl = mediaUrl(image.thumb) || mediaUrl(image.thumbnail);
    const url = mediaUrl(image.fullsize) || thumbnailUrl;
    if (url) result.push({ type: 'image', url, thumbnailUrl, alt: String(image.alt || '').slice(0, 3000), ...dimensions(image.aspectRatio) });
  };
  for (const image of (Array.isArray(value.images) ? value.images : []).slice(0, MAX_EMBEDS)) addImage(image);
  const playlist = mediaUrl(value.playlist);
  if (playlist) result.push({ type: 'video', url: playlist, posterUrl: mediaUrl(value.thumbnail),
    alt: String(value.alt || '').slice(0, 3000), mimeType: 'application/vnd.apple.mpegurl', ...dimensions(value.aspectRatio) });
  const external = record(value.external) ? value.external : {};
  const url = mediaUrl(external.uri);
  if (url) result.push({ type: 'link', url, title: String(external.title || '').slice(0, 300),
    description: String(external.description || '').slice(0, 1000), imageUrl: mediaUrl(external.thumb) });
  if (record(value.media)) result.push(...blueskyEmbeds(value.media, depth, nesting + 1));
  // Gallery image views use `thumbnail` instead of the older `thumb` field.
  // Read resolved App View URLs, never raw blob references from post records.
  for (const item of (Array.isArray(value.items) ? value.items : []).slice(0, MAX_EMBEDS)) {
    if (!record(item)) continue;
    if (item.fullsize || item.thumb || item.thumbnail && !item.playlist) addImage(item);
    else if (item.playlist) result.push(...blueskyEmbeds(item, depth, nesting + 1));
  }
  if (depth < MAX_QUOTE_DEPTH && record(value.record)) {
    const quoted = record(value.record.record) ? value.record.record : value.record;
    const url = blueskyUrl(quoted.uri, quoted.author);
    const unavailable = quoted.notFound || quoted.blocked || quoted.detached || /#view(?:NotFound|Blocked|Detached)$/.test(String(quoted.$type || ''));
    if (url && unavailable) result.push({ type: 'quote', url, author: 'Unavailable',
      bodyHtml: paragraph('This quoted post is unavailable.'), embeds: [], unavailable: true });
    else if (url && record(quoted.value)) {
      const recordValue = quoted.value;
      const embeds = (Array.isArray(quoted.embeds) ? quoted.embeds : []).slice(0, MAX_EMBEDS)
        .flatMap(embed => blueskyEmbeds(embed, depth + 1, nesting + 1)).slice(0, MAX_EMBEDS);
      result.push({ type: 'quote', url, author: '@' + String(quoted.author?.handle || quoted.author?.did || 'unknown'),
        bodyHtml: blueskyText(String(recordValue.text || ''), recordValue.facets),
        publishedAt: date(recordValue.createdAt || quoted.indexedAt), embeds, ...blueskyWarning(quoted) });
    }
  }
  return result.slice(0, MAX_EMBEDS);
}

function blueskyContent(view) {
  const value = record(view.record) ? view.record : {};
  const text = String(value.text || '');
  let bodyHtml = blueskyText(text, value.facets);
  const embeds = blueskyEmbeds(record(view.embed) ? view.embed : value.embed);
  const external = embeds.find(embed => embed.type === 'link');
  if (!bodyHtml && !embeds.length) bodyHtml = paragraph('Open the original post on Bluesky.');
  return { title: external?.title || short(text) || (embeds.length ? 'Bluesky media post' : 'Bluesky post'),
    bodyHtml, excerpt: short(text || external?.description, 320), url: external?.url || '', embeds, ...blueskyWarning(view) };
}

async function blueskyPost(view, account) {
  if (view.blocked || view.notFound || view.deleted) throw removed();
  const atUri = String(view.uri || '');
  const discussionUrl = blueskyUrl(atUri, view.author);
  if (!discussionUrl) throw new Error('Invalid Bluesky post URI');
  const content = blueskyContent(view);
  const sourceItemId = await identity(atUri);
  return normalizePost({
    id: `bluesky:${sourceItemId}`, sourceId: 'bluesky', sourceItemId,
    title: short(content.title), url: content.url || discussionUrl, discussionUrl,
    author: '@' + String(view.author?.handle || view.author?.did || 'unknown'),
    publishedAt: date(view.record?.createdAt || view.indexedAt), score: number(view.likeCount),
    commentCount: number(view.replyCount), tags: Array.isArray(view.record?.tags) ? view.record.tags : [],
    excerpt: content.excerpt, bodyHtml: content.bodyHtml, embeds: content.embeds,
    sensitive: content.sensitive, contentWarning: content.contentWarning, bodyKind: 'post', commentsMode: 'live',
    threadPath: null, atUri, sourceAccount: account,
  });
}

function interleave(groups, limit) {
  const result = [], seen = new Set();
  for (let index = 0; groups.some(group => index < group.length); index++) {
    for (const group of groups) {
      const post = group[index];
      if (!post || seen.has(post.id)) continue;
      seen.add(post.id); result.push(post);
      if (result.length >= limit) return result;
    }
  }
  return result;
}

export async function fetchBlueskyFeed({ actors, previousPosts = [], request, signal, limit = 25 }) {
  if (!Array.isArray(actors) || !actors.length || actors.some(actor => typeof actor !== 'string' || !actor.trim())) {
    throw new Error('Configure at least one Bluesky actor');
  }
  actors = [...new Set(actors.map(actor => actor.trim()))];
  if (actors.length > 10) throw new Error('Configure at most ten Bluesky actors');
  limit = limitTo(limit);
  const perAccount = Math.ceil(limit / actors.length);
  let handled = 0, partial = false;
  const failedAccounts = [];
  const groups = await Promise.all(actors.map(async actor => {
    try {
      const params = new URLSearchParams({ actor, filter: 'posts_no_replies', limit: String(perAccount) });
      const payload = await request(`${BLUESKY_API}app.bsky.feed.getAuthorFeed?${params}`, signal);
      if (!record(payload) || !Array.isArray(payload.feed)) throw new Error('Invalid Bluesky account feed');
      const posts = [];
      for (const item of payload.feed.slice(0, perAccount)) {
        try {
          if (!record(item?.post)) throw new Error('Invalid Bluesky post');
          posts.push(await blueskyPost(item.post, actor));
        } catch { partial = true; }
      }
      if (payload.feed.length && !posts.length) throw new Error('Bluesky account returned no usable posts');
      handled++;
      return posts;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (missing(error)) { handled++; return []; }
      partial = true; failedAccounts.push(actor);
      return previousPosts.filter(post => post.sourceId === 'bluesky' && String(post.sourceAccount || '').toLowerCase() === actor.toLowerCase())
        .slice(0, perAccount).map(post => normalizePost({ ...post, stale: true, commentsMode: 'live' })).filter(Boolean);
    }
  }));
  const posts = interleave(groups, limit);
  if (!handled && !posts.length) throw new Error('Bluesky accounts could not be refreshed');
  return { posts, partial, failedAccounts: actors.filter(actor => failedAccounts.includes(actor)) };
}

function thread(post, comments, values = {}) {
  return { version: 1, postId: post.id, sourceId: post.sourceId, fetchedAt: new Date().toISOString(),
    bodyHtml: post.bodyHtml || '', embeds: post.embeds || [], sensitive: Boolean(post.sensitive), contentWarning: post.contentWarning || '',
    comments, commentCount: post.commentCount ?? null,
    complete: false, truncated: false, stale: false, notice: '', live: true, ...values };
}

function unavailable(id, parentId, url = '', message = 'Parent post unavailable in this public view.') {
  return { id, parentId, author: 'Unavailable', publishedAt: null, score: null,
    bodyHtml: paragraph(message), embeds: [], sensitive: false, contentWarning: '', url, replyUrl: url, children: [], unavailable: true };
}

export async function fetchBlueskyThread(post, { request, signal }) {
  if (!blueskyUrl(post.atUri)) throw new Error('Invalid Bluesky post URI');
  const params = new URLSearchParams({ uri: post.atUri, depth: String(BLUESKY_DEPTH), parentHeight: '0' });
  let payload;
  try { payload = await request(`${BLUESKY_API}app.bsky.feed.getPostThread?${params}`, signal); }
  catch (error) { if (missing(error)) throw removed(); throw error; }
  const root = payload?.thread;
  if (!record(root)) throw new Error('Invalid Bluesky thread');
  if (root.notFound || root.blocked) throw removed();
  if (!record(root.post) || root.post.uri !== post.atUri) throw new Error('Wrong Bluesky thread');
  const seen = new Set([post.atUri]);
  let budget = MAX_BLUESKY_COMMENTS, partial = false;
  function walk(parent, parentId, depth) {
    let children = parent.replies ?? [];
    if (!Array.isArray(children)) { children = []; partial = true; }
    const expected = number(parent.post?.replyCount);
    if (expected === null || expected > children.length) partial = true;
    const result = [];
    for (const node of children) {
      if (budget <= 0 || depth > BLUESKY_DEPTH) { partial = true; break; }
      if (!record(node)) { partial = true; continue; }
      const view = record(node.post) ? node.post : {};
      const uri = String(view.uri || node.uri || '');
      if (!uri || seen.has(uri)) { partial = true; continue; }
      seen.add(uri); budget--;
      let comment;
      if (node.blocked || node.notFound || !record(node.post)) {
        comment = unavailable(uri, parentId, blueskyUrl(uri), 'This reply is unavailable or blocked in the public view.');
        partial = true;
      } else {
        const url = blueskyUrl(uri, view.author);
        const content = blueskyContent(view);
        comment = { id: uri, parentId, author: '@' + String(view.author?.handle || view.author?.did || 'unknown'),
          publishedAt: date(view.record?.createdAt), score: number(view.likeCount),
          bodyHtml: content.bodyHtml, embeds: content.embeds, sensitive: content.sensitive, contentWarning: content.contentWarning,
          url, replyUrl: url, children: [] };
      }
      comment.children = walk(node, uri, depth + 1);
      result.push(comment);
    }
    return result;
  }
  const comments = walk(root, null, 1);
  const content = blueskyContent(root.post);
  return thread(post, comments, { bodyHtml: content.bodyHtml, embeds: content.embeds,
    sensitive: content.sensitive, contentWarning: content.contentWarning,
    commentCount: number(root.post.replyCount), complete: !partial, truncated: partial,
    notice: partial ? 'Some replies are unavailable in this public Bluesky view. Open Bluesky for the complete conversation.' : '' });
}

function mastodonInstance(value) {
  const instance = String(value || '').trim().replace(/\/+$/, '');
  const valid = safeUrl(instance);
  if (!valid) throw new Error('Invalid Mastodon instance');
  const url = new URL(valid);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) throw new Error('Mastodon instance must be an HTTPS origin');
  // Preserve the configured spelling to match the collector's SHA-256 input.
  return instance;
}

function mastodonBody(status) {
  let body = String(status.content || '');
  const warning = String(status.spoiler_text || '').trim();
  if (warning) body = paragraph('Content warning: ' + warning) + body;
  return body;
}

function mastodonMedia(status) {
  const embeds = [];
  for (const media of (Array.isArray(status.media_attachments) ? status.media_attachments : []).slice(0, MAX_EMBEDS)) {
    if (!record(media)) continue;
    const url = mediaUrl(media.url) || mediaUrl(media.remote_url);
    if (!url) continue;
    const base = { url, alt: String(media.description || '').slice(0, 3000), ...dimensions(media.meta?.original || media.meta) };
    if (media.type === 'image') embeds.push({ type: 'image', ...base, thumbnailUrl: mediaUrl(media.preview_url) });
    else if (['video', 'gifv'].includes(media.type)) embeds.push({ type: 'video', ...base, posterUrl: mediaUrl(media.preview_url) });
    else if (media.type === 'audio') embeds.push({ type: 'audio', ...base });
    else embeds.push({ type: 'link', url, title: base.alt || 'Attached media', description: '' });
  }
  const card = record(status.card) ? status.card : {};
  const url = mediaUrl(card.url);
  if (url) embeds.push({ type: 'link', url, title: String(card.title || '').slice(0, 300),
    description: String(card.description || '').slice(0, 1000), imageUrl: mediaUrl(card.image), siteName: String(card.provider_name || '').slice(0, 120) });
  const contentWarning = String(status.spoiler_text || '').trim();
  return { embeds: embeds.slice(0, MAX_EMBEDS), sensitive: Boolean(status.sensitive || contentWarning), contentWarning: contentWarning || (status.sensitive ? 'Sensitive content' : '') };
}

async function mastodonPost(status, instance, tag) {
  const localId = String(status.id || '');
  const canonical = safeUrl(status.url) || safeUrl(status.uri);
  if (!/^\d+$/.test(localId) || !canonical) throw new Error('Invalid Mastodon status');
  const text = plainHtml(status.content);
  const sourceItemId = await identity(instance + '/' + localId);
  return normalizePost({ id: `mastodon:${sourceItemId}`, sourceId: 'mastodon', sourceItemId,
    title: short(status.spoiler_text || text || 'Mastodon media post'), url: canonical, discussionUrl: canonical,
    author: '@' + String(status.account?.acct || status.account?.username || 'unknown'),
    publishedAt: date(status.created_at), score: number(status.favourites_count), commentCount: number(status.replies_count),
    tags: [tag], excerpt: short(text, 320), bodyHtml: mastodonBody(status), ...mastodonMedia(status), bodyKind: 'post', commentsMode: 'live',
    threadPath: null, mastodonLocalId: localId, sourceInstance: instance });
}

export async function fetchMastodonFeed({ instance, tag = 'technology', request, signal, limit = 25 }) {
  instance = mastodonInstance(instance);
  tag = String(tag ?? '').trim().replace(/^#+/, '');
  if (!tag) throw new Error('Configure a nonempty Mastodon hashtag');
  limit = limitTo(limit);
  const payload = await request(`${instance}/api/v1/timelines/tag/${quote(tag)}?limit=${limit}`, signal);
  if (!Array.isArray(payload) || payload.length && !payload.some(record)) throw new Error('Invalid Mastodon timeline');
  const posts = [], seen = new Set();
  let partial = false, candidates = 0;
  for (const item of payload.slice(0, limit)) {
    const status = record(item?.reblog) ? item.reblog : item;
    if (!record(status)) { partial = true; continue; }
    if (status.deleted || status.removed || !['public', 'unlisted'].includes(status.visibility || 'public')) continue;
    if (seen.has(String(status.id))) continue;
    candidates++;
    try {
      const post = await mastodonPost(status, instance, tag);
      seen.add(post.mastodonLocalId); posts.push(post);
    } catch { partial = true; }
  }
  if (candidates && !posts.length) throw new Error('Mastodon timeline returned no usable posts');
  return { posts, partial };
}

function nestComments(comments, rootId) {
  const nodes = new Map(comments.filter(node => node.id !== rootId).map(node => [node.id, node]));
  let partial = nodes.size !== comments.length;
  for (const node of [...nodes.values()]) {
    if (node.parentId === rootId) node.parentId = null;
    else if (node.parentId && !nodes.has(node.parentId)) {
      nodes.set(node.parentId, unavailable(node.parentId, null)); partial = true;
    }
  }
  const roots = [];
  for (const node of nodes.values()) {
    const seen = new Set([node.id]);
    let cursor = node.parentId;
    while (nodes.has(cursor)) {
      if (seen.has(cursor)) { node.parentId = null; partial = true; break; }
      seen.add(cursor); cursor = nodes.get(cursor).parentId;
    }
    if (nodes.has(node.parentId)) nodes.get(node.parentId).children.push(node);
    else roots.push(node);
  }
  return { comments: roots, partial };
}

export async function fetchMastodonThread(post, { request, signal }) {
  const instance = mastodonInstance(post.sourceInstance);
  const id = String(post.mastodonLocalId || '');
  if (!/^\d+$/.test(id)) throw new Error('Invalid Mastodon status ID');
  let current;
  try { current = await request(`${instance}/api/v1/statuses/${id}`, signal); }
  catch (error) { if (missing(error)) throw removed(); throw error; }
  if (!record(current) || String(current.id) !== id) throw new Error('Wrong Mastodon status');
  if (current.deleted || current.removed || !['public', 'unlisted'].includes(current.visibility || 'public')) throw removed();
  const payload = await request(`${instance}/api/v1/statuses/${id}/context`, signal);
  if (!record(payload) || !Array.isArray(payload.descendants)) throw new Error('Invalid Mastodon context');
  const comments = [];
  let partial = false;
  for (const status of payload.descendants.slice(0, MAX_MASTODON_COMMENTS)) {
    if (!record(status) || !/^\d+$/.test(String(status.id || '')) || status.deleted || status.removed || !['public', 'unlisted'].includes(status.visibility || 'public')) {
      partial = true; continue;
    }
    const url = safeUrl(status.url) || safeUrl(status.uri) || '';
    comments.push({ id: String(status.id), parentId: status.in_reply_to_id ? String(status.in_reply_to_id) : null,
      author: '@' + String(status.account?.acct || status.account?.username || 'unknown'),
      publishedAt: date(status.created_at), score: number(status.favourites_count), bodyHtml: mastodonBody(status), ...mastodonMedia(status),
      url, replyUrl: url, children: [] });
  }
  const nested = nestComments(comments, id);
  return thread(post, nested.comments, { bodyHtml: mastodonBody(current), ...mastodonMedia(current), commentCount: number(current.replies_count),
    truncated: partial || nested.partial || payload.descendants.length >= MAX_MASTODON_COMMENTS,
    notice: 'This public Mastodon view shows up to 60 replies known to this instance. Other servers may have more; open the original for the full conversation.' });
}
