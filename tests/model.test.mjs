import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, safeUrl, safeThreadPath, timeAgo, normalizePost, normalizeLinkPreview, protectPost, newestThreadFallback, selectPosts, hnComment, hnPost, devComments, mergeSourcePosts, restoreSources, calendarDay, validCalendarDay, archiveDaysForDate, calendarMonthDays, shiftCalendarMonth } from '../site/assets/model.js';

function post(sourceId, id, overrides = {}) {
  return normalizePost({ id: `${sourceId}:${id}`, sourceId, sourceItemId: String(id), title: `Story ${id}`, url: `https://example.com/${id}`, publishedAt: '2026-01-01T12:00:00Z', ...overrides });
}

test('links only permit web URLs without embedded credentials', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test', 'https://user:password@example.com', '\n JaVaScRiPt:alert(1)']) assert.equal(safeUrl(url), null);
  assert.equal(safeUrl('/comment/abc', 'https://dev.to/user/article'), 'https://dev.to/comment/abc');
});

test('thread paths cannot escape the snapshot directory or fetch external hosts', () => {
  assert.equal(safeThreadPath('data/threads/hn-123.json'), 'data/threads/hn-123.json');
  for (const path of ['https://example.com/data.json', 'data/threads/../../secret.json', '//example.com/a.json', 'data/threads/x.json?token=1']) assert.equal(safeThreadPath(path), null);
});

test('a balanced feed interleaves sources instead of favoring incomparable vote counts', () => {
  const posts = [post('hn', 1), post('hn', 2), post('dev', 3), post('ars', 4), post('ars', 5)];
  const chosen = selectPosts(posts, { selectedSources: new Set(['hn', 'dev', 'ars']) });
  assert.deepEqual(chosen.map(p => p.id), ['hn:1', 'dev:3', 'ars:4', 'hn:2', 'ars:5']);
});

test('filters combine selected source, search tokens and unread state', () => {
  const posts = [post('hn', 1, { title: 'Rust performance', author: 'alex' }), post('hn', 2, { title: 'Rust performance' }), post('dev', 3, { title: 'Rust performance' })];
  const selected = selectPosts(posts, { selectedSources: new Set(['hn']), query: 'rust alex', unreadOnly: true, readIds: new Set(['hn:2']) });
  assert.deepEqual(selected.map(p => p.id), ['hn:1']);
});

test('unknown counts sort after known zero comments', () => {
  const posts = [post('hn', 1, { commentCount: null }), post('hn', 2, { commentCount: 0 }), post('hn', 3, { commentCount: 5 })];
  assert.deepEqual(selectPosts(posts, { selectedSources: new Set(['hn']), sort: 'discussed' }).map(p => p.id), ['hn:3', 'hn:2', 'hn:1']);
});

test('deleted HN parents retain their identity and child IDs', () => {
  const node = hnComment({ id: 123, parent: 50, deleted: true, kids: [124, 125] }, 50);
  assert.deepEqual(node._childIds, [124, 125]);
  assert.equal(node.id, '123');
  assert.equal(node.url, 'https://news.ycombinator.com/item?id=123');
  assert.equal(new URL(node.replyUrl).searchParams.get('id'), '123');
  assert.equal(new URL(node.replyUrl).searchParams.get('goto'), 'item?id=50');
});

test('DEV reply links target each nested comment and its own author', () => {
  const [root] = devComments([{ id_code: 'abc', user: { username: 'parent' }, body_html: '<p>parent</p>', children: [{ id_code: 'def', user: { username: 'child' }, body_html: '<p>reply</p>' }] }]);
  assert.equal(root.children[0].parentId, 'abc');
  assert.equal(root.children[0].replyUrl, 'https://dev.to/child/comment/def');
});

test('refresh preserves snapshot fallback and full body for existing stories', () => {
  const old = post('dev', 1, { threadPath: 'data/threads/dev-1.json', bodyHtml: '<p>Full body</p>', commentCount: 1 });
  const fresh = post('dev', 1, { commentCount: 7 });
  const [updated] = mergeSourcePosts([old], [fresh], 'dev');
  assert.equal(updated.threadPath, 'data/threads/dev-1.json');
  assert.equal(updated.bodyHtml, '<p>Full body</p>');
  assert.equal(updated.commentCount, 7);
});

test('live HN refresh retains collected link metadata only for the same destination', () => {
  const preview = { url: 'https://example.com/1', title: 'Original title', description: 'Article summary', imageUrl: '/cover.png' };
  const old = post('hn', 1, { linkPreview: preview });
  const [updated] = mergeSourcePosts([old], [post('hn', 1, { commentCount: 9 })], 'hn');
  assert.equal(updated.linkPreview.description, 'Article summary');
  assert.equal(updated.linkPreview.imageUrl, 'https://example.com/cover.png');
  const [changed] = mergeSourcePosts([old], [post('hn', 1, { url: 'https://example.org/new' })], 'hn');
  assert.equal(changed.linkPreview, null);
});

