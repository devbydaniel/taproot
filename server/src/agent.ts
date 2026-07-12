import {
  suggestDailyTitles,
  todayTitle,
  type Block,
  type LinkedRefGroup,
  type Op,
  type Page,
} from '@taproot/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  DATE_VOCABULARY,
  fail,
  isFailure,
  type AgentBlockNode,
  type AgentBlockPayload,
  type AgentFailure,
  type AgentJournalPayload,
  type AgentOverview,
  type AgentPagePayload,
  type AgentPageRefsPayload,
  type AgentPageTasksPayload,
  type AgentRefGroup,
  type AgentSearchPayload,
  type AgentTaskGroup,
  type AgentWrite,
  type PageTarget,
} from './agentSchemas.js';
import type { Store } from './db.js';
import { applyOps } from './ops.js';
import {
  childrenMap,
  getJournal,
  getTaskGroups,
  getZoomPayload,
  groupByPage,
  linkedRefGroups,
  listPages,
} from './queries.js';
import { blocks, pages, refs, tasks } from './schema.js';

// ---------------------------------------------------------------------------
// Read side of the agent API: high-level, title-addressed functions for AI
// agents talking plain HTTP (write side: agentWrites.ts, shapes:
// agentSchemas.ts). Every write still goes through applyOps (invariant 1);
// these functions only assemble ops (generating ids and order keys so agents
// never have to) and return them for the route layer to broadcast.
// ---------------------------------------------------------------------------

/** Code-point comparison — locale collation misorders mixed-case keys. */
const byOrderKey = (a: Block, b: Block) =>
  a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0;

/**
 * Nest a flat block list into agent trees. Roots are the given ids (in that
 * order) or, when omitted, the blocks with parentId null sorted by orderKey.
 */
function toTrees(list: Block[], rootIds?: string[]): AgentBlockNode[] {
  const byId = new Map(list.map((b) => [b.id, b]));
  const map = childrenMap(list);
  const build = (block: Block): AgentBlockNode => {
    const node: AgentBlockNode = { id: block.id, text: block.text };
    if (block.kind === 'drawing') node.kind = 'drawing';
    const children = (map.get(block.id) ?? []).slice().sort(byOrderKey);
    if (children.length > 0) node.children = children.map(build);
    return node;
  };
  const roots = rootIds
    ? rootIds.flatMap((id) => byId.get(id) ?? [])
    : (map.get(null) ?? []).slice().sort(byOrderKey);
  return roots.map(build);
}

const toRefGroups = (groups: LinkedRefGroup[]): AgentRefGroup[] =>
  groups.map((group) => ({
    pageTitle: group.page.title,
    blocks: toTrees(group.blocks, group.rootIds),
  }));

/** Resolve a {title | date} target to an exact page title (no page lookup). */
export function resolveTargetTitle(
  target: PageTarget,
  now: Date,
): string | AgentFailure<400> {
  const title = target.title?.trim();
  const date = target.date?.trim();
  if ((title ? 1 : 0) + (date ? 1 : 0) !== 1) {
    return fail(400, "pass exactly one of 'title' or 'date'");
  }
  if (title) return title;
  const suggestion = suggestDailyTitles(date!, now)[0];
  if (!suggestion) {
    return fail(400, `cannot resolve date '${date}' — use ${DATE_VOCABULARY}`);
  }
  return suggestion.title;
}

export const getPageByTitle = (store: Store, title: string): Page | undefined =>
  store.db.select().from(pages).where(eq(pages.title, title)).get();

export const getBlock = (store: Store, id: string): Block | undefined =>
  store.db.select().from(blocks).where(eq(blocks.id, id)).get();

export const pageTitleOf = (store: Store, pageId: string): string =>
  store.db.select().from(pages).where(eq(pages.id, pageId)).get()!.title;

export const blockNotFound = (id: string): AgentFailure<404> =>
  fail(
    404,
    `block '${id}' not found — ids come from GET page, GET tasks, or GET search`,
  );

