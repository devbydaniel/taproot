export const DAILY_TITLE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** ISO date title (local time), e.g. 2026-07-04. */
export function formatDailyTitle(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/** Injectable clock so tests (and callers) can pin "now". */
export function todayTitle(now: Date = new Date()): string {
  return formatDailyTitle(now);
}

/** Local-time Date for a daily title, or null if it isn't a real calendar date. */
function parseDailyTitle(title: string): Date | null {
  if (!DAILY_TITLE_RE.test(title)) return null;
  const [year, month, day] = title.split('-').map(Number);
  const date = new Date(year!, month! - 1, day);
  // Date rolls over out-of-range components (2026-02-30 → Mar 2), so a
  // round-trip mismatch means the title wasn't a real date
  return formatDailyTitle(date) === title ? date : null;
}

/** A daily note is a page whose title is a valid ISO date. */
export function isDailyTitle(title: string): boolean {
  return parseDailyTitle(title) !== null;
}

/** Title `days` calendar days away (negative = past), or null for non-daily titles. */
export function shiftDailyTitle(title: string, days: number): string | null {
  const date = parseDailyTitle(title);
  if (!date) return null;
  date.setDate(date.getDate() + days);
  return formatDailyTitle(date);
}

/** Human-friendly form, e.g. "Saturday, July 4, 2026", or null for non-daily titles. */
export function dailyLabel(title: string): string | null {
  const date = parseDailyTitle(title);
  if (!date) return null;
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
