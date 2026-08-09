import { segmentText } from './wikilinks.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

export interface YouTubeVideo {
  id: string;
  url: string;
}

function videoIdFromUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname.split('/').filter(Boolean);
  let id: string | null = null;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    if (path.length === 1) id = path[0] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (
      path.length === 2 &&
      (path[0] === 'shorts' || path[0] === 'embed' || path[0] === 'live')
    ) {
      id = path[1] ?? null;
    }
  }

  return id && VIDEO_ID.test(id) ? id : null;
}

/** First supported bare YouTube video URL in a block's text. */
export function findYouTubeVideo(text: string): YouTubeVideo | null {
  for (const segment of segmentText(text)) {
    if (segment.type !== 'url') continue;
    const id = videoIdFromUrl(segment.url);
    if (id) return { id, url: segment.url };
  }
  return null;
}
