import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchBlueskyFeed, fetchBlueskyThread, fetchMastodonFeed, fetchMastodonThread } from '../site/assets/live-social.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/social-embeds.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);
function view(key, embed, text = '') {
  return { uri: `at://did:plc:alice/app.bsky.feed.post/${key}`, author: { did: 'did:plc:alice', handle: 'alice.example' },
    record: { text, createdAt: '2026-11-16T12:00:00Z' }, embed, replyCount: 0 };
}
async function post(value) {
  return (await fetchBlueskyFeed({ actors: ['alice.example'], request: async () => ({ feed: [{ post: value }] }) })).posts[0];
}
function status(id, overrides = {}) {
  return { id: String(id), account: { acct: 'alice@example.social' }, url: `https://example.social/@alice/${id}`,
    content: '<p>Post body</p>', visibility: 'public', created_at: '2026-11-16T12:00:00Z', replies_count: 0, ...overrides };
}

test('Bluesky renders images, galleries and HLS video as structured media, preserving accessibility metadata', async () => {
  const image = await post(view('image', fixture.image));
  assert.equal(image.bodyHtml, '');
  assert.equal(image.embeds[0].url, 'https://cdn.example/full.jpg');
  assert.equal(image.embeds[0].thumbnailUrl, 'https://cdn.example/thumb.jpg');
  assert.equal(image.embeds[0].alt, 'A & <scene>');
  assert.equal(image.embeds[0].width, 1920);
  const gallery = await post(view('gallery', fixture.gallery));
  assert.equal(gallery.embeds[0].thumbnailUrl, 'https://cdn.example/gallery-small.jpg');
  assert.equal(gallery.embeds[0].width, 4);
  const video = await post(view('video', fixture.video));
  assert.equal(video.embeds[0].type, 'video');
  assert.equal(video.embeds[0].mimeType, 'application/vnd.apple.mpegurl');
  assert.equal(video.embeds[0].posterUrl, 'https://video.example/poster.jpg');
});

test('Bluesky link cards retain source metadata without duplicating it in body HTML', async () => {
  const linked = await post(view('external', fixture.external));
  assert.equal(linked.url, 'https://news.example/story?a=1&b=2');
  assert.equal(linked.embeds[0].title, 'An interesting <headline>');
  assert.equal(linked.embeds[0].description, 'A preview, not executable <script>.');
  assert.equal(linked.embeds[0].imageUrl, 'https://news.example/cover.jpg');
  assert.equal(linked.bodyHtml, '');
});

test('quoted posts and recordWithMedia retain nested media, UTF-8 facets, warnings and precise source links', async () => {
  const quoted = await post(view('quote', fixture.recordWithMedia, 'A thought'));
  assert.deepEqual(quoted.embeds.map(embed => embed.type), ['image', 'quote']);
  const embed = quoted.embeds[1];
  assert.equal(embed.url, 'https://bsky.app/profile/did:plc:quoted/post/quoted-key');
  assert.equal(embed.author, '@quoted.example');
  assert.equal(embed.bodyHtml, '<p>☕ read <a href="https://news.example/">here</a></p>');
  assert.deepEqual(embed.embeds.map(child => child.type), ['video', 'link']);
  assert.equal(embed.sensitive, true);
  assert.equal(embed.contentWarning, 'Sensitive content');
  assert.equal(quoted.sensitive, false);
});

test('Bluesky thread roots replace old media and replies include their own embeds', async () => {
  const old = await post(view('root', fixture.image, 'Old text'));
  const root = view('root', fixture.video, 'Current text');
  root.replyCount = 1;
  const reply = view('reply', fixture.gallery, 'Reply text');
  const thread = await fetchBlueskyThread(old, { request: async () => ({ thread: { post: root, replies: [{ post: reply, replies: [] }] } }) });
  assert.equal(thread.bodyHtml, '<p>Current text</p>');
  assert.equal(thread.embeds[0].type, 'video');
  assert.equal(thread.comments[0].embeds[0].url, 'https://cdn.example/gallery.jpg');
  assert.equal(thread.comments[0].replyUrl, 'https://bsky.app/profile/did:plc:alice/post/reply');
  const emptied = await fetchBlueskyThread(old, { request: async () => ({ thread: { post: view('root', undefined, 'Now only text'), replies: [] } }) });
  assert.deepEqual(emptied.embeds, []);
});

