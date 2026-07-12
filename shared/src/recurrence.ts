import {
  daysUntilWeekday,
  formatDailyTitle,
  isDailyTitle,
  parseDailyTitle,
  shiftDailyTitle,
  todayTitle,
  WEEKDAY_NAMES,
} from './daily.js';
import { findWikilinks } from './wikilinks.js';

export type RecurrenceRule =
  | { unit: 'days'; n: number }
  | { unit: 'months'; n: number; day?: number }
  | { unit: 'weekday'; weekday: number }
  | { unit: 'weekdays' };

/** "day" / "N days" / "week" / "N weeks" — weeks normalize to days. */
function matchSimpleUnit(rest: string): RecurrenceRule | null {
  const match = rest.match(/^(?:(\d{1,3}) )?(days?|weeks?)$/);
  if (!match) return null;
  const n = Number(match[1] ?? 1);
  if (n < 1) return null;
  return { unit: 'days', n: match[2]!.startsWith('week') ? n * 7 : n };
}

/** "weekday(s)" (Mon–Fri) or a weekday name, abbreviations of ≥2 chars allowed. */
function matchWeekdayRule(rest: string): RecurrenceRule | null {
  if (rest === 'weekday' || rest === 'weekdays') return { unit: 'weekdays' };
  if (rest.length < 2) return null;
  const weekday = WEEKDAY_NAMES.findIndex((name) => name.startsWith(rest));
  return weekday === -1 ? null : { unit: 'weekday', weekday };
}

/** "month" / "N months", optionally "on the 15(th)". */
function matchMonthly(rest: string): RecurrenceRule | null {
  const match = rest.match(
    /^(?:(\d{1,3}) )?months?(?: on the (\d{1,2})(?:st|nd|rd|th)?)?$/,
  );
  if (!match) return null;
  const n = Number(match[1] ?? 1);
  if (n < 1) return null;
  if (!match[2]) return { unit: 'months', n };
  const day = Number(match[2]);
  return day >= 1 && day <= 31 ? { unit: 'months', n, day } : null;
}

/** Parse a rule spec like "every 2 weeks"; null when it isn't one. */
export function parseRecurrenceRule(spec: string): RecurrenceRule | null {
  const match = spec
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .match(/^every (.+)$/);
  if (!match) return null;
  const rest = match[1]!;
  return matchSimpleUnit(rest) ?? matchWeekdayRule(rest) ?? matchMonthly(rest);
}

const TOKEN_RE = /<([^<>\n]+)>/g;

export interface Recurrence {
  from: number;
  to: number;
  rule: RecurrenceRule;
}

/**
 * First <...> token whose content is a valid rule, with its span in the text.
 * Angle brackets around anything else stay plain prose.
 */
export function findRecurrence(text: string): Recurrence | null {
  for (const match of text.matchAll(TOKEN_RE)) {
    const rule = parseRecurrenceRule(match[1]!);
    if (rule)
      return { from: match.index, to: match.index + match[0].length, rule };
  }
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Smallest anchor + k·n (k ≥ 1) strictly after the floor. */
function nextInterval(anchor: string, n: number, floor: string): string {
  const elapsed = Math.max(
    0,
    Math.round(
      (parseDailyTitle(floor)!.getTime() - parseDailyTitle(anchor)!.getTime()) /
        DAY_MS,
    ),
  );
  const steps = Math.floor(elapsed / n) + 1;
  return shiftDailyTitle(anchor, steps * n)!;
}

/** Next monthly occurrence after the floor, clamping to short months (Jan 31 → Feb 28 → Mar 31). */
function nextMonthly(
  anchor: string,
  n: number,
  explicitDay: number | undefined,
  floor: string,
): string {
  const from = parseDailyTitle(anchor)!;
  const day = explicitDay ?? from.getDate();
  for (let k = 0; k <= 1200; k++) {
    const month = from.getMonth() + k * n;
    const lastDay = new Date(from.getFullYear(), month + 1, 0).getDate();
    const title = formatDailyTitle(
      new Date(from.getFullYear(), month, Math.min(day, lastDay)),
    );
    if (title > floor) return title;
  }
  return shiftDailyTitle(floor, 1)!; // unreachable for sane inputs
}

/** Next Mon–Fri day strictly after the floor. */
function nextWorkday(floor: string): string {
  const weekday = parseDailyTitle(shiftDailyTitle(floor, 1)!)!.getDay();
  const skip = weekday === 6 ? 3 : weekday === 0 ? 2 : 1;
  return shiftDailyTitle(floor, skip)!;
}

/**
 * Next daily title the rule produces, strictly after both the anchor date and
 * today — cadence counts from the anchor, but completing an overdue task never
 * spawns an instance in the past.
 */
export function nextOccurrence(
  rule: RecurrenceRule,
  anchorTitle: string,
  now: Date = new Date(),
): string {
  const today = todayTitle(now);
  const anchor = isDailyTitle(anchorTitle) ? anchorTitle : today;
  const floor = anchor > today ? anchor : today;
  switch (rule.unit) {
    case 'days':
      return nextInterval(anchor, rule.n, floor);
    case 'months':
      return nextMonthly(anchor, rule.n, rule.day, floor);
    case 'weekday':
      return shiftDailyTitle(
        floor,
        daysUntilWeekday(rule.weekday, parseDailyTitle(floor)!),
      )!;
    case 'weekdays':
      return nextWorkday(floor);
  }
}

/**
 * Text of the next instance of a recurring task: the first daily link advances
 * to the rule's next occurrence (appended when there is none). Null when the
 * text carries no recurrence rule — the caller treats the task as one-off.
 */
export function advanceRecurringTask(
  text: string,
  now: Date = new Date(),
): string | null {
  const recurrence = findRecurrence(text);
  if (!recurrence) return null;
  const link = findWikilinks(text).find((l) => isDailyTitle(l.title));
  if (!link) {
    const next = nextOccurrence(recurrence.rule, todayTitle(now), now);
    return `${text} [[${next}]]`;
  }
  const next = nextOccurrence(recurrence.rule, link.title, now);
  return text.slice(0, link.from + 2) + next + text.slice(link.to - 2);
}
