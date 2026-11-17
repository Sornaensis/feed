import { SOURCES, SOURCE_MAP, TOPICS, safeUrl, timeAgo, normalizePost, normalizeLinkPreview, selectPosts, hnPost, hnComment, devPost, devComments, mergeSourcePosts, calendarDay, validCalendarDay, archiveDaysForDate, calendarMonthDays, shiftCalendarMonth, protectPost as protectUnavailablePost, newestThreadFallback } from './model.js?v=6';
import { sanitizedFragment } from './sanitize.js?v=2';
import { renderEmbeds, renderLinkPreview, inlineMediaLinks, disposeEmbeds } from './embeds.js?v=1';
import { LIVE_FEEDS, fetchPublisherFeed } from './live-feeds.js?v=2';
import { fetchBlueskyFeed, fetchMastodonFeed, fetchBlueskyThread, fetchMastodonThread } from './live-social.js?v=4';

const $ = selector => document.querySelector(selector);
const STORAGE_KEY = 'tech-reader:settings:v1';
const CACHE_KEY = 'tech-reader:feed:v1';
const PAGE_SIZE = 28;
const COMMENT_PAGE = 20;
const FIREBASE = 'https://hacker-news.firebaseio.com/v0';
const LIVE_THREADS = new Set(['hn', 'dev', 'bluesky', 'mastodon']);
const state = {
  posts: [], sources: new Map(), selectedSources: new Set(SOURCES.map(source => source.id)),
  readIds: new Set(), unavailableIds: new Set(), saved: new Map(), view: 'all', topic: 'all', query: '', sort: 'balanced', unreadOnly: false,
  selectedDate: '', archivePosts: [], archiveIndex: null, archiveLoading: false, archiveError: '',
  calendarMonth: calendarDay(new Date()).slice(0, 7),
  limit: PAGE_SIZE, open: new Map(), threads: new Map(), generatedAt: null, refreshing: false, clientConfig: {},
};
let toastTimer;
let refreshVersion = 0;
let archiveVersion = 0;
const archiveCache = new Map();
let devNextAt = 0;
const devRequests = [];

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function button(text, action, className = 'story-action') {
  const element = el('button', className, text);
  element.type = 'button';
  element.dataset.action = action;
  return element;
}

function link(text, url, className = 'story-action') {
  const element = el('a', className, text);
  const href = safeUrl(url);
  if (href) { element.href = href; element.target = '_blank'; element.rel = 'noopener noreferrer'; }
  return element;
}

