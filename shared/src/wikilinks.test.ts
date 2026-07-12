import { describe, expect, it } from 'vitest';
import { extractWikilinks, findWikilinks, segmentText } from './wikilinks.js';

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

describe('findWikilinks', () => {
  it('returns titles with their document spans', () => {
    expect(findWikilinks('a [[B]] and [[ C ]]')).toEqual([
      { title: 'B', from: 2, to: 7 },
      { title: 'C', from: 12, to: 19 },
    ]);
  });

  it('returns empty for plain text', () => {
    expect(findWikilinks('no links')).toEqual([]);
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

  it('splits out a bare URL', () => {
    expect(segmentText('https://example.com')).toEqual([
      { type: 'url', url: 'https://example.com' },
    ]);
  });

  it('splits URLs mid-sentence', () => {
    expect(segmentText('see http://a.io/x for details')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'url', url: 'http://a.io/x' },
      { type: 'text', value: ' for details' },
    ]);
  });

  it('trims trailing punctuation from URLs', () => {
    expect(segmentText('(see https://x.com/a).')).toEqual([
      { type: 'text', value: '(see ' },
      { type: 'url', url: 'https://x.com/a' },
      { type: 'text', value: ').' },
    ]);
  });

  it('interleaves URLs and wikilinks', () => {
    expect(segmentText('https://a.com [[B]] https://c.com')).toEqual([
      { type: 'url', url: 'https://a.com' },
      { type: 'text', value: ' ' },
      { type: 'link', title: 'B', raw: '[[B]]' },
      { type: 'text', value: ' ' },
      { type: 'url', url: 'https://c.com' },
    ]);
  });

  it('keeps a URL inside a wikilink as a wikilink', () => {
    expect(segmentText('[[https://example.com]]')).toEqual([
      {
        type: 'link',
        title: 'https://example.com',
        raw: '[[https://example.com]]',
      },
    ]);
  });

  it('does not match bare domains or other protocols', () => {
    expect(segmentText('example.com and ftp://foo')).toEqual([
      { type: 'text', value: 'example.com and ftp://foo' },
    ]);
  });
});
