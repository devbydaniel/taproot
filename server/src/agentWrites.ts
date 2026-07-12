import {
  advanceRecurringTask,
  parseTask,
  withTaskState,
  type Block,
  type Op,
} from '@taproot/shared';
import { eq } from 'drizzle-orm';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { nanoid } from 'nanoid';
import {
  blockNotFound,
  getBlock,
  getPageByTitle,
  pageTitleOf,
  resolveTargetTitle,
  siblingRows,
} from './agent.js';
import {
  fail,
  isFailure,
  type AgentAppendResult,
  type AgentBlockNode,
  type AgentDeleteResult,
  type AgentFailure,
  type AgentInputNode,
  type AgentMoveResult,
  type AgentTaskResult,
  type AgentWrite,
  type AppendRequest,
  type MoveRequest,
} from './agentSchemas.js';
import type { Store } from './db.js';
import { applyOps } from './ops.js';
import { childrenMap, collectSubtree } from './queries.js';
import { blocks } from './schema.js';

// ---------------------------------------------------------------------------
// Write side of the agent API (read side: agent.ts, shapes: agentSchemas.ts).
// Functions assemble ops — generating nanoids and fractional order keys so
// agents never have to — apply them via applyOps (invariant 1), and return
// them for the route layer to broadcast.
// ---------------------------------------------------------------------------

const crossPageFailure = (): AgentFailure<400> =>
  fail(
    400,
    'cross-page moves are not supported — append a copy to the other page and delete the original',
  );

/** Non-blank lines of a multi-line text; a fully blank text keeps one block. */
function splitLines(text: string): string[] {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  return lines.length > 0 ? lines : [''];
}

/**
 * A multi-line text without children splits into consecutive sibling blocks
 * (blocks are single-line — invariant 9); with children the split would be
 * ambiguous, so refuse.
 */
function normalizeNodes(
  nodes: AgentInputNode[],
): AgentInputNode[] | AgentFailure<400> {
  const out: AgentInputNode[] = [];
  for (const node of nodes) {
    const children = node.children ? normalizeNodes(node.children) : undefined;
    if (isFailure(children)) return children;
    const text = node.text.replace(/\r/g, '');
    if (!text.includes('\n')) {
      out.push(children?.length ? { text, children } : { text });
    } else if (children?.length) {
      return fail(
        400,
        'block text is single-line — put each line in its own node instead of combining newlines with children',
      );
    } else {
      for (const line of splitLines(text)) out.push({ text: line });
    }
  }
  return out;
}

/** Emit create_block ops for a normalized tree, returning the id-bearing echo. */
function buildCreateOps(
  ops: Op[],
  nodes: AgentInputNode[],
  pageId: string,
  parentId: string | null,
  orderKeys: string[],
): AgentBlockNode[] {
  return nodes.map((node, index) => {
    const id = nanoid();
    ops.push({
      type: 'create_block',
      id,
      pageId,
      parentId,
      orderKey: orderKeys[index]!,
      text: node.text,
    });
    const echo: AgentBlockNode = { id, text: node.text };
    if (node.children?.length) {
      echo.children = buildCreateOps(
        ops,
        node.children,
        pageId,
        id,
        generateNKeysBetween(null, null, node.children.length),
      );
    }
    return echo;
  });
}

interface AppendTarget {
  ops: Op[];
  pageId: string;
  pageTitle: string;
  parentId: string | null;
}

