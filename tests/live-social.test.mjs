import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fetchBlueskyFeed, fetchMastodonFeed, fetchBlueskyThread, fetchMastodonThread } from '../site/assets/live-social.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const httpError = status => Object.assign(new Error(`HTTP ${status}`), { status });

function blueskyView(key, overrides = {}) {
  return { uri: `at://did:plc:alice/app.bsky.feed.post/${key}`,
    author: { did: 'did:plc:alice', handle: 'alice.example' },
    record: { text: `Post ${key}`, createdAt: '2026-01-03T12:00:00Z' },
    replyCount: 0, likeCount: 4, ...overrides };
}

async function blueskyPost(view = blueskyView('root')) {
  return (await fetchBlueskyFeed({ actors: ['alice.example'], request: async () => ({ feed: [{ post: view }] }) })).posts[0];
}

function mastodonStatus(id, parent = null, overrides = {}) {
  return { id: String(id), in_reply_to_id: parent === null ? null : String(parent),
    url: `https://remote.example/@alice/original-${id}`, uri: `https://remote.example/users/alice/statuses/original-${id}`,
    account: { acct: 'alice@remote.example' }, visibility: 'public', content: `<p>Status ${id}</p>`,
    created_at: '2026-01-03T12:00:00Z', favourites_count: 3, replies_count: 0, ...overrides };
}

async function mastodonPost(status = mastodonStatus(10)) {
  return (await fetchMastodonFeed({ instance: 'https://mastodon.social', tag: 'technology', request: async () => [status] })).posts[0];
}

