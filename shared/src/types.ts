import type { Op } from './ops.js';

export interface Page {
  id: string;
  title: string;
  createdAt: number;
  /** fractional index among pinned pages; null = not pinned */
  pinnedOrderKey: string | null;
}

export type BlockKind = 'text' | 'drawing';

export interface Block {
  id: string;
  pageId: string;
  /** null = top-level block of the page */
  parentId: string | null;
  /** fractional index key; siblings sort lexicographically */
  orderKey: string;
  text: string;
  kind: BlockKind;
  /** opaque payload for non-text kinds (drawing: scene JSON); never indexed */
  data: string | null;
  /** children hidden in outline views; persisted UI state, not content */
  collapsed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface OpsBroadcast {
  type: 'ops';
  clientId: string;
  ops: Op[];
}

/** One group of linked references: blocks on `page` whose text mentions the target page. */
export interface LinkedRefGroup {
  page: Page;
  /** Top-most matching blocks (matches nested under another match are folded into its subtree). */
  rootIds: string[];
  /** The root blocks plus all their descendants, flat; client builds the tree. */
  blocks: Block[];
}

/** One day of the journal: a daily page plus its full flat block list. */
export interface JournalDay {
  page: Page;
  blocks: Block[];
  linkedRefs: LinkedRefGroup[];
}

export interface JournalPayload {
  /** daily pages, newest first */
  days: JournalDay[];
  hasMore: boolean;
}

export interface PagePayload {
  page: Page;
  blocks: Block[];
  linkedRefs: LinkedRefGroup[];
}

export interface ZoomPayload {
  page: Page;
  /** ancestor chain, outermost first (excluding the zoomed block itself) */
  ancestors: Block[];
  block: Block;
  /** the zoomed block plus all descendants, flat */
  blocks: Block[];
}
