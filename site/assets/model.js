export const SOURCES = [
  { id: 'hn', name: 'Hacker News', short: 'HN', homeUrl: 'https://news.ycombinator.com/', color: '#c65322', commentMode: 'live' },
  { id: 'lobsters', name: 'Lobsters', short: 'L', homeUrl: 'https://lobste.rs/', color: '#a73a42', commentMode: 'snapshot' },
  { id: 'dev', name: 'DEV Community', short: 'DEV', homeUrl: 'https://dev.to/', color: '#4942a4', commentMode: 'live' },
  { id: 'ars', name: 'Ars Technica', short: 'ars', homeUrl: 'https://arstechnica.com/', color: '#bd4e21', commentMode: 'external' },
  { id: 'verge', name: 'The Verge', short: 'V', homeUrl: 'https://www.theverge.com/', color: '#6745ae', commentMode: 'external' },
  { id: 'techcrunch', name: 'TechCrunch', short: 'TC', homeUrl: 'https://techcrunch.com/', color: '#267448', commentMode: 'external' },
  { id: 'slashdot', name: 'Slashdot', short: '/.', homeUrl: 'https://slashdot.org/', color: '#24777a', commentMode: 'external' },
  { id: 'register', name: 'The Register', short: 'R', homeUrl: 'https://www.theregister.com/', color: '#d6292f', commentMode: 'external' },
  { id: 'wired', name: 'WIRED', short: 'W', homeUrl: 'https://www.wired.com/', color: '#222222', commentMode: 'external' },
  { id: 'media404', name: '404 Media', short: '404', homeUrl: 'https://www.404media.co/', color: '#c4542f', commentMode: 'external' },
  {"id": "lwn", "name": "LWN.net", "homeUrl": "https://lwn.net/", "short": "LWN", "color": "#397751", "commentMode": "external", "category": "linux", "description": "Kernel internals and free-software reporting"},
  {"id": "kernel", "name": "Linux Kernel Releases", "homeUrl": "https://www.kernel.org/", "short": "K", "color": "#397751", "commentMode": "external", "category": "linux", "description": "Official mainline, stable, and long-term kernel releases"},
  {"id": "phoronix", "name": "Phoronix", "homeUrl": "https://www.phoronix.com/", "short": "P", "color": "#397751", "commentMode": "external", "category": "linux", "description": "Linux hardware, graphics drivers, and performance"},
  {"id": "rustweekly", "name": "This Week in Rust", "homeUrl": "https://this-week-in-rust.org/", "short": "RS", "color": "#397751", "commentMode": "external", "category": "linux", "topics": ["technology"], "description": "Weekly Rust development and community digest"},
  {"id": "hackaday", "name": "Hackaday", "homeUrl": "https://hackaday.com/", "short": "H", "color": "#64748b", "commentMode": "external", "category": "technology", "description": "Electronics, hardware hacking, and maker projects"},
  {"id": "krebs", "name": "KrebsOnSecurity", "homeUrl": "https://krebsonsecurity.com/", "short": "KS", "color": "#64748b", "commentMode": "external", "category": "technology", "description": "Cybersecurity and cybercrime investigations"},
  {"id": "spectrum", "name": "IEEE Spectrum", "homeUrl": "https://spectrum.ieee.org/", "short": "IEEE", "color": "#64748b", "commentMode": "external", "category": "technology", "description": "Engineering, robotics, semiconductors, and energy"},
  {"id": "quanta", "name": "Quanta Magazine", "homeUrl": "https://www.quantamagazine.org/", "short": "Q", "color": "#466ca8", "commentMode": "external", "category": "science", "description": "Mathematics, physics, biology, and theoretical computing"},
  {"id": "sciencenews", "name": "Science News", "homeUrl": "https://www.sciencenews.org/", "short": "SN", "color": "#466ca8", "commentMode": "external", "category": "science", "description": "Independent reporting across the sciences"},
  {"id": "nature", "name": "Nature", "homeUrl": "https://www.nature.com/nature/", "short": "N", "color": "#466ca8", "commentMode": "external", "category": "science", "description": "Research, science news, and policy"},
  {"id": "physicsworld", "name": "Physics World", "homeUrl": "https://physicsworld.com/", "short": "PW", "color": "#466ca8", "commentMode": "external", "category": "science", "description": "Physics research and applications"},
  {"id": "nasa", "name": "NASA", "homeUrl": "https://www.nasa.gov/", "short": "NASA", "color": "#466ca8", "commentMode": "external", "category": "science", "description": "Official mission, science, and engineering news releases"},
  {"id": "aftermath", "name": "Aftermath", "homeUrl": "https://aftermath.site/", "short": "A", "color": "#8c5294", "commentMode": "external", "category": "gaming", "description": "Independent games, labor, and internet-culture reporting"},
  {"id": "remap", "name": "Remap", "homeUrl": "https://remapradio.com/", "short": "RM", "color": "#8c5294", "commentMode": "external", "category": "gaming", "description": "Independent written reviews, features, and criticism"},
  {"id": "rps", "name": "Rock Paper Shotgun", "homeUrl": "https://www.rockpapershotgun.com/", "short": "RPS", "color": "#8c5294", "commentMode": "external", "category": "gaming", "description": "PC games, indie discovery, criticism, and reviews"},
  {"id": "gamingonlinux", "name": "GamingOnLinux", "homeUrl": "https://www.gamingonlinux.com/", "short": "GOL", "color": "#8c5294", "commentMode": "external", "category": "gaming", "topics": ["linux"], "description": "Linux gaming, Steam Deck, Proton, and compatibility"},
  {"id": "gamedeveloper", "name": "Game Developer", "homeUrl": "https://www.gamedeveloper.com/", "short": "GD", "color": "#8c5294", "commentMode": "external", "category": "gaming", "description": "Game development, design, production, and industry reporting"},
  {"id": "gamesindustry", "name": "GamesIndustry.biz", "homeUrl": "https://www.gamesindustry.biz/", "short": "GI", "color": "#8c5294", "commentMode": "external", "category": "gaming", "description": "Game studios, business, labor, and industry reporting"},
  {"id": "digitalfoundry", "name": "Digital Foundry", "homeUrl": "https://www.digitalfoundry.net/", "short": "DF", "color": "#8c5294", "commentMode": "external", "category": "gaming", "description": "Technical game, graphics, hardware, and performance analysis"},
  { id: 'bbc', name: 'BBC World', short: 'BBC', homeUrl: 'https://www.bbc.com/news/world', category: 'news', commentMode: 'external' },
  { id: 'guardian', name: 'The Guardian', short: 'G', homeUrl: 'https://www.theguardian.com/world', category: 'news', commentMode: 'external' },
  { id: 'npr', name: 'NPR News', short: 'NPR', homeUrl: 'https://www.npr.org/sections/news/', category: 'news', commentMode: 'external' },
  { id: 'aljazeera', name: 'Al Jazeera', short: 'AJ', homeUrl: 'https://www.aljazeera.com/', category: 'news', commentMode: 'external' },
  { id: 'dw', name: 'DW News', short: 'DW', homeUrl: 'https://www.dw.com/en/', category: 'news', commentMode: 'external' },
  { id: 'pbs', name: 'PBS News', short: 'PBS', homeUrl: 'https://www.pbs.org/newshour/', color: '#2875ce', category: 'news', commentMode: 'external' },
  { id: 'propublica', name: 'ProPublica', short: 'PP', homeUrl: 'https://www.propublica.org/', color: '#236a8d', category: 'news', commentMode: 'external' },
  { id: 'sciencedaily', name: 'ScienceDaily', short: 'SD', homeUrl: 'https://www.sciencedaily.com/', color: '#357d5d', category: 'science', commentMode: 'external' },
  { id: 'bluesky', name: 'Bluesky', short: 'B', homeUrl: 'https://bsky.app/', category: 'social', commentMode: 'live' },
  { id: 'mastodon', name: 'Mastodon', short: 'M', homeUrl: 'https://mastodon.social/tags/technology', category: 'social', commentMode: 'live' },
  { id: 'x', name: 'X / Twitter', short: 'X', homeUrl: 'https://x.com/', category: 'social', commentMode: 'snapshot', optional: true },
].map(source => ({ category: 'technology', ...source }));

