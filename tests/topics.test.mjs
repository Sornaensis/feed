import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, SOURCE_MAP, TOPICS, normalizePost, selectPosts } from '../site/assets/model.js';

const selectedSources = new Set(SOURCES.map(source => source.id));
const localDay = day => new Date(2026, 10, day, 12).toISOString();

function post(sourceId, id, overrides = {}) {
  const result = normalizePost({
    id: `${sourceId}:${id}`, sourceId, sourceItemId: String(id),
    title: `Story ${id}`, url: `https://example.com/${sourceId}/${id}`,
    publishedAt: localDay(16), ...overrides,
  });
  assert.ok(result, `Expected registered source ${sourceId}`);
  return result;
}

test('balanced sorting retains every registered source and deduplicates repeated feed/archive records', () => {
  const subjectIds = new Set(TOPICS.filter(topic => topic.id !== 'all').map(topic => topic.id));
  for (const source of SOURCES) {
    assert.ok(subjectIds.has(source.category), `${source.id} has a visible primary topic`);
    for (const topic of source.topics || []) assert.ok(subjectIds.has(topic), `${source.id} has a valid additional topic`);
  }
  const originals = SOURCES.flatMap(source => [post(source.id, 1), post(source.id, 2)]);
  const input = [...originals].reverse();
  input.push(...originals.map(item => ({ ...item })));
  const chosen = selectPosts(input, { selectedSources, sort: 'balanced' });
  assert.equal(chosen.length, originals.length);
  assert.equal(new Set(chosen.map(item => item.id)).size, chosen.length);
  assert.deepEqual(new Set(chosen.map(item => item.sourceId)), selectedSources);
});

test('the balanced opening includes all six primary subject groups before any repeats', () => {
  const groups = TOPICS.filter(topic => topic.id !== 'all').map(topic => topic.id);
  assert.equal(groups.length, 6);
  const input = SOURCES.flatMap(source => Array.from({ length: source.id === 'hn' ? 30 : 2 }, (_, i) => post(source.id, i)));
  const chosen = selectPosts(input, { selectedSources, sort: 'balanced' });
  assert.deepEqual(new Set(chosen.slice(0, groups.length).map(item => SOURCE_MAP.get(item.sourceId).category)), new Set(groups));
});

test('GamingOnLinux belongs to both Linux and Gaming without duplicating the combined feed', () => {
  const story = post('gamingonlinux', 1);
  const other = post('hn', 2);
  for (const topic of ['linux', 'gaming']) {
    assert.deepEqual(selectPosts([story, other], { selectedSources, topic }).map(item => item.id), [story.id]);
  }
  assert.equal(selectPosts([story, story, other], { selectedSources, topic: 'all' }).filter(item => item.id === story.id).length, 1);
  assert.deepEqual(selectPosts([story], { selectedSources, topic: 'science' }), []);
});

test('Rust weekly is discoverable under both open source and technology', () => {
  const story = post('rustweekly', 1);
  for (const topic of ['linux', 'technology']) {
    assert.deepEqual(selectPosts([story], { selectedSources, topic }).map(item => item.id), [story.id]);
  }
  assert.deepEqual(selectPosts([story], { selectedSources, topic: 'gaming' }), []);
});

test('topic filters intersect source selection, all search tokens, local publication day and unread state', () => {
  const common = { title: 'Vulkan renderer update', author: 'Alice' };
  const wanted = post('gamingonlinux', 1, common);
  const read = post('gamingonlinux', 2, common);
  const wrongDate = post('gamingonlinux', 3, { ...common, publishedAt: localDay(15) });
  const wrongText = post('gamingonlinux', 4, { title: 'Rust compiler update', author: 'Alice' });
  const unselected = post('aftermath', 5, common);
  const wrongTopic = post('hn', 6, common);
  const chosen = selectPosts([wanted, read, wrongDate, wrongText, unselected, wrongTopic], {
    selectedSources: new Set(['gamingonlinux', 'hn']), topic: 'gaming',
    query: 'VULKAN alice', selectedDate: '2026-11-16', unreadOnly: true, readIds: new Set([read.id]),
  });
  assert.deepEqual(chosen.map(item => item.id), [wanted.id]);
});

test('newest and most-discussed sorting still respect the chosen topic', () => {
  const older = post('gamingonlinux', 1, { publishedAt: localDay(15), commentCount: 8 });
  const newer = post('gamingonlinux', 2, { publishedAt: localDay(16), commentCount: 1 });
  const unrelated = post('hn', 3, { publishedAt: localDay(17), commentCount: 100 });
  assert.deepEqual(selectPosts([older, unrelated, newer], { selectedSources, topic: 'gaming', sort: 'newest' }).map(item => item.id), [newer.id, older.id]);
  assert.deepEqual(selectPosts([older, unrelated, newer], { selectedSources, topic: 'gaming', sort: 'discussed' }).map(item => item.id), [older.id, newer.id]);
});