function icon(name) {
  const paths = {
    book: ['M4 4h5a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4z', 'M20 4h-5a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h4z'],
    message: ['M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z', 'M7 9h10M7 13h6'],
    external: ['M14 3h7v7M21 3l-11 11', 'M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5'],
    bookmark: ['M6 3h12v18l-6-4-6 4z'],
    check: ['m5 12 4 4L19 6'],
    close: ['m6 6 12 12M18 6 6 18'],
    reply: ['m9 5-6 6 6 6', 'M3 11h10a7 7 0 0 1 7 7'],
    link: ['m10 13 4-4', 'M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0', 'M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0'],
    refresh: ['M20 7a8 8 0 0 0-14-2L3 8', 'M3 3v5h5', 'M4 17a8 8 0 0 0 14 2l3-3', 'M21 21v-5h-5'],
    theme: ['M21 12a9 9 0 1 1-9-9 7 7 0 0 0 9 9Z'],
    sun: ['M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z', 'M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
    search: ['M19 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z', 'm16 16 5 5'],
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.65');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of paths[name] || []) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}

function withIcon(control, name) { control.prepend(icon(name)); return control; }

function notify(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}

function storageGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

function persist() {
  const value = {
    readIds: [...state.readIds].slice(-3000),
    unavailableIds: [...state.unavailableIds].slice(-3000),
    saved: [...state.saved.values()], sort: state.sort, theme: document.documentElement.dataset.theme,
  };
  if (!storageSet(STORAGE_KEY, value)) notify('Browser storage is full or disabled. Changes will last for this visit.');
}

function restore() {
  const saved = storageGet(STORAGE_KEY);
  if (!saved || typeof saved !== 'object') return;
  if (Array.isArray(saved.readIds)) state.readIds = new Set(saved.readIds.filter(id => typeof id === 'string').slice(-3000));
  if (Array.isArray(saved.unavailableIds)) state.unavailableIds = new Set(saved.unavailableIds.filter(id => typeof id === 'string').slice(-3000));
  if (Array.isArray(saved.saved)) state.saved = new Map(saved.saved.map(normalizePost).filter(Boolean).map(protectPost).map(post => [post.id, post]));
  if (['balanced', 'newest', 'discussed'].includes(saved.sort)) state.sort = saved.sort;
  if (['light', 'dark'].includes(saved.theme)) document.documentElement.dataset.theme = saved.theme;
}

async function request(url, signal, format = 'json') {
  if (new URL(url).hostname === 'dev.to') {
    // Forem's anonymous API is limited to 2/second and 25/minute.
    const earliest = Math.max(Date.now(), devNextAt, devRequests.length >= 24 ? devRequests[devRequests.length - 24] + 61000 : 0);
    devNextAt = earliest + 650;
    devRequests.push(earliest);
    if (devRequests.length > 48) devRequests.splice(0, devRequests.length - 48);
    if (earliest > Date.now()) await new Promise(resolve => setTimeout(resolve, earliest - Date.now()));
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 15000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache' });
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    // Bound both JSON and publisher XML reads, including chunked responses.
    const maximum = format === 'text' ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > maximum) { await reader.cancel(); throw new Error('Feed response is too large'); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const content = new TextDecoder().decode(bytes);
    return format === 'text' ? content : JSON.parse(content);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

async function mapLimit(items, concurrency, operation) {
  const result = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      result[index] = await operation(items[index]);
    }
  }));
  return result;
}

function sourceBadge(source) {
  const badge = el('span', `source-badge topic-${source.category} source-${source.id}`, source.short);
  badge.setAttribute('aria-hidden', 'true');
  return badge;
}

function renderCalendar() {
  const today = calendarDay(new Date());
  let earliest;
  if (state.view === 'saved') {
    earliest = [...state.saved.values()].map(post => calendarDay(post.publishedAt)).filter(Boolean).sort()[0] || today;
  } else {
    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - ((state.archiveIndex?.retentionDays || 30) - 1));
    earliest = calendarDay(cutoff);
  }
  const month = state.calendarMonth;
  $('#calendarMonth').textContent = new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('#calendarPrev').disabled = month <= earliest.slice(0, 7);
  $('#calendarNext').disabled = month >= today.slice(0, 7);
  const focusDate = document.activeElement?.closest('#calendarDays button')?.dataset.date;
  const cells = calendarMonthDays(month);
  const weeks = document.createDocumentFragment();
  for (let index = 0; index < cells.length; index += 7) {
    const row = el('tr');
    for (const date of cells.slice(index, index + 7)) {
      const cell = el('td');
      if (date) {
        const day = button(String(Number(date.slice(-2))), 'calendar-date', `calendar-day${date === today ? ' is-today' : ''}`);
        day.dataset.date = date;
        day.disabled = date < earliest || date > today;
        day.setAttribute('aria-label', new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
        day.setAttribute('aria-pressed', String(date === state.selectedDate));
        if (date === today) day.setAttribute('aria-current', 'date');
        cell.append(day);
      }
      row.append(cell);
    }
    weeks.append(row);
  }
  $('#calendarDays').replaceChildren(weeks);
  if (focusDate) $('#calendarDays').querySelector(`button[data-date="${focusDate}"]:not(:disabled)`)?.focus({ preventScroll: true });
  $('#calendarSelection').hidden = !state.selectedDate;
  $('#calendarSelection').textContent = state.selectedDate
    ? `Showing ${new Date(`${state.selectedDate}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}` : '';
  $('#clearDateButton').hidden = !state.selectedDate;
  const showNote = Boolean(state.selectedDate && state.view === 'all');
  $('#archiveNote').hidden = !showNote;
  $('#archiveNote').textContent = state.archiveLoading ? 'Loading collected stories…'
    : state.archiveError || `Older results include stories collected during the last ${state.archiveIndex?.retentionDays || 30} days.`;
  $('#retryArchiveButton').hidden = !showNote || !state.archiveError || state.archiveLoading;
}

function protectPost(post) {
  return protectUnavailablePost(post, state.unavailableIds);
}

function availablePosts() {
  if (state.view === 'saved') return [...state.saved.values()].map(protectPost);
  if (!state.selectedDate) return state.posts.map(protectPost);
  const posts = new Map(state.archivePosts.map(post => [post.id, post]));
  for (const post of state.posts) {
    const old = posts.get(post.id);
    const keepBody = !post.unavailable && !['bluesky', 'mastodon', 'x'].includes(post.sourceId);
    posts.set(post.id, { ...old, ...post, bodyHtml: post.bodyHtml || (keepBody && old?.bodyHtml) || '', threadPath: post.threadPath || old?.threadPath || null,
      linkPreview: normalizeLinkPreview(post.linkPreview, post.url) || normalizeLinkPreview(old?.linkPreview, post.url) });
  }
  return [...posts.values()].map(protectPost);
}

async function loadSelectedArchive(force = false) {
  const version = ++archiveVersion;
  const date = state.selectedDate;
  state.archiveError = '';
  if (!date || state.view === 'saved') {
    state.archiveLoading = false;
    renderFeed();
    return;
  }
  state.archiveLoading = true;
  renderFeed();
  try {
    let index = state.archiveIndex;
    if (!index || force) {
      const result = await request(new URL('data/archive/index.json', document.baseURI).href);
      if (version !== archiveVersion) return;
      if (result?.version !== 1 || !Array.isArray(result.days)) throw new Error('Invalid archive index');
      const days = result.days.filter(day => validCalendarDay(day?.date) && day.path === `data/archive/${day.date}.json`);
      if (days.length !== result.days.length) throw new Error('Invalid archive paths');
      if (force || index?.generatedAt !== result.generatedAt) archiveCache.clear();
      index = { ...result, days, retentionDays: Number.isInteger(result.retentionDays) && result.retentionDays > 0 ? result.retentionDays : 30 };
      state.archiveIndex = index;
    }
    const candidates = new Set(archiveDaysForDate(date));
    const days = index.days.filter(day => candidates.has(day.date));
    const results = await Promise.allSettled(days.map(async day => {
      if (archiveCache.has(day.date)) return archiveCache.get(day.date);
      const result = await request(new URL(day.path, document.baseURI).href);
      if (result?.version !== 1 || result.date !== day.date || !Array.isArray(result.posts)) throw new Error('Invalid archive day');
      const posts = result.posts.map(normalizePost).filter(Boolean).map(protectPost);
      if (version === archiveVersion) {
        archiveCache.set(day.date, posts);
        while (archiveCache.size > 9) archiveCache.delete(archiveCache.keys().next().value);
      }
      return posts;
    }));
    if (version !== archiveVersion) return;
    const received = results.filter(result => result.status === 'fulfilled').flatMap(result => result.value);
    const failed = results.some(result => result.status === 'rejected');
    const posts = new Map((failed ? state.archivePosts : []).map(post => [post.id, post]));
    for (const post of received) posts.set(post.id, post);
    state.archivePosts = [...posts.values()];
    for (const post of state.posts) {
      const archived = posts.get(post.id);
      if (!state.unavailableIds.has(post.id) && !post.unavailable && !['bluesky', 'mastodon', 'x'].includes(post.sourceId)
        && !post.bodyHtml && archived?.bodyHtml) post.bodyHtml = archived.bodyHtml;
      if (!post.threadPath && archived?.threadPath) post.threadPath = archived.threadPath;
      if (!post.linkPreview && !post.unavailable) post.linkPreview = normalizeLinkPreview(archived?.linkPreview, post.url);
    }
    if (failed) state.archiveError = 'Some older results could not be loaded. Showing the stories available here.';
  } catch {
    if (version === archiveVersion) state.archiveError = 'Older results could not be loaded. Showing matching stories already available here.';
  } finally {
    if (version === archiveVersion) {
      state.archiveLoading = false;
      renderFeed();
    }
  }
}

function setDate(value) {
  state.selectedDate = validCalendarDay(value) ? value : '';
  state.calendarMonth = (state.selectedDate || calendarDay(new Date())).slice(0, 7);
  state.archivePosts = [];
  state.limit = PAGE_SIZE;
  loadSelectedArchive();
}

function hasFilters() { return Boolean(state.topic !== 'all' || state.query.trim() || state.unreadOnly || state.selectedDate); }

function clearSearch() {
  state.query = ''; state.limit = PAGE_SIZE;
  $('#searchInput').value = '';
  renderFeed(); $('#searchInput').focus();
}

function clearFilters() {
  state.query = ''; state.unreadOnly = false; state.topic = 'all';
  $('#searchInput').value = ''; $('#unreadOnly').checked = false;
  setDate(''); $('#searchInput').focus();
}

function renderStatus() {
  const available = SOURCES.filter(source => state.posts.some(post => post.sourceId === source.id)).length;
  const live = [...state.sources.values()].filter(source => source.status === 'live').length;
  const updated = state.generatedAt ? `Feed snapshot ${timeAgo(state.generatedAt)}` : 'Live feeds';
  const filtered = visiblePosts();
  const date = state.selectedDate && new Date(`${state.selectedDate}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const resultCount = `${filtered.length} ${state.unreadOnly ? 'unread ' : ''}${state.view === 'saved' ? 'saved ' : ''}${filtered.length === 1 ? 'story' : 'stories'}`;
  $('#feedStatus').textContent = state.archiveLoading ? 'Loading older stories…'
    : date ? `${resultCount} · ${date}`
    : hasFilters() || state.view === 'saved' ? `${resultCount}${state.query.trim() ? ' found' : ''}`
    : state.refreshing ? 'Checking the latest stories…' : `${available} sources${live ? ` · ${live} refreshed live` : ''} · ${updated}`;
  $('#clearSearchButton').hidden = !state.query;
  $('#searchShortcut').hidden = Boolean(state.query);
  $('#filterReset').hidden = !hasFilters();
  for (const control of $('#topicFilters').querySelectorAll('[data-topic]')) {
    control.setAttribute('aria-pressed', String(control.dataset.topic === state.topic));
  }
  $('#refreshButton').disabled = state.refreshing;
  $('#refreshButton').setAttribute('aria-busy', String(state.refreshing));
  $('#feedList').setAttribute('aria-busy', String(state.archiveLoading));
}

