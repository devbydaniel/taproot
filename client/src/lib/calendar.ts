import type { EventInput } from '@fullcalendar/core';
import {
  collectAssignedReferenceTitles,
  cutToken,
  DEFAULT_TASK_MINUTES,
  findRecurrence,
  findTimeToken,
  formatClock,
  formatDailyTitle,
  matchesAssignedReferenceFilter,
  parseTask,
  rescheduleTask,
  segmentText,
  setTaskTime,
  shiftDailyTitle,
  taskDueDate,
  taskTime,
  type Block,
  type CalendarEvent,
  type TaskTime,
} from '@taproot/shared';

const DAY_MINUTES = 24 * 60;

/**
 * What a calendar block shows for a task: its text without the task marker,
 * date link, time and recurrence tokens (the calendar already says when and
 * marks repeats), page references as their bare titles.
 */
export function taskLabel(text: string): string {
  let rest = parseTask(text)?.rest ?? text;
  rest = setTaskTime(rescheduleTask(rest, null), null);
  const recurrence = findRecurrence(rest);
  if (recurrence) rest = cutToken(rest, recurrence.from, recurrence.to);
  return segmentText(rest)
    .map((segment) =>
      segment.type === 'text'
        ? segment.value
        : segment.type === 'url'
          ? segment.url
          : segment.title,
    )
    .join('')
    .trim();
}

interface TaskEventProps {
  kind: 'task';
  recurring: boolean;
}

interface GoogleEventProps {
  kind: 'google';
  /** where a click goes: the Meet link, else the event in Google Calendar */
  link: string | null;
  /** has a video call */
  meet: boolean;
}

export type CalendarEventProps = TaskEventProps | GoogleEventProps;

/** Google event ids get a prefix no block id (nanoid) can carry. */
const GOOGLE_ID_PREFIX = 'google:';

/** Local wall-clock ISO string; FullCalendar reads unzoned strings as local. */
function localDateTime(date: string, minutes: number): string {
  return minutes === DAY_MINUTES
    ? `${shiftDailyTitle(date, 1)!}T00:00`
    : `${date}T${formatClock(minutes)}`;
}

/**
 * The calendar event for a block: open tasks with a date only (completed
 * tasks leave the calendar). Timed tasks become blocks; date-only tasks sit
 * in the all-day row, movable between days but not stretchable across them.
 * The event id is the block id.
 */
export function taskEvent(block: Block): EventInput | null {
  if (parseTask(block.text)?.state !== 'TODO') return null;
  const date = taskDueDate(block.text);
  if (date === null) return null;
  const time = taskTime(block.text);
  const extendedProps: TaskEventProps = {
    kind: 'task',
    recurring: findRecurrence(block.text) !== null,
  };
  const base = {
    id: block.id,
    title: taskLabel(block.text) || 'Untitled task',
    classNames: ['taproot-task'],
    extendedProps,
  };
  if (time === null)
    return { ...base, start: date, allDay: true, durationEditable: false };
  return {
    ...base,
    start: localDateTime(date, time.start),
    end: localDateTime(date, time.end),
    allDay: false,
  };
}

/**
 * The calendar event for a synced Google event: read-only (never dragged or
 * resized, timed or all-day), in its own colour. Timed events carry a Berlin
 * offset, so FullCalendar places them at the right local time.
 */
export function googleEvent(event: CalendarEvent): EventInput {
  const tentative = event.status === 'tentative';
  const extendedProps: GoogleEventProps = {
    kind: 'google',
    link: event.meetLink ?? event.htmlLink,
    meet: event.meetLink !== null,
  };
  return {
    id: `${GOOGLE_ID_PREFIX}${event.id}`,
    title: event.title || '(No title)',
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    editable: false,
    classNames: [
      'taproot-google',
      ...(tentative ? ['taproot-google-tentative'] : []),
    ],
    extendedProps,
  };
}

const CLOCK = { hour: '2-digit', minute: '2-digit', hour12: false } as const;