test('preview metadata rejects wrong destinations and unsafe image URLs', () => {
  assert.equal(normalizeLinkPreview({ url: 'https://elsewhere.test/story' }, 'https://example.com/1'), null);
  const preview = normalizeLinkPreview({ url: 'https://example.com/1', imageUrl: 'javascript:alert(1)' }, 'https://example.com/1');
  assert.equal(preview.imageUrl, '');
});

test('media-only live social posts do not revive old placeholder text or removed attachments', () => {
  const old = post('bluesky', 1, { bodyHtml: '<p>Media stays at the source.</p>', embeds: [{ type: 'image', url: 'https://example.com/old.png' }] });
  const current = post('bluesky', 1, { bodyHtml: '', embeds: [{ type: 'video', url: 'https://example.com/video.mp4' }] });
  const [updated] = mergeSourcePosts([old], [current], 'bluesky');
  assert.equal(updated.bodyHtml, '');
  assert.deepEqual(updated.embeds, current.embeds);
  const [withoutMedia] = mergeSourcePosts([old], [post('bluesky', 1, { embeds: [] })], 'bluesky');
  assert.deepEqual(withoutMedia.embeds, []);
});

test('unavailable posts scrub structured media and link metadata from old saved copies', () => {
  const old = post('bluesky', 1, { embeds: [{ type: 'image', url: 'https://example.com/picture.png' }],
    linkPreview: { url: 'https://example.com/1', imageUrl: 'https://example.com/cover.png' } });
  const result = protectPost(old, new Set([old.id]));
  assert.deepEqual(result.embeds, []);
  assert.equal(result.linkPreview, null);
  assert.equal(old.embeds.length, 1);
});

test('known removals scrub stale snapshot and archive copies without mutating them', () => {
  const snapshot = Object.freeze(post('bluesky', 1, { bodyHtml: '<p>Old public post</p>', excerpt: 'Old preview', commentCount: 2 }));
  const archive = Object.freeze({ ...snapshot, bodyHtml: '<p>Older archived body</p>', commentCount: 1 });
  const unavailableIds = new Set([snapshot.id]);
  for (const original of [snapshot, archive]) {
    const protectedPost = protectPost(original, unavailableIds);
    assert.notEqual(protectedPost, original);
    assert.equal(protectedPost.unavailable, true);
    assert.equal(protectedPost.bodyHtml, '');
    assert.equal(protectedPost.excerpt, 'This post is no longer publicly available.');
    assert.equal(protectedPost.commentCount, null);
    assert.equal(protectedPost.url, original.url);
    assert.match(original.bodyHtml, /<p>/);
    assert.equal(original.excerpt, 'Old preview');
    assert.notEqual(original.commentCount, null);
  }
});

test('an explicit unavailable flag is honored and unrelated posts stay unchanged', () => {
  const removed = post('mastodon', 1, { unavailable: true, bodyHtml: '<p>Stale</p>', excerpt: 'Stale', commentCount: 4 });
  assert.equal(protectPost(removed).bodyHtml, '');
  assert.equal(protectPost(removed).commentCount, null);
  const unrelated = post('mastodon', 2, { bodyHtml: '<p>Still public</p>', commentCount: 5 });
  assert.equal(protectPost(unrelated, new Set([removed.id])), unrelated);
});

test('thread fallback chooses the newest real saved conversation', () => {
  const old = Object.freeze({ postId: 'bluesky:1', fetchedAt: '2026-11-16T09:00:00Z', comments: [{ id: 'older' }], live: false });
  const recent = Object.freeze({ postId: 'bluesky:1', fetchedAt: '2026-11-16T10:00:00Z', comments: [{ id: 'newer' }], live: true });
  assert.equal(newestThreadFallback('bluesky:1', old, recent), recent);
  assert.equal(newestThreadFallback('bluesky:1', recent, old), recent);
  const validSavedCopy = { ...recent, live: false, error: 'Live comments are unavailable. Showing the saved discussion.' };
  assert.equal(newestThreadFallback('bluesky:1', old, validSavedCopy), validSavedCopy);
  assert.equal(recent.live, true);
});

test('thread fallback excludes error placeholders, foreign threads, invalid dates and removed or loading results', () => {
  const valid = { postId: 'mastodon:1', fetchedAt: '2026-11-16T10:00:00Z', comments: [] };
  const invalid = [null, undefined, { comments: [], error: 'Could not load discussion' },
    { ...valid, fetchedAt: undefined, error: 'Could not load discussion' },
    { ...valid, postId: 'mastodon:2' }, { ...valid, fetchedAt: 'not a date' },
    { ...valid, fetchedAt: null }, { ...valid, fetchedAt: '' },
    { ...valid, comments: null }, { ...valid, removed: true }, { ...valid, loading: true }];
  assert.equal(newestThreadFallback('mastodon:1', ...invalid), null);
  assert.equal(newestThreadFallback('mastodon:1', ...invalid, valid), valid);
  assert.equal(newestThreadFallback('mastodon:1'), null);
});

