import { isDailyTitle } from './daily.js';
import type { Block, TaskListItem } from './types.js';
import { findPageReferences } from './wikilinks.js';

export type TaskState = 'TODO' | 'DONE';

const TASK_RE = /^(TODO|DONE)(?: |$)/;

/** A block is a task iff its text starts with a task marker. */
export function parseTask(
  text: string,
): { state: TaskState; rest: string } | null {
  const match = TASK_RE.exec(text);
  if (!match) return null;
  return { state: match[1] as TaskState, rest: text.slice(match[0].length) };
}

/** Replace (or remove, with null) the task marker, keeping the rest of the text. */
export function withTaskState(text: string, state: TaskState | null): string {
  const parsed = parseTask(text);
  const rest = parsed ? parsed.rest : text;
  return state === null ? rest : `${state} ${rest}`;
}

/** Cmd-Enter cycle: plain → TODO → DONE → plain. */
export function cycleTaskState(text: string): string {
  const parsed = parseTask(text);
  if (!parsed) return withTaskState(text, 'TODO');
  return withTaskState(text, parsed.state === 'TODO' ? 'DONE' : null);
}

/** First YYYY-MM-DD page reference in the text, with its spans; the task's date rule. */
export function firstDailyLink(text: string) {
  return (
    findPageReferences(text).find((reference) =>
      isDailyTitle(reference.title),
    ) ?? null
  );
}

/** A task's due date: the first daily-title page reference in its own text. */
export function taskDueDate(text: string): string | null {
  return firstDailyLink(text)?.title ?? null;
}

/** True when the text links to at least one non-daily page. */
export function taskHasPageLink(text: string): boolean {
  return findPageReferences(text).some(
    (reference) => !isDailyTitle(reference.title),
  );
}

/**
 * Rewrite a task's due date: the first daily link becomes [[title]], appended
 * when there is none; null removes it. Pure text surgery — callers ship the
 * result as an ordinary update_text op.
 */
export function rescheduleTask(text: string, title: string | null): string {
  const link = firstDailyLink(text);
  if (title === null) {
    if (!link) return text;
    return (text.slice(0, link.from) + text.slice(link.to))
      .replace(/ {2,}/g, ' ')
      .trimEnd();
  }
  if (!link) return `${text} [[${title}]]`;
  return text.slice(0, link.titleFrom) + title + text.slice(link.titleTo);
}

/**
 * File a task under a page: append ` [[title]]`, unless the text already
 * links to that page (case-insensitive). Pure text surgery — callers ship the
 * result as an ordinary update_text op.
 */
export function assignTaskPage(text: string, title: string): string {
  const linked = findPageReferences(text).some(
    (reference) => reference.title.toLowerCase() === title.toLowerCase(),
  );
  if (linked) return text;
  const base = text.trimEnd();
  return base === '' ? `[[${title}]]` : `${base} [[${title}]]`;
}

export interface TaskBuckets {
  /** no page link, no date — untriaged; createdAt asc (stalest first) */
  inbox: TaskListItem[];
  /** dueDate < today — dueDate asc, then createdAt */
  overdue: TaskListItem[];
  /** dueDate === today — createdAt asc */
  today: TaskListItem[];
  /** dueDate > today — dueDate asc, then createdAt */
  upcoming: TaskListItem[];
}

const byDueDate = (a: TaskListItem, b: TaskListItem) =>
  a.dueDate === b.dueDate
    ? a.block.createdAt - b.block.createdAt
    : a.dueDate! < b.dueDate!
      ? -1
      : 1;

/**
 * Split open tasks into the Tasks-page sections. A date always wins over a
 * page link (dated = triaged); undated page-linked tasks belong to their
 * page, not the Tasks page, and are dropped.
 */
export function bucketTasks(items: TaskListItem[], today: string): TaskBuckets {
  const inbox: TaskListItem[] = [];
  const overdue: TaskListItem[] = [];
  const todayItems: TaskListItem[] = [];
  const upcoming: TaskListItem[] = [];
  for (const item of items) {
    if (item.dueDate !== null) {
      if (item.dueDate < today) overdue.push(item);
      else if (item.dueDate === today) todayItems.push(item);
      else upcoming.push(item);
    } else if (!item.hasPageLink) {
      inbox.push(item);
    }
  }
  inbox.sort((a, b) => a.block.createdAt - b.block.createdAt);
  overdue.sort(byDueDate);
  todayItems.sort((a, b) => a.block.createdAt - b.block.createdAt);
  upcoming.sort(byDueDate);
  return { inbox, overdue, today: todayItems, upcoming };
}

export interface AgendaBuckets {
  /** dueDate < today; only when the displayed day IS today — dueDate asc, then createdAt */
  overdue: TaskListItem[];
  /** dueDate === the displayed page's title — createdAt asc */
  dueThisDay: TaskListItem[];
  /** open TODOs from the page's own outline, minus dated ones shown above — outline order */
  onPage: Block[];
}

/**
 * Buckets for the daily-page agenda widget. Overdue means an explicit past
 * date link only (undated tasks on old daily pages don't count) and appears
 * only when the displayed day is the real today; dueThisDay follows the
 * displayed page, so past and future days show their own agenda. onPage walks
 * the page's blocks in document order — collapsed subtrees included — and
 * skips blocks already claimed by the dated sections.
 */
export function bucketAgenda(
  items: TaskListItem[],
  pageBlocks: Block[],
  pageTitle: string,
  today: string,
): AgendaBuckets {
  const overdue: TaskListItem[] = [];
  const dueThisDay: TaskListItem[] = [];
  for (const item of items) {
    if (item.dueDate === null) continue;
    if (item.dueDate === pageTitle) dueThisDay.push(item);
    else if (pageTitle === today && item.dueDate < today) overdue.push(item);
  }
  overdue.sort(byDueDate);
  dueThisDay.sort((a, b) => a.block.createdAt - b.block.createdAt);
  const claimed = new Set(
    [...overdue, ...dueThisDay].map((item) => item.block.id),
  );

  const byParent = new Map<string | null, Block[]>();
  for (const block of pageBlocks) {
    const siblings = byParent.get(block.parentId);
    if (siblings) siblings.push(block);
    else byParent.set(block.parentId, [block]);
  }
  const onPage: Block[] = [];
  const visit = (parentId: string | null) => {
    const children = byParent.get(parentId) ?? [];
    children.sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1));
    for (const child of children) {
      if (!claimed.has(child.id) && parseTask(child.text)?.state === 'TODO') {
        onPage.push(child);
      }
      visit(child.id);
    }
  };
  visit(null);
  return { overdue, dueThisDay, onPage };
}
