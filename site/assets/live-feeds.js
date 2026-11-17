// Only publishers verified to allow anonymous cross-origin browser requests.
export const LIVE_FEEDS = Object.freeze({
  rustweekly: "https://this-week-in-rust.org/rss.xml",
  quanta: "https://www.quantamagazine.org/feed/",
  nasa: "https://www.nasa.gov/news-release/feed/",
  gamedeveloper: "https://www.gamedeveloper.com/rss.xml",
  dw: 'https://rss.dw.com/rdf/rss-en-all',
  wired: 'https://www.wired.com/feed/rss',
  // The public headlines.atom URL redirects without CORS headers. Its official
  // destination permits CORS and returns the same publisher feed directly.
  register: 'https://api.theregister.com/api/v1/article?orderBy=published&site_id=2&remapper=rss&content=node',
});

const PREVIEW_ONLY = new Set(['wired', 'register', 'rustweekly', 'quanta', 'nasa', 'gamedeveloper']);
const PREVIEW_LIMIT = 1200;
const SPACE_BEFORE = new Set(['P', 'BR', 'DIV', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3']);
const SPACE_AFTER = new Set(['P', 'DIV', 'LI', 'BLOCKQUOTE']);

function quotePlus(value) {
  // Python urllib.parse.urlencode leaves '~' alone and encodes '*'.
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, '+');
}

// Operates on entity-decoded input. Preserve the original authority/path instead
// of URL.href normalization: the Python collector hashes this exact spelling.
export function canonicalFeedUrl(value) {
  const raw = String(value || '').trim().replace(/[\t\r\n]/g, '');
  const parts = /^(https?):\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/is.exec(raw);
  if (!parts) return '';
  try {
    const parsed = new URL(raw);
    if (!parsed.hostname || parsed.username || parsed.password) return '';
  } catch { return ''; }
  const query = [...new URLSearchParams(parts[4] || '')]
    .filter(([key]) => !key.toLowerCase().startsWith('utm_') && !['fbclid', 'gclid'].includes(key.toLowerCase()))
    .map(([key, val]) => `${quotePlus(key)}=${quotePlus(val)}`).join('&');
  return `${parts[1].toLowerCase()}://${parts[2]}${parts[3]}${query ? `?${query}` : ''}${parts[5] ? `#${parts[5]}` : ''}`;
}

export async function publisherItemId(identity) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

export function truncateFeedText(value, limit) {
  const characters = Array.from(value);
  if (!limit || characters.length <= limit) return value;
  const prefix = characters.slice(0, Math.max(0, limit - 1)).join('');
  const boundary = prefix.lastIndexOf(' ');
  return `${(boundary < 0 ? prefix : prefix.slice(0, boundary)).trimEnd()}…`;
}

function decodeReferences(value) {
  // Escaping '<' retains literal markup while decoding character references.
  // Templates are inert; external feed content never enters the live DOM.
  const template = document.createElement('template');
  template.innerHTML = String(value || '').replace(/</g, '&lt;');
  return template.content.textContent;
}

function canonicalUrl(value) {
  return canonicalFeedUrl(decodeReferences(value));
}

function plain(value, limit) {
  const template = document.createElement('template');
  template.innerHTML = String(value || '');
  const pieces = [];
  function visit(node) {
    if (node.nodeType === 3) { pieces.push(node.textContent); return; }
    if (node.nodeType !== 1 || node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
    if (SPACE_BEFORE.has(node.tagName)) pieces.push(' ');
    for (const child of node.childNodes) visit(child);
    if (SPACE_AFTER.has(node.tagName)) pieces.push(' ');
  }
  for (const child of template.content.childNodes) visit(child);
  return truncateFeedText(pieces.join('').replace(/[\s\u0085]+/gu, ' ').trim(), limit);
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function children(element, name) {
  return Array.from(element.children).filter(child => child.localName === name);
}

function childText(element, name, fallback = '') {
  const child = children(element, name)[0];
  return child ? child.textContent.trim() : fallback;
}

function publishedAt(value) {
  if (!value) return null;
  // Match the collector's UTC interpretation of ISO dates without an offset.
  const date = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(value) ? `${value}Z` : value;
  const time = Date.parse(date);
  return Number.isFinite(time) ? new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
}

function commentCount(entry) {
  for (const child of children(entry, 'comments')) {
    const value = child.firstChild?.textContent?.trim() || '';
    if (/^[+-]?\d+$/.test(value)) {
      const count = Number(value);
      if (Number.isSafeInteger(count)) return count;
    }
  }
  return null;
}

// Parser export also supports offline verification against collector fixtures.
// bodyHtml remains untrusted and must pass the app's renderer sanitizer.
export async function parsePublisherFeed(xml, sourceId, limit = 25) {
  if (!Object.hasOwn(LIVE_FEEDS, sourceId)) throw new Error('Unsupported live publisher');
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid feed limit');
  const doc = new DOMParser().parseFromString(String(xml), 'application/xml');
  const root = doc.documentElement;
  if (!root || root.localName === 'parsererror' || doc.getElementsByTagNameNS('*', 'parsererror').length) throw new Error('Invalid publisher feed XML');
  const atom = root.localName === 'feed';
  if (!['feed', 'rss', 'RDF'].includes(root.localName)) throw new Error('Unsupported publisher feed format');
  const entries = Array.from(root.getElementsByTagNameNS('*', atom ? 'entry' : 'item'));
  const posts = [], seen = new Set();
  for (const entry of entries) {
    if (posts.length >= limit) break;
    let url, discussion, identity, author, date, summary, body, tags;
    if (atom) {
      const links = children(entry, 'link');
      url = links.find(link => (link.getAttribute('rel') || 'alternate') === 'alternate')?.getAttribute('href') || '';
      discussion = links.find(link => link.getAttribute('rel') === 'replies' && (link.getAttribute('type') || '').includes('html'))?.getAttribute('href') || url;
      identity = childText(entry, 'id', url);
      author = children(entry, 'author')[0] ? childText(children(entry, 'author')[0], 'name') : '';
      date = childText(entry, 'published') || childText(entry, 'updated');
      summary = childText(entry, 'summary');
      body = childText(entry, 'content') || summary;
      tags = children(entry, 'category').map(child => child.getAttribute('term') || '');
    } else {
      url = childText(entry, 'link');
      discussion = children(entry, 'comments').find(child => canonicalUrl(child.textContent))?.textContent.trim() || url;
      identity = childText(entry, 'guid', url);
      author = childText(entry, 'creator') || childText(entry, 'author');
      date = childText(entry, 'pubDate') || childText(entry, 'date');
      summary = childText(entry, 'description');
      body = childText(entry, 'encoded') || summary;
      tags = Array.from(entry.children).filter(child => ['category', 'subject'].includes(child.localName)).map(child => child.textContent);
    }
    if (PREVIEW_ONLY.has(sourceId)) {
      const preview = plain(summary, PREVIEW_LIMIT) || plain(body, PREVIEW_LIMIT);
      body = preview ? `<p>${escapeHtml(preview)}</p>` : '';
      summary = body;
    }
    url = canonicalUrl(url);
    const title = plain(childText(entry, 'title'));
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    identity = canonicalUrl(identity) || identity || url;
    const itemId = await publisherItemId(identity);
    posts.push({
      id: `${sourceId}:${itemId}`, sourceId, sourceItemId: itemId,
      title: plain(title), url, discussionUrl: canonicalUrl(discussion) || url,
      author: plain(author), publishedAt: publishedAt(date), score: null,
      commentCount: commentCount(entry), tags: tags.filter(Boolean).map(tag => plain(tag)).slice(0, 8),
      excerpt: plain(summary || body, 320), bodyHtml: body, bodyKind: 'excerpt',
      commentsMode: 'external', threadPath: null,
    });
  }
  if (!posts.length) throw new Error('Feed returned no usable articles');
  return posts;
}

export async function fetchPublisherFeed(sourceId, { request, signal, limit = 25 }) {
  if (!Object.hasOwn(LIVE_FEEDS, sourceId)) throw new Error('Unsupported live publisher');
  const xml = await request(LIVE_FEEDS[sourceId], signal, 'text');
  return { posts: await parsePublisherFeed(xml, sourceId, limit), partial: false };
}
