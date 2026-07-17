import type { Block, Op, Page } from '@taproot/shared';
import { create } from 'zustand';

interface FocusTarget {
  blockId: string;
  /** character offset in the raw text, or 'start' / 'end' */
  cursor: number | 'start' | 'end';
}

interface OutlineState {
  pages: Page[];
  blocks: Record<string, Block>;
  focused: FocusTarget | null;
  /** drawing block whose fullscreen editor is open, if any */
  openDrawingId: string | null;
  /** bumped whenever remote ops arrive, so views can refetch derived data (linked refs, sidebar) */
  remoteEpoch: number;
  /** driven by the WebSocket (open/close), not navigator.onLine */
  connectivity: 'online' | 'offline';
  /** queued write batches not yet confirmed by the server */
  pendingCount: number;
  setPages: (pages: Page[]) => void;
  /** replace the loaded blocks of one page with a fresh server snapshot */
  loadPageBlocks: (pageId: string, blocks: Block[]) => void;
  mergeBlocks: (blocks: Block[]) => void;
  applyOps: (ops: Op[]) => void;
  bumpRemoteEpoch: () => void;
  setConnectivity: (connectivity: 'online' | 'offline') => void;
  setPendingCount: (pendingCount: number) => void;
  /** an offline-created page turned out to exist server-side under another id */
  remapPageId: (from: string, to: string) => void;
  setFocus: (target: FocusTarget | null) => void;
  setOpenDrawing: (blockId: string | null) => void;
}

/** the subtree rooted at rootId, found by fixpoint since blocks is unordered */
function collectSubtree(
  blocks: Record<string, Block>,
  rootId: string,
): Set<string> {
  const doomed = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const block of Object.values(blocks)) {
      if (
        block.parentId &&
        doomed.has(block.parentId) &&
        !doomed.has(block.id)
      ) {
        doomed.add(block.id);
        grew = true;
      }
    }
  }
  return doomed;
}

/** true iff `blockId` sits somewhere below `ancestorId` (not equal to it) */
function isStrictDescendant(
  blocks: Record<string, Block>,
  blockId: string,
  ancestorId: string,
): boolean {
  let current = blocks[blockId];
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = blocks[current.parentId];
  }
  return false;
}

/** patch one block, or pass through unchanged if it isn't loaded */
function patchBlock(
  blocks: Record<string, Block>,
  id: string,
  patch: Partial<Block>,
): Record<string, Block> {
  const block = blocks[id];
  if (!block) return blocks;
  return { ...blocks, [id]: { ...block, ...patch } };
}

function applyOpToBlocks(
  blocks: Record<string, Block>,
  op: Op,
): Record<string, Block> {
  switch (op.type) {
    case 'create_page':
    case 'set_page_pinned':
      return blocks;
    case 'create_block':
      return {
        ...blocks,
        [op.id]: {
          id: op.id,
          pageId: op.pageId,
          parentId: op.parentId,
          orderKey: op.orderKey,
          text: op.text,
          kind: 'text',
          data: null,
          collapsed: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
    case 'update_text':
      return patchBlock(blocks, op.id, {
        text: op.text,
        updatedAt: Date.now(),
      });
    case 'move_block':
      return patchBlock(blocks, op.id, {
        parentId: op.parentId,
        orderKey: op.orderKey,
        updatedAt: Date.now(),
      });
    case 'set_collapsed':
      // presentation state, not content: updatedAt stays untouched
      return patchBlock(blocks, op.id, { collapsed: op.collapsed });
    case 'set_kind':
      return patchBlock(blocks, op.id, {
        kind: op.kind,
        updatedAt: Date.now(),
      });
    case 'update_data':
      return patchBlock(blocks, op.id, {
        data: op.data,
        updatedAt: Date.now(),
      });
    case 'delete_block': {
      // mirror the server's cascade: drop the block and all descendants
      const doomed = collectSubtree(blocks, op.id);
      const next: Record<string, Block> = {};
      for (const block of Object.values(blocks)) {
        if (!doomed.has(block.id)) next[block.id] = block;
      }
      return next;
    }
    default: {
      // exhaustiveness: adding an Op variant is a compile error here until handled
      op satisfies never;
      return blocks;
    }
  }
}

/**
 * Page-level counterpart of applyOpToBlocks. Deliberately not exhaustive —
 * most ops don't touch pages, so unknown ops pass through unchanged.
 */
function applyOpToPages(pages: Page[], op: Op): Page[] {
  if (op.type === 'set_page_pinned') {
    return pages.map((page) =>
      page.id === op.id ? { ...page, pinnedOrderKey: op.orderKey } : page,
    );
  }
  if (op.type === 'create_page') {
    // emitted when a page is created offline; online, pages arrive via fetch
    if (pages.some((page) => page.id === op.id)) return pages;
    return [
      ...pages,
      {
        id: op.id,
        title: op.title,
        createdAt: Date.now(),
        pinnedOrderKey: null,
      },
    ];
  }
  return pages;
}

export const useStore = create<OutlineState>((set) => ({
  pages: [],
  blocks: {},
  focused: null,
  openDrawingId: null,
  remoteEpoch: 0,
  connectivity: 'online',
  pendingCount: 0,
  setPages: (pages) => set({ pages }),
  loadPageBlocks: (pageId, incoming) =>
    set((state) => {
      const next: Record<string, Block> = {};
      for (const block of Object.values(state.blocks)) {
        if (block.pageId !== pageId) next[block.id] = block;
      }
      for (const block of incoming) next[block.id] = block;
      return { blocks: next };
    }),
  mergeBlocks: (incoming) =>
    set((state) => {
      const next = { ...state.blocks };
      for (const block of incoming) next[block.id] = block;
      return { blocks: next };
    }),
  applyOps: (ops) =>
    set((state) => {
      let blocks = state.blocks;
      let pages = state.pages;
      for (const op of ops) {
        blocks = applyOpToBlocks(blocks, op);
        pages = applyOpToPages(pages, op);
      }
      // a collapse that hides the focused block moves focus to the collapsed
      // ancestor (Roam behavior); covers both local and remote collapses
      let focused = state.focused;
      for (const op of ops) {
        if (op.type !== 'set_collapsed' || !op.collapsed || !focused) continue;
        if (isStrictDescendant(blocks, focused.blockId, op.id))
          focused = { blockId: op.id, cursor: 'end' };
      }
      return { blocks, pages, focused };
    }),
  bumpRemoteEpoch: () =>
    set((state) => ({ remoteEpoch: state.remoteEpoch + 1 })),
  setConnectivity: (connectivity) => set({ connectivity }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  remapPageId: (from, to) =>
    set((state) => ({
      pages: state.pages.map((page) =>
        page.id === from ? { ...page, id: to } : page,
      ),
      blocks: Object.fromEntries(
        Object.values(state.blocks).map((block) => [
          block.id,
          block.pageId === from ? { ...block, pageId: to } : block,
        ]),
      ),
    })),
  setFocus: (focused) => set({ focused }),
  setOpenDrawing: (openDrawingId) => set({ openDrawingId }),
}));