function getPost(id) { return state.posts.find(post => post.id === id) || state.archivePosts.find(post => post.id === id) || state.saved.get(id); }

function visiblePosts() {
  return selectPosts(availablePosts(), state);
}

function hasStartedMedia(node) {
  return Boolean(node?.querySelector('.media-native-player:not([data-playback-error]), .media-provider-player'));
}

function renderFeed({ preserveMedia = false } = {}) {
  // Background feed completion must not tear down a player the reader just
  // started. Fresh results remain in state for the next filter/navigation action.
  if (preserveMedia && hasStartedMedia($('#feedList'))) {
    for (const story of [...$('#feedList').children]) {
      if (getPost(story.dataset.postId)?.unavailable) updateStory(story.dataset.postId);
    }
    if (hasStartedMedia($('#feedList'))) { renderStatus(); return; }
  }
  const posts = visiblePosts();
  const fragment = document.createDocumentFragment();
  for (const [index, post] of posts.slice(0, state.limit).entries()) fragment.append(renderStory(post, index));
  disposeEmbeds($('#feedList'));
  $('#feedList').replaceChildren(fragment);
  const loading = state.refreshing || state.archiveLoading;
  $('#emptyState').hidden = posts.length > 0 || loading;
  if (!posts.length && !loading) {
    const emptySaved = state.view === 'saved' && !state.saved.size;
    const heading = emptySaved ? 'Your reading list starts here.' : hasFilters() ? 'No stories match these filters.' : 'No stories to show yet.';
    const note = emptySaved ? 'Save a story to return to it later. Your list stays in this browser.'
      : state.selectedDate ? 'Try another date or clear your filters. The archive contains previously collected stories.'
      : hasFilters() ? 'Try a different search or clear your filters.' : 'Refresh to check for the latest stories.';
    $('#emptyState').replaceChildren(el('h2', '', heading), el('p', '', note));
    if (emptySaved || hasFilters()) {
      const action = button(emptySaved ? 'Browse feed' : 'Clear filters', emptySaved ? 'browse-feed' : 'clear-filters', 'empty-action');
      action.addEventListener('click', () => { if (emptySaved) state.view = 'all'; clearFilters(); });
      $('#emptyState').append(action);
    }
  }
  $('#loadMoreButton').hidden = posts.length <= state.limit;
  $('#loadMoreButton').textContent = `Show ${Math.min(PAGE_SIZE, Math.max(0, posts.length - state.limit))} more stories`;
  for (const nav of document.querySelectorAll('[data-view]')) {
    nav.classList.toggle('active', nav.dataset.view === state.view);
    nav.setAttribute('aria-pressed', String(nav.dataset.view === state.view));
    if (nav.dataset.view === state.view) nav.setAttribute('aria-current', 'page'); else nav.removeAttribute('aria-current');
  }
  $('#savedCount').textContent = state.saved.size;
  $('#allCount').textContent = state.posts.length;
  renderCalendar(); renderStatus();
}

function renderStory(post, index) {
  const source = SOURCE_MAP.get(post.sourceId);
  const story = el('article', `story${state.readIds.has(post.id) ? ' read' : ''}${state.open.has(post.id) ? ' expanded' : ''}`);
  story.dataset.postId = post.id;
  const header = el('div', 'story-header');
  header.append(el('span', 'story-rank', String(index + 1).padStart(2, '0')));
  const main = el('div', 'story-main');
  const meta = el('div', 'story-meta');
  meta.append(sourceBadge(source), el('span', 'source-label', source.name), el('span', 'meta-dot', '·'));
  const time = el('time', '', timeAgo(post.publishedAt));
  if (post.publishedAt) { time.dateTime = post.publishedAt; time.title = new Date(post.publishedAt).toLocaleString(); }
  meta.append(time);
  main.append(meta);
  const heading = el('h2', 'story-title');
  const title = button(post.title, 'title', 'story-title-button');
  title.setAttribute('aria-expanded', String(state.open.has(post.id)));
  title.setAttribute('aria-controls', `content-${post.id.replace(/[^a-z0-9_-]/gi, '-')}`);
  heading.append(title); main.append(heading);
  if (post.excerpt) main.append(el('p', 'story-excerpt', post.excerpt));
  const actions = el('div', 'story-actions');
  const linked = ['hn', 'lobsters'].includes(post.sourceId) && post.url !== post.discussionUrl;
  const read = withIcon(button(post.bodyKind === 'excerpt' || linked ? 'Read preview' : 'Read post', 'read', 'story-action story-primary-action'), 'book');
  read.setAttribute('aria-expanded', String(state.open.get(post.id) === 'post'));
  read.setAttribute('aria-controls', title.getAttribute('aria-controls'));
  if (post.commentsMode === 'external') {
    actions.append(read, withIcon(link('Original article', post.url, 'story-action story-secondary-action'), 'external'));
    if (post.commentCount !== null) actions.append(withIcon(link(`${post.commentCount.toLocaleString()} comments`, post.discussionUrl), 'message'));
  } else {
    const discussion = withIcon(button(post.commentCount === null ? 'Discussion' : `${post.commentCount.toLocaleString()} comments`, 'comments', 'story-action story-secondary-action'), 'message');
    discussion.setAttribute('aria-expanded', String(state.open.get(post.id) === 'comments'));
    discussion.setAttribute('aria-controls', title.getAttribute('aria-controls'));
    actions.append(read, discussion);
  }
  if (post.score !== null) actions.append(el('span', 'story-score', `${post.score} ${['dev', 'bluesky', 'mastodon', 'x'].includes(post.sourceId) ? 'reactions' : 'points'}`));
  if (post.commentsMode !== 'external') actions.append(withIcon(link('Source', post.url), 'external'));
  if (post.author) actions.append(el('span', 'story-author', `by ${post.author}`));
  main.append(actions); header.append(main);
  const save = withIcon(button(state.saved.has(post.id) ? 'Saved' : 'Save', 'save', 'save-button'), state.saved.has(post.id) ? 'check' : 'bookmark');
  save.setAttribute('aria-label', `${state.saved.has(post.id) ? 'Unsave' : 'Save'} ${post.title}`);
  save.setAttribute('aria-pressed', String(state.saved.has(post.id)));
  save.title = state.saved.has(post.id) ? 'Remove from saved' : 'Save for later';
  header.append(save); story.append(header);
  if (state.open.has(post.id)) story.append(renderExpanded(post));
  return story;
}

