import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLink, renderLinkPreview } from '../site/assets/embeds.js';

test('YouTube links create only a canonical privacy-domain player', () => {
  for (const href of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  ]) {
    const result = classifyLink(href);
    assert.equal(result.type, 'player');
    assert.equal(result.provider, 'YouTube');
    assert.equal(result.embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');
    assert.equal(result.url, href);
  }
});

test('YouTube timestamps survive, while arbitrary player parameters are discarded', () => {
  const result = classifyLink('https://youtu.be/dQw4w9WgXcQ?t=1h2m3s&autoplay=1&origin=https://evil.example');
  const embed = new URL(result.embedUrl);
  assert.equal(embed.searchParams.get('start'), '3723');
  assert.equal(embed.searchParams.has('autoplay'), false);
  assert.equal(embed.searchParams.has('origin'), false);
  assert.equal(new URL(classifyLink('https://youtu.be/dQw4w9WgXcQ#t=92').embedUrl).searchParams.get('start'), '92');
  assert.equal(new URL(classifyLink('https://youtu.be/dQw4w9WgXcQ?t=9999999').embedUrl).searchParams.get('start'), '86400');
  assert.equal(new URL(classifyLink('https://youtu.be/dQw4w9WgXcQ?t=NaN').embedUrl).searchParams.has('start'), false);
});

test('Provider lookalikes, invalid IDs, and URL payloads remain ordinary links', () => {
  for (const href of [
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=short',
    'https://youtube.com/watch?v=dQw4w9WgXcQ%22%3E%3Cscript%3E',
    'https://vimeo.com.evil.example/1234567',
    'https://player.vimeo.com/video/not-a-video',
    'https://www.youtube.com/playlist?list=PLabc123',
  ]) assert.equal(classifyLink(href).type, 'link', href);
});

test('Vimeo links retain the unlisted-video hash without trusting iframe markup', () => {
  assert.equal(classifyLink('https://vimeo.com/76979871').embedUrl, 'https://player.vimeo.com/video/76979871?dnt=1');
  assert.equal(classifyLink('https://vimeo.com/76979871/a1b2c3d4e5').embedUrl, 'https://player.vimeo.com/video/76979871?h=a1b2c3d4e5&dnt=1');
  assert.equal(classifyLink('https://player.vimeo.com/video/76979871?h=a1b2c3d4e5&autoplay=1').embedUrl, 'https://player.vimeo.com/video/76979871?h=a1b2c3d4e5&dnt=1');
  assert.equal(classifyLink('https://vimeo.com/76979871?h=javascript:alert(1)').embedUrl, 'https://player.vimeo.com/video/76979871?dnt=1');
});

test('Direct image, audio, video, and HLS links are recognized with query strings', () => {
  assert.equal(classifyLink('https://images.example/news.JPG?size=large').type, 'image');
  assert.equal(classifyLink('https://images.example/news.webp#photo').type, 'image');
  assert.equal(classifyLink('https://media.example/interview.mp4?token=public').type, 'video');
  assert.equal(classifyLink('https://media.example/interview.webm').type, 'video');
  assert.equal(classifyLink('https://media.example/master.m3u8?version=2').mimeType, 'application/vnd.apple.mpegurl');
  assert.equal(classifyLink('https://media.example/show.mp3').type, 'audio');
  assert.equal(classifyLink('https://media.example/show.flac').type, 'audio');
  assert.equal(classifyLink('https://news.example/story.html').type, 'link');
  assert.equal(classifyLink('https://news.example/file.svg').type, 'link');
});

test('Unsafe schemes and credentials cannot become media or player sources', () => {
  for (const url of [
    'javascript:alert(1)', 'data:image/png;base64,aGVsbG8=', 'file:///tmp/image.png',
    'blob:https://example.com/id', 'https://name:password@youtube.com/watch?v=dQw4w9WgXcQ',
    'https://name@media.example/video.mp4', '', null, {}, undefined,
  ]) assert.equal(classifyLink(url), null);
  assert.equal(classifyLink('/image.png', 'https://example.com/story').url, 'https://example.com/image.png');
  assert.equal(classifyLink('//media.example/video.mp4', 'https://example.com/').url, 'https://media.example/video.mp4');
});

test('Removed posts and source-only social posts cannot produce article previews', () => {
  assert.equal(renderLinkPreview(null), null);
  assert.equal(renderLinkPreview({ unavailable: true, url: 'https://example.com/article' }), null);
  assert.equal(renderLinkPreview({ url: 'https://news.ycombinator.com/item?id=123', discussionUrl: 'https://news.ycombinator.com/item?id=123' }), null);
  assert.equal(renderLinkPreview({ url: 'https://bsky.app/profile/test/post/id', discussionUrl: 'https://bsky.app/profile/test/post/id' }), null);
  assert.equal(renderLinkPreview({ url: 'https://example.com/article', embeds: [{ type: 'link', url: 'https://example.com/article' }] }), null);
});
