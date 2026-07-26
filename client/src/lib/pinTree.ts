import {
  buildPinTree,
  pinnedSiblings,
  type Op,
  type Page,
  type PinFolder,
} from '@taproot/shared';
import { arrayMove } from '@dnd-kit/sortable';
import { generateKeyBetween } from 'fractional-indexing';

/**
 * The sidebar renders the pin tree as one flat <ul>, indenting folder children
 * with a class rather than nesting real lists. That keeps the dnd-kit setup
 * flat — one SortableContext, restrictToParentElement, the vertical list
 * strategy — while still reading as a tree.
 */
export type PinRow =
  | { kind: 'folder'; id: string; folder: PinFolder }
  | { kind: 'page'; id: string; page: Page; folderId: string | null };

/** Visible rows, top to bottom. Children of a collapsed folder are omitted. */
export function buildPinRows(pages: Page[], folders: PinFolder[]): PinRow[] {
  const rows: PinRow[] = [];
  for (const node of buildPinTree(pages, folders)) {
    if (node.type === 'page') {
      rows.push({
        kind: 'page',
        id: node.page.id,
        page: node.page,
        folderId: null,
      });
      continue;
    }
    rows.push({ kind: 'folder', id: node.folder.id, folder: node.folder });
    if (node.folder.collapsed) continue;
    for (const page of node.pages) {
      rows.push({ kind: 'page', id: page.id, page, folderId: node.folder.id });
    }
  }
  return rows;
}

/** The key that places `id` at `targetIndex` of `ordered`, or null if it already is there. */
function keyForMove(
  ordered: { id: string; key: string }[],
  id: string,
  targetIndex: number,
): string | null {
  const from = ordered.findIndex((entry) => entry.id === id);
  if (from === -1 || from === targetIndex || targetIndex === -1) return null;
  const moved = arrayMove(ordered, from, targetIndex);
  const at = moved.findIndex((entry) => entry.id === id);
  return generateKeyBetween(
    moved[at - 1]?.key ?? null,
    moved[at + 1]?.key ?? null,
  );
}

/** Top-level entries (folders and loose pinned pages) share one keyspace. */
function topLevel(pages: Page[], folders: PinFolder[]) {
  return buildPinTree(pages, folders).map((node) =>
    node.type === 'folder'
      ? { id: node.folder.id, key: node.folder.orderKey }
      : { id: node.page.id, key: node.page.pinnedOrderKey! },
  );
}

/**
 * The key that appends to the end of a container. At the top level that means
 * after the last *entry*, folders included — they share one keyspace with the
 * loose pages, so looking at pages alone would mint a key that collides with
 * an existing folder.
 */
export function appendPinKey(
  pages: Page[],
  folders: PinFolder[],
  folderId: string | null,
): string {
  const keys =
    folderId === null
      ? topLevel(pages, folders).map((entry) => entry.key)
      : pinnedSiblings(pages, folderId).map((page) => page.pinnedOrderKey!);
  return generateKeyBetween(keys[keys.length - 1] ?? null, null);
}

/** A folder only ever reorders among the top-level entries — folders don't nest. */
function dropFolder(
  pages: Page[],
  folders: PinFolder[],
  activeId: string,
  overId: string,
): Op[] {
  const entries = topLevel(pages, folders);
  // dropping onto a page inside a folder targets that folder's own slot
  const anchor =
    pages.find((page) => page.id === overId)?.pinnedFolderId ?? overId;
  const orderKey = keyForMove(
    entries,
    activeId,
    entries.findIndex((entry) => entry.id === anchor),
  );
  return orderKey === null
    ? []
    : [{ type: 'move_pin_folder', id: activeId, orderKey }];
}

/** A page dropped on a folder row goes inside it, at the end. */
function dropIntoFolder(
  pages: Page[],
  folders: PinFolder[],
  active: Page,
  folder: PinFolder,
): Op[] {
  if (active.pinnedFolderId === folder.id) return [];
  const ops: Op[] = [
    {
      type: 'set_page_pinned',
      id: active.id,
      orderKey: appendPinKey(pages, folders, folder.id),
      folderId: folder.id,
    },
  ];
  // a page dropped into a collapsed folder would vanish; open it instead
  if (folder.collapsed) {
    ops.push({
      type: 'set_pin_folder_collapsed',
      id: folder.id,
      collapsed: false,
    });
  }
  return ops;
}

/** A page dropped on another page joins that page's container at its slot. */
function dropOnPage(pages: Page[], active: Page, over: Page): Op[] {
  const target = over.pinnedFolderId ?? null;
  const siblings = pinnedSiblings(pages, target).map((page) => ({
    id: page.id,
    key: page.pinnedOrderKey!,
  }));
  const at = siblings.findIndex((entry) => entry.id === over.id);

  // arriving from another container: the page isn't in `siblings` yet, so
  // splice it in at the target's slot rather than reordering around it
  const orderKey =
    (active.pinnedFolderId ?? null) === target
      ? keyForMove(siblings, active.id, at)
      : generateKeyBetween(
          siblings[at - 1]?.key ?? null,
          siblings[at]?.key ?? null,
        );

  return orderKey === null
    ? []
    : [{ type: 'set_page_pinned', id: active.id, orderKey, folderId: target }];
}

/** Ops for a drag that ended over `overId`; empty when the drop is a no-op. */
export function resolvePinDrop(
  pages: Page[],
  folders: PinFolder[],
  activeId: string,
  overId: string,
): Op[] {
  if (activeId === overId) return [];
  if (folders.some((folder) => folder.id === activeId)) {
    return dropFolder(pages, folders, activeId, overId);
  }

  const active = pages.find((page) => page.id === activeId);
  if (!active || active.pinnedOrderKey === null) return [];

  const overFolder = folders.find((folder) => folder.id === overId);
  if (overFolder) return dropIntoFolder(pages, folders, active, overFolder);

  const over = pages.find((page) => page.id === overId);
  return over && over.pinnedOrderKey !== null
    ? dropOnPage(pages, active, over)
    : [];
}