function renderExpanded(post) {
  const panel = el('section', 'story-content');
  panel.id = `content-${post.id.replace(/[^a-z0-9_-]/gi, '-')}`;
  panel.setAttribute('aria-label', `${post.title} — expanded`);
  const mode = state.open.get(post.id);
  const previewOnly = post.commentsMode === 'external';
  const controls = el('div', 'reader-controls');
  if (previewOnly) controls.append(withIcon(el('span', 'reader-label', 'Article preview'), 'book'));
  else {
    const tabs = el('div', 'reader-tabs');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', 'Reader view');
    const linked = ['hn', 'lobsters'].includes(post.sourceId) && post.url !== post.discussionUrl;
    const postTab = withIcon(button(post.bodyKind === 'excerpt' || linked ? 'Preview' : 'Post', 'read', `reader-tab${mode === 'post' ? ' active' : ''}`), 'book');
    postTab.setAttribute('aria-pressed', String(mode === 'post'));
    tabs.append(postTab);
    const commentTab = withIcon(button('Discussion', 'comments', `reader-tab${mode === 'comments' ? ' active' : ''}`), 'message');
    commentTab.setAttribute('aria-pressed', String(mode === 'comments'));
    tabs.append(commentTab);
    controls.append(tabs);
  }
  const close = withIcon(button('Close', 'close', 'reader-close'), 'close');
  close.setAttribute('aria-label', `Close reader for ${post.title}`);
  controls.append(close); panel.append(controls);
  const thread = state.threads.get(post.id);
  const bodyHtml = thread && !thread.loading && typeof thread.bodyHtml === 'string' ? thread.bodyHtml : post.bodyHtml;
  const embeds = post.unavailable || thread?.removed ? [] : Array.isArray(thread?.embeds) ? thread.embeds : post.embeds || [];
  const sensitive = thread?.sensitive ?? post.sensitive;
  const contentWarning = thread?.contentWarning ?? post.contentWarning;
  if (mode === 'post') {
    const surface = el('div', 'reader-surface');
    if (!previewOnly) {
      const intro = el('div', 'reader-intro');
      intro.append(el('h3', 'reader-kicker', post.bodyKind === 'excerpt' ? 'Article preview' : bodyHtml ? 'Post' : 'Link submission'), el('span', 'reader-deck', SOURCE_MAP.get(post.sourceId).name));
      surface.append(intro);
    }
    if (bodyHtml) {
      const body = el('div', 'reader-body');
      body.append(sanitizedFragment(bodyHtml, post.url)); surface.append(body);
    } else if (thread?.loading && !embeds.length) surface.append(el('p', 'thread-status', 'Loading the post…'));
    else if (!embeds.length && (post.url === post.discussionUrl || post.unavailable)) surface.append(el('p', 'reader-body', post.excerpt || (post.commentsMode === 'external'
      ? 'A preview is not available for this story. Open the original article to read it in full.'
      : 'This post shares a link. Open the original article to read it in full, or switch to Discussion to read the conversation.')));
    if (embeds.length) surface.append(renderEmbeds(embeds, { baseUrl: post.discussionUrl, sensitive, contentWarning }));
    else if (!post.unavailable && !thread?.removed) {
      const preview = renderLinkPreview(post);
      if (preview) surface.append(preview);
    }
    if (bodyHtml && !post.unavailable) {
      const linkedMedia = inlineMediaLinks(bodyHtml, post.url)
        .filter(media => media.url !== post.url && !embeds.some(embed => embed.url === media.url));
      if (linkedMedia.length) surface.append(renderEmbeds(linkedMedia, { baseUrl: post.url, sensitive, contentWarning }));
    }
    const note = post.bodyKind === 'excerpt'
      ? 'An excerpt from the publisher’s feed. Continue at the source for the full story.'
      : embeds.length ? 'Media from the original post. Open the source to reply.'
      : bodyHtml ? 'From the original post. Replies open at the source.' : 'The complete article is available on the original site.';
    const footer = el('div', 'reader-footer');
    footer.append(el('p', 'reader-note', note), withIcon(link('Open original', post.url, 'reader-source-link'), 'external'));
    panel.append(surface, footer);
    if (thread?.error) appendThreadError(panel, post, thread.error);
    return panel;
  }
  if (['hn', 'lobsters'].includes(post.sourceId) && !post.unavailable) {
    const preview = renderLinkPreview(post);
    if (preview) {
      const sharedLink = el('div', 'discussion-link-preview');
      sharedLink.append(preview); panel.append(sharedLink);
    }
  }
  const heading = el('div', 'discussion-header');
  const count = thread?.commentCount ?? post.commentCount;
  heading.append(el('h3', '', `${count === null ? '' : count.toLocaleString() + ' '}comments`));
  heading.append(withIcon(link(`Reply on ${SOURCE_MAP.get(post.sourceId).name}`, postReplyUrl(post), 'reply-link'), 'external'));
  if (!thread?.loading) heading.append(withIcon(button('Refresh', 'refresh-thread', 'story-action'), 'refresh'));
  panel.append(heading);
  if (thread?.loading) { panel.append(el('p', 'thread-status', 'Opening the conversation…')); return panel; }
  if (!thread) { panel.append(el('p', 'thread-status', 'Opening the conversation…')); return panel; }
  if (thread.error) appendThreadError(panel, post, thread.error);
  if (thread.fetchedAt) {
    panel.append(el('p', 'reader-note', `${thread.live ? 'Fetched' : 'Saved discussion from'} ${timeAgo(thread.fetchedAt)}. Replies open the exact comment on ${SOURCE_MAP.get(post.sourceId).name}.`));
  }
  if (thread.truncated || thread.complete === false && !thread._rootIds) panel.append(el('p', 'reader-note', 'Only part of this conversation is available here. Open the source for the complete discussion.'));
  if (thread.notice) panel.append(el('p', 'reader-note', thread.notice));
  const comments = el('div', 'comments');
  const visibleCount = thread._visibleRoots || COMMENT_PAGE;
  for (const comment of (thread.comments || []).slice(0, visibleCount)) comments.append(renderComment(comment, post, 0));
  panel.append(comments);
  const remaining = thread._rootIds ? thread._rootIds.length - (thread._loaded || 0) : (thread.comments?.length || 0) - visibleCount;
  if (remaining > 0) {
    const more = button(thread._loadingMore ? 'Loading…' : `Show more comments (${remaining})`, 'more-comments', 'load-comments');
    more.disabled = Boolean(thread._loadingMore); panel.append(more);
  }
  if (!thread.comments?.length && !thread.error) {
    const incomplete = thread.complete === false || thread.truncated || (post.commentCount ?? 0) > 0;
    panel.append(el('p', 'thread-status', incomplete
      ? 'No replies are available in this public view. Open the source to check the conversation.'
      : 'No comments were returned by the source. You can join the conversation there.'));
  }
  return panel;
}