function resolveAppendTarget(
  store: Store,
  body: AppendRequest,
  now: Date,
): AppendTarget | AgentFailure {
  const targets =
    (body.page?.trim() ? 1 : 0) +
    (body.date?.trim() ? 1 : 0) +
    (body.parentBlockId ? 1 : 0);
  if (targets !== 1) {
    return fail(400, "pass exactly one of 'page', 'date', or 'parentBlockId'");
  }
  if (body.parentBlockId) {
    const parent = getBlock(store, body.parentBlockId);
    if (!parent) return blockNotFound(body.parentBlockId);
    return {
      ops: [],
      pageId: parent.pageId,
      pageTitle: pageTitleOf(store, parent.pageId),
      parentId: parent.id,
    };
  }
  const title = resolveTargetTitle({ title: body.page, date: body.date }, now);
  if (isFailure(title)) return title;
  const page = getPageByTitle(store, title);
  const pageId = page?.id ?? nanoid();
  // create_page op instead of ensurePage so the creation broadcasts too
  const ops: Op[] = page ? [] : [{ type: 'create_page', id: pageId, title }];
  return { ops, pageId, pageTitle: title, parentId: null };
}

export function agentAppend(
  store: Store,
  body: AppendRequest,
  now: Date = new Date(),
): AgentWrite<AgentAppendResult> | AgentFailure {
  const target = resolveAppendTarget(store, body, now);
  if (isFailure(target)) return target;
  const nodes = normalizeNodes(body.blocks);
  if (isFailure(nodes)) return nodes;
  if (nodes.length === 0) return fail(400, 'no non-empty blocks to create');

  const { ops, pageId, pageTitle, parentId } = target;
  const siblings = siblingRows(store, pageId, parentId);
  const rootKeys =
    body.position === 'first'
      ? generateNKeysBetween(null, siblings[0]?.orderKey ?? null, nodes.length)
      : generateNKeysBetween(
          siblings.at(-1)?.orderKey ?? null,
          null,
          nodes.length,
        );
  const created = buildCreateOps(ops, nodes, pageId, parentId, rootKeys);
  applyOps(store, ops);
  return { ops, result: { page: { id: pageId, title: pageTitle }, created } };
}

export function agentUpdateText(
  store: Store,
  id: string,
  text: string,
): AgentWrite<{ id: string; text: string }> | AgentFailure {
  if (/[\n\r]/.test(text)) {
    return fail(
      400,
      'blocks are single-line — to add multiple blocks use POST blocks with parentBlockId',
    );
  }
  const block = getBlock(store, id);
  if (!block) return blockNotFound(id);
  const ops: Op[] = [{ type: 'update_text', id, text }];
  applyOps(store, ops);
  return { ops, result: { id, text } };
}

export function agentSetTaskState(
  store: Store,
  id: string,
  state: 'TODO' | 'DONE' | 'none',
  now: Date = new Date(),
): AgentWrite<AgentTaskResult> | AgentFailure<404> {
  const block = getBlock(store, id);
  if (!block) return blockNotFound(id);
  const text = withTaskState(block.text, state === 'none' ? null : state);
  const ops: Op[] = [{ type: 'update_text', id, text }];

  // completing a recurring task spawns the next instance as the following
  // sibling — mirrors toggleTaskCheckbox in the client, and only fires on a
  // real TODO -> DONE transition so repeated DONE calls don't multiply tasks
  let spawned: AgentTaskResult['spawned'] = null;
  const completing =
    state === 'DONE' && parseTask(block.text)?.state === 'TODO';
  const nextText = completing ? advanceRecurringTask(block.text, now) : null;
  if (nextText !== null) {
    const siblings = siblingRows(store, block.pageId, block.parentId);
    const index = siblings.findIndex((row) => row.id === id);
    const nextKey = siblings[index + 1]?.orderKey ?? null;
    spawned = { id: nanoid(), text: nextText };
    ops.push({
      type: 'create_block',
      id: spawned.id,
      pageId: block.pageId,
      parentId: block.parentId,
      orderKey: generateKeyBetween(block.orderKey, nextKey),
      text: nextText,
    });
  }
  applyOps(store, ops);
  return { ops, result: { id, text, spawned } };
}

interface MovePosition {
  parentId: string | null;
  orderKey: string;
}

