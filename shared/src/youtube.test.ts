import { describe, expect, it } from 'vitest';
import { findYouTubeVideo } from './youtube.js';

const ID = 'dQw4w9WgXcQ';

describe('findYouTubeVideo', () => {
  it.each([
    `https://youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://www.youtu.be/${ID}?si=abc`,
    `https://youtube.com/shorts/${ID}`,
    `https://youtube.com/embed/${ID}`,
    `https://youtube.com/live/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
  ])('recognizes %s', (url) => {
    expect(findYouTubeVideo(`watch ${url} now`)).toEqual({ id: ID, url });
  });

  it('handles punctuation after the URL', () => {
    const url = `https://youtu.be/${ID}`;
    expect(findYouTubeVideo(`Watch this (${url}).`)).toEqual({ id: ID, url });
  });

  it('returns the first supported video link', () => {
    const first = `https://youtu.be/${ID}`;
    expect(
      findYouTubeVideo(
        `https://example.com ${first} https://youtu.be/aqz-KE-bpKQ`,
      ),
    ).toEqual({ id: ID, url: first });
  });

  it.each([
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=too-short',
    'https://youtube.com/watch?list=PL123',
    'https://youtu.be/dQw4w9WgXcQ/extra',
    'https://youtube.com/channel/dQw4w9WgXcQ',
    '[[https://youtube.com/watch?v=dQw4w9WgXcQ]]',
  ])('rejects %s', (text) => {
    expect(findYouTubeVideo(text)).toBeNull();
  });
});
