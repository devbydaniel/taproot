import { describe, expect, it } from 'vitest';
import { docTitle } from './doc';

describe('docTitle', () => {
  it('returns null for empty or missing data', () => {
    expect(docTitle(null)).toBeNull();
    expect(docTitle('')).toBeNull();
    expect(docTitle('   \n\n  ')).toBeNull();
  });

  it('captures the first heading', () => {
    expect(docTitle('# Title\n\nbody')).toBe('Title');
    expect(docTitle('\n\n## Deep heading\ntext')).toBe('Deep heading');
  });

  it('falls back to the first non-empty line', () => {
    expect(docTitle('\n\nplain opening line\nmore')).toBe('plain opening line');
  });

  it('does not treat #hashtag-like text as a heading marker', () => {
    // '#x' without a space is not a markdown heading; keep the line verbatim
    expect(docTitle('#nospace here')).toBe('#nospace here');
  });
});
