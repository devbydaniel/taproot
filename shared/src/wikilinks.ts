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

export type TextSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; title: string; raw: string };

/** Split text into plain segments and [[wikilink]] segments, for rendering. */
export function segmentText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(WIKILINK)) {
    const index = match.index;
    if (index > last)
      segments.push({ type: 'text', value: text.slice(last, index) });
    segments.push({ type: 'link', title: match[1]!.trim(), raw: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length)
    segments.push({ type: 'text', value: text.slice(last) });
  return segments;
}
