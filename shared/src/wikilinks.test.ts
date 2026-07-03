import { describe, expect, it } from 'vitest';
import { extractWikilinks, segmentText } from './wikilinks.js';

describe('extractWikilinks', () => {
  it('extracts unique trimmed titles', () => {
    expect(
      extractWikilinks('see [[Foo]] and [[ Bar Baz ]] and [[Foo]]'),
    ).toEqual(['Foo', 'Bar Baz']);
  });

  it('ignores empty and unclosed links', () => {
    expect(extractWikilinks('[[  ]] [[unclosed and [[Real]]')).toEqual([
      'Real',
    ]);
  });

  it('returns empty for plain text', () => {
    expect(extractWikilinks('no links here')).toEqual([]);
  });
});

describe('segmentText', () => {
  it('splits text around links', () => {
    expect(segmentText('a [[B]] c')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'link', title: 'B', raw: '[[B]]' },
      { type: 'text', value: ' c' },
    ]);
  });

  it('handles adjacent links and trailing text', () => {
    expect(segmentText('[[A]][[B]]!')).toEqual([
      { type: 'link', title: 'A', raw: '[[A]]' },
      { type: 'link', title: 'B', raw: '[[B]]' },
      { type: 'text', value: '!' },
    ]);
  });
});
