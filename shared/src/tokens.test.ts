import { describe, expect, it } from 'vitest';
import { cutToken, findAngleToken, findAngleTokens } from './tokens.js';

const upper = (content: string) =>
  /^[A-Z]+$/.test(content) ? content.toLowerCase() : null;

describe('findAngleTokens', () => {
  it('returns every token the parser accepts, with spans, in order', () => {
    expect(findAngleTokens('a <X> <no> <YZ>', upper)).toEqual([
      { from: 2, to: 5, value: 'x' },
      { from: 11, to: 15, value: 'yz' },
    ]);
  });

  it('ignores unclosed and nested brackets', () => {
    expect(findAngleTokens('a <X b', upper)).toEqual([]);
    expect(findAngleTokens('<<X>>', upper)).toEqual([
      { from: 1, to: 4, value: 'x' },
    ]);
  });
});

describe('findAngleToken', () => {
  it('returns the first accepted token, or null', () => {
    expect(findAngleToken('<no> <A> <B>', upper)).toEqual({
      from: 5,
      to: 8,
      value: 'a',
    });
    expect(findAngleToken('<no>', upper)).toBeNull();
  });
});

describe('cutToken', () => {
  it('removes the span and one adjacent space', () => {
    expect(cutToken('a <x> b', 2, 5)).toBe('a b');
    expect(cutToken('<x> b', 0, 3)).toBe('b');
    expect(cutToken('a <x>', 2, 5)).toBe('a');
    expect(cutToken('a<x>b', 1, 4)).toBe('ab');
  });
});
