// Europe/Berlin calendar arithmetic for the Google sync, on top of Intl
// (Node ships full ICU). Dates are YYYY-MM-DD strings, instants epoch ms.

const TIME_ZONE = 'Europe/Berlin';

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(epochMs: number): WallClock {
  const parts: Record<string, number> = {};
  for (const part of partsFormat.formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** Berlin's UTC offset at the instant, in minutes (60 in winter, 120 in summer) */
function offsetMinutes(epochMs: number): number {
  const w = wallClock(epochMs);
  const asUtc = Date.UTC(
    w.year,
    w.month - 1,
    w.day,
    w.hour,
    w.minute,
    w.second,
  );
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60_000);
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** the Berlin calendar date of an instant */
export function berlinDate(epochMs: number): string {
  const w = wallClock(epochMs);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** the instant a Berlin calendar date begins (midnight always exists: DST switches at 02:00/03:00) */
export function berlinMidnight(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  // the offset at the guess can differ from the one at the answer only when a
  // DST switch lies between them; one correction step settles it
  const guess = utcMidnight - offsetMinutes(utcMidnight) * 60_000;
  return utcMidnight - offsetMinutes(guess) * 60_000;
}

/** ISO 8601 with the Berlin offset, e.g. 2026-11-26T14:00:00+01:00 */
export function berlinIso(epochMs: number): string {
  const w = wallClock(epochMs);
  const offset = offsetMinutes(epochMs);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return (
    `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}` +
    `T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** calendar arithmetic on a YYYY-MM-DD date */
export function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}
