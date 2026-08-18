const PAGE_REFERENCE =
  /(?<![\p{L}\p{N}_/#=?&])#(?:\[\[([^[\]\n]+?)\]\]|([\p{L}\p{N}_](?:[\p{L}\p{N}_-]*[\p{L}\p{N}_])?))|\[\[([^[\]\n]+?)\]\]/gu;
const SINGLE_TAG_TITLE = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_-]*[\p{L}\p{N}_])?$/u;

export interface PageReference {
  type: 'link' | 'tag';
  title: string;
  raw: string;
  from: number;
  to: number;
  /** Span of the title itself, excluding [[...]], #[[...]], or # markup. */
  titleFrom: number;
  titleTo: number;
}

/** All page-reference spans: [[links]], #tags, and #[[multi word tags]]. */
export function findPageReferences(text: string): PageReference[] {
  const references: PageReference[] = [];
  for (const match of text.matchAll(PAGE_REFERENCE)) {
    const multiTagTitle = match[1];
    const singleTagTitle = match[2];
    const linkTitle = match[3];
    const type = linkTitle === undefined ? 'tag' : 'link';
    const untrimmedTitle = multiTagTitle ?? singleTagTitle ?? linkTitle!;
    const title = untrimmedTitle.trim();
    if (!title) continue;
    const markupLength =
      type === 'link' ? 2 : multiTagTitle === undefined ? 1 : 3;
    references.push({
      type,
      title,
      raw: match[0],
      from: match.index,
      to: match.index + match[0].length,
      titleFrom: match.index + markupLength,
      titleTo: match.index + markupLength + untrimmedTitle.length,
    });
  }
  return references;
}

function rewritePageReferences(
  text: string,
  title: string,
  replacement: (reference: PageReference) => string,
): string {
  const references = findPageReferences(text).filter(
    (reference) => reference.title === title,
  );
  if (references.length === 0) return text;

  let result = '';
  let cursor = 0;
  for (const reference of references) {
    result += text.slice(cursor, reference.from) + replacement(reference);
    cursor = reference.to;
  }
  return result + text.slice(cursor);
}

/**
 * Rename exact page references while preserving their kind. A single-word tag
 * is promoted to #[[...]] when the new title cannot be represented by #word.
 */
export function renamePageReferences(
  text: string,
  oldTitle: string,
  newTitle: string,
): string {
  return rewritePageReferences(text, oldTitle, (reference) => {
    if (reference.type === 'link') return `[[${newTitle}]]`;
    if (reference.raw.startsWith('#[[')) return `#[[${newTitle}]]`;
    return SINGLE_TAG_TITLE.test(newTitle)
      ? `#${newTitle}`
      : `#[[${newTitle}]]`;
  });
}

/** Convert exact wikilinks and tags to their visible plain-text title. */
export function removePageReferences(text: string, title: string): string {
  return rewritePageReferences(text, title, (reference) => reference.title);
}

/** Unique, trimmed page titles referenced via [[...]] in the given text. */
export function extractWikilinks(text: string): string[] {
  return [
    ...new Set(
      findPageReferences(text)
        .filter((reference) => reference.type === 'link')
        .map((reference) => reference.title),
    ),
  ];
}

/** Unique page titles referenced by wikilinks or tags in the given text. */
export function extractPageReferences(text: string): string[] {
  return [
    ...new Set(findPageReferences(text).map((reference) => reference.title)),
  ];
}

/** All [[...]] spans with document positions, for editor features that rewrite links in place. */
export function findWikilinks(
  text: string,
): { title: string; from: number; to: number }[] {
  return findPageReferences(text)
    .filter((reference) => reference.type === 'link')
    .map(({ title, from, to }) => ({ title, from, to }));
}

const URL_RE = /https?:\/\/\S+/g;
const TRAILING_PUNCT = /[.,;:!?"')\]]+$/;

export type TextSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; title: string; raw: string }
  | { type: 'tag'; title: string; raw: string }
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

/** Split text into plain, page-reference, and URL segments, for rendering. */
export function segmentText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const reference of findPageReferences(text)) {
    if (reference.from > last)
      segments.push(...segmentUrls(text.slice(last, reference.from)));
    segments.push({
      type: reference.type,
      title: reference.title,
      raw: reference.raw,
    });
    last = reference.to;
  }
  if (last < text.length) segments.push(...segmentUrls(text.slice(last)));
  return segments;
}
