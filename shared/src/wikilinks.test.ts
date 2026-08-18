import { describe, expect, it } from 'vitest';
import {
  extractPageReferences,
  extractWikilinks,
  findPageReferences,
  findWikilinks,
  renamePageReferences,
  segmentText,
} from './wikilinks.js';

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

  it('does not treat multi-word tags as wikilinks', () => {
    expect(extractWikilinks('#[[Tagged Page]] [[Linked Page]]')).toEqual([
      'Linked Page',
    ]);
  });
});

describe('page references', () => {
  it('extracts single-word and multi-word tags alongside wikilinks', () => {
    expect(
      extractPageReferences(
        '#project #[[Project Alpha]] [[Project Alpha]] #two-words',
      ),
    ).toEqual(['project', 'Project Alpha', 'two-words']);
  });

  it('supports unicode tags and ignores hashes inside words and URLs', () => {
    expect(
      extractPageReferences(
        '#café #日本語 word#suffix https://example.com/#fragment',
      ),
    ).toEqual(['café', '日本語']);
  });

  it('returns tag markup and title spans', () => {
    expect(findPageReferences('#tag #[[ multi word ]] [[Page]]')).toEqual([
      {
        type: 'tag',
        title: 'tag',
        raw: '#tag',
        from: 0,
        to: 4,
        titleFrom: 1,
        titleTo: 4,
      },
      {
        type: 'tag',
        title: 'multi word',
        raw: '#[[ multi word ]]',
        from: 5,
        to: 22,
        titleFrom: 8,
        titleTo: 20,
      },
      {
        type: 'link',
        title: 'Page',
        raw: '[[Page]]',
        from: 23,
        to: 31,
        titleFrom: 25,
        titleTo: 29,
      },
    ]);
  });
});

describe('renamePageReferences', () => {
  it('renames exact wikilinks and both tag forms', () => {
    expect(
      renamePageReferences(
        '[[Old]] #Old #[[Old]] [[Old News]] plain Old',
        'Old',
        'New',
      ),
    ).toBe('[[New]] #New #[[New]] [[Old News]] plain Old');
  });

  it('promotes a single-word tag when the new title contains spaces', () => {
    expect(renamePageReferences('#old', 'old', 'New Name')).toBe(
      '#[[New Name]]',
    );
  });

  it('normalizes whitespace inside bracketed references', () => {
    expect(renamePageReferences('[[ Old ]] #[[ Old ]]', 'Old', 'New')).toBe(
      '[[New]] #[[New]]',
    );
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

  it('splits single-word and multi-word tags from text', () => {
    expect(segmentText('use #one and #[[Two Words]]')).toEqual([
      { type: 'text', value: 'use ' },
      { type: 'tag', title: 'one', raw: '#one' },
      { type: 'text', value: ' and ' },
      { type: 'tag', title: 'Two Words', raw: '#[[Two Words]]' },
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
