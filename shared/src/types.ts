export interface Page {
  id: string;
  title: string;
  createdAt: number;
}

export interface Block {
  id: string;
  pageId: string;
  /** null = top-level block of the page */
  parentId: string | null;
  /** fractional index key; siblings sort lexicographically */
  orderKey: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * All writes are expressed as small idempotent operations. The client applies
 * them optimistically and posts them to the server; the server applies them
 * transactionally, maintains the refs index, and broadcasts them to other
 * connected clients.
 */
export type Op =
  | { type: 'create_page'; id: string; title: string }
  | {
      type: 'create_block';
      id: string;
      pageId: string;
      parentId: string | null;
      orderKey: string;
      text: string;
    }
  | { type: 'update_text'; id: string; text: string }
  | {
      type: 'move_block';
      id: string;
      parentId: string | null;
      orderKey: string;
    }
  | { type: 'delete_block'; id: string };

export interface OpsRequest {
  clientId: string;
  ops: Op[];
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
