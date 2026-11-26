import { isDailyTitle } from './daily.js';
import { cutToken, findAngleToken, type AngleToken } from './tokens.js';
import type { Block, TaskListItem, TaskTime } from './types.js';
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

/** Duration of a time token without an end: `<14:00>` means 14:00–14:30. */
export const DEFAULT_TASK_MINUTES = 30;

const DAY_MINUTES = 24 * 60;
const TIME_TOKEN_RE = /^(\d{2}):(\d{2})(?:-(\d{2}):(\d{2}))?$/;

function clockMinutes(hours: string, minutes: string): number | null {
  const h = Number(hours);
  const m = Number(minutes);
  return h <= 23 && m <= 59 ? h * 60 + m : null;
}

/**
 * Parse time-token content: "HH:MM" (default duration, cut off at midnight)
 * or "HH:MM-HH:MM" with the end after the start on the same day. Null for
 * anything else, so such tokens stay plain prose.
 */
export function parseTimeToken(content: string): TaskTime | null {
  const match = TIME_TOKEN_RE.exec(content);
  if (!match) return null;
  const start = clockMinutes(match[1]!, match[2]!);
  if (start === null) return null;
  if (match[3] === undefined)
    return { start, end: Math.min(start + DEFAULT_TASK_MINUTES, DAY_MINUTES) };
  const end = clockMinutes(match[3], match[4]!);
  return end !== null && end > start ? { start, end } : null;
}

/** First valid `<HH:MM>` / `<HH:MM-HH:MM>` token in the text, with its span. */
export function findTimeToken(text: string): AngleToken<TaskTime> | null {
  return findAngleToken(text, parseTimeToken);
}

/**
 * A task's scheduled time: its first valid time token, but only when the task
 * also has a date — a time without a daily link has no effect.
 */
export function taskTime(text: string): TaskTime | null {
  if (!firstDailyLink(text)) return null;
  return findTimeToken(text)?.value ?? null;
}

/** Minutes since midnight as "HH:MM" (1440 renders as "24:00"). */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * The token text for a time, always as an explicit range. An end at midnight
 * can't be written as a range ("24:00" is out of range): it is written as the
 * short form when that parses back to the same time, else clamped to 23:59.
 */
export function formatTimeToken(time: TaskTime): string {
  const { start, end } = time;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > DAY_MINUTES
  )
    throw new RangeError(`invalid task time ${start}–${end}`);
  if (end === DAY_MINUTES) {
    if (start + DEFAULT_TASK_MINUTES >= DAY_MINUTES)
      return `<${formatClock(start)}>`;
    return `<${formatClock(start)}-23:59>`;
  }
  return `<${formatClock(start)}-${formatClock(end)}>`;
}

/**
 * Rewrite a task's time: the first time token is replaced in place; without
 * one, the token goes right after the first daily link, else at the end; null
 * removes it. The date is untouched (see rescheduleTask). Pure text surgery —
 * callers ship the result as an ordinary update_text op.
 */
export function setTaskTime(text: string, time: TaskTime | null): string {
  const token = findTimeToken(text);
  if (time === null) return token ? cutToken(text, token.from, token.to) : text;
  const next = formatTimeToken(time);
  if (token) return text.slice(0, token.from) + next + text.slice(token.to);
  const link = firstDailyLink(text);
  if (link) return `${text.slice(0, link.to)} ${next}${text.slice(link.to)}`;
  const base = text.trimEnd();
  return base === '' ? next : `${base} ${next}`;
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