/**
 * When the calendar last synced, for the status indicator: the clock time
 * today, the date and time before that.
 */
export function formatSyncTime(at: number, now: Date = new Date()): string {
  const date = new Date(at);
  return formatDailyTitle(date) === formatDailyTitle(now)
    ? date.toLocaleTimeString(undefined, CLOCK)
    : date.toLocaleString(undefined, {
        ...CLOCK,
        month: 'short',
        day: 'numeric',
      });
}

export interface SlotSchedule {
  /** daily title of the day the task lands on */
  date: string;
  /** null for the all-day row */
  time: TaskTime | null;
}

/**
 * Translate where a task landed on the calendar (local dates, end exclusive)
 * into its date and time. A timed span without an end gets the default
 * duration; an end at the next midnight is the day's end. Null when the span
 * crosses midnight — task times never span into the next day.
 */
export function slotSchedule(
  start: Date,
  end: Date | null,
  allDay: boolean,
): SlotSchedule | null {
  const date = formatDailyTitle(start);
  if (allDay) return { date, time: null };
  const from = start.getHours() * 60 + start.getMinutes();
  if (end === null)
    return {
      date,
      time: {
        start: from,
        end: Math.min(from + DEFAULT_TASK_MINUTES, DAY_MINUTES),
      },
    };
  const endDate = formatDailyTitle(end);
  let to = end.getHours() * 60 + end.getMinutes();
  if (endDate !== date) {
    if (endDate !== shiftDailyTitle(date, 1) || to !== 0) return null;
    to = DAY_MINUTES;
  }
  return to > from ? { date, time: { start: from, end: to } } : null;
}

/**
 * How long a task runs once it lands on a time slot: the length of its time
 * token (also when it has no date yet), else the default duration.
 */
export function taskDuration(text: string): number {
  const time = findTimeToken(text)?.value;
  return time ? time.end - time.start : DEFAULT_TASK_MINUTES;
}

/**
 * Where a sidebar task lands when dropped or tapped onto the calendar at
 * `start` (local): the all-day row sets only the date; a time slot sets date
 * and time, keeping the task's duration. Null when that would cross midnight,
 * like a move on the calendar.
 */
export function placeTask(
  text: string,
  start: Date,
  allDay: boolean,
): SlotSchedule | null {
  if (allDay) return slotSchedule(start, null, true);
  // wall-clock arithmetic, so a DST switch doesn't shift the end
  const end = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
    start.getHours(),
    start.getMinutes() + taskDuration(text),
  );
  return slotSchedule(start, end, false);
}

/**
 * The sidebar has no host page, so every non-daily page reference of an open
 * task is a filter option.
 */
const NO_HOST_PAGE = '';

/** Reference filter options for the sidebar: All plus these. */
export function sidebarReferenceOptions(blocks: Block[]): string[] {
  return collectAssignedReferenceTitles(
    blocks.map((block) => block.text),
    NO_HOST_PAGE,
  );
}

/**
 * The sidebar list: open tasks matching the reference selection (empty = All),
 * unscheduled first (oldest first), then scheduled by date — date-only before
 * timed, timed by start.
 */
export function sidebarTasks(
  blocks: Block[],
  selectedTitles: ReadonlySet<string>,
): Block[] {
  const rank = (block: Block) => ({
    date: taskDueDate(block.text),
    start: taskTime(block.text)?.start ?? -1,
  });
  return blocks
    .filter(
      (block) =>
        parseTask(block.text)?.state === 'TODO' &&
        matchesAssignedReferenceFilter(
          block.text,
          NO_HOST_PAGE,
          selectedTitles,
        ),
    )
    .map((block) => ({ block, ...rank(block) }))
    .sort((a, b) => {
      if (a.date !== b.date) {
        if (a.date === null) return -1;
        if (b.date === null) return 1;
        return a.date < b.date ? -1 : 1;
      }
      return a.start - b.start || a.block.createdAt - b.block.createdAt;
    })
    .map(({ block }) => block);
}
