import type { Block, Op, Page } from '@taproot/shared';
import { create } from 'zustand';

export interface FocusTarget {
  blockId: string;
  /** character offset in the raw text, or 'start' / 'end' */
  cursor: number | 'start' | 'end';
}

interface OutlineState {
  pages: Page[];
  blocks: Record<string, Block>;
  focused: FocusTarget | null;
  /** bumped whenever remote ops arrive, so views can refetch derived data (linked refs, sidebar) */
  remoteEpoch: number;
  setPages: (pages: Page[]) => void;
  /** replace the loaded blocks of one page with a fresh server snapshot */
  loadPageBlocks: (pageId: string, blocks: Block[]) => void;
  mergeBlocks: (blocks: Block[]) => void;
  applyOps: (ops: Op[]) => void;
  bumpRemoteEpoch: () => void;
  setFocus: (target: FocusTarget | null) => void;
}

function applyOpToBlocks(
  blocks: Record<string, Block>,
  op: Op,
): Record<string, Block> {
  switch (op.type) {
    case 'create_page':
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
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
    case 'update_text': {
      const block = blocks[op.id];
      if (!block) return blocks;
      return {
        ...blocks,
        [op.id]: { ...block, text: op.text, updatedAt: Date.now() },
      };
    }
    case 'move_block': {
      const block = blocks[op.id];
      if (!block) return blocks;
      return {
        ...blocks,
        [op.id]: {
          ...block,
          parentId: op.parentId,
          orderKey: op.orderKey,
          updatedAt: Date.now(),
        },
      };
    }
    case 'delete_block': {
      // mirror the server's cascade: drop the block and all descendants
      const doomed = new Set([op.id]);
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

export const useStore = create<OutlineState>((set) => ({
  pages: [],
  blocks: {},
  focused: null,
  remoteEpoch: 0,
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
      for (const op of ops) blocks = applyOpToBlocks(blocks, op);
      return { blocks };
    }),
  bumpRemoteEpoch: () =>
    set((state) => ({ remoteEpoch: state.remoteEpoch + 1 })),
  setFocus: (focused) => set({ focused }),
}));
