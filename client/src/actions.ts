import { parseTask, withTaskState, type Op } from '@taproot/shared';
import { generateKeyBetween } from 'fractional-indexing';
import { nanoid } from 'nanoid';
import { api } from '@/lib/api';
import {
  childrenOf,
  hasChildren,
  siblingsOf,
  visibleOrder,
  type OutlineCtx,
} from '@/lib/outline';
import { useStore } from '@/store';

/** apply ops optimistically and send them to the server */
function dispatch(ops: Op[]) {
  useStore.getState().applyOps(ops);
  void api.postOps(ops);
}

// --- text updates: applied locally per keystroke, sent to the server debounced ---

const pendingText = new Map<string, string>();
let textTimer: ReturnType<typeof setTimeout> | null = null;

export function updateText(blockId: string, text: string) {
  useStore.getState().applyOps([{ type: 'update_text', id: blockId, text }]);
  pendingText.set(blockId, text);
  if (textTimer) clearTimeout(textTimer);
  textTimer = setTimeout(flushText, 400);
}

export function flushText() {
  if (textTimer) {
    clearTimeout(textTimer);
    textTimer = null;
  }
  if (pendingText.size === 0) return;
  const ops: Op[] = [...pendingText.entries()].map(([id, text]) => ({
    type: 'update_text',
    id,
    text,
  }));
  pendingText.clear();
  void api.postOps(ops);
}

/** Checkbox click: flip TODO ↔ DONE (only defined for blocks that are tasks). */
export function toggleTaskCheckbox(blockId: string) {
  const { blocks } = useStore.getState();
  const block = blocks[blockId];
  if (!block) return;
  const parsed = parseTask(block.text);
  if (!parsed) return;
  const text = withTaskState(
    block.text,
    parsed.state === 'TODO' ? 'DONE' : 'TODO',
  );
  flushText();
  dispatch([{ type: 'update_text', id: blockId, text }]);
}

/** Pin appends at the end of the pinned list; unpin clears the key. */
export function togglePagePinned(pageId: string) {
  const { pages } = useStore.getState();
  const page = pages.find((p) => p.id === pageId);
  if (!page) return;
  if (page.pinnedOrderKey !== null) {
    dispatch([{ type: 'set_page_pinned', id: pageId, orderKey: null }]);
    return;
  }
  const keys = pages
    .map((p) => p.pinnedOrderKey)
    .filter((k): k is string => k !== null)
    .sort();
  const orderKey = generateKeyBetween(keys[keys.length - 1] ?? null, null);
  dispatch([{ type: 'set_page_pinned', id: pageId, orderKey }]);
}

/** Chevron click / Mod-ArrowUp / Mod-ArrowDown: hide or show a block's children. */
export function setCollapsed(blockId: string, collapsed: boolean) {
  const { blocks } = useStore.getState();
  const block = blocks[blockId];
  if (!block || block.collapsed === collapsed) return;
  if (collapsed && !hasChildren(blocks, blockId)) return;
  flushText();
  dispatch([{ type: 'set_collapsed', id: blockId, collapsed }]);
}

// --- structural edits ---

/** Enter: split the block at the cursor; text after the cursor moves to the new block. */
export function splitBlock(blockId: string, cursor: number, _ctx: OutlineCtx) {
  const { blocks, setFocus } = useStore.getState();
  const block = blocks[blockId];
  if (!block) return;

  const before = block.text.slice(0, cursor);
  const after = block.text.slice(cursor);
  const newId = nanoid();

  let parentId: string | null;
  let orderKey: string;
  if (hasChildren(blocks, blockId) && !block.collapsed) {
    // keep children attached to their text: new block becomes the first child
    // (unless collapsed — then it becomes a visible next sibling instead)
    parentId = blockId;
    const kids = childrenOf(blocks, block.pageId, blockId);
    orderKey = generateKeyBetween(null, kids[0]?.orderKey ?? null);
  } else {
    parentId = block.parentId;
    const siblings = siblingsOf(blocks, block);
    const index = siblings.findIndex((b) => b.id === blockId);
    orderKey = generateKeyBetween(
      block.orderKey,
      siblings[index + 1]?.orderKey ?? null,
    );
  }

  pendingText.delete(blockId);
  flushText();
  dispatch([
    { type: 'update_text', id: blockId, text: before },
    {
      type: 'create_block',
      id: newId,
      pageId: block.pageId,
      parentId,
      orderKey,
      text: after,
    },
  ]);
  setFocus({ blockId: newId, cursor: 'start' });
}

