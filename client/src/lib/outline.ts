import type { Block } from '@taproot/shared';

/**
 * The tree a view is showing: all blocks of `pageId`, rooted at `rootParentId`
 * (null for a full page, a block id for a zoomed view).
 */
export interface OutlineCtx {
  pageId: string;
  rootParentId: string | null;
  /** identifies this rendering when the same outline is visible in two panes */
  origin?: string;
}

export function childrenOf(
  blocks: Record<string, Block>,
  pageId: string,
  parentId: string | null,
): Block[] {
  return Object.values(blocks)
    .filter((b) => b.pageId === pageId && b.parentId === parentId)
    .sort((a, b) =>
      a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0,
    );
}

/** depth-first flattening of the visible tree, for arrow-key navigation */
export function visibleOrder(
  blocks: Record<string, Block>,
  ctx: OutlineCtx,
): Block[] {
  const result: Block[] = [];
  const walk = (parentId: string | null) => {
    for (const child of childrenOf(blocks, ctx.pageId, parentId)) {
      result.push(child);
      // a collapsed block is itself visible, but its subtree is not; the view
      // root's own flag is never consulted, so a zoomed block always expands
      if (!child.collapsed) walk(child.id);
    }
  };
  walk(ctx.rootParentId);
  return result;
}

/** Ancestors of a block, excluding the block itself. Guards malformed cycles. */
export function ancestorIds(
  blocks: Record<string, Block>,
  blockId: string,
): Set<string> {
  const result = new Set<string>();
  const seen = new Set([blockId]);
  let parentId = blocks[blockId]?.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    result.add(parentId);
    parentId = blocks[parentId]?.parentId ?? null;
  }
  return result;
}

export function oldestAncestorId(
  blocks: Record<string, Block>,
  blockId: string,
): string {
  return [...ancestorIds(blocks, blockId)].at(-1) ?? blockId;
}

export function siblingsOf(
  blocks: Record<string, Block>,
  block: Block,
): Block[] {
  return childrenOf(blocks, block.pageId, block.parentId);
}

export function hasChildren(
  blocks: Record<string, Block>,
  blockId: string,
): boolean {
  return Object.values(blocks).some((b) => b.parentId === blockId);
}
