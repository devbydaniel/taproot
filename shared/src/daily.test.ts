import { describe, expect, it } from 'vitest';
import {
  dailyDisplayLabel,
  dailyLabel,
  formatDailyTitle,
  isDailyTitle,
  shiftDailyTitle,
  todayTitle,
} from './daily.js';

describe('formatDailyTitle / todayTitle', () => {
  it('formats with zero padding', () => {
    expect(formatDailyTitle(new Date(2026, 6, 4))).toBe('2026-07-04');
    expect(formatDailyTitle(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('uses the injected clock', () => {
    expect(todayTitle(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('isDailyTitle', () => {
  it('accepts valid ISO dates', () => {
    expect(isDailyTitle('2026-07-04')).toBe(true);
    expect(isDailyTitle('2024-02-29')).toBe(true); // leap day
  });

  it('rejects non-date titles and wrong shapes', () => {
    expect(isDailyTitle('Welcome')).toBe(false);
    expect(isDailyTitle('2026-1-1')).toBe(false);
    expect(isDailyTitle('2026-07-04 notes')).toBe(false);
    expect(isDailyTitle('')).toBe(false);
  });

  it('rejects impossible calendar dates', () => {
    expect(isDailyTitle('2026-02-30')).toBe(false);
    expect(isDailyTitle('2026-13-01')).toBe(false);
    expect(isDailyTitle('2026-00-10')).toBe(false);
    expect(isDailyTitle('2025-02-29')).toBe(false); // not a leap year
  });
});

describe('shiftDailyTitle', () => {
  it('shifts within a month', () => {
    expect(shiftDailyTitle('2026-07-04', 1)).toBe('2026-07-05');
    expect(shiftDailyTitle('2026-07-04', -1)).toBe('2026-07-03');
  });

  it('crosses month and year boundaries', () => {
    expect(shiftDailyTitle('2026-07-31', 1)).toBe('2026-08-01');
    expect(shiftDailyTitle('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDailyTitle('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('handles leap day', () => {
    expect(shiftDailyTitle('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDailyTitle('2025-02-28', 1)).toBe('2025-03-01');
  });

  it('returns null for non-daily titles', () => {
    expect(shiftDailyTitle('Welcome', 1)).toBeNull();
    expect(shiftDailyTitle('2026-02-30', 1)).toBeNull();
  });
});

describe('dailyDisplayLabel', () => {
  const now = new Date(2026, 6, 4); // Saturday, July 4, 2026

  it('uses relative words for the adjacent days', () => {
    expect(dailyDisplayLabel('2026-07-04', now)).toBe('Today');
    expect(dailyDisplayLabel('2026-07-05', now)).toBe('Tomorrow');
    expect(dailyDisplayLabel('2026-07-03', now)).toBe('Yesterday');
  });

  it('renders a short label, with the year only when it differs', () => {
    expect(dailyDisplayLabel('2026-07-15', now)).toBe('Wed, Jul 15');
    expect(dailyDisplayLabel('2027-01-03', now)).toBe('Sun, Jan 3, 2027');
  });

  it('returns null for non-daily titles', () => {
    expect(dailyDisplayLabel('Welcome', now)).toBeNull();
  });
});

describe('dailyLabel', () => {
  it('renders a friendly label', () => {
    expect(dailyLabel('2026-07-04')).toBe('Saturday, July 4, 2026');
  });

  it('returns null for non-daily titles', () => {
    expect(dailyLabel('Welcome')).toBeNull();
  });
});