/** Tab: become the last child of the previous sibling. */
export function indentBlock(blockId: string, cursor: number, _ctx: OutlineCtx) {
  const { blocks, setFocus } = useStore.getState();
  const block = blocks[blockId];
  if (!block) return;
  const siblings = siblingsOf(blocks, block);
  const index = siblings.findIndex((b) => b.id === blockId);
  const prev = siblings[index - 1];
  if (!prev) return;

  const newSiblings = childrenOf(blocks, block.pageId, prev.id);
  const orderKey = generateKeyBetween(
    newSiblings[newSiblings.length - 1]?.orderKey ?? null,
    null,
  );
  flushText();
  dispatch([
    // auto-expand a collapsed new parent so the indented block stays visible
    ...(prev.collapsed
      ? [{ type: 'set_collapsed', id: prev.id, collapsed: false } as const]
      : []),
    { type: 'move_block', id: blockId, parentId: prev.id, orderKey },
  ]);
  setFocus({ blockId, cursor });
}

/** Shift-Tab: become the sibling right after the current parent. */
export function outdentBlock(blockId: string, cursor: number, ctx: OutlineCtx) {
  const { blocks, setFocus } = useStore.getState();
  const block = blocks[blockId];
  if (!block) return;
  // already top-level of the current view (page root or zoom root)
  if (block.parentId === null || block.parentId === ctx.rootParentId) return;
  const parent = blocks[block.parentId];
  if (!parent) return;

  const parentSiblings = siblingsOf(blocks, parent);
  const parentIndex = parentSiblings.findIndex((b) => b.id === parent.id);
  const orderKey = generateKeyBetween(
    parent.orderKey,
    parentSiblings[parentIndex + 1]?.orderKey ?? null,
  );
  flushText();
  dispatch([
    { type: 'move_block', id: blockId, parentId: parent.parentId, orderKey },
  ]);
  setFocus({ blockId, cursor });
}

/** Delete a block (subtree cascades), focusing the previous visible block. */
export function deleteBlock(blockId: string, ctx: OutlineCtx) {
  const { blocks, setFocus } = useStore.getState();
  const order = visibleOrder(blocks, ctx);
  const index = order.findIndex((b) => b.id === blockId);
  const prev = index > 0 ? order[index - 1] : null;

  pendingText.delete(blockId);
  flushText();
  dispatch([{ type: 'delete_block', id: blockId }]);
  setFocus(prev ? { blockId: prev.id, cursor: 'end' } : null);
}

/** Backspace at position 0: delete the block if it is empty and childless. */
export function deleteEmptyBlock(blockId: string, ctx: OutlineCtx): boolean {
  const { blocks } = useStore.getState();
  const block = blocks[blockId];
  if (!block) return false;
  if (block.text !== '' || hasChildren(blocks, blockId)) return false;
  deleteBlock(blockId, ctx);
  return true;
}

// --- drawing blocks ---

/** '/draw' + Enter: turn the block into a drawing and start drawing. */
export function convertToDrawing(blockId: string) {
  const { blocks, setFocus, setOpenDrawing } = useStore.getState();
  if (!blocks[blockId]) return;
  pendingText.delete(blockId);
  flushText();
  dispatch([
    { type: 'update_text', id: blockId, text: '' },
    { type: 'set_kind', id: blockId, kind: 'drawing' },
  ]);
  setFocus({ blockId, cursor: 'end' });
  setOpenDrawing(blockId);
}

/** Persist a drawing's scene JSON (the editor debounces its calls). */
export function saveDrawing(blockId: string, data: string) {
  dispatch([{ type: 'update_data', id: blockId, data }]);
}

/** Arrow navigation across blocks. dir -1 = previous, 1 = next in visible order. */
export function focusNeighbor(
  blockId: string,
  dir: -1 | 1,
  ctx: OutlineCtx,
  cursor: 'start' | 'end',
): boolean {
  const { blocks, setFocus } = useStore.getState();
  const order = visibleOrder(blocks, ctx);
  const index = order.findIndex((b) => b.id === blockId);
  const target = order[index + dir];
  if (!target) return false;
  setFocus({ blockId: target.id, cursor });
  return true;
}

/** Append an empty block at the end of the current view's top level and focus it. */
export function appendBlock(ctx: OutlineCtx) {
  const { blocks, setFocus } = useStore.getState();
  const existing = childrenOf(blocks, ctx.pageId, ctx.rootParentId);
  const orderKey = generateKeyBetween(
    existing[existing.length - 1]?.orderKey ?? null,
    null,
  );
  const id = nanoid();
  flushText();
  dispatch([
    {
      type: 'create_block',
      id,
      pageId: ctx.pageId,
      parentId: ctx.rootParentId,
      orderKey,
      text: '',
    },
  ]);
  setFocus({ blockId: id, cursor: 'start' });
}
