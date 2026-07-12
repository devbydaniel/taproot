import {
  dailyLabel,
  formatDailyTitle,
  isDailyTitle,
  todayTitle,
} from './daily.js';

export interface DateSuggestion {
  /** Daily-page title, e.g. "2026-07-15". */
  title: string;
  /** Human-readable resolution, e.g. "Wednesday, July 15, 2026". */
  label: string;
}

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function addDays(now: Date, days: number): Date {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  date.setDate(date.getDate() + days);
  return date;
}

/** Real calendar date or null (Date rolls over out-of-range components). */
function exactDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
}

/** Soonest occurrence of `day` in `month` on or after today (skips impossible combos like Feb 29 in non-leap years). */
function nextMonthDay(month: number, day: number, now: Date): Date | null {
  const today = todayTitle(now);
  for (let year = now.getFullYear(); year <= now.getFullYear() + 4; year++) {
    const date = exactDate(year, month, day);
    if (date && formatDailyTitle(date) >= today) return date;
  }
  return null;
}

/** Days until the soonest strictly-future occurrence of a weekday (1..7). */
function daysUntilWeekday(weekday: number, now: Date): number {
  return ((weekday - now.getDay() + 6) % 7) + 1;
}

/** today / tomorrow / yesterday / next week, matched on prefixes of ≥2 chars so a lone "t" doesn't flood the popup. */
function matchKeywords(q: string, now: Date): Date[] {
  if (q.length < 2) return [];
  const dates: Date[] = [];
  if ('today'.startsWith(q)) dates.push(addDays(now, 0));
  if ('tomorrow'.startsWith(q)) dates.push(addDays(now, 1));
  if ('yesterday'.startsWith(q)) dates.push(addDays(now, -1));
  if (q.length >= 6 && 'next week'.startsWith(q)) {
    dates.push(addDays(now, daysUntilWeekday(1, now)));
  }
  return dates;
}

/** Weekday name, optionally prefixed with "next ". */
function matchWeekday(q: string, now: Date): Date[] {
  const match = q.match(/^(next )?([a-z]{2,9})$/);
  if (!match) return [];
  const dates: Date[] = [];
  for (const [index, name] of WEEKDAYS.entries()) {
    if (!name.startsWith(match[2]!)) continue;
    const ahead = daysUntilWeekday(index, now);
    dates.push(addDays(now, match[1] ? ahead + 7 : ahead));
  }
  return dates;
}

/** "in N days" / "in N weeks", unit may be abbreviated ("in 3 d"). */
function matchRelative(q: string, now: Date): Date[] {
  const match = q.match(/^in (\d{1,3}) ?([a-z]+)$/);
  if (!match) return [];
  const n = Number(match[1]);
  const unit = match[2]!;
  const dates: Date[] = [];
  if ('days'.startsWith(unit)) dates.push(addDays(now, n));
  if ('weeks'.startsWith(unit)) dates.push(addDays(now, n * 7));
  return dates;
}

/** Month name + day: "jul 15", "15 jul", "15. july". */
function matchNamedMonth(q: string, now: Date): Date[] {
  const monthDay = q.match(/^([a-z]{3,9}) (\d{1,2})$/);
  const dayMonth = q.match(/^(\d{1,2})\.? ([a-z]{3,9})$/);
  const named = monthDay
    ? { name: monthDay[1]!, day: Number(monthDay[2]) }
    : dayMonth
      ? { name: dayMonth[2]!, day: Number(dayMonth[1]) }
      : null;
  if (!named) return [];
  const dates: Date[] = [];
  for (const [index, name] of MONTHS.entries()) {
    if (!name.startsWith(named.name)) continue;
    const date = nextMonthDay(index + 1, named.day, now);
    if (date) dates.push(date);
  }
  return dates;
}

/** Numeric day.month: "15.7", "15.7.", "15.7.2027". */
function matchNumeric(q: string, now: Date): Date[] {
  const match = q.match(/^(\d{1,2})\.(\d{1,2})\.?(\d{4})?$/);
  if (!match) return [];
  const day = Number(match[1]);
  const month = Number(match[2]);
  const date = match[3]
    ? exactDate(Number(match[3]), month, day)
    : nextMonthDay(month, day, now);
  return date ? [date] : [];
}

/** Bare day of month: "15" → soonest upcoming 15th. */
function matchBareDay(q: string, now: Date): Date[] {
  const match = q.match(/^(\d{1,2})\.?$/);
  if (!match) return [];
  const day = Number(match[1]);
  const today = todayTitle(now);
  for (let offset = 0; offset < 12 && day >= 1 && day <= 31; offset++) {
    const month = now.getMonth() + offset;
    const date = exactDate(
      now.getFullYear() + Math.floor(month / 12),
      (month % 12) + 1,
      day,
    );
    if (date && formatDailyTitle(date) >= today) return [date];
  }
  return [];
}

/** Full ISO date typed out — offer it even when the page doesn't exist yet. */
function matchIso(q: string): Date[] {
  return isDailyTitle(q) ? [new Date(q + 'T00:00')] : [];
}

/**
 * Resolve a natural-language date phrase to daily-page titles.
 *
 * Vocabulary: today/tomorrow/yesterday, weekday names ("wed" = soonest
 * upcoming, "next wed" = the one after), "next week" (upcoming Monday),
 * "in N days/weeks", "jul 15" / "15 jul" / "15.7." / "15.7.2027", a bare
 * day-of-month ("15"), and full ISO dates. Keywords match on prefixes of
 * two or more characters; ambiguous queries return several candidates.
 */
export function suggestDailyTitles(
  query: string,
  now: Date = new Date(),
): DateSuggestion[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return [];
  const dates = [
    ...matchKeywords(q, now),
    ...matchWeekday(q, now),
    ...matchRelative(q, now),
    ...matchNamedMonth(q, now),
    ...matchNumeric(q, now),
    ...matchBareDay(q, now),
    ...matchIso(q),
  ];
  const seen = new Set<string>();
  const suggestions: DateSuggestion[] = [];
  for (const date of dates) {
    const title = formatDailyTitle(date);
    if (seen.has(title)) continue;
    seen.add(title);
    suggestions.push({ title, label: dailyLabel(title)! });
  }
  return suggestions;
}
