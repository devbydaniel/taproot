import { describe, expect, it } from 'vitest';
import {
  assignedReferenceTitles,
  collectAssignedReferenceTitles,
  matchesAssignedReferenceFilter,
} from './referenceFilter.js';

describe('assignedReferenceTitles', () => {
  it('keeps direct wikilinks and tags but excludes the host and daily pages', () => {
    expect(
      assignedReferenceTitles(
        'TODO x [[Project]] [[Alice]] #urgent #[[Design Team]] [[2026-08-10]]',
        'Project',
      ),
    ).toEqual(['Alice', 'urgent', 'Design Team']);
  });

  it('deduplicates titles while preserving their first spelling and order', () => {
    expect(
      assignedReferenceTitles('[[Alice]] #Alice [[Bob]] [[Alice]]', 'Project'),
    ).toEqual(['Alice', 'Bob']);
  });
});

describe('collectAssignedReferenceTitles', () => {
  it('collects unique options alphabetically across item texts', () => {
    expect(
      collectAssignedReferenceTitles(
        ['[[Project]] [[Zebra]] #alpha', '[[Alpha]] [[Zebra]]'],
        'Project',
      ),
    ).toEqual(['alpha', 'Alpha', 'Zebra']);
  });
});

describe('matchesAssignedReferenceFilter', () => {
  const text = 'TODO x [[Project]] [[Alice]] #urgent';

  it('treats an empty selection as All', () => {
    expect(matchesAssignedReferenceFilter(text, 'Project', new Set())).toBe(
      true,
    );
  });

  it('uses OR semantics for multiple selections', () => {
    expect(
      matchesAssignedReferenceFilter(
        text,
        'Project',
        new Set(['Missing', 'urgent']),
      ),
    ).toBe(true);
    expect(
      matchesAssignedReferenceFilter(
        text,
        'Project',
        new Set(['Missing', 'Other']),
      ),
    ).toBe(false);
  });
});