test('Bluesky identities match collector hashes and facets use UTF-8 byte boundaries', async () => {
  const text = '🦋 news & <script>';
  const encoder = new TextEncoder();
  const start = encoder.encode('🦋 ').length;
  const view = blueskyView('identity', { record: { text, createdAt: '2026-01-03T12:00:00Z', facets: [
    { index: { byteStart: 1, byteEnd: 3 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://invalid-boundary.example/' }] },
    { index: { byteStart: start, byteEnd: start + 4 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://news.example/article?a=1&b=2' }] },
    { index: { byteStart: start + 7, byteEnd: encoder.encode(text).length }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'javascript:alert(1)' }] },
  ] } });
  const post = await blueskyPost(view);
  assert.equal(post.id, `bluesky:${digest(view.uri)}`);
  assert.equal(post.sourceItemId.length, 64);
  assert.equal(post.atUri, view.uri);
  assert.equal(post.sourceAccount, 'alice.example');
  assert.equal(post.discussionUrl, 'https://bsky.app/profile/did:plc:alice/post/identity');
  assert.equal(post.bodyHtml, '<p>🦋 <a href="https://news.example/article?a=1&amp;b=2">news</a> &amp; &lt;script&gt;</p>');
  assert.equal(post.commentsMode, 'live');
});

test('Bluesky interleaves accounts, retains failed account snapshots, and drops known removals', async () => {
  const old = await blueskyPost(blueskyView('old'));
  old.sourceAccount = 'failed.example';
  old.threadPath = `data/threads/bluesky-${old.sourceItemId}.json`;
  const gone = { ...old, id: 'bluesky:gone', sourceAccount: 'gone.example' };
  const signal = new AbortController().signal;
  const result = await fetchBlueskyFeed({ actors: ['fresh.example', 'failed.example', 'gone.example'], previousPosts: [old, gone], limit: 6, signal,
    request: async (url, receivedSignal) => {
      assert.equal(receivedSignal, signal);
      const params = new URL(url).searchParams;
      assert.equal(params.get('filter'), 'posts_no_replies');
      assert.equal(params.get('limit'), '2');
      if (params.get('actor') === 'failed.example') throw httpError(503);
      if (params.get('actor') === 'gone.example') throw httpError(404);
      return { feed: [{ post: blueskyView('new-1') }, { post: blueskyView('new-2') }] };
    } });
  assert.deepEqual(result.posts.map(post => post.id), [`bluesky:${digest(blueskyView('new-1').uri)}`, old.id, `bluesky:${digest(blueskyView('new-2').uri)}`]);
  assert.equal(result.posts[1].threadPath, old.threadPath);
  assert.equal(result.posts[1].stale, true);
  assert.equal(result.partial, true);
  assert.deepEqual(result.failedAccounts, ['failed.example']);
});

test('valid empty Bluesky feeds clear old listings while total network failures remain errors', async () => {
  const old = await blueskyPost();
  const options = { actors: ['alice.example'], previousPosts: [old] };
  assert.deepEqual((await fetchBlueskyFeed({ ...options, request: async () => ({ feed: [] }) })).posts, []);
  assert.deepEqual((await fetchBlueskyFeed({ ...options, request: async () => { throw httpError(410); } })).posts, []);
  await assert.rejects(fetchBlueskyFeed({ actors: ['alice.example'], request: async () => { throw httpError(503); } }), /could not be refreshed/);
  const fallback = await fetchBlueskyFeed({ ...options, request: async () => { throw httpError(503); } });
  assert.equal(fallback.posts[0].id, old.id);
  assert.equal(fallback.partial, true);
});

test('Bluesky preserves unavailable parents and precise native reply links', async () => {
  const post = await blueskyPost();
  const parentUri = blueskyView('missing-parent').uri;
  const reply = blueskyView('reply');
  const current = blueskyView('root', { record: { text: 'Updated root', createdAt: '2026-01-03T12:00:00Z' }, replyCount: 1 });
  const result = await fetchBlueskyThread(post, { request: async url => {
    const params = new URL(url).searchParams;
    assert.equal(params.get('uri'), post.atUri);
    assert.equal(params.get('depth'), '6');
    assert.equal(params.get('parentHeight'), '0');
    return { thread: { post: current, replies: [{ uri: parentUri, notFound: true, replies: [{ post: reply, replies: [] }] }] } };
  } });
  assert.equal(result.postId, post.id);
  assert.equal(result.live, true);
  assert.equal(result.bodyHtml, '<p>Updated root</p>');
  assert.equal(result.complete, false);
  assert.equal(result.truncated, true);
  const parent = result.comments[0];
  assert.equal(parent.id, parentUri);
  assert.equal(parent.unavailable, true);
  assert.equal(parent.parentId, null);
  assert.equal(parent.children[0].parentId, parentUri);
  assert.equal(parent.children[0].replyUrl, 'https://bsky.app/profile/did:plc:alice/post/reply');
});

test('Bluesky rejects root mismatches and signals confirmed removals without returning cached text', async () => {
  const post = await blueskyPost();
  for (const unavailable of [{ notFound: true }, { blocked: true }]) {
    await assert.rejects(fetchBlueskyThread(post, { request: async () => ({ thread: unavailable }) }), error => error.removed === true);
  }
  await assert.rejects(fetchBlueskyThread(post, { request: async () => { throw httpError(404); } }), error => error.removed === true);
  await assert.rejects(fetchBlueskyThread(post, { request: async () => ({ thread: { post: blueskyView('wrong') } }) }), error => !error.removed && /Wrong/.test(error.message));
});

test('Bluesky bounds deep reply trees and labels the clipped conversation partial', async () => {
  const post = await blueskyPost();
  let node = { post: blueskyView('reply-8'), replies: [] };
  for (let index = 7; index >= 1; index--) node = { post: blueskyView(`reply-${index}`, { replyCount: 1 }), replies: [node] };
  const result = await fetchBlueskyThread(post, { request: async () => ({ thread: { post: blueskyView('root', { replyCount: 1 }), replies: [node] } }) });
  let depth = 0;
  for (let item = result.comments[0]; item; item = item.children[0]) depth++;
  assert.equal(depth, 6);
  assert.equal(result.complete, false);
});

test('Mastodon identities use the API instance and local ID while links retain the remote canonical URL', async () => {
  const original = mastodonStatus(10, null, { content: '<p>A &amp; B</p>', spoiler_text: 'A warning', media_attachments: [
    { type: 'image', url: 'https://media.example/image.png', description: 'Screenshot' }, { type: 'image', url: 'javascript:alert(1)', description: 'Unsafe' },
  ] });
  const result = await fetchMastodonFeed({ instance: 'https://mastodon.social/', tag: '#technology', request: async url => {
    assert.equal(url, 'https://mastodon.social/api/v1/timelines/tag/technology?limit=25');
    return [{ ...mastodonStatus(99), reblog: original }, original, mastodonStatus(11, null, { visibility: 'private' })];
  } });
  assert.equal(result.posts.length, 1);
  const post = result.posts[0];
  assert.equal(post.id, `mastodon:${digest('https://mastodon.social/10')}`);
  assert.equal(post.sourceItemId.length, 64);
  assert.equal(post.sourceInstance, 'https://mastodon.social');
  assert.equal(post.mastodonLocalId, '10');
  assert.equal(post.discussionUrl, original.url);
  assert.equal(post.excerpt, 'A & B');
  assert.match(post.bodyHtml, /Content warning: A warning/);
  assert.equal(post.embeds.length, 1);
  assert.equal(post.embeds[0].type, 'image');
  assert.equal(post.embeds[0].url, 'https://media.example/image.png');
  assert.equal(post.embeds[0].alt, 'Screenshot');
  assert.equal(post.contentWarning, 'A warning');
  assert.equal(post.sensitive, true);
  assert.doesNotMatch(JSON.stringify(post), /javascript:/);
});

test('Mastodon threads retain hierarchy, missing parents and remote replies while breaking cycles', async () => {
  const post = await mastodonPost();
  const descendants = [mastodonStatus(21, 10), mastodonStatus(22, 21), mastodonStatus(23, 99), mastodonStatus(24, 25), mastodonStatus(25, 24)];
  const requests = [];
  const result = await fetchMastodonThread(post, { request: async url => {
    requests.push(url);
    return url.endsWith('/context') ? { descendants } : mastodonStatus(10, null, { content: '<p>Updated status</p>', replies_count: 7 });
  } });
  assert.deepEqual(requests, ['https://mastodon.social/api/v1/statuses/10', 'https://mastodon.social/api/v1/statuses/10/context']);
  assert.equal(result.live, true);
  assert.equal(result.complete, false);
  assert.equal(result.truncated, true);
  assert.equal(result.commentCount, 7);
  assert.equal(result.bodyHtml, '<p>Updated status</p>');
  const parent = result.comments.find(comment => comment.id === '21');
  assert.equal(parent.parentId, null);
  assert.equal(parent.children[0].id, '22');
  assert.equal(parent.children[0].parentId, '21');
  assert.equal(parent.children[0].replyUrl, 'https://remote.example/@alice/original-22');
  const missingParent = result.comments.find(comment => comment.id === '99');
  assert.equal(missingParent.unavailable, true);
  assert.equal(missingParent.replyUrl, '');
  assert.equal(missingParent.children[0].id, '23');
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('Mastodon only marks confirmed root removal unavailable, preserving fallback for a context failure', async () => {
  const post = await mastodonPost();
  await assert.rejects(fetchMastodonThread(post, { request: async () => { throw httpError(410); } }), error => error.removed === true);
  await assert.rejects(fetchMastodonThread(post, { request: async () => mastodonStatus(10, null, { visibility: 'private' }) }), error => error.removed === true);
  await assert.rejects(fetchMastodonThread(post, { request: async () => mastodonStatus(20) }), error => !error.removed && /Wrong/.test(error.message));
  await assert.rejects(fetchMastodonThread(post, { request: async url => {
    if (url.endsWith('/context')) throw httpError(404);
    return mastodonStatus(10);
  } }), error => error.status === 404 && !error.removed);
});

test('Mastodon accepts empty timelines, rejects malformed data and forbids credential-bearing origins', async () => {
  const options = { instance: 'https://mastodon.social', tag: 'technology' };
  assert.deepEqual(await fetchMastodonFeed({ ...options, request: async () => [] }), { posts: [], partial: false });
  await assert.rejects(fetchMastodonFeed({ ...options, request: async () => ['invalid'] }), /Invalid/);
  await assert.rejects(fetchMastodonFeed({ ...options, request: async () => [mastodonStatus(10, null, { url: 'https://user:password@remote.example/', uri: 'javascript:bad' })] }), /no usable/);
  for (const instance of ['https://user:password@mastodon.social', 'http://mastodon.social', 'https://mastodon.social/path', 'https://mastodon.social/?token=secret']) {
    await assert.rejects(fetchMastodonFeed({ instance, request: async () => { assert.fail('Invalid configuration must not make a request'); } }));
  }
});