test('unsafe media URLs, raw blobs and blocked quote content never become usable embeds', async () => {
  const unsafe = ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///private.jpg', 'https://user:password@media.example/p.jpg'];
  const images = { images: unsafe.map(url => ({ fullsize: url, thumb: url, alt: 'invalid' })) };
  assert.deepEqual((await post(view('bad-images', images))).embeds, []);
  assert.deepEqual((await post(view('bad-video', { playlist: unsafe[0] }))).embeds, []);
  const raw = view('raw', undefined);
  raw.record.embed = { $type: 'app.bsky.embed.images', images: [{ image: { ref: { $link: 'blob-id' } }, alt: 'Raw blob' }] };
  assert.deepEqual((await post(raw)).embeds, []);
  const blocked = await post(view('blocked-quote', fixture.blockedQuote));
  assert.equal(blocked.embeds[0].unavailable, true);
  assert.deepEqual(blocked.embeds[0].embeds, []);
  assert.doesNotMatch(JSON.stringify(blocked), /MUST NOT LEAK|cdn\.example/);
});

test('Bluesky limits media lists and nested quote chains, and propagates author content labels', async () => {
  const gallery = clone(fixture.gallery);
  gallery.items = Array.from({ length: 80 }, (_, index) => ({ ...gallery.items[0], fullsize: `https://cdn.example/${index}.jpg` }));
  assert.ok((await post(view('large', gallery))).embeds.length <= 20);
  let quote = clone(fixture.recordWithMedia.record);
  for (let index = 0; index < 20; index++) {
    const next = clone(fixture.recordWithMedia.record);
    next.record.embeds = [quote];
    quote = next;
  }
  const bounded = await post(view('deep', quote));
  let depth = 0, current = bounded.embeds[0];
  while (current?.type === 'quote') { depth++; current = current.embeds[0]; }
  assert.ok(depth <= 2);
  const sensitive = view('labelled', fixture.image);
  sensitive.record.labels = { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'nudity' }] };
  assert.equal((await post(sensitive)).sensitive, true);
});

test('Mastodon media and link cards are retained in root/reply views without trusting iframe HTML', async () => {
  const current = status(10, fixture.mastodon);
  const options = { instance: 'https://mastodon.social', tag: 'technology' };
  const root = (await fetchMastodonFeed({ ...options, request: async () => [current] })).posts[0];
  assert.deepEqual(root.embeds.map(embed => embed.type), ['image', 'video', 'audio', 'link']);
  assert.equal(root.embeds[0].alt, 'A photograph');
  assert.equal(root.embeds[0].width, 800);
  assert.equal(root.embeds[3].siteName, 'Example News');
  assert.equal(root.sensitive, true);
  assert.equal(root.contentWarning, 'Source warning');
  assert.doesNotMatch(JSON.stringify(root), /iframe|evil\.example/);
  const reply = status(11, { ...fixture.mastodon, in_reply_to_id: '10' });
  const thread = await fetchMastodonThread(root, { request: async url => url.endsWith('/context') ? { descendants: [reply] } : current });
  assert.equal(thread.embeds[0].type, 'image');
  assert.equal(thread.comments[0].embeds[2].type, 'audio');
  assert.equal(thread.comments[0].replyUrl, 'https://example.social/@alice/11');
  const cleared = await fetchMastodonThread(root, { request: async url => url.endsWith('/context') ? { descendants: [] } : status(10) });
  assert.deepEqual(cleared.embeds, []);
  assert.equal(cleared.sensitive, false);
});