function postReplyUrl(post) {
  return post.sourceId === 'hn'
    ? `https://news.ycombinator.com/reply?id=${encodeURIComponent(post.sourceItemId)}&goto=${encodeURIComponent(`item?id=${post.sourceItemId}`)}`
    : post.discussionUrl;
}

function appendThreadError(panel, post, message) {
  const error = el('div', 'thread-error');
  error.append(el('p', '', message), button('Try again', 'retry', 'story-action'), link('Open discussion ↗', post.discussionUrl));
  panel.append(error);
}

function renderComment(comment, post, depth) {
  const node = el('article', `comment${depth >= 6 ? ' deep-comment' : ''}`);
  node.dataset.commentId = String(comment.id);
  const header = el('div', 'comment-header');
  const toggle = button(comment._collapsed ? '+' : '−', 'collapse-comment', 'comment-toggle');
  const author = comment.author || '[deleted]';
  toggle.setAttribute('aria-label', `${comment._collapsed ? 'Expand' : 'Collapse'} comment by ${author}`);
  toggle.setAttribute('aria-expanded', String(!comment._collapsed));
  const avatar = el('span', 'comment-avatar', author.replace(/^@/, '').slice(0, 2).toUpperCase());
  avatar.setAttribute('aria-hidden', 'true');
  const identity = el('div', 'comment-identity');
  const authorRow = el('div', 'comment-author-row');
  authorRow.append(el('strong', 'comment-author', author));
  const details = el('div', 'comment-details');
  if (comment.publishedAt) {
    const time = el('time', '', timeAgo(comment.publishedAt));
    time.dateTime = comment.publishedAt; time.title = new Date(comment.publishedAt).toLocaleString(); details.append(time);
  }
  if (comment.score !== null && comment.score !== undefined) details.append(el('span', '', `${comment.score} ${['bluesky', 'mastodon', 'x'].includes(post.sourceId) ? 'reactions' : 'points'}`));
  identity.append(authorRow, details); header.append(avatar, identity, toggle);
  node.append(header);
  if (comment._collapsed) return node;
  const main = el('div', 'comment-main');
  const body = el('div', 'comment-body');
  body.append(sanitizedFragment(comment.bodyHtml, post.discussionUrl)); main.append(body);
  if (!comment.unavailable) {
    const embeds = Array.isArray(comment.embeds) ? comment.embeds : [];
    const linkedMedia = inlineMediaLinks(comment.bodyHtml, post.discussionUrl)
      .filter(media => !embeds.some(embed => embed.url === media.url));
    if (embeds.length || linkedMedia.length) main.append(renderEmbeds([...embeds, ...linkedMedia], {
      baseUrl: comment.url || post.discussionUrl, compact: true,
      sensitive: comment.sensitive, contentWarning: comment.contentWarning,
    }));
  }
  const actions = el('div', 'comment-actions');
  if (safeUrl(comment.replyUrl || comment.url)) actions.append(withIcon(link('Reply at source', comment.replyUrl || comment.url, 'reply-link'), 'reply'));
  if (safeUrl(comment.url)) actions.append(withIcon(link('Permalink', comment.url, 'permalink'), 'link'));
  const childCount = comment._childIds ? comment._childIds.length : comment.children?.length || 0;
  if (childCount) {
    const expand = button(comment._loading ? 'Loading replies…' : comment._expanded ? 'Hide replies' : `Show ${childCount} ${childCount === 1 ? 'reply' : 'replies'}`, 'replies', 'reply-toggle');
    expand.disabled = Boolean(comment._loading); expand.setAttribute('aria-expanded', String(Boolean(comment._expanded)));
    actions.append(expand);
  }
  main.append(actions);
  if (comment._error) main.append(el('p', 'reader-note', comment._error));
  node.append(main);
  if (comment._expanded) {
    const children = el('div', 'comment-children');
    for (const child of (comment.children || []).slice(0, comment._visibleChildren || COMMENT_PAGE)) children.append(renderComment(child, post, depth + 1));
    const remaining = comment._childIds ? comment._childIds.length - (comment._loaded || 0) : (comment.children?.length || 0) - (comment._visibleChildren || COMMENT_PAGE);
    if (remaining > 0) {
      const more = button(comment._loading ? 'Loading…' : `More replies (${remaining})`, 'more-replies', 'load-comments');
      more.disabled = Boolean(comment._loading); children.append(more);
    }
    node.append(children);
  }
  return node;
}

function updateStory(id, { preserveMedia = false } = {}) {
  const element = [...$('#feedList').children].find(child => child.dataset.postId === id);
  const post = getPost(id);
  if (!element || !post) return;
  if (preserveMedia && !post.unavailable && !state.threads.get(id)?.removed &&
      state.open.get(id) === 'post' && hasStartedMedia(element)) return;
  const active = document.activeElement;
  const focus = element.contains(active) && active.dataset.action ? {
    action: active.dataset.action,
    commentId: active.closest('[data-comment-id]')?.dataset.commentId,
    readerTab: active.classList.contains('reader-tab'),
  } : null;
  const index = [...$('#feedList').children].indexOf(element);
  const replacement = renderStory(post, index);
  disposeEmbeds(element);
  element.replaceWith(replacement);
  if (focus) {
    const control = [...replacement.querySelectorAll('[data-action]')].find(candidate =>
      candidate.dataset.action === focus.action && candidate.classList.contains('reader-tab') === focus.readerTab &&
      candidate.closest('[data-comment-id]')?.dataset.commentId === focus.commentId);
    (control || replacement.querySelector('.story-title-button'))?.focus({ preventScroll: true });
  }
}

function findComment(comments, id) {
  for (const comment of comments || []) {
    if (String(comment.id) === id) return comment;
    const nested = findComment(comment.children, id);
    if (nested) return nested;
  }
  return null;
}