export const LEGACY_SOURCES = ['hn', 'lobsters', 'dev', 'ars', 'verge', 'techcrunch', 'slashdot'];

export const TOPICS = [
  { id: 'all', name: 'All topics' },
  { id: 'technology', name: 'Technology' },
  { id: 'linux', name: 'Linux & open source' },
  { id: 'science', name: 'Science' },
  { id: 'gaming', name: 'Gaming' },
  { id: 'news', name: 'World news' },
  { id: 'social', name: 'Social' },
];

export function restoreSources(settings) {
  if (!Array.isArray(settings?.selectedSources)) return new Set(SOURCES.filter(source => !source.optional).map(source => source.id));
  const selected = new Set(settings.selectedSources.filter(id => SOURCES.some(source => source.id === id)));
  const known = new Set(Array.isArray(settings.knownSources) ? settings.knownSources : LEGACY_SOURCES);
  for (const source of SOURCES) if (!source.optional && !known.has(source.id)) selected.add(source.id);
  return selected;
}

export const SOURCE_MAP = new Map(SOURCES.map(source => [source.id, source]));

export function safeUrl(value, base = undefined) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function safeThreadPath(value) {
  return typeof value === 'string' && /^data\/threads\/[a-z0-9_-]+\.json$/i.test(value) ? value : null;
}

