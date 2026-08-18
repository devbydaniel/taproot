import {
  isPinFolderOp,
  renamePageReferences,
  type Block,
  type Op,
  type Page,
  type PinFolder,
  type PinFolderOp,
} from '@taproot/shared';
import { create } from 'zustand';

interface FocusTarget {
  blockId: string;
  /** character offset in the raw text, or 'start' / 'end' */
  cursor: number | 'start' | 'end';
  /**
   * which rendering of the block owns the editor — a block can be on screen
   * both in an outline and in a linked-references row, but only the instance
   * whose origin matches mounts CodeMirror. Unset = the outline.
   */
  origin?: string;
}

interface OutlineState {
  pages: Page[];
  /** folders in the pinned sidebar section */
  pinFolders: PinFolder[];
  blocks: Record<string, Block>;
  focused: FocusTarget | null;
  /** drawing block whose fullscreen editor is open, if any */
  openDrawingId: string | null;
  /** doc block whose fullscreen markdown editor is open, if any */
  openDocId: string | null;
  /** bumped whenever remote ops arrive, so views can refetch derived data (linked refs, sidebar) */
  remoteEpoch: number;
  /** driven by the WebSocket (open/close), not navigator.onLine */
  connectivity: 'online' | 'offline';
  /** queued write batches not yet confirmed by the server */
  pendingCount: number;
  setPages: (pages: Page[]) => void;
  setPinFolders: (folders: PinFolder[]) => void;
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
  setOpenDoc: (blockId: string | null) => void;
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

function renameReferencesInBlocks(
  blocks: Record<string, Block>,
  op: Extract<Op, { type: 'rename_page' }>,
): Record<string, Block> {
  let changed = false;
  const next: Record<string, Block> = {};
  for (const block of Object.values(blocks)) {
    const text =
      block.kind === 'text'
        ? renamePageReferences(block.text, op.oldTitle, op.title)
        : block.text;
    if (text !== block.text) changed = true;
    next[block.id] =
      text === block.text ? block : { ...block, text, updatedAt: Date.now() };
  }
  return changed ? next : blocks;
}

function applyOpToBlocks(
  blocks: Record<string, Block>,
  op: Op,
): Record<string, Block> {
  if (isPinFolderOp(op)) return blocks;
  if (op.type === 'rename_page') return renameReferencesInBlocks(blocks, op);
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
  if (op.type === 'rename_page') {
    return pages.map((page) =>
      page.id === op.id ? { ...page, title: op.title } : page,
    );
  }
  if (op.type === 'set_page_pinned') {
    return pages.map((page) =>
      page.id === op.id
        ? {
            ...page,
            pinnedOrderKey: op.orderKey,
            // unpinning clears the folder too; absent folderId means top level
            pinnedFolderId: op.orderKey === null ? null : (op.folderId ?? null),
          }
        : page,
    );
  }
  if (op.type === 'delete_pin_folder') {
    // mirror the server: the pages inside are unpinned, not deleted
    return pages.map((page) =>
      page.pinnedFolderId === op.id
        ? { ...page, pinnedOrderKey: null, pinnedFolderId: null }
        : page,
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
        pinnedFolderId: null,
      },
    ];
  }
  return pages;
}

/** Pin-folder counterpart of applyOpToPages, over the folder ops only. */
function applyOpToPinFolders(
  folders: PinFolder[],
  op: PinFolderOp,
): PinFolder[] {
  switch (op.type) {
    case 'create_pin_folder':
      // idempotent like the server insert: the offline queue replays ops
      if (folders.some((folder) => folder.id === op.id)) return folders;
      return [
        ...folders,
        {
          id: op.id,
          name: op.name,
          orderKey: op.orderKey,
          collapsed: false,
          createdAt: Date.now(),
        },
      ];
    case 'rename_pin_folder':
      return folders.map((folder) =>
        folder.id === op.id ? { ...folder, name: op.name } : folder,
      );
    case 'move_pin_folder':
      return folders.map((folder) =>
        folder.id === op.id ? { ...folder, orderKey: op.orderKey } : folder,
      );
    case 'set_pin_folder_collapsed':
      return folders.map((folder) =>
        folder.id === op.id ? { ...folder, collapsed: op.collapsed } : folder,
      );
    case 'delete_pin_folder':
      return folders.filter((folder) => folder.id !== op.id);
    default:
      op satisfies never;
      return folders;
  }
}

export const useStore = create<OutlineState>((set) => ({
  pages: [],
  pinFolders: [],
  blocks: {},
  focused: null,
  openDrawingId: null,
  openDocId: null,
  remoteEpoch: 0,
  connectivity: 'online',
  pendingCount: 0,
  setPages: (pages) => set({ pages }),
  setPinFolders: (pinFolders) => set({ pinFolders }),
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
      let pinFolders = state.pinFolders;
      for (const op of ops) {
        if (op.type === 'rename_page') {
          const page = pages.find((item) => item.id === op.id);
          const titleConflict = pages.some(
            (item) => item.id !== op.id && item.title === op.title,
          );
          // Match the server's stale/conflicting-op no-op behavior. If this
          // page is not in the local list yet, the following epoch refetch is
          // authoritative and safer than rewriting unrelated loaded blocks.
          if (
            !page ||
            titleConflict ||
            (page.title !== op.oldTitle && page.title !== op.title)
          ) {
            continue;
          }
        }
        blocks = applyOpToBlocks(blocks, op);
        pages = applyOpToPages(pages, op);
        if (isPinFolderOp(op)) {
          pinFolders = applyOpToPinFolders(pinFolders, op);
        }
      }
      // a collapse that hides the focused block moves focus to the collapsed
      // ancestor (Roam behavior); covers both local and remote collapses
      let focused = state.focused;
      for (const op of ops) {
        if (op.type !== 'set_collapsed' || !op.collapsed || !focused) continue;
        if (isStrictDescendant(blocks, focused.blockId, op.id))
          focused = { blockId: op.id, cursor: 'end' };
      }
      return { blocks, pages, pinFolders, focused };
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
  setOpenDoc: (openDocId) => set({ openDocId }),
}));