async function fetchHnComments(ids, storyId) {
  return (await mapLimit(ids, 6, async id => hnComment(await request(`${FIREBASE}/item/${id}.json`), storyId))).filter(Boolean);
}

async function fetchHnThread(post) {
  const item = await request(`${FIREBASE}/item/${post.sourceItemId}.json`);
  if (!item || item.deleted || item.dead) {
    const error = new Error('This post is no longer available at Hacker News.');
    error.removed = true;
    throw error;
  }
  const ids = Array.isArray(item.kids) ? item.kids : [];
  const first = ids.slice(0, COMMENT_PAGE);
  return {
    postId: post.id, fetchedAt: new Date().toISOString(), bodyHtml: item.text || '', live: true,
    commentCount: item.descendants ?? post.commentCount, comments: await fetchHnComments(first, post.sourceItemId),
    _rootIds: ids, _loaded: first.length, _visibleRoots: first.length, complete: first.length === ids.length,
  };
}

async function fetchDevThread(post) {
  const [article, comments] = await Promise.allSettled([
    request(`https://dev.to/api/articles/${post.sourceItemId}`), request(`https://dev.to/api/comments?a_id=${post.sourceItemId}`),
  ]);
  if (article.status === 'rejected' && comments.status === 'rejected') throw new Error('DEV unavailable');
  let cached = null;
  if ((article.status === 'rejected' || comments.status === 'rejected') && post.threadPath) {
    try {
      const candidate = await request(new URL(post.threadPath, document.baseURI).href);
      if (candidate?.postId === post.id && Array.isArray(candidate.comments)) cached = candidate;
    } catch { /* An unavailable fallback is reported with the partial live result. */ }
  }
  return {
    postId: post.id, fetchedAt: new Date().toISOString(), live: true,
    bodyHtml: article.status === 'fulfilled' ? article.value.body_html : cached?.bodyHtml || post.bodyHtml,
    comments: comments.status === 'fulfilled' ? devComments(comments.value) : cached?.comments || [],
    commentCount: article.status === 'fulfilled' ? article.value.comments_count : post.commentCount,
    complete: comments.status === 'fulfilled' || Boolean(cached?.complete),
    ...(comments.status === 'rejected' && cached ? { live: false, fetchedAt: cached.fetchedAt, truncated: cached.truncated } : {}),
    error: comments.status === 'rejected' ? cached ? 'Live comments are unavailable. Showing the saved discussion.' : 'The live comments could not be loaded.' : article.status === 'rejected' ? 'The live article could not be refreshed.' : null,
  };
}

async function loadThread(post, force = false) {
  const existing = state.threads.get(post.id);
  if (existing?.loading || existing && !force) return;
  state.threads.set(post.id, { loading: true, comments: [], bodyHtml: existing?.bodyHtml || post.bodyHtml || '',
    embeds: existing?.embeds ?? post.embeds, sensitive: existing?.sensitive ?? post.sensitive,
    contentWarning: existing?.contentWarning ?? post.contentWarning }); updateStory(post.id, { preserveMedia: true });
  try {
    let thread;
    if (post.sourceId === 'hn') thread = await fetchHnThread(post);
    else if (post.sourceId === 'dev') thread = await fetchDevThread(post);
    else if (post.sourceId === 'bluesky') thread = await fetchBlueskyThread(post, { request });
    else if (post.sourceId === 'mastodon') thread = await fetchMastodonThread(post, { request });
    else if (post.threadPath) thread = await request(new URL(post.threadPath, document.baseURI).href);
    else throw new Error('No snapshot');
    if (!thread || !Array.isArray(thread.comments)) throw new Error('Invalid thread');
    if (thread.postId && thread.postId !== post.id) throw new Error('Wrong thread');
    if (thread.live && (['bluesky', 'mastodon'].includes(post.sourceId) || state.unavailableIds.has(post.id) || post.unavailable)) {
      state.unavailableIds.delete(post.id);
      const excerpt = sanitizedFragment(thread.bodyHtml || '', post.url).textContent.replace(/\s+/g, ' ').trim().slice(0, 320);
      for (const candidate of [post, ...state.posts, ...state.archivePosts, state.saved.get(post.id)]) {
        if (candidate?.id !== post.id) continue;
        Object.assign(candidate, { unavailable: false, bodyHtml: thread.bodyHtml || '', excerpt, commentCount: thread.commentCount ?? null,
          embeds: Array.isArray(thread.embeds) ? thread.embeds : [],
          sensitive: Boolean(thread.sensitive), contentWarning: thread.contentWarning || '' });
      }
      persist();
      if (state.posts.length) storageSet(CACHE_KEY, { version: 1, posts: state.posts, sources: [...state.sources.values()],
        generatedAt: state.generatedAt, clientConfig: state.clientConfig });
    }
    state.threads.set(post.id, { ...thread, loading: false, live: Boolean(thread.live) });
  } catch (error) {
    if (error.removed || existing?.removed || state.unavailableIds.has(post.id) || post.unavailable) {
      const message = error.removed ? error.message : existing?.error || 'This post is no longer publicly available.';
      state.unavailableIds.add(post.id);
      for (const candidate of [post, ...state.posts, ...state.archivePosts, state.saved.get(post.id)]) {
        if (candidate?.id !== post.id) continue;
        candidate.bodyHtml = ''; candidate.embeds = []; candidate.linkPreview = null;
        candidate.excerpt = 'This post is no longer publicly available.';
        candidate.unavailable = true; candidate.commentCount = null;
      }
      persist();
      state.threads.set(post.id, { comments: [], bodyHtml: '', embeds: [], error: message, removed: true });
      updateStory(post.id);
      return;
    }
    let fallback = newestThreadFallback(post.id, existing);
    if (post.threadPath) {
      try {
        const snapshot = await request(new URL(post.threadPath, document.baseURI).href);
        fallback = newestThreadFallback(post.id, fallback, snapshot);
      } catch { /* Show a visible failure below; never invent an empty discussion. */ }
    }
    state.threads.set(post.id, fallback
      ? { ...fallback, loading: false, live: false, error: LIVE_THREADS.has(post.sourceId) ? 'Live comments are unavailable. Showing the saved discussion.' : 'The latest discussion could not be refreshed. Showing the saved copy.' }
      : { comments: [], bodyHtml: post.bodyHtml, embeds: post.embeds, sensitive: post.sensitive, contentWarning: post.contentWarning,
        error: 'This discussion could not be loaded. You can still open it at the source.' });
  }
  updateStory(post.id, { preserveMedia: true });
}

