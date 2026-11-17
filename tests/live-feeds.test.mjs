import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LIVE_FEEDS, canonicalFeedUrl, publisherItemId, truncateFeedText, parsePublisherFeed, fetchPublisherFeed } from '../site/assets/live-feeds.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/live-feeds.json', import.meta.url), 'utf8'));

test('publisher URL normalization matches Python without changing identity spelling', () => {
  for (const { input, expected } of fixture.canonicalUrls) assert.equal(canonicalFeedUrl(input), expected, input);
});

test('captured publisher GUIDs retain the collector IDs used by saved and read state', async () => {
  for (const sample of fixture.cases) {
    for (const [index, identity] of sample.identities.entries()) {
      const expected = sample.expectedPosts[index];
      const itemId = await publisherItemId(canonicalFeedUrl(identity) || identity || expected.url);
      assert.equal(itemId, expected.sourceItemId, `${sample.sourceId}: ${identity}`);
      assert.equal(`${sample.sourceId}:${itemId}`, expected.id);
    }
  }
});

test('preview truncation stays within its limit and preserves Unicode characters', () => {
  assert.equal(truncateFeedText('Short text', 1200), 'Short text');
  for (const value of ['word '.repeat(400), 'x'.repeat(1400), '😀'.repeat(1400)]) {
    const preview = truncateFeedText(value, 1200);
    assert.ok(Array.from(preview).length <= 1200);
    assert.ok(preview.endsWith('…'));
    assert.ok(!/[\uD800-\uDBFF]$/.test(preview.slice(0, -1)));
  }
});

test('unsupported sources cannot trigger arbitrary cross-origin requests', async () => {
  let requested = false;
  for (const sourceId of ['x', 'lobsters', 'constructor', '__proto__', 'https://example.com/feed']) {
    await assert.rejects(fetchPublisherFeed(sourceId, { request: () => { requested = true; } }), /Unsupported/);
  }
  assert.equal(requested, false);
  assert.deepEqual(Object.keys(LIVE_FEEDS).sort(), ['dw', 'gamedeveloper', 'nasa', 'quanta', 'register', 'rustweekly', 'wired']);
});

test('invalid parser limits fail before parsing untrusted input', async () => {
  for (const limit of [0, -1, NaN, Infinity, 1.5]) await assert.rejects(parsePublisherFeed('', 'wired', limit), /Invalid feed limit/);
});
