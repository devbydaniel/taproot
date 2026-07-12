import { isDailyTitle } from './daily.js';
import type { TaskListItem } from './types.js';
import { findWikilinks } from './wikilinks.js';

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

/** First [[YYYY-MM-DD]] wikilink in the text, with its span; the task's date rule. */
export function firstDailyLink(
  text: string,
): { title: string; from: number; to: number } | null {
  return findWikilinks(text).find((link) => isDailyTitle(link.title)) ?? null;
}

/** A task's due date: the first daily-title wikilink in its own text. */
export function taskDueDate(text: string): string | null {
  return firstDailyLink(text)?.title ?? null;
}

/** True when the text links to at least one non-daily page. */
export function taskHasPageLink(text: string): boolean {
  return findWikilinks(text).some((link) => !isDailyTitle(link.title));
}

export interface TaskBuckets {
  /** no page link, no date — untriaged; createdAt asc (stalest first) */
  inbox: TaskListItem[];
  /** dueDate <= today — dueDate asc, then createdAt */
  due: TaskListItem[];
  /** dueDate > today — dueDate asc, then createdAt */
  planned: TaskListItem[];
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
  const due: TaskListItem[] = [];
  const planned: TaskListItem[] = [];
  for (const item of items) {
    if (item.dueDate !== null) {
      (item.dueDate <= today ? due : planned).push(item);
    } else if (!item.hasPageLink) {
      inbox.push(item);
    }
  }
  inbox.sort((a, b) => a.block.createdAt - b.block.createdAt);
  due.sort(byDueDate);
  planned.sort(byDueDate);
  return { inbox, due, planned };
}