export function timestamp(value) {
  const number = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(number) ? number : 0;
}

export function timeAgo(value, now = Date.now()) {
  const time = timestamp(value);
  if (!time) return 'Date unavailable';
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export function calendarDay(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function validCalendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function archiveDaysForDate(value) {
  if (!validCalendarDay(value)) return [];
  // The files use UTC publication days. A local calendar day can cross the
  // boundary into either adjacent UTC day, including during DST changes.
  const middle = new Date(`${value}T12:00:00Z`);
  return [-1, 0, 1].map(offset => {
    const date = new Date(middle);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  });
}

export function calendarMonthDays(month) {
  if (!validCalendarDay(`${month}-01`)) return [];
  const first = new Date(`${month}-01T12:00:00`);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12).getDate();
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    return day > 0 && day <= count ? `${month}-${String(day).padStart(2, '0')}` : null;
  });
}

export function shiftCalendarMonth(month, offset) {
  if (!validCalendarDay(`${month}-01`) || !Number.isInteger(offset)) return '';
  const date = new Date(`${month}-01T12:00:00`);
  date.setMonth(date.getMonth() + offset);
  return calendarDay(date).slice(0, 7);
}

export function normalizePost(post) {
  if (!post || !SOURCE_MAP.has(post.sourceId) || typeof post.id !== 'string' || !post.title) return null;
  const url = safeUrl(post.url);
  const discussionUrl = safeUrl(post.discussionUrl) || url;
  if (!url || !discussionUrl) return null;
  return {
    ...post, title: String(post.title), author: String(post.author || ''),
    sourceItemId: String(post.sourceItemId || ''), url, discussionUrl,
    excerpt: String(post.excerpt || ''), bodyHtml: String(post.bodyHtml || ''),
    embeds: Array.isArray(post.embeds) ? post.embeds.slice(0, 16) : [],
    linkPreview: normalizeLinkPreview(post.linkPreview, url),
    sensitive: Boolean(post.sensitive), contentWarning: String(post.contentWarning || ''),
    tags: Array.isArray(post.tags) ? post.tags.filter(tag => typeof tag === 'string') : [],
    score: Number.isFinite(post.score) ? post.score : null,
    commentCount: Number.isFinite(post.commentCount) ? post.commentCount : null,
    threadPath: safeThreadPath(post.threadPath),
  };
}

export function normalizeLinkPreview(preview, postUrl) {
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) return null;
  const url = safeUrl(preview.url);
  if (!url || url !== safeUrl(postUrl)) return null;
  return {
    url, title: String(preview.title || '').slice(0, 300),
    description: String(preview.description || '').slice(0, 600),
    imageUrl: safeUrl(preview.imageUrl, url) || '',
    siteName: String(preview.siteName || '').slice(0, 120),
    fetchedAt: typeof preview.fetchedAt === 'string' ? preview.fetchedAt : null,
  };
}

export function protectPost(post, unavailableIds = new Set()) {
  return unavailableIds.has(post.id) || post.unavailable
    ? { ...post, unavailable: true, bodyHtml: '', embeds: [], linkPreview: null,
      excerpt: 'This post is no longer publicly available.', commentCount: null }
    : post;
}

export function newestThreadFallback(postId, ...candidates) {
  let newest = null;
  for (const candidate of candidates) {
    if (candidate?.postId !== postId || !Array.isArray(candidate.comments) || candidate.removed || candidate.loading
      || !Number.isFinite(Date.parse(candidate.fetchedAt))) continue;
    if (!newest || Date.parse(candidate.fetchedAt) > Date.parse(newest.fetchedAt)) newest = candidate;
  }
  return newest;
}

