import { isDailyTitle } from './daily.js';
import { findPageReferences } from './wikilinks.js';

/**
 * Direct page references that act as assignments for an item. The host page
 * itself is structural membership, while daily-page references are scheduling,
 * so neither is an assignment filter option.
 */
export function assignedReferenceTitles(
  text: string,
  currentPageTitle: string,
): string[] {
  return [
    ...new Set(
      findPageReferences(text)
        .map((reference) => reference.title)
        .filter((title) => title !== currentPageTitle && !isDailyTitle(title)),
    ),
  ];
}

/** Unique assigned-reference options across item texts, alphabetically sorted. */
export function collectAssignedReferenceTitles(
  texts: Iterable<string>,
  currentPageTitle: string,
): string[] {
  const titles = new Set<string>();
  for (const text of texts) {
    for (const title of assignedReferenceTitles(text, currentPageTitle)) {
      titles.add(title);
    }
  }
  return [...titles].sort((a, b) => a.localeCompare(b));
}

/** Empty selection means All; otherwise an item matches any selected title. */
export function matchesAssignedReferenceFilter(
  text: string,
  currentPageTitle: string,
  selectedTitles: ReadonlySet<string>,
): boolean {
  if (selectedTitles.size === 0) return true;
  return assignedReferenceTitles(text, currentPageTitle).some((title) =>
    selectedTitles.has(title),
  );
}