async function moreComments(post, comment = null) {
  const thread = state.threads.get(post.id);
  const owner = comment || thread;
  if (!owner) return;
  const ids = comment ? owner._childIds : owner._rootIds;
  if (!ids) {
    if (comment) owner._visibleChildren = (owner._visibleChildren || COMMENT_PAGE) + COMMENT_PAGE;
    else owner._visibleRoots = (owner._visibleRoots || COMMENT_PAGE) + COMMENT_PAGE;
    updateStory(post.id); return;
  }
  const batch = ids.slice(owner._loaded || 0, (owner._loaded || 0) + COMMENT_PAGE);
  owner._loading = true; owner._loadingMore = true; updateStory(post.id);
  try {
    const comments = await fetchHnComments(batch, post.sourceItemId);
    if (comment) { owner.children.push(...comments); owner._visibleChildren = owner.children.length; }
    else { owner.comments.push(...comments); owner._visibleRoots = owner.comments.length; }
    owner._loaded = (owner._loaded || 0) + batch.length; owner._error = null;
  } catch {
    owner._error = 'Replies could not be loaded. Try again or open the source.';
    notify('Could not load more comments. Your place has been kept.');
  } finally { owner._loading = false; owner._loadingMore = false; updateStory(post.id); }
}

function markRead(post) { state.readIds.add(post.id); persist(); }

async function onStoryAction(event) {
  const control = event.target.closest('[data-action]');
  const story = event.target.closest('[data-post-id]');
  if (!control || !story) return;
  const post = getPost(story.dataset.postId);
  if (!post) return;
  const action = control.dataset.action;
  if (action === 'save') {
    const storyIndex = [...$('#feedList').children].indexOf(story);
    if (state.saved.has(post.id)) state.saved.delete(post.id); else state.saved.set(post.id, post);
    persist();
    if (state.view === 'saved') {
      renderFeed();
      const stories = [...$('#feedList').children];
      const nextStory = stories[Math.min(storyIndex, stories.length - 1)];
      const emptyAction = !$('#emptyState').hidden && $('#emptyState .empty-action');
      (nextStory?.querySelector('.story-title-button') || emptyAction || $('[data-view="all"]'))?.focus();
    } else { updateStory(post.id); $('#savedCount').textContent = state.saved.size; }
    notify(state.saved.has(post.id) ? 'Saved for later.' : 'Removed from saved.'); return;
  }
  if (action === 'close') { state.open.delete(post.id); updateStory(post.id); return; }
  if (['title', 'read', 'comments'].includes(action)) {
    const mode = action === 'comments' || action === 'title' && ['hn', 'lobsters'].includes(post.sourceId) ? 'comments' : 'post';
    if (action === 'title' && state.open.has(post.id)) { state.open.delete(post.id); updateStory(post.id); return; }
    state.open.set(post.id, mode); markRead(post); updateStory(post.id);
    if (mode === 'comments' || ['dev', 'bluesky', 'mastodon'].includes(post.sourceId)) await loadThread(post);
    return;
  }
  if (action === 'retry' || action === 'refresh-thread') { await loadThread(post, true); return; }
  if (action === 'more-comments') { await moreComments(post); return; }
  const commentElement = control.closest('[data-comment-id]');
  const comment = commentElement && findComment(state.threads.get(post.id)?.comments, commentElement.dataset.commentId);
  if (!comment) return;
  if (action === 'collapse-comment') comment._collapsed = !comment._collapsed;
  else if (action === 'replies') {
    comment._expanded = !comment._expanded;
    if (comment._expanded && comment._childIds?.length && !comment._loaded) { await moreComments(post, comment); return; }
  } else if (action === 'more-replies') { await moreComments(post, comment); return; }
  updateStory(post.id);
}

function acceptSnapshot(snapshot) {
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.posts) || !Array.isArray(snapshot.sources)) throw new Error('Invalid feed snapshot');
  state.posts = snapshot.posts.map(normalizePost).filter(Boolean).map(protectPost);
  state.sources = new Map(snapshot.sources.filter(source => SOURCE_MAP.has(source.id)).map(source => [source.id, source]));
  state.generatedAt = snapshot.generatedAt;
  state.clientConfig = snapshot.clientConfig && typeof snapshot.clientConfig === 'object' ? snapshot.clientConfig : {};
  for (const post of state.posts) if (state.saved.has(post.id)) state.saved.set(post.id, post);
}

async function refreshFeeds() {
  if (state.refreshing) return;
  const version = ++refreshVersion;
  state.archiveIndex = null; archiveCache.clear();
  state.refreshing = true; $('#errorBanner').hidden = true; renderStatus();
  let snapshotLoaded = false;
  try {
    const snapshot = await request(new URL('data/feed.json', document.baseURI).href);
    acceptSnapshot(snapshot); storageSet(CACHE_KEY, snapshot); snapshotLoaded = true; renderFeed({ preserveMedia: true });
  } catch {
    if (!state.posts.length) {
      const cached = storageGet(CACHE_KEY);
      if (cached) {
        try {
          acceptSnapshot(cached);
          for (const source of state.sources.values()) if (source.status !== 'disabled') source.status = 'stale';
          renderFeed();
        } catch { /* Invalid local cache is ignored. */ }
      }
    }
  }
  const liveSources = SOURCES.filter(source => ['hn', 'dev'].includes(source.id) || Object.hasOwn(LIVE_FEEDS, source.id)
    || source.id === 'bluesky' && state.clientConfig.bluesky?.actors?.length
    || source.id === 'mastodon' && state.clientConfig.mastodon?.instance);
  await mapLimit(liveSources, 3, async source => {
    try {
      let posts;
      let partial = false;
      if (source.id === 'hn') {
        const ids = await request(`${FIREBASE}/topstories.json`);
        if (!Array.isArray(ids)) throw new Error('Invalid HN feed');
        const previous = new Map(state.posts.map(post => [post.id, post]));
        const results = await mapLimit(ids.slice(0, 25), 6, async id => {
          try { return hnPost(await request(`${FIREBASE}/item/${id}.json`)); }
          catch { partial = true; return previous.get(`hn:${id}`) || null; }
        });
        posts = results.filter(Boolean);
      } else if (source.id === 'dev') {
        const articles = await request('https://dev.to/api/articles?top=7&per_page=25');
        if (!Array.isArray(articles)) throw new Error('Invalid DEV feed');
        posts = articles.map(devPost).filter(Boolean);
      } else if (source.id === 'bluesky') {
        ({ posts, partial } = await fetchBlueskyFeed({ ...state.clientConfig.bluesky, previousPosts: state.posts, request }));
      } else if (source.id === 'mastodon') {
        ({ posts, partial } = await fetchMastodonFeed({ ...state.clientConfig.mastodon, request }));
      } else {
        ({ posts, partial } = await fetchPublisherFeed(source.id, { request }));
      }
      if (!posts.length && !['bluesky', 'mastodon'].includes(source.id)) throw new Error('Empty feed');
      if (version !== refreshVersion) return;
      state.posts = mergeSourcePosts(state.posts, posts, source.id).map(protectPost);
      state.sources.set(source.id, { ...source, status: partial ? 'partial' : 'live', lastSuccess: new Date().toISOString() });
      for (const post of posts) if (state.saved.has(post.id)) state.saved.set(post.id, getPost(post.id));
    } catch {
      if (state.posts.some(post => post.sourceId === source.id)) {
        const previous = state.sources.get(source.id) || source;
        state.sources.set(source.id, { ...previous, status: previous.status === 'ok' ? 'ok' : 'stale' });
      } else state.sources.set(source.id, { ...source, status: 'error' });
    }
  });
  state.refreshing = false;
  if (state.posts.length) storageSet(CACHE_KEY, { version: 1, posts: state.posts, sources: [...state.sources.values()], generatedAt: state.generatedAt, clientConfig: state.clientConfig });
  if (!snapshotLoaded) {
    for (const source of SOURCES) if (!state.sources.has(source.id)) state.sources.set(source.id, { ...source, status: source.optional ? 'disabled' : 'error' });
    $('#errorBanner').textContent = state.posts.length
      ? 'The published feed snapshot could not be refreshed. Showing available live feeds and saved copies.'
      : 'The feeds could not be reached. Check your connection and try Refresh.';
    $('#errorBanner').hidden = false;
  }
  renderFeed({ preserveMedia: true });
  if (state.selectedDate && state.view === 'all') await loadSelectedArchive(true);
  for (const id of state.threads.keys()) if (!state.open.has(id)) state.threads.delete(id);
  await mapLimit([...state.open.keys()], 3, async id => {
    const post = getPost(id);
    if (post && (state.open.get(id) === 'comments' || ['dev', 'bluesky', 'mastodon'].includes(post.sourceId))) await loadThread(post, true);
  });
}

function renderThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const themeButton = $('#themeButton');
  themeButton.replaceChildren(icon(dark ? 'sun' : 'theme'), document.createTextNode(dark ? 'Light' : 'Dark'));
  themeButton.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
  themeButton.title = themeButton.getAttribute('aria-label');
}

function initialize() {
  restore();
  if (!document.documentElement.dataset.theme) document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  $('#editionDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  $('#sortSelect').value = state.sort;
  withIcon($('#refreshButton'), 'refresh');
  renderThemeButton();
  for (const topic of TOPICS) {
    const control = el('button', 'topic-button', topic.name);
    control.type = 'button'; control.dataset.topic = topic.id;
    control.setAttribute('aria-pressed', String(topic.id === state.topic));
    $('#topicFilters').append(control);
  }
  $('#topicFilters').addEventListener('click', event => {
    const control = event.target.closest('button[data-topic]');
    if (!control) return;
    state.topic = control.dataset.topic; state.limit = PAGE_SIZE; renderFeed();
  });
  withIcon($('#clearSearchButton'), 'close');
  $('.search-field').prepend(icon('search'));
  const calendarMedia = matchMedia('(max-width: 900px)');
  const calendarWidget = $('#calendarWidget');
  const calendarSummary = $('#calendarWidget > summary');
  const syncCalendarLayout = () => {
    calendarWidget.open = !calendarMedia.matches;
    calendarSummary.tabIndex = calendarMedia.matches ? 0 : -1;
  };
  syncCalendarLayout();
  calendarMedia.addEventListener('change', syncCalendarLayout);
  calendarSummary.addEventListener('click', event => { if (!calendarMedia.matches) event.preventDefault(); });
  calendarSummary.addEventListener('keydown', event => {
    if (!calendarMedia.matches && ['Enter', ' '].includes(event.key)) event.preventDefault();
  });
  calendarWidget.addEventListener('toggle', () => { if (!calendarMedia.matches && !calendarWidget.open) calendarWidget.open = true; });
  $('#refreshButton').addEventListener('click', refreshFeeds);
  $('#themeButton').addEventListener('click', () => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; renderThemeButton(); persist();
  });
  $('#searchInput').addEventListener('input', event => { state.query = event.target.value; state.limit = PAGE_SIZE; renderFeed(); });
  $('#clearSearchButton').addEventListener('click', clearSearch);
  $('#filterReset').addEventListener('click', clearFilters);
  $('#sortSelect').addEventListener('change', event => { state.sort = event.target.value; state.limit = PAGE_SIZE; persist(); renderFeed(); });
  $('#unreadOnly').addEventListener('change', event => { state.unreadOnly = event.target.checked; state.limit = PAGE_SIZE; renderFeed(); });
  $('#calendarDays').addEventListener('click', event => {
    const day = event.target.closest('button[data-date]');
    if (day && !day.disabled) setDate(day.dataset.date);
  });
  $('#calendarPrev').addEventListener('click', () => { state.calendarMonth = shiftCalendarMonth(state.calendarMonth, -1); renderCalendar(); });
  $('#calendarNext').addEventListener('click', () => { state.calendarMonth = shiftCalendarMonth(state.calendarMonth, 1); renderCalendar(); });
  $('#clearDateButton').addEventListener('click', () => setDate(''));
  $('#retryArchiveButton').addEventListener('click', () => loadSelectedArchive(true));
  for (const nav of document.querySelectorAll('[data-view]')) nav.addEventListener('click', () => { state.view = nav.dataset.view; state.limit = PAGE_SIZE; loadSelectedArchive(); });
  $('#loadMoreButton').addEventListener('click', () => {
    const firstNewIndex = $('#feedList').children.length;
    state.limit += PAGE_SIZE; renderFeed();
    $('#feedList').children[firstNewIndex]?.querySelector('.story-title-button')?.focus();
  });
  $('#feedList').addEventListener('click', event => { onStoryAction(event).catch(() => notify('That action could not be completed. Please try again.')); });
  $('#feedList').addEventListener('click', event => {
    const anchor = event.target.closest('a');
    const story = anchor?.closest('[data-post-id]');
    const post = story && getPost(story.dataset.postId);
    if (post) { markRead(post); story.classList.add('read'); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.isContentEditable && !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) { event.preventDefault(); $('#searchInput').focus(); }
    if (event.key !== 'Escape') return;
    if (event.target === $('#searchInput')) { event.preventDefault(); clearSearch(); return; }
    const story = event.target.closest('.story.expanded');
    if (story) {
      event.preventDefault();
      const id = story.dataset.postId;
      state.open.delete(id); updateStory(id);
      [...$('#feedList').children].find(element => element.dataset.postId === id)?.querySelector('.story-title-button')?.focus({ preventScroll: true });
    }
  });
  renderCalendar(); refreshFeeds();
}

initialize();
