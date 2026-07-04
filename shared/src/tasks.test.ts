import { describe, expect, it } from 'vitest';
import { cycleTaskState, parseTask, withTaskState } from './tasks.js';

describe('parseTask', () => {
  it('parses TODO and DONE markers', () => {
    expect(parseTask('TODO buy milk')).toEqual({
      state: 'TODO',
      rest: 'buy milk',
    });
    expect(parseTask('DONE buy milk')).toEqual({
      state: 'DONE',
      rest: 'buy milk',
    });
  });

  it('parses a bare marker with no text', () => {
    expect(parseTask('TODO')).toEqual({ state: 'TODO', rest: '' });
  });

  it('rejects non-prefix and lowercase markers', () => {
    expect(parseTask('do TODO later')).toBeNull();
    expect(parseTask('todo x')).toBeNull();
    expect(parseTask('TODOx')).toBeNull();
  });
});

describe('withTaskState / cycleTaskState', () => {
  it('adds, swaps, and removes markers', () => {
    expect(withTaskState('buy milk', 'TODO')).toBe('TODO buy milk');
    expect(withTaskState('TODO buy milk', 'DONE')).toBe('DONE buy milk');
    expect(withTaskState('DONE buy milk', null)).toBe('buy milk');
  });

  it('cycles plain → TODO → DONE → plain', () => {
    expect(cycleTaskState('x')).toBe('TODO x');
    expect(cycleTaskState('TODO x')).toBe('DONE x');
    expect(cycleTaskState('DONE x')).toBe('x');
  });
});