/** Position directly after/before an anchor sibling. */
function positionFromAnchor(
  store: Store,
  block: Block,
  anchorId: string,
  after: boolean,
): MovePosition | AgentFailure {
  if (anchorId === block.id) {
    return fail(400, 'cannot move a block relative to itself');
  }
  const anchor = getBlock(store, anchorId);
  if (!anchor) return blockNotFound(anchorId);
  if (anchor.pageId !== block.pageId) return crossPageFailure();
  const siblings = siblingRows(store, block.pageId, anchor.parentId).filter(
    (row) => row.id !== block.id,
  );
  const index = siblings.findIndex((row) => row.id === anchorId);
  const orderKey = after
    ? generateKeyBetween(anchor.orderKey, siblings[index + 1]?.orderKey ?? null)
    : generateKeyBetween(
        siblings[index - 1]?.orderKey ?? null,
        anchor.orderKey,
      );
  return { parentId: anchor.parentId, orderKey };
}

/** First/last position under a parent block (null = page top level). */
function positionInParent(
  store: Store,
  block: Block,
  parentId: string | null,
  position: 'first' | 'last' | undefined,
): MovePosition | AgentFailure {
  if (parentId !== null) {
    const parent = getBlock(store, parentId);
    if (!parent) return blockNotFound(parentId);
    if (parent.pageId !== block.pageId) return crossPageFailure();
  }
  const siblings = siblingRows(store, block.pageId, parentId).filter(
    (row) => row.id !== block.id,
  );
  const orderKey =
    position === 'first'
      ? generateKeyBetween(null, siblings[0]?.orderKey ?? null)
      : generateKeyBetween(siblings.at(-1)?.orderKey ?? null, null);
  return { parentId, orderKey };
}

/** applyOp's cycle guard silently no-ops; detect here so the agent gets told. */
function wouldCycle(
  store: Store,
  blockId: string,
  parentId: string | null,
): boolean {
  let cursor = parentId;
  while (cursor) {
    if (cursor === blockId) return true;
    cursor = getBlock(store, cursor)?.parentId ?? null;
  }
  return false;
}

export function agentMove(
  store: Store,
  id: string,
  body: MoveRequest,
): AgentWrite<AgentMoveResult> | AgentFailure {
  const modes =
    (body.parentBlockId !== undefined ? 1 : 0) +
    (body.afterBlockId !== undefined ? 1 : 0) +
    (body.beforeBlockId !== undefined ? 1 : 0);
  if (modes !== 1) {
    return fail(
      400,
      "pass exactly one of 'parentBlockId' (null for page top level), 'afterBlockId', or 'beforeBlockId'",
    );
  }
  const block = getBlock(store, id);
  if (!block) return blockNotFound(id);

  const anchorId = body.afterBlockId ?? body.beforeBlockId;
  const position =
    anchorId !== undefined
      ? positionFromAnchor(
          store,
          block,
          anchorId,
          body.afterBlockId !== undefined,
        )
      : positionInParent(
          store,
          block,
          body.parentBlockId ?? null,
          body.position,
        );
  if (isFailure(position)) return position;
  if (wouldCycle(store, id, position.parentId)) {
    return fail(400, 'cannot move a block under itself or its own descendant');
  }

  const ops: Op[] = [
    {
      type: 'move_block',
      id,
      parentId: position.parentId,
      orderKey: position.orderKey,
    },
  ];
  applyOps(store, ops);
  return {
    ops,
    result: {
      id,
      parentId: position.parentId,
      pageTitle: pageTitleOf(store, block.pageId),
    },
  };
}

export function agentDelete(
  store: Store,
  id: string,
): AgentWrite<AgentDeleteResult> | AgentFailure<404> {
  const block = getBlock(store, id);
  if (!block) return blockNotFound(id);
  const pageBlocks = store.db
    .select()
    .from(blocks)
    .where(eq(blocks.pageId, block.pageId))
    .all();
  const descendants = collectSubtree(childrenMap(pageBlocks), block).length - 1;
  const ops: Op[] = [{ type: 'delete_block', id }];
  applyOps(store, ops);
  return { ops, result: { deleted: { id, descendants } } };
}
