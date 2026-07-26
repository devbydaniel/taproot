import type { Page, PinFolder } from './types.js';

/**
 * The pinned sidebar is one level deep: folders and loose pinned pages share a
 * single top-level ordering, and a folder holds pages (never other folders).
 *
 * Both the sidebar and the agent overview render this structure, so the
 * ordering rules live here rather than in either consumer.
 */
export type PinTreeNode =
  | { type: 'page'; page: Page }
  | { type: 'folder'; folder: PinFolder; pages: Page[] };

/**
 * Code-point comparison: fractional-index keys are case-sensitive, and locale
 * collation would put 'Zz' after 'a0'.
 */
export const compareOrderKeys = (a: string, b: string) =>
  a < b ? -1 : a > b ? 1 : 0;

/** Pinned pages inside `folderId` (null = top level), in order. */
export function pinnedSiblings(pages: Page[], folderId: string | null): Page[] {
  return pages
    .filter(
      (page) =>
        page.pinnedOrderKey !== null &&
        (page.pinnedFolderId ?? null) === folderId,
    )
    .sort((a, b) => compareOrderKeys(a.pinnedOrderKey!, b.pinnedOrderKey!));
}

export function buildPinTree(
  pages: Page[],
  folders: PinFolder[],
): PinTreeNode[] {
  const known = new Set(folders.map((folder) => folder.id));
  const children = new Map<string, Page[]>();
  const top: { orderKey: string; node: PinTreeNode }[] = [];

  for (const page of pages) {
    if (page.pinnedOrderKey === null) continue;
    const folderId = page.pinnedFolderId ?? null;
    // a page pointing at a folder that no longer exists falls back to top level
    if (folderId === null || !known.has(folderId)) {
      top.push({ orderKey: page.pinnedOrderKey, node: { type: 'page', page } });
      continue;
    }
    const siblings = children.get(folderId);
    if (siblings) siblings.push(page);
    else children.set(folderId, [page]);
  }

  for (const folder of folders) {
    const pagesInFolder = (children.get(folder.id) ?? []).sort((a, b) =>
      compareOrderKeys(a.pinnedOrderKey!, b.pinnedOrderKey!),
    );
    top.push({
      orderKey: folder.orderKey,
      node: { type: 'folder', folder, pages: pagesInFolder },
    });
  }

  return top
    .sort((a, b) => compareOrderKeys(a.orderKey, b.orderKey))
    .map((entry) => entry.node);
}

/** The order key of every top-level entry, in order — the keyspace a new folder appends to. */
export function topLevelOrderKeys(
  pages: Page[],
  folders: PinFolder[],
): string[] {
  return buildPinTree(pages, folders).map((node) =>
    node.type === 'folder' ? node.folder.orderKey : node.page.pinnedOrderKey!,
  );
}
