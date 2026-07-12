import { describe, expect, it } from 'vitest';
import { suggestDailyTitles } from './dateSuggest.js';

// Saturday, July 4, 2026
const NOW = new Date(2026, 6, 4);

function titles(query: string, now: Date = NOW): string[] {
  return suggestDailyTitles(query, now).map((s) => s.title);
}

describe('suggestDailyTitles', () => {
  it('resolves relative keywords by prefix', () => {
    expect(titles('today')).toEqual(['2026-07-04']);
    expect(titles('tod')).toEqual(['2026-07-04']);
    expect(titles('tom')).toEqual(['2026-07-05']);
    expect(titles('yes')).toEqual(['2026-07-03']);
  });

  it('offers all keyword matches for an ambiguous prefix', () => {
    // "to" matches both today and tomorrow
    expect(titles('to')).toEqual(['2026-07-04', '2026-07-05']);
  });

  it('ignores single-character queries', () => {
    expect(titles('t')).toEqual([]);
  });

  it('resolves weekday names to the soonest future occurrence', () => {
    expect(titles('wed')).toEqual(['2026-07-08']);
    expect(titles('wednesday')).toEqual(['2026-07-08']);
    // same weekday as today → a week ahead, never today
    expect(titles('sat')).toEqual(['2026-07-11']);
  });

  it('resolves "next <weekday>" to the occurrence after the soonest', () => {
    expect(titles('next wed')).toEqual(['2026-07-15']);
    expect(titles('next sat')).toEqual(['2026-07-18']);
  });

  it('resolves "next week" to the upcoming Monday', () => {
    expect(titles('next week')).toEqual(['2026-07-06']);
  });

  it('offers both readings of the ambiguous "next we"', () => {
    // next week (Monday) and next Wednesday
    expect(titles('next we')).toEqual(['2026-07-06', '2026-07-15']);
  });

  it('resolves "in N days" and "in N weeks", including abbreviated units', () => {
    expect(titles('in 3 days')).toEqual(['2026-07-07']);
    expect(titles('in 3 d')).toEqual(['2026-07-07']);
    expect(titles('in 2 weeks')).toEqual(['2026-07-18']);
    expect(titles('in 2 w')).toEqual(['2026-07-18']);
  });

  it('resolves month-name dates to the next occurrence', () => {
    expect(titles('jul 15')).toEqual(['2026-07-15']);
    expect(titles('15 jul')).toEqual(['2026-07-15']);
    expect(titles('15. july')).toEqual(['2026-07-15']);
    // already past this year → next year
    expect(titles('jan 3')).toEqual(['2027-01-03']);
    // today itself counts as "on or after"
    expect(titles('jul 4')).toEqual(['2026-07-04']);
  });

  it('resolves numeric day.month dates', () => {
    expect(titles('15.7')).toEqual(['2026-07-15']);
    expect(titles('15.7.')).toEqual(['2026-07-15']);
    expect(titles('3.1')).toEqual(['2027-01-03']);
    expect(titles('15.7.2027')).toEqual(['2027-07-15']);
  });

  it('skips impossible dates and finds the next leap day', () => {
    expect(titles('31.2')).toEqual([]);
    expect(titles('29.2')).toEqual(['2028-02-29']);
    expect(titles('30.2.2027')).toEqual([]);
  });

  it('resolves a bare day of month to its soonest occurrence', () => {
    expect(titles('15')).toEqual(['2026-07-15']);
    // the 2nd has passed this month → next month
    expect(titles('2')).toEqual(['2026-08-02']);
    // months without a 31st are skipped
    expect(titles('31', new Date(2026, 5, 15))).toEqual(['2026-07-31']);
  });

  it('offers a typed-out ISO date verbatim', () => {
    expect(titles('2026-12-24')).toEqual(['2026-12-24']);
    expect(titles('2026-02-30')).toEqual([]);
  });

  it('returns nothing for non-date queries', () => {
    expect(titles('')).toEqual([]);
    expect(titles('welcome')).toEqual([]);
    expect(titles('groceries list')).toEqual([]);
  });

  it('labels every suggestion with its resolved calendar date', () => {
    expect(suggestDailyTitles('next wed', NOW)).toEqual([
      { title: '2026-07-15', label: 'Wednesday, July 15, 2026' },
    ]);
  });
});
