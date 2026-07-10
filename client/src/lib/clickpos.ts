import { segmentText } from '@taproot/shared';

/**
 * Character offset within the *rendered* text of `container` for a click at
 * (x, y), or null if the point does not hit text inside the container.
 */
export function renderedOffsetFromPoint(
  container: HTMLElement,
  x: number,
  y: number,
): number | null {
  let node: Node | null = null;
  let offset = 0;
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- feature detection: Safari < 18 lacks caretPositionFromPoint
  if (doc.caretPositionFromPoint) {
    const position = doc.caretPositionFromPoint(x, y);
    if (position) {
      node = position.offsetNode;
      offset = position.offset;
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- feature detection: deprecated fallback is absent in some engines
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || !container.contains(node)) return null;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current === node) return total + offset;
    total += current.textContent?.length ?? 0;
  }
  return null;
}

/**
 * Map an offset in the rendered text (wikilinks shown as bare titles) back to
 * an offset in the raw text (with [[ ]] markup). Clicks inside a link map to
 * the end of the raw link.
 */
export function renderedToRaw(rawText: string, renderedOffset: number): number {
  let rendered = 0;
  let raw = 0;
  for (const segment of segmentText(rawText)) {
    if (segment.type === 'text' || segment.type === 'url') {
      const value = segment.type === 'text' ? segment.value : segment.url;
      if (renderedOffset <= rendered + value.length) {
        return raw + (renderedOffset - rendered);
      }
      rendered += value.length;
      raw += value.length;
    } else {
      if (renderedOffset <= rendered + segment.title.length) {
        return raw + segment.raw.length;
      }
      rendered += segment.title.length;
      raw += segment.raw.length;
    }
  }
  return rawText.length;
}
