import { describe, expect, it } from 'vitest';
import {
  advanceRecurringTask,
  findRecurrence,
  nextOccurrence,
  parseRecurrenceRule,
} from './recurrence.js';

// Sunday, July 12, 2026
const NOW = new Date(2026, 6, 12);

describe('parseRecurrenceRule', () => {
  it('parses day and week intervals, normalizing weeks to days', () => {
    expect(parseRecurrenceRule('every day')).toEqual({ unit: 'days', n: 1 });
    expect(parseRecurrenceRule('every 3 days')).toEqual({ unit: 'days', n: 3 });
    expect(parseRecurrenceRule('every week')).toEqual({ unit: 'days', n: 7 });
    expect(parseRecurrenceRule('every 2 weeks')).toEqual({
      unit: 'days',
      n: 14,
    });
  });

  it('parses monthly rules with an optional day of month', () => {
    expect(parseRecurrenceRule('every month')).toEqual({
      unit: 'months',
      n: 1,
    });
    expect(parseRecurrenceRule('every 2 months')).toEqual({
      unit: 'months',
      n: 2,
    });
    expect(parseRecurrenceRule('every month on the 15th')).toEqual({
      unit: 'months',
      n: 1,
      day: 15,
    });
    expect(parseRecurrenceRule('every month on the 1st')).toEqual({
      unit: 'months',
      n: 1,
      day: 1,
    });
  });

  it('parses weekday rules, allowing ≥2-char abbreviations', () => {
    expect(parseRecurrenceRule('every monday')).toEqual({
      unit: 'weekday',
      weekday: 1,
    });
    expect(parseRecurrenceRule('every mon')).toEqual({
      unit: 'weekday',
      weekday: 1,
    });
    expect(parseRecurrenceRule('every weekday')).toEqual({ unit: 'weekdays' });
  });

  it('normalizes case and whitespace', () => {
    expect(parseRecurrenceRule('  Every   2  Weeks ')).toEqual({
      unit: 'days',
      n: 14,
    });
  });

  it('rejects non-rules', () => {
    expect(parseRecurrenceRule('every')).toBeNull();
    expect(parseRecurrenceRule('every banana')).toBeNull();
    expect(parseRecurrenceRule('every 0 days')).toBeNull();
    expect(parseRecurrenceRule('every month on the 32nd')).toBeNull();
    expect(parseRecurrenceRule('daily')).toBeNull();
  });
});

describe('findRecurrence', () => {
  it('finds the first parseable <...> token with its span', () => {
    expect(findRecurrence('TODO water [[2026-07-15]] <every 2 weeks>')).toEqual(
      {
        from: 26,
        to: 41,
        rule: { unit: 'days', n: 14 },
      },
    );
  });

  it('skips angle-bracket prose that is not a rule', () => {
    expect(findRecurrence('a <b> c')).toBeNull();
    expect(findRecurrence('x <not a rule> but <every day> yes')).toEqual({
      from: 19,
      to: 30,
      rule: { unit: 'days', n: 1 },
    });
  });

  it('returns null for plain text', () => {
    expect(findRecurrence('TODO nothing recurring here')).toBeNull();
  });
});

describe('nextOccurrence', () => {
  it('steps day intervals from the anchor', () => {
    expect(nextOccurrence({ unit: 'days', n: 14 }, '2026-07-12', NOW)).toBe(
      '2026-07-26',
    );
    expect(nextOccurrence({ unit: 'days', n: 1 }, '2026-07-12', NOW)).toBe(
      '2026-07-13',
    );
  });

  it('keeps cadence for overdue tasks but never lands in the past', () => {
    // anchored 2026-07-01, every 2 days, completed on the 12th →
    // next multiple of 2 after the 12th counted from the 1st is the 13th
    expect(nextOccurrence({ unit: 'days', n: 2 }, '2026-07-01', NOW)).toBe(
      '2026-07-13',
    );
    // cadence from the 10th would hit today; strictly-after → the 14th
    expect(nextOccurrence({ unit: 'days', n: 2 }, '2026-07-10', NOW)).toBe(
      '2026-07-14',
    );
  });

  it('respects a future anchor', () => {
    expect(nextOccurrence({ unit: 'days', n: 7 }, '2026-08-01', NOW)).toBe(
      '2026-08-08',
    );
  });

  it('steps months keeping the day, clamping short months', () => {
    expect(nextOccurrence({ unit: 'months', n: 1 }, '2026-07-12', NOW)).toBe(
      '2026-08-12',
    );
    expect(
      nextOccurrence(
        { unit: 'months', n: 1 },
        '2027-01-31',
        new Date(2027, 0, 31),
      ),
    ).toBe('2027-02-28');
  });

  it('honors an explicit day of month', () => {
    expect(
      nextOccurrence({ unit: 'months', n: 1, day: 15 }, '2026-07-12', NOW),
    ).toBe('2026-07-15');
    expect(
      nextOccurrence({ unit: 'months', n: 1, day: 1 }, '2026-07-12', NOW),
    ).toBe('2026-08-01');
  });

  it('finds the next weekday occurrence', () => {
    // today is Sunday → next Monday is tomorrow
    expect(
      nextOccurrence({ unit: 'weekday', weekday: 1 }, '2026-07-12', NOW),
    ).toBe('2026-07-13');
    expect(
      nextOccurrence({ unit: 'weekday', weekday: 0 }, '2026-07-12', NOW),
    ).toBe('2026-07-19');
  });

  it('skips weekends for weekday rules', () => {
    // Friday the 17th → next workday is Monday the 20th
    expect(nextOccurrence({ unit: 'weekdays' }, '2026-07-17', NOW)).toBe(
      '2026-07-20',
    );
    expect(nextOccurrence({ unit: 'weekdays' }, '2026-07-13', NOW)).toBe(
      '2026-07-14',
    );
  });

  it('falls back to today for a non-daily anchor', () => {
    expect(nextOccurrence({ unit: 'days', n: 1 }, 'Welcome', NOW)).toBe(
      '2026-07-13',
    );
  });
});

describe('advanceRecurringTask', () => {
  it('advances the first daily link', () => {
    expect(
      advanceRecurringTask('TODO water [[2026-07-12]] <every 2 weeks>', NOW),
    ).toBe('TODO water [[2026-07-26]] <every 2 weeks>');
  });

  it('leaves non-daily links alone and advances the daily one', () => {
    expect(
      advanceRecurringTask(
        'TODO water [[Plants]] on [[2026-07-12]] <every week>',
        NOW,
      ),
    ).toBe('TODO water [[Plants]] on [[2026-07-19]] <every week>');
  });

  it('appends a link when the task has none', () => {
    expect(advanceRecurringTask('TODO stretch <every day>', NOW)).toBe(
      'TODO stretch <every day> [[2026-07-13]]',
    );
  });

  it('returns null for tasks without a rule', () => {
    expect(advanceRecurringTask('TODO one-off [[2026-07-12]]', NOW)).toBeNull();
  });
});