test('invalid posts and deleted HN stories do not enter the feed', () => {
  assert.equal(normalizePost({ id: 'bad', sourceId: 'unknown', title: 'Test', url: 'https://example.com' }), null);
  assert.equal(hnPost({ id: 1, title: 'Gone', deleted: true }), null);
});

test('missing and future timestamps are handled honestly', () => {
  assert.equal(timeAgo(null), 'Date unavailable');
  assert.equal(timeAgo('bad'), 'Date unavailable');
  assert.equal(timeAgo('2030-01-01T00:00:00Z', Date.parse('2026-01-01T00:00:00Z')), 'just now');
});

test('new sources appear for existing users without re-enabling deliberately hidden old sources', () => {
  const selected = restoreSources({ selectedSources: ['hn', 'ars'] });
  assert.equal(selected.has('lobsters'), false);
  assert.equal(selected.has('bbc'), true);
  assert.equal(selected.has('bluesky'), true);
  assert.equal(selected.has('x'), false);
  const restored = restoreSources({ selectedSources: ['hn'], knownSources: SOURCES.map(source => source.id) });
  assert.deepEqual([...restored], ['hn']);
});

test('the combined mix brings technology, general news and social into the first screen', () => {
  const posts = [post('hn', 1), post('lobsters', 2), post('bbc', 3), post('guardian', 4), post('bluesky', 5), post('mastodon', 6)];
  const ordered = selectPosts(posts, { selectedSources: new Set(posts.map(p => p.sourceId)) });
  assert.deepEqual(ordered.map(p => p.sourceId), ['hn', 'bbc', 'bluesky', 'lobsters', 'guardian', 'mastodon']);
});

test('archive dates cover both UTC boundaries and reject invalid calendar input', () => {
  assert.deepEqual(archiveDaysForDate('2026-01-01'), ['2025-12-31', '2026-01-01', '2026-01-02']);
  assert.deepEqual(archiveDaysForDate('2026-03-29'), ['2026-03-28', '2026-03-29', '2026-03-30']);
  assert.equal(validCalendarDay('2028-02-29'), true);
  for (const value of ['', '2026-02-29', '2026-13-01', '../index', '2026-11-16T00:00:00Z']) {
    assert.equal(validCalendarDay(value), false);
    assert.deepEqual(archiveDaysForDate(value), []);
  }
});

test('the blog calendar aligns Monday-first and includes leap days', () => {
  const november = calendarMonthDays('2026-11');
  assert.equal(november[6], '2026-11-01');
  assert.equal(november[7], '2026-11-02');
  assert.equal(november.filter(Boolean).length, 30);
  assert.equal(november.length % 7, 0);
  assert.equal(calendarMonthDays('2028-02').filter(Boolean).at(-1), '2028-02-29');
  assert.deepEqual(calendarMonthDays('2026-13'), []);
});

test('month navigation crosses years without skipping a short month', () => {
  assert.equal(shiftCalendarMonth('2026-12', 1), '2027-01');
  assert.equal(shiftCalendarMonth('2026-01', -1), '2025-12');
  assert.equal(shiftCalendarMonth('2026-03', -1), '2026-02');
  assert.equal(shiftCalendarMonth('invalid', 1), '');
});

test('calendar filtering uses the reader local day and still applies search and unread filters', () => {
  const previousZone = process.env.TZ;
  try {
    process.env.TZ = 'Europe/Copenhagen';
    assert.equal(calendarDay('2026-11-15T23:30:00Z'), '2026-11-16');
    const posts = [
      post('hn', 1, { title: 'Rust', publishedAt: '2026-11-15T23:30:00Z' }),
      post('hn', 2, { title: 'Rust', publishedAt: '2026-11-15T22:30:00Z' }),
      post('hn', 3, { title: 'Rust', publishedAt: '2026-11-16T12:00:00Z' }),
      post('hn', 4, { title: 'Rust', publishedAt: null }),
      post('hn', 5, { title: 'Other', publishedAt: '2026-11-16T12:00:00Z' }),
    ];
    const options = { selectedSources: new Set(['hn']), selectedDate: '2026-11-16', query: 'rust', unreadOnly: true, readIds: new Set(['hn:3']) };
    assert.deepEqual(selectPosts(posts, options).map(post => post.id), ['hn:1']);
    assert.deepEqual(selectPosts(posts, { ...options, selectedDate: '' }).map(post => post.id), ['hn:1', 'hn:2', 'hn:4']);
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(calendarDay('2026-11-16T07:30:00Z'), '2026-11-15');
    assert.equal(calendarDay(null), '');
    assert.equal(calendarDay('invalid'), '');
  } finally {
    if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone;
  }
});
