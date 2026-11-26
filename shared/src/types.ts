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

/** Sent over /ws when the cached Google events or the sync state change; clients refetch their visible range. */
export interface CalendarBroadcast {
  type: 'calendar';
  status: CalendarSyncStatus;
}

/** Every message the server sends over /ws; switch on `type` and ignore unknown ones. */
export type ServerMessage = OpsBroadcast | CalendarBroadcast;

/** One read-only event from the synced Google calendar. */
export interface CalendarEvent {
  /** Google event id (recurring instances have their own) */
  id: string;
  /** '' when the event has no title */
  title: string;
  /** all-day: YYYY-MM-DD; timed: ISO 8601 in Europe/Berlin with offset, e.g. 2026-11-26T14:00:00+01:00 */
  start: string;
  /** exclusive; same format as `start` */
  end: string;
  allDay: boolean;
  status: 'confirmed' | 'tentative';
  /** video-call link (Google Meet); null when the event has none */
  meetLink: string | null;
  /** the event in Google Calendar */
  htmlLink: string | null;
}

/**
 * not_configured: no Google credentials, sync is off · pending: configured,
 * no attempt finished yet · ok: the last attempt succeeded · error: the last
 * attempt failed (the cache keeps the last successful state)
 */
export type CalendarSyncState = 'not_configured' | 'pending' | 'ok' | 'error';

export interface CalendarSyncStatus {
  state: CalendarSyncState;
  /** epoch ms of the last successful sync; null = never */
  lastSuccessAt: number | null;
  /** message of the failed last attempt; null unless state is 'error' */
  lastError: string | null;
  /** epoch ms of that failed attempt */
  lastErrorAt: number | null;
}

export interface CalendarEventsPayload {
  /** events overlapping the requested range, by start */
  events: CalendarEvent[];
  status: CalendarSyncStatus;
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

/**
 * A task's time of day on its due date, in wall-clock minutes since midnight.
 * start is 0–1439; end > start and at most 1440 (midnight, the day's end) —
 * a time never spans into the next day.
 */
export interface TaskTime {
  start: number;
  end: number;
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
  /** the task's <HH:MM> / <HH:MM-HH:MM> time; null without one or without a dueDate */
  time: TaskTime | null;
}

export interface TasksPayload {
  tasks: TaskListItem[];
  /** Task roots and their descendants, for expandable task rows. Optional for cached pre-expansion payloads. */
  blocks?: Block[];
}

/** Completed tasks dated in a range (their first daily link), for the calendar. */
export interface DoneTasksPayload {
  tasks: TaskListItem[];
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
