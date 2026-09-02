import type { Op } from './ops.js';

export interface Page {
  id: string;
  title: string;
  createdAt: number;
  /** fractional index among its pinned siblings; null = not pinned */
  pinnedOrderKey: string | null;
  /** pin folder the page sits in; null = unpinned or pinned at top level */
  pinnedFolderId: string | null;
}

/** A folder in the pinned sidebar section. One level deep: folders hold pages, not folders. */
export interface PinFolder {
  id: string;
  name: string;
  /** fractional index shared with the top-level pages' pinnedOrderKey */
  orderKey: string;
  /** children hidden in the sidebar; persisted UI state, like Block.collapsed */
  collapsed: boolean;
  createdAt: number;
}

export type BlockKind = 'text' | 'drawing' | 'doc';

export interface Block {
  id: string;
  pageId: string;
  /** null = top-level block of the page */
  parentId: string | null;
  /** fractional index key; siblings sort lexicographically */
  orderKey: string;
  text: string;
  kind: BlockKind;
  /** opaque payload for non-text kinds (drawing: scene JSON; doc: raw markdown); never indexed */
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
  /** ancestor chain per root id, outermost first, excluding the root; [] for top-level roots */
  ancestors: Record<string, Block[]>;
  /** The root blocks plus all their descendants, flat; client builds the tree. */
  blocks: Block[];
}

/** One open task for the Tasks page; date/link facts are derived from block text. */
export interface TaskListItem {
  block: Block;
  /** the page the block lives on */
  page: Page;
  /** first YYYY-MM-DD page reference in the block text; null when undated */
  dueDate: string | null;
  /** text links to at least one non-daily page */
  hasPageLink: boolean;
}

export interface TasksPayload {
  tasks: TaskListItem[];
  /** Task roots and their descendants, for expandable task rows. Optional for cached pre-expansion payloads. */
  blocks?: Block[];
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