export function siblingRows(
  store: Store,
  pageId: string,
  parentId: string | null,
): { id: string; orderKey: string }[] {
  return store.db
    .select({ id: blocks.id, orderKey: blocks.orderKey })
    .from(blocks)
    .where(
      and(
        eq(blocks.pageId, pageId),
        parentId === null
          ? isNull(blocks.parentId)
          : eq(blocks.parentId, parentId),
      ),
    )
    .orderBy(asc(blocks.orderKey))
    .all();
}

const pageRef = (page: Page) => ({ id: page.id, title: page.title });

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function agentOverview(
  store: Store,
  now: Date = new Date(),
): AgentOverview {
  const counts = new Map(
    store.db
      .select({ pageId: blocks.pageId, count: sql<number>`count(*)` })
      .from(blocks)
      .groupBy(blocks.pageId)
      .all()
      .map((row) => [row.pageId, row.count]),
  );
  const openTasks =
    store.db
      .select({ count: sql<number>`count(*)` })
      .from(tasks)
      .where(eq(tasks.state, 'TODO'))
      .get()?.count ?? 0;
  return {
    today: todayTitle(now),
    pages: listPages(store).map((page) => ({
      id: page.id,
      title: page.title,
      blockCount: counts.get(page.id) ?? 0,
      pinned: page.pinnedOrderKey !== null,
    })),
    openTasks,
  };
}

const escapeLike = (term: string) => term.replace(/[\\%_]/g, (m) => '\\' + m);

export function agentSearch(
  store: Store,
  opts: { q: string; limit?: number; offset?: number },
): AgentSearchPayload {
  const terms = opts.q.trim().split(/\s+/).filter(Boolean);
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  if (terms.length === 0) {
    return { results: [], pageMatches: [], hasMore: false };
  }
  const likeAll = (column: typeof blocks.text | typeof pages.title) =>
    and(
      ...terms.map(
        (term) =>
          sql`${column} LIKE ${'%' + escapeLike(term) + '%'} ESCAPE '\\'`,
      ),
    );

  const matched = store.db
    .select()
    .from(blocks)
    .where(likeAll(blocks.text))
    .orderBy(desc(blocks.updatedAt))
    .limit(limit + 1)
    .offset(offset)
    .all();
  const hasMore = matched.length > limit;
  const window = matched.slice(0, limit);

  const { titleById, blockById } = fetchSearchContext(store, window);
  const breadcrumb = (block: Block): string[] => {
    const texts: string[] = [];
    let parentId = block.parentId;
    while (parentId) {
      const parent = blockById.get(parentId);
      if (!parent) break;
      texts.unshift(parent.text);
      parentId = parent.parentId;
    }
    return texts;
  };

  const pageMatches = store.db
    .select({ title: pages.title })
    .from(pages)
    .where(likeAll(pages.title))
    .orderBy(asc(pages.title))
    .limit(10)
    .all()
    .map((row) => row.title);

  return {
    results: window.map((block) => ({
      blockId: block.id,
      pageTitle: titleById.get(block.pageId) ?? '',
      text: block.text,
      breadcrumb: breadcrumb(block),
    })),
    pageMatches,
    hasMore,
  };
}

/**
 * Breadcrumb context: one batched fetch of the matched blocks' pages, then
 * ancestors are walked in memory (invariant 8 — no per-result queries).
 */
function fetchSearchContext(store: Store, window: Block[]) {
  const titleById = new Map<string, string>();
  const blockById = new Map<string, Block>();
  const sourcePageIds = [...new Set(window.map((b) => b.pageId))];
  if (sourcePageIds.length === 0) return { titleById, blockById };
  for (const page of store.db
    .select()
    .from(pages)
    .where(inArray(pages.id, sourcePageIds))
    .all()) {
    titleById.set(page.id, page.title);
  }
  for (const block of store.db
    .select()
    .from(blocks)
    .where(inArray(blocks.pageId, sourcePageIds))
    .all()) {
    blockById.set(block.id, block);
  }
  return { titleById, blockById };
}

