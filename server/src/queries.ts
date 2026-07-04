import type {
  Block,
  LinkedRefGroup,
  PagePayload,
  ZoomPayload,
} from '@taproot/shared';
import { asc, eq } from 'drizzle-orm';
import type { Store } from './db.js';
import { blocks, pages, refs, tasks } from './schema.js';

export function listPages(store: Store) {
  return store.db.select().from(pages).orderBy(asc(pages.title)).all();
}

function getPageBlocks(store: Store, pageId: string): Block[] {
  return store.db
    .select()
    .from(blocks)
    .where(eq(blocks.pageId, pageId))
    .orderBy(asc(blocks.orderKey))
    .all();
}

/** parentId (or null for top level) -> children sorted by orderKey */
function childrenMap(list: Block[]): Map<string | null, Block[]> {
  const map = new Map<string | null, Block[]>();
  for (const block of list) {
    const siblings = map.get(block.parentId) ?? [];
    siblings.push(block);
    map.set(block.parentId, siblings);
  }
  return map;
}

function collectSubtree(
  map: Map<string | null, Block[]>,
  root: Block,
): Block[] {
  const result: Block[] = [root];
  const stack = [root.id];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const child of map.get(id) ?? []) {
      result.push(child);
      stack.push(child.id);
    }
  }
  return result;
}

/** Group matching blocks by their page, each root carrying its full subtree. */
function groupByPage(store: Store, matching: Block[]): LinkedRefGroup[] {
  const bySourcePage = new Map<string, Block[]>();
  for (const block of matching) {
    const group = bySourcePage.get(block.pageId) ?? [];
    group.push(block);
    bySourcePage.set(block.pageId, group);
  }

  const groups: LinkedRefGroup[] = [];
  for (const [sourcePageId, pageMatches] of bySourcePage) {
    const page = store.db
      .select()
      .from(pages)
      .where(eq(pages.id, sourcePageId))
      .get();
    if (!page) continue;
    const pageBlocks = getPageBlocks(store, sourcePageId);
    const byId = new Map(pageBlocks.map((b) => [b.id, b]));
    const map = childrenMap(pageBlocks);
    const matchIds = new Set(pageMatches.map((b) => b.id));

    // keep only top-most matches: a match nested under another match is
    // already part of that match's subtree
    const hasMatchingAncestor = (block: Block): boolean => {
      let parentId = block.parentId;
      while (parentId) {
        if (matchIds.has(parentId)) return true;
        parentId = byId.get(parentId)?.parentId ?? null;
      }
      return false;
    };
    const roots = pageMatches
      .filter((b) => !hasMatchingAncestor(b))
      .sort((a, b) => a.orderKey.localeCompare(b.orderKey));

    const seen = new Set<string>();
    const groupBlocks: Block[] = [];
    for (const root of roots) {
      for (const block of collectSubtree(map, root)) {
        if (!seen.has(block.id)) {
          seen.add(block.id);
          groupBlocks.push(block);
        }
      }
    }
    groups.push({ page, rootIds: roots.map((b) => b.id), blocks: groupBlocks });
  }
  return groups.sort((a, b) => a.page.title.localeCompare(b.page.title));
}

function linkedRefGroups(store: Store, pageId: string): LinkedRefGroup[] {
  const matching = store.db
    .select({ block: blocks })
    .from(refs)
    .innerJoin(blocks, eq(refs.blockId, blocks.id))
    .where(eq(refs.pageId, pageId))
    .all()
    .map((row) => row.block);
  return groupByPage(store, matching);
}

/** All open (TODO) tasks across the graph, grouped by page. */
export function getTaskGroups(store: Store): LinkedRefGroup[] {
  const matching = store.db
    .select({ block: blocks })
    .from(tasks)
    .innerJoin(blocks, eq(tasks.blockId, blocks.id))
    .where(eq(tasks.state, 'TODO'))
    .all()
    .map((row) => row.block);
  return groupByPage(store, matching);
}

export function getPagePayload(
  store: Store,
  pageId: string,
): PagePayload | null {
  const page = store.db.select().from(pages).where(eq(pages.id, pageId)).get();
  if (!page) return null;
  return {
    page,
    blocks: getPageBlocks(store, pageId),
    linkedRefs: linkedRefGroups(store, pageId),
  };
}

export function getZoomPayload(
  store: Store,
  blockId: string,
): ZoomPayload | null {
  const block = store.db
    .select()
    .from(blocks)
    .where(eq(blocks.id, blockId))
    .get();
  if (!block) return null;
  const page = store.db
    .select()
    .from(pages)
    .where(eq(pages.id, block.pageId))
    .get();
  if (!page) return null;

  const pageBlocks = getPageBlocks(store, block.pageId);
  const byId = new Map(pageBlocks.map((b) => [b.id, b]));

  const ancestors: Block[] = [];
  let parentId = block.parentId;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    parentId = parent.parentId;
  }

  return {
    page,
    ancestors,
    block,
    blocks: collectSubtree(childrenMap(pageBlocks), block),
  };
}