export function selectPosts(posts, { selectedSources, topic = 'all', query = '', sort = 'balanced', unreadOnly = false, readIds = new Set(), selectedDate = '' }) {
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const seen = new Set();
  const filtered = posts.filter(post => {
    if (seen.has(post.id) || !selectedSources.has(post.sourceId) || (unreadOnly && readIds.has(post.id))) return false;
    seen.add(post.id);
    const source = SOURCE_MAP.get(post.sourceId);
    if (topic !== 'all' && source?.category !== topic && !source?.topics?.includes(topic)) return false;
    if (selectedDate && calendarDay(post.publishedAt) !== selectedDate) return false;
    const searchable = `${post.title} ${post.author} ${post.excerpt} ${post.tags.join(' ')} ${source?.name || ''} ${source?.description || ''} ${source?.category || ''} ${(source?.topics || []).join(' ')}`.toLocaleLowerCase();
    return tokens.every(token => searchable.includes(token));
  });
  const newest = (a, b) => timestamp(b.publishedAt) - timestamp(a.publishedAt) || a.id.localeCompare(b.id);
  if (sort === 'newest') return filtered.sort(newest);
  if (sort === 'discussed') return filtered.sort((a, b) => (b.commentCount ?? -1) - (a.commentCount ?? -1) || newest(a, b));
  const categoryIds = [...new Set([...TOPICS.filter(topic => topic.id !== 'all').map(topic => topic.id), ...SOURCES.map(source => source.category)])];
  const categories = categoryIds.map(category => SOURCES.filter(source => source.category === category));
  const sourceOrder = [];
  for (let index = 0; categories.some(category => index < category.length); index++) {
    for (const category of categories) if (category[index]) sourceOrder.push(category[index]);
  }
  const groups = sourceOrder.map(source => filtered.filter(post => post.sourceId === source.id));
  const balanced = [];
  for (let rank = 0; groups.some(group => rank < group.length); rank++) {
    for (const group of groups) if (group[rank]) balanced.push(group[rank]);
  }
  return balanced;
}

export function hnPost(item) {
  if (!item || item.deleted || item.dead || !item.title) return null;
  const discussionUrl = `https://news.ycombinator.com/item?id=${item.id}`;
  return normalizePost({
    id: `hn:${item.id}`, sourceId: 'hn', sourceItemId: String(item.id), title: item.title,
    url: safeUrl(item.url) || discussionUrl, discussionUrl, author: item.by,
    publishedAt: new Date((item.time || 0) * 1000).toISOString(), score: item.score,
    commentCount: item.descendants ?? 0, tags: [], excerpt: '', bodyHtml: item.text || '',
    bodyKind: 'post', commentsMode: 'live', threadPath: null,
  });
}

export function hnComment(item, storyId) {
  if (!item || !item.id) return null;
  const removed = item.deleted || item.dead;
  return {
    id: String(item.id), parentId: String(item.parent || storyId), author: item.by || '[deleted]',
    publishedAt: item.time ? new Date(item.time * 1000).toISOString() : null, score: null,
    bodyHtml: removed ? '<p>[Comment unavailable]</p>' : item.text || '',
    url: `https://news.ycombinator.com/item?id=${item.id}`,
    replyUrl: `https://news.ycombinator.com/reply?id=${item.id}&goto=${encodeURIComponent(`item?id=${storyId}`)}`,
    children: [], _childIds: Array.isArray(item.kids) ? item.kids : [], _loaded: 0,
  };
}

export function devPost(item) {
  return normalizePost({
    id: `dev:${item.id}`, sourceId: 'dev', sourceItemId: String(item.id), title: item.title,
    url: item.url, discussionUrl: `${item.url}#comments`, author: item.user?.username || '',
    publishedAt: item.published_at, score: item.positive_reactions_count,
    commentCount: item.comments_count, tags: Array.isArray(item.tag_list) ? item.tag_list : [],
    excerpt: item.description || '', bodyHtml: item.body_html || '', bodyKind: 'article', commentsMode: 'live', threadPath: null,
  });
}

export function devComments(comments, parentId = null) {
  if (!Array.isArray(comments)) return [];
  return comments.map(comment => {
    const id = String(comment.id_code || comment.id || '');
    const user = comment.user?.username;
    const url = user && id ? `https://dev.to/${encodeURIComponent(user)}/comment/${encodeURIComponent(id)}` : null;
    return {
      id, parentId, author: user || '[deleted]', publishedAt: comment.created_at || null,
      score: null, bodyHtml: comment.body_html || '<p>[Comment unavailable]</p>', url, replyUrl: url,
      children: devComments(comment.children, id),
    };
  });
}

export function mergeSourcePosts(current, incoming, sourceId) {
  const previous = new Map(current.filter(post => post.sourceId === sourceId).map(post => [post.id, post]));
  const merged = incoming.map(post => {
    const old = previous.get(post.id);
    const keepBody = !post.unavailable && !['bluesky', 'mastodon', 'x'].includes(sourceId);
    return { ...post, bodyHtml: post.bodyHtml || (keepBody && old?.bodyHtml) || '', threadPath: post.threadPath || old?.threadPath || null,
      linkPreview: post.unavailable ? null : normalizeLinkPreview(post.linkPreview, post.url) || normalizeLinkPreview(old?.linkPreview, post.url) };
  });
  return [...current.filter(post => post.sourceId !== sourceId), ...merged];
}
