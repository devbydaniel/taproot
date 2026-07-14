import {
  isDailyTitle,
  taskDueDate,
  taskHasPageLink,
  type Block,
  type JournalPayload,
  type LinkedRefGroup,
  type Page,
  type PagePayload,
  type TasksPayload,
  type ZoomPayload,
} from '@taproot/shared';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
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

/** pageId -> its blocks, preserving the input (orderKey) order */
function blocksByPageMap(list: Block[]): Map<string, Block[]> {
  const map = new Map<string, Block[]>();
  for (const block of list) {
    const pageBlocks = map.get(block.pageId) ?? [];
    pageBlocks.push(block);
    map.set(block.pageId, pageBlocks);
  }
  return map;
}

/** parentId (or null for top level) -> children sorted by orderKey */
export function childrenMap(list: Block[]): Map<string | null, Block[]> {
  const map = new Map<string | null, Block[]>();
  for (const block of list) {
    const siblings = map.get(block.parentId) ?? [];
    siblings.push(block);
    map.set(block.parentId, siblings);
  }
  return map;
}

export function collectSubtree(
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

/** Pages and full block lists of every page that contains a matching block. */
interface SourceData {
  pageById: Map<string, Page>;
  blocksBySourcePage: Map<string, Block[]>;
}

/** One batched fetch per table instead of two queries per source page. */
function fetchSourceData(store: Store, matching: Block[]): SourceData {
  const sourcePageIds = [...new Set(matching.map((block) => block.pageId))];
  if (sourcePageIds.length === 0)
    return { pageById: new Map(), blocksBySourcePage: new Map() };
  return {
    pageById: new Map(
      store.db
        .select()
        .from(pages)
        .where(inArray(pages.id, sourcePageIds))
        .all()
        .map((page) => [page.id, page]),
    ),
    blocksBySourcePage: blocksByPageMap(
      store.db
        .select()
        .from(blocks)
        .where(inArray(blocks.pageId, sourcePageIds))
        .orderBy(asc(blocks.orderKey))
        .all(),
    ),
  };
}

/** Ancestor chain of `block`, outermost first, excluding the block itself. */
function ancestorChain(byId: Map<string, Block>, block: Block): Block[] {
  const chain: Block[] = [];
  let parentId = block.parentId;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) break;
    chain.unshift(parent);
    parentId = parent.parentId;
  }
  return chain;
}

/** Group matching blocks by their page, each root carrying its full subtree. */
function buildGroups(
  matching: Block[],
  { pageById, blocksBySourcePage }: SourceData,
): LinkedRefGroup[] {
  const bySourcePage = blocksByPageMap(matching);
  if (bySourcePage.size === 0) return [];

  const groups: LinkedRefGroup[] = [];
  for (const [sourcePageId, pageMatches] of bySourcePage) {
    const page = pageById.get(sourcePageId);
    if (!page) continue;
    const pageBlocks = blocksBySourcePage.get(sourcePageId) ?? [];
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
      // code-point comparison — locale collation misorders mixed-case keys
      .sort((a, b) =>
        a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0,
      );

    const seen = new Set<string>();
    const groupBlocks: Block[] = [];
    const ancestors: Record<string, Block[]> = {};
    for (const root of roots) {
      for (const block of collectSubtree(map, root)) {
        if (!seen.has(block.id)) {
          seen.add(block.id);
          groupBlocks.push(block);
        }
      }
      ancestors[root.id] = ancestorChain(byId, root);
    }
    groups.push({
      page,
      rootIds: roots.map((b) => b.id),
      ancestors,
      blocks: groupBlocks,
    });
  }
  // daily pages first, newest to oldest (ISO titles sort chronologically as
  // strings); named pages after, alphabetical
  return groups.sort((a, b) => {
    const aDaily = isDailyTitle(a.page.title);
    const bDaily = isDailyTitle(b.page.title);
    if (aDaily !== bDaily) return aDaily ? -1 : 1;
    return aDaily
      ? b.page.title.localeCompare(a.page.title)
      : a.page.title.localeCompare(b.page.title);
  });
}

export function groupByPage(store: Store, matching: Block[]): LinkedRefGroup[] {
  return buildGroups(matching, fetchSourceData(store, matching));
}