/** Get-or-create: reading a page by title/date brings it into existence. */
export function agentGetPage(
  store: Store,
  target: PageTarget,
  now: Date = new Date(),
): AgentWrite<AgentPagePayload> | AgentFailure<400> {
  const title = resolveTargetTitle(target, now);
  if (isFailure(title)) return title;
  const ops: Op[] = [];
  let page = getPageByTitle(store, title);
  if (!page) {
    ops.push({ type: 'create_page', id: nanoid(), title });
    applyOps(store, ops);
    page = getPageByTitle(store, title)!;
  }
  const pageBlocks = store.db
    .select()
    .from(blocks)
    .where(eq(blocks.pageId, page.id))
    .orderBy(asc(blocks.orderKey))
    .all();
  return {
    ops,
    result: {
      page: pageRef(page),
      blocks: toTrees(pageBlocks),
      linkedRefs: toRefGroups(linkedRefGroups(store, page.id)),
    },
  };
}

export function agentGetBlock(
  store: Store,
  id: string,
): AgentBlockPayload | AgentFailure<404> {
  const payload = getZoomPayload(store, id);
  if (!payload) return blockNotFound(id);
  return {
    pageTitle: payload.page.title,
    breadcrumb: payload.ancestors.map((b) => ({ id: b.id, text: b.text })),
    block: toTrees(payload.blocks, [id])[0]!,
  };
}

export function agentTasks(store: Store): { groups: AgentTaskGroup[] } {
  return {
    groups: getTaskGroups(store).map((group) => ({
      pageTitle: group.page.title,
      tasks: toTrees(group.blocks, group.rootIds),
    })),
  };
}

/** Linked references of a page. Read-only: a miss does not create the page. */
export function agentPageRefs(
  store: Store,
  target: PageTarget,
  now: Date = new Date(),
): AgentPageRefsPayload | AgentFailure<400> {
  const title = resolveTargetTitle(target, now);
  if (isFailure(title)) return title;
  const page = getPageByTitle(store, title);
  if (!page) return { page: null, groups: [] };
  return {
    page: pageRef(page),
    groups: toRefGroups(linkedRefGroups(store, page.id)),
  };
}

/** Tasks whose text links to the page ("what's open for [[X]]"). Read-only. */
export function agentPageTasks(
  store: Store,
  target: PageTarget,
  state: 'TODO' | 'DONE' | 'all' = 'TODO',
  now: Date = new Date(),
): AgentPageTasksPayload | AgentFailure<400> {
  const title = resolveTargetTitle(target, now);
  if (isFailure(title)) return title;
  const page = getPageByTitle(store, title);
  if (!page) return { page: null, groups: [] };
  const matching = store.db
    .select({ block: blocks })
    .from(refs)
    .innerJoin(tasks, eq(refs.blockId, tasks.blockId))
    .innerJoin(blocks, eq(refs.blockId, blocks.id))
    .where(
      and(
        eq(refs.pageId, page.id),
        state === 'all' ? undefined : eq(tasks.state, state),
      ),
    )
    .all()
    .map((row) => row.block);
  return {
    page: pageRef(page),
    groups: groupByPage(store, matching).map((group) => ({
      pageTitle: group.page.title,
      tasks: toTrees(group.blocks, group.rootIds),
    })),
  };
}

export function agentJournal(
  store: Store,
  opts: { before?: string; limit?: number } = {},
): AgentJournalPayload {
  const journal = getJournal(store, {
    before: opts.before,
    limit: opts.limit ?? 5,
  });
  return {
    days: journal.days.map((day) => ({
      date: day.page.title,
      blocks: toTrees(day.blocks),
      linkedRefs: toRefGroups(day.linkedRefs),
    })),
    hasMore: journal.hasMore,
  };
}
