const WIKILINK = /\[\[([^[\]\n]+?)\]\]/g;

/** Unique, trimmed page titles referenced via [[...]] in the given text. */
export function extractWikilinks(text: string): string[] {
  const titles = new Set<string>();
  for (const match of text.matchAll(WIKILINK)) {
    const title = match[1]!.trim();
    if (title) titles.add(title);
  }
  return [...titles];
}

const URL_RE = /https?:\/\/\S+/g;
const TRAILING_PUNCT = /[.,;:!?"')\]]+$/;

export type TextSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; title: string; raw: string }
  | { type: 'url'; url: string };

/** Split plain text into text and URL segments (helper for segmentText). */
function segmentUrls(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0].replace(TRAILING_PUNCT, '');
    if (match.index > last)
      segments.push({ type: 'text', value: text.slice(last, match.index) });
    segments.push({ type: 'url', url });
    last = match.index + url.length;
  }
  if (last < text.length)
    segments.push({ type: 'text', value: text.slice(last) });
  return segments;
}

/** Split text into plain, [[wikilink]], and URL segments, for rendering. */
export function segmentText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(WIKILINK)) {
    const index = match.index;
    if (index > last) segments.push(...segmentUrls(text.slice(last, index)));
    segments.push({ type: 'link', title: match[1]!.trim(), raw: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push(...segmentUrls(text.slice(last)));
  return segments;
}
