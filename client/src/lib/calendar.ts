import type { EventInput } from '@fullcalendar/core';
import {
  cutToken,
  DEFAULT_TASK_MINUTES,
  findRecurrence,
  formatClock,
  formatDailyTitle,
  parseTask,
  rescheduleTask,
  segmentText,
  setTaskTime,
  shiftDailyTitle,
  taskDueDate,
  taskTime,
  type Block,
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

export interface TaskEventProps {
  recurring: boolean;
}

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
    recurring: findRecurrence(block.text) !== null,
  };
  const base = {
    id: block.id,
    title: taskLabel(block.text) || 'Untitled task',
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