export function linkedRefGroups(
  store: Store,
  pageId: string,
): LinkedRefGroup[] {
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

/**
 * All open (TODO) tasks, flat, with due-date/page-link facts derived from
 * block text. Date-dependent bucketing is the client's job — "today" is the
 * client's today.
 */
export function getTaskList(store: Store): TasksPayload {
  const open = store.db
    .select({ block: blocks })
    .from(tasks)
    .innerJoin(blocks, eq(tasks.blockId, blocks.id))
    .where(eq(tasks.state, 'TODO'))
    .all()
    .map((row) => row.block);
  const pageIds = [...new Set(open.map((block) => block.pageId))];
  const pageById = new Map(
    pageIds.length === 0
      ? []
      : store.db
          .select()
          .from(pages)
          .where(inArray(pages.id, pageIds))
          .all()
          .map((page) => [page.id, page] as const),
  );
  return {
    tasks: open.flatMap((block) => {
      const page = pageById.get(block.pageId);
      if (!page) return [];
      return [
        {
          block,
          page,
          dueDate: taskDueDate(block.text),
          hasPageLink: taskHasPageLink(block.text),
        },
      ];
    }),
  };
}

/** SQLite GLOB for date-shaped titles; isDailyTitle stays the source of truth. */
const DAILY_TITLE_GLOB = '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';

/**
 * Recent daily pages (ISO-date titles sort chronologically as strings),
 * newest first, with title-cursor pagination. Empty days are returned as
 * stored — whether to show them is the client's concern.
 */
export function getJournal(
  store: Store,
  opts: { before?: string; limit?: number } = {},
): JournalPayload {
  const limit = Number.isFinite(opts.limit)
    ? Math.min(Math.max(Math.floor(opts.limit!), 1), 100)
    : 20;
  // the '0' <= title < ':' range lets SQLite walk the unique title index
  // (digits sort just below ':'), GLOB narrows to date-shaped titles, and
  // isDailyTitle below rejects impossible dates (2026-02-30) the pattern
  // can't. fetching limit + 1 answers hasMore without counting everything;
  // an impossible-date title in the window can make hasMore err toward
  // true, costing one empty follow-up fetch at worst.
  const candidates = store.db
    .select()
    .from(pages)
    .where(
      and(
        gte(pages.title, '0'),
        lt(pages.title, ':'),
        sql`${pages.title} GLOB ${DAILY_TITLE_GLOB}`,
        opts.before !== undefined ? lt(pages.title, opts.before) : undefined,
      ),
    )
    .orderBy(desc(pages.title))
    .limit(limit + 1)
    .all();
  const hasMore = candidates.length > limit;
  const days = candidates
    .filter((page) => isDailyTitle(page.title))
    .slice(0, limit);
  if (days.length === 0) return { days: [], hasMore };

  const dayBlocks = blocksByPageMap(
    store.db
      .select()
      .from(blocks)
      .where(
        inArray(
          blocks.pageId,
          days.map((page) => page.id),
        ),
      )
      .orderBy(asc(blocks.orderKey))
      .all(),
  );

  // linked refs for the whole window at once: one refs fetch keyed by target
  // day, one shared source-page fetch, then per-day grouping in memory
  const refRows = store.db
    .select({ targetPageId: refs.pageId, block: blocks })
    .from(refs)
    .innerJoin(blocks, eq(refs.blockId, blocks.id))
    .where(
      inArray(
        refs.pageId,
        days.map((page) => page.id),
      ),
    )
    .all();
  const matchingByDay = new Map<string, Block[]>();
  for (const row of refRows) {
    const list = matchingByDay.get(row.targetPageId) ?? [];
    list.push(row.block);
    matchingByDay.set(row.targetPageId, list);
  }
  const sourceData = fetchSourceData(
    store,
    refRows.map((row) => row.block),
  );

  return {
    days: days.map((page) => ({
      page,
      blocks: dayBlocks.get(page.id) ?? [],
      linkedRefs: buildGroups(matchingByDay.get(page.id) ?? [], sourceData),
    })),
    hasMore,
  };
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

  return {
    page,
    ancestors: ancestorChain(byId, block),
    block,
    blocks: collectSubtree(childrenMap(pageBlocks), block),
  };
}
